import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register("./test-support/data-phase1-auth-loader.mjs", import.meta.url);

class MemoryStorage {
  constructor() { this.values = new Map(); }
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
const readState = await import("../root-site/data/read-state.js");
const providerSource = await readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8");
const taskFlow = providerSource.slice(
  providerSource.indexOf("export async function getTeamTaskData"),
  providerSource.indexOf("// team/团队成员屏")
);

assert.doesNotMatch(taskFlow, /getHomeData\(|loadSnapshot\(|homeSnap|home\.currentUser|home\.members|home\.unread/,
  "task data must not load or consume home.json");
assert.match(taskFlow, /loadTeamTaskUnread\(\)/,
  "task data must read unread directly instead of inheriting it from home.json");
assert.match(taskFlow, /normalizeFullTask\(task, authUser\?\.name \?\? "", today\)/,
  "task ownership normalization must use the existing auth current-user result");
assert.match(taskFlow, /const r9Members = isR9MembersSnapshot\(membersSnap\)/);
assert.match(taskFlow, /: teamTaskMock\.members\.map/,
  "an invalid members.json contract must fall back safely without home.json");

auth.__reset();
const [taskData] = await Promise.all([
  provider.getTeamTaskData(),
  provider.getUnread(),
  provider.getUnreadWatermarks()
]);
assert.deepEqual(Object.keys(taskData.unread).sort(), ["inventory", "messages", "orders", "tasks", "updates"]);
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 1,
  "task data plus page unread consumers must share one unread RPC");

window.dispatchEvent(new CustomEvent("tp:live-snapshot-invalidated", {
  detail: { snapshots: ["tasks.json", "members.json", "team-extras.json"] }
}));
await provider.getUnread();
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 1,
  "the initial realtime snapshot catch-up must not repeat an identical unread RPC");

readState.markRead("tasks", "2026-08-31T03:00:00.000Z");
await provider.getUnread();
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 2,
  "a changed read watermark must bypass the memo and refresh unread immediately");

auth.__reset();
auth.__setSessionUser("task-unread-error-user");
auth.__setRpcError("bizflow_unread_summary", { code: "57014", message: "statement timeout" });
const degradedTaskData = await provider.getTeamTaskData();
assert.deepEqual(degradedTaskData.unread, { tasks: 0, orders: 0, inventory: 0, messages: 0, updates: 0 },
  "an unread RPC failure must stay mountable without falling back through home.json");
assert.equal(auth.__calls().filter((call) => call.name === "bizflow_unread_summary").length, 1);

console.log("task-speed-detach-home-0831: PASS (no home task leg, direct unread single-call memo, auth user, members fallback)");
