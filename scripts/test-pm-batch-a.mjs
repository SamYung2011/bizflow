import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shellCss = read("root-site/shell/shell.css");
const homeJs = read("root-site/bizflow/home.js");
const inventoryDetail = read("root-site/bizflow/inventory-detail.js");
const inventoryWrites = read("root-site/data/live-inventory-writes.js");
const shopifyCatalog = read("supabase/functions/shopify-catalog-write/catalog.ts");
const taskDetail = read("root-site/team/tasks-detail.js");
const tasksCss = read("root-site/team/tasks.css");
const taskDomainCss = read("root-site/team/tasks-domain.css");

assert.match(shellCss, /\.shell-page-inner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
  "desktop page content must fill the available shell width");
assert.match(shellCss, /\.shell-grid\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "the loading grid must fill wide desktop shells with flexible tracks");
assert.doesNotMatch(shellCss, /max-width:\s*1494px/,
  "the former desktop page-width ceiling must be removed");
assert.match(shellCss, /\.shell-app--mobile \.shell-page-inner\s*\{[\s\S]*?width:\s*min\(100%,\s*362px\)/,
  "the approved mobile content width must remain unchanged");

assert.match(homeJs, /const bannerStats\s*=\s*data\.stats\.filter\(\(stat\)\s*=>[\s\S]*?stat\.key\s*!==\s*"members"[\s\S]*?\);/,
  "the Home banner must omit the team-member statistic");
assert.match(homeJs, /\$\{bannerStats\.map\(\(s\)\s*=>\s*statCard/,
  "the Home banner must render only the filtered five-card statistic set");
assert.match(homeJs, /data-home-members/,
  "removing the team-member banner card must not remove the lower team-member component");
assert.match(homeJs, /<section class="home-logistics"[\s\S]*?logisticsCard\(\{ filter: "pending"[\s\S]*?logisticsCard\(\{ filter: "in_transit"[\s\S]*?logisticsCard\(\{ filter: "exception"/,
  "the three logistics summary cards must remain unchanged");

assert.match(inventoryDetail, /function syncShopifyWriteAccess\(\)[\s\S]*?inventoryWriteAccess\(\{[\s\S]*?checking: shopifyHealthChecking,[\s\S]*?health: shopifyHealth/,
  "an absent Shopify binding must not make an otherwise write-ready administrator read-only");
assert.doesNotMatch(inventoryDetail, /liveReadOnly\s*=\s*authenticated\s*&&\s*\([^)]*bindingReady/,
  "the product binding must stay outside the page-wide write gate");
assert.match(inventoryDetail, /updateLiveInventoryProduct\(payload, expectedUpdatedAt, expectedStructureHash, \{ shopifyBound \}\)/,
  "detail saves must explicitly select the bound or BizFlow-only write path");
assert.match(inventoryWrites, /if \(!shopifyBound\) return updateBizflowOnlyInventoryProduct\(product\);[\s\S]*?invokeCatalog\("update"/,
  "unbound saves must take the DB-only branch before the Shopify Edge invocation");
assert.match(inventoryWrites, /status:\s*\["draft", "active", "discontinued"\]\.includes\(product\.status\) \? product\.status/,
  "the DB row must preserve the selected product status");
assert.match(inventoryWrites, /from\("products"\)\.update\(parent\)\.eq\("id", product\.id\)/,
  "BizFlow-only saves must persist the local product row");
assert.match(shopifyCatalog, /function shopifyStatus\(status: string\)[\s\S]*?active[\s\S]*?"ACTIVE"[\s\S]*?discontinued[\s\S]*?"ARCHIVED"[\s\S]*?"DRAFT"/,
  "bound saves must preserve the approved BizFlow-to-Shopify status mapping");
for (const label of ["僅 BizFlow：", "BizFlow only:", "BizFlow uniquement :"]) {
  assert.match(inventoryDetail, new RegExp(label), `missing local-only product status copy: ${label}`);
}

assert.match(taskDetail, /data-task-detail-panel="feedback" data-task-detail-sticky="feedback"/,
  "the feedback column must expose a stable sticky layout hook");
assert.match(taskDomainCss, /@media \(min-width: 769px\)[\s\S]*?\.team-task-page--detail \.team-member-rail,[\s\S]*?\.task-detail__feedback\[data-task-detail-sticky="feedback"\][\s\S]*?position: sticky;[\s\S]*?top: var\(--task-detail-sticky-top\)/,
  "the member rail and feedback column must stick only at desktop widths");
assert.match(taskDomainCss, /\.task-detail__thread\s*\{[\s\S]*?max-height:\s*60vh;[\s\S]*?overflow-y:\s*auto;/,
  "long task feedback must scroll inside a viewport-bounded thread");
assert.match(tasksCss, /\.task-detail__thread\s*>\s*\.chat-bubble\s*\{[\s\S]*?flex:\s*0\s+0\s+auto;/,
  "direct feedback bubbles must not flex-shrink inside the height-limited thread");
assert.doesNotMatch(taskDetail, /addEventListener|setInterval|setTimeout/,
  "the task detail layout change must not add data or lifecycle behavior");

console.log("PM batch A contracts: PASS (full width, Home banner, inventory writes, sticky task detail)");
