import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CustomerRelationError,
  expandCustomerDescendants,
  expandCustomerOperationScope,
  planCustomerMerge
} from "../root-site/data/customer-relations.js";

const graph = [
  { id: "keeper", parent_id: null },
  { id: "source", parent_id: null },
  { id: "child", parent_id: "source" },
  { id: "grandchild", parent_id: "child" },
  { id: "other-child", parent_id: "keeper" },
  { id: "independent", parent_id: null },
  { id: "virtual-source", parent_id: null, name: "Same", phone: "123", email: "same@example.com" },
  { id: "virtual-peer", parent_id: null, name: "Same", phone: "123", email: "same@example.com" },
  { id: "virtual-child", parent_id: "virtual-peer", name: "Alias" }
];

assert.deepEqual(
  expandCustomerDescendants(graph, ["source"]),
  ["source", "child", "grandchild"],
  "delete/merge scope must include every transitive descendant"
);
assert.deepEqual(
  expandCustomerDescendants(graph, ["child"]),
  ["child", "grandchild"],
  "an already-child source must move with its own descendants without pulling in its old parent"
);
assert.deepEqual(
  new Set(expandCustomerOperationScope(graph, ["virtual-source"])),
  new Set(["virtual-source", "virtual-peer", "virtual-child"]),
  "a fresh write plan must include newly-matched rule-1 peers omitted by a stale display snapshot"
);
assert.deepEqual(
  planCustomerMerge(graph, ["source"], "keeper"),
  { keeperId: "keeper", sourceIds: ["source", "child", "grandchild"] },
  "merge must flatten the complete source tree onto the keeper"
);
assert.deepEqual(
  planCustomerMerge(graph, ["child"], "keeper"),
  { keeperId: "keeper", sourceIds: ["child", "grandchild"] },
  "an existing child source and its descendants must be re-parented without moving its old parent"
);

assert.throws(
  () => planCustomerMerge(graph, ["source"], "child"),
  (error) => error instanceof CustomerRelationError && error.code === "CUSTOMER_KEEPER_NOT_ROOT",
  "a descendant/child cannot be selected as keeper"
);
assert.throws(
  () => planCustomerMerge(graph, ["source"], "source"),
  (error) => error instanceof CustomerRelationError && error.code === "CUSTOMER_MERGE_CYCLE",
  "a source record cannot be its own keeper"
);
assert.throws(
  () => expandCustomerDescendants(graph, ["stale"]),
  (error) => error instanceof CustomerRelationError && error.code === "CUSTOMER_SOURCE_STALE",
  "stale source snapshots must block instead of partially mutating a group"
);

const [writes, detail, provider, customerRls, relationFks, leadFk] = await Promise.all([
  readFile(new URL("../root-site/data/live-customer-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customer-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/065_rls_bizflow_main_access.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/072_customer_devices_and_charge_log.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/085_charger_leads.sql", import.meta.url), "utf8")
]);

assert.match(writes, /export async function prepareLiveCustomerDeletion\(/);
assert.match(writes, /export async function deleteLiveCustomerGroup\(/);
assert.match(writes, /export async function mergeLiveCustomerGroup\(/);
assert.match(writes, /const plan = await currentDeletePlan\(client, sourceCustomerIds\)[^]*if \(plan\.invoiceCount > 0\)/,
  "delete must re-read invoice relationships immediately before the write");
assert.match(writes, /from\("invoices"\)[^]*\.select\("id"\)[^]*\.range\(/,
  "invoice blocking must use paginated GET reads");
assert.doesNotMatch(writes, /head\s*:\s*true|count\s*:/,
  "authenticated count-HEAD must not return to the customer delete path");
assert.match(writes, /\.update\(\{ parent_id: plan\.keeperId, merge_exclude: \[\] \}\)[^]*\.in\("id", plan\.sourceIds\)/,
  "one update statement must flatten the complete source relation group");

for (const name of ["prepareLiveCustomerDeletion", "deleteLiveCustomerGroup", "mergeLiveCustomerGroup"]) {
  assert.match(detail, new RegExp(`${name}\\b`), `${name} is not wired to customer detail`);
}
assert.match(detail, /await confirmInPage\(pageTf\(lang, "customer\.delete\.confirmText"/,
  "zero-invoice deletion must still require a second confirmation");
assert.match(detail, /"customer\.delete\.confirmText"[^]*\{ danger: true \}\)/,
  "customer deletion must use the shared danger confirmation treatment");
assert.match(detail, /await confirmInPage\(pageTf\(lang, "customer\.merge\.confirmText"/,
  "merge must explicitly confirm the chosen keeper");
assert.match(detail, /deferredActionAttributes = liveReadOnly \?[^]*disabled/,
  "merge/delete must be enabled only for a live writable customer page");
for (const [language, nextLanguage] of [["zh", "en"], ["en", "fr"], ["fr", null]]) {
  const start = detail.indexOf(`  ${language}: {`);
  const end = nextLanguage ? detail.indexOf(`  ${nextLanguage}: {`, start) : detail.indexOf("\n};", start);
  const block = detail.slice(start, end);
  for (const key of ["customer.merge.help", "customer.delete.blocked", "customer.delete.confirmText"]) {
    assert.match(block, new RegExp(`"${key.replaceAll(".", "\\.")}"`), `${language} is missing ${key}`);
  }
}

assert.match(provider, /export async function getCustomerMergeCandidates\(\)[^]*return grouped\.map/,
  "merge candidates must come from all grouped snapshot customers, not only list-filtered contacts");
assert.match(customerRls, /CREATE POLICY "customers_bizflow_main_access" ON customers FOR ALL TO authenticated/);
assert.match(customerRls, /CREATE POLICY "invoices_bizflow_main_access" ON invoices FOR ALL TO authenticated/);
assert.match(relationFks, /customer_id uuid REFERENCES customers\(id\) ON DELETE CASCADE/,
  "customer devices must remain database-cascaded");
assert.match(relationFks, /customer_id uuid REFERENCES customers\(id\) ON DELETE SET NULL/,
  "charge logs must retain their row while clearing the deleted customer link");
assert.match(leadFk, /customer_id uuid REFERENCES customers\(id\) ON DELETE SET NULL/,
  "charger leads must retain their row while clearing the deleted customer link");

console.log("Empty-shell batch 3b contracts: PASS (blocked delete, transitive merge, cycle guards, existing RLS/FKs)");
