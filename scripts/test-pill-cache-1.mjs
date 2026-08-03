import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { deriveShippingListView } from "../root-site/components/order-metrics.js";
import {
  createLiveTableSWRBatcher,
  LIVE_TABLE_SWR_BATCH_DELAY_MS
} from "../root-site/data/live-snapshot-utils.js";
import { snapshotsForTables } from "../root-site/data/live-snapshot-dependencies.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [ordersSource, snapshotsSource, authSource, utilsSource, tableCacheSource] = await Promise.all([
  read("root-site/bizflow/orders.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/data/auth.js"),
  read("root-site/data/live-snapshot-utils.js"),
  read("root-site/data/live-table-cache.js")
]);

const order = (id, shippingStatus = "unshipped") => ({
  id,
  date: "2026/07/23",
  detail: { shippingStatus, shippedAt: "" }
});
const before = deriveShippingListView([order("one")], "all", new Date("2026-07-23T04:00:00Z"));
const after = deriveShippingListView([order("two"), order("one")], "all", new Date("2026-07-23T04:00:00Z"));
assert.equal(before.counts.all, before.orders.length);
assert.equal(after.counts.all, after.orders.length);
assert.equal(after.counts.all, before.counts.all + 1,
  "one inserted order must increment the all-status pill and visible all-list in the same derivation");
assert.match(ordersSource, /function shippingListView\(\) \{\s*return deriveShippingListView\(ordersBeforeShipping\(\), state\.shipping\);\s*\}[\s\S]*?const view = shippingListView\(\);[\s\S]*?const filtered = view\.orders;[\s\S]*?renderShippingFilters\(helpers, view\.counts\)/,
  "one render pass must feed status pills and rows from the same shipping-list view");
assert.doesNotMatch(ordersSource, /ordersBeforeShipping\(\)\.filter\(\(order\) => matchesShippingFilter/,
  "orders.js must not retain a second shipping-filter derivation outside the shared view");
assert.match(ordersSource, /const nextData = await getOrdersPageData\(\);[\s\S]*?data = nextData;[\s\S]*?rerenderOrdersPage\(\);/,
  "orders snapshot refresh must replace the data source before the full-page rerender");
assert.match(snapshotsSource, /async function buildOrdersSnapshot\(\)[\s\S]*?const source = await orderSourceData\(\);[\s\S]*?const orders = source\.invoices\.map/,
  "orders snapshot rows and counts must retain one deduped invoice source");

function scheduler() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    run() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    get size() {
      return callbacks.size;
    }
  };
}

const clock = scheduler();
const evictions = [];
const invalidations = [];
const updates = [];
const batcher = createLiveTableSWRBatcher({
  delay: LIVE_TABLE_SWR_BATCH_DELAY_MS,
  scheduleTimeout: (callback) => clock.schedule(callback),
  cancelTimeout: (id) => clock.cancel(id),
  evictTables: (tables) => evictions.push([...tables]),
  snapshotsFor: snapshotsForTables,
  invalidateSnapshots: async (snapshots) => invalidations.push([...snapshots]),
  dispatchUpdated: (tables, snapshots) => updates.push({ tables: [...tables], snapshots: [...snapshots] }),
  warn: (message, error) => assert.fail(`${message}: ${error}`)
});

batcher.queue("customers");
batcher.queue("invoices");
assert.equal(clock.size, 1, "multiple stale table completions must share one trailing 250ms timer");
assert.deepEqual(evictions, [["customers"], ["invoices"]],
  "each completed table refill must immediately evict its stale in-memory table promise");
clock.run();
await batcher.flush();
assert.equal(invalidations.length, 1, "one stale-table burst must invalidate dependent snapshots once");
assert.equal(updates.length, 1, "one stale-table burst must notify mounted pages once");
assert.deepEqual(updates[0].tables, ["customers", "invoices"]);
for (const snapshot of ["orders.json", "customers.json", "pending-deduction.json", "warranty.json", "home.json"]) {
  assert.ok(updates[0].snapshots.includes(snapshot), `${snapshot} must rebuild after stale customer/invoice tables refresh`);
}
batcher.dispose();

const staleBranch = authSource.slice(
  authSource.indexOf("if (cached) {", authSource.indexOf("export async function fetchAllTable")),
  authSource.indexOf("const rows = await fetchAllTableOnce", authSource.indexOf("export async function fetchAllTable"))
);
assert.match(staleBranch, /writeLiveTableCache\([\s\S]*?if \(stored && typeof window !== "undefined"\)[\s\S]*?LIVE_TABLE_SWR_REFRESHED_EVENT/,
  "a successful background table refill must notify the SWR snapshot batcher");
assert.equal((authSource.match(/new CustomEvent\(LIVE_TABLE_SWR_REFRESHED_EVENT/g) ?? []).length, 1,
  "fresh and cold table reads must not emit the stale-refill event");
assert.equal(LIVE_TABLE_SWR_BATCH_DELAY_MS, 250);
assert.match(utilsSource, /invalidateLiveSnapshotCache\(snapshots\)[\s\S]*detail: \{ tables, snapshots, source: "table-swr" \}/,
  "the batcher must invalidate snapshots before using the existing updated-event chain");
assert.match(tableCacheSource, /export const LIVE_TABLE_CACHE_TTL_MS = 10 \* 60_000;/,
  "PILL-cache-1 must not change the approved ten-minute table TTL");

for (const [snapshot, generation] of [
  ["home.json", 3],
  ["customers.json", 2],
  ["warranty.json", 2],
  ["orders.json", 2],
  ["pending-deduction.json", 1]
]) {
  assert.match(tableCacheSource, new RegExp(`\\["${snapshot.replace(".", "\\.")}", ${generation}\\]`),
    `${snapshot} must reject pre-fix cached customer joins`);
}

console.log("PILL-cache-1 contracts: PASS (single-source pills, SWR rebuild batching, snapshot generations)");
