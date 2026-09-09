import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adapterListSignature } from "../root-site/bizflow/app-feedback.js";
import { assertHonnmonoAdminRequest, formatFeedbackTime } from "../root-site/bizflow/app-feedback-api.js";
import { createAdapterOtaLoader, renderAdapterOta } from "../root-site/bizflow/app-feedback-device-live.js";
import { createFeedbackPoller, DEVICES_POLL_INTERVAL_MS } from "../root-site/bizflow/app-feedback-poller.js";
import { translateAppFeedback } from "../root-site/bizflow/app-feedback-i18n.js";

const source = await readFile(new URL("../root-site/bizflow/app-feedback.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `production section ${start} exists`);
  return source.slice(from, to);
}

// Execute the real page callbacks, rerender and poller with only DOM/network/
// clock replaced. No production credentials, endpoints or timers are used.
function fixture() {
  let now = 1_789_000_000_000, current = true, nextTimer = 1, panelOpen = false;
  const controller = new AbortController(), timers = new Map(), frames = [], cleanups = [];
  const calls = [], paints = [], listeners = new Map();
  const document = {
    visibilityState: "visible", activeElement: null,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector(selector) {
      if (selector === "[data-app-feedback-page]") return page;
      if (selector === "[data-adapter-query]") return input;
      return null;
    },
  };
  const input = {
    value: "", matches: (selector) => ["[data-adapter-query]", "input, textarea, select"].includes(selector),
    closest: (selector) => selector === "[data-app-feedback-page]" ? page : null,
    focus() { document.activeElement = input; },
  };
  const page = {
    set outerHTML(value) { paints.push(JSON.parse(value)); document.activeElement = null; },
  };
  const scope = {
    signal: controller.signal, isCurrent: () => current,
    timeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    animationFrame(callback) { frames.push(callback); },
    onCleanup(callback) { cleanups.push(callback); },
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    },
  };
  const row = (version = 1) => ({ certid: "CERT_1", chargeCount: version, ota: { state: "armed", updatedAt: now }, firmware: { software: "v1" } });
  let payload = { items: [row()], total: 1 };
  const otaPayload = { state: "armed", task: { package: "test.bin", armedAt: now, expiresAt: now + 60_000 } };
  let responder = async (path) => path.endsWith("/ota")
    ? structuredClone(otaPayload)
    : structuredClone(payload);
  const request = async (path, options) => {
    assertHonnmonoAdminRequest(path);
    calls.push(path);
    return responder(path, options);
  };
  const production = [
    section("function createAdapterDeviceState", "function adapterPageCount"),
    section("function adapterPageCount", "export function adapterActionsForKind"),
    section("function rerender(", "function listSubPath"),
    section("function adapterListSubPath", "export function adapterListSignature"),
    section("function adapterRefreshWouldInterrupt", "async function loadAdapterSessions"),
    section("function closeAdapterAction", "async function submitAdapterAction"),
    section("function switchAppTab", "function onFeedbackClick"),
    section("function onFeedbackInput", "function onFeedbackChange"),
  ].join("\n");
  const make = new Function("document", "activeScope", "callHonnmonoAdmin", "createFeedbackPoller", "createAdapterOtaLoader", "adapterListSignature", "Date", "timers", "paints", "datePanel", `
    const PAGE_SIZE = 20, DEVICES_POLL_INTERVAL_MS = 10_000;
    const currentHongKongDate = () => '2026-09-09';
    const activeInstance = 1, helpers = {};
    const isActive = () => activeScope.isCurrent();
    const adapterSessionDatePanel = datePanel;
    const captureScrollState = () => ({}), restoreScrollState = () => {};
    const pollFeedbackList = async () => true;
    const state = { activeTab: 'feedback', adapters: createAdapterDeviceState(), ota: { loaded: true } };
    const render = () => JSON.stringify({ rows: state.adapters.rows, input: state.adapters.queryInput });
    const activeAdapterOtaLoader = createAdapterOtaLoader(callHonnmonoAdmin);
    ${production}
    const activePoller = createFeedbackPoller({ scope: activeScope, documentRef: document,
      poll: pollActiveTab, clearTimeoutFn: (id) => timers.delete(id) });
    activeScope.listen(document, 'focusout', onAdapterFocusOut);
    return { state, switchAppTab, onFeedbackInput, pollAdapterList, closeAdapterAction,
      flushAdapterUpdates, adapterRefreshWouldInterrupt, loadAdapters };
  `);
  const api = make(document, scope, request, createFeedbackPoller, createAdapterOtaLoader, adapterListSignature,
    class extends Date { static now() { return now; } }, timers, paints,
    { isOpen: () => panelOpen, close: () => { panelOpen = false; } });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    ...api, calls, paints, document, input, row,
    setPayload(next) { payload = next; },
    setResponder(next) { responder = next; },
    setPanel(open) { panelOpen = open; },
    advance(ms) { now += ms; },
    async open() {
      api.switchAppTab("devices");
      await settle();
      frames.splice(0).forEach((run) => run());
      assert.equal(document.activeElement, input, "switching tabs auto-focuses the search box");
      assert.equal(timers.values().next().value.delay, DEVICES_POLL_INTERVAL_MS);
    },
    async tick() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      now += timer.delay;
      await timer.callback();
      await settle();
      return timer.delay;
    },
    type(value) { input.focus(); input.value = value; api.onFeedbackInput({ target: input }); },
    blur() {
      document.activeElement = null;
      listeners.get("focusout")({ target: input });
      frames.splice(0).forEach((run) => run());
    },
    dispose() { current = false; controller.abort(); cleanups.reverse().forEach((run) => run()); },
  };
}

let checks = 0;
async function check(name, run) { await run(); console.log(`device-live-r2 ${++checks}: ${name}`); }
async function withPage(run) {
  const f = fixture();
  try { await f.open(); await run(f); } finally { f.dispose(); }
}

await check("idle auto-focused search sends flash and OTA requests and paints at 10 seconds", () => withPage(async (f) => {
  const previous = f.calls.length, paints = f.paints.length;
  f.setPayload({ items: [f.row(2)], total: 1 });
  assert.equal(await f.tick(), 10_000);
  assert.deepEqual(f.calls.slice(previous), ["/devices/flash?page=1&pageSize=20", "/devices/flash/CERT_1/ota"]);
  assert.equal(f.state.adapters.rows[0].chargeCount, 2);
  assert.ok(f.paints.length > paints);
  assert.equal(f.paints.at(-1).rows[0].chargeCount, 2);
}));

await check("unapplied input keeps polling, updates memory, then blur paints once without losing text", () => withPage(async (f) => {
  f.type("unfinished search");
  const previous = f.calls.length, paints = f.paints.length;
  f.setPayload({ items: [f.row(3)], total: 1 });
  await f.tick();
  assert.equal(f.calls.length - previous, 2);
  assert.equal(f.state.adapters.rows[0].chargeCount, 3);
  assert.equal(f.state.adapters.adaptersDirty, true);
  assert.equal(f.paints.length, paints);
  assert.equal(f.document.activeElement, f.input);
  f.blur();
  assert.equal(f.paints.length, paints + 1);
  assert.equal(f.state.adapters.adaptersDirty, false);
  assert.equal(f.state.adapters.otaDirty, false);
  assert.equal(f.paints.at(-1).input, "unfinished search");
  assert.equal(f.paints.at(-1).rows[0].chargeCount, 3);
}));

await check("equal query protects the last five seconds of typing, but idle focus permits paint", () => withPage(async (f) => {
  f.type("");
  assert.equal(f.adapterRefreshWouldInterrupt(), true);
  f.advance(4_999);
  assert.equal(f.adapterRefreshWouldInterrupt(), true);
  f.advance(1);
  assert.equal(f.adapterRefreshWouldInterrupt(), false);
}));

await check("typing begun in flight retains list and OTA results until blur", () => withPage(async (f) => {
  let resolve;
  f.setResponder((path) => path.endsWith("/ota") ? Promise.resolve({ state: "delivered" }) : new Promise((done) => { resolve = done; }));
  const pending = f.tick(), paints = f.paints.length;
  f.type("new draft");
  resolve({ items: [f.row(4)], total: 1 });
  await pending;
  assert.equal(f.paints.length, paints);
  assert.equal(f.state.adapters.rows[0].chargeCount, 4);
  assert.equal(f.state.adapters.ota.CERT_1.state, "delivered");
  f.blur();
  assert.equal(f.paints.length, paints + 1);
}));

await check("unchanged next payload still paints earlier dirty data after interruption ends", () => withPage(async (f) => {
  f.type("draft");
  f.setPayload({ items: [f.row(5)], total: 1 });
  await f.tick();
  const paints = f.paints.length;
  f.document.activeElement = null;
  await f.tick();
  assert.equal(f.paints.length, paints + 1);
  assert.equal(f.state.adapters.adaptersDirty, false);
}));

await check("action dialogs, lookups, other inputs and date panel continue blocking paint only", () => withPage(async (f) => {
  const blockers = [
    () => { f.state.adapters.actionConfirm = {}; },
    () => { f.state.adapters.actionLoading = true; },
    () => { f.state.adapters.actionLookupId = "CERT_1"; },
    () => { f.setPanel(true); },
    () => { f.document.activeElement = { closest: () => true, matches: (s) => s === "input, textarea, select" }; },
  ];
  for (const [index, block] of blockers.entries()) {
    block();
    const previous = f.calls.length, paints = f.paints.length;
    f.setPayload({ items: [f.row(10 + index)], total: 1 });
    await f.tick();
    assert.equal(f.calls.length - previous, 2);
    assert.equal(f.paints.length, paints);
    assert.equal(f.state.adapters.adaptersDirty, true);
    f.state.adapters.actionConfirm = null;
    f.state.adapters.actionLoading = false;
    f.state.adapters.actionLookupId = null;
    f.setPanel(false);
    f.document.activeElement = null;
    f.flushAdapterUpdates();
    assert.equal(f.paints.length, paints + 1);
  }
  f.state.adapters.actionConfirm = {};
  f.setPayload({ items: [f.row(20)], total: 1 });
  await f.tick();
  f.closeAdapterAction();
  assert.equal(f.state.adapters.adaptersDirty, false);
  assert.equal(f.paints.at(-1).rows[0].chargeCount, 20);
}));

await check("stale request responses cannot replace a newer manual list", () => withPage(async (f) => {
  let resolve;
  f.setResponder(() => new Promise((done) => { resolve = done; }));
  const pending = f.tick();
  f.state.adapters.request++;
  resolve({ items: [f.row(99)], total: 1 });
  await pending;
  assert.equal(f.state.adapters.rows[0].chargeCount, 1);
}));

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const helpers = { t: (key) => translateAppFeedback("en", key), escapeHtml, formatTime: (value) => formatFeedbackTime(value, "en") };
const time = Date.now(), task = { package: "test.bin", armedAt: time - 10_000, expiresAt: time + 60_000 };
const button = /data-adapter-action="untask"/;
await check("no task, expired tasks and historical states without pending cannot be cancelled", () => {
  for (const state of ["none", "armed", "installed", "expired", "untasked"]) {
    assert.doesNotMatch(renderAdapterOta({ certid: "A", ota: { state } }, { state, task: null }, helpers), button);
  }
  for (const state of ["armed", "delivered", "downloading", "downloaded", "installed", "expired", "untasked"]) {
    assert.doesNotMatch(renderAdapterOta({ certid: "A" }, { state, task: { ...task, expiresAt: time - 1 }, stillPending: true }, helpers), button);
  }
  for (const state of ["installed", "expired", "untasked"]) {
    assert.doesNotMatch(renderAdapterOta({ certid: "A" }, { state, task, stillPending: false }, helpers), button);
  }
});
await check("current unexpired tasks and installed-but-still-pending tasks can be cancelled", () => {
  for (const state of ["armed", "delivered", "downloading", "downloaded", "installed"]) {
    assert.match(renderAdapterOta({ certid: "A" }, { state, task, stillPending: state === "installed" }, helpers), button);
  }
});
await check("all historical state headers include updatedAt through the existing formatter", () => {
  for (const state of ["installed", "expired", "untasked"]) {
    const html = renderAdapterOta({ certid: "A", ota: { state, updatedAt: time } }, { state, task }, helpers);
    assert.ok(html.match(/<header>.*?<\/header>/s)[0].includes(formatFeedbackTime(time, "en")));
  }
  assert.match(source, /scope\.listen\(document, "focusout", onAdapterFocusOut\)/);
});
console.log(`DEVICE_PAGE_R2=${checks}/${checks}`);
