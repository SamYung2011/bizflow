import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AuthContextTimeoutError,
  withTimeout
} from "../root-site/data/auth-context-timeout.js";
import { taskWriteErrorKey } from "../root-site/team/task-write-error.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import * as auth from "../root-site/data/auth.js";
import { liveAuthCacheVersion, readLiveAuthCache, writeLiveAuthCache } from "../root-site/data/live-table-cache.js";

await assert.rejects(
  withTimeout(new Promise(() => {}), 5, "unit-test"),
  (error) => {
    assert.ok(error instanceof AuthContextTimeoutError);
    assert.equal(error.name, "AuthContextTimeoutError");
    assert.equal(error.code, "auth_context_timeout");
    assert.equal(error.label, "unit-test");
    return true;
  }
);
assert.equal(await withTimeout(Promise.resolve("ok"), 50, "resolved"), "ok");
assert.equal(
  taskWriteErrorKey(new AuthContextTimeoutError("task", 15_000)),
  "tasks.write.authTimeout"
);
assert.equal(taskWriteErrorKey(new Error("write failed")), "tasks.write.failed");
assert.equal(
  taskDictionaries.zh["tasks.write.authTimeout"],
  "登入狀態獲取逾時，請重新整理頁面後再試"
);
assert.equal(
  taskDictionaries.en["tasks.write.authTimeout"],
  "Sign-in state timed out. Please refresh the page and try again."
);
assert.equal(
  taskDictionaries.fr["tasks.write.authTimeout"],
  "Délai d'attente de la session dépassé. Veuillez actualiser la page et réessayer."
);
const tasksSource = await readFile(
  new URL("../root-site/team/tasks.js", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  tasksSource,
  /state\.[A-Za-z]+Error\s*=\s*["']tasks\.write\.failed["']/,
  "every task write catch must route auth timeouts through taskWriteErrorKey"
);
const submitFailureStart = tasksSource.indexOf('console.warn("Task save failed", error)');
const submitFailureRerender = "rerenderTaskPage({ focusBoard: !state.submitOpen, focusSubmit: state.submitOpen });";
const submitFailureEnd = tasksSource.indexOf(submitFailureRerender, submitFailureStart);
assert.ok(submitFailureStart >= 0 && submitFailureEnd > submitFailureStart,
  "task submit failure handler must remain present");
const submitFailureSource = tasksSource.slice(
  submitFailureStart,
  submitFailureEnd + submitFailureRerender.length
);
assert.match(submitFailureSource, /state\.submitError = taskWriteErrorKey\(error\)/);
assert.match(submitFailureSource, /state\.writeBusy = false/,
  "task submit failure must unlock the write button");
assert.match(submitFailureSource, /focusSubmit: state\.submitOpen/,
  "task submit failure must rerender and keep the open modal focused");
assert.doesNotMatch(submitFailureSource, /state\.submitOpen\s*=\s*false|state\.submitDraft\s*=/,
  "task submit failure must not close the modal or replace its draft");

const client = await auth.getSupabaseClient();
assert.ok(client, "the checked-in browser config must create a testable auth client");
const originalGetSession = client.auth.getSession;
const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));
try {
  client.auth.getSession = () => new Promise(() => {});
  await assert.rejects(
    auth.getSession({ timeoutMs: 5 }),
    (error) => error instanceof AuthContextTimeoutError && error.label === "getSession"
  );
  assert.ok(warnings.includes("auth getSession timeout"));

  await assert.rejects(
    auth.getCurrentUser({ refresh: true, timeoutMs: 5 }),
    (error) => error instanceof AuthContextTimeoutError && error.code === "auth_context_timeout"
  );
  client.auth.getSession = async () => ({ data: { session: null }, error: null });
  assert.equal(await auth.getCurrentUser({ timeoutMs: 50 }), null,
    "a timed-out current-user memo must be cleared for the next call");

  client.auth.getSession = async () => {
    throw new Error("session failure");
  };
  await assert.rejects(auth.getCurrentUser({ refresh: true, timeoutMs: 50 }), /session failure/);
  client.auth.getSession = async () => ({ data: { session: null }, error: null });
  assert.equal(await auth.getCurrentUser({ timeoutMs: 50 }), null,
    "a failed current-user memo must be cleared for the next call");
} finally {
  client.auth.getSession = originalGetSession;
  console.warn = originalWarn;
  auth.resetCurrentUserMemory();
}

console.log("Auth context timeout: PASS (typed timeout, session warning, timeout/error memo recovery, task i18n mapping)");

// Drive the vendored SDK's real subscribers, including auth.js's session wiring.
// No remote auth/table calls: these fixtures use only the real local cache.
const storage = new Map();
globalThis.window = new EventTarget();
window.localStorage = {
  get length() { return storage.size; },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.CustomEvent ??= class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Auth cache tests must not use the network"); };
let sessionReads = 0;
client.auth.getSession = async () => { sessionReads += 1; return { data: { session: null }, error: null }; };
const session = { user: { id: "cache-user", email: "cache@example.test" } };
const employee = { id: "cache-employee", user_id: session.user.id, company_id: "cache-company" };
const seed = () => writeLiveAuthCache({ userId: session.user.id, employee });
const emit = (event, value = session) => client.auth._notifyAllSubscribers(event, value, false);
let authCacheTests = 0;
try {
  auth.deriveAuthContext({ session, employee, bindings: [], companies: [], roles: [] });
  assert.equal(storage.get("team-last-user"), session.user.id);
  assert.equal(storage.get("team-employee-cache-user"), employee.id);
  const before = [...storage];
  assert.equal(auth.getRememberedEmployeeId(session.user.id), employee.id);
  assert.equal(auth.getRememberedEmployeeId("other-user"), "");
  assert.equal(auth.getRememberedEmployeeId(""), "");
  assert.deepEqual([...storage], before);
  authCacheTests += 1;

  await seed();
  await auth.getCurrentUser({ refresh: true });
  const readsBefore = sessionReads;
  let version = liveAuthCacheVersion();
  await emit("SIGNED_IN");
  assert.equal(liveAuthCacheVersion(), version, "same user keeps the auth cache version");
  assert.equal((await readLiveAuthCache(session.user.id)).employee.id, employee.id);
  await auth.getCurrentUser();
  assert.equal(sessionReads, readsBefore + 1, "same-user SIGNED_IN still clears the memory memo");
  authCacheTests += 1;

  await emit("SIGNED_IN", { user: { id: "different-user" } });
  assert.notEqual(liveAuthCacheVersion(), version, "different user invalidates the persistent auth cache");
  assert.equal(await readLiveAuthCache(session.user.id), null);
  authCacheTests += 1;

  await seed();
  storage.delete("team-last-user");
  version = liveAuthCacheVersion();
  await emit("SIGNED_IN");
  assert.notEqual(liveAuthCacheVersion(), version, "missing last-user hint keeps the original invalidation");
  assert.equal(await readLiveAuthCache(session.user.id), null);
  authCacheTests += 1;

  await seed();
  let resets = 0;
  window.addEventListener(auth.TRANSIENT_AUTH_RESET_EVENT, () => { resets += 1; });
  version = liveAuthCacheVersion();
  await emit("SIGNED_OUT", null);
  assert.equal(resets, 1);
  assert.equal(liveAuthCacheVersion(), version, "transient SIGNED_OUT keeps its existing cache policy");
  assert.ok(await readLiveAuthCache(session.user.id));
  authCacheTests += 1;

  await emit("USER_UPDATED");
  assert.notEqual(liveAuthCacheVersion(), version);
  assert.equal(await readLiveAuthCache(session.user.id), null);
  authCacheTests += 1;

  await seed();
  version = liveAuthCacheVersion();
  await auth.getCurrentUser({ refresh: true });
  const initialReads = sessionReads;
  await emit("INITIAL_SESSION");
  await auth.getCurrentUser();
  assert.equal(sessionReads, initialReads, "INITIAL_SESSION leaves the memory memo untouched");
  assert.equal(liveAuthCacheVersion(), version);
  assert.ok(await readLiveAuthCache(session.user.id));
  authCacheTests += 1;
} finally {
  client.auth.getSession = originalGetSession;
  globalThis.fetch = originalFetch;
  auth.resetCurrentUserMemory();
  delete globalThis.window;
}
assert.equal(authCacheTests, 7);
console.log("AUTH_CACHE_R1=7/7 (identity hints, same/different user SIGNED_IN, missing hint, SIGNED_OUT, USER_UPDATED, INITIAL_SESSION)");
