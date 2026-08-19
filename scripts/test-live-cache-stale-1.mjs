import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  clearLiveTableCache,
  invalidateLiveSnapshotCache,
  invalidateLiveTableCache,
  liveSnapshotCacheVersion,
  liveTableCacheVersion,
  readLiveSnapshotCache,
  readLiveTableCache,
  writeLiveSnapshotCache,
  writeLiveTableCache
} from "../root-site/data/live-table-cache.js";

const userId = "perf-stale-user";
const table = "employee_tasks";
const tableArgs = { userId, table, orderCol: "created_at", ascending: false, secondaryOrder: "id" };
const snapshotArgs = { userId, snapshot: "tasks.json", companyId: "company-perf" };

await clearLiveTableCache();
const firstTableVersion = liveTableCacheVersion(table);
const firstSnapshotVersion = liveSnapshotCacheVersion(snapshotArgs.snapshot);
assert.equal(await writeLiveTableCache({ ...tableArgs, rows: [{ id: "old-task" }], version: firstTableVersion }), true);
assert.equal(await writeLiveSnapshotCache({ ...snapshotArgs, value: { tasks: [{ id: "old-task" }] }, version: firstSnapshotVersion }), true);
assert.deepEqual(await readLiveTableCache(tableArgs), { rows: [{ id: "old-task" }], stale: false });
assert.equal((await readLiveSnapshotCache(snapshotArgs))?.stale, false);

await invalidateLiveTableCache(table);
assert.deepEqual(await readLiveTableCache(tableArgs), { rows: [{ id: "old-task" }], stale: true },
  "table invalidation must keep the old rows available as stale");
const staleSnapshot = await readLiveSnapshotCache(snapshotArgs);
assert.deepEqual(staleSnapshot?.value, { tasks: [{ id: "old-task" }] });
assert.equal(staleSnapshot?.stale, true, "dependent snapshots must remain available as stale");
assert.equal(await writeLiveTableCache({ ...tableArgs, rows: [{ id: "late-old-write" }], version: firstTableVersion }), false,
  "a pre-invalidation table request must not overwrite the new generation");
assert.equal(await writeLiveSnapshotCache({ ...snapshotArgs, value: { tasks: [] }, version: firstSnapshotVersion }), false,
  "a pre-invalidation snapshot build must not overwrite the new generation");

const refreshedVersion = liveTableCacheVersion(table);
assert.equal(await writeLiveTableCache({ ...tableArgs, rows: [{ id: "fresh-task" }], version: refreshedVersion }), true);
assert.deepEqual(await readLiveTableCache(tableArgs), { rows: [{ id: "fresh-task" }], stale: false });

await invalidateLiveSnapshotCache(snapshotArgs.snapshot);
assert.equal(await readLiveSnapshotCache(snapshotArgs), null,
  "explicit hard invalidation must still remove incompatible/company-sensitive snapshots");
await clearLiveTableCache();
assert.equal(await readLiveTableCache(tableArgs), null, "logout-style cache clearing must still remove persisted rows");

const source = await readFile(new URL("../root-site/data/live-table-cache.js", import.meta.url), "utf8");
const tableInvalidation = source.slice(
  source.indexOf("export async function invalidateLiveTableCache"),
  source.indexOf("export async function invalidateLiveTableCacheAfterWrite")
);
assert.doesNotMatch(tableInvalidation, /removeIndexed|removeFallbackValue/,
  "ordinary realtime invalidation must never delete table or snapshot payloads");
assert.match(tableInvalidation, /markLiveSnapshotCacheStale/);

console.log("Live cache stale contracts: PASS (serve stale, background generation, hard clear and race guard)");
