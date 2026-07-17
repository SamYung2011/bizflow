import assert from "node:assert/strict";

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
    }
  };
  return { documentRef, links };
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

console.log("SPA route style contracts: PASS (owned pending links, self-heal, 20 supersede cycles)");
