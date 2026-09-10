import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDateRangePanel } from "../root-site/components/date-range-panel.js";
import { normalizeDateInput } from "../root-site/components/date-value.js";
import { assertHonnmonoAdminRequest } from "../root-site/bizflow/app-feedback-api.js";
import { adapterSessionSubPath, adapterSessionMinDate } from "../root-site/bizflow/app-feedback.js";
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

const source = await readFile(new URL("../root-site/bizflow/app-feedback.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `production section ${start} exists`);
  return source.slice(from, to);
}
function pageFixture(kind = "flash") {
  const calls = [], panel = { options: null, refreshed: 0, closed: 0, open(options) { this.options = options; }, refresh() { this.refreshed++; }, close() { this.closed++; } };
  let active = true, responder = async (path) => path.includes("/days?")
    ? { month: new URL(path, "https://test.invalid").searchParams.get("month"), days: { "2026-09-09": 2 }, latestDay: "2026-09-09" }
    : { items: [], total: 0 };
  const scope = { signal: new AbortController().signal };
  const production = section("function createAdapterDeviceState", "function adapterPageCount") + section("async function loadAdapterSessions", "async function beginAdapterAction");
  const make = new Function("callHonnmonoAdmin", "activeScope", "adapterSessionSubPath", "adapterSessionMinDate", "normalizeDateInput", "adapterSessionDatePanel", "isActive", "kind", `
    const PAGE_SIZE = 20, activeInstance = 1, helpers = { lang: 'en' };
    const currentHongKongDate = () => '2026-09-10', t = (key) => key;
    const rerender = () => {};
    ${section("function adapterDeviceId", "function ")}
    ${production}
    const state = { adapters: createAdapterDeviceState({ adapterKind: kind }) };
    state.adapters.rows = [{ certid: 'A', uuid: 'A' }, { certid: 'B', uuid: 'B' }];
    return { state, openAdapterSessions, closeAdapterSessions, openAdapterSessionDatePanel, loadAdapterSessionDays };
  `);
  const page = make(async (path) => { assertHonnmonoAdminRequest(path); calls.push(path); return responder(path); }, scope, adapterSessionSubPath, adapterSessionMinDate, normalizeDateInput, panel, () => active, kind);
  return { ...page, calls, panel, respond(fn) { responder = fn; }, deactivate() { active = false; } };
}

await check("both device kinds fetch the current-month days before sessions and default to latestDay", async () => {
  for (const kind of ["flash", "dc-pro"]) {
    const f = pageFixture(kind);
    await f.openAdapterSessions("A");
    assert.deepEqual(f.calls, [`/devices/${kind}/A/sessions/days?month=2026-09`, `/devices/${kind}/A/sessions?${new URLSearchParams({ page: "1", pageSize: "20", date: "2026-09-09" })}`]);
    assert.equal(f.state.adapters.detailDate, "2026-09-09");
  }
});

await check("no records and days failures preserve today/all fallbacks without blocking sessions", async () => {
  for (const kind of ["flash", "dc-pro"]) {
    for (const fails of [false, true]) {
      const f = pageFixture(kind);
      f.respond(async (path) => {
        if (!path.includes("/days?")) return { items: [], total: 0 };
        if (fails) throw new Error("offline");
        return { month: "2026-09", days: {}, latestDay: null };
      });
      await f.openAdapterSessions("A");
      assert.equal(f.state.adapters.detailDate, kind === "flash" ? "2026-09-10" : "");
      assert.equal(f.state.adapters.sessionError, null);
      assert.equal(f.calls.length, 2);
    }
  }
});

await check("calendar reads cached counts, loads a viewed month, refreshes and clears failed-month status", async () => {
  const f = pageFixture();
  await f.openAdapterSessions("A");
  f.openAdapterSessionDatePanel({});
  const options = f.panel.options;
  assert.equal(options.dayStatus("2026-09-09"), "available");
  assert.equal(options.dayStatus("2026-09-08"), "empty");
  assert.equal(options.dayStatus("2026-08-31"), undefined);
  f.respond(async () => ({ month: "2026-08", days: { "2026-08-31": 1 }, latestDay: "2026-09-09" }));
  await options.onViewMonthChange("2026-08");
  assert.equal(f.calls.at(-1), "/devices/flash/A/sessions/days?month=2026-08");
  assert.equal(f.panel.refreshed, 1);
  assert.equal(options.dayStatus("2026-08-31"), "available");
  f.respond(async () => { throw new Error("offline"); });
  await options.onViewMonthChange("2026-08");
  assert.equal(options.dayStatus("2026-08-31"), undefined);
  assert.equal(options.dayStatus("2026-09-08"), "empty");
});

await check("closing or switching devices while days are in flight cannot reopen or overwrite the drawer", async () => {
  const f = pageFixture();
  let resolveA;
  f.respond(async (path) => path.includes("/A/sessions/days") ? new Promise((resolve) => { resolveA = resolve; }) : path.includes("/days?") ? { month: "2026-09", days: { "2026-09-02": 1 }, latestDay: "2026-09-02" } : { items: [], total: 0 });
  const opening = f.openAdapterSessions("A");
  f.closeAdapterSessions();
  await f.openAdapterSessions("B");
  resolveA({ month: "2026-09", days: { "2026-09-09": 1 }, latestDay: "2026-09-09" });
  await opening;
  assert.equal(f.state.adapters.detailDevice.certid, "B");
  assert.equal(f.state.adapters.detailDate, "2026-09-02");
  assert.equal(f.calls.filter((path) => path.includes("/A/sessions?")).length, 0);
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
