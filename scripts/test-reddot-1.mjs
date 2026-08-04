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
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const fakeStorage = new FakeStorage();
globalThis.window = { localStorage: fakeStorage, dispatchEvent: () => true };
globalThis.document = { prerendering: false };

const { getReadState, markRead, READ_STATE_STORAGE_KEY } = await import("../root-site/data/read-state.js");

try {
  // Scenario 1 (REDDOT-SURVEY 异常 #1 repro steps 1-6): a category this tab has already marked
  // read must correctly reset to absent once localStorage is cleared externally (another tab,
  // a "reset demo" action, or any script calling removeItem directly) — WITHOUT a page reload.
  markRead("orders", "2026-08-03T16:00:00.000Z");
  assert.deepEqual(getReadState(), { orders: "2026-08-03T16:00:00.000Z" });
  window.localStorage.removeItem(READ_STATE_STORAGE_KEY); // simulates an external/cross-tab clear, bypassing markRead
  assert.deepEqual(getReadState(), {},
    "an externally cleared localStorage must reset the in-memory cache immediately — this is the exact repro from REDDOT-SURVEY 异常 #1 (previously the stale memoryState leaked through because `if (stored !== null)` skipped the refresh when stored was null)");

  // Scenario 2: every previously-marked key must drop, not just the most recent one.
  markRead("tasks", "2026-08-01T00:00:00.000Z");
  markRead("inventory", "fingerprint-a|fingerprint-b");
  assert.deepEqual(getReadState(), { tasks: "2026-08-01T00:00:00.000Z", inventory: "fingerprint-a|fingerprint-b" });
  window.localStorage.removeItem(READ_STATE_STORAGE_KEY);
  assert.deepEqual(getReadState(), {}, "clearing must drop every previously-marked key from memory, not just the last one written");

  // Scenario 3: corrupt stored JSON must not throw, and must fall back to the last known-good
  // in-memory state (the fix only changes the stored===null path; JSON.parse throwing on a
  // non-null-but-corrupt value still aborts the assignment before memoryState is touched).
  markRead("messages", "2026-08-02T00:00:00.000Z");
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, "{not valid json");
  assert.doesNotThrow(() => getReadState());
  assert.deepEqual(getReadState(), { messages: "2026-08-02T00:00:00.000Z" },
    "a corrupt stored value must fall back to the last good in-memory state, not crash or silently reset to {}");

  // Scenario 4 (件5b): "updates" is now a valid READ_KEY, and the allowlist still strips unknown
  // keys / wrong-typed values out of whatever raw JSON is sitting in storage — markRead's own
  // gate only protects the normal write path, normalizeState is what protects raw storage reads.
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify({
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

const [providerSource, membersSource, readStateSource] = await Promise.all([
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/members.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/read-state.js", import.meta.url), "utf8")
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
assert.match(membersSource, /getTeamMembersData, getCurrentUser, getUnread, getUnreadWatermarks/,
  "members.js must fetch the real watermark alongside the unread counts, mirroring tasks.js's own markRead(\"tasks\", unreadWatermarks.tasks) pattern");
assert.match(membersSource, /function markUpdatesTabRead\(\)/);
assert.match(membersSource, /if \(nextTab === "updates"\) markUpdatesTabRead\(\);/,
  "switching into the updates tab by clicking it must mark it read");
assert.match(membersSource, /if \(state\.activeTab === "updates"\) markUpdatesTabRead\(\);/,
  "landing directly on the updates tab on mount (the default for canWriteUpdates-only/task-app-only accounts, per buildMemberAccess's visibleTabKeys) must also mark it read — the tab-click branch alone would never fire for them");

console.log("REDDOT-1 contracts: PASS (read-state external-clear reset, corrupt-JSON fallback, updates READ_KEY, updates tab real unread wiring)");
