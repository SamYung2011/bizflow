import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeExpenseRows } from "../root-site/bizflow/expense-model.js";

// ---- G-exp-6: a joined employee_name reaches the model; a missing one still falls back to "—" ----
const [namedRow] = normalizeExpenseRows([{
  id: "expense-named",
  employee_id: "employee-1",
  expense_date: "2026-08-04",
  amount: 88.88,
  currency: "RMB",
  category: "餐飲",
  employee_name: "claude測試"
}]);
assert.equal(namedRow.employee, "claude測試", "a joined employee_name must render instead of the — fallback");

const [orphanRow] = normalizeExpenseRows([{
  id: "expense-orphan",
  employee_id: "deleted-employee",
  expense_date: "2026-08-04",
  amount: 1,
  currency: "RMB",
  category: "其他",
  employee_name: null
}]);
assert.equal(orphanRow.employee, "—", "a null employee_name (no matching employee row) must still fall back to —, not an empty string");

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [expenseSource, writesSource, cssSource, adminSnapshotsSource, snapshotsSource, dependenciesSource, cacheSource, rlsSource] = await Promise.all([
  read("root-site/bizflow/expense.js"),
  read("root-site/data/live-expense-writes.js"),
  read("root-site/bizflow/expense.css"),
  read("root-site/data/live-admin-snapshots.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/data/live-snapshot-dependencies.js"),
  read("root-site/data/live-table-cache.js"),
  read("migrations/088_expense_rls_owner_admin.sql")
]);

// ---- G-exp-6: the snapshot builder joins employees instead of returning raw rows ----
assert.match(adminSnapshotsSource, /export async function buildExpenseSnapshot\(\)/);
assert.match(adminSnapshotsSource, /allRows\("expense_reimbursements", "created_at", false\)/);
assert.match(adminSnapshotsSource, /allRows\("employees", "created_at"\)/);
assert.match(adminSnapshotsSource, /employee_name: employeeById\.get\(row\.employee_id\)\?\.name \?\? null/);
assert.match(snapshotsSource, /"expense\.json": buildExpenseSnapshot,/);
assert.doesNotMatch(snapshotsSource, /"expense\.json": \(\) => buildSimpleRowsSnapshot/,
  "expense.json must no longer use the un-joined simple-rows builder");
assert.match(dependenciesSource, /"expense\.json": \["expense_reimbursements", "employees"\]/,
  "employees must be a snapshot dependency so a name edit also refreshes the expense page");
assert.match(cacheSource, /\["expense\.json", 1\]/,
  "the snapshot contract generation must bump so cached pre-join payloads (without employee_name) are invalidated");

// ---- G-exp-5: revert is only reachable from an approved+unpaid row and clears the whole review trail ----
assert.match(writesSource, /export async function revertLiveExpenseToPending\(/);
const revertStart = writesSource.indexOf("export async function revertLiveExpenseToPending");
const revertEnd = writesSource.indexOf("export async function markLiveExpensePaid", revertStart);
const revertBlock = writesSource.slice(revertStart, revertEnd);
assert.match(revertBlock, /status: "pending"/);
assert.match(revertBlock, /reviewed_by: null/);
assert.match(revertBlock, /reviewed_at: null/);
assert.match(revertBlock, /reject_reason: null/);
assert.match(revertBlock, /paid: false/);
assert.match(revertBlock, /paid_at: null/);
assert.match(revertBlock, /\.eq\("status", "approved"\)\.eq\("paid", false\)/,
  "revert must only match an approved+unpaid row — illegal from pending, rejected, or paid");

// ---- G-exp-1: undo-payment is only reachable from an approved+paid row and leaves the approval untouched ----
assert.match(writesSource, /export async function unmarkLiveExpensePaid\(/);
const unpayStart = writesSource.indexOf("export async function unmarkLiveExpensePaid");
const unpayEnd = writesSource.indexOf("export async function deleteLiveExpense", unpayStart);
const unpayBlock = writesSource.slice(unpayStart, unpayEnd);
assert.match(unpayBlock, /paid: false/);
assert.match(unpayBlock, /paid_at: null/);
assert.match(unpayBlock, /\.eq\("status", "approved"\)\.eq\("paid", true\)/,
  "undo-payment must only match an approved+paid row — illegal once already unpaid");
for (const forbidden of ["status:", "reviewed_by:", "reviewed_at:", "reject_reason:"]) {
  assert.doesNotMatch(unpayBlock, new RegExp(forbidden), `undo-payment patch must not touch ${forbidden} — the approval trail stays intact`);
}

// ---- non-admin cannot reach either action: UI gates on isAdmin in both render and click-handler layers ----
assert.match(expenseSource, /const canRevert = isAdmin && row\.status === "approved" && !row\.paid;/,
  "renderActions must gate the revert button on isAdmin");
assert.match(expenseSource, /const canUnpay = isAdmin && row\.status === "approved";/,
  "renderPayment must gate the undo-payment button on isAdmin (row.paid is already true in this branch)");
const revertHandlerStart = expenseSource.indexOf('const revert = event.target.closest("[data-expense-revert]");');
const revertHandlerEnd = expenseSource.indexOf("const pay = event.target.closest", revertHandlerStart);
assert.match(expenseSource.slice(revertHandlerStart, revertHandlerEnd),
  /const canRevert = row && isAdmin && row\.status === "approved" && !row\.paid;/);
const unpayHandlerStart = expenseSource.indexOf('const unpay = event.target.closest("[data-expense-unpay]");');
const unpayHandlerEnd = expenseSource.indexOf("const remove = event.target.closest", unpayHandlerStart);
assert.match(expenseSource.slice(unpayHandlerStart, unpayHandlerEnd),
  /const canUnpay = row && isAdmin && row\.status === "approved" && row\.paid;/);
// Server-side backstop behind the UI gate: admin keeps its unconditional FOR ALL policy, and the
// owner-only policy is still pending-only, so no non-admin (not even the row's own submitter) has
// an RLS path to write an approved or paid row — only can_admin_expenses() does.
assert.match(rlsSource, /CREATE POLICY exp_reimb_admin_all ON public\.expense_reimbursements[^]*?FOR ALL TO authenticated[^]*?USING \(public\.has_bizflow_main_access\(\) AND public\.can_admin_expenses\(\)\)[^]*?WITH CHECK \(public\.has_bizflow_main_access\(\) AND public\.can_admin_expenses\(\)\)/,
  "admin policy must stay an unconditional FOR ALL — this is why no new migration is needed for G-exp-1/5");
assert.match(rlsSource, /CREATE POLICY exp_reimb_update_self[^]*status = 'pending'[^]*WITH CHECK[^]*status = 'pending'/,
  "the owner-only policy must remain pending-only so non-admins have no RLS path to approved/paid rows");

// ---- both actions confirm in-page before writing, reusing the existing confirm-dialog component ----
assert.match(expenseSource, /await confirmInPage\(t\(currentHelpers\?\.lang \?\? "zh", "revertConfirm"\)\)/);
assert.match(expenseSource, /await confirmInPage\(t\(currentHelpers\?\.lang \?\? "zh", "unpayConfirm"\)\)/);

// ---- buttons reuse the existing neutral .expense-action token class; no new hardcoded colors ----
assert.match(expenseSource, /data-expense-revert="\$\{escapeHtml\(row\.id\)\}"/);
assert.match(expenseSource, /data-expense-unpay="\$\{escapeHtml\(row\.id\)\}"/);
assert.doesNotMatch(cssSource, /expense-action--revert|expense-action--unpay/,
  "no new color-modifier classes were introduced — revert/unpay reuse the base .expense-action neutral style");

// ---- all new visible copy exists in each supported language block ----
for (const key of ["revert", "revertConfirm", "unpay", "unpayConfirm"]) {
  assert.equal((expenseSource.match(new RegExp(`\\b${key}:`, "g")) || []).length, 3, `${key} must have zh/en/fr copy`);
}

// ---- regression guard: the pre-existing write functions and the live-refresh pipeline stay intact ----
for (const helper of ["createLiveExpense", "updateLiveExpense", "approveLiveExpense", "rejectLiveExpense", "markLiveExpensePaid", "deleteLiveExpense"]) {
  assert.match(writesSource, new RegExp(`export async function ${helper}\\(`));
}
assert.match(expenseSource, /tables: EXPENSE_LIVE_TABLES/,
  "revert/unpay must ride the existing expense_reimbursements realtime pipeline, not a new one");
const liveWriteStart = expenseSource.indexOf("async function performLiveExpenseWrite");
const liveWriteEnd = expenseSource.indexOf("async function onExpenseClick", liveWriteStart);
assert.match(expenseSource.slice(liveWriteStart, liveWriteEnd), /applyResult\(result\);\s*rerender\(\);\s*try \{\s*await refreshExpenseRows/,
  "expense status badges must rerender from the optimistic result before the snapshot refresh finishes");

console.log("expense-admin-1 contracts: PASS (withdraw approval, undo payment, admin snapshot employee join)");
