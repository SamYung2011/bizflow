import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { createDateRangeFilter } from "../root-site/components/date-range-filter.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = (lang) => ({
  escapeHtml,
  icon: (name, className) => `<svg data-icon="${name}" class="${className}"></svg>`,
  lang
});

const filter = createDateRangeFilter({ id: "contract", initialDate: "2026-07-20" });
assert.match(filter.render(helpers("zh")), /全部時間/);
assert.match(filter.render(helpers("en")), /All time/);
assert.match(filter.render(helpers("fr")), /Toutes les dates/);
assert.equal(filter.matches("2026-07-01"), true, "empty range must preserve all-time behavior");

assert.equal(filter.restoreState({ from: "2026-07-20", to: "2026-07-01", endDateEnabled: true }), true);
assert.deepEqual(
  filter.captureState(),
  {
    from: "2026-07-01",
    to: "2026-07-20",
    focus: "from",
    endDateEnabled: true,
    calendarMonth: "2026-07-01"
  },
  "BF history restore must normalize and round-trip the selected range"
);
assert.equal(filter.matches("2026-07-01"), true);
assert.equal(filter.matches("2026-07-20"), true);
assert.equal(filter.matches("2026-07-21"), false);

const restoredLegacySingle = createDateRangeFilter();
restoredLegacySingle.restoreState({ from: "2026-07-15", to: "", endDateEnabled: false });
assert.equal(restoredLegacySingle.matches("2026-07-15"), true);
assert.equal(restoredLegacySingle.matches("2026-07-16"), false, "legacy one-day state must not widen into an open-ended range");

const pagePaths = [
  "../root-site/bizflow/orders.js",
  "../root-site/bizflow/customers.js",
  "../root-site/bizflow/whatsapp.js",
  "../root-site/bizflow/ocpp-charging.js",
  "../root-site/bizflow/ocpp-monitor.js"
];
const [filterSource, panelSource, manifestSource, ...pageSources] = await Promise.all([
  readFile(new URL("../root-site/components/date-range-filter.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/components/date-range-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/spa/route-manifest.js", import.meta.url), "utf8"),
  ...pagePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8"))
]);

for (const [index, source] of pageSources.entries()) {
  assert.match(source, /components\/date-range-filter\.js/, `${pagePaths[index]} must use the shared blue range filter`);
  assert.doesNotMatch(source, /event\.target\.closest\??\.?\("\[data-date-range-panel\]"\)/, `${pagePaths[index]} must not infer portal containment after panel rerenders`);
  assert.doesNotMatch(source, /components\/date-filter\.js/, `${pagePaths[index]} must not load the retired calendar`);
}
assert.doesNotMatch(pageSources[0], /if \(!event\.target\.closest\("\[data-date-range-filter\]"\)\) dateFilter\.close\(\)/, "orders must leave outside-close to the portal");
assert.doesNotMatch(pageSources[1], /if \(!event\.target\.closest\("\[data-date-range-filter\]"\)\) dateFilter\.close\(\)/, "customers must leave outside-close to the portal");
assert.doesNotMatch(pageSources[2], /if \(!root\) \{[\s\S]*?DateFilter\.close\(\)/, "WhatsApp must not close portal filters from page-level outside clicks");
assert.doesNotMatch(pageSources[3], /else orderDate\.close\(\)/, "OCPP charging must leave outside-close to the portal");
assert.doesNotMatch(pageSources[4], /else \{\s*logDate\.close\(\);\s*alarmDate\.close\(\)/, "OCPP monitor must leave outside-close to the portal");
assert.match(filterSource, /zh:[\s\S]*en:[\s\S]*fr:/, "range trigger and panel copy must cover all three languages");
assert.match(filterSource, /presets = \["all"\]/, "all-time must be the common top shortcut");
assert.match(pageSources[4], /presets: \["all", "last7"\]/, "OCPP logs must retain the last-7-days shortcut inside the panel");
assert.match(panelSource, /draft\.start \|\| draft\.end \|\| viewDate/, "empty filters must open on the latest available data month");
assert.match(panelSource, /panel\?\.contains\(event\.target\) \|\| anchor\?\.contains\(event\.target\)/, "the shared portal must remain the sole outside-click owner");

for (const route of ["orders", "customers", "whatsapp", "ocpp-monitor", "ocpp-charging"]) {
  assert.match(manifestSource, new RegExp(`${route}\\.html[\\s\\S]*?date-range-panel\\.css`), `${route} SPA route must load the blue panel styles`);
}

await assert.rejects(access(new URL("../root-site/components/date-filter.js", import.meta.url)), "retired date filter JavaScript must be deleted");
await assert.rejects(access(new URL("../root-site/components/date-filter.css", import.meta.url)), "retired date filter CSS must be deleted");

console.log("NB-ux-6 batch 2 contracts: PASS (five pages, seven filters, presets, BF restore, legacy calendar removed)");
