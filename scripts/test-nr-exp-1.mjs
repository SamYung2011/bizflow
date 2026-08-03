import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeExpenseRows } from "../root-site/bizflow/expense-model.js";

const paidAt = "2026-08-03T15:29:30.000Z";
const [paidRow] = normalizeExpenseRows([{
  id: "expense-paid",
  employee_id: "employee-1",
  expense_date: "2026-08-01",
  amount: 88,
  currency: "HKD",
  category: "交通",
  paid: true,
  paid_at: paidAt
}]);
assert.equal(paidRow.paidAt, paidAt, "paid_at must survive normalization for the payment date display");

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [expenseSource, writesSource, cssSource, rlsSource] = await Promise.all([
  read("root-site/bizflow/expense.js"),
  read("root-site/data/live-expense-writes.js"),
  read("root-site/bizflow/expense.css"),
  read("migrations/088_expense_rls_owner_admin.sql")
]);

// G-exp-3: the paid date is read from the normalized model and rendered under the paid state.
assert.match(expenseSource, /row\.paidAt[^]*paidOn/);
assert.match(cssSource, /\.expense-payment-cell small/);

// G-exp-4: only the owner of a pending row gets the edit affordance; admin status does not widen it.
assert.match(expenseSource, /const canEdit = row\.employeeId === ownerKey && row\.status === "pending"/);
assert.match(expenseSource, /data-expense-edit=/);
assert.match(expenseSource, /draftFromExpenseRow\(row\)/);
assert.match(writesSource, /export async function updateLiveExpense\(/);
const updateStart = writesSource.indexOf("export async function updateLiveExpense");
const updateEnd = writesSource.indexOf("async function updateExpenseRow", updateStart);
const updateBlock = writesSource.slice(updateStart, updateEnd);
assert.match(updateBlock, /\.eq\("employee_id", currentUser\.employeeId\)/);
assert.match(updateBlock, /\.eq\("status", "pending"\)/);
const updatePatch = updateBlock.slice(updateBlock.indexOf("updateExpenseRow"), updateBlock.indexOf("}, (query)"));
for (const forbidden of ["status:", "paid:", "paid_at:", "reviewed_by:", "reviewed_at:"]) {
  assert.doesNotMatch(updatePatch, new RegExp(forbidden), `self edit patch must not write ${forbidden}`);
}
assert.match(rlsSource, /CREATE POLICY exp_reimb_update_self[^]*employee_id = public\.current_employee_id\(\)[^]*status = 'pending'[^]*WITH CHECK[^]*employee_id = public\.current_employee_id\(\)[^]*status = 'pending'/);

// G-exp-7: selecting files starts one upload per file and every result remains visible.
const changeStart = expenseSource.indexOf("async function onExpenseChange");
const changeEnd = expenseSource.indexOf("async function onExpenseSubmit", changeStart);
const changeBlock = expenseSource.slice(changeStart, changeEnd);
assert.match(changeBlock, /uploadLiveExpenseReceipt\(receipt\.file\)/);
assert.match(changeBlock, /receipt\.status = "uploaded"/);
assert.match(changeBlock, /receipt\.status = "failed"/);
assert.match(expenseSource, /data-expense-upload-result=/);
assert.match(expenseSource, /receiptProgress/);
assert.match(writesSource, /export async function deleteLiveExpenseReceiptUploads\(/);
assert.match(expenseSource, /await discardNewDraftReceipts\(draft\)[^]*saveFailedRolledBack/);
assert.match(writesSource, /if \(uploaded\.length\)[^]*expense-receipts[^]*remove\(uploaded\.map/,
  "the original submit-time upload path must retain storage rollback");

// G-exp-8: writes invalidate the table, immediately refresh, and subscribe for other-tab changes.
for (const helper of ["createLiveExpense", "updateLiveExpense", "approveLiveExpense", "rejectLiveExpense", "markLiveExpensePaid", "deleteLiveExpense"]) {
  assert.match(writesSource, new RegExp(`(?:export async function ${helper}|function ${helper})`));
}
assert.match(expenseSource, /attachLiveSnapshotRefresh\(\{/);
assert.match(expenseSource, /snapshots: EXPENSE_LIVE_SNAPSHOTS/);
assert.match(expenseSource, /tables: EXPENSE_LIVE_TABLES/);
assert.match(expenseSource, /await refreshExpenseRows\(mountId, scope\)/);

// All new visible copy exists in each supported language block.
for (const key of [
  "paidOn",
  "edit",
  "editModalTitle",
  "receiptProgress",
  "receiptStatusUploading",
  "receiptStatusUploaded",
  "receiptStatusFailed",
  "receiptCleanupFailed",
  "saveFailedRolledBack",
  "save"
]) {
  assert.equal((expenseSource.match(new RegExp(`\\b${key}:`, "g")) || []).length, 3, `${key} must have zh/en/fr copy`);
}

console.log("NR-exp-1 contracts: PASS (paid date, owner-pending edit, immediate receipt uploads, live refresh)");
