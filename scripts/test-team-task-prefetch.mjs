import assert from "node:assert/strict";
import { register } from "node:module";

register("./test-support/data-phase1-auth-loader.mjs", import.meta.url);
const storage = new Map();
globalThis.window = new EventTarget();
window.localStorage = {
  get length() { return storage.size; },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.document = { prerendering: false };
globalThis.CustomEvent ??= class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
};

const auth = await import("../root-site/data/auth.js");
const query = await import("../root-site/data/live-team-task-query.js");
const readState = await import("../root-site/data/read-state.js");
const cache = await import("../root-site/data/live-table-cache.js");
const RPC = "bizflow_team_task_page";
let passed = 0;
let providerRevision = 0;
const unhandled = [];
process.on("unhandledRejection", (error) => unhandled.push(error));

function payload(companyId = "company-test", employeeId = "employee-test", count = 7) {
  return {
    ...Object.fromEntries(["tasks", "assignees", "feedbacks", "members", "departments", "employeeDepartments",
      "employeeCompanies", "roles", "companies", "taskPending", "companyJoinPending", "updateLogs",
      "updateLogComments"].map((key) => [key, []])),
    currentUser: { employeeId, activeCompanyId: companyId },
    taskStats: { total: 0, completed: 0, open: 0, abandoned: 0 },
    unread: { unread: { tasks: count }, watermarks: { tasks: "2026-09-08T00:00:00Z" } }
  };
}

async function reset({ companyId = "company-test", cached = true, read = {} } = {}) {
  window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
  auth.__reset();
  storage.clear();
  readState.setReadStateAccount(null);
  if (companyId) storage.set("team-active-company-test-user", companyId);
  if (cached) await cache.writeLiveAuthCache({ userId: "test-user", employee: { id: "employee-test" } });
  storage.set("tp-read-state-v1:acct:employee-test", JSON.stringify(read));
  auth.__setRpcData(RPC, payload());
}

async function waitForRpc(count = 1) {
  for (let attempt = 0; attempt < 100 && auth.__calls().length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(auth.__calls().length, count);
}

async function test(name, run) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

await test("remembered company and peekReadState are read-only and account-scoped", async () => {
  await reset({ read: { tasks: "A", invalid: "ignore", orders: 123 } });
  readState.setReadStateAccount("other");
  readState.markRead("tasks", "B");
  const before = [...storage];
  assert.equal(auth.getRememberedActiveCompanyId("test-user"), "company-test");
  assert.equal(auth.getRememberedActiveCompanyId(""), "");
  assert.deepEqual(readState.peekReadState("employee-test"), { tasks: "A" });
  assert.equal(readState.getReadStateAccount(), "other");
  assert.deepEqual(readState.getReadState(), { tasks: "B" });
  assert.deepEqual([...storage], before);
  storage.set("tp-read-state-v1:acct:employee-test", "broken JSON");
  assert.deepEqual(readState.peekReadState("employee-test"), {});
  assert.deepEqual(readState.peekReadState(null), {});
});

await test("in-flight same-key prefetch + duplicate starts + page issue one RPC", async () => {
  await reset();
  auth.__holdNextRpc(RPC);
  const warm = query.prefetchTeamTaskPage();
  const duplicate = query.prefetchTeamTaskPage();
  await waitForRpc();
  assert.equal(readState.getReadStateAccount(), null, "prefetch must not select a read-state identity");
  const page = query.getLiveTeamTaskPage();
  auth.__releaseRpc();
  assert.equal((await page).currentUser.activeCompanyId, "company-test");
  await Promise.all([warm, duplicate]);
  assert.equal(auth.__calls().length, 1);
  assert.ok(query.peekPrefetchedTeamTaskPage(), "bell can claim the same result after the page");
  assert.equal(query.peekPrefetchedTeamTaskPage(), null);
});

await test("already settled same-key prefetch remains reusable once", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  assert.equal(readState.getReadStateAccount(), null, "settled speculation still must not switch identity");
  await query.getLiveTeamTaskPage();
  assert.equal(auth.__calls().length, 1);
  await query.getLiveTeamTaskPage();
  assert.equal(auth.__calls().length, 2, "one-shot prefetch is not a persistent page cache");
});

await test("unknown company with matching server company reuses one RPC", async () => {
  await reset({ companyId: "", cached: false });
  await query.prefetchTeamTaskPage();
  await query.getLiveTeamTaskPage();
  assert.equal(auth.__calls().length, 1);
  assert.equal(auth.__calls()[0].args.p_company_id, null);
  for (const key of ["tasks", "orders", "messages", "inventory", "updates"]) {
    assert.equal(auth.__calls()[0].args[`p_${key}_read`], null);
  }
});

await test("unknown company mismatch returns the second RPC payload", async () => {
  await reset({ companyId: "" });
  auth.__setRpcHandler(RPC, (args) => payload(args.p_company_id || "other-company"));
  await query.prefetchTeamTaskPage();
  assert.equal((await query.getLiveTeamTaskPage()).currentUser.activeCompanyId, "company-test");
  assert.equal(auth.__calls().length, 2);
});

await test("remembered company mismatch starts its own RPC without waiting for prefetch", async () => {
  await reset({ companyId: "other-company" });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  auth.__setRpcHandler(RPC, async (args) => {
    if (args.p_company_id === "other-company") await held;
    return payload(args.p_company_id);
  });
  const warm = query.prefetchTeamTaskPage();
  await waitForRpc();
  assert.equal((await query.getLiveTeamTaskPage()).currentUser.activeCompanyId, "company-test");
  assert.equal(auth.__calls().length, 2);
  release();
  await warm;
});

await test("each of the five read-watermark mismatches prevents reuse", async () => {
  for (const key of ["tasks", "orders", "messages", "inventory", "updates"]) {
    await reset();
    await query.prefetchTeamTaskPage();
    storage.set("tp-read-state-v1:acct:employee-test", JSON.stringify({ [key]: "2026-09-07T00:00:00Z" }));
    await query.getLiveTeamTaskPage();
    assert.equal(auth.__calls().length, 2, key);
  }
});

await test("completed limit and includeDetail mismatches prevent reuse", async () => {
  for (const options of [{ completedLimit: 10 }, { includeDetail: false }]) {
    await reset();
    await query.prefetchTeamTaskPage();
    await query.getLiveTeamTaskPage(options);
    assert.equal(auth.__calls().length, 2);
  }
});

await test("no session or no client is a non-throwing no-op", async () => {
  await reset();
  auth.__setSessionUser(null);
  assert.equal(await query.prefetchTeamTaskPage(), null);
  auth.__setSessionUser("test-user");
  auth.__setClientMissing(true);
  assert.equal(await query.prefetchTeamTaskPage(), null);
  assert.equal(auth.__calls().length, 0);
});

await test("rejected prefetch retries for the page without an unhandled rejection", async () => {
  await reset();
  auth.__setRpcError(RPC, new Error("prefetch failure fixture"));
  assert.equal(await query.prefetchTeamTaskPage(), null);
  await assert.rejects(query.peekPrefetchedTeamTaskPage(), /prefetch failure fixture/);
  auth.__setRpcError(RPC, null);
  assert.equal((await query.getLiveTeamTaskPage()).currentUser.activeCompanyId, "company-test");
  assert.equal(auth.__calls().length, 2);
});

await test("auth reset during setup cannot revive the old prefetch", async () => {
  await reset();
  const warm = query.prefetchTeamTaskPage();
  window.dispatchEvent(new Event(auth.TRANSIENT_AUTH_RESET_EVENT));
  assert.equal(await warm, null);
  assert.equal(query.peekPrefetchedTeamTaskPage(), null);
  assert.equal(auth.__calls().length, 0);
});

await test("account change does not reuse another user's result", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  auth.__setSessionUser("next-user");
  auth.__setCurrentUser({ id: "next-employee" });
  auth.__setRpcData(RPC, payload("company-test", "next-employee"));
  assert.equal((await query.getLiveTeamTaskPage()).currentUser.employeeId, "next-employee");
  assert.equal(auth.__calls().length, 2);
});

await test("bell consumes matching prefetch payload before the page starts", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  const provider = await import(`../root-site/data/provider.js?prefetch-test=${++providerRevision}`);
  assert.equal((await provider.getUnread()).tasks, 7);
  assert.deepEqual(auth.__calls().map((call) => call.name), [RPC]);
});

await test("bell after page activation reuses the result with the advanced tasks watermark", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  await query.getLiveTeamTaskPage();
  const provider = await import(`../root-site/data/provider.js?prefetch-test=${++providerRevision}`);
  assert.equal((await provider.getUnread()).tasks, 7);
  readState.markRead("tasks", "2026-09-08T00:00:00Z");
  assert.equal((await provider.getUnread()).tasks, 0);
  assert.equal((await provider.getUnreadWatermarks()).tasks, "2026-09-08T00:00:00Z");
  assert.deepEqual(auth.__calls().map((call) => call.name), [RPC]);
  assert.equal(query.peekPrefetchedTeamTaskPage(), null);
});

await test("bell rejects both employee and company mismatches without polluted unread memo", async () => {
  for (const data of [payload("other-company"), payload("company-test", "other-employee")]) {
    await reset();
    auth.__setSessionUser(`bell-scope-${providerRevision}`);
    auth.__setRpcData(RPC, data);
    await query.prefetchTeamTaskPage();
    const provider = await import(`../root-site/data/provider.js?prefetch-test=${++providerRevision}`);
    await provider.getUnread();
    assert.deepEqual(auth.__calls().map((call) => call.name), [RPC, "bizflow_unread_summary"]);
  }
});

await test("bell cannot reuse the handoff for a partial read watermark", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  await query.getLiveTeamTaskPage();
  const provider = await import(`../root-site/data/provider.js?prefetch-test=${++providerRevision}`);
  await provider.getUnread();
  readState.markRead("tasks", "2026-09-07T00:00:00Z");
  await provider.getUnread();
  assert.deepEqual(auth.__calls().map((call) => call.name), [RPC, "bizflow_unread_summary"]);
});

await test("company switch rejects the prior bell handoff", async () => {
  await reset();
  await query.prefetchTeamTaskPage();
  await query.getLiveTeamTaskPage();
  const provider = await import(`../root-site/data/provider.js?prefetch-test=${++providerRevision}`);
  await provider.getUnread();
  auth.__setCurrentUser({ activeCompanyId: "new-company" });
  storage.set("tp-read-state-v1:acct:employee-test", JSON.stringify({ tasks: "2026-09-08T00:00:00Z" }));
  await provider.getUnread();
  assert.equal(auth.__calls().at(-1).name, "bizflow_unread_summary");
  assert.equal(auth.__calls().at(-1).args.p_company_id, "new-company");
});

await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(unhandled, []);
assert.equal(passed, 17);
console.log("TEAM_TASK_PREFETCH=17/17 (runtime RPC reuse, retry, scopes, watermarks, bell, reset)");
