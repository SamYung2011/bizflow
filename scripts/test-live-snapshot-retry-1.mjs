import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LIVE_SNAPSHOT_REFRESH_RETRY_DELAYS_MS,
  retryLiveSnapshotRefresh
} from "../root-site/data/live-snapshot-retry.js";

let builds = 0;
const delays = [];
const retries = [];
const refreshed = await retryLiveSnapshotRefresh(async () => {
  builds += 1;
  if (builds === 1) throw new Error("invoices: Timed out acquiring connection from connection pool");
  return { customers: [{ id: "customer-new", name: "New customer" }] };
}, {
  sleep: async (delay) => { delays.push(delay); },
  onRetry: (retry) => { retries.push(retry); }
});

assert.equal(builds, 2, "a transient snapshot-builder failure must be retried");
assert.deepEqual(delays, [250], "the first retry must use bounded backoff without delaying the test");
assert.equal(retries.length, 1);
assert.equal(refreshed.customers.some((customer) => customer.id === "customer-new"), true,
  "the successful retry must expose the newly-created customer to the page payload");

let failedBuilds = 0;
const exhaustedDelays = [];
await assert.rejects(
  retryLiveSnapshotRefresh(async () => {
    failedBuilds += 1;
    throw new Error("pool still busy");
  }, { sleep: async (delay) => { exhaustedDelays.push(delay); } }),
  /pool still busy/
);
assert.equal(failedBuilds, LIVE_SNAPSHOT_REFRESH_RETRY_DELAYS_MS.length + 1,
  "refresh retry must stop after the configured finite attempt count");
assert.deepEqual(exhaustedDelays, [...LIVE_SNAPSHOT_REFRESH_RETRY_DELAYS_MS]);

const snapshotsSource = await readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8");
assert.match(snapshotsSource, /retryLiveSnapshotRefresh\(/,
  "background snapshot refresh must use the bounded retry helper");
assert.match(snapshotsSource, /LIVE_REFRESH_PENDING\.add\(snapshot\)/,
  "an exhausted refresh must stay marked pending instead of failing silently");
assert.match(snapshotsSource, /LIVE_REFRESH_PENDING\.has\(snapshot\)[^\n]*LIVE_BUILDERS\.delete\(snapshot\)/,
  "the next page read must re-enter the loader for a pending refresh");
assert.match(snapshotsSource, /LIVE_REFRESH_PENDING\.add\(snapshot\);\s*LIVE_BUILDERS\.delete\(snapshot\);\s*invalidateProviderSnapshotMemo\(snapshot\)/,
  "an exhausted refresh must drop both stale memo layers so the next page or event can retry");

console.log("live-snapshot-retry-1 contracts: PASS (retry success, bounded exhaustion, pending retrigger)");
