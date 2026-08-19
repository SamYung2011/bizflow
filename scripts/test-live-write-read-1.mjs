import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  clearLiveTableCache,
  liveSnapshotCacheVersion,
  liveTableCacheVersion,
  readLiveSnapshotCache,
  readLiveTableCache,
  writeLiveSnapshotCache,
  writeLiveTableCache
} from "../root-site/data/live-table-cache.js";
import { invalidateLiveTables } from "../root-site/data/live-snapshot-utils.js";

const userId = "perf-write-read-user";
const table = "invoices";
const tableArgs = { userId, table, orderCol: "created_at", ascending: false, secondaryOrder: "id" };
const snapshotArgs = { userId, snapshot: "orders.json", companyId: "company-perf-write" };

await clearLiveTableCache();
const tableVersionBeforeWrite = liveTableCacheVersion(table);
const snapshotVersionBeforeWrite = liveSnapshotCacheVersion(snapshotArgs.snapshot);
assert.equal(await writeLiveTableCache({
  ...tableArgs,
  rows: [{ id: "order-before-save" }],
  version: tableVersionBeforeWrite
}), true);
assert.equal(await writeLiveSnapshotCache({
  ...snapshotArgs,
  value: { rows: [{ id: "order-before-save" }] },
  version: snapshotVersionBeforeWrite
}), true);

await invalidateLiveTables(table);
assert.equal(await readLiveTableCache(tableArgs), null,
  "a self-write must hard-evict old table rows so the immediate read goes to the network");
assert.equal(await readLiveSnapshotCache(snapshotArgs), null,
  "a self-write must hard-evict the derived snapshot so a newly-created row cannot appear missing");
assert.equal(await writeLiveTableCache({
  ...tableArgs,
  rows: [{ id: "late-before-save" }],
  version: tableVersionBeforeWrite
}), false, "a pre-write table request must not refill the hard-invalidated generation");
assert.equal(await writeLiveSnapshotCache({
  ...snapshotArgs,
  value: { rows: [{ id: "late-before-save" }] },
  version: snapshotVersionBeforeWrite
}), false, "a pre-write snapshot build must not refill the hard-invalidated generation");

const freshTableVersion = liveTableCacheVersion(table);
assert.equal(await writeLiveTableCache({
  ...tableArgs,
  rows: [{ id: "order-after-save" }],
  version: freshTableVersion
}), true);
assert.deepEqual(await readLiveTableCache(tableArgs), {
  rows: [{ id: "order-after-save" }],
  stale: false
});

const [utilsSource, realtimeSource] = await Promise.all([
  readFile(new URL("../root-site/data/live-snapshot-utils.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-realtime.js", import.meta.url), "utf8")
]);
const writeInvalidation = utilsSource.slice(
  utilsSource.indexOf("export async function invalidateLiveTables"),
  utilsSource.length
);
assert.match(writeInvalidation, /invalidateLiveTableCacheAfterWrite/,
  "all write helpers must select hard cache invalidation");
assert.match(realtimeSource, /invalidateTables: \(tables\) => invalidateLiveTableData\(tables\)/,
  "realtime must stay on the serve-stale invalidation path");

await clearLiveTableCache();
console.log("Live write/read contracts: PASS (self-write hard miss, late-write guard, realtime SWR split)");
