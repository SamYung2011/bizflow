import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskActionPopover } from "../root-site/team/tasks-actions.js";
import { isTaskCreator } from "../root-site/team/tasks-model.js";
import { renderTaskOverview } from "../root-site/team/tasks-overview.js";
import { renderTaskSubmitDialog } from "../root-site/team/tasks-submit.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const jack = {
  id: "employee-jack",
  name: "Jack",
  isSuperAdmin: false,
  isAdminOfActive: false
};
const jackTask = {
  id: "task-by-jack",
  title: "Jack 原標題",
  creator: "Jack",
  creatorId: jack.id,
  assignees: [{ employeeId: "employee-sam", name: "Sam", completedAt: null, abandonedAt: null }],
  done: false,
  status: "inProgress",
  parentId: null,
  requiresReview: false
};
const restrictedState = {
  currentUser: jack,
  permissions: {
    canCreate: true,
    canEditOthers: false,
    canDeleteOthers: false
  },
  liveTaskWrites: true,
  liveReadOnly: true,
  writeBusy: false
};

assert.equal(isTaskCreator(jackTask, jack), true, "creator_employee_id identity must recognize Jack's own task");
const jackMenu = renderTaskActionPopover({ task: jackTask, open: true, state: restrictedState, helpers });
assert.match(jackMenu, /data-task-action-edit="task-by-jack"/, "a creator without edit-others permission must still get Edit");

const submitHtml = renderTaskSubmitDialog({
  state: {
    submitOpen: true,
    submitMode: "create",
    submitDraft: {
      title: "只填標題",
      content: "",
      priority: "high",
      departmentId: "",
      owner: "Jack",
      requiresReview: "no",
      memberIds: [],
      memberQuery: "",
      memberMenuOpen: false,
      due: "2026-07-20",
      attachments: []
    },
    submitCanAssignOthers: false,
    currentUser: jack,
    currentUserId: jack.id,
    submitOriginalDepartmentId: "",
    writeBusy: false,
    liveReadOnly: true,
    liveTaskWrites: true,
    submitError: ""
  },
  data: {
    departments: [],
    members: [{ ...jack, dept: "member" }]
  },
  helpers
});
assert.match(submitHtml, /<input name="title"[^>]* required/, "title remains the only user-entered required text");
const contentControl = submitHtml.match(/<textarea name="content"[^>]*>/)?.[0] ?? "";
assert.ok(contentControl, "content textarea must render");
assert.doesNotMatch(contentControl, /\brequired\b/, "content must be optional for title-only publishing");
assert.doesNotMatch(submitHtml, /form-task-submit__button--confirm" disabled/, "prefilled owner/due permit direct publish");

const completedTasks = Array.from({ length: 6 }, (_, index) => ({
  ...jackTask,
  id: `completed-${index + 1}`,
  title: `已完成 ${index + 1}`,
  done: true,
  status: "completed",
  completedAt: `2026-07-${String(index + 1).padStart(2, "0")} 12:00`,
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: `2026-07-${String(index + 1).padStart(2, "0")} 12:00`, abandonedAt: null }]
}));
const collapsedOverview = renderTaskOverview({
  members: [{ ...jack, dept: "member" }],
  tasks: completedTasks,
  expanded: new Set([jack.id]),
  completedExpanded: new Set(),
  helpers
});
assert.match(collapsedOverview, /data-completed-visible="5"/, "completed history defaults to five rows");
assert.match(collapsedOverview, /data-overview-completed-toggle="employee-jack"/, "more toggle must render above five rows");
const expandedOverview = renderTaskOverview({
  members: [{ ...jack, dept: "member" }],
  tasks: completedTasks,
  expanded: new Set([jack.id]),
  completedExpanded: new Set([jack.id]),
  helpers
});
assert.match(expandedOverview, /data-completed-visible="6"/, "expanded history must show every completed task");

const [tasksSource, controllerSource, rlsSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/083_team_task_field_hardening.sql", import.meta.url), "utf8")
]);
assert.match(tasksSource, /function canEditTask\(task\)[\s\S]*?isTaskCreator\(task, state\.currentUser\)/,
  "submit guard must authorize the creator independently of edit-others permission");
assert.match(tasksSource, /updateLiveTask\(task\.id, \{[\s\S]*?title,/,
  "edit submit must persist the title through updateLiveTask");
// 2026-08-04 (件3 of the 煊煊拍板批次, "Honnmono总览和任务总览是一个东西一个功能"): 任務總覽 was
// torn out as an independent data-task-overview-open branch and now shares the exact same
// data-task-member="all" trigger/branch as the Honnmono-all row (see scripts/test-nr-task-1.mjs
// G-task-18) — so the old "count >= 2 call sites" proxy for "both entry points leave task detail"
// no longer holds: there is now exactly one call site, shared by both rows, not two duplicated
// ones. The underlying requirement is unchanged (still verified below), only the count flips.
assert.equal((controllerSource.match(/leaveTaskDetailForNavigation\(\);/g) ?? []).length, 1,
  "任務總覽 and Honnmono-all now share one memberTrigger branch, so this is called from a single shared site instead of being duplicated per entry point");
const memberTriggerBlock = controllerSource.slice(
  controllerSource.indexOf('const memberTrigger = event.target.closest("[data-task-member]");'),
  controllerSource.indexOf("const overviewToggle")
);
assert.match(memberTriggerBlock, /leaveTaskDetailForNavigation\(\);/,
  "the shared data-task-member branch (both 任務總覽 and Honnmono-all route through it) must still leave task detail before switching");
assert.match(rlsSource, /OLD\.creator_employee_id = public\.current_employee_id\(\)/,
  "field hardening trigger must grant full edits to the creator");
assert.match(rlsSource, /creator_employee_id = public\.current_employee_id\(\)/,
  "tasks_update RLS must admit the creator");

console.log("TP-tasks-2 batch 1 contracts: PASS (navigation, title-only, completed expansion, Jack creator edit)");
