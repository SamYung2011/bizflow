import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import {
  calendarRelatedTasks,
  isTaskMentionedForMember,
  isTaskVisibleToMember,
  overviewForMember,
  scopedTopTasks
} from "../root-site/team/tasks-model.js";
import { renderTaskOverview } from "../root-site/team/tasks-overview.js";

globalThis.matchMedia = () => ({ matches: false });

const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };
const baseTask = {
  id: "task-mentioned",
  title: "Need Jack's attention",
  parentId: null,
  creatorId: helen.id,
  creator: helen.name,
  owner: helen.name,
  assignees: [],
  feedback: [{
    id: "feedback-mentioned",
    author: helen.name,
    authorUserId: helen.userId,
    message: "@Jack please review",
    mentionedUserIds: [jack.userId],
    attachments: []
  }],
  attachments: [],
  attachmentCount: 0,
  done: false,
  status: "inProgress",
  priority: "medium",
  due: "2026/08/04",
  visibility: "team",
  visibilityDepartment: "",
  requiresReview: false,
  subtasks: [],
  countBadge: "1"
};

assert.equal(isTaskMentionedForMember(baseTask, jack), true, "a non-assignee target must get the durable mention relation");
assert.equal(isTaskVisibleToMember(baseTask, jack), true, "a mentioned non-assignee must be able to discover the task");
assert.deepEqual(scopedTopTasks([baseTask], { currentUser: jack, member: jack }).map((task) => task.id), [baseTask.id]);
assert.deepEqual(overviewForMember(jack, [baseTask]).open.map(({ task }) => task.id), [baseTask.id]);
assert.deepEqual(overviewForMember(jack, [baseTask]).mentioned.map(({ task }) => task.id), [baseTask.id]);
assert.deepEqual(calendarRelatedTasks([baseTask], { currentUser: jack }).map((task) => task.id), [baseTask.id]);

const assignedMention = {
  ...baseTask,
  id: "task-assigned",
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }]
};
assert.equal(isTaskMentionedForMember(assignedMention, jack), false,
  "an assignee already sees the task through assignment, matching the old UI's non-mention source");
assert.equal(isTaskVisibleToMember(assignedMention, jack), true);

const selfMention = {
  ...baseTask,
  id: "task-self-mention",
  feedback: [{ ...baseTask.feedback[0], author: jack.name, authorUserId: jack.userId }]
};
assert.equal(isTaskMentionedForMember(selfMention, jack), false, "self-authored @ data must not create a marker");
assert.equal(isTaskMentionedForMember(baseTask, { ...jack, userId: "" }), false, "an unbound employee has no auth mention identity");
assert.equal(isTaskMentionedForMember({ ...baseTask, id: "task-other", feedback: [] }, jack), false,
  "unrelated tasks must not inherit mention state");

const visibleParent = {
  ...baseTask,
  id: "task-parent",
  title: "Parent already assigned to Jack",
  feedback: [],
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }],
  subtasks: []
};
const mentionedChild = {
  ...baseTask,
  id: "task-child-mentioned",
  title: "Mention lives on child",
  parentId: visibleParent.id
};
visibleParent.subtasks = [mentionedChild];
const nestedTasks = [visibleParent, mentionedChild];
assert.deepEqual(scopedTopTasks(nestedTasks, { currentUser: jack }).map((task) => task.id),
  [visibleParent.id, mentionedChild.id],
  "the all-members board must promote a mentioned child even when its parent is already visible");
assert.deepEqual(scopedTopTasks(nestedTasks, { currentUser: jack, member: jack }).map((task) => task.id),
  [visibleParent.id, mentionedChild.id],
  "the member-scoped board must not suppress a mentioned child behind a visible parent");
assert.deepEqual(overviewForMember(jack, nestedTasks).mentioned.map(({ task }) => task.id), [mentionedChild.id],
  "overview must expose the exact child that contains the mention");
assert.deepEqual(calendarRelatedTasks(nestedTasks, { currentUser: jack }).map((task) => task.id),
  [visibleParent.id, mentionedChild.id],
  "calendar must preserve an independently clickable mentioned child");
const ordinaryOrphanChild = {
  ...mentionedChild,
  id: "task-child-ordinary-orphan",
  parentId: "task-parent-not-visible",
  feedback: [],
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }]
};
assert.deepEqual(overviewForMember(jack, [...nestedTasks, ordinaryOrphanChild]).open.map(({ task }) => task.id),
  [visibleParent.id, mentionedChild.id],
  "overview must not change its root-only totals for ordinary orphan children");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const boardState = {
  tasks: [baseTask],
  board: [
    { key: "high", count: 0, tasks: [] },
    { key: "medium", count: 1, tasks: [baseTask] },
    { key: "low", count: 0, tasks: [] }
  ],
  members: [helen, jack],
  currentUser: jack,
  onlyMine: false,
  boardExpandedPriorities: new Set(),
  boardUnreadTaskIds: new Set(),
  actionTaskId: null,
  permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false
};
const filterState = { status: "inProgress", priority: "all", member: jack.id, view: "board" };
const boardHtml = renderTaskBoardGrid({ state: boardState, filterState, helpers });
assert.match(boardHtml, /data-task-card="task-mentioned"/);
assert.match(boardHtml, /class="task-mention-pill" data-task-mention="user-jack">@ 提到<\/span>/,
  "the scoped board card must expose the persistent marker for a mentioned non-assignee");

const nestedBoardHtml = renderTaskBoardGrid({
  state: {
    ...boardState,
    tasks: nestedTasks,
    board: boardState.board.map((column) => ({
      ...column,
      count: column.key === "medium" ? 2 : 0,
      tasks: column.key === "medium" ? nestedTasks : []
    }))
  },
  filterState,
  helpers
});
assert.match(nestedBoardHtml, /data-task-card="task-child-mentioned"[\s\S]*?data-task-detail-open="task-child-mentioned"[\s\S]*?data-task-mention="user-jack"/,
  "the promoted child card must be marked and directly openable");

const overviewHtml = renderTaskOverview({
  members: [jack],
  tasks: [baseTask],
  expanded: new Set([jack.id]),
  completedExpanded: new Set(),
  helpers
});
assert.match(overviewHtml, /data-overview-member="employee-jack"[^>]*data-open-count="1"/);
assert.match(overviewHtml, /data-overview-mention-count="1">@ 提到 1<\/span>/);
assert.match(overviewHtml, /data-task-detail-open="task-mentioned"/);
assert.match(overviewHtml, /class="task-mention-pill" data-task-mention="user-jack">@ 提到<\/em>/,
  "the default overview must make a non-assignee mention visible at first glance");

const nestedOverviewHtml = renderTaskOverview({
  members: [jack],
  tasks: nestedTasks,
  expanded: new Set([jack.id]),
  completedExpanded: new Set(),
  helpers
});
assert.match(nestedOverviewHtml, /data-task-detail-open="task-child-mentioned"[\s\S]*?data-task-mention="user-jack"/,
  "the overview must link the exact mentioned child to its feedback detail");

const [tasksSource, boardSource, overviewSource, cssSource, readStateSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-board.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-overview.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/task-board-read-state.js", import.meta.url), "utf8")
]);
assert.match(tasksSource, /state\.detailTab = isTaskMentionedForMember\(selectedTask\(\), state\.currentUser\) \? "feedback" : "content"/,
  "opening a mention task must land the mentioned user on its feedback panel");
assert.match(boardSource, /isTaskMentionedForMember\(task, mentionMember\)/);
assert.match(overviewSource, /isTaskMentionedForMember\(task, member\)/);
assert.match(cssSource, /\.task-mention-pill\s*\{[\s\S]*?--task-mention-color:[\s\S]*?white-space: nowrap/);
assert.match(readStateSource, /stableRows\(entry\?\.mentionedUserIds/,
  "the existing generic unread fingerprint must continue noticing new feedback/mention data");

for (const lang of ["zh", "en", "fr"]) {
  assert.equal(typeof taskDictionaries[lang]["tasks.card.mentioned"], "string", `${lang}.tasks.card.mentioned missing`);
  assert.match(taskDictionaries[lang]["tasks.card.mentioned"], /@/);
}

console.log("TP-at-2 contracts: PASS (non-assignee visibility, persistent marker, self/assigned exclusions, direct feedback, i18n)");
