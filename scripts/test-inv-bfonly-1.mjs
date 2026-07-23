import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [detail, css, snapshot, provider, writes, catalog, migration] = await Promise.all([
  read("root-site/bizflow/inventory-detail.js"),
  read("root-site/bizflow/inventory.css"),
  read("root-site/data/live-inventory-snapshot.js"),
  read("root-site/data/provider.js"),
  read("root-site/data/live-inventory-writes.js"),
  read("supabase/functions/shopify-catalog-write/catalog.ts"),
  read("migrations/098_products_shopify_excluded.sql")
]);

function dictionaryBlock(source, language, nextLanguage) {
  const end = nextLanguage ? `\\n  ${nextLanguage}: \\{` : "\\n\\};";
  const match = source.match(new RegExp(`\\n  ${language}: \\{([\\s\\S]*?)${end}`));
  assert.ok(match, `missing ${language} dictionary`);
  return match[1];
}

for (const [language, nextLanguage] of [["zh", "en"], ["en", "fr"], ["fr", null]]) {
  const block = dictionaryBlock(detail, language, nextLanguage);
  assert.match(block, /"inventory\.modal\.shopifyExcluded": "[^"]+"/,
    `${language} exclusion label must exist`);
  assert.match(block, /"inventory\.modal\.shopifyExcludedHint": "[^"]+"/,
    `${language} exclusion hint must exist`);
}

assert.match(detail, /type="checkbox" data-modal-shopify-excluded/,
  "the subitem modal must expose an exclusion checkbox");
assert.match(detail, /state\.modalItem\.shopifyExcluded = shopifyExcluded\.checked/,
  "the checkbox must update modal state");
assert.match(detail, /shopifyExcluded: state\.modalItem\.shopifyExcluded === true/,
  "modal confirmation must retain the flag");
assert.match(detail, /item\.shopifyExcluded === true[\s\S]*inventory-warehouse-scope-badge/,
  "excluded subitems must show the existing BizFlow-only pill");
assert.match(css, /\.inventory-modal-shopify-excluded\s*\{[\s\S]*?align-items:\s*center/,
  "the modal checkbox must have scoped layout");

assert.match(snapshot, /shopifyExcluded: variant\.shopify_excluded === true/,
  "the live snapshot must carry the DB flag");
assert.match(provider, /shopifyExcluded: variant\.shopifyExcluded === true/,
  "the provider must carry the flag into the detail model");
assert.match(writes, /shopify_excluded: product\.shopifyExcluded === true/,
  "local-only saves must persist the DB column");
assert.match(writes, /function localVariants[\s\S]*?bizflowOnlyVariants/,
  "local-only writes and stock rows must retain excluded variants");

assert.match(
  detail,
  /variants: variants\.filter\(\(item\) => item\.shopifyExcluded !== true\),[\s\S]*?bizflowOnlyVariants: variants\.filter\(\(item\) => item\.shopifyExcluded === true\)/,
  "the browser payload must keep excluded rows out of Shopify variants"
);
assert.match(catalog, /async function enforceShopifyExclusions[\s\S]*?select\("id,internal_code,shopify_excluded"\)/,
  "Edge must read DB exclusions by parent");
assert.match(catalog, /typeof row\.shopifyExcluded === "boolean" \? row\.shopifyExcluded : null/,
  "a stale client that omits the flag must not silently unexclude a stored row");
assert.match(
  catalog,
  /async function persistShopifyExclusionState[\s\S]*?shopify_excluded: false[\s\S]*?shopify_excluded: true/,
  "Edge must durably support both unexclude and exclude states"
);
assert.match(
  catalog,
  /if \(action !== "delete" && current && cas\.conflict\)[\s\S]*?await persistShopifyExclusionState\(admin, product!\);[\s\S]*?await enforceShopifyExclusions\(admin, product!\);[\s\S]*?createOrUpdateShopifyProduct/,
  "DB exclusion persistence and enforcement must happen after CAS and before Shopify"
);
assert.match(
  catalog,
  /request_payload: \{ product: shopifyProduct \}/,
  "the durable DB apply job must use the server-enforced variant split"
);
assert.match(catalog, /excludedIds\.has\(variant\.id\)[\s\S]*?excludedCodes\.has\(variant\.internalCode\.toLowerCase\(\)\)/,
  "a forged payload must be filtered by stored ID or SKU");
assert.match(catalog, /const sourceItems = product\.variants\.length \? product\.variants : \[product\]/,
  "inventory sync must consume the already-filtered Shopify variant list");
assert.match(catalog, /input\.productOptions = \[\];[\s\S]*?input\.variants = \[\];/,
  "all variants excluded must retain the approved legacy single-variant collapse");

assert.match(catalog, /select\("id,name,parent_product_id,internal_code,status,category,collections,shopify_excluded"\)/,
  "alignment must load exclusion state");
assert.match(catalog, /const links = \(linksResult\.data \|\| \[\]\)\.filter\(\(link\) => !excludedProductIds\.has\(link\.bizflow_product_id\)\)/,
  "alignment must treat excluded components as expected absence");
assert.match(catalog, /product\.data\?\.shopify_excluded === true[\s\S]*?reason: "shopify_excluded"/,
  "link-component must refuse to recreate an excluded link");

assert.match(migration, /ADD COLUMN IF NOT EXISTS shopify_excluded boolean NOT NULL DEFAULT false;/,
  "098 must add the safe defaulted column");
assert.match(
  migration,
  /v_product->'variants'[\s\S]*?\|\|[\s\S]*?v_product->'bizflowOnlyVariants'/,
  "DB apply must merge Shopify and BizFlow-only variants"
);
assert.match(migration, /shopify_excluded = EXCLUDED\.shopify_excluded/,
  "DB apply must persist exclusion updates");
assert.match(
  migration,
  /SET shopify_variant_id = NULL,[\s\S]*?shopify_sku = NULL[\s\S]*?shopify_excluded = true/,
  "successful withdrawal must clear legacy direct links"
);
assert.match(
  migration,
  /DELETE FROM public\.shopify_variant_links[\s\S]*?shopify_excluded = true/,
  "successful withdrawal must clear M:N variant links"
);
assert.match(migration, /Deployment order: migration first, then shopify-catalog-write, then the front end\./,
  "the release order must be recorded beside the migration");

console.log("INV-bfonly-1 contracts: PASS (UI flag, DB authority, Shopify withdrawal, alignment absence)");
