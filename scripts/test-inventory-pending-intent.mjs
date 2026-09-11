import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { renderSegment } from "../root-site/components/segment.js";
import { inventoryWriteAccess } from "../root-site/bizflow/inventory-health.js";

const read = (path) => readFile(new URL(`../root-site/${path}`, import.meta.url), "utf8");
const [inventory, pending, debounce, lifecycle, snapshots] = await Promise.all([
  read("bizflow/inventory.js"), read("bizflow/inventory-pending.js"), read("components/debounced-task.js"),
  read("spa/page-lifecycle.js"), read("data/live-snapshots.js")
]);
// Execute the actual page and pending module with data/DOM boundaries stubbed.
// Import-only removal lets timers, mount, tab events and disposal run unchanged.
function load(source, globals, exports) {
  const imports = /import\s+\{([^}]+)\}\s+from\s+["'][^"']+["'];/g;
  const defaults = {};
  for (const match of source.matchAll(imports)) for (const name of match[1].split(",")) {
    defaults[name.trim().split(/\s+as\s+/).at(-1)] = () => {};
  }
  const body = source.replace(imports, "").replace(/^export /gm, "");
  return vm.runInNewContext(`${body}\n;({${exports.join(",")}})`, { ...defaults, ...globals });
}
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function fixture({ tab, response, admin = false } = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), listeners = new Map();
  const calls = { pending: 0, orders: 0, inventory: 0, health: 0, warnings: 0 };
  const document = {
    documentElement: { lang: "en" }, querySelector: () => null,
    addEventListener(type, handler) { const set = listeners.get(type) ?? new Set(); set.add(handler); listeners.set(type, set); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }
  };
  const globals = {
    document, AbortController, DOMException, queueMicrotask,
    console: { warn() { calls.warnings += 1; } },
    setTimeout(callback, delay = 0) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const { createPageScope, throwIfPageAborted } = load(lifecycle, globals, ["createPageScope", "throwIfPageAborted"]);
  const scope = createPageScope();
  const pendingApi = load(pending, {
    ...globals,
    getPendingDeductionData() { calls.pending += 1; return response?.() ?? Promise.resolve({ invoices: [{ orderNo: "INV-1", items: [] }, { orderNo: "INV-2", items: [] }] }); },
    getOrdersPageData() { calls.orders += 1; return Promise.resolve({ orders: [{ id: "order-1", detail: { orderNo: "INV-1" } }] }); }
  }, ["attachPendingDeductionBehaviors", "disposePendingDeductionState", "ensurePendingDeductionData", "ensurePendingOrderLinks", "pendingDeductionCount", "renderPendingDeduction"]);
  const pageApi = load(inventory, {
    ...globals, ...pendingApi, ...load(debounce, globals, ["createDebouncedTask"]),
    throwIfPageAborted, inventoryWriteAccess, renderSharedSegment: renderSegment,
    navigationPresetKeys: { inventorySearch: "search" }, createBizflowMenu: () => [],
    cachedPageUnread: () => ({ unread: {}, watermarks: {} }),
    getInventoryPageData() { calls.inventory += 1; return Promise.resolve({ products: [] }); },
    getCurrentUser: async () => admin ? { isBfAdmin: true, hasPermission() {} } : {},
    runInventoryHealthCheck() { calls.health += 1; return Promise.resolve(true); }
  }, ["mountPage", "renderSegment"]);
  const mounted = await pageApi.mountPage({ scope, signal: scope.signal, historyState: tab ? { tab } : null });
  mounted.activate();
  const button = {
    matches: () => false,
    closest(selector) { return ['[data-inventory-tab]', '[data-inventory-tab="pending"]'].includes(selector) ? this : null; },
    getAttribute: () => "pending", contains(target) { return target === this || target === child; }
  };
  const child = { closest: (selector) => button.closest(selector) };
  return {
    calls, pendingApi, scope, mounted, button, child,
    badge: () => pageApi.renderSegment({ escapeHtml: String, lang: "en" }),
    emit(type, { target = button, relatedTarget = null, pointerType = "mouse" } = {}) {
      return Promise.all([...listeners.get(type) ?? []].map((handler) => handler({ target, relatedTarget, pointerType })));
    },
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      now = end; await settle();
    },
    dispose() { mounted.dispose(); scope.dispose(); }
  };
}

test("default mount/activation and idle never load pending tables; unknown badge is ellipsis", async () => {
  const f = await fixture({ admin: true });
  await f.tick(10000);
  assert.equal(f.calls.inventory, 1);
  assert.equal(f.calls.pending, 0);
  assert.equal(f.calls.orders, 0);
  assert.equal(f.calls.health, 1, "health stays backgrounded after mount");
  assert.match(f.badge(), /app-segment__badge">…<\/span>/);
  f.dispose();
});

test("restored pending tab loads immediately and keeps exact loaded count", async () => {
  const f = await fixture({ tab: "pending" });
  assert.equal(f.calls.pending, 1);
  assert.equal(f.calls.orders, 1);
  assert.equal(f.pendingApi.pendingDeductionCount(), 2);
  assert.match(f.badge(), /app-segment__badge">2<\/span>/);
  f.dispose();
});

test("click pending loads snapshot and order links without delay", async () => {
  const f = await fixture();
  await f.emit("click");
  assert.equal(f.calls.pending, 1);
  assert.equal(f.calls.orders, 1);
  assert.equal(f.mounted.captureState().tab, "pending");
  assert.equal(f.pendingApi.pendingDeductionCount(), 2);
  f.dispose();
});

test("149ms hover does nothing; at 150ms only pending snapshot warms", async () => {
  const f = await fixture();
  await f.emit("pointerover");
  await f.tick(149);
  assert.equal(f.calls.pending, 0);
  await f.tick(1);
  assert.equal(f.calls.pending, 1);
  assert.equal(f.calls.orders, 0);
  assert.equal(f.pendingApi.pendingDeductionCount(), 2);
  await f.emit("click");
  assert.equal(f.calls.pending, 1, "click reuses hover result");
  assert.equal(f.calls.orders, 1);
  f.dispose();
});

test("leaving before threshold cancels; moving inside tab does not reset dwell", async () => {
  const f = await fixture();
  await f.emit("pointerover"); await f.tick(149);
  await f.emit("pointerout"); await f.tick(1000);
  assert.equal(f.calls.pending, 0);
  await f.emit("pointerover"); await f.tick(100);
  await f.emit("pointerout", { relatedTarget: f.child });
  await f.emit("pointerover", { target: f.child, relatedTarget: f.button });
  await f.tick(50);
  assert.equal(f.calls.pending, 1);
  f.dispose();
});

test("touch does not hover-prefetch and disposal cancels timers", async () => {
  const f = await fixture();
  await f.emit("pointerover", { pointerType: "touch" }); await f.tick(1000);
  assert.equal(f.calls.pending, 0);
  await f.emit("pointerover"); f.dispose(); await f.tick(1000);
  assert.equal(f.calls.pending, 0);
});

test("click shares in-flight hover request and disposal rejects late application", async () => {
  const request = deferred();
  const f = await fixture({ response: () => request.promise });
  await f.emit("pointerover"); await f.tick(150);
  const click = f.emit("click"); await settle();
  assert.equal(f.calls.pending, 1);
  f.dispose(); request.resolve({ invoices: [{ orderNo: "late" }] });
  await click;
  assert.equal(f.pendingApi.pendingDeductionCount(), null);
});

test("failed hover can retry on click and empty result replaces unknown count", async () => {
  let attempt = 0;
  const f = await fixture({ response: () => ++attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ invoices: [] }) });
  await f.emit("pointerover"); await f.tick(150);
  assert.equal(f.calls.warnings, 1);
  assert.equal(f.pendingApi.pendingDeductionCount(), null);
  await f.emit("click");
  assert.equal(f.calls.pending, 2);
  assert.equal(f.pendingApi.pendingDeductionCount(), 0);
  assert.doesNotMatch(f.badge(), /app-segment__badge/);
  f.dispose();
});

test("the gated pending snapshot owns the three full-table reads and no mount warmup remains", () => {
  assert.match(snapshots, /allRows\("invoices", "created_at", false\),\s*allRows\("customers", "name"\),\s*allRows\("inventory_movements", "created_at", false\)/);
  assert.doesNotMatch(inventory.slice(inventory.indexOf("export async function mountPage")), /animationFrame/);
  assert.match(inventory, /await ensureTabData\(state.tab, \{ scope, signal \}\)/);
});
