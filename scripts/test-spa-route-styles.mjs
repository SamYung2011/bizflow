import assert from "node:assert/strict";

import { createAppRouter } from "../root-site/spa/app-router.js";
import { createRouteStyleManager } from "../root-site/spa/route-styles.js";

function fakeStyleDocument() {
  const baseURI = "https://example.test/app.html";
  const links = [];
  const documentRef = {
    baseURI,
    head: {
      append(link) {
        link.isConnected = true;
        links.push(link);
        if (documentRef.autoLoadStyles) queueMicrotask(() => link.onload?.());
      }
    },
    createElement(tagName) {
      assert.equal(tagName, "link");
      let href = "";
      return {
        rel: "",
        media: "",
        dataset: {},
        isConnected: false,
        get href() { return href; },
        set href(value) { href = new URL(value, baseURI).href; },
        remove() {
          this.isConnected = false;
          const index = links.indexOf(this);
          if (index >= 0) links.splice(index, 1);
        }
      };
    },
    querySelectorAll() {
      return links.filter((link) => link.isConnected && link.rel === "stylesheet" && link.href);
    },
    getComputedStyle(element) {
      const href = new URL(element.dataset.routeStyle, baseURI).href;
      const applied = links.some((link) => link.href === href && link.media === "all" && link.isConnected);
      return { display: applied ? "grid" : "block" };
    },
    addEventListener() {},
    removeEventListener() {},
    autoLoadStyles: false
  };
  return { documentRef, links };
}

function fakeRouterWindow(pathname = "/a.html") {
  const location = {
    href: `https://example.test${pathname}`,
    origin: "https://example.test",
    assign(value) { this.href = new URL(value, this.href).href; },
    replace(value) { this.href = new URL(value, this.href).href; }
  };
  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      location.href = new URL(url, location.href).href;
    },
    pushState(state, _title, url) {
      this.state = state;
      location.href = new URL(url, location.href).href;
    },
    back() {},
    go() {}
  };
  return {
    location,
    history,
    scrollX: 0,
    scrollY: 0,
    scrollTo() {},
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}

function testRoute(name, styles) {
  return {
    path: `/${name}.html`,
    section: "bizflow",
    styles,
    frame: { menu: [], title: name, skeleton: { kind: "table", stats: 0 }, access: "default" },
    load: async () => ({
      async mountPage() {
        return { page: { data: { name }, render: () => name } };
      }
    })
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for routed view transition");
}

const { documentRef, links } = fakeStyleDocument();
const manager = createRouteStyleManager(documentRef);
const firstAbort = new AbortController();
const secondAbort = new AbortController();
const firstPrepare = manager.prepare(["shared.css"], { signal: firstAbort.signal });
assert.equal(links.length, 1);
const firstLink = links[0];
const secondPrepare = manager.prepare(["shared.css"], { signal: secondAbort.signal });
assert.equal(links.length, 2, "a navigation must not reuse another navigation's pending stylesheet");
const secondLink = links[1];

firstAbort.abort();
await assert.rejects(firstPrepare, { name: "AbortError" });
assert.deepEqual(links, [secondLink], "aborting the first navigation must remove only its owned link");
assert.equal(firstLink.isConnected, false);
secondLink.onload();
const secondStyles = await secondPrepare;
secondStyles.commit();
assert.equal(secondLink.isConnected, true);
assert.equal(secondLink.media, "all");
assert.equal(secondLink.dataset.spaRouteStyle, "active");

secondLink.remove();
const warnings = [];
const originalWarn = console.warn;
console.warn = (...values) => warnings.push(values);
try {
  assert.equal(secondStyles.ensureActive(), false, "detached committed styles must be repaired");
} finally {
  console.warn = originalWarn;
}
assert.equal(warnings.length, 1, "style self-healing must remain observable");
assert.equal(links.length, 1);
assert.equal(links[0].media, "all");
assert.equal(links[0].dataset.spaRouteStyle, "active");

for (let iteration = 0; iteration < 20; iteration += 1) {
  const href = `route-${iteration}.css`;
  const supersededAbort = new AbortController();
  const currentAbort = new AbortController();
  const supersededPrepare = manager.prepare([href], { signal: supersededAbort.signal });
  const currentPrepare = manager.prepare([href], { signal: currentAbort.signal });
  supersededAbort.abort();
  await assert.rejects(supersededPrepare, { name: "AbortError" });
  const currentLink = links.find((link) => link.href.endsWith(`/${href}`));
  assert.ok(currentLink, `cycle ${iteration + 1} must retain the current navigation's owned stylesheet`);
  currentLink.onload();
  const currentStyles = await currentPrepare;
  currentStyles.commit();
  assert.equal(currentStyles.ensureActive(), true);
  assert.equal(
    documentRef.getComputedStyle({ dataset: { routeStyle: href } }).display,
    "grid",
    `cycle ${iteration + 1} must apply the current route's marker style`
  );
}

const transitionFixture = fakeStyleDocument();
transitionFixture.documentRef.autoLoadStyles = true;
const sharedLink = transitionFixture.documentRef.createElement("link");
sharedLink.rel = "stylesheet";
sharedLink.href = "shared.css";
sharedLink.media = "all";
sharedLink.dataset.spaRouteStyle = "active";
transitionFixture.documentRef.head.append(sharedLink);
const transitionStyles = createRouteStyleManager(transitionFixture.documentRef);
const transitionWindow = fakeRouterWindow();
const manifest = {
  "/a.html": testRoute("a", ["shared.css"]),
  "/inventory.html": testRoute("inventory", ["inventory.css"]),
  "/customers.html": testRoute("customers", ["shared.css", "customers.css"])
};
const router = createAppRouter({
  shell: { setLoadingPage() {}, setPage() {} },
  manifest,
  allowlist: Object.keys(manifest),
  windowRef: transitionWindow,
  documentRef: transitionFixture.documentRef,
  styleManager: transitionStyles
});
assert.equal(await router.start(), true);

const transitions = [];
transitionFixture.documentRef.startViewTransition = (update) => {
  let release;
  const updateCallbackDone = new Promise((resolve, reject) => {
    release = () => {
      try {
        update();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
  });
  transitions.push({ release });
  return { updateCallbackDone, ready: Promise.resolve(), finished: updateCallbackDone };
};

const repairWarnings = [];
const originalTransitionWarn = console.warn;
console.warn = (...values) => repairWarnings.push(values);
try {
  const inventoryNavigation = router.navigate("/inventory.html");
  await waitFor(() => transitions.length === 1);
  const customerNavigation = router.navigate("/customers.html");
  await waitFor(() => transitions.length === 2);
  transitions[0].release();
  assert.equal(await inventoryNavigation, false, "the superseded transition must abort without committing its styles");
  transitions[1].release();
  assert.equal(await customerNavigation, true);
} finally {
  console.warn = originalTransitionWarn;
  await router.dispose();
}
assert.equal(
  repairWarnings.filter(([message]) => String(message).includes("repaired missing route styles")).length,
  0,
  "a view-transition supersede must not need stylesheet self-healing"
);
assert.equal(sharedLink.isConnected, true, "the aborted inventory transition must not detach shared customer styles");
assert.equal(
  transitionFixture.documentRef.getComputedStyle({ dataset: { routeStyle: "customers.css" } }).display,
  "grid",
  "the winning route must commit its marker style"
);

console.log("SPA route style contracts: PASS (owned pending links, self-heal, 20 cycles, transition supersede)");
