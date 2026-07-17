import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { createAppRouter, SPA_HISTORY_KEY } from "../root-site/spa/app-router.js";
import { createPageScope, mountPageModule, throwIfPageAborted } from "../root-site/spa/page-lifecycle.js";
import { routeManifest, spaCrossSectionNavigation, spaNavigation, spaRouteAllowlist } from "../root-site/spa/route-manifest.js";
import { createRouteFrame, createRouteMenu } from "../root-site/spa/route-menu.js";
import { invalidateProviderSnapshotMemo, loadProviderSnapshot } from "../root-site/data/provider-snapshot-cache.js";
import { snapshotsForTables } from "../root-site/data/live-snapshot-dependencies.js";
import { createDateFilter } from "../root-site/components/date-filter.js";
import { requireOcppRouteAccess } from "../root-site/bizflow/ocpp-shared.js";
import { whatsappCopy } from "../root-site/bizflow/whatsapp-i18n.js";

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
  "/bizflow/expense.html",
  "/bizflow/whatsapp.html",
  "/team/index.html",
  "/team/members.html"
];

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
}

function rootRelative(file) {
  return path.relative(path.join(rootDir, "root-site"), file).split(path.sep).join("/");
}

async function verifyManifest() {
  const vercelConfig = JSON.parse(await readFile(path.join(rootDir, "vercel.json"), "utf8"));
  const cacheHeaders = vercelConfig.headers.flatMap((rule) => rule.headers.map((header) => ({ source: rule.source, ...header })));
  assert.equal(
    cacheHeaders.find(({ source, key }) => source === "/(.*)" && key === "Cache-Control")?.value,
    "public, max-age=0, must-revalidate",
    "HTML, JS and CSS routes must revalidate instead of serving stale releases"
  );
  assert.equal(
    cacheHeaders.some(({ value }) => String(value).includes("stale-while-revalidate")),
    false,
    "deployment cache headers must not serve a previous release while revalidating"
  );
  const spaEntry = await readFile(path.join(rootDir, "root-site/spa/entry.js"), "utf8");
  assert.match(spaEntry, /url\.searchParams\.get\("tpSpa"\)\s*===\s*"0"/, "SPA entry must recognize one-shot document fallback mode");
  assert.match(spaEntry, /mountWithoutRouter\(\)/, "SPA entry must preserve a no-router MPA fallback");
  const routes = Object.values(routeManifest);
  assert.equal(routes.length, 16, "manifest must enumerate the 16 approved pages");
  assert.equal(spaNavigation, true, "SPA master switch must stay enabled");
  assert.equal(spaCrossSectionNavigation, true, "P6 must enable same-document Bizflow/Team navigation");
  assert.deepEqual([...spaRouteAllowlist], expectedSpaRoutes, "SPA allowlist must contain all 16 routes");
  const bizflowFallbackMenu = createRouteMenu("/bizflow/orders-detail.html");
  assert.equal(bizflowFallbackMenu.length, 10, "Bizflow loading shell must expose the complete formal menu");
  assert.equal(bizflowFallbackMenu.find((item) => item.active)?.key, "nav.orders", "detail routes must highlight their owning domain");
  assert.ok(bizflowFallbackMenu.every((item) => routeManifest[item.href]), "Bizflow loading menu links must resolve to manifest routes");
  assert.equal(bizflowFallbackMenu.filter((item) => item.adminOnly).length, 4, "loading menu must preserve the OCPP admin gate");
  const teamFallbackMenu = createRouteMenu("/team/members.html");
  assert.deepEqual(teamFallbackMenu.map((item) => item.href), ["/team/index.html", "/team/members.html"]);
  assert.equal(teamFallbackMenu.find((item) => item.active)?.key, "nav.team");
  assert.equal(createRouteFrame("/bizflow/ocpp-monitor.html").access, "bf-admin", "OCPP frames must carry the pre-render admin gate");
  assert.equal(createRouteFrame("/bizflow/orders.html").access, "default");
  for (const route of routes) {
    const migrated = expectedSpaRoutes.includes(route.path);
    assert.ok(route.path.endsWith(".html"), `${route.path} must retain its .html URL`);
    assert.deepEqual(route.frame, createRouteFrame(route.path), `${route.path} must use shared frame metadata`);
    assert.ok(route.frame.title && route.frame.skeleton?.kind, `${route.path} must declare a title and skeleton`);
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
    const preloads = tags
      .filter((tag) => tag.rel === "modulepreload" && tag.href)
      .map((tag) => path.resolve(path.dirname(htmlFile), tag.href));
    assert.deepEqual(preloads, [
      path.join(rootDir, "root-site/spa/entry.js"),
      fileURLToPath(route.entry),
      path.join(rootDir, "root-site/vendor/supabase-js.esm.js")
    ], `${route.path} must keep only the P6 SPA entry, route module and Supabase preload`);
    if (migrated) {
      const source = await readFile(fileURLToPath(route.entry), "utf8");
      assert.match(source, /export\s+async\s+function\s+mountPage\s*\(/, `${route.path} must export mountPage()`);
      assert.match(source, /throwIfPageAborted\(signal, scope\)/, `${route.path} mount must validate its route generation`);
      assert.doesNotMatch(
        source,
        /^\s*\[[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)+\]\s*=\s*await\s+Promise\.all/m,
        `${route.path} must not assign async mount results to module globals before its generation guard`
      );
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
  for (const [file, fallback] of [
    ["bizflow/orders-detail.js", "./orders.html"],
    ["bizflow/customer-detail.js", "./customers.html"],
    ["bizflow/inventory-detail.js", "./inventory.html"]
  ]) {
    const source = await readFile(path.join(rootDir, "root-site", file), "utf8");
    assert.match(source, new RegExp(`data-spa-back=["']${fallback.replace(".", "\\.")}["']`), `${file} breadcrumb must use smart list return`);
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

function testFrame(name, access = "default") {
  return { menu: [], title: name, skeleton: { kind: "table", stats: 0 }, access };
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

  let currentGeneration = 1;
  const guardedScope = createPageScope(null, () => currentGeneration === 1);
  let guardedCommits = 0;
  const guardedTarget = eventTarget();
  let guardedEvents = 0;
  guardedScope.listen(guardedTarget, "change", () => guardedEvents += 1);
  assert.equal(guardedScope.commit(() => guardedCommits += 1), true);
  [...guardedTarget.listeners.get("change")][0]({ type: "change" });
  currentGeneration = 2;
  assert.equal(guardedScope.commit(() => guardedCommits += 1), false, "superseded page scopes must reject late commits");
  assert.equal(guardedCommits, 1);
  [...guardedTarget.listeners.get("change")][0]({ type: "change" });
  assert.equal(guardedEvents, 1, "superseded page scopes must ignore late events before disposal completes");
  assert.throws(() => throwIfPageAborted(null, guardedScope), { name: "AbortError" });
  guardedScope.dispose();

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

async function verifyRouteGenerationRace() {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const browser = fakeBrowser();
    let firstScope = null;
    let releaseSecond = null;
    let secondStarted = null;
    const secondStart = new Promise((resolve) => { secondStarted = resolve; });
    const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
    const manifest = {
      "/a.html": {
        path: "/a.html", section: "bizflow", styles: [], frame: testFrame("a"),
        load: async () => ({
          async mountPage({ scope }) {
            firstScope = scope;
            return { page: { data: {}, render: () => "a" } };
          }
        })
      },
      "/b.html": {
        path: "/b.html", section: "bizflow", styles: [], frame: testFrame("b"),
        load: async () => ({
          async mountPage() {
            secondStarted();
            await secondGate;
            return { page: { data: {}, render: () => "b" } };
          }
        })
      }
    };
    const router = createAppRouter({
      shell: { setLoadingPage() {}, setPage() {} },
      manifest,
      allowlist: Object.keys(manifest),
      windowRef: browser.windowRef,
      documentRef: browser.documentRef,
      styleManager: {
        adopt() {},
        async prepare() { return { commit() {}, rollback() {} }; },
        dispose() {}
      }
    });
    assert.equal(await router.start(), true);
    const navigation = router.navigate("/b.html");
    await secondStart;
    await new Promise((resolve) => setTimeout(resolve, 200 + (iteration % 4) * 100));
    let staleCommit = false;
    assert.equal(firstScope.commit(() => { staleCommit = true; }), false, `old route must reject delayed commit in cycle ${iteration + 1}`);
    assert.equal(staleCommit, false);
    releaseSecond();
    assert.equal(await navigation, true);
    await router.dispose();
  }
}

async function verifyDataRaceGuards() {
  const auth = await readFile(path.join(rootDir, "root-site/data/auth.js"), "utf8");
  const snapshotUtils = await readFile(path.join(rootDir, "root-site/data/live-snapshot-utils.js"), "utf8");
  const snapshots = await readFile(path.join(rootDir, "root-site/data/live-snapshots.js"), "utf8");
  const provider = await readFile(path.join(rootDir, "root-site/data/provider.js"), "utf8");
  const expenseWrites = await readFile(path.join(rootDir, "root-site/data/live-expense-writes.js"), "utf8");
  assert.match(auth, /secondaryOrder \|\| ""\}:\$\{cacheVersion\}/, "table in-flight keys must include the invalidation generation");
  assert.match(snapshotUtils, /freshTablePromises\.get\(key\) === promise/, "fresh table requests must clear only their own generation");
  assert.match(snapshotUtils, /freshTablePromises\.keys\(\)/, "table invalidation must evict fresh in-flight reuse keys");
  assert.match(snapshots, /LIVE_REFRESHES\.get\(snapshot\) === promise/, "snapshot refreshes must clear only their own generation");
  assert.match(snapshots, /invalidateProviderSnapshotMemo\(snapshots\)/, "snapshot invalidation events must clear provider memos");
  assert.match(snapshots, /updateProviderSnapshotMemo\(snapshot, value\)/, "background refreshes must replace provider memos");
  assert.doesNotMatch(provider, /let\s+\w*SnapshotPromise\s*=|r11SnapshotPromises/, "provider must not retain untracked snapshot promises");
  assert.match(provider, /loadProviderSnapshot\(/, "provider snapshots must use the invalidation-aware memo");
  assert.match(expenseWrites, /invalidateLiveTables\("expense_reimbursements"\)/, "expense writes must invalidate their table cache");

  const expectedDependencies = {
    northbound_records: ["northbound.json"],
    northbound_statuses: ["northbound.json"],
    employee_tasks: ["tasks.json", "home.json", "members.json"],
    task_assignees: ["tasks.json", "home.json", "members.json"],
    employee_task_feedbacks: ["tasks.json", "home.json"],
    invoices: ["orders.json", "customers.json", "warranty.json", "home.json", "home-order-metrics.json", "pending-deduction.json"],
    customers: ["customers.json", "warranty.json", "orders.json", "home.json", "home-order-metrics.json", "pending-deduction.json"],
    customer_devices: ["customers.json", "warranty.json", "home.json"],
    products: ["inventory.json", "warranty.json", "home.json"],
    warehouses: ["inventory.json", "home.json"],
    inventory_stock: ["inventory.json", "home.json"],
    expense_reimbursements: ["expense.json"]
  };
  Object.entries(expectedDependencies).forEach(([table, required]) => {
    const actual = snapshotsForTables(new Set([table]));
    required.forEach((snapshot) => assert.ok(actual.has(snapshot), `${table} invalidation must reach ${snapshot}`));
  });
}

async function verifyWriteInvalidateRemount() {
  const snapshot = "spa-write-remount-contract.json";
  let rows = [{ id: "before" }];
  let reads = 0;
  const readRows = () => loadProviderSnapshot(snapshot, async () => {
    reads += 1;
    return rows.map((row) => ({ ...row }));
  });

  invalidateProviderSnapshotMemo(snapshot);
  const firstScope = createPageScope();
  assert.deepEqual(await readRows(), [{ id: "before" }]);
  rows = [{ id: "after-create" }, { id: "before" }];
  invalidateProviderSnapshotMemo(snapshot);
  firstScope.dispose();

  const remountScope = createPageScope();
  const remounted = await readRows();
  assert.equal(remountScope.commit(() => {}), true);
  assert.deepEqual(remounted.map((row) => row.id), ["after-create", "before"], "first remount after write invalidation must read the new value");
  assert.equal(reads, 2, "write invalidation must force exactly one new provider read");
  remountScope.dispose();

  const delayedSnapshot = "spa-write-inflight-contract.json";
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  invalidateProviderSnapshotMemo(delayedSnapshot);
  const oldRead = loadProviderSnapshot(delayedSnapshot, async () => {
    await oldGate;
    return [{ id: "stale" }];
  });
  invalidateProviderSnapshotMemo(delayedSnapshot);
  const freshRead = loadProviderSnapshot(delayedSnapshot, async () => [{ id: "fresh" }]);
  releaseOld();
  assert.deepEqual(await freshRead, [{ id: "fresh" }]);
  assert.deepEqual(await oldRead, [{ id: "stale" }]);
  assert.deepEqual(await loadProviderSnapshot(delayedSnapshot, async () => [{ id: "wrong" }]), [{ id: "fresh" }], "late pre-invalidation promise must not replace the fresh memo");
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

function verifyWhatsappI18n() {
  const reference = Object.keys(whatsappCopy.zh).sort();
  assert.ok(reference.includes("leaveUnsaved"), "WhatsApp must translate the SPA leave guard");
  for (const lang of ["en", "fr"]) {
    assert.deepEqual(Object.keys(whatsappCopy[lang]).sort(), reference, `WhatsApp ${lang} dictionary must match zh`);
  }
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
    backCalls: 0,
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
    back() {
      this.backCalls += 1;
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
    shell: {
      setLoadingPage() { throw new Error("inactive router rendered a frame"); },
      setPage() { throw new Error("inactive router rendered a page"); }
    },
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
  browser.documentRef.startViewTransition = (update) => {
    update();
    return {
      updateCallbackDone: Promise.resolve(),
      ready: Promise.reject(new DOMException("superseded", "InvalidStateError")),
      finished: Promise.reject(new DOMException("superseded", "AbortError"))
    };
  };
  const transitionUnhandled = [];
  const onTransitionUnhandled = (error) => transitionUnhandled.push(error);
  process.on("unhandledRejection", onTransitionUnhandled);
  const frames = [];
  const pages = [];
  const routeTarget = eventTarget();
  let allowLeave = true;
  let styleCommits = 0;
  let styleEnsures = 0;
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
    "/a.html": { path: "/a.html", section: "bizflow", styles: ["a.css"], frame: testFrame("a"), load: async () => makeModule("a") },
    "/b.html": { path: "/b.html", section: "bizflow", styles: ["b.css"], frame: testFrame("b"), load: async () => makeModule("b") },
    "/team.html": { path: "/team.html", section: "team", styles: ["team.css"], frame: testFrame("team"), load: async () => makeModule("team") },
    "/fail.html": { path: "/fail.html", section: "bizflow", styles: [], frame: testFrame("fail"), load: async () => { throw new Error("expected"); } },
    "/mount-fail.html": {
      path: "/mount-fail.html", section: "bizflow", styles: [], frame: testFrame("mount-fail"),
      load: async () => ({ async mountPage() { throw new Error("expected mount failure"); } })
    },
    "/admin.html": {
      path: "/admin.html", section: "bizflow", styles: [], frame: testFrame("admin", "bf-admin"),
      load: async () => { throw new Error("denied route assets must not load"); }
    }
  };
  const router = createAppRouter({
    shell: {
      setLoadingPage(frame) { frames.push(frame.title); },
      setPage(page) { pages.push(page.data.name); },
      getCurrentShellUser() { return { hasPermission() {}, isBfAdmin: false }; }
    },
    manifest,
    allowlist: Object.keys(manifest),
    windowRef: browser.windowRef,
    documentRef: browser.documentRef,
    styleManager: {
      adopt() {},
      async prepare() {
        return {
          commit: () => styleCommits += 1,
          ensureActive: () => styleEnsures += 1,
          rollback() {}
        };
      },
      dispose() {}
    }
  });
  assert.equal(await router.start(), true);
  assert.deepEqual(frames, ["a"], "initial route must commit its frame before page data");
  assert.deepEqual(pages, ["a"]);
  assert.equal(routeTarget.listeners.get("route")?.size, 1);
  router.savePageState({ filter: "open" });
  assert.deepEqual(browser.history.state[SPA_HISTORY_KEY].pageState, { filter: "open" });
  allowLeave = false;
  assert.equal(await router.navigate("/b.html"), false, "canLeave must block SPA navigation");
  assert.deepEqual(frames, ["a"], "blocked navigation must not commit a frame");
  assert.deepEqual(pages, ["a"]);
  allowLeave = true;
  assert.equal(await router.navigate("/b.html"), true);
  assert.deepEqual(frames.slice(0, 2), ["a", "b"]);
  assert.deepEqual(pages, ["a", "b"]);
  assert.equal(await router.navigate("/team.html"), true, "P6 must navigate across Bizflow and Team in one document");
  assert.equal(await router.navigate("/a.html"), true);
  assert.deepEqual(pages, ["a", "b", "team", "a"]);
  for (let index = 0; index < 30; index += 1) {
    const path = index % 2 === 0 ? "/a.html" : "/b.html";
    assert.equal(await router.navigate(path), true);
    assert.equal(routeTarget.listeners.get("route")?.size, 1, `route listener watermark drifted on cycle ${index + 1}`);
  }
  assert.equal(styleCommits, 33);
  assert.equal(styleEnsures, styleCommits, "each committed controller must verify its route styles");
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
  warnings.length = 0;
  console.warn = (...values) => warnings.push(values);
  try {
    assert.equal(await router.navigate("/mount-fail.html"), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(frames.at(-1), "mount-fail", "failed data mount must occur after the target frame is visible");
  assert.equal(pages.at(-1), "b", "failed data mount must not commit a page controller");
  assert.equal(warnings.length, 1, "failed data mount must remain observable");
  assert.equal(browser.assigned.at(-1), "https://example.test/mount-fail.html?tpSpa=0");
  const frameCountBeforeDeniedRoute = frames.length;
  assert.equal(await router.navigate("/admin.html"), false);
  assert.equal(frames.length, frameCountBeforeDeniedRoute, "denied OCPP-style routes must not flash a loading frame");
  assert.equal(browser.assigned.at(-1), "https://example.test/bizflow/home.html");
  await router.dispose();
  assert.equal(browser.windowRef.listeners.get("popstate")?.size ?? 0, 0);
  assert.equal(routeTarget.listeners.get("route")?.size ?? 0, 0);
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onTransitionUnhandled);
  assert.deepEqual(transitionUnhandled, [], "aborted view-transition promises must never be unhandled");
}

async function verifyFrameHistoryNavigation() {
  const browser = fakeBrowser("/a.html");
  const frames = [];
  const pages = [];
  const restoredStates = [];
  const scrolls = [];
  browser.windowRef.scrollTo = (x, y) => scrolls.push({ x, y });
  const makeModule = (name, captureState) => ({
    async mountPage({ historyState }) {
      restoredStates.push({ name, historyState });
      return {
        page: { data: { name }, render: () => name },
        captureState
      };
    }
  });
  const manifest = {
    "/a.html": {
      path: "/a.html", section: "bizflow", styles: [], frame: testFrame("a"),
      load: async () => makeModule("a", () => ({ filter: "open" }))
    },
    "/b.html": {
      path: "/b.html", section: "bizflow", styles: [], frame: testFrame("b"),
      load: async () => makeModule("b", () => ({ filter: "closed" }))
    }
  };
  const router = createAppRouter({
    shell: {
      setLoadingPage(frame) { frames.push(frame.title); },
      setPage(page) { pages.push(page.data.name); }
    },
    manifest,
    allowlist: Object.keys(manifest),
    windowRef: browser.windowRef,
    documentRef: browser.documentRef,
    styleManager: {
      adopt() {},
      async prepare() { return { commit() {}, rollback() {} }; },
      dispose() {}
    }
  });
  assert.equal(await router.start(), true);
  browser.windowRef.scrollY = 381;
  router.savePageState({ filter: "open" });
  const stateA = structuredClone(browser.history.state);
  assert.equal(await router.navigate("/b.html"), true);
  const stateB = structuredClone(browser.history.state);

  browser.windowRef.location.href = "https://example.test/a.html";
  browser.history.state = stateA;
  await [...browser.windowRef.listeners.get("popstate")][0]({ state: stateA });
  assert.deepEqual(restoredStates.at(-1), { name: "a", historyState: { filter: "open" } });
  assert.deepEqual(scrolls.at(-1), { x: 0, y: 381 });

  browser.windowRef.location.href = "https://example.test/b.html";
  browser.history.state = stateB;
  await [...browser.windowRef.listeners.get("popstate")][0]({ state: stateB });
  assert.deepEqual(frames, ["a", "b", "a", "b"], "Back/Forward must commit the matching frame before each controller");
  assert.deepEqual(pages, ["a", "b", "a", "b"]);
  await router.dispose();
}

async function verifySmartBackNavigation() {
  function manifestFor(restoredStates) {
    const moduleFor = (name) => ({
      async mountPage({ historyState }) {
        restoredStates.push({ name, historyState });
        return {
          page: { data: { name }, render: () => name },
          captureState: () => name === "list" ? { page: 52 } : null
        };
      }
    });
    return Object.fromEntries(["list", "detail-a", "detail-b"].map((name) => [
      `/${name}.html`,
      {
        path: `/${name}.html`,
        section: "bizflow",
        styles: [],
        frame: testFrame(name),
        load: async () => moduleFor(name)
      }
    ]));
  }

  function routerFor(browser, restoredStates, scrolls = []) {
    browser.windowRef.scrollTo = (x, y) => scrolls.push({ x, y });
    const manifest = manifestFor(restoredStates);
    return createAppRouter({
      shell: { setLoadingPage() {}, setPage() {} },
      manifest,
      allowlist: Object.keys(manifest),
      windowRef: browser.windowRef,
      documentRef: browser.documentRef,
      styleManager: {
        adopt() {},
        async prepare() { return { commit() {}, rollback() {} }; },
        dispose() {}
      }
    });
  }

  const browser = fakeBrowser("/list.html");
  const restoredStates = [];
  const scrolls = [];
  const router = routerFor(browser, restoredStates, scrolls);
  assert.equal(await router.start(), true);
  browser.windowRef.scrollY = 681;
  router.savePageState({ page: 52 });
  const listState = structuredClone(browser.history.state);
  assert.equal(await router.navigate("/detail-a.html?id=a"), true);
  assert.deepEqual(browser.history.state[SPA_HISTORY_KEY].previous, { index: 0, path: "/list.html" });
  assert.equal(await router.navigateBack("/list.html"), true);
  assert.equal(browser.history.backCalls, 1, "matching list history must use history.back()");
  browser.windowRef.location.href = "https://example.test/list.html";
  browser.history.state = listState;
  await [...browser.windowRef.listeners.get("popstate")][0]({ state: listState });
  assert.deepEqual(restoredStates.at(-1), { name: "list", historyState: { page: 52 } });
  assert.deepEqual(scrolls.at(-1), { x: 0, y: 681 }, "smart back must restore list scroll");
  await router.dispose();

  const directBrowser = fakeBrowser("/detail-a.html?id=a");
  const directStates = [];
  const directRouter = routerFor(directBrowser, directStates);
  assert.equal(await directRouter.start(), true);
  assert.equal(await directRouter.navigateBack("/list.html"), true);
  assert.equal(directBrowser.history.backCalls, 0, "direct detail loads must not leave the site history");
  assert.equal(directStates.at(-1).name, "list", "direct detail loads must navigate forward to the list fallback");
  await directRouter.dispose();

  const layeredBrowser = fakeBrowser("/list.html");
  const layeredStates = [];
  const layeredRouter = routerFor(layeredBrowser, layeredStates);
  assert.equal(await layeredRouter.start(), true);
  assert.equal(await layeredRouter.navigate("/detail-a.html?id=a"), true);
  assert.equal(await layeredRouter.navigate("/detail-b.html?id=b"), true);
  assert.deepEqual(layeredBrowser.history.state[SPA_HISTORY_KEY].previous, { index: 1, path: "/detail-a.html" });
  assert.equal(await layeredRouter.navigateBack("/list.html"), true);
  assert.equal(layeredBrowser.history.backCalls, 0, "detail-to-detail history must not back into another detail page");
  assert.equal(layeredStates.at(-1).name, "list");
  await layeredRouter.dispose();
}

async function verifyFrameSupersedingNavigation() {
  const browser = fakeBrowser("/a.html");
  const frames = [];
  const pages = [];
  let notifyBStarted;
  let releaseB;
  const bStarted = new Promise((resolve) => { notifyBStarted = resolve; });
  const bGate = new Promise((resolve) => { releaseB = resolve; });
  const manifest = {
    "/a.html": {
      path: "/a.html", section: "bizflow", styles: [], frame: testFrame("a"),
      load: async () => ({ async mountPage() { return { page: { data: { name: "a" }, render: () => "a" } }; } })
    },
    "/b.html": {
      path: "/b.html", section: "bizflow", styles: [], frame: testFrame("b"),
      load: async () => ({
        async mountPage() {
          notifyBStarted();
          await bGate;
          return { page: { data: { name: "b" }, render: () => "b" } };
        }
      })
    }
  };
  const router = createAppRouter({
    shell: {
      setLoadingPage(frame) { frames.push(frame.title); },
      setPage(page) { pages.push(page.data.name); }
    },
    manifest,
    allowlist: Object.keys(manifest),
    windowRef: browser.windowRef,
    documentRef: browser.documentRef,
    styleManager: {
      adopt() {},
      async prepare() { return { commit() {}, rollback() {} }; },
      dispose() {}
    }
  });
  assert.equal(await router.start(), true);
  const toB = router.navigate("/b.html");
  await bStarted;
  assert.deepEqual(frames, ["a", "b"]);
  assert.deepEqual(pages, ["a"], "pending route data must not commit a controller");
  assert.equal(await router.navigate("/a.html?superseded=1"), true);
  releaseB();
  assert.equal(await toB, false);
  assert.deepEqual(frames, ["a", "b", "a"]);
  assert.deepEqual(pages, ["a", "a"], "superseded controller must never replace the current route");
  await router.dispose();
}

async function verifyNavigationTimeoutSeparation() {
  const browser = fakeBrowser("/slow.html");
  let releaseMount;
  let notifyMountStarted;
  const mountStarted = new Promise((resolve) => { notifyMountStarted = resolve; });
  const mountGate = new Promise((resolve) => { releaseMount = resolve; });
  const frames = [];
  const pages = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values);
  const router = createAppRouter({
    shell: {
      setLoadingPage(frame) { frames.push(frame.title); },
      setPage(page) { pages.push(page.data.name); }
    },
    manifest: {
      "/slow.html": {
        path: "/slow.html",
        section: "bizflow",
        styles: [],
        frame: testFrame("slow"),
        load: async () => ({
          async mountPage({ signal }) {
            notifyMountStarted();
            await mountGate;
            assert.equal(signal.aborted, false);
            return { page: { data: { name: "slow" }, render: () => "slow" } };
          }
        })
      }
    },
    allowlist: ["/slow.html"],
    windowRef: browser.windowRef,
    documentRef: browser.documentRef,
    navigationTimeoutMs: 20,
    mountWarningMs: 5,
    styleManager: {
      adopt() {},
      async prepare() { return { commit() {}, rollback() {} }; },
      dispose() {}
    }
  });
  try {
    const starting = router.start();
    await mountStarted;
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(frames, ["slow"], "route frame must render before slow page data resolves");
    assert.deepEqual(pages, [], "page controller must wait for slow data");
    assert.deepEqual(browser.assigned, [], "slow page data must not trigger document fallback");
    assert.equal(warnings.filter(([message]) => String(message).includes("data mount still pending")).length, 1);
    assert.equal(warnings.some(([message]) => String(message).includes("navigation failed")), false);
    releaseMount();
    assert.equal(await starting, true);
    assert.deepEqual(pages, ["slow"]);
  } finally {
    console.warn = originalWarn;
    await router.dispose();
  }

  const assetBrowser = fakeBrowser("/asset-timeout.html");
  const assetWarnings = [];
  console.warn = (...values) => assetWarnings.push(values);
  const assetRouter = createAppRouter({
    shell: { setLoadingPage() {}, setPage() {} },
    manifest: {
      "/asset-timeout.html": {
        path: "/asset-timeout.html",
        section: "bizflow",
        styles: [],
        frame: testFrame("asset-timeout"),
        load: () => new Promise(() => {})
      }
    },
    allowlist: ["/asset-timeout.html"],
    windowRef: assetBrowser.windowRef,
    documentRef: assetBrowser.documentRef,
    navigationTimeoutMs: 5,
    mountWarningMs: 5,
    styleManager: {
      adopt() {},
      async prepare() { return { commit() {}, rollback() {} }; },
      dispose() {}
    }
  });
  try {
    assert.equal(await assetRouter.start(), false);
    assert.equal(assetWarnings.filter(([message]) => String(message).includes("navigation failed")).length, 1);
    assert.equal(assetBrowser.assigned.at(-1), "https://example.test/asset-timeout.html?tpSpa=0");
  } finally {
    console.warn = originalWarn;
    await assetRouter.dispose();
  }
}

async function verifyShellAdapter() {
  const source = await readFile(path.join(rootDir, "root-site/shell/shell.js"), "utf8");
  assert.match(source, /export function setPage\(/, "shell must expose setPage");
  assert.match(source, /export function setLoadingPage\(/, "shell must expose the frame-first loading contract");
  assert.match(source, /pageContext = \{\s*\.\.\.pageContext,\s*menu: frame\.menu,/s, "loading frames must preserve authenticated page data and unread state");
  assert.match(source, /root\.setAttribute\("aria-busy", "true"\)/, "loading frame must expose its busy state");
  assert.match(source, /root\.removeAttribute\("aria-busy"\)/, "page commit must clear its busy state");
  assert.match(source, /const defaultMenu = createRouteMenu\(defaultMenuPath\)/, "loading shell must derive its real menu from shared route metadata");
  assert.doesNotMatch(source, /const defaultMenu = \[/, "loading shell must not expose the obsolete hardcoded menu");
  assert.doesNotMatch(source, /navigation-prerender|installNavigationPrerender/, "P6 shell must not reinstall MPA speculation rules");
  const adapterEnd = source.indexOf("let menuSource =");
  const legacyReads = [...source.matchAll(/window\.__shell(?:Menu|Data|Content)/g)];
  assert.deepEqual(
    [...new Set(legacyReads.map((match) => match[0]))].sort(),
    ["window.__shellContent", "window.__shellData", "window.__shellMenu"],
    "startup adapter must cover all three legacy globals"
  );
  assert.ok(legacyReads.every((match) => match.index < adapterEnd), "legacy globals must not be read after startup adaptation");
}

async function verifyTransitions() {
  const router = await readFile(path.join(rootDir, "root-site/spa/app-router.js"), "utf8");
  const base = await readFile(path.join(rootDir, "root-site/tokens/base.css"), "utf8");
  assert.match(router, /documentRef\.startViewTransition\(update\)/, "SPA navigation must use one shared same-document transition");
  assert.match(router, /\["AbortError", "InvalidStateError"\]/, "expected transition interruptions must be silent");
  assert.match(router, /console\.warn\(`\[spa\] view transition \$\{phase\} failed`/, "unexpected transition failures must stay observable");
  assert.match(base, /@view-transition\s*{\s*navigation:\s*auto;/, "direct-load fallback must retain progressive MPA transitions");
}

await verifyManifest();
await verifyLifecycle();
verifyOcppGuard();
verifyWhatsappI18n();
await verifyRouter();
await verifyFrameHistoryNavigation();
await verifySmartBackNavigation();
await verifyFrameSupersedingNavigation();
await verifyNavigationTimeoutSeparation();
await verifyRouteGenerationRace();
await verifyDataRaceGuards();
await verifyWriteInvalidateRemount();
await verifyShellAdapter();
await verifyTransitions();
console.log("SPA rollout contracts: PASS (16 migrated routes, cross-section navigation, 30-cycle lifecycle, fallback, shell adapter)");
