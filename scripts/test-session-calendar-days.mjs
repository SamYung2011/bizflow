import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dateRangePanelCopy } from "../root-site/components/date-range-panel-i18n.js";
import { translateAppFeedback } from "../root-site/bizflow/app-feedback-i18n.js";
import { renderAdapterLocation, renderAdapterOta } from "../root-site/bizflow/app-feedback-device-live.js";
import { createDateRangePanel } from "../root-site/components/date-range-panel.js";
import { normalizeDateInput } from "../root-site/components/date-value.js";
import { assertHonnmonoAdminRequest, formatFeedbackTime } from "../root-site/bizflow/app-feedback-api.js";
import { adapterSessionSubPath, adapterSessionMinDate, flashUnbindDisabled, adapterActionsForKind } from "../root-site/bizflow/app-feedback.js";
import { legacyCalendarTrace, withCalendar } from "./helpers/date-panel-fixture.mjs";

let checks = 0;
async function check(name, run) { await run(); console.log(`session-calendar ${++checks}: ${name}`); }
const baseline = JSON.parse(await readFile(new URL("./fixtures/date-range-panel-48c5134.json", import.meta.url), "utf8"));
await check("default HTML and commits match the frozen 48c5134 baseline in three languages", () => {
  assert.deepEqual(legacyCalendarTrace(createDateRangePanel), baseline.outputs);
});

await check("available days have dots; empty days are disabled and cannot be committed", () => withCalendar(createDateRangePanel, (f) => {
  const commits = [];
  f.open({ mode: "single", dayStatus: (day) => day === "2026-09-09" ? "available" : "empty", onCommit: (value) => commits.push(value) });
  const available = f.panel.querySelector('[data-date-range-day="2026-09-09"]');
  const empty = f.panel.querySelector('[data-date-range-day="2026-09-08"]');
  assert.match(available.getAttribute("class"), /has-record/);
  assert.equal(available.disabled, false);
  assert.match(f.panel.innerHTML, /data-date-range-day="2026-09-09"[^>]*><span>9<\/span><i class="date-range-panel__dot"><\/i>/);
  assert.equal(empty.disabled, true);
  assert.match(empty.getAttribute("class"), /is-empty/);
  f.click('[data-date-range-day="2026-09-08"]');
  assert.deepEqual(commits, []);
  f.click('[data-date-range-day="2026-09-09"]');
  assert.deepEqual(commits, [{ date: "2026-09-09" }]);
}));

await check("refresh applies fetched statuses without a new month notification and preserves usable focus", () => withCalendar(createDateRangePanel, (f) => {
  const months = [];
  let loaded = false;
  f.open({ mode: "single", dayStatus: (day) => loaded ? day.endsWith("-09") ? "available" : "empty" : undefined, onViewMonthChange: (month) => months.push(month) });
  f.panel.querySelector('[data-date-range-day="2026-09-08"]').focus();
  loaded = true;
  f.api.refresh();
  assert.equal(f.document.activeElement.disabled, false);
  assert.equal(f.document.activeElement.getAttribute("data-date-range-day"), "2026-09-09");
  assert.deepEqual(months, ["2026-09"]);
  f.api.close();
  const html = f.panel.innerHTML;
  loaded = false;
  f.api.refresh();
  assert.equal(f.panel.innerHTML, html);
}));

await check("open, month navigation and year changes each notify once; reopening resets optional behavior", () => withCalendar(createDateRangePanel, (f) => {
  const months = [];
  f.open({ onViewMonthChange: (month) => months.push(month), dayStatus: () => "empty" });
  f.click('[data-date-range-action="previous"]');
  f.click('[data-date-range-action="next"]');
  f.click('[data-date-range-action="jump"]');
  f.year("2025");
  f.click('[data-date-range-month="11"]');
  assert.deepEqual(months, ["2026-09", "2026-08", "2026-09", "2025-09", "2025-12"]);
  f.open();
  assert.doesNotMatch(f.panel.innerHTML, /is-empty|has-record|date-range-panel__dot/);
  assert.equal(months.length, 5);
}));

await check("unknown status retains old selectable behavior and available cannot bypass minDate", () => withCalendar(createDateRangePanel, (f) => {
  f.open({ minDate: "2026-09-02", dayStatus: (day) => day === "2026-09-01" ? "available" : undefined });
  assert.equal(f.panel.querySelector('[data-date-range-day="2026-09-01"]').disabled, true);
  assert.equal(f.panel.querySelector('[data-date-range-day="2026-09-02"]').disabled, false);
}));

await check("empty-month refresh focuses navigation and does not replace an edited year input", () => withCalendar(createDateRangePanel, (f) => {
  let empty = false;
  f.open({ dayStatus: () => empty ? "empty" : undefined, onViewMonthChange: () => {} });
  f.panel.querySelector('[data-date-range-day="2026-09-08"]').focus();
  empty = true;
  f.api.refresh();
  assert.equal(f.document.activeElement.getAttribute("data-date-range-action"), "next");
  f.click('[data-date-range-action="jump"]');
  const input = f.panel.querySelector("[data-date-range-year]");
  input.value = "202";
  f.api.refresh();
  assert.equal(f.panel.querySelector("[data-date-range-year]"), input);
  assert.equal(input.value, "202");
  f.year("2025");
  assert.equal(f.panel.querySelector("[data-date-range-year]"), input);
}));

await check("loading month has localized status, selectable undotted days, then refreshes to records", () => {
  for (const language of ["zh", "en", "fr"]) withCalendar(createDateRangePanel, (f) => {
    let loading = true;
    f.open({ language, dayStatus: (day) => loading ? "loading" : day.endsWith("-09") ? "available" : "empty" });
    assert.ok(f.panel.innerHTML.includes(dateRangePanelCopy[language].loadingDays));
    assert.match(f.panel.innerHTML, /class="date-range-panel__loading" role="status"/);
    assert.doesNotMatch(f.panel.innerHTML, /date-range-panel__dot|is-empty/);
    assert.equal(f.panel.querySelector('[data-date-range-day="2026-09-08"]').disabled, false);
    loading = false;
    f.api.refresh();
    assert.doesNotMatch(f.panel.innerHTML, /date-range-panel__loading/);
    assert.equal(f.panel.querySelector('[data-date-range-day="2026-09-08"]').disabled, true);
    assert.match(f.panel.innerHTML, /date-range-panel__dot/);
  });
});

await check("year chooser updates loading status without replacing the input", () => withCalendar(createDateRangePanel, (f) => {
  let loading = false;
  f.open({ language: "en", dayStatus: () => loading ? "loading" : undefined, onViewMonthChange: () => {} });
  f.click('[data-date-range-action="jump"]');
  const input = f.panel.querySelector("[data-date-range-year]");
  input.value = "2025";
  loading = true;
  f.api.refresh();
  assert.equal(f.panel.querySelector("[data-date-range-loading]").textContent, "Loading…");
  assert.equal(f.panel.querySelector("[data-date-range-year]"), input);
  loading = false;
  f.api.refresh();
  assert.equal(f.panel.querySelector("[data-date-range-loading]"), null);
  assert.equal(input.value, "2025");
}));

const source = await readFile(new URL("../root-site/bizflow/app-feedback.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `production section ${start} exists`);
  return source.slice(from, to);
}
function pageFixture(kind = "flash") {
  const calls = [], paints = [], panel = { options: null, refreshed: 0, closed: 0, open(options) { this.options = options; }, refresh() { this.refreshed++; }, close() { this.closed++; } };
  let active = true, responder = async (path) => path.includes("/days?")
    ? { month: new URL(path, "https://test.invalid").searchParams.get("month"), days: { "2026-09-09": 2 }, latestDay: "2026-09-09" }
    : { date: "2026-09-09", days: { "2026-09-09": 2 }, latestDay: "2026-09-09", items: [{ id: 1 }], total: 2 };
  const scope = { signal: new AbortController().signal };
  const production = section("function createAdapterDeviceState", "function adapterPageCount") + section("async function loadAdapterSessions", "async function beginAdapterAction");
  const make = new Function("callHonnmonoAdmin", "activeScope", "adapterSessionSubPath", "adapterSessionMinDate", "normalizeDateInput", "adapterSessionDatePanel", "isActive", "kind", "paints", "calls", `
    const PAGE_SIZE = 20, activeInstance = 1, helpers = { lang: 'en' };
    const currentHongKongDate = () => '2026-09-10', t = (key) => key;
    const rerender = () => paints.push({ loading: state.adapters.sessionLoading, date: state.adapters.detailDate, calls: calls.length });
    ${section("function adapterDeviceId", "function ")}
    ${production}
    const state = { adapters: createAdapterDeviceState({ adapterKind: kind }) };
    state.adapters.rows = [{ certid: 'A', uuid: 'A' }, { certid: 'B', uuid: 'B' }];
    return { state, openAdapterSessions, closeAdapterSessions, openAdapterSessionDatePanel, loadAdapterSessionDays, loadAdapterSessions };
  `);
  const page = make(async (path) => { assertHonnmonoAdminRequest(path); calls.push(path); return responder(path); }, scope, adapterSessionSubPath, adapterSessionMinDate, normalizeDateInput, panel, () => active, kind, paints, calls);
  return { ...page, calls, paints, panel, respond(fn) { responder = fn; }, deactivate() { active = false; } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; }
const sessionPayload = (date = "2026-09-09") => ({ date, days: date ? { [date]: 2 } : {}, latestDay: date || null, items: [{ id: 1 }], total: 2 });

await check("opening makes one latest session request; only after paint does prior-month prefetch start", async () => {
  for (const kind of ["flash", "dc-pro"]) {
    const f = pageFixture(kind), response = deferred();
    f.respond(async (path) => path.includes("/days?") ? { month: "2026-08", days: {}, latestDay: "2026-09-09" } : response.promise);
    const opening = f.openAdapterSessions("A");
    assert.deepEqual(f.calls, [`/devices/${kind}/A/sessions?page=1&pageSize=20&date=latest`]);
    assert.equal(f.state.adapters.sessionLoading, true);
    response.resolve(sessionPayload());
    await opening;
    await settle();
    assert.equal(f.state.adapters.detailDate, "2026-09-09");
    assert.deepEqual(f.state.adapters.sessions, [{ id: 1 }]);
    assert.equal(f.state.adapters.sessionTotal, 2);
    assert.deepEqual(f.state.adapters.sessionDays.A["2026-09"].days, { "2026-09-09": 2 });
    assert.equal(f.calls[1], `/devices/${kind}/A/sessions/days?month=2026-08`);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.paints.at(-1), { loading: false, date: "2026-09-09", calls: 1 });
  }
});

await check("cached calendar month makes zero requests and retains cache across close and other devices", async () => {
  const f = pageFixture();
  await f.openAdapterSessions("A"); await settle();
  f.openAdapterSessionDatePanel({});
  const count = f.calls.length;
  await f.panel.options.onViewMonthChange("2026-09");
  assert.equal(f.calls.length, count);
  assert.equal(f.panel.options.dayStatus("2026-09-09"), "available");
  assert.equal(f.panel.options.dayStatus("2026-09-08"), "empty");
  const cache = f.state.adapters.sessionDays.A;
  f.closeAdapterSessions();
  await f.openAdapterSessions("B"); await settle();
  assert.equal(f.state.adapters.sessionDays.A, cache);
  assert.ok(f.state.adapters.sessionDays.B);
});

await check("month navigation shares pending prefetch, shows loading immediately and prefetches M-1 after M", async () => {
  const f = pageFixture(), august = deferred();
  f.respond(async (path) => path.includes("month=2026-08") ? august.promise : path.includes("/days?") ? { month: "2026-07", days: {}, latestDay: "2026-09-09" } : sessionPayload());
  await f.openAdapterSessions("A"); await settle();
  f.openAdapterSessionDatePanel({});
  const next = f.panel.options.onViewMonthChange("2026-08");
  assert.equal(f.panel.options.dayStatus("2026-08-31"), "loading");
  assert.ok(f.panel.refreshed > 0);
  await settle();
  assert.equal(f.calls.filter((path) => path.includes("month=2026-08")).length, 1);
  assert.equal(f.calls.some((path) => path.includes("month=2026-07")), false);
  august.resolve({ month: "2026-08", days: { "2026-08-31": 1 }, latestDay: "2026-09-09" });
  await next; await settle();
  assert.equal(f.panel.options.dayStatus("2026-08-31"), "available");
  assert.equal(f.panel.options.dayStatus("2026-08-30"), "empty");
  assert.equal(f.calls.at(-1), "/devices/flash/A/sessions/days?month=2026-07");
  assert.equal(f.calls.length, 3, "prefetch stops after one preceding month");
});

await check("uncached month loads once and prefetch failures are silent and leave days selectable", async () => {
  const f = pageFixture();
  f.respond(async (path) => { if (path.includes("/days?")) throw new Error("offline"); return sessionPayload(); });
  await f.openAdapterSessions("A"); await settle();
  assert.equal(f.state.adapters.sessionError, null);
  assert.equal(f.state.adapters.sessionLoading, false);
  f.openAdapterSessionDatePanel({});
  const count = f.calls.length;
  await f.panel.options.onViewMonthChange("2026-09");
  assert.equal(f.calls.length, count, "cache hit never retries a failed previous-month prefetch");
  await f.panel.options.onViewMonthChange("2026-07");
  assert.equal(f.calls.filter((path) => path.includes("month=2026-07")).length, 1);
  assert.equal(f.panel.options.dayStatus("2026-07-01"), undefined);
  assert.equal(f.state.adapters.sessionError, null);
  assert.equal(f.calls.some((path) => path.includes("month=2026-06")), false);
});

await check("selected month prefetch crosses years and concrete-date loads refresh the matching cache", async () => {
  const f = pageFixture();
  f.respond(async (path) => path.includes("/days?") ? { month: new URL(path, "https://test.invalid").searchParams.get("month"), days: {}, latestDay: "2026-01-09" } : sessionPayload("2026-01-09"));
  await f.openAdapterSessions("A"); await settle();
  assert.equal(f.calls.at(-1), "/devices/flash/A/sessions/days?month=2025-12");
  f.state.adapters.detailDate = "2026-08-31";
  f.respond(async (path) => path.includes("/days?") ? { month: "2026-07", days: {}, latestDay: "2026-08-31" } : sessionPayload("2026-08-31"));
  await f.loadAdapterSessions(); await settle();
  assert.ok(f.calls.includes("/devices/flash/A/sessions?page=1&pageSize=20&date=2026-08-31"));
  assert.deepEqual(f.state.adapters.sessionDays.A["2026-08"].days, { "2026-08-31": 2 });
});

await check("no records preserve today/all response dates and cache the current empty month", async () => {
  for (const kind of ["flash", "dc-pro"]) {
    const f = pageFixture(kind), date = kind === "flash" ? "2026-09-10" : "";
    f.respond(async (path) => path.includes("/days?") ? { month: "2026-08", days: {}, latestDay: null } : { date, days: {}, latestDay: null, items: [], total: 0 });
    await f.openAdapterSessions("A"); await settle();
    assert.equal(f.state.adapters.detailDate, date);
    assert.deepEqual(f.state.adapters.sessionDays.A["2026-09"].days, {});
    assert.equal(f.state.adapters.sessionTotal, 0);
  }
});

await check("closing or switching devices while sessions are in flight cannot reopen or overwrite the drawer", async () => {
  const f = pageFixture(), old = deferred();
  f.respond(async (path) => path.includes("/A/sessions?") ? old.promise : path.includes("/days?") ? { month: "2026-08", days: {}, latestDay: "2026-09-02" } : sessionPayload("2026-09-02"));
  const opening = f.openAdapterSessions("A");
  f.closeAdapterSessions();
  await f.openAdapterSessions("B");
  old.resolve(sessionPayload());
  await opening; await settle();
  assert.equal(f.state.adapters.detailDevice.certid, "B");
  assert.equal(f.state.adapters.detailDate, "2026-09-02");
  assert.equal(f.state.adapters.sessionDays.A, undefined);
  assert.equal(f.calls.filter((path) => path.includes("/A/sessions/days")).length, 0);
});

await check("failed session read exits loading and sends no calendar prefetch", async () => {
  const f = pageFixture();
  f.respond(async () => { throw new Error("offline"); });
  await f.openAdapterSessions("A"); await settle();
  assert.equal(f.state.adapters.sessionLoading, false);
  assert.ok(f.state.adapters.sessionError);
  assert.equal(f.calls.length, 1);
});

await check("cards render missing firmware as a dash and separate count labels from values in three languages", () => {
  const renderCards = new Function("state", "helpers", "t", "renderAdapterLocation", "renderAdapterOta", "formatFeedbackTime", "flashUnbindDisabled", "adapterActionsForKind", `
    ${section("function e(", "function pageCount")}
    ${section("function detailRow", "function detailSection")}
    ${section("function adapterDeviceId", "function renderAdapterActionConfirm").replaceAll("export function", "function")}
    return renderAdapterCards();
  `);
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  for (const lang of ["zh", "en", "fr"]) {
    const t = (key, values) => translateAppFeedback(lang, key, values);
    for (const [kind, firmware, expected] of [["flash", {}, "—"], ["flash", { software: "" }, "—"], ["flash", undefined, "—"], ["flash", { software: "V900.6" }, "V900.6"], ["dc-pro", "v3.20", "v3.20"]]) {
      const state = { adapters: { kind, rows: [{ certid: "A", firmware, chargeCount: 3 }], ota: {}, otaErrors: {} } };
      const html = renderCards(state, { lang, escapeHtml }, t, renderAdapterLocation, renderAdapterOta, formatFeedbackTime, flashUnbindDisabled, adapterActionsForKind);
      assert.ok(html.includes(`<dt>${escapeHtml(t("softwareVersion"))}</dt><dd>${expected}</dd>`));
      assert.ok(html.includes(`<dt>${escapeHtml(t("chargeCountLabel"))}</dt><dd>${escapeHtml(t("chargeCountValue", { count: 3 }))}</dd>`));
      assert.doesNotMatch(html, /\[object Object\]|\{count\}/);
    }
  }
});

await check("API allows only GET session-days routes for supported device kinds", () => {
  for (const kind of ["flash", "dc-pro"]) {
    const path = `/devices/${kind}/A/sessions/days?month=2026-09`;
    assert.doesNotThrow(() => assertHonnmonoAdminRequest(path));
    for (const method of ["POST", "PUT", "DELETE"]) assert.throws(() => assertHonnmonoAdminRequest(path, method));
  }
  for (const path of ["/devices/other/A/sessions/days", "/devices/flash/A/sessions/days/extra", "/devices/flash/%2e%2e/sessions/days"]) assert.throws(() => assertHonnmonoAdminRequest(path));
});

console.log(`SESSION_CALENDAR_DAYS=${checks}/${checks}`);
