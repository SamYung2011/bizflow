import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { taskBoardFingerprint } from "../root-site/team/task-board-read-state.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import { canEditSubtaskTitle, canManageTaskSubtasks } from "../root-site/team/tasks-model.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const person = (id, flags = {}) => ({
  id,
  name: id,
  isSuperAdmin: false,
  isAdminOfActive: false,
  ...flags
});

const subtask = {
  id: "subtask-1",
  title: "跟進文件",
  content: "",
  owner: "Direct Assignee",
  priority: "low",
  status: "inProgress",
  done: false,
  due: "",
  startDate: "",
  createdAt: "2026/07/21",
  completedAt: "",
  creator: "Creator",
  creatorId: "employee-creator",
  parentId: "parent-1",
  departmentId: "department-1",
  visibility: "department",
  visibilityDepartment: "Sales",
  requiresReview: true,
  approvedAt: "",
  approvedBy: "",
  attachments: [],
  attachmentCount: 0,
  countBadge: "",
  assignees: [{ employeeId: "employee-assignee", name: "Direct Assignee", completedAt: null, abandonedAt: null }],
  feedback: [],
  subtasks: [],
  members: ["Direct Assignee"]
};
const parent = {
  ...subtask,
  id: "parent-1",
  title: "父任務",
  owner: "Creator",
  creator: "Creator",
  creatorId: "employee-creator",
  parentId: null,
  assignees: [{ employeeId: "employee-creator", name: "Creator", completedAt: null, abandonedAt: null }],
  members: ["Creator"],
  subtasks: [subtask]
};
const members = [
  { id: "employee-creator", name: "Creator", dept: "member" },
  { id: "employee-assignee", name: "Direct Assignee", dept: "member" },
  { id: "employee-outsider", name: "Outside Department", dept: "member" }
];

function detailFor(currentUser, permissions = {}, overrides = {}) {
  return renderTaskDetail({
    state: {
      detailOpen: true,
      selectedTaskId: parent.id,
      detailTab: "content",
      attachmentPreview: null,
      tasks: [parent, subtask],
      members,
      departments: [{ id: "department-1", name: "Sales", memberIds: ["employee-creator", "employee-assignee"] }],
      currentUser,
      permissions: {
        canCreate: true,
        canValidate: false,
        canDeleteOthers: false,
        canEditOthers: false,
        ...permissions
      },
      liveReadOnly: true,
      liveTaskWrites: true,
      writeBusy: false,
      feedbackDraft: { message: "", attachments: [] },
      feedbackError: "",
      feedbackEditingId: null,
      feedbackMenuId: null,
      subtaskAddDraft: { title: "", assigneeId: "" },
      subtaskEditingId: null,
      subtaskEditDraft: "",
      ...overrides
    },
    helpers
  });
}

assert.equal(canManageTaskSubtasks(parent, person("employee-creator")), true);
assert.equal(canManageTaskSubtasks(parent, person("employee-admin", { isAdminOfActive: true })), true);
assert.equal(canManageTaskSubtasks(parent, person("employee-editor")), false,
  "can_edit_others_tasks must not grant structural add/delete rights");
assert.equal(canEditSubtaskTitle(subtask, person("employee-editor"), { canEditOthers: true }), true);
assert.equal(canEditSubtaskTitle(subtask, person("employee-assignee"), {}), false);

const creatorHtml = detailFor(person("employee-creator"));
assert.match(creatorHtml, /data-task-subtask-form data-parent-task-id="parent-1"/,
  "parent creator gets the add-subtask form");
assert.match(creatorHtml, /data-task-subtask-delete="subtask-1"/,
  "parent creator gets subtask deletion");
assert.match(creatorHtml, /data-task-subtask-edit="subtask-1"/,
  "the inherited creator gets the 083 title edit path");
assert.match(creatorHtml, /<option value="employee-creator">Creator<\/option>/,
  "self-assignment remains available when the creator is valid in the parent scope");
assert.match(creatorHtml, /<option value="employee-assignee">Direct Assignee<\/option>/);
assert.doesNotMatch(creatorHtml, /employee-outsider/,
  "the assignee picker must exclude employees outside the parent department");

const assigneeHtml = detailFor(person("employee-assignee"));
assert.match(assigneeHtml, /data-task-subtask-toggle="subtask-1"(?![^>]* disabled)/,
  "strict completion remains available to the direct subtask assignee");
assert.doesNotMatch(assigneeHtml, /data-task-subtask-form/);
assert.doesNotMatch(assigneeHtml, /data-task-subtask-delete=/);
assert.doesNotMatch(assigneeHtml, /data-task-subtask-edit=/);

const editorHtml = detailFor(person("employee-editor"), { canEditOthers: true });
assert.match(editorHtml, /data-task-subtask-edit="subtask-1"/);
assert.doesNotMatch(editorHtml, /data-task-subtask-form/);
assert.doesNotMatch(editorHtml, /data-task-subtask-delete=/);

const editingHtml = detailFor(person("employee-editor"), { canEditOthers: true }, {
  subtaskEditingId: subtask.id,
  subtaskEditDraft: "更新後標題"
});
assert.match(editingHtml, /data-task-subtask-edit-form="subtask-1"/);
assert.match(editingHtml, /name="subtaskTitle"[^>]*value="更新後標題"/);
assert.doesNotMatch(editingHtml, /name="assigneeId"/,
  "v1 editing is title-only; reassignment stays delete-and-recreate");

assert.notEqual(taskBoardFingerprint(parent), taskBoardFingerprint({
  ...parent,
  subtasks: [{ ...subtask, title: "標題已改" }]
}), "subtask title writes must change the approved board fingerprint");
assert.notEqual(taskBoardFingerprint(parent), taskBoardFingerprint({ ...parent, subtasks: [] }),
  "subtask deletion must change the approved board fingerprint");

const [migration, writes, controller, tasksSource, detailSource] = await Promise.all([
  readFile(new URL("../migrations/094_team_subtask_writes.sql", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-detail.js", import.meta.url), "utf8")
]);

for (const functionName of ["create_employee_subtask", "update_employee_subtask_title", "delete_employee_subtask"]) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.ok(start >= 0, `${functionName} migration missing`);
  const end = migration.indexOf("$$;", start);
  const block = migration.slice(start, end);
  assert.match(block, /SECURITY INVOKER/, `${functionName} must run under the caller's RLS`);
  assert.doesNotMatch(block, /SECURITY DEFINER/, `${functionName} must not bypass RLS`);
}

const insertPolicy = migration.slice(
  migration.indexOf("CREATE POLICY tasks_insert"),
  migration.indexOf("-- can_delete_others_tasks")
);
assert.match(insertPolicy, /parent_task_id IS NULL[\s\S]*creator_employee_id = public\.current_employee_id\(\)/,
  "the legacy creator=self insert branch must be top-level-only");
assert.match(insertPolicy, /parent_task_id IS NOT NULL[\s\S]*public\.can_insert_task_subtask/,
  "every child insert must pass inherited parent-field validation");

const createRpc = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.create_employee_subtask"),
  migration.indexOf("CREATE OR REPLACE FUNCTION public.update_employee_subtask_title")
);
assert.match(migration, /parent\.creator_employee_id = public\.current_employee_id\(\)[\s\S]*public\.is_member_of_company\(parent\.company_id\)/,
  "a former company member must not retain structural rights merely because they once created the parent");
assert.match(createRpc, /public\.can_manage_task_subtasks\(v_parent\.id\)/);
assert.match(createRpc, /public\.is_valid_task_assignee\(v_parent\.id, p_assignee_id\)/,
  "082 company/department assignee scope must remain authoritative");
assert.match(createRpc, /v_parent\.creator_employee_id,[\s\S]*v_parent\.needs_approval,[\s\S]*v_parent\.company_id,[\s\S]*v_parent\.department_id/,
  "child creator, approval and scope must inherit from the parent");
assert.match(createRpc, /INSERT INTO public\.task_assignees \(task_id, employee_id\)[\s\S]*v_subtask\.id, p_assignee_id/,
  "the RPC must atomically create exactly one direct assignment");

const editRpc = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.update_employee_subtask_title"),
  migration.indexOf("CREATE OR REPLACE FUNCTION public.delete_employee_subtask")
);
assert.match(editRpc, /SET title = v_title/);
assert.doesNotMatch(editRpc, /task_assignees|p_assignee_id/,
  "title editing must not grow an unapproved reassignment path");
assert.match(migration, /delete_employee_subtask[\s\S]*public\.can_manage_task_subtasks\(v_subtask\.parent_task_id\)/);

for (const [exportName, rpcName] of [
  ["createLiveSubtask", "create_employee_subtask"],
  ["updateLiveSubtaskTitle", "update_employee_subtask_title"],
  ["deleteLiveSubtask", "delete_employee_subtask"]
]) {
  assert.match(writes, new RegExp(`export async function ${exportName}\\b[\\s\\S]*?rpc\\("${rpcName}"`));
}
assert.match(writes, /invalidateTaskReads\("employee_tasks", "task_assignees"\)/);
assert.match(controller, /canManageTaskSubtasks\(parent, state\.currentUser\)/);
assert.match(controller, /canEditSubtaskTitle\(subtask, state\.currentUser, state\.permissions\)/);
assert.match(controller, /refreshTaskBoardReadState\?\.\(\)/,
  "local CRUD echoes must immediately feed the existing board fingerprint tracker");
assert.match(tasksSource, /taskBoardReadTracker\?\.refresh\(state\.tasks\)/);
assert.match(tasksSource, /state\.subtaskEditingId[\s\S]*event\.stopImmediatePropagation\(\)/,
  "Escape in title edit must cancel editing instead of closing the whole detail view");
assert.match(detailSource, /select name="assigneeId"/);
assert.doesNotMatch(detailSource, /data-task-subtask-edit-form[\s\S]{0,500}select name="assigneeId"/,
  "the rendered edit form must remain title-only");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of [
    "tasks.detail.editSubtask",
    "tasks.detail.saveSubtask",
    "tasks.detail.cancelSubtask",
    "tasks.write.subtaskCreated",
    "tasks.write.subtaskSaved",
    "tasks.write.subtaskDeleted"
  ]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}

console.log("SU-sub-1 contracts: PASS (atomic RLS writes, strict structure rights, title-only edit, board fingerprint linkage)");
