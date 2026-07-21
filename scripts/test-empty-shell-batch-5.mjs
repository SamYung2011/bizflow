import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const [
  migration,
  casMigration,
  shared,
  edge,
  catalogue,
  structure,
  settings,
  productEdge,
  orderEdge,
  writes,
  inventory,
  detail,
  shopify,
  snapshot,
  dependencies,
  provider,
  legacyPanel,
  liveOrderWrites,
  legacyApp,
  legacyInvoices
] = await Promise.all([
  read("migrations/092_shopify_catalog_write.sql"),
  read("migrations/093_shopify_structure_cas.sql"),
  read("supabase/functions/_shared/shopify-admin.ts"),
  read("supabase/functions/shopify-catalog-write/index.ts"),
  read("supabase/functions/shopify-catalog-write/catalog.ts"),
  read("supabase/functions/shopify-catalog-write/structure.ts"),
  read("supabase/functions/shopify-settings/index.ts"),
  read("supabase/functions/shopify-products/index.ts"),
  read("supabase/functions/shopify-orders/index.ts"),
  read("root-site/data/live-inventory-writes.js"),
  read("root-site/bizflow/inventory.js"),
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory-shopify.js"),
  read("root-site/data/live-inventory-snapshot.js"),
  read("root-site/data/live-snapshot-dependencies.js"),
  read("root-site/data/provider.js"),
  read("src/components/ShopifySettingsPanel.jsx"),
  read("root-site/data/live-orders-writes.js"),
  read("src/App.jsx"),
  read("src/views/Invoices.jsx")
]);

for (const table of ["shopify_catalog_bindings", "shopify_catalog_jobs", "shopify_resource_mappings"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), `${table} must be durable schema`);
}
assert.match(migration, /shopify_apply_catalog_job[\s\S]*SECURITY DEFINER/,
  "Shopify success and BizFlow DB finalization must share one transactional RPC");
assert.match(migration, /REVOKE ALL ON FUNCTION public\.shopify_apply_catalog_job[\s\S]*GRANT EXECUTE[\s\S]*service_role/,
  "browser roles must not invoke the finalization RPC");
assert.match(migration, /shopify_variant_links_modify[\s\S]*public\.is_bf_admin\(\)/,
  "legacy M:N component writes must be admin-only");
assert.match(migration, /products_catalog_admin_modify[\s\S]*has_bizflow_main_access\(\)[\s\S]*is_bf_admin\(\)/,
  "direct product mutations must be narrowed to BizFlow administrators");
assert.match(migration, /CREATE POLICY inventory_stock_bizflow_main_access\s+ON public\.inventory_stock FOR ALL TO authenticated\s+USING \(public\.has_bizflow_main_access\(\)\)\s+WITH CHECK \(public\.has_bizflow_main_access\(\)\)/,
  "stock mutations must retain BizFlow-main access for transactional order deductions");
assert.doesNotMatch(migration, /CREATE POLICY inventory_stock[^;]*public\.is_bf_admin\(\)/,
  "catalogue hardening must not make transactional stock writes admin-only");
for (const orderClient of [liveOrderWrites, legacyApp, legacyInvoices]) {
  assert.match(orderClient, /\.from\(["']inventory_stock["']\)/,
    "the RLS contract must account for every signed-in order client that writes inventory_stock");
}
assert.match(migration, /REVOKE UPDATE ON public\.shopify_settings FROM anon, authenticated/,
  "browser credential mutation must be retired with the plaintext unlock path");
assert.match(casMigration, /ADD COLUMN IF NOT EXISTS shopify_structure_hash text/,
  "bindings need a durable Shopify structure baseline separate from the request payload hash");
assert.match(casMigration, /ADD COLUMN IF NOT EXISTS expected_shopify_structure_hash text/,
  "jobs must retain the structure snapshot loaded by the editing client");
assert.match(casMigration, /v_shopify_structure_hash := NULLIF\(p_shopify_result->>'shopifyStructureHash'/,
  "DB finalization must consume the exact live structure hash returned by Shopify");
assert.match(casMigration, /shopify_structure_hash = COALESCE\([\s\S]*EXCLUDED\.shopify_structure_hash[\s\S]*shopify_catalog_bindings\.shopify_structure_hash/,
  "old pending jobs must not erase an already-valid structure baseline");

assert.match(shared, /SHOPIFY_API_VERSION[^\n]*"2026-07"/);
assert.match(shared, /SHOPIFY_EXPECTED_DOMAIN = "honnmonoshop\.myshopify\.com"/);
assert.match(shared, /SHOPIFY_WRITE_SCOPES = \["write_products", "write_inventory"\]/);
assert.match(shared, /SHOPIFY_ADMIN_ACCESS_TOKEN[\s\S]*source: "edge_secret"/,
  "Edge secrets must win over the transitional database token");
assert.match(shared, /currentAppInstallation[\s\S]*accessScopes[\s\S]*missingWriteScopes/,
  "credential health must probe the actual granted scopes");
assert.match(shared, /bizflow_main_access[^\n]*!== true/,
  "admin catalogue access must remain narrowed by BizFlow main access");

const writeGate = edge.indexOf("requireShopifyWriteReady(health)");
const execute = edge.indexOf("executeCatalogWrite(");
assert.ok(writeGate > 0 && execute > writeGate, "scope preflight must run before creating/executing a write job");
assert.match(edge, /SHOPIFY_WRITE_CREDENTIAL_NOT_READY[\s\S]*status = code[^\n]*\? 200/,
  "missing write scopes are an explicit readiness state, not a fake save or server error");

assert.match(catalogue, /productSet\(synchronous: true/);
assert.match(catalogue, /metafieldDefinition\(identifier:[^]*ownerType: PRODUCT[^]*namespace: "bizflow"[^]*key: "parent_product_id"[^]*type \{ name \}/,
  "custom-id preparation must inspect the existing definition type");
assert.match(catalogue, /definitionType === "id"/,
  "an existing id definition must be accepted without mutation");
assert.match(catalogue, /metafieldDefinitionDelete\(id: \$id, deleteAllAssociatedMetafields: false\)/,
  "an incompatible definition must be replaced without deleting existing values");
assert.match(catalogue, /type: "id", ownerType: "PRODUCT"/,
  "Shopify 2026-07 custom IDs require a dedicated id metafield definition");
assert.doesNotMatch(catalogue, /key: "parent_product_id", type: "single_line_text_field"/,
  "the custom ID must never be recreated or explicitly set as a text metafield");
assert.doesNotMatch(catalogue, /ownerId: shopifyProduct\.id, namespace: "bizflow", key: "parent_product_id"/,
  "productSet customId owns the identifier value; warranty writes must not duplicate it");
assert.match(catalogue, /customId: \{ namespace: "bizflow", key: "parent_product_id"/,
  "new products need a stable idempotent Shopify custom identifier");
assert.match(catalogue, /existing\?\.collectionIds[\s\S]*!mappings\.managedCollectionIds\.has/,
  "Shopify-only collections must survive BizFlow catalogue updates");
assert.match(catalogue, /changeFromQuantity: current/,
  "inventory absolute writes must carry compare-and-set state");
assert.doesNotMatch(catalogue, /Missing Shopify location mappings/,
  "unmapped BizFlow warehouses must not block the whole catalogue save or expose raw UUIDs");
assert.match(catalogue, /const locationId = locations\.get\(stock\.warehouseId\)[\s\S]*if \(!locationId\) continue/,
  "unmapped warehouse quantities must stay BizFlow-only and skip Shopify inventory writes");
assert.match(catalogue, /inventorySetQuantities\(input: \$input\) @idempotent\(key: \$key\)/);
assert.match(catalogue, /inventoryActivate[^]*@idempotent\(key: \$key\)/);
assert.match(catalogue, /reconcileShopifyCas[\s\S]*sameTimestamp\(current\.updatedAt, expectedUpdatedAt\)/,
  "CAS must compare equivalent timestamptz and Shopify ISO formats as the same instant");
assert.match(catalogue, /shopifyCasDecision\(comparisonStructureHash, currentStructureHash\) === "conflict"[\s\S]*conflict: true/,
  "a stale timestamp may become a 409 only when the managed Shopify structure changed");
assert.match(catalogue, /isShopifyStructureHash\(expectedStructureHash\)[\s\S]*expectedStructureHash[\s\S]*baselineStructureHash[\s\S]*shopifyCasDecision\(comparisonStructureHash, currentStructureHash\)/,
  "a stale editor must compare its own loaded structure baseline before the current binding fallback");
assert.match(catalogue, /shopify_updated_at: current\.updatedAt[\s\S]*shopify_structure_hash: currentStructureHash[\s\S]*return \{ conflict: false/,
  "Shopify timestamp noise and legacy missing baselines must refresh in place and continue the same write");
assert.match(catalogue, /shopifyStructureHash: await shopifyStructureHash\(finalProduct/,
  "successful writes must persist a baseline from the final live Shopify structure");
assert.match(catalogue, /confirmCatalogBinding[\s\S]*shopify_structure_hash: structureHash/,
  "the explicit refresh-binding path must acknowledge a real external structure baseline");
assert.match(catalogue, /SHOPIFY_UPDATED_AT_CONFLICT[\s\S]*error: "Shopify product changed outside BizFlow"[\s\S]*currentStructureHash: cas\.currentStructureHash/,
  "true external structural changes must retain the existing explicit 409 contract");
assert.match(catalogue, /const cas = action !== "delete"[\s\S]*if \(action !== "delete" && current && cas\.conflict\)/,
  "explicit product deletion must bypass the editor structure CAS at the service boundary");
assert.match(structure, /updatedAt and inventory quantities are deliberately absent/);
assert.doesNotMatch(structure, /shopifyStructureSnapshot[\s\S]*updatedAt:/,
  "updatedAt must never enter the structural fingerprint");
assert.doesNotMatch(structure, /shopifyStructureSnapshot[\s\S]*inventoryLevels:/,
  "inventory quantities keep their dedicated changeFromQuantity CAS instead of product 409s");
assert.match(catalogue, /shopify_applied_pending_db[\s\S]*Resume DB apply failed/,
  "a Shopify-successful job must resume DB finalization instead of repeating the remote write");
assert.match(catalogue, /productDelete\(input: \$input, synchronous: true\)/,
  "approved true delete must call Shopify productDelete");
assert.match(catalogue, /SHOPIFY_MN_EXTERNAL_COMPONENT_BLOCK/);
assert.match(catalogue, /SHOPIFY_MN_COMPLEX_COMPONENT_BLOCK/,
  "catalogue writes must not flatten bundle quantities or many-to-many component maps");
assert.match(catalogue, /SHOPIFY_MN_EXTERNAL_REUSE_DELETE_BLOCK/,
  "delete must block when the BizFlow component group is reused by another Shopify product");

assert.doesNotMatch(settings, /from\("wa_settings"\)|admin_password/,
  "Shopify credential access must no longer depend on the WhatsApp password");
assert.match(settings, /access_token: ""/,
  "legacy unlock callers must receive an empty token");
assert.doesNotMatch(settings, /access_token:\s*data|select\("[^\"]*access_token[^\"]*"\)[\s\S]*return jsonResponse[^]*access_token:\s*data/,
  "no settings response may return database plaintext");
assert.match(productEdge, /requireBizflowAdmin\(req\)/);
assert.match(productEdge, /Catalogue source of truth is BizFlow/);
assert.match(orderEdge, /loadShopifyCredentials\(supabase\)/,
  "the live order poller must follow the same Edge-secret-first credential chain");
assert.match(legacyPanel, /Authorization: `Bearer \$\{session\.access_token\}`/,
  "the legacy React panel must authenticate Edge calls with the user session, not the anon key");
assert.doesNotMatch(legacyPanel, /handleUnlock|tokenDraft|action: 'save'/,
  "the legacy React panel must not retain a plaintext credential editor");
assert.doesNotMatch(legacyPanel, /shpat_|Access Token.*貼回此處/,
  "legacy help copy must not direct administrators to paste tokens into the browser");
assert.match(legacyPanel, /Shopify 憑證由伺服器安全管理/);
assert.match(legacyPanel, /BizFlow 管理商品目錄與庫存/,
  "the legacy product view must state the approved BizFlow-to-Shopify ownership direction");

for (const functionName of [
  "createLiveInventoryProduct", "updateLiveInventoryProduct", "deleteLiveInventoryProduct",
  "confirmLiveShopifyBinding", "saveLiveShopifyResourceMapping"
]) {
  assert.match(writes, new RegExp(`export async function ${functionName}\\b`), `${functionName} is missing`);
}
assert.match(writes, /currentUser\?\.isBfAdmin !== true[^]*currentUser\?\.bizflowMainAccess !== true/,
  "browser write helpers must require both administrator and BizFlow main access");

assert.match(inventory, /await createLiveInventoryProduct\(/,
  "authenticated product creation must use the live Shopify catalogue write");
assert.match(inventory, /legacyDomainHelpers = \{ \.\.\.helpers, liveReadOnly: authenticated \}/,
  "Shopify scope activation must not unlock the older fake alias/supplier/pending writes");
assert.match(inventory, /Shopify 寫入憑證未就緒/);
assert.match(inventory, /Shopify write credential is not ready/);
assert.match(inventory, /Les identifiants d'écriture Shopify ne sont pas prêts/);
assert.match(inventory, /inventory-required-mark[^]*inventory\.addModal\.code/,
  "the live product form must visibly mark SKU as required");
assert.match(inventory, /inventory\.addModal\.warranty[^]*inventory-required-mark/,
  "the live product form must visibly mark warranty months as required");
assert.doesNotMatch(inventory, /page\.outerHTML\s*=/,
  "inventory rerenders must not use the detached-node outerHTML race path");
assert.doesNotMatch(inventory, /page\.replaceWith\(nextPage\)/,
  "inventory rerenders must not reuse the detached-node replaceWith race path");
assert.match(inventory, /inventoryRenderQueued[\s\S]*inventoryRenderGeneration[\s\S]*queueMicrotask\([\s\S]*isCurrentInventoryScope\(scope\)[\s\S]*page\.parentNode !== parent[\s\S]*parent\.replaceChild\(nextPage, page\)/,
  "inventory rerenders must coalesce and revalidate the current node immediately before replacement");
assert.match(detail, /await updateLiveInventoryProduct\(/);
assert.match(detail, /await deleteLiveInventoryProduct\(/);
assert.match(snapshot, /structureHash: asText\(binding\.shopify_structure_hash\)/,
  "inventory detail must receive the structure baseline loaded with its timestamp");
assert.match(writes, /expectedShopifyStructureHash[\s\S]*invokeCatalog\("update"/,
  "update writes must send the editor's structure baseline");
assert.match(writes, /functionErrorPayload\(result\.error, result\.response\)[\s\S]*detail\?\.code/,
  "non-2xx function responses must preserve the structured Shopify error code and payload");
assert.match(writes, /export async function deleteLiveInventoryProduct\(bizflowParentProductId\)[\s\S]*invokeCatalog\("delete", \{[\s\S]*requestId: requestId\(\), bizflowParentProductId[\s\S]*\}\)/,
  "browser deletion must not send a stale editor structure baseline");
assert.doesNotMatch(writes, /invokeCatalog\("delete", \{[\s\S]{0,180}expectedShopify/,
  "delete intent must stay independent of Shopify editor CAS fields");
assert.match(detail, /SHOPIFY_UPDATED_AT_CONFLICT[\s\S]*currentStructureHash[\s\S]*confirmInPage\([\s\S]*inventory\.conflict\.message[\s\S]*expectedStructureHash = currentStructureHash/,
  "a true conflict must require explicit confirmation before retrying with the returned live baseline");
assert.match(detail, /if \(!proceed\)[\s\S]*return;[\s\S]*detail\.product\.shopifyBinding =/,
  "cancelling conflict recovery must not acknowledge the new baseline for a later silent overwrite");
assert.match(detail, /Shopify 變更衝突/);
assert.match(detail, /Shopify change conflict/);
assert.match(detail, /Conflit de modification Shopify/);
assert.match(detail, /data-parent-warehouse-qty[\s\S]*detail\.warehouses\.find/,
  "single-variant products need editable per-warehouse stock for CAS writes");
assert.match(detail, /detail\.subitems\.push\(item\)/,
  "variant creation must enter the full save payload");
assert.match(detail, /data-modal-delete/,
  "variant deletion needs a real draft action before save");
assert.match(detail, /shopifyBinding\?\.status === "active"/,
  "existing products must stay disabled until their catalogue binding is active");
assert.match(detail, /deleteConfirm[\s\S]*deleteFinal/,
  "true product deletion must use the approved two-step confirmation");

assert.match(shopify, /getShopifyAlignmentPlan\(\)\.catch/,
  "the Shopify tab must show a true read-side alignment plan tonight");
assert.match(shopify, /confirmLiveShopifyBinding/);
assert.match(shopify, /saveLiveShopifyResourceMapping/);
assert.match(shopify, /linkLiveShopifyComponent[\s\S]*unlinkLiveShopifyComponent/);
assert.doesNotMatch(shopify, /local-shopify-link-/,
  "the Shopify tab must not retain its old fake component-link save");

assert.match(snapshot, /allRows\("shopify_catalog_bindings"/);
assert.match(snapshot, /allRows\("shopify_variant_links"/);
assert.match(snapshot, /allRows\("shopify_resource_mappings"[\s\S]*shopifyMapped: warehouseMappingState/,
  "warehouse rows must expose whether Shopify owns that location");
assert.match(dependencies, /"inventory\.json": \[[\s\S]*"shopify_catalog_bindings"[\s\S]*"shopify_variant_links"[\s\S]*"shopify_resource_mappings"/);
assert.match(provider, /shopifyBinding: listProduct\.detail\.shopifyBinding/,
  "detail state must receive the binding and Shopify updatedAt used by its gates and CAS");
for (const label of ["僅 BizFlow", "BizFlow only", "BizFlow uniquement"]) {
  assert.match(detail, new RegExp(label), `missing warehouse scope translation: ${label}`);
}
assert.match(detail, /shopifyMapped !== false[\s\S]*inventory-warehouse-scope-badge/,
  "only explicitly unmapped warehouse rows receive the BizFlow-only badge");

console.log("Empty-shell batch 5 contracts: PASS (Shopify health, ownership, durable jobs, CAS, true catalogue writes)");
