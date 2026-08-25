import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  appendRemainingPages,
  filterNeedsAllRows,
  filteredPaginationTotal,
  paginateWithTotal,
} from "../root-site/bizflow/ocpp-model.js";

const [reader, edge, monitor, charging, finance, users] = await Promise.all([
  readFile(new URL("../root-site/data/live-ocpp.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/ocpp-admin/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/ocpp-monitor.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/ocpp-charging.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/ocpp-finance.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/ocpp-users.js", import.meta.url), "utf8"),
]);

for (const path of [
  "/summary/monitor",
  "/summary/charging",
  "/summary/finance",
  "/ocpp/logs/recent",
]) {
  assert.ok(reader.includes(path), `reader allowlist missing ${path}`);
  assert.ok(edge.includes(`pathname === "${path}"`), `Edge allowlist missing ${path}`);
}

assert.doesNotMatch(reader, /LOG_DAYS|LOG_CONCURRENCY|fetchLogWindow|fetchAllRows/,
  "initial OCPP readers must not scan days or drain paged collections");
assert.match(reader, /loadMonitor[\s\S]*callOcppAdmin\("\/summary\/monitor"/);
assert.match(reader, /loadCharging[\s\S]*callOcppAdmin\("\/summary\/charging"/);
assert.match(reader, /loadFinance[\s\S]*callOcppAdmin\("\/summary\/finance"/);
assert.match(reader, /loadRecentLogs[\s\S]*\/ocpp\/logs\/recent\?limit=/);
assert.match(reader, /loadUsers[\s\S]*Promise\.all\([\s\S]*\/charge-users[\s\S]*\/charge-user-tags/);

const cacheRead = reader.indexOf("readLiveSnapshotCache({ userId: context.userId, snapshot })");
const backgroundRefresh = reader.indexOf("void refreshPersistentSnapshot(snapshot, context, loader)");
assert.ok(cacheRead >= 0 && backgroundRefresh > cacheRead,
  "SWR must read the persistent snapshot before starting its background refresh");
assert.match(reader, /writeLiveSnapshotCache\([\s\S]*dispatchSnapshot\(snapshot, value\)/,
  "a successful background refresh must persist and notify the mounted page");

assert.match(monitor, /getLiveOcppPileLogsPage/,
  "an exact pile selection must use the existing pile history endpoint");
assert.match(monitor, /OCPP_CACHE_SNAPSHOTS\.logs/);
assert.match(charging, /getLiveOcppOrdersPage/);
assert.match(finance, /getLiveOcppFinancePage/);
assert.match(users, /getLiveOcppUsersPage/);
for (const page of [monitor, charging, finance, users]) {
  assert.match(page, /LIVE_SNAPSHOT_UPDATED_EVENT/,
    "every OCPP page must repaint when its SWR refresh completes");
}

function sourceSection(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

assert.equal(filterNeedsAllRows({ loaded: 200, total: 904, active: true }), true,
  "an active filter over a partial first page must preload the remaining rows");
assert.equal(filterNeedsAllRows({ loaded: 200, total: 904, active: false }), false,
  "an untouched first screen must keep its one-request contract");
assert.match(sourceSection(charging, "function onChargingInput", "function onChargingChange"), /refreshOrderFilters/);
assert.match(sourceSection(finance, "function onFinanceInput", "function onFinanceChange"), /refreshFinanceFilters/);
assert.match(sourceSection(users, "function onUsersInput", "function onUsersChange"), /refreshUserFilters/);

const remainingRows = Array.from({ length: 200 }, (_, id) => ({ id }));
const requestedOffsets = [];
const completedTotal = await appendRemainingPages({
  rows: remainingRows,
  total: 500,
  fetchPage: async (offset) => {
    requestedOffsets.push(offset);
    const count = offset === 200 ? 200 : 100;
    return {
      rows: Array.from({ length: count }, (_, index) => ({ id: offset + index })),
      page: { total: 500, hasMore: offset === 200 },
    };
  },
});
assert.deepEqual(requestedOffsets, [200, 400], "filter preload must request every remaining page in order");
assert.equal(remainingRows.length, 500);
assert.equal(completedTotal, 500);
assert.equal(remainingRows.some((row) => row.id === 499), true, "a match on a later page must become searchable");

const filteredTotal = filteredPaginationTotal({ loaded: 904, total: 904, filtered: 3, active: true });
const filteredPage = paginateWithTotal([{ id: 1 }, { id: 2 }, { id: 3 }], 1, filteredTotal);
assert.equal(filteredTotal, 3, "a fully loaded filtered table must use its match count");
assert.equal(filteredPage.pages, 1, "three filtered rows must not retain the full table page count");

const paged = paginateWithTotal(Array.from({ length: 200 }, (_, id) => ({ id })), 12, 904);
assert.equal(paged.pages, 51);
assert.equal(paged.total, 904);
assert.equal(paged.rows.length, 2);
assert.equal(paged.page, 12);

assert.ok(edge.indexOf("const guard = await verifyAdmin") < edge.indexOf("const upstreamPath = mapPath(path)"),
  "new routes must remain behind the existing admin guard");

console.log("OCPP speed contracts: PASS (1/1/1/2 initial reads, full-table filters, exact filtered pages, recent logs, lazy pages, IDB SWR, admin guard)");
