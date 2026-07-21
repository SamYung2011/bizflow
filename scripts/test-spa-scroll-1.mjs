import assert from "node:assert/strict"
import fs from "node:fs"

import { createAppRouter, SPA_HISTORY_KEY } from "../root-site/spa/app-router.js"

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
  }
}

function scrollElement(key, { top = 0, left = 0, scrollHeight = 900, clientHeight = 300, scrollWidth = 900, clientWidth = 300 } = {}) {
  return {
    dataset: { scrollRestore: key },
    scrollTop: top,
    scrollLeft: left,
    scrollHeight,
    clientHeight,
    scrollWidth,
    clientWidth,
  }
}

function fakeBrowser() {
  const windowTarget = eventTarget()
  const documentTarget = eventTarget()
  const frames = []
  const cancelled = new Set()
  let frameId = 0
  const location = {
    href: "https://example.test/a.html",
    origin: "https://example.test",
    assign(value) { this.href = new URL(value, this.href).href },
    replace(value) { this.href = new URL(value, this.href).href },
  }
  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state
      location.href = new URL(url, location.href).href
    },
    pushState(state, _title, url) {
      this.state = state
      location.href = new URL(url, location.href).href
    },
    back() {},
    go() {},
  }
  const scrolls = []
  const windowRef = {
    ...windowTarget,
    location,
    history,
    scrollX: 0,
    scrollY: 0,
    scrollTo(x, y) { scrolls.push({ x, y }) },
    requestAnimationFrame(callback) {
      const id = ++frameId
      frames.push({ id, callback })
      return id
    },
    cancelAnimationFrame(id) { cancelled.add(id) },
    setTimeout,
    clearTimeout,
  }
  const documentRef = {
    ...documentTarget,
    scrollElements: [],
    querySelectorAll(selector) {
      assert.equal(selector, "[data-scroll-restore]")
      return this.scrollElements
    },
  }
  function flushFrame() {
    while (frames.length) {
      const frame = frames.shift()
      if (cancelled.delete(frame.id)) continue
      frame.callback()
      return true
    }
    return false
  }
  return { windowRef, documentRef, history, scrolls, flushFrame, frames }
}

const browser = fakeBrowser()
const sourceTable = scrollElement("orders.northbound.table", { top: 321, left: 87 })
const sourceSlow = scrollElement("test.slow", { top: 144 })
const restoredTable = scrollElement("orders.northbound.table", {
  scrollHeight: 300,
  clientHeight: 300,
  scrollWidth: 300,
  clientWidth: 300,
})
const restoredSlow = scrollElement("test.slow")
let aMounts = 0

function moduleFor(name) {
  return {
    async mountPage() {
      return { page: { data: { name }, render: () => name } }
    },
  }
}

const manifest = Object.fromEntries(["a", "b"].map(name => [`/${name}.html`, {
  path: `/${name}.html`,
  section: "bizflow",
  styles: [],
  frame: { title: name, menu: [], skeleton: { kind: "table", stats: 0 }, access: "default" },
  load: async () => moduleFor(name),
}]))

const router = createAppRouter({
  shell: {
    setLoadingPage() { browser.documentRef.scrollElements = [] },
    setPage(page) {
      if (page.data.name !== "a") {
        browser.documentRef.scrollElements = []
        return
      }
      aMounts += 1
      browser.documentRef.scrollElements = aMounts === 1 ? [sourceTable, sourceSlow] : [restoredTable]
    },
  },
  manifest,
  allowlist: Object.keys(manifest),
  windowRef: browser.windowRef,
  documentRef: browser.documentRef,
  styleManager: {
    adopt() {},
    async prepare() { return { commit() {}, ensureActive() {}, rollback() {} } },
    dispose() {},
  },
})

assert.equal(await router.start(), true)
assert.equal(browser.flushFrame(), true)
browser.windowRef.scrollX = 12
browser.windowRef.scrollY = 456
router.savePageState({ filter: "open" })
const stateA = structuredClone(browser.history.state)
assert.deepEqual(stateA[SPA_HISTORY_KEY].scroll, {
  x: 12,
  y: 456,
  containers: {
    "orders.northbound.table": { top: 321, left: 87 },
    "test.slow": { top: 144, left: 0 },
  },
})

assert.equal(await router.navigate("/b.html"), true)
assert.equal(browser.flushFrame(), true)
browser.windowRef.location.href = "https://example.test/a.html"
browser.history.state = stateA
await [...browser.windowRef.listeners.get("popstate")][0]({ state: stateA })

assert.equal(browser.flushFrame(), true, "first restore frame must run")
assert.deepEqual(browser.scrolls.at(-1), { x: 12, y: 456 })
assert.equal(restoredTable.scrollTop, 0, "non-overflowing container must wait for rendered content")
assert.ok(browser.frames.length > 0, "unready/missing containers must schedule another frame")

restoredTable.scrollHeight = 900
restoredTable.scrollWidth = 900
browser.documentRef.scrollElements.push(restoredSlow)
assert.equal(browser.flushFrame(), true)
assert.deepEqual(
  { top: restoredTable.scrollTop, left: restoredTable.scrollLeft },
  { top: 321, left: 87 },
  "ready table must restore both axes",
)
assert.equal(restoredSlow.scrollTop, 144, "container that appears late must restore on retry")
assert.equal(browser.frames.length, 0)
await router.dispose()

const routerSource = fs.readFileSync(new URL("../root-site/spa/app-router.js", import.meta.url), "utf8")
const northboundSource = fs.readFileSync(new URL("../root-site/bizflow/orders-northbound.js", import.meta.url), "utf8")
assert.match(routerSource, /scroll:\s*captureScroll\(windowRef, documentRef\)/)
assert.match(routerSource, /scroll\.containers/)
assert.match(routerSource, /SCROLL_RESTORE_MAX_FRAMES\s*=\s*10/)
assert.match(routerSource, /scrollHeight\)\s*>\s*Number\(element\.clientHeight/)
assert.match(northboundSource, /class="northbound-table-scroll" data-scroll-restore="orders\.northbound\.table"/)

console.log("SPA-scroll-1 contracts: PASS")
