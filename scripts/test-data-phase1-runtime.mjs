import assert from "node:assert/strict";
import { register } from "node:module";

register("./test-support/data-phase1-auth-loader.mjs", import.meta.url);

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.window = new EventTarget();
window.localStorage = new MemoryStorage();
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  };
}

const auth = await import("../root-site/data/auth.js");
const provider = await import("../root-site/data/provider.js");
const orderQuery = await import("../root-site/data/live-orders-query.js");
const queryCache = await import("../root-site/data/live-query-cache.js");

auth.__reset();
const legacyOrders = await provider.getOrdersPageData();
assert.ok(Array.isArray(legacyOrders.orders));
assert.deepEqual(auth.__calls(), [], "a live session must not send no-argument observer reads into the paged RPC");

const query = orderQuery.normalizeOrderQuery({ page: 1 });
const pagedOrders = await provider.getOrdersPageData(query);
assert.equal(pagedOrders.pageSize, 50);
assert.deepEqual(auth.__calls().map((call) => call.name), ["bizflow_order_page"]);

auth.__holdNextRpc("bizflow_order_page");
const refresh = orderQuery.refreshCurrentOrderQuery({ soft: true, source: "runtime-test", notify: false });
for (let attempt = 0; attempt < 100 && auth.__calls().length < 2; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal(auth.__calls().length, 2, "the realtime probe must reach its held paged RPC");
const duringRefresh = queryCache.readLiveQueryCache({
  userId: "test-user", namespace: "orders-page", query
});
assert.equal(duringRefresh?.stale, true, "realtime must retain the current page while its fresh RPC is in flight");
auth.__releaseRpc();
await refresh;
const afterRefresh = queryCache.readLiveQueryCache({
  userId: "test-user", namespace: "orders-page", query
});
assert.equal(afterRefresh?.stale, false, "a successful realtime refresh must replace the stale cache entry");

auth.__reset();
auth.__setRpcError("bizflow_order_page", { code: "57014", status: 500, message: "statement timeout" });
const fallbackQuery = orderQuery.normalizeOrderQuery({ page: 1, source: "Framer" });
const fallbackOrders = await provider.getOrdersPageData(fallbackQuery, { refresh: true });
assert.ok(Array.isArray(fallbackOrders.orders),
  "an order RPC timeout must return a mountable legacy page instead of rejecting route mount");
assert.equal(fallbackOrders.pageSize, 50);
assert.deepEqual(auth.__calls().map((call) => call.name), ["bizflow_order_page"]);

auth.__reset();
auth.__setRpcError("bizflow_home_dashboard", { code: "57014", message: "statement timeout" });
const home = await provider.getHomeDashboardData({ refresh: true });
assert.deepEqual(home.data.stats.map((row) => row.key), ["orders", "customers", "members", "warranty"],
  "a dashboard timeout must return a mountable legacy Home state");
assert.deepEqual(auth.__calls().map((call) => call.name), ["bizflow_home_dashboard"]);

auth.__reset();
auth.__setRpcError("bizflow_unread_summary", { code: "57014", message: "statement timeout" });
const unread = await provider.getUnread();
assert.deepEqual(Object.keys(unread).sort(), ["inventory", "messages", "orders", "tasks", "updates"],
  "an unread timeout must return the legacy counter shape instead of rejecting Home mount");
assert.deepEqual(auth.__calls().map((call) => call.name), ["bizflow_unread_summary"]);

window.dispatchEvent(new CustomEvent("tp:live-snapshot-invalidated", {
  detail: { snapshots: ["orders.json", "home.json"] }
}));
window.dispatchEvent(new Event("tp:auth-transient-reset"));
queryCache.clearLiveQueryCache();
auth.__reset();
auth.__setSessionUser("unavailable-user");
auth.__setRpcError("bizflow_order_page", { code: "57014", status: 500, message: "statement timeout" });
auth.__setTableError(new Error("legacy snapshots unavailable"));
const unavailableOrders = await provider.getOrdersPageData(orderQuery.normalizeOrderQuery({ page: 1 }), { refresh: true });
assert.equal(unavailableOrders.unavailable, true,
  "RPC plus legacy failure must carry an explicit unavailable marker");
assert.deepEqual(unavailableOrders.orders, [],
  "RPC plus legacy failure must render no fake demo orders");
assert.equal(unavailableOrders.totalCount, 0);

console.log("DATA-phase1 runtime: PASS (observer compatibility, realtime soft stale, order/dashboard/unread fallback)");
