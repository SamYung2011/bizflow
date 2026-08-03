import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskSubmitDialog } from "../root-site/team/tasks-submit.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import {
  buildTaskSubtaskEcho,
  createTaskSubmitSubtasks,
  normalizeTaskSubmitSubtasks
} from "../root-site/team/tasks-submit-subtasks.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const helen = { id: "employee-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", name: "Jack", dept: "member" };
const sam = { id: "employee-sam", name: "Sam", dept: "member" };
const members = [helen, jack, sam];

function submitState(overrides = {}) {
  return {
    submitOpen: true,
    submitMode: "create",
    submitDraft: {
      title: "CLAUDE-驗收-NR3",
      content: "",
      priority: "high",
      departmentId: "",
      owner: helen.name,
      requiresReview: "no",
      memberIds: [jack.id],
      memberQuery: "",
      memberMenuOpen: false,
      startDate: "",
      due: "2026-08-04",
      attachments: [],
      subtasks: [
        { id: "row-inherit", title: "默認繼承", assigneeId: "" },
        { id: "row-jack", title: "手選 Jack", assigneeId: jack.id }
      ]
    },
    submitCanAssignOthers: true,
    submitOriginalDepartmentId: "",
    currentUser: helen,
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    submitError: "",
    ...overrides
  };
}

const createHtml = renderTaskSubmitDialog({
  state: submitState(),
  data: { members, departments: [] },
  helpers
});
assert.match(createHtml, /data-task-submit-subtasks/);
assert.match(createHtml, /data-task-submit-subtask-add/);
assert.match(createHtml, /data-task-submit-subtask-row="row-inherit"[\s\S]*data-task-submit-subtask-title="row-inherit"[^>]*value="默認繼承"/);
assert.match(createHtml, /data-task-submit-subtask-assignee="row-inherit"[\s\S]*<option value="" selected>沿用父任務 · Helen<\/option>/,
  "an untouched child row must visibly inherit the parent's first assignee");
assert.match(createHtml, /data-task-submit-subtask-assignee="row-jack"[\s\S]*<option value="employee-jack" selected>Jack<\/option>/,
  "a child row may select one different eligible assignee");
assert.match(createHtml, /data-task-submit-subtask-remove="row-jack"/);
assert.doesNotMatch(createHtml.match(/data-task-submit-subtask-title="row-inherit"[^>]*>/)?.[0] ?? "", /\brequired\b/,
  "blank child rows are stripped at submit time instead of invalidating the parent form");

const ordinaryHtml = renderTaskSubmitDialog({
  state: submitState({ submitDraft: { ...submitState().submitDraft, subtasks: [] } }),
  data: { members, departments: [] },
  helpers
});
assert.match(ordinaryHtml, /data-task-submit-subtasks/);
assert.doesNotMatch(ordinaryHtml, /data-task-submit-subtask-row=/,
  "ordinary parent-only task creation remains unchanged");
const editHtml = renderTaskSubmitDialog({
  state: submitState({ submitMode: "edit" }),
  data: { members, departments: [] },
  helpers
});
assert.doesNotMatch(editHtml, /data-task-submit-subtasks/,
  "editing stays outside NR-task-3 scope");
const restrictedHtml = renderTaskSubmitDialog({
  state: submitState({ submitCanAssignOthers: false }),
  data: { members, departments: [] },
  helpers
});
const restrictedSubtasks = restrictedHtml.match(/<section class="form-task-submit__subtasks"[\s\S]*?<\/section>/)?.[0] ?? "";
assert.match(restrictedSubtasks, /data-task-submit-subtask-assignee="row-jack"[^>]* disabled/);
assert.doesNotMatch(restrictedSubtasks, /option value="employee-jack"/,
  "subtask choices must keep the parent's can-assign-others permission boundary");

const normalized = normalizeTaskSubmitSubtasks([
  { id: "one", title: "  inherited  ", assigneeId: "" },
  { id: "blank", title: "   ", assigneeId: jack.id },
  { id: "two", title: "manual", assigneeId: jack.id },
  { id: "stale", title: "stale falls back", assigneeId: "employee-outside" }
], { parentAssigneeId: helen.id, eligibleMembers: members });
assert.deepEqual(normalized, [
  { id: "one", title: "inherited", assigneeId: helen.id },
  { id: "two", title: "manual", assigneeId: jack.id },
  { id: "stale", title: "stale falls back", assigneeId: helen.id }
]);

const calls = [];
const outcome = await createTaskSubmitSubtasks({
  parentTaskId: "parent-1",
  subtasks: [
    { id: "first", title: "First child", assigneeId: helen.id },
    { id: "second", title: "Second child", assigneeId: jack.id },
    { id: "third", title: "Must not run", assigneeId: sam.id }
  ],
  createSubtask: async (payload) => {
    calls.push(payload);
    if (payload.title === "Second child") throw new Error("RPC failed");
    return { task: { id: "child-1", title: payload.title }, assignee: { employee_id: payload.assigneeId } };
  }
});
assert.deepEqual(calls.map((call) => call.title), ["First child", "Second child"],
  "children are created sequentially and stop at the first failure");
assert.deepEqual(outcome.created.map((entry) => entry.result.task.id), ["child-1"]);
assert.equal(outcome.failure.subtask.title, "Second child");

const parent = {
  id: "parent-1",
  creator: "Helen",
  creatorId: helen.id,
  departmentId: "",
  visibility: "team",
  visibilityDepartment: "",
  requiresReview: false
};
const echo = buildTaskSubtaskEcho({
  parent,
  subtask: normalized[1],
  member: jack,
  result: { task: { id: "child-echo", title: "manual" } },
  localId: "unused",
  timestamp: "2026/08/03 23:59"
});
assert.equal(echo.parentId, parent.id);
assert.deepEqual(echo.assignees, [{ employeeId: jack.id, name: jack.name, completedAt: null, abandonedAt: null }],
  "the current RPC contract stays explicitly single-assignee");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of [
    "tasks.submit.subtasks",
    "tasks.submit.addSubtask",
    "tasks.submit.subtaskTitle",
    "tasks.submit.subtaskAssignee",
    "tasks.submit.subtaskInherit",
    "tasks.submit.removeSubtask",
    "tasks.write.subtaskCreatePartial"
  ]) assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
}

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [tasksSource, submitSource, controllerSource, cssSource] = await Promise.all([
  read("root-site/team/tasks.js"),
  read("root-site/team/tasks-submit.js"),
  read("root-site/team/tasks-domain-controller.js"),
  read("root-site/team/tasks.css")
]);
assert.match(tasksSource, /const result = await createLiveTask\(\{[\s\S]*?const subtaskOutcome = await createTaskSubmitSubtasks\(\{/,
  "live submit must commit the parent before creating children");
assert.match(tasksSource, /state\.writeError = "tasks\.write\.subtaskCreatePartial";[\s\S]*?title: subtaskOutcome\.failure\.subtask\.title/,
  "a child failure must identify the failed title without rolling back the parent");
assert.match(tasksSource, /const mockSubtaskOutcome = await createTaskSubmitSubtasks\(\{/,
  "mock creation must use the same normalized child sequence");
assert.match(tasksSource, /normalizeTaskSubmitSubtasks\(state\.submitDraft\.subtasks/);
assert.match(tasksSource, /state\.submitCanAssignOthers[\s\S]*?eligibleMembers\.filter\(\(member\) => member\.id === state\.currentUser\.id\)/,
  "submit-time normalization must enforce can-assign-others even if draft state is tampered");
assert.match(submitSource, /if \(state\.submitMode === "edit"\) return "";/);
assert.match(controllerSource, /buildTaskSubtaskEcho/,
  "new-task and existing detail-add flows must share one local echo model");
assert.match(cssSource, /\.form-task-submit__subtask-row\s*\{/);

console.log("NR-task-3 contracts: PASS (create rows, inherited/manual single assignee, blank strip, sequential live/mock and partial failure)");
