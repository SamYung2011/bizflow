import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isStrictCompletionMode, meetsTaskCompletionThreshold } from "../root-site/data/task-completion-threshold.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";
import { renderTaskSubmitDialog } from "../root-site/team/tasks-submit.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";

// 批3件D contracts (2026-08-05 12:04 煊煊拍板逐字:「噢噢，那这样在发布任务的那个页面加上一个选项吧。
// 可以选"严格验收/宽松验收"然后放个注释说明：严格验收必须所有人全部勾选任务才会消失，宽松验收就按
// 比例完成任务。」). completion_mode ('strict' | 'ratio', migration 101, NOT NULL DEFAULT 'ratio')
// gates 件C's threshold: strict = all-assignees rules only; ratio = threshold active. Two 小屿默认
// (煊煊未修正): default 'ratio' for new tasks AND legacy backfill; any non-'strict' value (incl. the
// pre-migration snapshot's undefined) reads as ratio.

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };
const helen = { id: "employee-helen", userId: "user-helen", name: "Helen", dept: "member" };

// ---------------------------------------------------------------------------
// 1. Mode predicate + gate composition: strict 3勾2 must NOT close, ratio 3勾2 must.
//    There is no DB null state (column is NOT NULL DEFAULT 'ratio'); undefined only
//    exists in pre-migration snapshots and reads as ratio, matching the backfill.
assert.equal(isStrictCompletionMode("strict"), true);
assert.equal(isStrictCompletionMode("ratio"), false);
assert.equal(isStrictCompletionMode(undefined), false, "pre-migration legacy snapshot value reads as ratio");
assert.equal(isStrictCompletionMode(null), false);
assert.equal(isStrictCompletionMode(""), false);
const closesUnderMode = (mode, checked, total) => !isStrictCompletionMode(mode) && meetsTaskCompletionThreshold(checked, total);
assert.equal(closesUnderMode("ratio", 2, 3), true, "寬鬆驗收: 3 人勾 2 closes via the threshold");
assert.equal(closesUnderMode("strict", 2, 3), false, "嚴格驗收: 3 人勾 2 stays open — threshold fully disabled");
assert.equal(closesUnderMode(undefined, 2, 3), true, "legacy/undefined behaves as ratio");
assert.equal(closesUnderMode("strict", 4, 5), false, "even the 4/5 motivating case stays open under strict");

// ---------------------------------------------------------------------------
// 2. The publish form: a 驗收方式 segment (same renderSegment control as 需核验),
//    strict listed first (her word order), ratio checked by default, hint line present.
const submitHtml = renderTaskSubmitDialog({
  state: {
    submitOpen: true,
    submitMode: "create",
    submitDraft: {
      title: "Mode test",
      content: "",
      priority: "high",
      departmentId: "",
      owner: helen.name,
      requiresReview: "no",
      completionMode: "ratio",
      memberIds: [],
      memberQuery: "",
      memberMenuOpen: false,
      startDate: "",
      due: "2026-08-20",
      attachments: [],
      subtasks: []
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
assert.match(submitHtml, /name="completionMode" value="strict"/);
assert.match(submitHtml, /name="completionMode" value="ratio" checked/,
  "寬鬆驗收 is the default selection (小屿默认: new tasks default ratio)");
const strictIndex = submitHtml.indexOf('value="strict"');
const ratioIndex = submitHtml.indexOf('value="ratio" checked');
assert.ok(strictIndex > -1 && ratioIndex > -1 && strictIndex < ratioIndex,
  "嚴格驗收 renders before 寬鬆驗收 — her verbatim order 严格验收/宽松验收");
assert.match(submitHtml, />嚴格驗收</);
assert.match(submitHtml, />寬鬆驗收</);
assert.match(submitHtml, /form-task-submit__hint[^>]*>嚴格驗收：所有負責人全部勾選任務才會收起；寬鬆驗收：負責人按比例（約八成）勾選完成即收起。</,
  "the explanatory note she asked for sits under the control");

// Edit mode shows the persisted value (strict task -> strict checked).
const editHtml = renderTaskSubmitDialog({
  state: {
    submitOpen: true,
    submitMode: "edit",
    submitDraft: {
      title: "Edit", content: "", priority: "high", departmentId: "", owner: helen.name,
      requiresReview: "no", completionMode: "strict", memberIds: [], memberQuery: "",
      memberMenuOpen: false, startDate: "", due: "2026-08-20", attachments: [], subtasks: []
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
assert.match(editHtml, /name="completionMode" value="strict" checked/);

// ---------------------------------------------------------------------------
// 3. Detail page surfaces the mode (low-cost metadata row).
const detailTask = {
  id: "detail-mode", title: "Detail", content: "", contentKey: "", status: "inProgress",
  priority: "high", visibility: "team", visibilityDepartment: "", owner: helen.name,
  due: "2026/08/20", completionMode: "strict", requiresReview: false, approvedAt: "",
  approvedBy: "", creator: helen.name, creatorId: helen.id, createdAt: "", completedAt: "",
  titleEditedBy: "", titleEditedAt: "", parentId: null, departmentId: "", attachments: [],
  attachmentCount: 0, assignees: [], feedback: [], subtasks: []
};
const detailHtml = renderTaskDetail({
  state: {
    detailOpen: true,
    selectedTaskId: detailTask.id,
    detailTab: "content",
    attachmentPreview: null,
    tasks: [detailTask],
    members: [helen],
    departments: [],
    currentUser: helen,
    permissions: { canCreate: false, canValidate: false, canDeleteOthers: false },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    feedbackEditingId: null,
    feedbackDraft: { message: "", attachments: [], mentions: [], mentionMenu: { open: false, query: "" } },
    feedbackError: "",
    subtaskAddDraft: { title: "", assigneeId: "" }
  },
  helpers
});
assert.match(detailHtml, />驗收方式<\/span>\s*<span class="task-detail__control">嚴格驗收</);

// ---------------------------------------------------------------------------
// 4. i18n: three languages, no hardcoded strings in the control.
for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["tasks.submit.completionMode", "tasks.submit.completionStrict", "tasks.submit.completionRatio", "tasks.submit.completionModeHint"]) {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  }
}
assert.equal(taskDictionaries.zh["tasks.submit.completionStrict"], "嚴格驗收");
assert.equal(taskDictionaries.zh["tasks.submit.completionRatio"], "寬鬆驗收");
assert.equal(taskDictionaries.en["tasks.submit.completionStrict"], "Strict acceptance");
assert.equal(taskDictionaries.en["tasks.submit.completionRatio"], "Flexible acceptance");

// ---------------------------------------------------------------------------
// 5. Source contracts: serialization, write shape, data chain, migration file.
const [tasksSource, writesSource, snapshotsSource, providerSource, migrationSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/101_task_completion_mode.sql", import.meta.url), "utf8")
]);
// Form serialization -> both write paths, normalized to the two legal values.
assert.match(tasksSource, /const completionMode = values\.get\("completionMode"\) === "strict" \? "strict" : "ratio";/,
  "the submit handler reads the segment and normalizes any stray value to ratio");
assert.match(tasksSource, /"requiresReview", "completionMode", "startDate"/,
  "syncTaskSubmitDraft must persist the field so mid-edit rerenders keep the selection");
assert.match(writesSource, /export async function createLiveTask\(\{ [^}]*completionMode = "ratio"/,
  "createLiveTask accepts the mode with the ratio default");
assert.match(writesSource, /completion_mode: normalizedCompletionMode\(completionMode\),\s*\n\s*title,/,
  "the INSERT carries completion_mode");
assert.match(writesSource, /needs_approval: requiresReview === true,\s*\n\s*completion_mode: normalizedCompletionMode\(completionMode\),\s*\n\s*department_id/,
  "the edit PATCH carries completion_mode too (editors are creator/admin/can_edit_others - 083 full-field callers)");
// Completion gate wiring: board menu passes the task's mode; subtask path reads its own fresh row.
assert.match(tasksSource, /needsApproval: task\.requiresReview,\s*\n\s*completionMode: task\.completionMode,/,
  "toggleTaskCompletion passes the task's mode alongside needsApproval (same UI-state trust level)");
assert.match(writesSource, /select\("id,parent_task_id,needs_approval,completion_mode"\)/,
  "setLiveSubtaskCompletion reads completion_mode fresh in its existing task select - zero extra requests");
// Data chain: snapshot -> provider -> page task, legacy-safe normalization at both hops.
assert.match(snapshotsSource, /completionMode: task\.completion_mode === "strict" \? "strict" : "ratio",/,
  "the tasks snapshot maps the column (allRows selects all columns - no query change needed)");
assert.match(providerSource, /completionMode: task\.completionMode === "strict" \? "strict" : "ratio",/,
  "provider threads it into the page task shape");
assert.equal((providerSource.match(/completionMode: "ratio",/g) ?? []).length, 2,
  "both mock form-default objects carry the ratio default");
// Migration 101: idempotent column + CHECK, file only (execution is a production approval step).
assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS completion_mode text NOT NULL DEFAULT 'ratio';/,
  "NOT NULL DEFAULT 'ratio' backfills every legacy row as 寬鬆 (小屿默认)");
assert.match(migrationSource, /CHECK \(completion_mode IN \('strict', 'ratio'\)\)/);
assert.match(migrationSource, /pg_constraint/, "the CHECK constraint is added idempotently (safe to rerun)");
assert.match(migrationSource, /NOTIFY pgrst, 'reload schema';/);
// No new trigger/policy: 083's field-hijack trigger already fences plain assignees to
// status/completed_at, so completion_mode is naturally read-only for them.
assert.doesNotMatch(migrationSource, /CREATE POLICY|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/,
  "101 is a column-only migration - no policy/trigger changes needed");

console.log("task-acceptance-mode-1 contracts: PASS (strict/ratio/legacy predicate + 3勾2 both modes, form segment order/default/hint, edit persistence, detail row, i18n zh/en/fr, serialization -> insert+patch, fresh subtask mode read, snapshot/provider chain, migration 101 idempotent column-only)");
