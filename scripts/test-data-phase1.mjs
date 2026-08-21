import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildCustomerGroups } from "../root-site/data/customer-groups.js";
import { compareHomeMetricSets } from "../root-site/data/home-metric-parity.js";
import { resolveLiveQueryOrLegacy, resolveOrderPageRead } from "../root-site/data/live-query-fallback.js";
import {
  clearLiveQueryCache,
  invalidateLiveQueryCacheAfterWrite,
  liveQueryCachePolicy,
  liveQueryKey,
  markLiveQueryCacheStale,
  readLiveQueryCache,
  writeLiveQueryCache
} from "../root-site/data/live-query-cache.js";
import { normalizeOrderQuery, ORDER_PAGE_SIZE } from "../root-site/data/live-orders-query.js";
import { completePasswordSignIn, readSignedInUser } from "../root-site/login/signed-in-user.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [migration, guardMigration, repairMigration, patchMigration, orders, revenue, orderQuery, orderWrites, liveHome, provider, home, customers, tasks, pending, customerDetail, itemMap] = await Promise.all([
  read("migrations/102_bizflow_data_phase1.sql"),
  read("migrations/103_guard_non_array_invoice_items.sql"),
  read("migrations/104_bizflow_data_phase1_r5.sql"),
  read("migrations/105_bizflow_warranty_revenue_gate.sql"),
  read("root-site/bizflow/orders.js"),
  read("root-site/bizflow/orders-revenue.js"),
  read("root-site/data/live-orders-query.js"),
  read("root-site/data/live-orders-writes.js"),
  read("root-site/data/live-home-query.js"),
  read("root-site/data/provider.js"),
  read("root-site/bizflow/home.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/team/tasks.js"),
  read("root-site/bizflow/inventory-pending.js"),
  read("root-site/bizflow/customer-detail.js"),
  read("root-site/bizflow/inventory-item-map.js")
]);

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

const executableRepairMigration = stripSqlComments(repairMigration);
assert.doesNotMatch(executableRepairMigration, /SECURITY\s+DEFINER/i,
  "R5 must not bypass table RLS");
assert.match(executableRepairMigration, /invoice_keys AS MATERIALIZED[\s\S]*page_keys AS MATERIALIZED/,
  "order paging must deduplicate and page narrow invoice keys before expanding fat items");
assert.match(executableRepairMigration, /invoice_lines AS MATERIALIZED/,
  "Home must expand fat invoice JSON once and reuse the materialized line set");
assert.match(executableRepairMigration, /bizflow_item_search_text[\s\S]*GENERATED ALWAYS AS/,
  "item search must read a write-time normalized projection instead of fat invoice JSON");
assert.doesNotMatch(executableRepairMigration, /invoice\.items::text/,
  "order search must never serialize every Shopify payload at request time");
assert.match(executableRepairMigration, /CREATE OR REPLACE FUNCTION public\.bizflow_unread_summary[\s\S]*FROM public\.invoices/,
  "unread counts must use narrow invoice keys directly");
const repairedUnread = executableRepairMigration.slice(executableRepairMigration.indexOf("CREATE OR REPLACE FUNCTION public.bizflow_unread_summary"));
assert.doesNotMatch(repairedUnread, /bizflow_order_list/,
  "unread counts must not re-enter the fat legacy order view");
assert.match(executableRepairMigration, /JOIN customer_groups AS customer_group ON customer_group\.member_id = invoice\.customer_id/,
  "the warranty KPI must use the exact legacy customer-group membership map");

const executablePatchMigration = stripSqlComments(patchMigration);
assert.doesNotMatch(executablePatchMigration, /SECURITY\s+DEFINER/i,
  "the warranty/revenue patch must not bypass table RLS");
assert.equal((executablePatchMigration.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 2,
  "migration 105 must only replace the reviewed revenue and Home functions");
assert.match(executablePatchMigration,
  /CREATE OR REPLACE FUNCTION public\.bizflow_order_revenue[\s\S]*employee\.user_id = auth\.uid\(\)[\s\S]*employee\.is_admin = true OR employee\.can_view_revenue = true[\s\S]*WHERE access\.allowed/,
  "the revenue RPC must gate its original aggregate on the signed-in employee's UI-equivalent permission");
assert.match(executablePatchMigration,
  /warranty_trim_chars AS MATERIALIZED[\s\S]*lower\(btrim\([\s\S]*product\.name[\s\S]*lower\(btrim\([\s\S]*line\.item->>'name'/,
  "both product and legacy item names must use the ECMAScript-trim character set before warranty matching");

assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /SECURITY\s+DEFINER/i, "phase 1 must not bypass RLS");
assert.match(migration, /bizflow_order_list[\s\S]*security_invoker = true/);
assert.match(migration, /bizflow_order_page[\s\S]*SECURITY INVOKER[\s\S]*LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 50\)/);
assert.match(migration, /bizflow_home_dashboard[\s\S]*SECURITY INVOKER/);
assert.match(migration, /bizflow_order_revenue[\s\S]*SECURITY INVOKER/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.bizflow_home_dashboard\(uuid\) FROM PUBLIC, anon/);
assert.doesNotMatch(migration, /CREATE INDEX IF NOT EXISTS invoices_order_page_/,
  "phase 1 must not ship the five write-cost indexes that the paged view cannot use");
assert.equal((migration.match(/DROP INDEX IF EXISTS public\.invoices_order_page_/g) || []).length, 5,
  "rerunning migration 102 must remove all five indexes from an R1 staging database");
assert.match(migration, /OFFSET LEAST\(GREATEST\(COALESCE\(p_offset, 0\), 0\), 1000000\)/,
  "the order RPC must cap hostile or accidental deep offsets");
assert.match(migration, /-- Rollback \(run only with the matching pre-data-layer frontend release\):[\s\S]*DROP FUNCTION IF EXISTS public\.bizflow_home_dashboard/,
  "migration 102 must carry an explicit rollback recipe");
assert.match(migration, /replace\(replace\(replace\([\s\S]*ESCAPE E'\\\\'/,
  "order search must treat SQL LIKE percent and underscore as literals");
const groupingSql = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.bizflow_customer_group_count"), migration.indexOf("REVOKE ALL ON FUNCTION public.bizflow_edit_distance_one"));
assert.match(groupingSql, /Starting from those three selective indexes/);
assert.match(groupingSql, /normalized AS MATERIALIZED[\s\S]*scored AS MATERIALIZED[\s\S]*edges AS MATERIALIZED[\s\S]*bidirectional_edges AS MATERIALIZED[\s\S]*JOIN bidirectional_edges ON bidirectional_edges\.source_id = reach\.member/,
  "RLS input, scoring, qualifying edges, and bidirectional traversal must remain materialized and indexable");
assert.doesNotMatch(groupingSql, /JOIN edges ON edges\.left_id = reach\.member OR edges\.right_id = reach\.member/,
  "large duplicate clusters must not restore the recursive OR join");
assert.doesNotMatch(groupingSql, /FROM address_values a JOIN address_values b|FROM email_values a JOIN email_values b/,
  "common addresses/emails must not materialise quadratic candidate pairs");
assert.match(migration, /recent_feed[\s\S]*LIMIT 3[\s\S]*ORDER BY created_at DESC, id DESC LIMIT 4[\s\S]*ORDER BY grouped_stock DESC, id LIMIT 4[\s\S]*ORDER BY name LIMIT 12[\s\S]*ORDER BY expiry, invoice_id LIMIT 4/,
  "every Home list widget must be bounded in SQL");

assert.doesNotMatch(guardMigration.replace(/^--.*$/gm, ""), /SECURITY\s+DEFINER/i,
  "the dirty-JSON guard must not bypass RLS");
assert.match(guardMigration, /FUNCTION public\.bizflow_jsonb_array\(input_value jsonb\)[\s\S]*IMMUTABLE[\s\S]*SECURITY INVOKER[\s\S]*jsonb_typeof\(input_value\) = 'array'[\s\S]*ELSE '\[\]'::jsonb/,
  "the helper must preserve arrays and map every other JSONB shape to an empty array");
assert.match(guardMigration, /REVOKE ALL ON FUNCTION public\.bizflow_jsonb_array\(jsonb\) FROM PUBLIC, anon[\s\S]*GRANT EXECUTE ON FUNCTION public\.bizflow_jsonb_array\(jsonb\) TO authenticated/,
  "the helper must keep the same authenticated-only execution boundary as the phase-one RPCs");
assert.equal((guardMigration.match(/jsonb_array_elements\(/g) || []).length, 8,
  "migration 103 must cover exactly the eight phase-one JSONB expansions");
assert.equal((guardMigration.match(/jsonb_array_elements\(public\.bizflow_jsonb_array\(/g) || []).length, 8,
  "every copied expansion must pass through the non-array guard");

const guardReplacements = [
  ["jsonb_array_elements(COALESCE(i.items, '[]'::jsonb))", "jsonb_array_elements(public.bizflow_jsonb_array(i.items))"],
  ["jsonb_array_elements(COALESCE(row.items, '[]'::jsonb))", "jsonb_array_elements(public.bizflow_jsonb_array(row.items))"],
  ["jsonb_array_elements(line.alias_products)", "jsonb_array_elements(public.bizflow_jsonb_array(line.alias_products))"],
  ["jsonb_array_elements(COALESCE(invoice.items, '[]'::jsonb))", "jsonb_array_elements(public.bizflow_jsonb_array(invoice.items))"]
];
function objectBlock(sql, start, end) {
  return sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start))).trim();
}
function guardArrayExpansions(sql) {
  return guardReplacements.reduce((result, [from, to]) => result.replaceAll(from, to), sql);
}
for (const [start, oldEnd, newEnd] of [
  ["CREATE OR REPLACE VIEW public.bizflow_order_list", "CREATE OR REPLACE FUNCTION public.bizflow_order_page", "CREATE OR REPLACE FUNCTION public.bizflow_order_revenue"],
  ["CREATE OR REPLACE FUNCTION public.bizflow_order_revenue", "CREATE OR REPLACE FUNCTION public.bizflow_edit_distance_one", "CREATE OR REPLACE VIEW public.bizflow_warranty_rows"],
  ["CREATE OR REPLACE VIEW public.bizflow_warranty_rows", "CREATE OR REPLACE FUNCTION public.bizflow_home_dashboard", "CREATE OR REPLACE FUNCTION public.bizflow_home_dashboard"],
  ["CREATE OR REPLACE FUNCTION public.bizflow_home_dashboard", "CREATE OR REPLACE FUNCTION public.bizflow_unread_summary", "COMMENT ON FUNCTION public.bizflow_jsonb_array"]
]) {
  assert.equal(objectBlock(guardMigration, start, newEnd), guardArrayExpansions(objectBlock(migration, start, oldEnd)),
    `${start} must remain byte-equivalent to migration 102 apart from guarded array inputs`);
}

assert.equal(ORDER_PAGE_SIZE, 50);
assert.deepEqual(normalizeOrderQuery({ page: -2, sort: "bogus", shipping: "bogus", source: "bogus" }), {
  page: 1, pageSize: 50, search: "", source: "all", shipping: "all", from: "", to: "", sort: "newest"
});
assert.match(orderQuery, /client\.rpc\("bizflow_order_page"[\s\S]*p_offset: \(query\.page - 1\) \* ORDER_PAGE_SIZE[\s\S]*p_limit: ORDER_PAGE_SIZE/);
assert.match(orderQuery, /client\.rpc\("bizflow_order_revenue"/,
  "the revenue tab must use a server aggregate instead of downloading every detailed order");
assert.match(revenue, /getOrderRevenueData\(range, \{ refresh \}\)/);
assert.doesNotMatch(orders, /getLegacyOrdersPageData/);
assert.match(orderQuery, /from\("invoices"\)[\s\S]*select\("id,invoice_number[\s\S]*from\("shipment_events"\)[\s\S]*limit\(6\)/,
  "order detail must lazy-load one invoice and at most six tracking events");
assert.match(orders, /createDebouncedTask\(\(\) => void loadCurrentOrderPage\(\)\)/,
  "one debounced callback must own backend search");
assert.match(orders, /ordersLoading = true[\s\S]*getOrdersPageData\(currentOrderQuery\(\)[\s\S]*ordersLoading = false/);
for (const language of ["zh", "en", "fr"]) {
  assert.match(orders, new RegExp(`${language}: \\{[\\s\\S]*"orders.loading"[\\s\\S]*"orders.sort.amount_asc"`));
}
assert.match(orderWrites, /invalidateOrderQueriesAfterWrite\(claimResult\.data\)/);
assert.match(orderWrites, /invalidateOrderQueriesAfterWrite\(result\.data\)/);
assert.match(orderQuery, /invalidateLiveQueryCacheAfterWrite[\s\S]*preserve[\s\S]*dispatchQueryUpdate\(activeQuery, preserve\.value, "write"\)[\s\S]*backgroundRefresh/,
  "self writes must preserve/patch only the active page, hard-clear other queries, then refresh the active query");
assert.match(orders, /refreshCurrentOrderQuery\(\{ soft: true, source: "realtime", notify: false \}\)/,
  "realtime must actually run the soft-stale query refresh path");
assert.match(orders, /snapshots: \["orders\.json"\]/,
  "orders must retain the retry-completion wakeup for legacy observer snapshots");
assert.match(provider, /getOrdersPageData\(query, options = \{\}\)[\s\S]*resolveOrderPageRead\([\s\S]*readLegacy: getLegacyOrdersPageData/,
  "the no-argument compatibility contract must still return all detailed orders");
assert.match(provider, /Order page RPC failed; falling back to the legacy data path[\s\S]*const legacy = await getLegacyOrdersPageData\(\)[\s\S]*offlineOrdersPage\(legacy, nextQuery\)/,
  "an order-page RPC failure must return a mountable page from the legacy source");
assert.match(provider, /legacy\.unavailable \? unavailableOrdersPage\(nextQuery\)[\s\S]*Legacy order fallback failed; showing the unavailable state/,
  "RPC plus legacy failure must return an explicit empty unavailable page, never demo orders");
assert.doesNotMatch(provider.slice(provider.indexOf("export async function getOrdersPageData"), provider.indexOf("const orderDetailSample")), /withOrderIds\(ordersPageMock\.orders\)/,
  "the signed paged-order path must never render the 40-row Figma sample");
for (const message of [
  "暫時取不到數據，請稍後再試",
  "Order data is temporarily unavailable. Please try again later.",
  "Les données des commandes sont temporairement indisponibles. Réessayez plus tard."
]) assert.ok(orders.includes(message), `orders unavailable state must include: ${message}`);
for (const consumer of [pending, customerDetail, itemMap]) {
  assert.match(consumer, /getOrdersPageData\(\)/, "legacy observers must keep using the no-argument detailed-order contract");
}

const values = new Map();
globalThis.window = {
  localStorage: {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  }
};
const query = { table: "orders", page: 1, filters: { source: "all", search: "" }, sort: "newest" };
assert.equal(liveQueryKey(query), liveQueryKey({ sort: "newest", filters: { search: "", source: "all" }, page: 1, table: "orders" }));
writeLiveQueryCache({ userId: "alice", namespace: "orders-page", query, value: { orders: [{ id: "1" }] }, now: 10 });
assert.equal(liveQueryCachePolicy.version, 2);
assert.equal([...values.keys()].every((key) => key.startsWith("tp-live-query:v2:")), true,
  "new query entries must carry the current cache version in both key and payload");
assert.equal(readLiveQueryCache({ userId: "bob", namespace: "orders-page", query, now: 10 }), null,
  "query pages must be account scoped");
markLiveQueryCacheStale({ userId: "alice", namespace: "orders-page", query });
assert.equal(readLiveQueryCache({ userId: "alice", namespace: "orders-page", query, now: 10 }).stale, true,
  "realtime invalidation must mark a page stale without deleting it");
invalidateLiveQueryCacheAfterWrite({
  userId: "alice", namespace: "orders-page", preserve: { query, value: { orders: [{ id: "1", status: "completed" }] } }
});
const afterWrite = readLiveQueryCache({ userId: "alice", namespace: "orders-page", query, now: 10 });
assert.equal(afterWrite.value.orders[0].status, "completed");
assert.equal(afterWrite.stale, true);
values.set("tp-live-query:v1:retired", JSON.stringify({ value: { secret: "old" } }));
clearLiveQueryCache();
assert.equal(values.size, 0, "sign-out clearing must remove every query-cache version, not only v2");
delete globalThis.window;

assert.match(home, /getHomeDashboardData\(\{ refresh \}\)/);
assert.match(home, /loadHomeViewState\(\{ refresh: true \}\)/,
  "Home realtime must force a fresh RPC instead of replaying a cached dashboard");
assert.match(liveHome, /writeLiveQueryCache\([\s\S]*cached && !refresh[\s\S]*backgroundHomeRefresh/,
  "Home mounts must reuse an account/company-scoped cached dashboard while revalidating it");
assert.match(provider, /Home unread RPC failed; falling back to the legacy data path/,
  "an unread-summary failure must not bypass the dashboard fallback and blank Home");
for (const oldDownload of ["getHomeOrderMetricRows()", "getInventoryMetricProducts()", "getWarrantyData()", "getCustomersPageData()"] ) {
  assert.doesNotMatch(home, new RegExp(oldDownload.replace(/[()]/g, "\\$&")), `${oldDownload} must not run on Home mount`);
}
assert.match(provider, /compareHomeDashboardWithLegacy[\s\S]*getLegacyHomeDashboardData\(\)[\s\S]*getLiveHomeDashboard\(\{ refresh: true \}\)[\s\S]*compareHomeMetricSets/,
  "deployment must have a one-shot old/new parity hook");

let fallbackCalls = 0;
const fallbackValue = await resolveLiveQueryOrLegacy({
  readLive: async () => { throw new Error("statement timeout"); },
  miss: Symbol("miss"),
  readLegacy: async () => { fallbackCalls += 1; return { data: { stats: [] } }; },
  onError: () => {}
});
assert.equal(fallbackCalls, 1, "a failed Home RPC must execute the legacy reader once");
assert.deepEqual(fallbackValue, { data: { stats: [] } }, "a failed Home RPC must still return mountable data");

let legacyOrderReads = 0;
let pagedOrderReads = 0;
const legacyOrders = { orders: [{ id: "legacy", detail: { items: [{ name: "Adapter" }] } }] };
assert.equal(await resolveOrderPageRead({
  query: undefined,
  readLegacy: async () => { legacyOrderReads += 1; return legacyOrders; },
  readPage: async () => { pagedOrderReads += 1; return { orders: [] }; }
}), legacyOrders);
assert.equal(legacyOrderReads, 1, "a no-argument order read must execute the detailed legacy reader");
assert.equal(pagedOrderReads, 0, "a no-argument order read must never enter the 50-row slim reader");

let profileReads = 0;
await assert.rejects(() => readSignedInUser(async () => {
  profileReads += 1;
  throw { code: "22P02", message: "bad profile read" };
}), (error) => error?.code === "22P02");
assert.equal(profileReads, 1, "PostgREST profile reads must remain single-shot without a provable retry signal");
let signInAttempts = 0;
const recoveredLogin = await completePasswordSignIn({
  signIn: async () => {
    signInAttempts += 1;
    if (signInAttempts === 1) throw { status: 400, code: "request_timeout" };
  },
  readCurrentUser: async () => ({ id: "approved-user" }),
  defer: async () => {}
});
assert.deepEqual(recoveredLogin, { id: "approved-user" });
assert.equal(signInAttempts, 2, "one submit may absorb an explicit Auth timeout once");
for (const error of [
  { status: 400, code: "invalid_credentials" },
  { status: 400, code: "invalid_grant" },
  { status: 400, msg: "Invalid login credentials" },
  { status: 400, code: "session_not_ready" },
  { status: 400, code: "user_banned" },
  { status: 400, code: "validation_failed" }
]) {
  let attempts = 0;
  await assert.rejects(() => completePasswordSignIn({
    signIn: async () => { attempts += 1; throw error; },
    readCurrentUser: async () => null,
    defer: async () => {}
  }), (received) => received === error);
  assert.equal(attempts, 1, `password error ${error.code || "without-code"} must never be resent`);
}

const legacyCustomerFixture = [
  { id: "a", name: "Exact pair", phone: "852-1", phone_mainland: "86-1", email: "a@test", address: "A" },
  { id: "b", name: "Exact pair", phone: "852-1", phone_mainland: "86-1", email: "b@test", address: "B" },
  { id: "c", name: "Fuzzy pair", phone: "852-2", phone_mainland: "86-2", email: "cat@test", address: "Lane A" },
  { id: "d", name: "Fuzzy pair", phone: "852-3", phone_mainland: "86-3", email: "cut@test", address: "Lane B" },
  { id: "e", name: "Independent", phone: "852-4", phone_mainland: "86-4", email: "e@test", address: "E" }
];
const legacyCustomerCount = buildCustomerGroups(legacyCustomerFixture).groups.length;
assert.equal(legacyCustomerCount, 3, "the positive parity oracle must come from the legacy grouping algorithm");

const legacyState = {
  data: {
    stats: [
      { key: "orders", value: 6600 }, { key: "customers", value: legacyCustomerCount },
      { key: "members", value: 12 }, { key: "warranty", value: 35 }
    ],
    tasks: [{ title: "Task A", due: "2026/08/20" }], feed: [{ title: "Feed A" }], chart: [{ label: "Adapter", value: 5 }],
    orders: [{ no: "#1" }], stock: [{ product: "Adapter" }], members: [{ name: "Alice" }],
    warrantyItems: [{ no: "#1" }], membersStats: { all: 12, active: 10, pendingReview: 1, left: 2 }
  },
  revenueMetrics: { totalRevenue: 123456, paidCount: 88, average: 1403, unpaidCount: 7, unpaidAmount: 8000 },
  shippingMetrics: { all: 6600, pending: 9, in_transit: 7, exception: 2, delivered: 40 },
  inventoryMetrics: { carrierCount: 40, activeSkuCount: 34, totalQuantity: 812, lowStockCount: 5 }
};
const serverState = {
  data: {
    stats: [
      { key: "orders", value: 6600 }, { key: "customers", value: 3 },
      { key: "members", value: 12 }, { key: "warranty", value: 35 }
    ],
    tasks: [{ due: "2026/08/20", title: "Task A" }], feed: [{ title: "Feed A" }], chart: [{ value: 5, label: "Adapter" }],
    orders: [{ no: "#1" }], stock: [{ product: "Adapter" }], members: [{ name: "Alice" }],
    warrantyItems: [{ no: "#1" }], membersStats: { all: 12, active: 10, pendingReview: 1, left: 2 }
  },
  revenueMetrics: { totalRevenue: 123456, paidCount: 88, average: 1403, unpaidCount: 7, unpaidAmount: 8000 },
  shippingMetrics: { all: 6600, pending: 9, in_transit: 7, exception: 2, delivered: 40 },
  inventoryMetrics: { carrierCount: 40, activeSkuCount: 34, totalQuantity: 812, lowStockCount: 5 }
};
const parity = compareHomeMetricSets(legacyState, serverState);
assert.equal(parity.equal, true);
assert.equal(parity.rows.length, 29, "parity must cover 22 numeric metrics and all seven Home list widgets");
assert.equal(parity.rows.find((row) => row.key === "tasks")?.equal, true,
  "list parity must ignore object-key insertion order");
const mismatch = structuredClone(serverState);
mismatch.shippingMetrics.pending += 1;
assert.equal(compareHomeMetricSets(legacyState, mismatch).equal, false);
const listMismatch = structuredClone(serverState);
listMismatch.data.stock[0].product = "Different";
assert.equal(compareHomeMetricSets(legacyState, listMismatch).equal, false,
  "parity must fail when a bounded Home list differs even if all numbers match");

assert.doesNotMatch(customers, /live-orders-query|bizflow_order_page|bizflow_home_dashboard/);
assert.doesNotMatch(tasks, /live-orders-query|bizflow_order_page|bizflow_home_dashboard/);

console.log("DATA-phase1 contracts: PASS (50/page, invoker RLS, v2 query cache, live fallback, 29-field parity)");
