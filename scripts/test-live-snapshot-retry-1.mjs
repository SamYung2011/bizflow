import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import {
  LIVE_SNAPSHOT_REFRESH_RETRY_WINDOWS_MS,
  retryLiveSnapshotRefresh
} from "../root-site/data/live-snapshot-retry.js";

let builds = 0;
const delays = [];
const retries = [];
const refreshed = await retryLiveSnapshotRefresh(async () => {
  builds += 1;
  if (builds === 1) throw new Error("invoices: Timed out acquiring connection from connection pool");
  return { customers: [{ id: "customer-new", name: "New customer" }] };
}, {
  random: () => 0,
  sleep: async (delay) => { delays.push(delay); },
  onRetry: (retry) => { retries.push(retry); }
});

assert.equal(builds, 2, "a transient snapshot-builder failure must be retried");
assert.deepEqual(delays, [500], "the first retry must wait at least 500ms before trying the busy pool again");
assert.equal(retries.length, 1);
assert.equal(refreshed.customers.some((customer) => customer.id === "customer-new"), true,
  "the successful retry must expose the newly-created customer to the page payload");

let failedBuilds = 0;
const exhaustedDelays = [];
await assert.rejects(
  retryLiveSnapshotRefresh(async () => {
    failedBuilds += 1;
    throw new Error("pool still busy");
  }, {
    random: () => 1,
    sleep: async (delay) => { exhaustedDelays.push(delay); }
  }),
  /pool still busy/
);
assert.equal(failedBuilds, LIVE_SNAPSHOT_REFRESH_RETRY_WINDOWS_MS.length + 1,
  "refresh retry must stop after the configured finite attempt count");
assert.deepEqual(exhaustedDelays, [1500, 4000],
  "both retries must stay inside the approved jitter windows");

let retryAllowed = true;
let cancelledBuilds = 0;
await assert.rejects(
  retryLiveSnapshotRefresh(async () => {
    cancelledBuilds += 1;
    throw new Error("refresh invalidated while asleep");
  }, {
    delays: [1],
    shouldRetry: () => retryAllowed,
    sleep: async () => { retryAllowed = false; }
  }),
  /refresh invalidated while asleep/
);
assert.equal(cancelledBuilds, 1,
  "an invalidated refresh chain must re-check ownership after sleeping and skip the next full rebuild");

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
}

const snapshotHarness = {
  cacheAvailable: true,
  buildCalls: 0,
  async buildSimpleRowsSnapshot() {
    this.buildCalls += 1;
    if (this.buildCalls <= 3) throw new Error("invoices: Timed out acquiring connection from connection pool");
    return { leads: [{ id: "customer-new", name: "New customer" }] };
  },
  async readLiveSnapshotCache() {
    return this.cacheAvailable
      ? { stale: true, value: { leads: [{ id: "customer-old", name: "Old customer" }] } }
      : null;
  }
};

const entryPath = fileURLToPath(new URL("../root-site/data/live-snapshots.js", import.meta.url));
const stubSources = new Map([
  ["auth.js", `
    export const RBAC_KEYS = [];
    export async function getCurrentUser() { return { activeCompanyId: "" }; }
  `],
  ["live-admin-snapshots.js", `
    export const buildAliasesSnapshot = async () => ({});
    export const buildExpenseSnapshot = async () => ({});
    export const buildNorthboundSnapshot = async () => ({});
    export const buildShopifyLinksSnapshot = async () => ({});
    export const buildWhatsappSnapshot = async () => ({});
    export const buildSimpleRowsSnapshot = (...args) => globalThis.__liveSnapshotRetryHarness.buildSimpleRowsSnapshot(...args);
  `],
  ["live-inventory-snapshot.js", `export const buildInventorySnapshot = async () => ({});`],
  ["live-table-cache.js", `
    export const invalidateLiveSnapshotCache = async () => {};
    export const liveSnapshotCacheVersion = () => 1;
    export const readLiveSnapshotCache = (...args) => globalThis.__liveSnapshotRetryHarness.readLiveSnapshotCache(...args);
    export const writeLiveSnapshotCache = async () => true;
  `],
  ["live-snapshot-dependencies.js", `
    export const isCompanyScopedSnapshot = () => false;
    export const LIVE_SNAPSHOT_INVALIDATED_EVENT = "tp:live-snapshot-invalidated";
    export const LIVE_SNAPSHOT_UPDATED_EVENT = "tp:live-snapshot-updated";
  `],
  ["live-realtime.js", `export const ensureLiveRealtime = async () => {};`],
  ["provider-snapshot-cache.js", `
    export const clearProviderSnapshotMemo = () => {};
    export const invalidateProviderSnapshotMemo = () => {};
    export const updateProviderSnapshotMemo = () => {};
  `],
  ["customer-groups.js", `export const buildCustomerGroups = () => ({ groups: [], idToGroup: new Map() });`],
  ["customer-source.js", `export const customerSourceFromInvoices = () => "";`],
  ["live-snapshot-utils.js", `
    export const allRows = async () => [];
    export const asArray = (value) => Array.isArray(value) ? value : [];
    export const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    export const asText = (value, fallback = "") => value == null ? fallback : String(value);
    export const dateParts = () => null;
    export const ensureLiveSession = async () => ({ user: { id: "test-user" } });
    export const formatDate = () => "";
    export const formatDateTime = () => "";
    export const formatMonthDay = () => "";
    export const formatTime = () => "";
    export const timestamp = () => 0;
    export const withFreshLiveTableReads = (operation) => operation();
  `]
]);

const bundled = await build({
  bundle: true,
  entryPoints: [entryPath],
  format: "esm",
  platform: "node",
  write: false,
  plugins: [{
    name: "live-snapshot-retry-harness",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^\.\// }, (args) => {
        const name = args.path.slice(2);
        if (name === "live-snapshot-retry.js" || !stubSources.has(name)) return null;
        return { path: name, namespace: "snapshot-stub" };
      });
      esbuild.onLoad({ filter: /.*/, namespace: "snapshot-stub" }, (args) => ({
        contents: stubSources.get(args.path),
        loader: "js"
      }));
      esbuild.onLoad({ filter: /live-snapshots\.js$/ }, async (args) => ({
        contents: `${await readFile(args.path, "utf8")}\nexport const __testLiveRefreshPending = (snapshot) => LIVE_REFRESH_PENDING.has(snapshot);`,
        loader: "js"
      }));
    }
  }]
});

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const originalHarness = globalThis.__liveSnapshotRetryHarness;
const originalSetTimeout = globalThis.setTimeout;
const originalWarn = console.warn;
const fakeWindow = new FakeWindow();
globalThis.window = fakeWindow;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
};
globalThis.__liveSnapshotRetryHarness = snapshotHarness;

try {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
  const snapshots = await import(moduleUrl);
  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };

  let pendingResolve;
  const pending = new Promise((resolve) => { pendingResolve = resolve; });
  console.warn = (message) => {
    if (String(message).includes("pending retry")) pendingResolve();
  };

  const cached = await snapshots.getLiveSnapshot("charger-leads.json");
  assert.equal(cached.leads[0].id, "customer-old");
  await pending;
  assert.equal(snapshotHarness.buildCalls, 3, "the stale background refresh must exhaust its finite retry chain");
  assert.equal(snapshots.__testLiveRefreshPending("charger-leads.json"), true,
    "an exhausted background refresh must leave a pending retry marker");

  snapshotHarness.cacheAvailable = false;
  fakeWindow.dispatchEvent({
    type: "tp:live-snapshot-invalidated",
    detail: { snapshots: ["charger-leads.json"], source: "write" }
  });
  assert.equal(snapshots.__testLiveRefreshPending("charger-leads.json"), false,
    "a write/realtime invalidation event must clear the exhausted pending marker");

  const rebuilt = await snapshots.getLiveSnapshot("charger-leads.json");
  const deduped = await snapshots.getLiveSnapshot("charger-leads.json");
  assert.equal(rebuilt.leads[0].id, "customer-new",
    "the first read after invalidation must retrigger the builder and expose the new customer");
  assert.equal(deduped.leads[0].id, "customer-new");
  assert.equal(snapshotHarness.buildCalls, 4,
    "the consumed marker must stay cleared so the next component read reuses the successful build");
  assert.equal(snapshots.__testLiveRefreshPending("charger-leads.json"), false,
    "a successful retrigger must finish without a pending marker");
} finally {
  console.warn = originalWarn;
  globalThis.setTimeout = originalSetTimeout;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = originalCustomEvent;
  if (originalHarness === undefined) delete globalThis.__liveSnapshotRetryHarness;
  else globalThis.__liveSnapshotRetryHarness = originalHarness;
}

console.log("live-snapshot-retry-1 contracts: PASS (jittered retry, wake-up cancel, pending event lifecycle)");
