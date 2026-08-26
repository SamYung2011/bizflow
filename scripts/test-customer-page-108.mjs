import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeCustomerQuery,
  normalizeWarrantyQuery
} from "../root-site/data/live-customers-query.js";
import {
  clearLiveQueryCache,
  liveQueryCachePolicy,
  readLiveQueryCache,
  writeLiveQueryCache
} from "../root-site/data/live-query-cache.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [migration, liveQuery, provider, customers, warranty, snapshots] = await Promise.all([
  read("migrations/108_bizflow_customer_page.sql"),
  read("root-site/data/live-customers-query.js"),
  read("root-site/data/provider.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/bizflow/customers-warranty.js"),
  read("root-site/data/live-snapshots.js")
]);

// Database contract: bounded invoker RPCs reuse the reviewed grouping/warranty
// semantics, and only monetary customer fields pass through the revenue gate.
for (const functionName of ["bizflow_customer_page", "bizflow_warranty_page"]) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
}
assert.ok((migration.match(/SECURITY INVOKER/g) ?? []).length >= 2);
assert.ok((migration.match(/public\.bizflow_customer_group_map\(\)/g) ?? []).length >= 2,
  "both page RPCs must reuse the migration-104 customer membership map");
assert.match(migration, /revenue_access AS MATERIALIZED[\s\S]*employee\.is_admin = true OR employee\.can_view_revenue = true[\s\S]*'totalAmount', row\.total_amount/,
  "customer money must use the established revenue permission gate");
assert.match(migration, /warranty_trim_chars AS MATERIALIZED[\s\S]*chr\(65279\)[\s\S]*jsonb_array_elements\(public\.bizflow_jsonb_array\(invoice\.items\)\)/,
  "warranty matching must preserve the migration-105 trim and item contracts");
assert.match(migration, /OFFSET LEAST\(GREATEST\(COALESCE\(p_offset, 0\), 0\), 1000000\)[\s\S]*LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 18\), 1\), 50\)/,
  "both RPCs must cap and apply server pagination");

// Query transport: every list interaction is encoded in the RPC key/params,
// while the account-scoped cache keeps only bounded pages for 60 seconds.
assert.deepEqual(normalizeCustomerQuery({
  page: 3, pageSize: 500, search: "  9123 4567  ", source: "framer", imei: "has",
  from: "2026/08/01", to: "bad", sort: "lastPurchaseAsc"
}), {
  page: 3, pageSize: 50, search: "9123 4567", source: "framer", imei: "has",
  from: "2026-08-01", to: "", sort: "lastPurchaseAsc"
});
assert.deepEqual(normalizeWarrantyQuery({
  page: 0, pageSize: 9, search: "  #124  ", bucket: "month", from: "2026-02-29", to: "2026-08-26"
}), {
  page: 1, pageSize: 9, search: "#124", bucket: "month", from: "", to: "2026-08-26"
});
assert.match(liveQuery, /rpc: "bizflow_customer_page"[\s\S]*p_offset: \(query\.page - 1\) \* query\.pageSize[\s\S]*p_limit: query\.pageSize/);
assert.match(liveQuery, /rpc: "bizflow_warranty_page"[\s\S]*p_search: query\.search \|\| null[\s\S]*p_bucket:[\s\S]*p_offset: \(query\.page - 1\) \* query\.pageSize/);
assert.match(liveQuery, /const cached = readLiveQueryCache[\s\S]*if \(cached && !refresh\) \{[\s\S]*backgroundRefresh/,
  "the live query path must render cached data and revalidate in the background");
assert.match(liveQuery, /const value = mapPayload[\s\S]*writeLiveQueryCache/,
  "successful page RPCs must populate the bounded query cache");
assert.equal(liveQueryCachePolicy.freshMs, 60_000);
clearLiveQueryCache();
const cacheQuery = normalizeCustomerQuery({ page: 2, search: "old order" });
assert.equal(writeLiveQueryCache({ userId: "u-108", namespace: "customers-page", query: cacheQuery, value: { totalCount: 1 }, now: 1_000 }), true);
assert.deepEqual(readLiveQueryCache({ userId: "u-108", namespace: "customers-page", query: cacheQuery, now: 60_999 }), {
  value: { totalCount: 1 }, cachedAt: 1_000, stale: false
});
assert.equal(readLiveQueryCache({ userId: "another-user", namespace: "customers-page", query: cacheQuery }), null,
  "query cache entries must not cross accounts");
clearLiveQueryCache();

// Consumer contract: mount/filter/page paths use the bounded RPC facade. The
// legacy whole-table builders remain reachable only through provider fallback.
const mount = customers.slice(customers.indexOf("export async function mountPage"));
assert.match(mount, /Promise\.all\(\[[\s\S]*getCustomersPageData\(currentCustomerQuery\(\)\)[\s\S]*state\.tab === "warranty" \? ensureWarrantyData\(\{ scope, signal \}\)[\s\S]*data = nextData/,
  "customer mount must request one bounded page and run the optional warranty page in parallel");
assert.doesNotMatch(customers, /allRows\(|fetchAllTable|loadCustomersSnapshot|loadWarrantySnapshot/);
assert.doesNotMatch(warranty, /allRows\(|fetchAllTable|loadCustomersSnapshot|loadWarrantySnapshot/);
assert.match(customers, /loadCurrentCustomerPage[\s\S]*getCustomersPageData\(currentCustomerQuery\(\), \{ refresh \}\)/,
  "search, filters, sort, and paging must replace only the current customer page");
assert.match(warranty, /loadWarrantyPage[\s\S]*getWarrantyData\(currentWarrantyQuery\(\), \{ refresh \}\)/,
  "warranty search, filters, and paging must replace only the current warranty page");
assert.doesNotMatch(customers, /function filteredCustomers\(/,
  "the UI must not pretend a server page is the complete customer population");
assert.doesNotMatch(warranty, /function filteredItems\(/,
  "the UI must not pretend a server page is the complete warranty population");

assert.match(provider, /if \(query === undefined\) return getLegacyCustomersPageData\(\)[\s\S]*getLiveCustomersPage\(normalized, options\)[\s\S]*getLegacyCustomersPageData\(\)[\s\S]*offlineCustomerRevenueAllowed\(\)[\s\S]*redactOfflineCustomerMoney\(page\)/,
  "provider must keep the legacy customer snapshot only as MISS/error fallback");
assert.match(provider, /function redactOfflineCustomerMoney[\s\S]*totalAmount: 0[\s\S]*order: customer\.detail\?\.order \? \{ \.\.\.customer\.detail\.order, price: 0 \}[\s\S]*orders: \(customer\.detail\?\.orders \?\? \[\]\)\.map\(\(order\) => \(\{ \.\.\.order, price: 0 \}\)\)/,
  "a live RPC failure must not reopen customer money through the legacy fallback");
assert.match(provider, /if \(query === undefined\) return getLegacyWarrantyData\(\)[\s\S]*getLiveWarrantyPage\(normalized, options\)[\s\S]*offlineWarrantyPage\(await getLegacyWarrantyData\(\), normalized\)/,
  "provider must keep the legacy warranty snapshot only as MISS/error fallback");
assert.match(snapshots, /async function customerSourceData\(\)[\s\S]*allRows\("customers"[\s\S]*allRows\("invoices"/,
  "the unchanged fallback must remain available for offline/error recovery");

console.log("CUSTOMER-page-108 contracts: PASS (bounded RPC consumers, SWR/offline fallback, no list-path allRows crawl)");
