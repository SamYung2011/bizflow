import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [inventory, writes, itemMap, suppliers, pending, shopify, edgeIndex, catalog, migration] = await Promise.all([
  read("root-site/bizflow/inventory.js"),
  read("root-site/data/live-inventory-writes.js"),
  read("root-site/bizflow/inventory-item-map.js"),
  read("root-site/bizflow/inventory-suppliers.js"),
  read("root-site/bizflow/inventory-pending.js"),
  read("root-site/bizflow/inventory-shopify.js"),
  read("supabase/functions/shopify-catalog-write/index.ts"),
  read("supabase/functions/shopify-catalog-write/catalog.ts"),
  read("migrations/110_suppliers_table.sql")
]);

function functionBody(source, name) {
  const start = [
    source.indexOf(`export async function ${name}`),
    source.indexOf(`function ${name}`)
  ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? -1;
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function invalidationArguments(body, name) {
  const calls = [...body.matchAll(/invalidateLiveTables\(([\s\S]*?)\);/g)];
  assert.equal(calls.length, 1, `${name} must have exactly one invalidation call`);
  return calls[0][1];
}

// Permission: the three formerly fake domains use the exact same two-bit gate as adminContext.
assert.doesNotMatch(inventory, /liveReadOnly:\s*authenticated/,
  "login alone must no longer lock alias, supplier and pending writes");
assert.match(inventory, /inventoryAdminReadOnly = currentUser\?\.isBfAdmin !== true \|\| currentUser\?\.bizflowMainAccess !== true/);
for (const renderer of ["renderItemMap", "renderSuppliers", "renderPendingDeduction"]) {
  assert.match(inventory, new RegExp(`${renderer}\\(liveDomainHelpers`), `${renderer} must receive the shared live admin gate`);
}
assert.match(writes, /currentUser\?\.isBfAdmin !== true \|\| currentUser\?\.bizflowMainAccess !== true/,
  "the browser writer must enforce the same admin plus BizFlow-main gate");

// C1: real CRUD + verify, exact legacy payload columns and invalidation.
const aliasSave = functionBody(writes, "saveLiveInventoryAlias");
assert.match(aliasSave, /from\("line_item_aliases"\)\.update\(payload\)\.eq\("id", draft\.id\)/);
assert.match(aliasSave, /from\("line_item_aliases"\)\.insert\(payload\)/);
assert.match(aliasSave, /invalidateLiveTables\("line_item_aliases"\)/);
assert.match(writes, /alias_name:[\s\S]*skip:[\s\S]*products:[\s\S]*note:[\s\S]*verified: true,[\s\S]*updated_at:/);
for (const [name, operation] of [
  ["deleteLiveInventoryAlias", /from\("line_item_aliases"\)\.delete\(\)\.eq\("id", aliasId\)/],
  ["verifyLiveInventoryAlias", /from\("line_item_aliases"\)[\s\S]*verified: true[\s\S]*\.eq\("id", aliasId\)/]
]) {
  const body = functionBody(writes, name);
  assert.match(body, operation);
  assert.match(body, /invalidateLiveTables\("line_item_aliases"\)/);
}
for (const call of ["saveLiveInventoryAlias", "deleteLiveInventoryAlias", "verifyLiveInventoryAlias"]) {
  assert.match(itemMap, new RegExp(`await ${call}\\(`), `item-map handler must call ${call}`);
}
assert.doesNotMatch(itemMap, /local-alias-|Local-only demonstration/);

// C2: insert/update/delete suppliers with legacy field names and snapshot invalidation.
for (const field of ["name", "contact_url", "contact_person", "category", "note"]) {
  assert.match(writes, new RegExp(`${field}:`), `supplier payload is missing ${field}`);
}
for (const [name, operation] of [
  ["createLiveInventorySupplier", /from\("suppliers"\)\.insert\(payload\)\.select\(\)\.single\(\)/],
  ["updateLiveInventorySupplier", /from\("suppliers"\)\.update\(patch\)\.eq\("id", supplierId\)\.select\(\)\.single\(\)/],
  ["deleteLiveInventorySupplier", /from\("suppliers"\)\.delete\(\)\.eq\("id", supplierId\)/]
]) {
  const body = functionBody(writes, name);
  assert.match(body, operation);
  assert.match(body, /invalidateLiveTables\("suppliers"\)/);
  assert.match(suppliers, new RegExp(`await ${name}\\(`), `supplier handler must call ${name}`);
}
assert.doesNotMatch(suppliers, /local-supplier-|Local-only demonstration/);

// C3: dismiss writes invoice marker + audit; review keeps the legacy four-table order and signed qty.
const dismiss = functionBody(writes, "dismissLivePendingDeduction");
assert.match(dismiss, /legacy_skip_deduct: true/);
assert.match(dismiss, /__DEDUCT_DISMISSED__/);
assert.match(dismiss, /from\("invoices"\)\.update\(updates\)\.eq\("id", invoiceId\)/);
assert.match(dismiss, /from\("stock_deduction_audit"\)\.insert\(\{[\s\S]*decision: "dismissed"/);

const review = functionBody(writes, "reviewLivePendingDeduction");
const buildPlan = functionBody(writes, "buildLiveDeductionPlan");
assert.match(writes, /import \{ fetchAllTablePages \} from "\.\/fetch-all-pages\.js"/);
for (const [table, order] of [
  ["products", "name"],
  ["inventory_stock", "product_id"],
  ["line_item_aliases", "alias_name"]
]) {
  assert.match(review, new RegExp(`fetchAllTablePages\\(\\{[\\s\\S]*?table: "${table}"[\\s\\S]*?orderCol: "${order}"`),
    `${table} must use the full-table paginator before stock math`);
  assert.doesNotMatch(review, new RegExp(`client\\.from\\("${table}"\\)\\.select\\(`),
    `${table} must not use a PostgREST-capped whole-table select`);
}
const stockWrite = review.indexOf('from("inventory_stock").upsert');
const movementWrite = review.indexOf('from("inventory_movements").insert');
const auditWrite = review.indexOf('from("stock_deduction_audit").insert');
const aliasWrite = review.indexOf('from("line_item_aliases").upsert');
assert.ok(stockWrite >= 0 && stockWrite < movementWrite && movementWrite < auditWrite && auditWrite < aliasWrite,
  "pending review must preserve stock -> movement -> audit -> alias write order");
assert.match(review, /qty: deduction\.after/);
assert.match(review, /delta: -deduction\.qty/);
assert.match(review, /type: "sale"/);
assert.match(review, /from\("inventory_movements"\)\.insert\(\{\s*product_id: deduction\.product_id,\s*warehouse_id: deduction\.warehouse_id,\s*delta: -deduction\.qty,\s*type: "sale",\s*reason: `[^`]+`,\s*invoice_id: invoice\.id\s*\}\)/,
  "each stock movement must retain its invoice_id duplicate-defense link");
assert.match(review, /decision: row\.skip \? "skip" : "confirm"/);
assert.match(review, /const auditRows = plan\.map\([\s\S]*?audited_by: currentUser\?\.employeeId \|\| null/,
  "each audit row must identify the confirming employee");
assert.match(review, /onConflict: "alias_name"/);
assert.doesNotMatch(`${buildPlan}\n${review}`, /Math\.max\s*\(\s*0|GREATEST\s*\(/i,
  "pending deductions must preserve negative stock");
assert.match(buildPlan, /product_name:[\s\S]*warehouse_name:[\s\S]*current:[\s\S]*qty:[\s\S]*after:[\s\S]*skip:[\s\S]*reason:/,
  "every preview row must expose product, warehouse, quantities, skip and reason fields");
for (const [name, body] of [["dismissLivePendingDeduction", dismiss], ["reviewLivePendingDeduction", review]]) {
  const invalidation = invalidationArguments(body, name);
  for (const table of ["invoices", "inventory_stock", "inventory_movements", "stock_deduction_audit", "line_item_aliases"]) {
    assert.match(invalidation, new RegExp(`"${table}"`), `${name} invalidation must include ${table}`);
  }
}
const dryRunIndex = review.indexOf("if (dryRun)");
assert.ok(dryRunIndex >= 0 && dryRunIndex < stockWrite,
  "dry-run must return the full plan before the first database write");
assert.match(pending, /await reviewLivePendingDeduction\(invoiceId, \{ dryRun: true \}\)/);
assert.match(pending, /data-pending-plan[\s\S]*data-pending-plan-confirm/,
  "C3 must render the deduction plan before exposing the confirm action");
assert.match(pending, /data-pending-plan-confirm[\s\S]*confirmInPage\(t\(currentLang\(\), "reviewConfirm"/,
  "the reviewed plan must still require an explicit confirmation before writes");
assert.match(pending, /await dismissLivePendingDeduction\(invoiceId\)/);
assert.doesNotMatch(pending, /Local-only demonstration|future API|本地標記|本地忽略/);
assert.match(writes, /name: "歷史發票"[\s\S]*source_item_name: "歷史發票"/);
assert.match(writes, /name: "百老匯渠道"[\s\S]*source_item_name: "百老匯渠道"/);

assert.doesNotMatch(itemMap, /Math\.max\(1/,
  "fractional alias ratios must not be silently raised to one in the editor");
assert.match(itemMap, /\.qty = Number\(qty\.value\) \|\| 1/);
assert.match(itemMap, /qty: Number\(row\.qty\) \|\| 1/);
for (const source of [itemMap, suppliers, pending]) {
  assert.doesNotMatch(source, /catch\s*\{/,
    "inventory write pages must surface the real database error message");
  assert.match(source, /operationFailed[\s\S]*error\.message/);
}

// Destructive/irreversible actions all remain behind local i18n confirmation copy.
assert.match(itemMap, /confirmInPage\(t\(currentHelpersLang\(\), "deleteConfirm"\)/);
assert.match(suppliers, /confirmInPage\(t\(currentLang\(\), "deleteConfirm"\)/);
assert.match(pending, /confirmInPage\(t\(currentLang\(\), "reviewConfirm"/);
assert.match(pending, /confirmInPage\(t\(currentLang\(\), "dismissConfirm"\)/);
for (const [source, keys] of [
  [itemMap, ["saveFailed", "deleteFailed", "verifyFailed", "operationFailed"]],
  [suppliers, ["saveFailed", "deleteFailed", "operationFailed"]],
  [pending, ["reviewConfirm", "dismissConfirm", "reviewFailed", "dismissFailed", "planTitle", "planProduct", "planWarehouse", "planCurrent", "planDeduct", "planAfter", "planReason", "planConfirmButton", "operationFailed"]],
  [shopify, ["reversePreview", "reverseConfirm", "reverseFailed"]]
]) {
  for (const key of keys) {
    assert.equal((source.match(new RegExp(`${key}:`, "g")) || []).length, 3, `${key} must have zh/en/fr copy`);
  }
}

// C4: browser dry-run/confirm pair, new Edge route, unchanged legacy matching semantics.
assert.match(functionBody(writes, "previewLiveShopifyAliasLinks"), /invokeCatalog\("link-from-aliases", \{ confirm: false \}\)/);
assert.match(functionBody(writes, "confirmLiveShopifyAliasLinks"), /invokeCatalog\("link-from-aliases", \{ confirm: true \}\)[\s\S]*invalidateLiveTables\("shopify_variant_links"\)/);
assert.match(shopify, /await previewLiveShopifyAliasLinks\(\)/);
assert.match(shopify, /confirmInPage\(t\(currentLang\(\), "reverseConfirm"/);
assert.match(shopify, /await confirmLiveShopifyAliasLinks\(\)/);
assert.doesNotMatch(shopify, /data-shopify-alias-preview[^>]*disabled[^>]*>/,
  "the reverse-link preview button must not be hard-disabled");
assert.match(edgeIndex, /body\.action === "link-from-aliases"[\s\S]*linkShopifyVariantsFromAliases/);
assert.match(catalog, /export async function linkShopifyVariantsFromAliases/);
assert.match(catalog, /normalizeAliasDisplayName\(displayName\)[\s\S]*normalizeAliasDisplayName\(product\.title\)/);
assert.match(catalog, /alias\.skip === true/);
assert.match(catalog, /mappedProducts\.length > 1/);
assert.match(catalog, /matches\.length > 1/);
assert.match(catalog, /onConflict: "shopify_variant_id,bizflow_product_id"/);

// M1 is additive migration history only; WhatsApp owns 109, so this branch owns 110.
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.suppliers/);
for (const field of ["id", "name", "contact_url", "contact_person", "category", "note", "created_at", "updated_at"]) {
  assert.match(migration, new RegExp(`\\b${field}\\b`), `migration is missing ${field}`);
}
assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b/);
assert.match(migration, /IF NOT EXISTS \([\s\S]*policyname = 'suppliers_bizflow_main_access'/);

console.log("inventory live-write contracts: PASS (C1-C4, admin gate, i18n, invalidation, migration 110)");
