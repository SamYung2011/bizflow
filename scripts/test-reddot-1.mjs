import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 件5 of 2026-08-04 煊煊拍板批次 (REDDOT-SURVEY 异常 #1 与 #6). Two independent fixes to the
// tp-read-state-v1 unread/red-dot system:
//  a) data/read-state.js getReadState() memory-cache bug (REDDOT-SURVEY 异常 #1)
//  b) 團隊成員頁「更新日誌」tab hardcoded update:false (REDDOT-SURVEY 异常 #6)

// ---------- Part A: real execution against a shimmed window/localStorage ----------
// Mirrors the globalThis.window/document save-restore pattern already used by
// scripts/test-shell-menus.mjs — read-state.js only touches window/document inside function
// bodies (not at module-load time), so shimming before first call is sufficient.

class FakeStorage {
  constructor() {
    this.store = new Map();
    this.removeItemCalls = 0;
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.removeItemCalls += 1;
    this.store.delete(key);
  }
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const fakeStorage = new FakeStorage();
globalThis.window = { localStorage: fakeStorage, dispatchEvent: () => true };
globalThis.document = { prerendering: false };

const {
  getReadState, markRead, READ_STATE_STORAGE_KEY,
  setReadStateAccount, getReadStateAccount, getActiveReadStateStorageKey
} = await import("../root-site/data/read-state.js");

try {
  // Scenario 0 (件1, 2026-08-04 批4「红点是跟登录账号走的」煊煊拍板): before any account is known
  // (module-fresh / pre-login / identity not resolved yet) read-state must not read, not write,
  // not light up. getReadState() is always {}; markRead() is a silent no-op — no storage write,
  // and critically no tp:unread-change dispatch (dispatching would make shell.js's same-tab fast
  // path believe something was actually marked read when nothing was persisted at all).
  assert.equal(getReadStateAccount(), null, "no account set yet");
  assert.equal(getActiveReadStateStorageKey(), null, "no active account: there is no storage key to speak of");
  assert.deepEqual(getReadState(), {}, "no active account: getReadState must be empty, not throw or fall back to a shared/global key");
  let noAccountDispatched = false;
  const originalDispatchEventNoAccount = window.dispatchEvent;
  window.dispatchEvent = () => { noAccountDispatched = true; return true; };
  markRead("orders", "2026-08-01T00:00:00.000Z");
  window.dispatchEvent = originalDispatchEventNoAccount;
  assert.equal(noAccountDispatched, false, "markRead with no active account must not dispatch tp:unread-change — nothing was actually marked read");
  assert.equal(fakeStorage.store.size, 0, "markRead with no active account must not write anything to storage, not even under a guessed/default key");

  setReadStateAccount("acct-orders-tester");
  assert.equal(getReadStateAccount(), "acct-orders-tester");
  const scopedKey = getActiveReadStateStorageKey();
  assert.equal(scopedKey, "tp-read-state-v1:acct:acct-orders-tester",
    "the physical localStorage key must carry the account id as a suffix of the base key, not just an internal field");

  // Scenario 1 (REDDOT-SURVEY 异常 #1 repro steps 1-6): a category this tab has already marked
  // read must correctly reset to absent once localStorage is cleared externally (another tab,
  // a "reset demo" action, or any script calling removeItem directly) — WITHOUT a page reload.
  markRead("orders", "2026-08-03T16:00:00.000Z");
  assert.deepEqual(getReadState(), { orders: "2026-08-03T16:00:00.000Z" });
  window.localStorage.removeItem(scopedKey); // simulates an external/cross-tab clear, bypassing markRead
  assert.deepEqual(getReadState(), {},
    "an externally cleared localStorage must reset the in-memory cache immediately — this is the exact repro from REDDOT-SURVEY 异常 #1 (previously the stale memoryState leaked through because `if (stored !== null)` skipped the refresh when stored was null)");

  // Scenario 2: every previously-marked key must drop, not just the most recent one.
  markRead("tasks", "2026-08-01T00:00:00.000Z");
  markRead("inventory", "fingerprint-a|fingerprint-b");
  assert.deepEqual(getReadState(), { tasks: "2026-08-01T00:00:00.000Z", inventory: "fingerprint-a|fingerprint-b" });
  window.localStorage.removeItem(scopedKey);
  assert.deepEqual(getReadState(), {}, "clearing must drop every previously-marked key from memory, not just the last one written");

  // Scenario 3: corrupt stored JSON must not throw, and must fall back to the last known-good
  // in-memory state (the fix only changes the stored===null path; JSON.parse throwing on a
  // non-null-but-corrupt value still aborts the assignment before memoryState is touched).
  markRead("messages", "2026-08-02T00:00:00.000Z");
  window.localStorage.setItem(scopedKey, "{not valid json");
  assert.doesNotThrow(() => getReadState());
  assert.deepEqual(getReadState(), { messages: "2026-08-02T00:00:00.000Z" },
    "a corrupt stored value must fall back to the last good in-memory state, not crash or silently reset to {}");

  // Scenario 4 (件5b): "updates" is now a valid READ_KEY, and the allowlist still strips unknown
  // keys / wrong-typed values out of whatever raw JSON is sitting in storage — markRead's own
  // gate only protects the normal write path, normalizeState is what protects raw storage reads.
  window.localStorage.setItem(scopedKey, JSON.stringify({
    updates: "2026-08-04T00:00:00.000Z",
    tasks: "2026-08-01T00:00:00.000Z",
    "not-a-real-key": "x",
    inventory: 12345 // wrong type (must be a string watermark) — must still be dropped
  }));
  assert.deepEqual(getReadState(), { updates: "2026-08-04T00:00:00.000Z", tasks: "2026-08-01T00:00:00.000Z" },
    "normalizeState must keep only known READ_KEYS with string watermarks — \"updates\" is now allowed in, unknown keys and wrong-typed values are still dropped");
  const beforeBogusMarkRead = getReadState();
  markRead("not-a-real-key", "y");
  assert.deepEqual(getReadState(), beforeBogusMarkRead, "markRead must silently no-op for a key outside READ_KEYS");

  // markRead must still dispatch tp:unread-change with detail.key — shell.js's
  // refreshUnreadIndicators same-tab fast path (`unread = {...unread, [key]: 0}`) depends on it.
  let capturedEvent = null;
  const originalDispatchEvent = window.dispatchEvent;
  window.dispatchEvent = (event) => {
    capturedEvent = event;
    return true;
  };
  markRead("orders", "2026-08-04T09:00:00.000Z");
  assert.equal(capturedEvent?.type, "tp:unread-change");
  assert.equal(capturedEvent?.detail?.key, "orders");
  assert.equal(capturedEvent?.detail?.watermark, "2026-08-04T09:00:00.000Z");
  window.dispatchEvent = originalDispatchEvent;

  // Scenario 5 (件1 新增,验收要求「账号隔离: 两个不同 uid 的 store 互不影响」): switching the
  // active account must be a hard boundary — no bleed either direction.
  setReadStateAccount("acct-a");
  markRead("orders", "2026-08-04T09:00:00.000Z");
  assert.deepEqual(getReadState(), { orders: "2026-08-04T09:00:00.000Z" });
  setReadStateAccount("acct-b");
  assert.deepEqual(getReadState(), {},
    "switching to a different, never-before-seen account must not see account A's watermarks — this is the cold-start-per-account design, not a migration");
  markRead("tasks", "2026-08-04T10:00:00.000Z");
  assert.deepEqual(getReadState(), { tasks: "2026-08-04T10:00:00.000Z" });
  setReadStateAccount("acct-a");
  assert.deepEqual(getReadState(), { orders: "2026-08-04T09:00:00.000Z" },
    "switching back to account A: its own watermark survived account B's writes untouched, and account B's \"tasks\" watermark must not leak in");

  // Scenario 6 (件1 新增): read path must ignore the old flat global key entirely (never fall back
  // to it, not even for a brand-new account), and the first successful write under the new
  // account-scoped key purges the old global key exactly once — not on every subsequent markRead.
  fakeStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify({ orders: "stale-pre-migration-global-value" }));
  setReadStateAccount("acct-legacy-purge-tester");
  assert.deepEqual(getReadState(), {},
    "读路径遇旧键忽略: a brand-new account must never read the old global key's content, even though it still physically exists in storage");
  assert.notEqual(fakeStorage.getItem(READ_STATE_STORAGE_KEY), null, "the old key is still sitting in storage until this account's first successful write");
  const removeCallsBeforePurge = fakeStorage.removeItemCalls;
  markRead("orders", "2026-08-04T11:00:00.000Z");
  assert.equal(fakeStorage.getItem(READ_STATE_STORAGE_KEY), null, "the first successful write under the account-scoped key purges the old global key");
  assert.equal(fakeStorage.removeItemCalls, removeCallsBeforePurge + 1);
  markRead("tasks", "2026-08-04T12:00:00.000Z");
  markRead("inventory", "fp-only");
  assert.equal(fakeStorage.removeItemCalls, removeCallsBeforePurge + 1,
    "一次性清理: subsequent markRead calls for the same account must not call removeItem again");
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

// ---------- Part B: source-text contracts for the pieces that need real Supabase/DOM plumbing ----------
// computeUnreadState pulls a live snapshot (team_update_logs via Supabase) and members.js's
// renderTab needs a real page mount — both impractical to execute in a bare node script, so
// (matching this repo's established pattern, e.g. test-nr-task-1.mjs G-task-14) these are
// locked down as source contracts instead.

const [providerSource, membersSource, readStateSource, pageUnreadSource] = await Promise.all([
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/members.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/read-state.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/page-unread.js", import.meta.url), "utf8")
]);

assert.match(readStateSource, /new Set\(\["tasks", "orders", "messages", "inventory", "updates"\]\)/,
  "READ_KEYS must add \"updates\" alongside the existing four categories");

const computeUnreadStateBlock = providerSource.slice(
  providerSource.indexOf("async function computeUnreadState"),
  providerSource.indexOf("export async function getCurrentUser")
);
assert.match(computeUnreadStateBlock, /loadTeamUpdateLogsSnapshot\(\)/,
  "computeUnreadState must load the update-logs snapshot alongside the other four unread sources");
assert.match(computeUnreadStateBlock, /read\.updates/,
  "the updates count must be computed against the persisted \"updates\" watermark, same as the other four");
assert.match(computeUnreadStateBlock, /updates: updates\.count/,
  "unread.updates must be threaded through computeUnreadState's return value");
assert.match(computeUnreadStateBlock, /updates: updates\.watermark/,
  "watermarks.updates must be threaded through alongside the other four, so markRead(\"updates\", ...) has a real value to persist");
assert.match(providerSource, /unread: \{ tasks: 4, orders: 2, inventory: 1, messages: 3, updates: 1 \}/,
  "mock.unread's total-fallback shape must include updates for shape parity with the real computeUnreadState result");

const renderTabBlock = membersSource.slice(
  membersSource.indexOf("function renderTab("),
  membersSource.indexOf("function renderMemberCard(")
);
assert.match(renderTabBlock, /tab\.key === "updates"/,
  "renderTab must special-case the updates tab the same way it already special-cases reviews");
assert.match(renderTabBlock, /unread\?\.updates \?\? 0\) > 0/,
  "the updates tab badge must be driven by the real unread.updates signal (computeUnreadState), not the hardcoded provider.js tab.update:false");
assert.match(membersSource, /import \{ markRead \} from "\.\.\/data\/read-state\.js";/,
  "members.js must import markRead to close the loop (light up -> visit -> mark read)");
assert.match(membersSource, /import \{ cachedPageUnread, loadPageUnread \} from "\.\.\/data\/page-unread\.js"/,
  "members.js must render cached unread state and refresh it after first paint");
assert.match(pageUnreadSource, /import \{ getUnread, getUnreadWatermarks \} from "\.\/provider\.js"/,
  "the shared page-unread refresh must fetch the real watermark alongside unread counts");
assert.match(membersSource, /unreadWatermarks = next\.watermarks/,
  "members.js must apply the asynchronously refreshed watermark before marking updates read");
assert.match(membersSource, /function markUpdatesTabRead\(\)/);
assert.match(membersSource, /if \(nextTab === "updates"\) markUpdatesTabRead\(\);/,
  "switching into the updates tab by clicking it must mark it read");
assert.match(membersSource, /if \(state\.activeTab === "updates"\) markUpdatesTabRead\(\);/,
  "landing directly on the updates tab on mount (the default for canWriteUpdates-only/task-app-only accounts, per buildMemberAccess's visibleTabKeys) must also mark it read — the tab-click branch alone would never fire for them");

// 件1 (2026-08-04 批4「红点是跟登录账号走的」) source contracts: the identity-resolution wiring that
// makes read-state.js's account scoping actually take effect needs a real Supabase session +
// module-load-time auth.js/read-state.js coupling this bare node script can't spin up end-to-end
// (same category as computeUnreadState/renderTab above) — locked down at the source level instead.
assert.match(readStateSource, /export function setReadStateAccount\(accountId\)/,
  "read-state.js must expose a setter so the identity source (auth.js, via provider.js) can push the resolved account in — the storage module itself must stay network/DOM-identity-free and testable in isolation");
assert.match(readStateSource, /export function getActiveReadStateStorageKey\(\)/,
  "a getter for the current full storage key must exist so shell.js's cross-tab listener can match on it fresh each time, not a constant captured at import time");
assert.match(readStateSource, /READ_STATE_STORAGE_KEY\}:acct:\$\{accountId\}/,
  "the physical storage key must be the base key plus an account-id suffix, not just an internal scope field");

const syncReadStateAccountBlock = providerSource.slice(
  providerSource.indexOf("async function syncReadStateAccount"),
  providerSource.indexOf("let unreadStateMemoKey"));
assert.match(syncReadStateAccountBlock, /getSession\(\)/);
assert.match(syncReadStateAccountBlock, /getAuthCurrentUser\(\)/,
  "the account id must come from auth.js's real getCurrentUser (the actual logged-in identity), not this file's own getCurrentUser() demo/static fallback below — a demo visit with no session must resolve to no account, not a shared pseudo-identity");
assert.match(syncReadStateAccountBlock, /setReadStateAccount\(account\?\.id \|\| null\)/);
assert.match(syncReadStateAccountBlock, /catch \{[\s\S]*?setReadStateAccount\(null\)/,
  "an auth resolution hiccup must degrade to \"no account\" (不读不写不亮), not throw through getUnread()/getUnreadWatermarks() and break page mounts that don't expect this new dependency");
const buildUnreadStateBlock = providerSource.slice(
  providerSource.indexOf("async function buildUnreadState"),
  providerSource.indexOf("async function computeUnreadState"));
assert.match(buildUnreadStateBlock, /await syncReadStateAccount\(\);\s*\n\s*const read = getReadState\(\);/,
  "buildUnreadState must resolve the account before reading read-state — self-contained ordering, not dependent on the caller happening to await getCurrentUser() in the same Promise.all first");

const shellSource = await readFile(new URL("../root-site/shell/shell.js", import.meta.url), "utf8");
assert.match(shellSource, /import \{ getActiveReadStateStorageKey \} from "\.\.\/data\/read-state\.js";/,
  "shell.js must switch from importing the old fixed READ_STATE_STORAGE_KEY constant to the live per-account getter");
assert.match(shellSource, /if \(!event\.key \|\| event\.key !== getActiveReadStateStorageKey\(\)\) return;/,
  "the cross-tab storage listener must match the current tab's own account-scoped key exactly (freshly, per event) — a stale imported constant or a loose prefix match could react to a different account's tab");
assert.doesNotMatch(shellSource, /READ_STATE_STORAGE_KEY/,
  "the old unscoped constant must be fully gone from shell.js, not left as dead/unused code alongside the new getter");

console.log("REDDOT-1 contracts: PASS (read-state external-clear reset, corrupt-JSON fallback, updates READ_KEY, updates tab real unread wiring, per-account storage isolation, legacy-key one-shot purge, auth-sourced account identity wiring)");
