import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeExpenseRows } from "../root-site/bizflow/expense-model.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";

const helpers = {
  lang: "zh",
  escapeHtml: (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;"),
  icon: (name) => `<svg data-icon="${name}"></svg>`
};

const normalized = normalizeExpenseRows([
  { id: "live", expense_date: "2026-07-20", amount: 10, category: "餐飲" },
  { id: "demo", expense_date: "2026-07-20", amount: 10, category: "餐飲", local: true }
]);
assert.equal(normalized[0].local, false, "live rows stay explicitly non-local");
assert.equal(normalized[1].local, true, "the model must preserve demo/local row provenance instead of hardcoding false");

const waitingTask = {
  id: "waiting-task",
  title: "Waiting task",
  content: "",
  priority: "high",
  status: "inProgress",
  done: false,
  due: "2026/07/20",
  startDate: "",
  completedAt: "",
  creator: "Creator",
  creatorId: "employee-creator",
  owner: "Assignee",
  members: ["Assignee"],
  assignees: [{ employeeId: "employee-assignee", name: "Assignee", completedAt: "2026/07/20 18:00", abandonedAt: null }],
  subtasks: [],
  feedback: [],
  attachments: [],
  attachmentCount: 0,
  requiresReview: true,
  approvedAt: "",
  approvedBy: "",
  visibility: "team",
  visibilityDepartment: ""
};

function detailState(currentUser, permissions, overrides = {}) {
  return {
    detailOpen: true,
    selectedTaskId: waitingTask.id,
    detailTab: "content",
    attachmentPreview: null,
    tasks: [waitingTask],
    members: [],
    currentUser,
    permissions: { canCreate: false, canValidate: false, canDeleteOthers: false, ...permissions },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    feedbackDraft: { message: "", attachments: [] },
    feedbackError: "",
    ...overrides
  };
}

const validatorDetail = renderTaskDetail({
  state: detailState({ id: "employee-validator", name: "Validator" }, { canValidate: true }),
  helpers
});
assert.match(validatorDetail, /data-task-approve="waiting-task"(?![^>]* disabled)/,
  "a validator must get an enabled live approval button even though the snapshot is read-only");

const creatorDetail = renderTaskDetail({
  state: detailState({ id: "employee-creator", name: "Creator" }, {}),
  helpers
});
assert.match(creatorDetail, /data-task-approve="waiting-task"(?![^>]* disabled)/,
  "the task creator may approve their waiting task through the independent write path");

const unrelatedDetail = renderTaskDetail({
  state: detailState({ id: "employee-other", name: "Other" }, {}),
  helpers
});
assert.doesNotMatch(unrelatedDetail, /data-task-approve=/,
  "an unrelated employee without validation permission must not see approval");

const busyDetail = renderTaskDetail({
  state: detailState({ id: "employee-validator", name: "Validator" }, { canValidate: true }, { writeBusy: true }),
  helpers
});
assert.match(busyDetail, /data-task-approve="waiting-task"[^>]* disabled[^>]*aria-disabled="true"/,
  "approval must lock while another task write is in flight");

const [
  expenseSource,
  expenseWritesSource,
  taskSource,
  taskControllerSource,
  taskWritesSource,
  expenseRlsSource,
  taskRlsSource
] = await Promise.all([
  readFile(new URL("../root-site/bizflow/expense.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-expense-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/088_expense_rls_owner_admin.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/083_team_task_field_hardening.sql", import.meta.url), "utf8")
]);

for (const name of ["approveLiveExpense", "rejectLiveExpense", "markLiveExpensePaid", "deleteLiveExpense"]) {
  assert.match(expenseWritesSource, new RegExp(`export async function ${name}\\(`), `${name} write is missing`);
  assert.match(expenseSource, new RegExp(`${name}\\(`), `${name} is not wired to the finance page`);
}
assert.doesNotMatch(expenseSource, /if \(!row\.local\) return/,
  "real reimbursement rows must not be replaced by a dash in the action column");
assert.doesNotMatch(expenseSource, /findLocalRow/,
  "live actions must resolve the real row, not local-only rows");
assert.match(expenseWritesSource, /status: "approved"[^]*reviewed_by: currentUser\.employeeId[^]*reviewed_at: reviewedAt/);
assert.match(expenseWritesSource, /status: "rejected"[^]*reject_reason:/);
assert.match(expenseWritesSource, /query\.eq\("status", "approved"\)\.eq\("paid", false\)/,
  "paid writes must only accept an approved, currently-unpaid row");
assert.match(expenseWritesSource, /delete\(\)[^]*select\("id"\)[^]*single\(\)/,
  "RLS-hidden or missing deletes must fail visibly instead of succeeding with zero rows");

assert.match(taskWritesSource, /export async function approveLiveTask\(taskId\)/);
const approvalWrite = taskWritesSource.slice(
  taskWritesSource.indexOf("export async function approveLiveTask"),
  taskWritesSource.indexOf("export async function setLiveSubtaskCompletion")
);
assert.match(approvalWrite, /assignees\.every\(\(row\) => row\.completed_at != null \|\| row\.abandoned_at != null\)/,
  "approval must reject a task whose assignees have not all settled");
assert.match(approvalWrite, /assignees\.some\(\(row\) => row\.completed_at != null\) \? "done" : "abandoned"/,
  "approval must preserve all-abandoned semantics");
for (const field of ["status", "completed_at", "approved_at", "approved_by"]) {
  assert.match(approvalWrite, new RegExp(`${field}[,:]`), `approval patch is missing ${field}`);
}
assert.match(taskControllerSource, /if \(state\.liveTaskWrites\) await approveTask\(task\)/,
  "the detail button must choose the independent live approval callback");
assert.match(taskSource, /approveTask: approveWaitingTask/);
assert.match(taskSource, /await approveLiveTask\(task\.id\)/);

assert.match(expenseRlsSource, /CREATE POLICY exp_reimb_update_self[^]*FOR UPDATE TO authenticated/);
assert.match(expenseRlsSource, /CREATE POLICY exp_reimb_delete_self[^]*FOR DELETE TO authenticated/);
assert.match(expenseRlsSource, /CREATE POLICY exp_reimb_admin_all[^]*FOR ALL TO authenticated[^]*can_admin_expenses/,
  "migration 088 must continue to own admin update/delete authorization");
assert.match(taskRlsSource, /has_company_permission\(company_id, 'can_validate_task'\)/);
assert.match(taskRlsSource, /validators can only update status\/completed_at\/approved_at\/approved_by/);

console.log("Empty-shell batch 3 contracts: PASS (live expenses, independent task approval, existing RLS)");
