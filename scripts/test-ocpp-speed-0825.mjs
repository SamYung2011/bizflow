import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { paginateWithTotal } from "../root-site/bizflow/ocpp-model.js";

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

const paged = paginateWithTotal(Array.from({ length: 200 }, (_, id) => ({ id })), 12, 904);
assert.equal(paged.pages, 51);
assert.equal(paged.total, 904);
assert.equal(paged.rows.length, 2);
assert.equal(paged.page, 12);

assert.ok(edge.indexOf("const guard = await verifyAdmin") < edge.indexOf("const upstreamPath = mapPath(path)"),
  "new routes must remain behind the existing admin guard");

console.log("OCPP speed contracts: PASS (1/1/1/2 initial reads, recent logs, lazy pages, IDB SWR, admin guard)");
