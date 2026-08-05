import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import {
  isTaskMentionOnlyForMember,
  taskReadFingerprintRootId
} from "../root-site/team/tasks-model.js";

// 件A contracts (batch3, 2026-08-05, 煊煊拍板逐字: "选A吧？感觉可以多一条分界线，文案是：'仅提及'。
// 如果看过的就像已完成一样收起，没看过的就显示。"): mention-only tasks (visible ONLY because of an
// @, neither assignee nor creator) collapse behind a 僅提及 divider once seen per the existing
// tp-task-board-read-v1 fingerprint state; unseen ones stay in the normal list. Same divider
// component/state pattern as 895148a's 已完成 divider; red-dot counting semantics untouched.

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };

function mentionFeedback(id, mentionedUserIds) {
  return {
    id,
    author: "Other",
    authorUserId: "user-other",
    timestamp: "2026/08/05 09:00",
    message: "@Helen please check",
    mentionedUserIds,
    attachments: [],
    attachmentCount: 0
  };
}

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    content: "Details",
    owner: helen.name,
    members: [helen.name],
    priority: "medium",
    status: "inProgress",
    done: false,
    due: "2026/08/20",
    startDate: "",
    createdAt: "2026/08/01 12:00",
    completedAt: "",
    creator: "Other",
    creatorId: "employee-other",
    parentId: null,
    departmentId: "",
    visibility: "team",
    visibilityDepartment: "",
    requiresReview: false,
    approvedAt: "",
    approvedBy: "",
    attachments: [],
    attachmentCount: 0,
    countBadge: "",
    assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }],
    feedback: [],
    subtasks: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. Classification: mention-only = @-mentioned AND neither assignee nor creator.
const mentionOnly = task("mention-only", { assignees: [], members: [], feedback: [mentionFeedback("fb-1", [helen.userId])] });
assert.equal(isTaskMentionOnlyForMember(mentionOnly, helen), true);
const mentionedCreator = task("mentioned-creator", {
  creator: helen.name, creatorId: helen.id, assignees: [], members: [],
  feedback: [mentionFeedback("fb-2", [helen.userId])]
});
assert.equal(isTaskMentionOnlyForMember(mentionedCreator, helen), false,
  "the creator is never mention-only — without the @ the task is already in their view");
const mentionedAssignee = task("mentioned-assignee", { feedback: [mentionFeedback("fb-3", [helen.userId])] });
assert.equal(isTaskMentionOnlyForMember(mentionedAssignee, helen), false,
  "an assignee is never mention-only (isTaskMentionedForMember already excludes assignees)");

// 2. Fingerprint key resolution: roots key on themselves; a promoted mention child
//    keys on its root ancestor (the read tracker only fingerprints parentId==null roots,
//    and a child @ changes the root fingerprint through the recursive subtasks rows).
const rootP = task("root-p", { assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }], members: [jack.name], owner: jack.name });
const childC = task("child-c", { parentId: rootP.id, assignees: [], members: [], feedback: [mentionFeedback("fb-4", [helen.userId])] });
rootP.subtasks = [childC];
const byId = new Map([[rootP.id, rootP], [childC.id, childC]]);
assert.equal(taskReadFingerprintRootId(mentionOnly, byId), mentionOnly.id);
assert.equal(taskReadFingerprintRootId(childC, byId), rootP.id);
assert.equal(taskReadFingerprintRootId({ id: "orphan", parentId: "gone" }, byId), "orphan",
  "an unresolvable parent chain falls back to the task's own id (never a wrong ancestor's key)");

// ---------------------------------------------------------------------------
// 3. Board rendering on Helen's member board.
const assignedOpen = task("assigned-open");
const ownedCompleted = task("owned-completed", {
  status: "completed",
  done: true,
  completedAt: "2026/08/04 12:00",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: "2026/08/04 12:00", abandonedAt: null }]
});
function boardState(overrides = {}) {
  return {
    tasks: [assignedOpen, mentionOnly, mentionedCreator, ownedCompleted],
    board: [
      { key: "high", count: 0, tasks: [] },
      { key: "medium", count: 0, tasks: [] },
      { key: "low", count: 0, tasks: [] }
    ],
    members: [helen, jack],
    currentUser: helen,
    onlyMine: false,
    boardExpandedPriorities: new Set(),
    boardExpandedTerminalPriorities: new Set(),
    boardExpandedMentionPriorities: new Set(),
    boardUnreadTaskIds: new Set(),
    actionTaskId: null,
    permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    ...overrides
  };
}
const helenFilter = { status: "inProgress", priority: "all", member: helen.id, view: "board" };

// 3a. SEEN (fingerprint not unread): the mention-only card leaves the list and hides
//     behind a collapsed 僅提及 divider; assignee/creator tasks stay put.
const seenHtml = renderTaskBoardGrid({ state: boardState(), filterState: helenFilter, helpers });
assert.doesNotMatch(seenHtml, /data-task-card="mention-only"/,
  "collapsed by default: a seen mention-only card is not in the markup until the divider is expanded (same contract as 已完成)");
assert.match(seenHtml, /data-task-card="assigned-open"/, "an assigned task never collapses under 僅提及");
assert.match(seenHtml, /data-task-card="mentioned-creator"/, "a creator task never collapses under 僅提及 even when @-ed");
assert.match(seenHtml, /data-task-column-mention-toggle="medium"(?![^>]*disabled)/);
assert.match(seenHtml, />僅提及 1</, "the divider label is the 拍板 wording plus its own count");
assert.match(seenHtml, /data-task-column="medium" data-column-count="2"/,
  "the column count follows the outside list (assigned-open + mentioned-creator) — collapsed mention tasks don't count, like 已完成");
// Order: the 僅提及 divider (still-active tasks) sits above the terminal divider.
const mentionIndex = seenHtml.indexOf('data-task-column-mention-toggle="medium"');
const terminalIndex = seenHtml.indexOf('data-task-column-terminal-toggle="medium"');
assert.ok(mentionIndex > -1 && terminalIndex > -1 && mentionIndex < terminalIndex,
  "both dividers coexist in one column, 僅提及 above 已完成/已放棄");

// 3b. Expanding reveals the card (with its untouched TP-at-2 「@ 提到」pill).
const expandedHtml = renderTaskBoardGrid({
  state: boardState({ boardExpandedMentionPriorities: new Set(["medium"]) }),
  filterState: helenFilter,
  helpers
});
assert.match(expandedHtml, /data-task-column-mention-toggle="medium" aria-expanded="true"/);
assert.match(expandedHtml, /team-column-terminal-divider--open[^>]*data-task-column-mention-toggle="medium"/,
  "the mention divider reuses the 895148a divider component and its open-state class");
assert.match(expandedHtml, /data-task-card="mention-only"/);
assert.match(expandedHtml, /data-task-card="mention-only"[\s\S]*?task-mention-pill/,
  "the revealed card keeps the 「@ 提到」pill (TP-at-2 untouched)");

// 3c. UNSEEN (root fingerprint still in boardUnreadTaskIds): stays in the normal list,
//     and with nothing collapsed the divider does not render at all.
const unseenHtml = renderTaskBoardGrid({
  state: boardState({ boardUnreadTaskIds: new Set([mentionOnly.id]) }),
  filterState: helenFilter,
  helpers
});
assert.match(unseenHtml, /data-task-card="mention-only"/, "an unseen @ shows in the open list");
assert.doesNotMatch(unseenHtml, /data-task-column-mention-toggle/,
  "no collapsed content, no divider (matches the terminal divider's render-nothing contract)");
assert.match(unseenHtml, /data-task-column="medium" data-column-count="3"/);

// 3d. A promoted mention CHILD keys its seen-state on the root ancestor's fingerprint.
const childState = boardState({ tasks: [assignedOpen, rootP, childC] });
const childSeenHtml = renderTaskBoardGrid({ state: childState, filterState: helenFilter, helpers });
assert.doesNotMatch(childSeenHtml, /data-task-card="child-c"/, "root fingerprint seen -> promoted child collapses");
assert.match(childSeenHtml, />僅提及 1</);
const childUnseenHtml = renderTaskBoardGrid({
  state: boardState({ tasks: [assignedOpen, rootP, childC], boardUnreadTaskIds: new Set([rootP.id]) }),
  filterState: helenFilter,
  helpers
});
assert.match(childUnseenHtml, /data-task-card="child-c"/,
  "root fingerprint unread -> the promoted mention child stays visible in the list");

// 3e. Same path covers the Honnmono-all / 任務總覽 board: member=all uses the current
//     user as the mention lens, so their seen @s collapse there too.
const allSeenHtml = renderTaskBoardGrid({
  state: boardState(),
  filterState: { ...helenFilter, member: "all" },
  helpers
});
assert.doesNotMatch(allSeenHtml, /data-task-card="mention-only"/);
assert.match(allSeenHtml, /data-task-column-mention-toggle="medium"/);

// 3f. Only under the 進行中 status filter — like the terminal divider, other status
//     views already show what they show and get no extra collapse layer.
const completedMentionOnly = task("completed-mention-only", {
  status: "completed", done: true, completedAt: "2026/08/04 12:00",
  assignees: [], members: [], feedback: [mentionFeedback("fb-5", [helen.userId])]
});
const completedFilterHtml = renderTaskBoardGrid({
  state: boardState({ tasks: [completedMentionOnly] }),
  filterState: { ...helenFilter, status: "completed" },
  helpers
});
assert.match(completedFilterHtml, /data-task-card="completed-mention-only"/);
assert.doesNotMatch(completedFilterHtml, /data-task-column-mention-toggle/);

// ---------------------------------------------------------------------------
// 4. i18n: zh-Hant wording is 煊煊's 拍板 text; en/fr present, no hardcoded strings.
assert.equal(taskDictionaries.zh["tasks.column.mentionSummary"], "僅提及 {count}");
for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["tasks.column.mentionSummary", "tasks.column.mentionExpand", "tasks.column.mentionCollapse"]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}

// ---------------------------------------------------------------------------
// 5. Source contracts for the stateful wiring node scripts can't click through.
const [tasksSource, boardSource, controllerSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-board.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8")
]);
// Divider open/close state: same lifecycle as the terminal Set — restored from history,
// captured into history (both capture sites), toggled by its own click branch, cleared
// on filter changes and on member switches.
assert.match(tasksSource, /boardExpandedMentionPriorities: new Set\(Array\.isArray\(restored\.boardExpandedMentionPriorities\)/,
  "createTaskState must restore the mention-divider Set like the terminal one");
assert.equal((tasksSource.match(/boardExpandedMentionPriorities: \[\.\.\.state\.boardExpandedMentionPriorities\]/g) ?? []).length, 2,
  "both view-state captures (currentTaskViewState + captureState) must persist the Set");
assert.match(tasksSource, /closest\("\[data-task-column-mention-toggle\]"\)/,
  "the board click handler must own a mention-divider toggle branch");
assert.match(tasksSource, /state\.boardExpandedPriorities\.clear\(\);\s*\n\s*state\.boardExpandedTerminalPriorities\.clear\(\);\s*\n\s*state\.boardExpandedMentionPriorities\.clear\(\);/,
  "filter changes must reset the mention Set together with the two existing ones");
assert.match(controllerSource, /state\.boardExpandedTerminalPriorities\.clear\(\);\s*\n\s*state\.boardExpandedMentionPriorities\.clear\(\);/,
  "switching member boards must reset it too (tasks-domain-controller memberTrigger)");
// Seen source: opening a task's detail marks its ROOT fingerprint seen through the
// existing tracker (規格「没看过的 = 被 @ 之后未打开过详情」), no parallel read-state store.
const detailOpenBlock = tasksSource.slice(
  tasksSource.indexOf("const detailTrigger = event.target.closest(\"[data-task-detail-open]\")"),
  tasksSource.indexOf("if (event.target.closest(\"[data-task-detail-close]\"))")
);
assert.match(detailOpenBlock, /taskReadFingerprintRootId\(selectedTask\(\)/,
  "detail-open must resolve the read-state key through the shared root resolver (children roll up to their root)");
assert.match(detailOpenBlock, /taskBoardReadTracker\?\.markSeen\(\[openedRootId\]\)/,
  "detail-open must mark seen through the existing tp-task-board-read-v1 tracker, not a second store");
// The bucket reads boardUnreadTaskIds; it must never write it (red-dot semantics stay put).
assert.match(boardSource, /isTaskMentionOnlyForMember\(task, mentionMember\) &&\s*\n\s*!\(state\.boardUnreadTaskIds\?\.has\(taskReadFingerprintRootId\(task, taskById\)\) === true\)/,
  "the seen split must key on the same unread Set the column badge reads");
assert.doesNotMatch(boardSource, /boardUnreadTaskIds\.(add|delete|clear)/,
  "tasks-board.js must not mutate the unread Set — counting and clearing stay with the tracker/observer");

console.log("task-mention-divider-1 contracts: PASS (mention-only classification, root fingerprint key, seen collapse + count, expand + @ pill, unseen passthrough, child promotion, all-board lens, inProgress gate, i18n zh/en/fr, state lifecycle + detail-open markSeen wiring)");
