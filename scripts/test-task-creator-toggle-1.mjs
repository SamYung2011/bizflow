import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderTaskActionPopover } from "../root-site/team/tasks-actions.js";
import { taskCompletionForMember } from "../root-site/team/tasks-model.js";

// G-task-3 contracts (batch3, 2026-08-05): creator complete = whole task complete, both directions
// toggle, all inside the existing … menu (no card checkbox — the Figma tear-down of f91c063 holds).
// Write-path and RLS layers are pinned as source contracts, same style as test-nr-task-1.mjs /
// test-expense-admin-1.mjs (no injectable Supabase client here, so .eq()/.is() chains and the
// migrations' policy text are asserted statically).

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    content: "Details",
    owner: helen.name,
    members: [helen.name],
    priority: "medium",
    status: "inProgress",
    done: false,
    due: "2026/08/20",
    startDate: "",
    createdAt: "2026/08/01 12:00",
    completedAt: "",
    creator: jack.name,
    creatorId: jack.id,
    parentId: null,
    departmentId: "",
    visibility: "team",
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

// ---------------------------------------------------------------------------
// 1. Old Tasks.jsx:388-399 precedence: when the current user is BOTH an assignee
//    and the creator, the assignee row wins — ticking toggles their own row, not
//    the whole task (`isEmpAssignee ? toggleDone : creatorToggleDone`).
const bothRoles = task("both-roles", { creator: helen.name, creatorId: helen.id });
assert.deepEqual(taskCompletionForMember(bothRoles, helen), { checked: false, canToggle: true, wholeTask: false },
  "assignee-and-creator must resolve to the own-row toggle (wholeTask: false), mirroring old Tasks.jsx assignee-first precedence");

// Creator who is NOT an assignee gets the whole-task toggle (old creatorToggleDone).
const creatorOnly = task("creator-only", { creator: helen.name, creatorId: helen.id, assignees: [], members: [] });
assert.deepEqual(taskCompletionForMember(creatorOnly, helen), { checked: false, canToggle: true, wholeTask: true });

// ---------------------------------------------------------------------------
// 2. Bidirectional at the ROW level too: an assignee whose own row is completed
//    while the task overall is still open must see an ENABLED 取消完成 in the …
//    menu (the G-task-3 gap was "done 后 disabled、无 un-complete 写路径").
const menuState = {
  currentUser: helen,
  permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false,
  actionTaskId: null
};
const ownRowDone = task("own-row-done", {
  assignees: [{ employeeId: helen.id, name: helen.name, completedAt: "2026/08/04 12:00", abandonedAt: null }],
  status: "inProgress",
  done: false
});
const ownRowDoneHtml = renderTaskActionPopover({ task: ownRowDone, open: true, state: menuState, helpers });
assert.match(ownRowDoneHtml, /data-task-action-uncomplete="own-row-done"(?![^>]*disabled)/,
  "an assignee whose own row is done (task still open) gets an enabled 取消完成 — row-level un-complete exists");
assert.doesNotMatch(ownRowDoneHtml, /data-task-action-complete="own-row-done"/);

// Waiting-approval boundary (current shipped entry): the … 完成 stays disabled while
// the task waits for verification — approval flows through the detail banner's
// data-task-approve instead (approveLiveTask), not through the card menu.
const waitingApproval = task("waiting-approval", {
  creator: helen.name,
  creatorId: helen.id,
  requiresReview: true,
  assignees: [{ employeeId: jack.id, name: jack.name, completedAt: "2026/08/04 12:00", abandonedAt: null }]
});
const waitingHtml = renderTaskActionPopover({ task: waitingApproval, open: true, state: menuState, helpers });
assert.match(waitingHtml, /data-task-action-complete="waiting-approval"[^>]*disabled/,
  "creator 完成 is disabled during waiting-approval; the approve entry lives in the detail banner");

// ---------------------------------------------------------------------------
// 3. Write-path source contracts on completeLiveTask (live-task-writes.js).
const [writesSource, tasksSource] = await Promise.all([
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8")
]);
const completionWrite = writesSource.slice(
  writesSource.indexOf("export async function completeLiveTask"),
  writesSource.indexOf("export async function approveLiveTask")
);

// 3a. Creator whole-task COMPLETE stamps only rows still pending — the .is() pair
//     is the query-level twin of old Tasks.jsx's pendingIds filter
//     (completed_at == null && abandoned_at == null), so an assignee's own earlier
//     completion timestamp and any abandoned row are left untouched.
const wholeCompleteWrite = completionWrite.slice(
  completionWrite.indexOf("const assigneeResult = await client.from(\"task_assignees\")", completionWrite.indexOf("taskDone: false")),
  completionWrite.indexOf("if (String(targetEmployeeId")
);
assert.match(wholeCompleteWrite, /\.update\(\{ completed_at: completedAt \}\)[\s\S]*?\.eq\("task_id", taskId\)[\s\S]*?\.is\("completed_at", null\)[\s\S]*?\.is\("abandoned_at", null\)/,
  "whole-task complete must scope the fan-out to pending rows only (both .is(null) guards), mirroring old pendingIds");
assert.match(wholeCompleteWrite, /const patch = \{ status: "done", completed_at: completedAt \};[\s\S]*?if \(needsApproval\) \{[\s\S]*?patch\.approved_at = completedAt;[\s\S]*?patch\.approved_by = currentUser\.employeeId;/,
  "needs_approval tasks completed by the creator are auto-verified in the same patch (old Tasks.jsx:360-361)");

// 3b. Assignee path stays self-only at the API boundary (the RLS update_self policy's
//     client-side twin) and recomputes allDone from freshly-read rows, not the cache.
assert.match(completionWrite, /if \(String\(targetEmployeeId \|\| ""\) !== String\(currentUser\.employeeId\)\) \{\s*\n\s*throw new Error\("Assignees can only toggle their own task row"\);/,
  "non-self targetEmployeeId must throw before any write");
assert.match(completionWrite, /const rowsResult = await client\.from\("task_assignees"\)\.select\("completed_at,abandoned_at"\)\.eq\("task_id", taskId\);/,
  "allDone must be derived from a fresh row read");
assert.match(completionWrite, /if \(allDone && !needsApproval\) \{/,
  "auto-done only fires when every row is complete AND the task needs no approval (old Tasks.jsx:378-380)");

// 3c. G-task-3 fix (2026-08-05): the assignee's own-row UNCHECK reopens the task with
//     status/completed_at ONLY. Migration 082/083's prevent_task_field_hijack trigger
//     limits plain assignees to exactly those two columns on employee_tasks — clearing
//     approved_at/approved_by here raised on previously-approved tasks and left a
//     partial write (row cleared, task still done). Old Tasks.jsx:381-383 wrote the
//     same minimal patch.
const assigneeUncheckWrite = completionWrite.slice(completionWrite.indexOf("} else if (!completed) {"));
assert.match(assigneeUncheckWrite, /\.update\(\{ status: "open", completed_at: null \}\)/,
  "assignee uncheck must reopen with the trigger-allowed field set only");
assert.doesNotMatch(assigneeUncheckWrite, /approved_at: null/,
  "no approval clearing on the assignee path — that is creator wholeTask-uncheck territory (批2A), where the trigger authorizes the caller");

// The creator wholeTask-uncheck branch, by contrast, still resets approval alongside
// every assignee row (e821c45 / todo #260 semantics, unchanged by this fix).
const creatorUndoWrite = completionWrite.slice(completionWrite.indexOf("if (!completed)"), completionWrite.indexOf("taskDone: false"));
assert.match(creatorUndoWrite, /status: "open", completed_at: null, approved_at: null, approved_by: null/,
  "creator wholeTask uncheck keeps clearing approval stamps");

// 3d. Local echo parity in tasks.js: reopenWholeTask clears approvedAt/approvedBy only
//     inside the resetAssignees (creator wholeTask) branch, so the bare assignee reopen
//     never fakes an approval reset the DB row didn't get.
const reopenSource = tasksSource.slice(
  tasksSource.indexOf("function reopenWholeTask"),
  tasksSource.indexOf("async function toggleTaskCompletion")
);
assert.match(reopenSource, /if \(resetAssignees\) \{[\s\S]*?task\.approvedAt = "";\s*\n\s*task\.approvedBy = "";\s*\n\s*\}/,
  "approval-echo clearing must live inside the resetAssignees branch");
assert.equal((reopenSource.match(/task\.approvedAt = "";/g) ?? []).length, 1,
  "exactly one approvedAt clear — none on the bare (assignee) reopen path");

// ---------------------------------------------------------------------------
// 4. RLS evidence: the creator whole-task write path needs NO new migration.
const [rls082, rls083, rls094] = await Promise.all([
  readFile(new URL("../migrations/082_team_rls_hardening.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/083_team_task_field_hardening.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/094_team_subtask_writes.sql", import.meta.url), "utf8")
]);
// 082: creators may UPDATE any assignee row on their task (the fan-out's legal basis)…
assert.match(rls082, /CREATE POLICY task_assignees_update_manage ON public\.task_assignees\s*\n\s*FOR UPDATE TO authenticated\s*\n\s*USING \(public\.can_manage_task_assignees\(task_id\)\)/,
  "082 must keep the manage-level UPDATE policy on task_assignees");
assert.match(rls082, /FUNCTION public\.can_manage_task_assignees[\s\S]*?t\.creator_employee_id = public\.current_employee_id\(\)/,
  "…and can_manage_task_assignees must include the creator link");
// …but column-limited to completion state, which is all completeLiveTask writes there.
assert.match(rls082, /prevent_task_assignee_identity_update[\s\S]*?- 'completed_at' - 'abandoned_at'\)[\s\S]*?RAISE EXCEPTION 'task_assignees only completed_at\/abandoned_at can be updated'/,
  "the identity trigger limits assignee-row updates to completed_at/abandoned_at — the exact fields the write path touches");
// Self policy backs the assignee own-row path.
assert.match(rls082, /CREATE POLICY task_assignees_update_self ON public\.task_assignees[\s\S]*?employee_id = public\.current_employee_id\(\)/,
  "082 must keep the self-only UPDATE policy for assignee rows");
// 083: on employee_tasks the creator is a fully-authorized caller, while a plain
// assignee is limited to status/completed_at — which is why 3c's minimal patch matters.
assert.match(rls083, /caller_can_edit := public\.is_bf_admin\(\)[\s\S]*?OR OLD\.creator_employee_id = public\.current_employee_id\(\)/,
  "083's field-hijack trigger authorizes the creator for full-field task updates (approval stamps included)");
assert.match(rls083, /RAISE EXCEPTION 'task assignees can only update status\/completed_at on employee_tasks'/,
  "083 pins the plain-assignee column limit the uncheck patch must respect");
// 094 (the U-task-2 subtask-tightening migration) adds RPCs only — it does not replace
// the task_assignees policies above, so the creator fan-out stays legal after it.
assert.doesNotMatch(rls094, /CREATE POLICY[^;]*ON (public\.)?task_assignees/,
  "094 must not have re-tightened task_assignees policies");

console.log("task-creator-toggle-1 contracts: PASS (assignee-first precedence, row-level 取消完成, waiting-approval boundary, pending-only fan-out + auto-verify, self-guard + fresh allDone, trigger-compliant assignee uncheck, echo parity, RLS evidence 082/083/094)");
