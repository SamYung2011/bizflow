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
await check("a task or historical log without a Shenzhen pending row cannot be cancelled", () => {
  for (const state of ["none", "armed", "delivered", "downloading", "downloaded", "installed", "expired", "untasked"]) {
    for (const value of [null, task, { ...task, expiresAt: time - 1 }]) {
      assert.doesNotMatch(renderAdapterOta({ certid: "A", ota: { state, pending: false } }, { state, task: value, stillPending: false }, helpers), button);
    }
  }
});
await check("pending in either list or detail permits cancellation regardless of task expiry or detail loading", () => {
  for (const state of ["none", "armed", "delivered", "downloading", "downloaded", "installed", "expired", "untasked"]) {
    assert.match(renderAdapterOta({ certid: "A", ota: { state, pending: true } }, undefined, helpers), button);
    assert.match(renderAdapterOta({ certid: "A" }, { state, task: { ...task, expiresAt: time - 1 }, stillPending: true }, helpers), button);
  }
});
await check("installed and expired history headers still include updatedAt through the existing formatter", () => {
  for (const state of ["installed", "expired"]) {
    const html = renderAdapterOta({ certid: "A", ota: { state, updatedAt: time } }, { state, task }, helpers);
    assert.ok(html.match(/<header>.*?<\/header>/s)[0].includes(formatFeedbackTime(time, "en")));
  }
  assert.match(source, /scope\.listen\(document, "focusout", onAdapterFocusOut\)/);
});
await check("expired pending task has a button and expiry hint before details arrive; busy disables it", () => {
  const device = { certid: "A", ota: { state: "expired", pending: true, updatedAt: time } };
  const html = renderAdapterOta(device, undefined, { ...helpers, actionBusy: true });
  assert.match(html, button);
  assert.match(html, /data-adapter-id="A" disabled/);
  assert.ok(html.includes(translateAppFeedback("en", "otaExpiredStillPending")));
  assert.ok(html.includes(formatFeedbackTime(time, "en")));
  for (const lang of ["zh", "en", "fr"]) {
    const copy = translateAppFeedback(lang, "otaExpiredStillPending");
    assert.notEqual(copy, "otaExpiredStillPending");
    assert.ok(copy.trim());
  }
});
await check("still-pending hints distinguish installed and expired and stay absent in other states", () => {
  for (const state of ["armed", "delivered", "downloading", "downloaded", "installed", "expired", "untasked"]) {
    const html = renderAdapterOta({ certid: "A" }, { state, task, stillPending: true }, helpers);
    assert.equal(html.includes(translateAppFeedback("en", "otaStillPending")), state === "installed");
    assert.equal(html.includes(translateAppFeedback("en", "otaExpiredStillPending")), state === "expired");
  }
});
await check("loading text appears only before details arrive and errors replace it", () => {
  const device = { certid: "A", ota: { state: "armed", pending: true } };
  const loading = translateAppFeedback("en", "otaDetailsPending"), failed = translateAppFeedback("en", "otaDetailsUnavailable");
  assert.ok(renderAdapterOta(device, undefined, helpers).includes(loading));
  for (const details of [null, { state: "armed", task: null }, { state: "armed", task }]) {
    assert.ok(!renderAdapterOta(device, details, helpers).includes(loading));
  }
  for (const details of [undefined, { state: "armed", task: null }, { state: "armed", task }]) {
    const html = renderAdapterOta(device, details, { ...helpers, error: true });
    assert.ok(html.includes(failed));
    assert.ok(!html.includes(loading));
    assert.match(html, button);
  }
});
await check("pending flag alone changes the list signature", () => {
  const device = { certid: "A", ota: { state: "expired", pending: false, updatedAt: time } };
  assert.notEqual(adapterListSignature([device], 1), adapterListSignature([{ ...device, ota: { ...device.ota, pending: true } }], 1));
});
await check("withdrawn summary or detail renders exactly the none state without history or loading copy", () => {
  const none = renderAdapterOta({ certid: "A", ota: { state: "none", pending: false } }, undefined, helpers);
  for (const summary of [undefined, "armed", "installed", "expired", "untasked"]) {
    for (const details of [undefined, { state: "armed", task }, { state: "untasked", task, stillPending: false }]) {
      if (summary !== "untasked" && details?.state !== "untasked") continue;
      const html = renderAdapterOta({ certid: "A", ota: { state: summary, updatedAt: time, pending: false } }, details, { ...helpers, error: true });
      assert.equal(html, none);
      assert.doesNotMatch(html, /<header>|<ol|timeline|test\.bin|data-adapter-action/);
      assert.ok(html.includes(translateAppFeedback("en", "otaNoTask")));
    }
  }
  for (const lang of ["zh", "en", "fr"]) {
    assert.notEqual(translateAppFeedback(lang, "otaState.untasked"), "otaState.untasked", "the legacy state key stays available");
  }
});
await check("withdrawn display still honors R3 pending cancellation and busy state", () => {
  const none = renderAdapterOta({ certid: "A", ota: { state: "none", pending: true } }, undefined, { ...helpers, actionBusy: true });
  for (const [summaryPending, detailPending] of [[true, false], [false, true]]) {
    const html = renderAdapterOta({ certid: "A", ota: { state: "untasked", pending: summaryPending } }, { state: "untasked", task, stillPending: detailPending }, { ...helpers, actionBusy: true });
    assert.equal(html, none);
    assert.match(html, button);
    assert.match(html, /data-adapter-id="A" disabled/);
  }
});
await check("loader skips none and untasked but continues fetching installed and expired history", async () => {
  const paths = [];
  const loader = createAdapterOtaLoader(async (path) => { paths.push(path); return { state: "installed" }; });
  const rows = ["none", "untasked", "installed", "expired", "armed"].map((state) => ({ certid: state, ota: { state } }));
  const result = await loader.load(rows);
  assert.deepEqual(paths.sort(), ["armed", "expired", "installed"].map((id) => `/devices/flash/${id}/ota`));
  assert.deepEqual(Object.keys(result.items).sort(), ["armed", "expired", "installed"]);
  assert.deepEqual(await loader.load(rows.slice(0, 2)), { items: {}, failed: [] });
  assert.equal(paths.length, 3);
});
await check("polling clears withdrawn cached detail and errors without another OTA request", () => withPage(async (f) => {
  assert.ok(f.state.adapters.ota.CERT_1);
  f.state.adapters.otaErrors.CERT_1 = true;
  const withdrawn = { ...f.row(), ota: { state: "untasked", pending: false, updatedAt: time } };
  f.setPayload({ items: [withdrawn], total: 1 });
  let calls = f.calls.length;
  await f.tick();
  assert.deepEqual(f.calls.slice(calls), ["/devices/flash?page=1&pageSize=20"]);
  assert.deepEqual(f.state.adapters.ota, {});
  assert.deepEqual(f.state.adapters.otaErrors, {});
  assert.equal(f.paints.at(-1).rows[0].ota.state, "untasked", "only presentation changes; server state stays intact");
  calls = f.calls.length;
  await f.tick();
  assert.deepEqual(f.calls.slice(calls), ["/devices/flash?page=1&pageSize=20"]);
}));
console.log(`DEVICE_PAGE_R2_R3_R4=${checks}/${checks}`);
