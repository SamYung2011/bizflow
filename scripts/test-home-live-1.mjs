import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCustomersPageData } from "../root-site/data/provider.js";
import { updateProviderSnapshotMemo } from "../root-site/data/provider-snapshot-cache.js";

const [home, customers, provider, snapshots, phaseMigration] = await Promise.all([
  readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/102_bizflow_data_phase1.sql", import.meta.url), "utf8")
]);

assert.match(home, /import \{ attachLiveSnapshotRefresh \} from "\.\.\/data\/live-snapshot-listener\.js"/);
assert.match(home, /const HOME_LIVE_SNAPSHOTS = \[[\s\S]*"home\.json"[\s\S]*"customers\.json"[\s\S]*\];/,
  "the live dashboard must retain legacy snapshot retry wakeups for its RPC fallback path");
assert.match(home, /getHomeDashboardData\(\{ refresh \}\)/,
  "Home must refresh the bounded server dashboard query");
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
assert.match(attachment, /const refreshedState = await loadHomeViewState\(\{ refresh: true \}\)[\s\S]*if \(!isCurrent\(\)\) return;[\s\S]*if \(isHomeRefreshBlocked\(\)\) \{[\s\S]*defer\(\);[\s\S]*return;[\s\S]*applyHomeViewState\(refreshedState\)[\s\S]*rerenderHome\(\)/,
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
assert.match(home, /data-home-members[\s\S]*data\.membersStats\?\.all \?\? data\.members\.length[\s\S]*data\.members\.slice/,
  "the team widget must render from refreshed Home members");
assert.match(home, /data\.orders\.map\(orderRow\)/,
  "the order card must render from refreshed Home orders");

assert.match(home, /captureState: \(\) => \(\{ taskFilter: homeTaskFilter \}\)/,
  "the selected filter must remain in BF navigation state");
assert.match(home, /dispose\(\) \{[\s\S]*homeLiveRefresh = null;[\s\S]*rebindHomeTeamActivity = null;/,
  "Home disposal must release its refresh and observer callbacks");

assert.match(customers, /import \{ attachLiveSnapshotRefresh \} from "\.\.\/data\/live-snapshot-listener\.js"/);
const customersAttachment = customers.slice(
  customers.indexOf("customersLiveRefresh = attachLiveSnapshotRefresh"),
  customers.indexOf("if (typeof MutationObserver", customers.indexOf("customersLiveRefresh = attachLiveSnapshotRefresh"))
);
assert.match(customersAttachment, /scope,[\s\S]*snapshots: CUSTOMERS_LIVE_SNAPSHOTS,[\s\S]*tables: CUSTOMERS_LIVE_TABLES,[\s\S]*isBlocked: isCustomersRefreshBlocked/);
assert.match(customersAttachment, /const nextData = await getCustomersPageData\(\)[\s\S]*if \(!isCurrent\(\)\) return;[\s\S]*if \(isCustomersRefreshBlocked\(\)\) \{[\s\S]*defer\(\);[\s\S]*return;[\s\S]*data = nextData;[\s\S]*rerenderCustomersPage\(\{ preserveTextFocus: true \}\)/,
  "customer snapshot updates must refetch and rerender without replacing UI state");
assert.doesNotMatch(customersAttachment, /state\.(?:tab|sort|source|imei|search|page)\s*=|dateFilter\s*=/,
  "live customer refresh must preserve search, filters, page, tab, and date-filter state");
assert.match(customers, /function isCustomersRefreshBlocked\(\)[\s\S]*state\.writeBusy[\s\S]*state\.modalOpen[\s\S]*data-date-range-panel[\s\S]*data-customers-filter-popover/,
  "open writes, filters, and calendar panels must defer customer rerenders");
assert.match(customers, /new MutationObserver\(flushCustomersLiveRefresh\)[\s\S]*attributeFilter: \["aria-busy", "class"\]/,
  "closing a customer UI blocker must flush deferred live data");
assert.match(customers, /captureCustomersTextFocus[\s\S]*selectionStart[\s\S]*restoreCustomersTextFocus[\s\S]*setSelectionRange/,
  "an active customer or warranty search must retain focus and caret across live rerenders");
assert.match(customers, /captureState\(\) \{[\s\S]*search: state\.search,[\s\S]*page: state\.page,[\s\S]*dateFilter: dateFilter\.captureState/);
assert.match(customers, /dispose\(\) \{[\s\S]*customersLiveRefresh = null;/,
  "customer page disposal must release its scoped refresh handle");

assert.match(phaseMigration, /SECURITY INVOKER[\s\S]*bizflow_customer_group_count\(\)[\s\S]*WITH RECURSIVE trim_chars AS MATERIALIZED[\s\S]*normalized AS MATERIALIZED[\s\S]*edge_nodes/,
  "the Home customer KPI must preserve the virtual-group algorithm behind RLS");
assert.match(provider, /const dashboardCustomerCount = grouped\.length;/,
  "the customer KPI must count every persisted customer group");
assert.doesNotMatch(provider.slice(provider.indexOf("export async function getCustomersPageData"), provider.indexOf("export async function getCustomerMergeCandidates")),
  /grouped\.filter\(\(customer\) => customer\.has/,
  "name-only customers must not disappear behind a contact-field gate");
assert.match(snapshots, /\{ key: "customers", tone: "blue", value: customersSnapshot\.customers\.length \}/,
  "the live Home snapshot must use the same all-customer KPI contract");

const customerRow = (id, name, phone = "") => ({
  id,
  name,
  phone,
  source: "other",
  joinedAt: "2026/07/22",
  imei: "",
  orderCount: 0,
  detail: { email: "", orders: [] }
});
updateProviderSnapshotMemo("customers.json", { __live: true, customers: [customerRow("contact", "Contact", "+852 1")] });
assert.equal((await getCustomersPageData()).dashboardCustomerCount, 1);
updateProviderSnapshotMemo("customers.json", {
  __live: true,
  customers: [customerRow("contact", "Contact", "+852 1"), customerRow("name-only", "Name only")]
});
const refreshedCustomers = await getCustomersPageData();
assert.equal(refreshedCustomers.dashboardCustomerCount, 2, "a refreshed name-only customer must increment the Home KPI");
assert.ok(refreshedCustomers.customers.some((customer) => customer.id === "name-only"),
  "a refreshed name-only customer must remain searchable in the customer list");

console.log("HOME-live-1 contracts: PASS (Home + customers live refresh, state preservation, all-customer KPI)");
