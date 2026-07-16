import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { createAppRouter, SPA_HISTORY_KEY } from "../root-site/spa/app-router.js";
import { createPageScope, mountPageModule, throwIfPageAborted } from "../root-site/spa/page-lifecycle.js";
import { routeManifest, spaNavigation, spaRouteAllowlist } from "../root-site/spa/route-manifest.js";
import { createDateFilter } from "../root-site/components/date-filter.js";
import { requireOcppRouteAccess } from "../root-site/bizflow/ocpp-shared.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commonStyles = new Set([
  "tokens/tokens.css",
  "tokens/base.css",
  "assets/icons/icons.css",
  "components/styles.css",
  "shell/shell.css"
]);
const expectedSpaRoutes = [
  "/bizflow/home.html",
  "/bizflow/ocpp-monitor.html",
  "/bizflow/ocpp-charging.html",
  "/bizflow/ocpp-users.html",
  "/bizflow/ocpp-finance.html",
  "/bizflow/customers.html",
  "/bizflow/customer-detail.html",
  "/bizflow/orders.html",
  "/bizflow/orders-create.html",
  "/bizflow/orders-detail.html",
  "/bizflow/inventory.html",
  "/bizflow/inventory-detail.html",
  "/bizflow/expense.html"
];

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
}

function rootRelative(file) {
  return path.relative(path.join(rootDir, "root-site"), file).split(path.sep).join("/");
}

async function verifyManifest() {
  const spaEntry = await readFile(path.join(rootDir, "root-site/spa/entry.js"), "utf8");
  assert.match(spaEntry, /url\.searchParams\.get\("tpSpa"\)\s*===\s*"0"/, "SPA entry must recognize one-shot document fallback mode");
  assert.match(spaEntry, /mountWithoutRouter\(\)/, "SPA entry must preserve a no-router MPA fallback");
  const routes = Object.values(routeManifest);
  assert.equal(routes.length, 16, "manifest must enumerate the 16 approved pages");
  assert.equal(spaNavigation, true, "SPA master switch must stay enabled");
  assert.deepEqual([...spaRouteAllowlist], expectedSpaRoutes, "SPA allowlist must contain the P1 sample and P2 customer routes");
  for (const route of routes) {
    const migrated = expectedSpaRoutes.includes(route.path);
    assert.ok(route.path.endsWith(".html"), `${route.path} must retain its .html URL`);
    assert.equal(typeof route.load, migrated ? "function" : "object", `${route.path} loader must match its rollout status`);
    const htmlFile = path.join(rootDir, "root-site", route.path);
    const html = await readFile(htmlFile, "utf8");
    const tags = [...html.matchAll(/<(?:link|script)\b[^>]*>/g)].map((match) => attributes(match[0]));
    const entry = tags.find((tag) => tag.type === "module" && tag.src)?.src;
    assert.ok(entry, `${route.path} must have one module entry`);
    const expectedEntry = migrated
      ? path.join(rootDir, "root-site/spa/entry.js")
      : fileURLToPath(route.entry);
    assert.equal(
      expectedEntry,
      path.resolve(path.dirname(htmlFile), entry),
      `${route.path} HTML entry must match its migration status`
    );
    if (migrated) {
      const source = await readFile(fileURLToPath(route.entry), "utf8");
      assert.match(source, /export\s+async\s+function\s+mountPage\s*\(/, `${route.path} must export mountPage()`);
      const module = await route.load();
      assert.equal(typeof module.mountPage, "function", `${route.path} loader must resolve its lifecycle controller without boot side effects`);
    }
    const actualStyles = tags
      .filter((tag) => tag.rel === "stylesheet" && tag.href)
      .map((tag) => path.resolve(path.dirname(htmlFile), tag.href))
      .filter((file) => !commonStyles.has(rootRelative(file)));
    assert.deepEqual(
      route.styles.map(fileURLToPath),
      actualStyles,
      `${route.path} route CSS must match HTML order exactly`
    );
  }
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      const values = listeners.get(type) ?? new Set();
      values.add(handler);
      listeners.set(type, values);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    }
  };
}

async function verifyLifecycle() {
  const target = eventTarget();
  let disposed = 0;
  const scope = createPageScope();
  scope.listen(target, "change", () => {});
  scope.track({ unsubscribe: () => disposed += 1 });
  assert.equal(target.listeners.get("change")?.size, 1);
  scope.dispose();
  scope.dispose();
  assert.equal(target.listeners.get("change")?.size, 0, "scope must remove listeners exactly once");
  assert.equal(disposed, 1, "scope must release tracked resources exactly once");

  let activated = 0;
  let customDisposed = 0;
  const mounted = await mountPageModule({
    async mountPage({ scope: pageScope }) {
      pageScope.listen(target, "page", () => {});
      return {
        page: { data: {}, render: () => "page" },
        activate: () => activated += 1,
        canLeave: ({ reason }) => reason !== "blocked",
        hasUnsavedChanges: () => true,
        captureState: () => ({ filter: "open" }),
        dispose: () => customDisposed += 1
      };
    }
  });
  await mounted.activate();
  await mounted.activate();
  assert.equal(activated, 1);
  assert.equal(await mounted.canLeave({ reason: "blocked" }), false);
  assert.deepEqual(mounted.captureState(), { filter: "open" });
  assert.equal(mounted.hasUnsavedChanges(), true);
  await mounted.dispose();
  await mounted.dispose();
  assert.equal(customDisposed, 1);
  assert.equal(target.listeners.get("page")?.size, 0);

  const aborted = new AbortController();
  aborted.abort();
  assert.throws(() => throwIfPageAborted(aborted.signal), { name: "AbortError" });

  const sourceFilter = createDateFilter({ initialDate: "2026-07-16" });
  sourceFilter.restoreState({ from: "2026-07-01", to: "2026-07-16", focus: "to", endDateEnabled: true, calendarMonth: "2026-07-01" });
  const restoredFilter = createDateFilter({ initialDate: "2026-07-16" });
  assert.equal(restoredFilter.restoreState(sourceFilter.captureState()), true);
  assert.deepEqual(restoredFilter.captureState(), sourceFilter.captureState(), "date filter history state must round-trip");
}

function verifyOcppGuard() {
  const calls = [];
  assert.throws(() => requireOcppRouteAccess({ hasPermission() {}, isBfAdmin: false }, {
    url: new URL("https://example.test/bizflow/ocpp-monitor.html"),
    navigation: { hardNavigate(url, options) { calls.push({ url: String(url), options }); } }
  }), { name: "AbortError" });
  assert.deepEqual(calls, [{
    url: "https://example.test/bizflow/home.html",
    options: { replace: true }
  }]);
}

function fakeBrowser(pathname = "/a.html") {
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  const assigned = [];
  const location = {
    href: `https://example.test${pathname}`,
    origin: "https://example.test",
    assign(value) {
      assigned.push(String(value));
      this.href = new URL(value, this.href).href;
    },
    replace(value) {
      assigned.push(String(value));
      this.href = new URL(value, this.href).href;
    }
  };
  const history = {
    state: null,
    writes: 0,
    replaceState(state, _title, url) {
      this.state = state;
      this.writes += 1;
      location.href = new URL(url, location.href).href;
    },
    pushState(state, _title, url) {
      this.state = state;
      this.writes += 1;
      location.href = new URL(url, location.href).href;
    },
    go() {}
  };
  const windowRef = {
    ...windowTarget,
    location,
    history,
    scrollX: 0,
    scrollY: 0,
    scrollTo() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout
  };
  const documentRef = { ...documentTarget };
  return { windowRef, documentRef, assigned, history };
}

async function verifyRouter() {
  const idle = fakeBrowser();
  const idleStyles = { adopt() {}, prepare() { throw new Error("inactive router loaded CSS"); }, dispose() {} };
  const idleRouter = createAppRouter({
    shell: { setPage() { throw new Error("inactive router rendered a page"); } },
    manifest: {},
    allowlist: [],
    windowRef: idle.windowRef,
    documentRef: idle.documentRef,
    styleManager: idleStyles
  });
  assert.equal(idleRouter.enabled, false);
  assert.equal(await idleRouter.start(), false);
  assert.equal(idle.history.writes, 0, "empty allowlist must not touch history");
  assert.equal(idle.windowRef.listeners.size, 0, "empty allowlist must not attach window listeners");
  assert.equal(idle.documentRef.listeners.size, 0, "empty allowlist must not attach document listeners");

  const browser = fakeBrowser();
  const pages = [];
  const routeTarget = eventTarget();
  let allowLeave = true;
  let styleCommits = 0;
  const makeModule = (name) => ({
    async mountPage({ scope }) {
      scope.listen(routeTarget, "route", () => {});
      return {
        page: { data: { name }, render: () => name },
        canLeave: () => allowLeave,
        captureState: () => ({ name })
      };
    }
  });
  const manifest = {
    "/a.html": { path: "/a.html", section: "bizflow", styles: ["a.css"], load: async () => makeModule("a") },
    "/b.html": { path: "/b.html", section: "bizflow", styles: ["b.css"], load: async () => makeModule("b") },
    "/fail.html": { path: "/fail.html", section: "bizflow", styles: [], load: async () => { throw new Error("expected"); } }
  };
  const router = createAppRouter({
    shell: { setPage(page) { pages.push(page.data.name); } },
    manifest,
    allowlist: Object.keys(manifest),
    windowRef: browser.windowRef,
    documentRef: browser.documentRef,
    styleManager: {
      adopt() {},
      async prepare() {
        return { commit: () => styleCommits += 1, rollback() {} };
      },
      dispose() {}
    }
  });
  assert.equal(await router.start(), true);
  assert.deepEqual(pages, ["a"]);
  assert.equal(routeTarget.listeners.get("route")?.size, 1);
  router.savePageState({ filter: "open" });
  assert.deepEqual(browser.history.state[SPA_HISTORY_KEY].pageState, { filter: "open" });
  allowLeave = false;
  assert.equal(await router.navigate("/b.html"), false, "canLeave must block SPA navigation");
  assert.deepEqual(pages, ["a"]);
  allowLeave = true;
  assert.equal(await router.navigate("/b.html"), true);
  assert.deepEqual(pages, ["a", "b"]);
  for (let index = 0; index < 30; index += 1) {
    const path = index % 2 === 0 ? "/a.html" : "/b.html";
    assert.equal(await router.navigate(path), true);
    assert.equal(routeTarget.listeners.get("route")?.size, 1, `route listener watermark drifted on cycle ${index + 1}`);
  }
  assert.equal(styleCommits, 32);
  allowLeave = false;
  assert.equal(await router.navigate("/legacy.html"), false, "canLeave must guard fallback MPA routes");
  assert.equal(browser.assigned.length, 0);
  allowLeave = true;
  assert.equal(await router.navigate("/legacy.html"), false);
  assert.equal(browser.assigned.at(-1), "https://example.test/legacy.html");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values);
  try {
    assert.equal(await router.navigate("/fail.html"), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "route failure must emit one observable warning");
  assert.equal(browser.assigned.at(-1), "https://example.test/fail.html?tpSpa=0", "route failure must hard navigate to one-shot MPA mode");
  await router.dispose();
  assert.equal(browser.windowRef.listeners.get("popstate")?.size ?? 0, 0);
  assert.equal(routeTarget.listeners.get("route")?.size ?? 0, 0);
}

async function verifyShellAdapter() {
  const source = await readFile(path.join(rootDir, "root-site/shell/shell.js"), "utf8");
  assert.match(source, /export function setPage\(/, "shell must expose setPage");
  const adapterEnd = source.indexOf("let menuSource =");
  const legacyReads = [...source.matchAll(/window\.__shell(?:Menu|Data|Content)/g)];
  assert.deepEqual(
    [...new Set(legacyReads.map((match) => match[0]))].sort(),
    ["window.__shellContent", "window.__shellData", "window.__shellMenu"],
    "startup adapter must cover all three legacy globals"
  );
  assert.ok(legacyReads.every((match) => match.index < adapterEnd), "legacy globals must not be read after startup adaptation");
}

await verifyManifest();
await verifyLifecycle();
verifyOcppGuard();
await verifyRouter();
await verifyShellAdapter();
console.log("SPA rollout contracts: PASS (13 migrated routes, 3 MPA routes, 30-cycle lifecycle, fallback, shell adapter)");
