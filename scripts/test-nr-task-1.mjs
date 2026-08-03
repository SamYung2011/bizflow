import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pastedTaskFeedbackImages } from "../root-site/team/tasks-clipboard.js";
import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { renderTaskCalendar, taskDateRange } from "../root-site/team/tasks-calendar.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import {
  calendarRelatedTasks,
  defaultTaskViewForUser,
  taskCompletionForMember,
  taskDuePresentation,
  terminalTasksForMember
} from "../root-site/team/tasks-model.js";
import { renderTaskSubmitDialog } from "../root-site/team/tasks-submit.js";

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };

function dateOffset(days, withTime = false) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  const date = `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, "0")}/${String(value.getDate()).padStart(2, "0")}`;
  return withTime ? `${date} 12:00` : date;
}

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    content: "Details",
    owner: helen.name,
    members: [helen.name],
    priority: "medium",
    dbPriority: "mid",
    status: "inProgress",
    done: false,
    due: dateOffset(1),
    startDate: "",
    createdAt: dateOffset(-10, true),
    completedAt: "",
    creator: jack.name,
    creatorId: jack.id,
    titleEditedBy: "",
    titleEditedAt: "",
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

// G-task-1: clipboard image -> renamed draft + preview, with paste/Cmd+Enter wiring.
const pasted = pastedTaskFeedbackImages({
  items: [{ kind: "file", type: "image/png", getAsFile: () => ({ type: "image/png", size: 4 }) }]
}, {
  now: 1234,
  createFile: (parts, name, options) => ({ name, type: options.type, size: parts[0].size, lastModified: 0 }),
  previewUrlForFile: (file) => `blob:${file.name}`
});
assert.deepEqual(pasted.map((draft) => ({ name: draft.name, type: draft.type, previewUrl: draft.previewUrl })), [
  { name: "pasted-1234-0.png", type: "image/png", previewUrl: "blob:pasted-1234-0.png" }
]);

// G-task-9: due state, publisher pill and promoted-child parent breadcrumb.
assert.deepEqual(taskDuePresentation(task("overdue", { due: dateOffset(-2) })).tone, "overdue");
assert.deepEqual(taskDuePresentation(task("soon", { due: dateOffset(2) })).tone, "soon");
const parent = task("parent", {
  creatorId: "employee-other",
  creator: "Other",
  assignees: [],
  members: [],
  owner: "—"
});
const child = task("child", { parentId: parent.id, due: dateOffset(-2) });
parent.subtasks = [child];
const boardTasks = [parent, child];
const boardState = {
  tasks: boardTasks,
  board: [
    { key: "high", count: 0, tasks: [] },
    { key: "medium", count: 2, tasks: boardTasks },
    { key: "low", count: 0, tasks: [] }
  ],
  members: [helen, jack],
  currentUser: helen,
  onlyMine: false,
  boardExpandedPriorities: new Set(),
  boardUnreadTaskIds: new Set(),
  actionTaskId: null,
  permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false
};
const boardHtml = renderTaskBoardGrid({
  state: boardState,
  filterState: { status: "inProgress", priority: "all", member: helen.id, view: "board" },
  helpers
});
assert.match(boardHtml, /data-task-card="child"[\s\S]*?data-task-completion-toggle="child"/);
assert.match(boardHtml, /team-task-card__parent[^>]*>↳ Task parent<\/span>/);
assert.match(boardHtml, /task-assigned-pill[^>]*>Jack 分配<\/span>/);
assert.match(boardHtml, /team-task-card__due--overdue/);

// G-task-10: admin keeps overview; ordinary users start on their own board.
assert.deepEqual(defaultTaskViewForUser({ isSuperAdmin: true }, helen), { mode: "overview", member: "all" });
assert.deepEqual(defaultTaskViewForUser({ isSuperAdmin: false, isAdminOfActive: false }, helen), { mode: "board", member: helen.id });

// G-task-6: detail metadata is fully surfaced, including title edit audit.
const completedTask = task("metadata", {
  status: "completed",
  done: true,
  completedAt: dateOffset(-1, true),
  titleEditedBy: "Jack",
  titleEditedAt: dateOffset(-2, true),
  attachments: pasted,
  attachmentCount: 1,
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: dateOffset(-1, true), abandonedAt: null }]
});
const detailHtml = renderTaskDetail({
  state: {
    detailOpen: true,
    selectedTaskId: completedTask.id,
    detailTab: "content",
    attachmentPreview: null,
    tasks: [completedTask],
    members: [helen, jack],
    departments: [],
    currentUser: helen,
    permissions: { canCreate: false, canValidate: false, canDeleteOthers: false },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    feedbackEditingId: null,
    feedbackDraft: { message: "", attachments: pasted, mentions: [], mentionMenu: { open: false, query: "" } },
    feedbackError: "",
    subtaskAddDraft: { title: "", assigneeId: "" }
  },
  helpers
});
assert.match(detailHtml, /task-detail__metadata/);
assert.match(detailHtml, /發布人 Jack/);
assert.match(detailHtml, /添加於/);
assert.match(detailHtml, /✓ 完成於/);
assert.match(detailHtml, /標題由 Jack 編輯於/);
assert.match(detailHtml, /<img src="blob:pasted-1234-0\.png"/);

// G-task-2: start date appears in create/edit UI and drives a multi-day range.
const submitHtml = renderTaskSubmitDialog({
  state: {
    submitOpen: true,
    submitMode: "create",
    submitDraft: {
      title: "Start date",
      content: "",
      priority: "high",
      departmentId: "",
      owner: helen.name,
      requiresReview: "no",
      memberIds: [],
      memberQuery: "",
      memberMenuOpen: false,
      startDate: "2026-08-01",
      due: "2026-08-03",
      attachments: []
    },
    submitCanAssignOthers: false,
    submitOriginalDepartmentId: "",
    members: [helen],
    currentUser: helen,
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    submitError: ""
  },
  data: { members: [helen], departments: [] },
  helpers
});
assert.match(submitHtml, /data-task-start-trigger/);
assert.match(submitHtml, /name="startDate" value="2026-08-01"/);
const range = taskDateRange({ startDate: "2026-08-01", due: "2026-08-03" });
assert.equal(Math.round((range.end - range.start) / 86400000), 2);

// G-task-3: assignee toggles their row; a non-assignee creator toggles the task.
const assignedCompletion = taskCompletionForMember(task("assigned"), helen);
assert.deepEqual(assignedCompletion, { checked: false, canToggle: true, wholeTask: false });
const creatorOnly = task("creator-only", { creator: helen.name, creatorId: helen.id, assignees: [], members: [] });
assert.deepEqual(taskCompletionForMember(creatorOnly, helen), { checked: false, canToggle: true, wholeTask: true });

// G-task-12: related terminal tasks stay on the calendar with terminal styling.
const abandonedTask = task("abandoned", {
  status: "abandoned",
  completedAt: dateOffset(-1, true),
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: dateOffset(-1, true) }]
});
const calendarTasks = [completedTask, abandonedTask];
assert.deepEqual(calendarRelatedTasks(calendarTasks, { currentUser: helen }).map((row) => row.id), [completedTask.id, abandonedTask.id]);
const calendarHtml = renderTaskCalendar({
  tasks: calendarTasks,
  state: { currentUser: helen, calendarYear: new Date().getFullYear(), calendarMonth: new Date().getMonth(), calendarExpandedDate: null },
  helpers
});
assert.match(calendarHtml, /task-calendar__bar--terminal task-calendar__bar--completed/);
assert.match(calendarHtml, />✓ Task metadata<\/span>/);
assert.match(calendarHtml, /task-calendar__bar--terminal task-calendar__bar--abandoned/);

// G-task-13: 180-day window and terminal-child suppression, plus same-screen details.
const recentRoot = task("recent-root", {
  status: "completed",
  done: true,
  completedAt: dateOffset(-179, true),
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: dateOffset(-179, true), abandonedAt: null }]
});
const oldRoot = task("old-root", {
  status: "completed",
  done: true,
  completedAt: dateOffset(-181, true),
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: dateOffset(-181, true), abandonedAt: null }]
});
const oldRecentlyAbandonedRoot = task("old-recently-abandoned-root", {
  status: "abandoned",
  createdAt: dateOffset(-181, true),
  completedAt: "",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: dateOffset(-1, true) }]
});
const terminalParent = task("terminal-parent", {
  status: "completed",
  done: true,
  completedAt: dateOffset(-2, true),
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: dateOffset(-2, true), abandonedAt: null }]
});
const duplicateChild = task("duplicate-child", {
  parentId: terminalParent.id,
  status: "completed",
  done: true,
  completedAt: dateOffset(-1, true),
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: dateOffset(-1, true), abandonedAt: null }]
});
const terminal = terminalTasksForMember(helen, [recentRoot, oldRoot, oldRecentlyAbandonedRoot, terminalParent, duplicateChild, abandonedTask]);
assert.deepEqual(terminal.completed.map((row) => row.id), [recentRoot.id, terminalParent.id]);
assert.deepEqual(terminal.abandoned.map((row) => row.id), [abandonedTask.id]);
const terminalBoardHtml = renderTaskBoardGrid({
  state: {
    ...boardState,
    tasks: [recentRoot, oldRoot, terminalParent, duplicateChild, abandonedTask],
    board: boardState.board
  },
  filterState: { status: "inProgress", priority: "all", member: helen.id, view: "board" },
  helpers
});
assert.match(terminalBoardHtml, /data-task-terminal-group="abandoned"/);
assert.match(terminalBoardHtml, /data-task-terminal-group="completed"/);
assert.doesNotMatch(terminalBoardHtml, /data-task-card="old-root"/);
assert.doesNotMatch(terminalBoardHtml, /data-task-card="duplicate-child"/);

const [tasksSource, writesSource, snapshotsSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8")
]);
assert.match(tasksSource, /scope\.listen\(document, "paste", onTaskPaste\)/);
assert.match(tasksSource, /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/);
assert.match(writesSource, /start_date: startDate \|\| null/g);
const completionWrite = writesSource.slice(writesSource.indexOf("export async function completeLiveTask"), writesSource.indexOf("export async function approveLiveTask"));
assert.match(completionWrite, /if \(!completed\)[\s\S]*?status: "open", completed_at: null, approved_at: null, approved_by: null/);
assert.match(completionWrite, /Keep every task_assignees completion row intact/);
const creatorUndoWrite = completionWrite.slice(completionWrite.indexOf("if (!completed)"), completionWrite.indexOf("const assigneeResult"));
assert.doesNotMatch(creatorUndoWrite, /client\.from\("task_assignees"\)/);
assert.match(completionWrite, /targetEmployeeId[\s\S]*?currentUser\.employeeId/);
assert.match(snapshotsSource, /titleEditedBy:[\s\S]*?titleEditedAt:/);

for (const lang of ["zh", "en", "fr"]) {
  for (const key of [
    "tasks.card.assignedBy", "tasks.card.overdue", "tasks.card.dueSoon", "tasks.card.toggleComplete",
    "tasks.detail.publishedBy", "tasks.detail.createdAt", "tasks.detail.completedAt", "tasks.detail.abandonedAt",
    "tasks.detail.titleEditedAt", "tasks.submit.startAt", "tasks.submit.selectStart"
  ]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}

console.log("NR-task-1 contracts: PASS (paste, card info, initial view, metadata, start date, completion undo, terminal calendar/sections)");
