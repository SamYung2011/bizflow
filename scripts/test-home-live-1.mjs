import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8");

assert.match(home, /import \{ attachLiveSnapshotRefresh \} from "\.\.\/data\/live-snapshot-listener\.js"/);
for (const snapshot of [
  "home.json",
  "tasks.json",
  "home-order-metrics.json",
  "inventory.json",
  "warranty.json",
  "customers.json"
]) {
  assert.match(home, new RegExp(`HOME_LIVE_SNAPSHOTS[\\s\\S]*"${snapshot.replace(".", "\\.")}"`), `${snapshot} must refresh Home`);
}
for (const table of [
  "invoices",
  "employees",
  "employee_tasks",
  "warranty_renewals",
  "inventory_stock",
  "shopify_catalog_bindings",
  "shopify_variant_links",
  "shopify_resource_mappings"
]) {
  assert.match(home, new RegExp(`HOME_LIVE_TABLES[\\s\\S]*"${table}"`), `${table} updates must reach Home`);
}

const attachment = home.slice(
  home.indexOf("homeLiveRefresh = attachLiveSnapshotRefresh"),
  home.indexOf("if (typeof MutationObserver", home.indexOf("homeLiveRefresh = attachLiveSnapshotRefresh"))
);
assert.match(attachment, /scope,[\s\S]*snapshots: HOME_LIVE_SNAPSHOTS,[\s\S]*tables: HOME_LIVE_TABLES,[\s\S]*isBlocked: isHomeRefreshBlocked/);
assert.match(attachment, /const refreshedState = await loadHomeViewState\(\)[\s\S]*if \(!isCurrent\(\)\) return;[\s\S]*if \(isHomeRefreshBlocked\(\)\) \{[\s\S]*defer\(\);[\s\S]*return;[\s\S]*applyHomeViewState\(refreshedState\)[\s\S]*rerenderHome\(\)/,
  "Home must refetch, defer if UI became busy, then atomically rerender while the page is current");
assert.match(attachment, /rerenderHome\(\);[\s\S]*window\.dispatchEvent\(new CustomEvent\("tp:unread-change"\)\)/,
  "Home refresh must also resync the shell unread indicators");
assert.doesNotMatch(attachment, /homeTaskFilter\s*=|homeTaskFilterOpen\s*=/,
  "live refresh must preserve the selected task filter and its open state");

assert.match(home, /function isHomeRefreshBlocked\(\) \{[\s\S]*homeTaskFilterOpen[\s\S]*data-quick-create-portal[\s\S]*aria-busy/,
  "filter, quick-create, and busy interactions must defer live rerenders");
assert.match(home, /new MutationObserver\(flushHomeLiveRefresh\)[\s\S]*childList: true,[\s\S]*attributes: true,[\s\S]*attributeFilter: \["aria-busy"\]/,
  "closing a portal or clearing busy state must flush a deferred refresh");
assert.ok((home.match(/flushHomeLiveRefresh\(\);/g) ?? []).length >= 4,
  "every task-filter close path must flush deferred live data");

assert.match(home, /function rerenderHome[\s\S]*page\.outerHTML = renderHome\(homeHelpers\);[\s\S]*rebindHomeTeamActivity\?\.\(\)/,
  "rerendered team activity must retain its visible-read observer");
assert.match(home, /data-home-members[\s\S]*data\.members\.length[\s\S]*data\.members\.slice/,
  "the team widget must render from refreshed Home members");
assert.match(home, /data\.orders\.map\(orderRow\)/,
  "the order card must render from refreshed Home orders");

assert.match(home, /captureState: \(\) => \(\{ taskFilter: homeTaskFilter \}\)/,
  "the selected filter must remain in BF navigation state");
assert.match(home, /dispose\(\) \{[\s\S]*homeLiveRefresh = null;[\s\S]*rebindHomeTeamActivity = null;/,
  "Home disposal must release its refresh and observer callbacks");

console.log("HOME-live-1 contracts: PASS");
