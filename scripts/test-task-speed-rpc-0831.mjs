import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register("./test-support/data-phase1-auth-loader.mjs", import.meta.url);

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.window = new EventTarget();
window.localStorage = new MemoryStorage();
globalThis.document = { prerendering: false };
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  };
}

const auth = await import("../root-site/data/auth.js");
const provider = await import("../root-site/data/provider.js");
const { buildTeamTaskSnapshotsFromRows } = await import("../root-site/data/live-snapshots.js");
const { liveSnapshotCacheVersion } = await import("../root-site/data/live-table-cache.js");
const readState = await import("../root-site/data/read-state.js");

const packedPayload = {
  taskStats: { total: 0, completed: 0, open: 0, abandoned: 0 },
  tasks: [],
  assignees: [],
  feedbacks: [],
  members: [],
  departments: [],
  employeeDepartments: [],
  employeeCompanies: [],
  roles: [],
  companies: [],
  taskPending: [],
  companyJoinPending: [],
  updateLogs: [],
  updateLogComments: [],
  unread: {
    unread: { tasks: 2, orders: 3, messages: 4, inventory: 5, updates: 6 },
    watermarks: {
      tasks: "2026-08-31T01:00:00.000Z",
      orders: "2026-08-31T01:00:00.000Z",
      messages: "2026-08-31T01:00:00.000Z",
      inventory: "inventory-fingerprint",
      updates: "2026-08-31T01:00:00.000Z"
    }
  }
};

auth.__reset();
auth.__setSessionUser("task-rpc-user");
auth.__setRpcData("bizflow_team_task_page", packedPayload);
const [taskData, unread, watermarks] = await Promise.all([
  provider.getTeamTaskData(),
  provider.getUnread(),
  provider.getUnreadWatermarks()
]);
const packedCalls = auth.__calls().filter((call) => call.name === "bizflow_team_task_page");
assert.equal(packedCalls.length, 1, "task page and unread consumers must share one packed RPC trip");
assert.deepEqual(packedCalls[0].args, {
  p_company_id: "company-test",
  p_completed_limit: null,
  p_include_detail: true,
  p_tasks_read: null,
  p_orders_read: null,
  p_messages_read: null,
  p_inventory_read: null,
  p_updates_read: null
});
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 0,
  "a successful packed response must not issue the legacy unread RPC");
assert.equal("currentUser" in packedPayload, false);
assert.equal("permissions" in packedPayload, false);
assert.equal("generatedAt" in packedPayload, false,
  "unused optional RPC metadata must not be able to force the task page onto legacy fallback");
assert.deepEqual(taskData.unread, packedPayload.unread.unread);
assert.deepEqual(unread, packedPayload.unread.unread);
assert.deepEqual(watermarks, packedPayload.unread.watermarks);
assert.deepEqual(taskData.summary, { total: 0, completed: 0, inProgress: 0 },
  "an empty but valid packed tenant must stay mountable instead of using demo data");

const limitedCompletedRows = Array.from({ length: 10 }, (_, index) => ({
  id: `done-${index + 1}`,
  company_id: "company-test",
  creator_employee_id: "employee-test",
  employee_id: "employee-test",
  title: `Done ${index + 1}`,
  note: "",
  attachments: [],
  status: "done",
  priority: "low",
  created_at: `2026-08-30T${String(index + 1).padStart(2, "0")}:00:00.000Z`,
  completed_at: `2026-08-31T${String(index + 1).padStart(2, "0")}:00:00.000Z`
}));
const { tasksSnapshot: limitedSnapshot } = await buildTeamTaskSnapshotsFromRows({
  ...packedPayload,
  tasks: limitedCompletedRows,
  taskStats: { total: 14, completed: 12, open: 2, abandoned: 0 }
}, await auth.getCurrentUser());
assert.equal(limitedSnapshot.tasks.length, 10, "a future bounded row feed may contain only ten completed tasks");
assert.deepEqual(limitedSnapshot.taskStats, { total: 14, completed: 12, open: 2, abandoned: 0 },
  "server taskStats must remain full-count even when a future row feed is truncated");

readState.markRead("tasks", "2026-08-31T00:30:00.000Z");
auth.__setRpcHandler("bizflow_team_task_page", (args) => ({
  ...packedPayload,
  unread: {
    ...packedPayload.unread,
    unread: { ...packedPayload.unread.unread, tasks: args.p_tasks_read ? 1 : 2 }
  }
}));
const [, partiallyReadUnread] = await Promise.all([
  provider.getTeamTaskData(),
  provider.getUnread()
]);
const refreshedPackedCalls = auth.__calls().filter((call) => call.name === "bizflow_team_task_page");
assert.equal(refreshedPackedCalls.length, 2, "a second task read must make one fresh packed request");
assert.equal(refreshedPackedCalls.at(-1).args.p_tasks_read, "2026-08-31T00:30:00.000Z");
assert.equal(partiallyReadUnread.tasks, 1,
  "a partial read watermark must use the fresh server count");
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 0,
  "task data and unread must share the in-flight fresh packed request instead of starting a separate unread RPC");

assert.equal(liveSnapshotCacheVersion("tasks.json"), "0:2:0");
assert.equal(liveSnapshotCacheVersion("members.json"), "0:3:0");
assert.equal(liveSnapshotCacheVersion("team-extras.json"), "0:2:0");

auth.__reset();
auth.__setSessionUser("task-rpc-fallback-user");
auth.__setRpcError("bizflow_team_task_page", { code: "PGRST202", message: "function missing" });
const fallback = await provider.getTeamTaskData();
assert.ok(fallback && Array.isArray(fallback.tasks) && Array.isArray(fallback.members),
  "a missing RPC must fall back to the legacy task snapshots with a mountable contract");
assert.deepEqual({ ...fallback, unread: taskData.unread }, taskData,
  "packed raw rows and the legacy builders must produce the same final task-page contract");
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_team_task_page").length, 1);
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 1,
  "the legacy unread RPC must remain available only on fallback");

const [querySource, providerSource, snapshotsSource, flagsSource, cacheSource, migrationSource] = await Promise.all([
  readFile(new URL("../root-site/data/live-team-task-query.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/team-feature-flags.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-table-cache.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/111_bizflow_team_task_page.sql", import.meta.url), "utf8")
]);
assert.match(querySource, /LIVE_TEAM_TASK_MISS/);
assert.match(querySource, /p_tasks_read: live\.read\.tasks \|\| null[\s\S]*?p_updates_read: live\.read\.updates \|\| null/);
assert.match(querySource, /include_detail=false plus lazy detail fetching/);
assert.doesNotMatch(querySource, /from "\.\/live-query-cache\.js"/);
assert.doesNotMatch(querySource,
  /\b(?:readLiveQueryCache|writeLiveQueryCache|markLiveQueryCacheStale|backgroundTeamTaskRefresh|revalidate)\b/,
  "the phase-one packed path must remain fresh-only and never touch live-query-cache/localStorage");
assert.match(providerSource, /resolveLiveQueryOrLegacy\(\{[\s\S]*?TEAM_TASK_RPC_ENABLED[\s\S]*?getLegacyTeamTaskData/);
assert.doesNotMatch(providerSource, /payload\?\.cached|payload\?\.offline|payload\.revalidate/);
assert.match(providerSource, /getLiveTeamTaskPage\(\{ completedLimit: null, includeDetail: true \}\)/);
assert.match(snapshotsSource, /export async function buildTeamTaskSnapshotsFromRows/);
assert.match(snapshotsSource, /const taskStats = rows\?\.taskStats[\s\S]*?taskStats,/);
assert.match(flagsSource, /export const TEAM_TASK_RPC_ENABLED = true/);
assert.match(cacheSource, /\["tasks\.json", 2\][\s\S]*?\["members\.json", 3\][\s\S]*?\["team-extras\.json", 2\]/);
assert.match(migrationSource, /SECURITY INVOKER/);
assert.match(migrationSource, /p_completed_limit integer DEFAULT NULL/);
assert.match(migrationSource, /'taskStats', jsonb_build_object/);
assert.match(migrationSource, /migration 082 must keep public\.is_bf_admin\(\) SECURITY DEFINER[\s\S]*?reverting that helper breaks the entire packed read/);
assert.doesNotMatch(migrationSource, /\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);

console.log("task-speed-rpc-0831: PASS (fresh-only packed path, optional metadata, NULL=all completed, full taskStats, five read watermarks, fallback, generation 2/3/2)");
