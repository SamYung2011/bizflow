import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pastedTaskFeedbackImages } from "../root-site/team/tasks-clipboard.js";
import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { renderTaskCalendar, taskDateRange } from "../root-site/team/tasks-calendar.js";
import { renderTaskActionPopover } from "../root-site/team/tasks-actions.js";
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
import { memberRelevantUnreadTaskIds, memberUnreadBadge, memberUnreadCount, viewerRelevantUnreadTaskIds } from "../root-site/team/tasks.js";
import { createTaskBoardReadTracker } from "../root-site/team/task-board-read-state.js";

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
// 2026-08-04 Figma 对稿拆除令 (件1): inline card checkbox was torn down; completion now
// lives in the card's … menu (data-task-action-complete / data-task-action-uncomplete).
assert.match(boardHtml, /data-task-card="child"/);
assert.doesNotMatch(boardHtml, /data-task-completion-toggle/,
  "the inline .team-task-card__completion checkbox must be gone — rendering, styles and events all torn down");
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
const terminalBoardState = {
  ...boardState,
  tasks: [recentRoot, oldRoot, terminalParent, duplicateChild, abandonedTask],
  board: boardState.board
};
const terminalFilterState = { status: "inProgress", priority: "all", member: helen.id, view: "board" };
const terminalBoardHtml = renderTaskBoardGrid({ state: terminalBoardState, filterState: terminalFilterState, helpers });
// 2026-08-04 Figma 对稿拆除令 (件2): .task-terminal-groups 两条杠拆除,改为每个优先级列底部
// 一个 ⌄ 圆钮(data-task-column-terminal-toggle),折叠展示该列自己的终态(完成+放弃)任务。
assert.doesNotMatch(terminalBoardHtml, /data-task-terminal-group=/,
  "the old two-bar completed/abandoned disclosure sections must be gone");
// 2026-08-04 煊煊拍板 (件1,"已完成怎么会出现在列表里？很乱...我宁愿你搞个分界线"): 67532b1 的
// 常显圆形 ⌄(含 disabled 态)整个拆掉,换成活任务下方的分界线,只在该列真有终态任务时才渲染——
// 下面两条断言据此翻转:原先"零终态列仍渲染 disabled 按钮"现在改成"零终态列完全不渲染分界线"。
assert.match(terminalBoardHtml, /data-task-column-terminal-toggle="medium"(?![^>]*disabled)/,
  "the medium column (every fixture task above is medium-priority) gets a divider toggle");
assert.doesNotMatch(terminalBoardHtml, /data-task-column-terminal-toggle="high"/,
  "a column with zero terminal tasks renders no divider at all (no more always-shown circular button)");
assert.match(terminalBoardHtml, /已完成 2 · 已放棄 1/,
  "the divider's visible label breaks completed/abandoned out separately (2 completed + terminal-parent, 1 abandoned)");
assert.doesNotMatch(terminalBoardHtml, /data-task-card="recent-root"/,
  "collapsed by default: terminal cards are not in the markup until the divider is expanded");

const expandedTerminalHtml = renderTaskBoardGrid({
  state: { ...terminalBoardState, boardExpandedTerminalPriorities: new Set(["medium"]) },
  filterState: terminalFilterState,
  helpers
});
assert.match(expandedTerminalHtml, /data-task-column-terminal-toggle="medium" aria-expanded="true"/);
assert.match(expandedTerminalHtml, /team-column-terminal-divider--open/, "the divider itself carries an open-state class once expanded");
assert.match(expandedTerminalHtml, /✓ Task recent-root/,
  "a completed terminal card keeps its ✓ prefix (existing terminal-card style, reused from tasks-calendar.js)");
assert.match(expandedTerminalHtml, /data-task-card="terminal-parent"/);
assert.match(expandedTerminalHtml, /data-task-card="abandoned"/);
assert.doesNotMatch(expandedTerminalHtml, /data-task-card="old-root"/,
  "the 180-day window must still exclude a completed task older than 180 days");
assert.doesNotMatch(expandedTerminalHtml, /data-task-card="duplicate-child"/,
  "a terminal child whose parent is not open must still be suppressed");

const [tasksSource, writesSource, snapshotsSource, memberProviderSource, tasksCssSource, domainCssSource, taskControllerSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain.css", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8")
]);
assert.match(tasksSource, /scope\.listen\(document, "paste", onTaskPaste\)/);
assert.match(tasksSource, /event\.key === "Enter" && \(event\.metaKey \|\| event\.ctrlKey\)/);

// G-task-14 (todo #260, 2026-08-04, 煊煊 approved "可以"): creator wholeTask uncheck must reset
// every assignee's local completedAt too (mirrors completeWholeTask's fan-out, but for undo), while
// an assignee reopening the task via their own row toggle must leave everyone else's row alone.
const completionEcho = tasksSource.slice(
  tasksSource.indexOf("function applyPredictedTaskCompletion"),
  tasksSource.indexOf("function completeWholeTask")
);
const reopenSource = tasksSource.slice(
  tasksSource.indexOf("function reopenWholeTask"),
  tasksSource.indexOf("async function toggleTaskCompletion")
);
assert.match(reopenSource, /function reopenWholeTask\(task, \{ resetAssignees = false \} = \{\}\)/);
const resetAssigneesCalls = completionEcho.match(/reopenWholeTask\(task, \{ resetAssignees: true \}\)/g) ?? [];
assert.equal(resetAssigneesCalls.length, 2,
  "both optimistic prediction and server correction must keep creator wholeTask-uncheck's resetAssignees semantics");
const bareReopenCalls = completionEcho.match(/reopenWholeTask\(task\);/g) ?? [];
assert.equal(bareReopenCalls.length, 2,
  "assignee prediction/correction must keep reopening without resetting anyone else's row");

assert.match(writesSource, /start_date: startDate \|\| null/g);
const completionWrite = writesSource.slice(writesSource.indexOf("export async function completeLiveTask"), writesSource.indexOf("export async function approveLiveTask"));
assert.match(completionWrite, /if \(!completed\)[\s\S]*?status: "open", completed_at: null, approved_at: null, approved_by: null/);
// Flipped 2026-08-04 (todo #260): the old contract asserted creator undo left task_assignees alone
// (assert.doesNotMatch(...task_assignees...)); 煊煊 approved the opposite semantics, so this now
// asserts the reset positively instead of just deleting the coverage.
assert.match(completionWrite, /creator uncheck now resets the whole task AND every[\s\S]*?task_assignees completion row together/);
const creatorUndoWrite = completionWrite.slice(completionWrite.indexOf("if (!completed)"), completionWrite.indexOf("taskDone: false"));
assert.match(creatorUndoWrite, /client\.from\("task_assignees"\)\s*\n\s*\.update\(\{ completed_at: null \}\)/, "creator wholeTask uncheck must reset task_assignees.completed_at to null");
assert.doesNotMatch(creatorUndoWrite, /\.eq\("employee_id"/, "the reset must apply to every assignee row on the task (no .eq(\"employee_id\", ...) scoping to a single row)");
assert.match(completionWrite, /targetEmployeeId[\s\S]*?currentUser\.employeeId/);
assert.match(snapshotsSource, /titleEditedBy:[\s\S]*?titleEditedAt:/);

// G-task-15 (2026-08-04 Figma 对稿拆除令,件1): card checkbox torn down; the … menu now carries
// completion, swapping 完成/取消完成 off the exact same taskCompletionForMember judgment the old
// checkbox used (canToggle/checked/wholeTask), so creator/assignee permission boundaries hold.
const menuState = {
  currentUser: helen,
  permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false,
  actionTaskId: null
};
const openMenuTask = task("menu-open", { creator: helen.name, creatorId: helen.id, assignees: [] });
const openMenuHtml = renderTaskActionPopover({ task: openMenuTask, open: true, state: menuState, helpers });
assert.match(openMenuHtml, /data-task-action-complete="menu-open"/, "an open task's creator menu keeps the existing 完成 action, untouched");
assert.doesNotMatch(openMenuHtml, /data-task-action-uncomplete/);

const doneMenuTask = task("menu-done", {
  creator: helen.name,
  creatorId: helen.id,
  status: "completed",
  done: true,
  completedAt: dateOffset(-1, true),
  assignees: []
});
const doneMenuHtml = renderTaskActionPopover({ task: doneMenuTask, open: true, state: menuState, helpers });
assert.match(doneMenuHtml, /data-task-action-uncomplete="menu-done"/, "a completed task's creator menu swaps to 取消完成");
assert.doesNotMatch(doneMenuHtml, /data-task-action-complete="menu-done"/);

const abandonedAssigneeTask = task("menu-abandoned-assignee", {
  creator: jack.name,
  creatorId: jack.id,
  status: "abandoned",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: dateOffset(-1, true) }]
});
const abandonedAssigneeHtml = renderTaskActionPopover({ task: abandonedAssigneeTask, open: true, state: menuState, helpers });
assert.match(abandonedAssigneeHtml, /data-task-action-uncomplete="menu-abandoned-assignee"(?![^>]*disabled)/,
  "an abandoned task's own-row assignee gets an enabled 取消完成 (assignee canToggle is unconditional, unchanged)");

const abandonedCreatorTask = task("menu-abandoned-creator", { creator: helen.name, creatorId: helen.id, status: "abandoned", assignees: [] });
const abandonedCreatorHtml = renderTaskActionPopover({ task: abandonedCreatorTask, open: true, state: menuState, helpers });
assert.match(abandonedCreatorHtml, /data-task-action-uncomplete="menu-abandoned-creator"[^>]*disabled/,
  "a non-self-assigned creator's wholeTask toggle stays blocked on an abandoned task — same canToggle gate the old checkbox honored");

// 件1 of 2026-08-04 煊煊拍板批3 (截图批注"空这么多准备开航母吗"): the action popover's height must
// track its actual item count (1~4 depending on permission/status), not a fixed value calibrated
// for the 2-item case. Locks the CSS fix so a future edit can't reintroduce a fixed min-height.
assert.doesNotMatch(tasksCssSource, /min-height:\s*var\(--task-action-height\)/,
  "the popover must size to its real content (flex column + fixed row height + gap/padding already do this), not a fixed min-height calibrated for one specific item count");
assert.doesNotMatch(tasksCssSource, /--task-action-height/,
  "the now-unused height custom property must be removed too, not left as dead CSS");

// G-task-16 (2026-08-04 Figma 对稿拆除令,件3): member rail right-side badge caps at 99+ and
// hides at 0 (Figma 271:720's red count-badge), and the gray role label reads employees.role
// (member.position, threaded through provider.js) instead of fabricating a department fallback.
// 2026-08-04 (件2, 煊煊「3个任务就显示3个红点是什么逻辑？一点没看懂」): the cap/hide format helper
// itself is untouched (still 99+/blank at 0), only renamed since its input is no longer the
// "N 任務待完成" duplicate — see memberUnreadCount below for the new unread-count source.
assert.equal(memberUnreadBadge(0), "", "0 unread must not render a badge at all");
assert.equal(memberUnreadBadge(1), "1");
assert.equal(memberUnreadBadge(99), "99");
assert.equal(memberUnreadBadge(100), "99+", "counts over 99 must cap at the 99+ label");
assert.equal(memberUnreadBadge(2400), "99+");
assert.match(tasksSource, /const role = member\.dept === "all" \? \(member\.deptLabel \?\? pageT\(lang, `tasks\.dept\.\$\{member\.dept\}`\)\) : \(member\.position \|\| ""\);/,
  "regular members must read member.position (employees.role) and stay blank when absent — no department-enum fabrication; Honnmono all keeps its old deptLabel/enum fallback");
assert.match(memberProviderSource, /position: member\.position,/,
  "provider.js must forward the members-snapshot's already-computed employees.role (member.position) to the task-page member rail");

// G-task-17 (2026-08-04 件2, ead797e; comment corrected 2026-08-04 批3 件3+5, then again 2026-08-04
// 批4 — see G-task-20 below for the viewer-subject pivot itself): the badge's source —
// memberUnreadCount aggregates the existing tp-task-board-read-v1 fingerprint output
// (boardUnreadTaskIds, the same Set the column-header "N 項未讀變更" badge already reads) per member,
// gated through a viewer. Coverage here is the source-agnostic plumbing (subtask exclusion,
// empty/missing Set, missing viewer) that doesn't depend on which relevance rule is used.
// creator pinned to a neutral third party (mirrors G-task-9's `parent` fixture) so relevance
// below comes purely from the explicit assignees list, not the task() factory's jack-creator default.
// viewer = helen throughout this block (viewing her own row), so the row-relevance gate and the
// viewer-relevance gate collapse into the same check — G-task-20 below is where they diverge.
const unreadVisible = task("unread-visible-to-helen", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }]
});
const unreadNotVisible = task("unread-not-visible-to-helen", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }]
});
const unreadSubtaskChild = task("unread-subtask-child", {
  creator: "Other", creatorId: "employee-other",
  parentId: "some-parent",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }]
});
const readAlready = task("read-already-visible-to-helen", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }]
});
const unreadFixtureTasks = [unreadVisible, unreadNotVisible, unreadSubtaskChild, readAlready];
const unreadTaskIds = new Set([unreadVisible.id, unreadNotVisible.id, unreadSubtaskChild.id]);
assert.equal(memberUnreadCount(helen, unreadFixtureTasks, unreadTaskIds, helen), 1,
  "only the root task both (a) fingerprinted-unread and (b) visible to this member counts — not jack's task, not the subtask, not the already-read one");
assert.equal(memberUnreadCount(jack, unreadFixtureTasks, unreadTaskIds, jack), 1,
  "the same Set scoped to a different member/viewer pair counts only what's visible to *that* member (jack's own task, viewed by jack himself)");
assert.equal(memberUnreadCount(helen, unreadFixtureTasks, new Set(), helen), 0, "an empty unread Set must yield 0, not throw");
assert.equal(memberUnreadCount(helen, unreadFixtureTasks, null, helen), 0, "a missing unread Set must yield 0, not throw");
assert.equal(memberUnreadCount(helen, unreadFixtureTasks, unreadTaskIds, null), 0,
  "a missing viewer must yield 0 too — with nobody identified as \"currently looking\", nothing can be \"relevant to the current account\", so no row may show a badge (不读不写不亮 extended to an unresolved viewer)");
assert.equal(memberUnreadCount(helen, unreadFixtureTasks, unreadTaskIds, jack), 0,
  "jack (viewer) has no relation to unreadVisible (helen-only assignee) — it must not count on helen's row when jack is the one looking");
assert.match(tasksSource, /const unreadBadge = member\.dept === "all" \? "" : memberUnreadBadge\(memberUnreadCount\(member, tasks, state\.boardUnreadTaskIds, state\.currentUser\)\);/,
  "the member-row badge must be wired to the unread aggregator gated by the current viewer (state.currentUser), not to openCount and not ungated");

// G-task-19 (2026-08-04 煊煊拍板批3 件3+5, 截图批注「朝哥任务只有 2 个红点为什么 5」「人人一个 5」
// 「点击之后不会消失」「完全不知道数据从哪算出来」): the relevance rule was tightened from
// isTaskVisibleToMember (assignee/creator/mention — any hit counts) to assignee-or-mention only.
// creator-only is the exact delta: G-task-17's fixtures above never had a creator-only task (their
// creator was always pinned to a neutral third party), so they can't tell the two rules apart —
// this is the fixture that does.
const relevantAssignee = task("relevant-assignee-only", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }]
});
const relevantMentionOnly = task("relevant-mention-only", {
  creator: "Other", creatorId: "employee-other",
  assignees: [],
  feedback: [{
    id: "fb-relevant-mention", author: "Other", authorUserId: "user-other",
    message: "@Helen please check", mentionedUserIds: [helen.userId], attachments: []
  }]
});
const creatorOnlyIrrelevant = task("creator-only-irrelevant", {
  creator: helen.name, creatorId: helen.id,
  assignees: []
});
const relevanceFixtureTasks = [relevantAssignee, relevantMentionOnly, creatorOnlyIrrelevant];
const relevanceUnreadIds = new Set([relevantAssignee.id, relevantMentionOnly.id, creatorOnlyIrrelevant.id]);
// viewer = helen: she's both the row subject and the one looking, so this block still isolates the
// underlying assignee-or-mention predicate itself (件2 批4's viewer gate is covered separately below
// in G-task-20, where member and viewer are different people).
assert.deepEqual(new Set(memberRelevantUnreadTaskIds(helen, relevanceFixtureTasks, relevanceUnreadIds, helen)),
  new Set([relevantAssignee.id, relevantMentionOnly.id]),
  "assignee-hit and mention-hit both count; creator-only (not assigned, not mentioned) must not — that's the exact ead797e-era over-count the redo fixes");
assert.equal(memberUnreadCount(helen, relevanceFixtureTasks, relevanceUnreadIds, helen), 2,
  "memberUnreadCount is just the length of the same relevance set, not a second parallel tally");
// 0 隐藏: 与他完全无关的那条(仅创建人,未指派、未被 @)即便在未读指纹集里,也不该让徽标露出来。
assert.equal(
  memberUnreadBadge(memberUnreadCount(helen, [creatorOnlyIrrelevant], new Set([creatorOnlyIrrelevant.id]), helen)),
  "",
  "creator-only relevance yields a 0 count, and 0 must render no badge at all (the 99+/hide-at-0 formatter is unchanged)"
);

// G-task-20 (2026-08-04 批4 煊煊 18:01 拍板「红点的逻辑是跟着账号走的啊。别的号未读的但是跟现在登录
// 的账号无关的信息为什么要有红点？」): the viewer-subject pivot itself. Three tasks, all fingerprint-
// unread: one relevant only to helen, one relevant only to jack, one relevant to both (mirrors a
// real all-hands/shared-assignee task like 港車北上). viewer = helen throughout — jack's row must
// only light up for the *shared* task, never for jack's own private task, because helen (the one
// currently logged in) has no relationship to it at all.
const helenOnlyTask = task("viewer-helen-only", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null }]
});
const jackOnlyTask = task("viewer-jack-only", {
  creator: "Other", creatorId: "employee-other",
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }]
});
const sharedBothTask = task("viewer-shared-both", {
  creator: "Other", creatorId: "employee-other",
  assignees: [
    { employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null },
    { employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }
  ]
});
const viewerFixtureTasks = [helenOnlyTask, jackOnlyTask, sharedBothTask];
const viewerUnreadIds = new Set(viewerFixtureTasks.map((item) => item.id));
assert.deepEqual(new Set(viewerRelevantUnreadTaskIds(helen, viewerFixtureTasks, viewerUnreadIds)),
  new Set([helenOnlyTask.id, sharedBothTask.id]),
  "helen's own unread-and-relevant set: her private task and the shared one — never jack's private task");
// jack's ROW, viewed by helen: only the task that is *also* relevant to helen may show — jackOnlyTask
// is real, unread, and correctly attributed to jack's row-membership, but helen (viewer) has nothing
// to do with it, so it must not produce a red dot anywhere in helen's session.
assert.deepEqual(new Set(memberRelevantUnreadTaskIds(jack, viewerFixtureTasks, viewerUnreadIds, helen)),
  new Set([sharedBothTask.id]),
  "jack's row only lights up for the task both assigned to jack AND relevant to the current viewer — jack's own private task stays dark when helen is looking");
assert.equal(memberUnreadCount(jack, viewerFixtureTasks, viewerUnreadIds, helen), 1);
// helen's own row, same viewer: her private task plus the shared one both count normally.
assert.equal(memberUnreadCount(helen, viewerFixtureTasks, viewerUnreadIds, helen), 2);
// Flip the viewer to jack: now helen's row only shows the shared task, and jack's own row shows both.
assert.equal(memberUnreadCount(helen, viewerFixtureTasks, viewerUnreadIds, jack), 1,
  "symmetric check: with jack as viewer, helen's row only shows what's relevant to jack (the shared task)");
assert.equal(memberUnreadCount(jack, viewerFixtureTasks, viewerUnreadIds, jack), 2);

// 点视图消灯 (截图批注"点击之后不会消失"): navigating into a member's board view must mark their
// relevant unread fingerprints seen through the existing tp-task-board-read-v1 tracker, not leave
// them stuck until the column-header IntersectionObserver happens to scroll them into view. This
// needs a live taskBoardReadTracker/DOM click cycle this repo's node scripts don't spin up (same
// reason TP-at-1/TP-at-2/reddot-1's provider-facing pieces fall back to source-text contracts) —
// so the wiring is locked at the source level instead of executed end-to-end.
assert.match(tasksSource, /function markMemberBoardSeen\(memberKey\)/,
  "tasks.js must own a dedicated mark-seen-on-navigate function (mirrors refreshTaskBoardReadState's existing closure over taskBoardReadTracker)");
const markMemberBoardSeenBlock = tasksSource.slice(
  tasksSource.indexOf("function markMemberBoardSeen(memberKey)"),
  tasksSource.indexOf("function renderMember(")
);
assert.match(markMemberBoardSeenBlock, /memberRelevantUnreadTaskIds\(member, state\.tasks, state\.boardUnreadTaskIds, state\.currentUser\)/,
  "the navigate-to-member mark-seen path must reuse the exact same viewer-gated relevance function the badge count uses (including state.currentUser as viewer), not a second parallel filter that could drift out of sync");
assert.match(markMemberBoardSeenBlock, /taskBoardReadTracker\.markSeen\(/,
  "must clear through the existing tp-task-board-read-v1 tracker's markSeen, not a new parallel read-state store");
assert.match(markMemberBoardSeenBlock, /memberKey === "all"/,
  "the Honnmono-all nav row has no personal-relevance concept and must be excluded from mark-seen, the same carve-out ead797e already applied to its badge");
assert.match(tasksSource, /refreshTaskBoardReadState: \(\) => taskBoardReadTracker\?\.refresh\(state\.tasks\),\s*\n\s*markMemberBoardSeen,/,
  "markMemberBoardSeen must actually be threaded into attachTaskDomainController's dependency object");
assert.match(taskControllerSource, /markMemberBoardSeen,/,
  "tasks-domain-controller.js must accept markMemberBoardSeen as a dependency");
assert.match(taskControllerSource, /setSessionValue\("team-tasks-view-mode", "board"\);[\s\S]*?markMemberBoardSeen\?\.\(nextMember\);\s*\n\s*rerender\(\);/,
  "clicking a member row (memberTrigger) must call the mark-seen callback for that member in the same handler pass that rerenders, so the badge updates immediately, not on some later render");

// 件1 (2026-08-04 批4「存储按账号隔离」) source contract: the board tracker's account id must come
// from read-state.js's own resolved identity (the same source markRead("tasks", …) uses), not a
// re-derivation from state.currentUser.id (which can be a demo/mock member id with no real account
// behind it in the unauthenticated fallback path).
assert.match(tasksSource, /import \{ getReadStateAccount, markRead \} from "\.\.\/data\/read-state\.js";/,
  "tasks.js must import getReadStateAccount alongside markRead — one identity source for both read-state systems");
assert.match(tasksSource, /accountId: getReadStateAccount\(\),/,
  "createTaskBoardReadTracker must receive the real resolved account id, not state.currentUser.id");

// 件3 (2026-08-04 批4, real executable proof — not just a source contract — that 720b742's known
// cross-account boundary case auto-resolves once storage is account-scoped): two different accounts
// (not two rows viewed by the same person — two actually-different logged-in identities, e.g. Helen
// and 朝哥 on the same machine) both relevant to one shared task. One account marking it seen through
// markSeen (mirroring what markMemberBoardSeen does) must have zero effect on the other account's
// unread state — they now live under physically separate localStorage keys, not just separate
// sub-scopes inside one shared blob.
{
  function fakeAccountStorage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  }
  const immediate = (callback) => { callback({ didTimeout: true, timeRemaining: () => 8 }); return null; };
  const sharedBrowserStorage = fakeAccountStorage(); // simulates the SAME machine's localStorage
  const sharedAllHandsTask = task("cross-account-shared-task", {
    creator: "Other", creatorId: "employee-other",
    assignees: [
      { employeeId: helen.id, name: helen.name, completedAt: null, abandonedAt: null },
      { employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }
    ]
  });
  let helenUnread = new Set();
  const helenTracker = createTaskBoardReadTracker({
    scopeKey: "honnmono:employee-helen", accountId: "employee-helen", storage: sharedBrowserStorage,
    schedule: immediate, cancel: () => {}, onUnreadChange: (next) => { helenUnread = next; }
  });
  let jackUnread = new Set();
  const jackTracker = createTaskBoardReadTracker({
    scopeKey: "honnmono:employee-jack", accountId: "employee-jack", storage: sharedBrowserStorage,
    schedule: immediate, cancel: () => {}, onUnreadChange: (next) => { jackUnread = next; }
  });
  helenTracker.refresh([sharedAllHandsTask]);
  jackTracker.refresh([sharedAllHandsTask]);
  assert.deepEqual([...helenUnread], [], "first run establishes each account's own zero-unread baseline");
  assert.deepEqual([...jackUnread], []);
  const editedTask = { ...sharedAllHandsTask, title: "港車北上 (updated)" };
  helenTracker.refresh([editedTask]);
  jackTracker.refresh([editedTask]);
  assert.deepEqual([...helenUnread], [sharedAllHandsTask.id], "the edit shows up as unread independently for each account");
  assert.deepEqual([...jackUnread], [sharedAllHandsTask.id]);
  helenTracker.markSeen([sharedAllHandsTask.id]); // mirrors clicking into a member row that surfaces this task
  assert.deepEqual([...helenUnread], [], "helen's own unread clears");
  assert.deepEqual([...jackUnread], [sharedAllHandsTask.id],
    "跨账号零影响: jack's unread for the SAME shared task must be completely untouched by helen marking it seen — this is the exact 720b742-era boundary case, now resolved by per-account storage keys rather than a shared scopes blob");
  assert.notEqual(sharedBrowserStorage.getItem("tp-task-board-read-v1:acct:employee-helen"), sharedBrowserStorage.getItem("tp-task-board-read-v1:acct:employee-jack"),
    "the two accounts' persisted baselines are physically different storage entries, not two views of one shared value");
  helenTracker.dispose();
  jackTracker.dispose();
}

// G-task-18 (rewritten 2026-08-04, 煊煊拍板批3 件4, 截图批注"两个功能完全重复,保留一个即可"):
// 51d9c6d only unified the two rail rows onto one click path (both fired the same memberTrigger
// branch); today's screenshot says that stopped short — 「任務總覽」row must be gone entirely,
// keeping only 「Honnmono all」. Deleted: renderOverviewEntry and its call site (渲染), plus
// .team-member-task--overview and the icon-only rules it dragged in (样式). No further change was
// needed in tasks-domain-controller.js's memberTrigger branch itself (触发路径) — 51d9c6d had
// already made it fully generic, so deleting the button leaves nothing row-specific behind there;
// only its now-stale explanatory comment (which named renderOverviewEntry) was cleaned up.
assert.doesNotMatch(tasksSource, /function renderOverviewEntry/,
  "renderOverviewEntry must be deleted outright, not just made unreachable");
assert.doesNotMatch(tasksSource, /renderOverviewEntry\(/,
  "its call site in the member rail must be gone too");
assert.doesNotMatch(tasksSource, /team-member-task--overview/,
  "the row's render-time CSS hook must be gone from tasks.js's output");
assert.doesNotMatch(domainCssSource, /\.team-member-task--overview/,
  "the dead .team-member-task--overview rule must be removed from tasks-domain.css, not left orphaned");
assert.doesNotMatch(domainCssSource, /team-member-task__overview-icon/,
  "the icon-square rule (and its --active variant) was only ever used by the deleted row; it must go with it");
assert.match(tasksSource, /<div class="team-member-list">\$\{state\.members\.map\(\(member\) => renderMember\(member, memberTasks, helpers\)\)\.join\(""\)\}<\/div>/,
  "the member rail must render only ordinary renderMember rows now — Honnmono all is included in that list already (it's a normal state.members entry with dept===\"all\"), no separate nav button alongside it");
// Explicit boundary, not a regression this commit causes: the admin default-landing screen
// (tasks-overview.js, reached only via defaultTaskViewForUser's initial { mode: "overview" } for
// admins — see G-task-10 above, still unchanged) stays. Only its now-redundant manual nav row is
// gone; there's simply no click path back to it once you leave, which is the accepted tradeoff of
// keeping exactly one rail entry point instead of two that did the same thing.
assert.match(tasksSource, /import \{ renderTaskOverview \} from "\.\/tasks-overview\.js";/,
  "the overview screen module import must survive — it still serves the admin landing case");
assert.match(tasksSource, /if \(state\.mode === "overview"\)[\s\S]*?return renderTaskOverview\(/,
  "the overview render branch itself must be untouched");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of [
    "tasks.card.assignedBy", "tasks.card.overdue", "tasks.card.dueSoon", "tasks.action.uncomplete",
    "tasks.column.terminalExpand", "tasks.column.terminalCollapse", "tasks.column.terminalSummary",
    "tasks.detail.publishedBy", "tasks.detail.createdAt", "tasks.detail.completedAt", "tasks.detail.abandonedAt",
    "tasks.detail.titleEditedAt", "tasks.submit.startAt", "tasks.submit.selectStart"
  ]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}

console.log("NR-task-1 contracts: PASS (paste, card info, initial view, metadata, start date, completion undo + assignee reset, terminal calendar/sections, card-menu 完成/取消完成 swap, member badge/role, action-popover height, unread-relevance redo + mark-seen wiring, 任務總覽 row removal, viewer-subject badge pivot, cross-account mark-seen isolation)");
