import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { visibleRealtimeTables } from "../root-site/data/live-realtime.js";
import { snapshotsForTables } from "../root-site/data/live-snapshot-dependencies.js";

const [migration, shopifyProductsSource] = await Promise.all([
  readFile(
    new URL("../migrations/099_realtime_publication_server_written_tables.sql", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../supabase/functions/shopify-products/index.ts", import.meta.url), "utf8")
]);

const sharedTables = Object.freeze([
  "employee_tasks",
  "task_assignees",
  "employee_task_feedbacks",
  "employees",
  "employee_departments"
]);
const serverWrittenBizflowTables = Object.freeze([
  "shipment_events",
  "products",
  "inventory_stock",
  "inventory_movements",
  "shopify_catalog_bindings",
  "shopify_variant_links",
  "shopify_resource_mappings"
]);
const deferredClientWrittenTables = Object.freeze([
  "warranty_renewals",
  "customer_devices"
]);

const teamOnlyTables = visibleRealtimeTables({
  userId: "team-only",
  bizflowMainAccess: false,
  isBfAdmin: false
});
const bizflowTables = visibleRealtimeTables({
  userId: "bizflow-main",
  bizflowMainAccess: true,
  isBfAdmin: false
});

for (const table of sharedTables) {
  assert.ok(teamOnlyTables.includes(table), `${table} must be shared with team-only users`);
  assert.ok(bizflowTables.includes(table), `${table} must be shared with BizFlow users`);
}
for (const table of serverWrittenBizflowTables) {
  assert.ok(bizflowTables.includes(table), `${table} must be included in the BizFlow realtime subscription`);
  assert.ok(!teamOnlyTables.includes(table), `team-only users must not subscribe to ${table}`);
  assert.ok(snapshotsForTables([table]).size > 0, `${table} must invalidate at least one live snapshot`);
}
assert.deepEqual(
  [...snapshotsForTables(["shipment_events"])].sort(),
  ["home-order-metrics.json", "home.json", "orders.json"].sort(),
  "shipment_events must rebuild every snapshot that renders the order timeline"
);
for (const table of deferredClientWrittenTables) {
  assert.ok(!teamOnlyTables.includes(table), `${table} must remain outside this realtime scope`);
  assert.ok(!bizflowTables.includes(table), `${table} must remain outside this realtime scope`);
}

assert.match(
  migration,
  /DO \$\$[\s\S]*BEGIN[\s\S]*END \$\$;/,
  "099 must remain replay-safe"
);
for (const table of serverWrittenBizflowTables) {
  assert.match(
    migration,
    new RegExp(
      `IF NOT EXISTS \\(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='${table}'\\)`
    ),
    `099 must guard ${table} before adding it to the realtime publication`
  );
  assert.match(
    migration,
    new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE public\\.${table};`),
    `099 must add ${table} to the realtime publication`
  );
}
for (const table of ["employees", "employee_departments", ...deferredClientWrittenTables]) {
  assert.doesNotMatch(
    migration,
    new RegExp(`ADD TABLE public\\.${table}(?:;|\\b)`),
    `099 must not add ${table}`
  );
}

const syncStart = shopifyProductsSource.indexOf('if (body.action === "sync")');
const syncEnd = shopifyProductsSource.indexOf('if (body.action === "sync_old_disabled")');
assert.ok(syncStart >= 0 && syncEnd > syncStart, "public sync and legacy sync branches must remain distinct");
const publicSyncBranch = shopifyProductsSource.slice(syncStart, syncEnd);
assert.match(
  publicSyncBranch,
  /return json\(\{ error: [\s\S]*\}, 501\);/,
  "public Shopify product sync must continue returning HTTP 501"
);
assert.doesNotMatch(
  publicSyncBranch,
  /\.from\(|\.rpc\(|fetchAllProducts\(/,
  "public Shopify product sync must not read or write catalogue data while disabled"
);

console.log("RT-ship-1 contracts: PASS (7 BizFlow + 2 shared, replay-safe 099, Shopify sync 501)");
