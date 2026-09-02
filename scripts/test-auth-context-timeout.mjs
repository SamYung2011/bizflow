import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AuthContextTimeoutError,
  withTimeout
} from "../root-site/data/auth-context-timeout.js";
import { taskWriteErrorKey } from "../root-site/team/task-write-error.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import * as auth from "../root-site/data/auth.js";

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
