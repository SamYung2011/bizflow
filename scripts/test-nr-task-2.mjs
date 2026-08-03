import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import {
  renderTaskFeedbackPanel,
  taskFeedbackPanelEntriesForMember
} from "../root-site/team/tasks-feedback-panel.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };

function feedback(id, timestamp, message, overrides = {}) {
  return {
    id,
    author: "Helen",
    authorUserId: helen.userId,
    timestamp,
    message,
    mentionedUserIds: [],
    attachments: [],
    attachmentCount: 0,
    ...overrides
  };
}

function task(id, overrides = {}) {
  return {
    id,
    title: id,
    parentId: null,
    creatorId: helen.id,
    creator: helen.name,
    owner: jack.name,
    assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }],
    feedback: [],
    attachments: [],
    attachmentCount: 0,
    done: false,
    status: "inProgress",
    priority: "high",
    due: "2026/08/05",
    visibility: "team",
    visibilityDepartment: "",
    requiresReview: false,
    subtasks: [],
    countBadge: "",
    ...overrides
  };
}

const assigned = task("assigned-open", {
  title: "Assigned task",
  feedback: [
    feedback("assigned-1", "2026/08/03 20:00", "First note"),
    feedback("assigned-2", "2026/08/03 21:00", "Second note", { author: "Vincent" }),
    feedback("assigned-3", "2026/08/03 22:00", "Newest assigned note", { author: "Hoey" })
  ]
});
const mentioned = task("mentioned-open", {
  title: "Mentioned task",
  assignees: [],
  priority: "medium",
  feedback: [
    feedback("mention-1", "2026/08/03 23:00", "@Jack please review", { mentionedUserIds: [jack.userId] }),
    feedback("mention-later-unrelated", "2026/08/03 23:30", "Follow-up without a mention")
  ]
});
const completed = task("completed", {
  done: true,
  status: "completed",
  feedback: [feedback("completed-1", "2026/08/03 23:40", "Must stay out")]
});
const abandoned = task("abandoned", {
  status: "abandoned",
  feedback: [feedback("abandoned-1", "2026/08/03 23:41", "Must stay out too")]
});
const memberFinished = task("member-finished", {
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: "2026/08/03 19:00", abandonedAt: null }],
  feedback: [feedback("finished-1", "2026/08/03 23:42", "Member already settled")]
});
const unrelated = task("unrelated", {
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }],
  feedback: [feedback("unrelated-1", "2026/08/03 23:43", "Not Jack's stream")]
});
const tasks = [assigned, mentioned, completed, abandoned, memberFinished, unrelated];

const entries = taskFeedbackPanelEntriesForMember(jack, tasks);
assert.deepEqual(entries.map((entry) => entry.task.id), [mentioned.id, assigned.id]);
assert.equal(entries[0].source, "mention");
assert.equal(entries[0].latestFeedback.id, "mention-1",
  "mention-only entries must summarize the latest feedback that actually mentioned the member");
assert.equal(entries[1].source, "task");
assert.equal(entries[1].latestFeedback.id, "assigned-3");
assert.deepEqual(entries.flatMap((entry) => entry.task.id), [mentioned.id, assigned.id],
  "completed, abandoned, settled-member and unrelated tasks must stay out");

const manyFeedback = task("many-feedback", {
  feedback: Array.from({ length: 7 }, (_, index) => feedback(
    `many-${index + 1}`,
    `2026/08/03 ${String(10 + index).padStart(2, "0")}:00`,
    `Message ${index + 1}`
  ))
});
const [manyEntry] = taskFeedbackPanelEntriesForMember(jack, [manyFeedback]);
assert.equal(manyEntry.feedbackCount, 7);
assert.deepEqual(manyEntry.recentFeedback.map((entry) => entry.id), ["many-3", "many-4", "many-5", "many-6", "many-7"],
  "expanded history is capped at the newest five while preserving chronological order");

const state = {
  tasks,
  board: [
    { key: "high", count: 1, tasks: [assigned] },
    { key: "medium", count: 1, tasks: [mentioned] },
    { key: "low", count: 0, tasks: [] }
  ],
  members: [jack, helen],
  currentUser: jack,
  onlyMine: false,
  boardExpandedPriorities: new Set(),
  feedbackPanelExpandedTaskIds: new Set([assigned.id]),
  boardUnreadTaskIds: new Set(),
  actionTaskId: null,
  permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false
};
const filterState = { status: "inProgress", priority: "all", member: jack.id, view: "board" };
const boardHtml = renderTaskBoardGrid({ state, filterState, helpers });
assert.match(boardHtml, /data-task-column="low"[\s\S]*data-task-feedback-panel/,
  "the member feedback panel must occupy the fixed slot after the three priority columns");
assert.match(boardHtml, /data-task-feedback-count="2"/);
assert.match(boardHtml, /data-task-feedback-entry="assigned-open"[\s\S]*Hoey[\s\S]*2026\/08\/03 22:00[\s\S]*Newest assigned note/);
assert.match(boardHtml, /data-task-feedback-entry="mentioned-open"[\s\S]*class="task-mention-pill" data-task-mention="user-jack">@ 提到<\/span>/);
assert.match(boardHtml, /data-task-feedback-panel-recent="assigned-open"/);
assert.match(boardHtml, /data-task-detail-open="assigned-open" data-task-feedback-panel-open/,
  "panel entries must reuse the existing task-detail route with an explicit feedback-tab target");

const emptyHtml = renderTaskFeedbackPanel({ member: jack, tasks: [unrelated], helpers });
assert.match(emptyHtml, /data-task-feedback-count="0"/);
assert.match(emptyHtml, />暫無反饋<\/p>/);
assert.doesNotMatch(renderTaskBoardGrid({ state, filterState: { ...filterState, status: "completed" }, helpers }), /data-task-feedback-panel/,
  "terminal filters must not render the in-progress aggregation panel");
assert.doesNotMatch(renderTaskBoardGrid({ state, filterState: { ...filterState, member: "all" }, helpers }), /data-task-feedback-panel/,
  "the all-members board has no single member identity to aggregate");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of [
    "tasks.feedbackPanel.title",
    "tasks.feedbackPanel.empty",
    "tasks.feedbackPanel.expand",
    "tasks.feedbackPanel.collapse",
    "tasks.feedbackPanel.unknownAuthor",
    "tasks.feedbackPanel.attachmentOnly"
  ]) assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
}

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [panelSource, boardSource, tasksSource, cssSource] = await Promise.all([
  read("root-site/team/tasks-feedback-panel.js"),
  read("root-site/team/tasks-board.js"),
  read("root-site/team/tasks.js"),
  read("root-site/team/tasks-domain.css")
]);
assert.match(panelSource, /isTaskMentionedForMember/,
  "the @ subset must reuse TP-at-2's durable mention predicate");
assert.match(panelSource, /taskMatchesMemberStatus\(task, member, "inProgress"\)/);
assert.doesNotMatch(panelSource, /getSupabaseClient|\.from\(/,
  "the panel is a pure read projection over the existing task snapshot");
assert.match(boardSource, /renderTaskFeedbackPanel/);
assert.match(tasksSource, /detailTrigger\.hasAttribute\("data-task-feedback-panel-open"\)[^]*state\.detailTab = "feedback"/);
assert.match(tasksSource, /feedbackPanelExpandedTaskIds: \[\.\.\.state\.feedbackPanelExpandedTaskIds\]/,
  "expanded panel state must survive SPA capture and realtime snapshot replacement");
assert.match(cssSource, /\.task-feedback-panel\s*\{[^]*grid-column: 1/);
assert.match(cssSource, /\.task-mention-pill\s*\{/,
  "mention entries must reuse TP-at-2's existing pill class");

console.log("NR-task-2 contracts: PASS (member feedback aggregation, mention reuse, terminal exclusion, expand/detail/i18n)");
