import assert from "node:assert/strict";
import { register } from "node:module";

register("./test-support/task-write-auth-loader.mjs", import.meta.url);

const auth = await import("../root-site/data/auth.js");
const {
  AUTH_CONTEXT_TIMEOUT_MS,
  AuthContextTimeoutError
} = await import("../root-site/data/auth-context-timeout.js");
const { writeContext } = await import("../root-site/data/live-task-writes.js");

assert.equal(AUTH_CONTEXT_TIMEOUT_MS, 15_000);
await assert.rejects(
  writeContext({ timeoutMs: 10 }),
  (error) => {
    assert.ok(error instanceof AuthContextTimeoutError);
    assert.equal(error.code, "auth_context_timeout");
    assert.equal(error.label, "getSession");
    return true;
  }
);
assert.equal(auth.__resetCount(), 1,
  "a write-context timeout must clear the current-user memo");

auth.__allowSession();
const context = await writeContext({ timeoutMs: 50 });
assert.equal(context.currentUser.employeeId, "employee-test");
assert.equal(context.currentUser.activeCompanyId, "company-test");

console.log("Task write context timeout: PASS (15s default, hung session rejects, memo resets, retry succeeds)");
