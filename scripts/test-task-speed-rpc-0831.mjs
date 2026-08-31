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
const { liveSnapshotCacheVersion } = await import("../root-site/data/live-table-cache.js");

const packedPayload = {
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
  currentUser: { employeeId: "employee-test", name: "KC", activeCompanyId: "company-test" },
  permissions: { isBfAdmin: false, canDeleteOthersTasks: false, featureAiBatch: false },
  unread: {
    unread: { tasks: 2, orders: 3, messages: 4, inventory: 5, updates: 6 },
    watermarks: {
      tasks: "2026-08-31T01:00:00.000Z",
      orders: "2026-08-31T01:00:00.000Z",
      messages: "2026-08-31T01:00:00.000Z",
      inventory: "inventory-fingerprint",
      updates: "2026-08-31T01:00:00.000Z"
    }
  },
  generatedAt: "2026-08-31T09:00:00"
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
  p_completed_limit: 10,
  p_include_detail: true
});
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 0,
  "a successful packed response must not issue the legacy unread RPC");
assert.deepEqual(taskData.unread, packedPayload.unread.unread);
assert.deepEqual(unread, packedPayload.unread.unread);
assert.deepEqual(watermarks, packedPayload.unread.watermarks);
assert.deepEqual(taskData.summary, { total: 0, completed: 0, inProgress: 0 },
  "an empty but valid packed tenant must stay mountable instead of using demo data");

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
assert.match(querySource, /writeLiveQueryCache\(/);
assert.match(providerSource, /resolveLiveQueryOrLegacy\(\{[\s\S]*?TEAM_TASK_RPC_ENABLED[\s\S]*?getLegacyTeamTaskData/);
assert.match(snapshotsSource, /export async function buildTeamTaskSnapshotsFromRows/);
assert.match(flagsSource, /export const TEAM_TASK_RPC_ENABLED = true/);
assert.match(cacheSource, /\["tasks\.json", 2\][\s\S]*?\["members\.json", 3\][\s\S]*?\["team-extras\.json", 2\]/);
assert.match(migrationSource, /SECURITY INVOKER/);
assert.doesNotMatch(migrationSource, /\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);

console.log("task-speed-rpc-0831: PASS (single packed trip, unread reuse, legacy fallback, SWR, generation 2/3/2, no policy DDL)");
