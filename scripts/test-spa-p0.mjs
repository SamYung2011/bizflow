import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { createAppRouter, SPA_HISTORY_KEY } from "../root-site/spa/app-router.js";
import { createPageScope, mountPageModule } from "../root-site/spa/page-lifecycle.js";
import { routeManifest, spaRouteAllowlist } from "../root-site/spa/route-manifest.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commonStyles = new Set([
  "tokens/tokens.css",
  "tokens/base.css",
  "assets/icons/icons.css",
  "components/styles.css",
  "shell/shell.css"
]);

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
}

function rootRelative(file) {
  return path.relative(path.join(rootDir, "root-site"), file).split(path.sep).join("/");
}

async function verifyManifest() {
  const routes = Object.values(routeManifest);
  assert.equal(routes.length, 16, "P0 manifest must enumerate the 16 approved pages");
  assert.deepEqual([...spaRouteAllowlist], [], "P0 must ship with an empty SPA allowlist");
  for (const route of routes) {
    assert.ok(route.path.endsWith(".html"), `${route.path} must retain its .html URL`);
    assert.equal(route.load, null, `${route.path} must remain MPA-only in P0`);
    const htmlFile = path.join(rootDir, "root-site", route.path);
    const html = await readFile(htmlFile, "utf8");
    const tags = [...html.matchAll(/<(?:link|script)\b[^>]*>/g)].map((match) => attributes(match[0]));
    const entry = tags.find((tag) => tag.type === "module" && tag.src)?.src;
    assert.ok(entry, `${route.path} must have one module entry`);
    assert.equal(
      fileURLToPath(route.entry),
      path.resolve(path.dirname(htmlFile), entry),
      `${route.path} manifest entry must match HTML`
    );
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
  let allowLeave = true;
  let styleCommits = 0;
  const makeModule = (name) => ({
    async mountPage() {
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
  router.savePageState({ filter: "open" });
  assert.deepEqual(browser.history.state[SPA_HISTORY_KEY].pageState, { filter: "open" });
  allowLeave = false;
  assert.equal(await router.navigate("/b.html"), false, "canLeave must block SPA navigation");
  assert.deepEqual(pages, ["a"]);
  allowLeave = true;
  assert.equal(await router.navigate("/b.html"), true);
  assert.deepEqual(pages, ["a", "b"]);
  assert.equal(styleCommits, 2);
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
  assert.equal(browser.assigned.at(-1), "https://example.test/fail.html", "route failure must hard navigate");
  await router.dispose();
  assert.equal(browser.windowRef.listeners.get("popstate")?.size ?? 0, 0);
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
await verifyRouter();
await verifyShellAdapter();
console.log("SPA P0 contracts: PASS (16 routes, empty allowlist, lifecycle, fallback, shell adapter)");
