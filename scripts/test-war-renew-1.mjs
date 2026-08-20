import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { snapshotsForTables } from "../root-site/data/live-snapshot-dependencies.js";
import { invalidateLiveTableCache, liveSnapshotCacheVersion } from "../root-site/data/live-table-cache.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [migration, writes, snapshots, tableCache, provider, warranty, customers, css, home] = await Promise.all([
  read("migrations/096_warranty_renewals.sql"),
  read("root-site/data/live-warranty-writes.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/data/live-table-cache.js"),
  read("root-site/data/provider.js"),
  read("root-site/bizflow/customers-warranty.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/bizflow/customers-warranty.css"),
  read("root-site/bizflow/home.js")
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.warranty_renewals[\s\S]*invoice_id text NOT NULL REFERENCES public\.invoices\(id\)[\s\S]*product_id uuid NOT NULL REFERENCES public\.products\(id\)[\s\S]*customer_id uuid NOT NULL REFERENCES public\.customers\(id\)/);
assert.match(migration, /months smallint NOT NULL CHECK \(months IN \(12, 24\)\)[\s\S]*paid_at date NOT NULL[\s\S]*previous_end date NOT NULL[\s\S]*new_end date NOT NULL/);
assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /UNIQUE\s*\(\s*invoice_id\s*,\s*product_id/,
  "repeat renewals for the same invoice product must remain append-only");
assert.match(migration, /warranty_renewals_select[\s\S]*USING \(public\.has_bizflow_main_access\(\)\)[\s\S]*warranty_renewals_insert[\s\S]*public\.has_bizflow_main_access\(\)[\s\S]*created_by = auth\.uid\(\)/,
  "renewal history must retain the invoices-style BizFlow read domain and customer-write identity gate");
assert.match(migration, /LANGUAGE plpgsql SECURITY INVOKER[\s\S]*SELECT \* INTO v_invoice[\s\S]*FROM public\.invoices[\s\S]*FOR UPDATE[\s\S]*NEW\.paid_at < v_invoice\.date::date/,
  "one invoker transaction must lock the live invoice and validate its payment date");
assert.match(migration, /jsonb_array_elements\(v_items\)[\s\S]*item->>'product_id'[\s\S]*item->>'name'[\s\S]*v_item->>'warranty_months'[\s\S]*v_product\.warranty_months/,
  "the server must resolve the invoice line by product id or name and prefer its warranty snapshot");
assert.match(migration, /FROM public\.warranty_renewals AS renewal[\s\S]*renewal\.invoice_id = NEW\.invoice_id[\s\S]*renewal\.product_id = NEW\.product_id[\s\S]*ORDER BY renewal\.created_at DESC[\s\S]*NEW\.previous_end := COALESCE[\s\S]*v_invoice\.date::date \+ make_interval\(months => v_line_months\)[\s\S]*NEW\.new_end := \(NEW\.paid_at \+ make_interval\(months => NEW\.months\)\)::date/,
  "latest renewal must win, with the invoice-line derived end as the first baseline");
assert.match(migration, /NEW\.months IS NULL OR NEW\.months NOT IN \(12, 24\)/,
  "the trigger must reject null and unsupported renewal terms before deriving a renewal");
assert.doesNotMatch(migration, /public\.inventory|inventory_id/,
  "the production-empty legacy inventory table must not participate in warranty renewal");

assert.match(writes, /client\.from\("warranty_renewals"\)[\s\S]*invoice_id: invoiceId[\s\S]*product_id: productId[\s\S]*months: normalizedMonths[\s\S]*paid_at: paidAt[\s\S]*\.select\("\*"\)[\s\S]*\.single\(\)/);
assert.match(writes, /await invalidateLiveTables\("invoices", "warranty_renewals"\);[\s\S]*return result\.data/,
  "a successful write must finish table and derived-snapshot invalidation before returning to the UI");
assert.doesNotMatch(writes, /\.from\("invoices"\)|\.from\("customers"\)|WhatsApp|wa_/,
  "renewal must not generate revenue documents or outbound messages");

const warrantyBuilder = snapshots.slice(
  snapshots.indexOf("async function buildWarrantySnapshot"),
  snapshots.indexOf("async function buildTasksSnapshot")
);
assert.match(warrantyBuilder, /customerSource\.invoicesByRoot[\s\S]*for \(const invoice of invoices\)[\s\S]*normalizedInvoiceItems\(invoice\)[\s\S]*addMonths\(invoice\.date, months\)/,
  "the production warranty list must retain its invoice-line derivation path");
assert.match(warrantyBuilder, /allRows\("warranty_renewals", "created_at", false\)/);
assert.match(warrantyBuilder, /latestRenewalByLine[\s\S]*warrantyRenewalKey\(invoice\.id, product\.id\)[\s\S]*const expiry = renewal \? formatDate\(renewal\.new_end\) : addMonths\(invoice\.date, months\)/,
  "the latest renewal must overlay, not replace, the invoice-derived warranty source");
assert.match(warrantyBuilder, /latestRenewal:[\s\S]*months:[\s\S]*paidAt:[\s\S]*newEnd:/);
assert.doesNotMatch(warrantyBuilder, /allRows\("inventory"|inventory_id|warranty_end/);
for (const snapshot of ["warranty.json", "home.json"]) {
  assert.ok(snapshotsForTables(new Set(["invoices"])).has(snapshot), `invoice invalidation must refresh ${snapshot}`);
  assert.ok(snapshotsForTables(new Set(["warranty_renewals"])).has(snapshot), `renewal invalidation must refresh ${snapshot}`);
  assert.ok(!snapshotsForTables(new Set(["inventory"])).has(snapshot), `legacy inventory must not drive ${snapshot}`);
}
const cacheVersionsBeforeWrite = new Map(
  ["warranty.json", "home.json"].map((snapshot) => [snapshot, Number(liveSnapshotCacheVersion(snapshot).split(":").at(-1))])
);
await invalidateLiveTableCache("invoices", "warranty_renewals");
for (const [snapshot, previousVersion] of cacheVersionsBeforeWrite) {
  const nextVersion = Number(liveSnapshotCacheVersion(snapshot).split(":").at(-1));
  assert.equal(nextVersion, previousVersion + 1, `${snapshot} stale generation must advance after renewal tables invalidate`);
}
assert.match(tableCache, /export async function invalidateLiveTableCache[\s\S]*snapshotsForTables\(targets\)[\s\S]*markLiveSnapshotCacheStale\(\[\.\.\.snapshots\]\)/,
  "table invalidation must mark every dependent snapshot stale without evicting its IDB value");
assert.match(tableCache, /SNAPSHOT_CONTRACT_GENERATIONS[\s\S]*\["home\.json", [1-9]\d*\][\s\S]*\["warranty\.json", 2\]/,
  "pre-release cached rows without invoice/product write keys must be rejected on rollout");
assert.match(snapshots, /LIVE_SNAPSHOT_INVALIDATED_EVENT[\s\S]*invalidateProviderSnapshotMemo\(snapshots\)[\s\S]*LIVE_BUILDERS\.delete/,
  "snapshot invalidation must also evict provider and live-builder memory state");
assert.match(provider, /item\.invoiceId[\s\S]*item\.productId[\s\S]*item\.latestRenewal[\s\S]*\[12, 24\]\.includes\(item\.latestRenewal\.months\)/);
assert.match(home, /getWarrantyData\(\)[\s\S]*stat\.key === "warranty"[\s\S]*value: warrantyData\.items\.length[\s\S]*warrantyItems: warrantyData\.items\.slice\(0, 4\)[\s\S]*date: item\.expiry/,
  "Home card and warranty count must rebuild together from the invalidated shared warranty provider");

for (const language of ["zh", "en", "fr"]) {
  assert.match(warranty, new RegExp(`${language}: \\{[\\s\\S]*renewalTitle:[\\s\\S]*renewalPaidAt:[\\s\\S]*renewalSuccess:`), `${language} renewal copy must be complete`);
}
assert.match(warranty, /data-warranty-renew=/);
assert.match(warranty, /invoiceId: item\.invoiceId[\s\S]*productId: item\.productId/);
assert.match(warranty, /data-warranty-renewal-months="\$\{months\}"[\s\S]*\[12, 24\]/);
assert.match(warranty, /data-warranty-renewal-date-trigger/);
assert.match(warranty, /renewalDatePanel\.open\(\{[\s\S]*mode: "single"/);
assert.doesNotMatch(warranty, /type="date"/,
  "the renewal payment date must use the shared blue single-date panel");
assert.match(warranty, /dateValue\(paidAt\) < dateValue\(item\.purchaseDate\)[\s\S]*renewalDateBeforeSale/);
assert.match(warranty, /item\.expiry = displayDate\(result\.new_end\)[\s\S]*item\.daysLeft = warrantyDaysLeft[\s\S]*item\.bucket = warrantyBucket[\s\S]*item\.latestRenewal =/,
  "successful renewal must immediately recompute the row before the background snapshot refresh");
assert.match(customers, /openWarrantyRenewal[\s\S]*openWarrantyRenewalDate[\s\S]*submitWarrantyRenewal/);
assert.match(css, /\.warranty-renewal-term > \.warranty-renewal-options\s*\{/,
  "the term control must use a structural selector instead of relying on cascade order");

console.log("WAR-renew-1 contracts: PASS");
