import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { compareHomeMetricSets } from "../root-site/data/home-metric-parity.js";
import {
  clearLiveQueryCache,
  invalidateLiveQueryCacheAfterWrite,
  liveQueryKey,
  markLiveQueryCacheStale,
  readLiveQueryCache,
  writeLiveQueryCache
} from "../root-site/data/live-query-cache.js";
import { normalizeOrderQuery, ORDER_PAGE_SIZE } from "../root-site/data/live-orders-query.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [migration, orders, orderQuery, orderWrites, provider, home, customers, tasks] = await Promise.all([
  read("migrations/102_bizflow_data_phase1.sql"),
  read("root-site/bizflow/orders.js"),
  read("root-site/data/live-orders-query.js"),
  read("root-site/data/live-orders-writes.js"),
  read("root-site/data/provider.js"),
  read("root-site/bizflow/home.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/team/tasks.js")
]);

assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /SECURITY\s+DEFINER/i, "phase 1 must not bypass RLS");
assert.match(migration, /bizflow_order_list[\s\S]*security_invoker = true/);
assert.match(migration, /bizflow_order_page[\s\S]*SECURITY INVOKER[\s\S]*LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 50\)/);
assert.match(migration, /bizflow_home_dashboard[\s\S]*SECURITY INVOKER/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.bizflow_home_dashboard\(uuid\) FROM PUBLIC, anon/);
assert.match(migration, /recent_feed[\s\S]*LIMIT 3[\s\S]*ORDER BY created_at DESC, id DESC LIMIT 4[\s\S]*ORDER BY grouped_stock DESC, id LIMIT 4[\s\S]*ORDER BY name LIMIT 12[\s\S]*ORDER BY expiry, invoice_id LIMIT 4/,
  "every Home list widget must be bounded in SQL");

assert.equal(ORDER_PAGE_SIZE, 50);
assert.deepEqual(normalizeOrderQuery({ page: -2, sort: "bogus", shipping: "bogus", source: "bogus" }), {
  page: 1, pageSize: 50, search: "", source: "all", shipping: "all", from: "", to: "", sort: "newest"
});
assert.match(orderQuery, /client\.rpc\("bizflow_order_page"[\s\S]*p_offset: \(query\.page - 1\) \* ORDER_PAGE_SIZE[\s\S]*p_limit: ORDER_PAGE_SIZE/);
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
assert.match(orderQuery, /markLiveQueryCacheStale[\s\S]*refreshCurrentOrderQuery/,
  "realtime must retain the soft-stale path");

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
clearLiveQueryCache();
delete globalThis.window;

assert.match(home, /getHomeDashboardData\(\)/);
for (const oldDownload of ["getHomeOrderMetricRows()", "getInventoryMetricProducts()", "getWarrantyData()", "getCustomersPageData()"] ) {
  assert.doesNotMatch(home, new RegExp(oldDownload.replace(/[()]/g, "\\$&")), `${oldDownload} must not run on Home mount`);
}
assert.match(provider, /compareHomeDashboardWithLegacy[\s\S]*getLegacyHomeDashboardData\(\)[\s\S]*getLiveHomeDashboard\(\)[\s\S]*compareHomeMetricSets/,
  "deployment must have a one-shot old/new parity hook");

const state = {
  data: { stats: [
    { key: "orders", value: 6600 }, { key: "customers", value: 4500 },
    { key: "members", value: 12 }, { key: "warranty", value: 35 }
  ] },
  revenueMetrics: { totalRevenue: 123456, paidCount: 88 },
  shippingMetrics: { pending: 9, in_transit: 7, exception: 2 },
  inventoryMetrics: { carrierCount: 40, activeSkuCount: 34, totalQuantity: 812, lowStockCount: 5 }
};
assert.equal(compareHomeMetricSets(state, structuredClone(state)).equal, true);
const mismatch = structuredClone(state);
mismatch.shippingMetrics.pending += 1;
assert.equal(compareHomeMetricSets(state, mismatch).equal, false);

const slimRow = {
  id: "00000000-0000-0000-0000-000000000001", dcNumber: "DC01234", customer: "Sample Customer",
  phone: "+852 9123 4567", channel: "Online Store", product: "DC Adaptor Pro", qty: "×1",
  date: "2026/08/19", amount: "HKD$ 2134", salesperson: "Vincent", note: "Customer note"
};
const pageBytes = Buffer.byteLength(JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ ...slimRow, id: `${slimRow.id}-${index}` }))));
const legacyBytes = Buffer.byteLength(JSON.stringify(Array.from({ length: 6600 }, (_, index) => ({
  ...slimRow,
  id: `${slimRow.id}-${index}`,
  detail: { items: Array.from({ length: 8 }, () => ({ name: "DC Adaptor Pro", quantity: 1, price: 2134 })), timeline: Array.from({ length: 6 }, () => ({ label: "In transit", time: "2026/08/19 12:00" })) }
}))));
assert.ok(pageBytes < 100 * 1024, `50-row page should stay in tens of KB, got ${pageBytes}`);
assert.ok(legacyBytes > 1024 * 1024, `whole-table fixture should stay MB-scale, got ${legacyBytes}`);
assert.ok(legacyBytes / pageBytes > 100, "page payload must be at least 100x smaller than the legacy whole-table fixture");

assert.doesNotMatch(customers, /live-orders-query|bizflow_order_page|bizflow_home_dashboard/);
assert.doesNotMatch(tasks, /live-orders-query|bizflow_order_page|bizflow_home_dashboard/);

console.log(`DATA-phase1 contracts: PASS (50/page, invoker RLS, query cache, parity hook, ${pageBytes}B page vs ${legacyBytes}B legacy fixture)`);
