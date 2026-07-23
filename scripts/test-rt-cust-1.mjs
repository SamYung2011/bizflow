import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { visibleRealtimeTables } from "../root-site/data/live-realtime.js";

const migration = await readFile(
  new URL("../migrations/097_realtime_publication_customers_charger_leads.sql", import.meta.url),
  "utf8"
);

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

for (const table of ["invoices", "customers", "charger_leads", "northbound_records"]) {
  assert.ok(bizflowTables.includes(table), `${table} must be included in the BizFlow realtime subscription`);
}
assert.ok(!teamOnlyTables.includes("customers"), "team-only users must not subscribe to customers");
assert.ok(!teamOnlyTables.includes("charger_leads"), "team-only users must not subscribe to charger_leads");

assert.match(migration, /DO \$\$[\s\S]*BEGIN[\s\S]*END \$\$;/,
  "097 must retain its replay-safe DO block");
for (const table of ["customers", "charger_leads"]) {
  assert.match(migration, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='${table}'\\)`),
    `097 must guard ${table} before adding it to the realtime publication`);
  assert.match(migration, new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE public\\.${table};`),
    `097 must add ${table} to the realtime publication`);
}

console.log("RT-cust-1 contracts: PASS (BizFlow scope, customers/charger leads subscriptions, idempotent 097)");
