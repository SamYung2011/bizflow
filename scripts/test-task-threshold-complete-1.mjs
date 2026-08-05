import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { TASK_COMPLETION_THRESHOLD, meetsTaskCompletionThreshold, requiredCompletionCount } from "../root-site/data/task-completion-threshold.js";
import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import {
  isWaitingApproval,
  openAssignedTaskCount,
  taskDoneForMember,
  taskMatchesMemberStatus,
  terminalTasksForMember
} from "../root-site/team/tasks-model.js";

// 批3件C contracts (2026-08-05, 煊煊拍板逐字 11:43:「嘶。如果设定了负责人，负责人超过80%勾选完成
// 就全部完成吧。」+ 11:52 追拍:「那不坏菜了吗。按比例来！」— she rejected the pure-ratio form's
// effect where <5 assignees degenerates to everyone-must-check). Final rule: checked-complete count
// >= max(1, Math.round(0.8 × total assignees)), standard Math.round, no hand-tuning. Numerator =
// completion-checked rows only; denominator = ALL assignee rows (abandoned included). Runs alongside
// the existing all-done rules, first trigger wins; needs_approval tasks never auto-complete. The
// triggering assignee cannot fan-out other rows (082 RLS), so completion lands as task-level
// employee_tasks fields only — the model layer treats task-level done as done-for-member.

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };
const jack = { id: "employee-jack", userId: "user-jack", name: "Jack", dept: "member" };

function assigneeRow(employeeId, completedAt = null, abandonedAt = null) {
  return { employeeId, name: employeeId, completedAt, abandonedAt };
}

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
    creator: "Other",
    creatorId: "employee-other",
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
    assignees: [assigneeRow(helen.id)],
    feedback: [],
    subtasks: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. The threshold rule itself (single shared definition):
//    required = max(1, Math.round(0.8 × total)). Effect table pinned end to end —
//    Math.round standard, no hand-tuning (note 8人 → round(6.4) = 6).
assert.equal(TASK_COMPLETION_THRESHOLD, 0.8);
const effectTable = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 9: 7, 10: 8 };
for (const [total, required] of Object.entries(effectTable)) {
  assert.equal(requiredCompletionCount(Number(total)), required, `${total} assignees must require ${required} checks`);
  assert.equal(meetsTaskCompletionThreshold(required, Number(total)), true, `${required}/${total} triggers`);
  assert.equal(meetsTaskCompletionThreshold(required - 1, Number(total)), false, `${required - 1}/${total} stays open`);
}
assert.equal(meetsTaskCompletionThreshold(4, 5), true, "the 11:43 motivating case (5 負責人勾 4) MUST trigger");
assert.equal(meetsTaskCompletionThreshold(2, 3), true, "11:52 按比例: 3 人勾 2 triggers (round(2.4) = 2), no all-done degeneration");
assert.equal(meetsTaskCompletionThreshold(3, 4), true, "4 人勾 3 triggers (round(3.2) = 3)");
assert.equal(meetsTaskCompletionThreshold(1, 2), false, "2 人勾 1 stays open (round(1.6) = 2)");
assert.equal(meetsTaskCompletionThreshold(3, 5), false, "5 人勾 3 stays open (round(4.0) = 4)");
assert.equal(meetsTaskCompletionThreshold(0, 0), false, "no assignees, no threshold rule");
assert.equal(meetsTaskCompletionThreshold(0, 5), false);
assert.equal(meetsTaskCompletionThreshold(0, 1), false, "the max(1, …) floor means an empty numerator never triggers");
// Abandoned rows: completed_at stays null (writes clear it on abandon), so they can never inflate
// the numerator — but the denominator is ALL rows, so 3-checked + 1-abandoned of 5 needs 4, not 3.
assert.equal(meetsTaskCompletionThreshold(3, 5), false, "3 checked + abandoned row still counted in the denominator");
assert.equal(meetsTaskCompletionThreshold(4, 5), true, "4 checked + 1 abandoned of 5 triggers (abandoned only in the denominator)");

// ---------------------------------------------------------------------------
// 2. Model layer: a threshold-completed task (task-level done, some rows unchecked)
//    counts as done for its unchecked assignees too — no phantom pending, and it
//    files under their 已完成 bucket instead of vanishing from every view.
const thresholdDone = task("threshold-done", {
  status: "completed",
  done: true,
  completedAt: "2026/08/05 12:00",
  assignees: [
    assigneeRow("employee-a", "2026/08/05 10:00"),
    assigneeRow("employee-b", "2026/08/05 10:10"),
    assigneeRow("employee-c", "2026/08/05 10:20"),
    assigneeRow("employee-d", "2026/08/05 10:30"),
    assigneeRow(helen.id) // hoey-style unchecked 5th — row honestly stays unchecked
  ],
  members: ["employee-a", "employee-b", "employee-c", "employee-d", helen.name]
});
assert.equal(taskDoneForMember(thresholdDone, helen), true,
  "task-level completion counts as done for an unchecked assignee (their own row stays honest)");
assert.equal(taskMatchesMemberStatus(thresholdDone, helen, "completed"), true);
assert.equal(taskMatchesMemberStatus(thresholdDone, helen, "inProgress"), false);
assert.equal(openAssignedTaskCount(helen, [thresholdDone]), 0,
  "no phantom pending on the member rail for the unchecked assignee");
const helenTerminal = terminalTasksForMember(helen, [thresholdDone]);
assert.deepEqual(helenTerminal.completed.map((row) => row.id), [thresholdDone.id]);
assert.deepEqual(helenTerminal.abandoned, []);
// Own-row abandoned still wins over task-level done (bucket exclusivity preserved).
const abandonedRowTask = task("abandoned-row-done", {
  status: "completed",
  done: true,
  completedAt: "2026/08/05 12:00",
  assignees: [assigneeRow("employee-a", "2026/08/05 10:00"), assigneeRow(helen.id, null, "2026/08/04 09:00")]
});
assert.equal(taskDoneForMember(abandonedRowTask, helen), false, "an own-row abandon keeps reading as abandoned, not done");
const abandonedTerminal = terminalTasksForMember(helen, [abandonedRowTask]);
assert.deepEqual(abandonedTerminal.abandoned.map((row) => row.id), [abandonedRowTask.id]);
assert.deepEqual(abandonedTerminal.completed, []);
// An open task with an unchecked row is still simply open.
assert.equal(taskDoneForMember(task("still-open"), helen), false);

// Waiting-approval is NOT misjudged: 4/5 checked on a needs_approval task is neither
// auto-completed (write gate requires !needsApproval) nor waiting (needs ALL terminal).
const approval45 = task("approval-4-of-5", {
  requiresReview: true,
  assignees: [
    assigneeRow("employee-a", "2026/08/05 10:00"),
    assigneeRow("employee-b", "2026/08/05 10:10"),
    assigneeRow("employee-c", "2026/08/05 10:20"),
    assigneeRow("employee-d", "2026/08/05 10:30"),
    assigneeRow(helen.id)
  ]
});
assert.equal(isWaitingApproval(approval45), false,
  "80% on a needs_approval task stays plain-open: approval still requires every row terminal");

// ---------------------------------------------------------------------------
// 3. Board render: the unchecked assignee's member board shows the task under the
//    已完成 divider (not in the open list, not vanished).
const boardHtml = renderTaskBoardGrid({
  state: {
    tasks: [thresholdDone],
    board: [
      { key: "high", count: 0, tasks: [] },
      { key: "medium", count: 0, tasks: [] },
      { key: "low", count: 0, tasks: [] }
    ],
    members: [helen, jack],
    currentUser: helen,
    onlyMine: false,
    boardExpandedPriorities: new Set(),
    boardExpandedTerminalPriorities: new Set(),
    boardExpandedMentionPriorities: new Set(),
    boardUnreadTaskIds: new Set(),
    actionTaskId: null,
    permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false
  },
  filterState: { status: "inProgress", priority: "all", member: helen.id, view: "board" },
  helpers
});
assert.doesNotMatch(boardHtml, /class="team-kanban-column__tasks"><article/,
  "the threshold-completed task is not in the unchecked assignee's open list");
assert.match(boardHtml, />已完成 1 · 已放棄 0</, "it files under her terminal divider instead of vanishing");

// ---------------------------------------------------------------------------
// 4. Write-path source contracts (no injectable client — same static style as siblings).
const [writesSource, tasksSource, thresholdSource] = await Promise.all([
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/task-completion-threshold.js", import.meta.url), "utf8")
]);
assert.match(thresholdSource, /Math\.max\(1, Math\.round\(TASK_COMPLETION_THRESHOLD \* totalCount\)\)/,
  "the required count is max(1, Math.round(0.8 × total)) — 11:52 按比例 verbatim, standard rounding");
assert.match(thresholdSource, /completedCount >= requiredCompletionCount\(totalCount\)/);
assert.match(writesSource, /import \{ isStrictCompletionMode, meetsTaskCompletionThreshold \} from "\.\/task-completion-threshold\.js";/,
  "live-task-writes must consume the single shared threshold definition (件D adds the mode predicate from the same module)");
assert.match(tasksSource, /import \{ isStrictCompletionMode, meetsTaskCompletionThreshold \} from "\.\.\/data\/task-completion-threshold\.js";/,
  "the demo-mode branch must consume the same definition — no second 0.8 anywhere");

const completionWrite = writesSource.slice(
  writesSource.indexOf("export async function completeLiveTask"),
  writesSource.indexOf("export async function approveLiveTask")
);
const assigneeBranch = completionWrite.slice(completionWrite.indexOf("if (String(targetEmployeeId"));
// Trigger point: fresh rows, completion direction only, parallel with allDone, one shared close.
// 批3件D added the strict-mode gate in front; the fresh-rows + completion-direction shape is unchanged.
assert.match(assigneeBranch, /const thresholdDone = !isStrictCompletionMode\(completionMode\) && completed && meetsTaskCompletionThreshold\(\s*\n\s*rows\.filter\(\(row\) => row\.completed_at != null\)\.length, rows\.length\);/,
  "threshold reads the same fresh rowsResult as allDone, only fires on the completion direction, and only in ratio mode");
assert.match(assigneeBranch, /const taskDone = \(allDone \|\| thresholdDone\) && !needsApproval;\s*\n\s*if \(taskDone\) \{/,
  "both rules share one gate and one close — needs_approval tasks keep routing through 核验");
// RLS shape: the close writes task-level status/completed_at only (083 trigger D whitelist),
// and the branch touches task_assignees exactly once — the caller's own row, self-scoped.
assert.match(assigneeBranch, /if \(taskDone\) \{\s*\n\s*const taskResult = await client\.from\("employee_tasks"\)\s*\n\s*\.update\(\{ status: "done", completed_at: completedAt \}\)/,
  "the threshold close is the existing task-level UPDATE — no approval stamps, no extra fields");
assert.equal((assigneeBranch.match(/from\("task_assignees"\)\s*\n\s*\.update\(/g) ?? []).length, 1,
  "exactly one task_assignees update in the assignee branch (the caller's own row) — no fan-out to other rows");
assert.match(assigneeBranch, /\.eq\("employee_id", targetEmployeeId\)/,
  "and that one update stays scoped to the caller's own employee_id");
// Reopen unchanged: any assignee unchecking their row still reopens the whole task.
assert.match(assigneeBranch, /\} else if \(!completed\) \{[\s\S]*?\.update\(\{ status: "open", completed_at: null \}\)/,
  "post-threshold, any own-row uncheck still reopens the task (21a4dba's minimal trigger-compliant patch)");

// Subtask path: same trigger timing, same shared definition, same completed guard.
const subtaskWrite = writesSource.slice(
  writesSource.indexOf("export async function setLiveSubtaskCompletion"),
  writesSource.indexOf("export async function createLiveSubtask")
);
assert.match(subtaskWrite, /const thresholdDone = !isStrictCompletionMode\(taskResult\.data\.completion_mode\) && completed && meetsTaskCompletionThreshold\(/,
  "setLiveSubtaskCompletion applies the threshold with the completion-direction guard, gated by the row's fresh completion_mode");
assert.match(subtaskWrite, /const taskDone = \(allDone \|\| thresholdDone\) && taskResult\.data\.needs_approval !== true;/,
  "the existing active-rows all-done rule stays alongside, first trigger wins, approval still gates");

// Echo honesty: the assignee-path close never stamps other assignees' local rows —
// the DB didn't either. Creator wholeTask keeps its stamping default.
assert.match(tasksSource, /function completeWholeTask\(task, completedAt, \{ stampAssignees = true \} = \{\}\)/);
assert.equal((tasksSource.match(/completeWholeTask\(task, [^,)]+, \{ stampAssignees: false \}\)/g) ?? []).length, 2,
  "both assignee-path call sites (live echo + demo mode) must skip local row stamping");
assert.match(tasksSource, /if \(completed\) completeWholeTask\(task, result\.completedAt\);/,
  "the creator wholeTask echo keeps the default stamping — its DB write really does stamp pending rows");
// Demo mode mirrors the live gate.
assert.match(tasksSource, /if \(\(allDone \|\| thresholdDone\) && !task\.requiresReview\) completeWholeTask\(task, targetAssignee\.completedAt, \{ stampAssignees: false \}\);/);

console.log("task-threshold-complete-1 contracts: PASS (rounded-count effect table 1-10, 4/5 + 2/3 + 3/4 trigger, 1/2 + 3/5 no-trigger, abandoned denominator-only, done-for-member extension + buckets + no phantom pending, approval routing, fresh-rows gate + single close + no fan-out, uncheck reopen unchanged, echo honesty, single shared definition)");
