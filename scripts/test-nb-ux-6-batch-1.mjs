import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { displayDateInput, latestDateInput, normalizeDateInput } from "../root-site/components/date-value.js";
import { renderTaskSubmitDialog } from "../root-site/team/tasks-submit.js";
import { taskT } from "../root-site/team/tasks-i18n.js";

assert.equal(normalizeDateInput("2026/7/2"), "2026-07-02");
assert.equal(normalizeDateInput("07/02/2026"), "2026-07-02");
assert.equal(normalizeDateInput("2026-02-30"), "");
assert.equal(displayDateInput("2026-07-20"), "2026/07/20");
assert.equal(latestDateInput(["2026-07-18", "2026/07/20", "bad"]), "2026-07-20");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const baseState = {
  submitOpen: true,
  submitMode: "create",
  submitDraft: {
    title: "日期面板測試",
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
  currentUser: { id: "employee-jack", name: "Jack" },
  submitOriginalDepartmentId: "",
  writeBusy: false,
  liveReadOnly: true,
  liveTaskWrites: true,
  submitError: ""
};
const taskData = { departments: [], members: [{ id: "employee-jack", name: "Jack", dept: "member" }] };

for (const lang of ["zh", "en", "fr"]) {
  const html = renderTaskSubmitDialog({
    state: structuredClone(baseState),
    data: taskData,
    helpers: { escapeHtml, icon: () => '<svg class="icon"></svg>', lang }
  });
  assert.match(html, /data-task-due-trigger/, `${lang}: task form must use the shared date trigger`);
  assert.match(html, /type="hidden" name="due" value="2026-07-20"/, `${lang}: due value must stay in FormData`);
  assert.doesNotMatch(html, /type="date"/, `${lang}: native calendar must be removed from the task form`);
  assert.notEqual(taskT(lang, "tasks.date.chooseMonth"), "tasks.date.chooseMonth", `${lang}: year/month jump must be translated`);
  assert.notEqual(taskT(lang, "tasks.submit.dueRequired"), "tasks.submit.dueRequired", `${lang}: required-date error must be translated`);
}

const [panelSource, expenseSource, tasksSource, manifestSource, northboundSource, warrantySource] = await Promise.all([
  readFile(new URL("../root-site/components/date-range-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/expense.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/spa/route-manifest.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-northbound.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers-warranty.js", import.meta.url), "utf8")
]);

assert.match(panelSource, /nextMode === "single"/, "shared blue panel must expose single-date mode");
assert.match(panelSource, /commit\(\{ date: normalized \}\)/, "single-date day selection must commit immediately");
assert.match(panelSource, /data-date-range-preset/, "shared panel must support top quick presets");
assert.match(panelSource, /data-date-range-year/, "single and range modes must retain year jump");
assert.match(panelSource, /data-date-range-month/, "single and range modes must retain month jump");
assert.match(expenseSource, /data-expense-date-trigger/, "finance form must use the shared date trigger");
assert.doesNotMatch(expenseSource, /type="date"/, "finance form must not retain a native calendar");
assert.match(expenseSource, /mode: "single"/, "finance date must open in single mode");
assert.match(tasksSource, /mode: "single"/, "task due date must open in single mode");
assert.match(tasksSource, /tasks\.submit\.dueRequired/, "cleared required task date must be validated");
assert.match(manifestSource, /expense\.html[\s\S]*?date-range-panel\.css/, "SPA finance route must load blue panel styles");
assert.match(manifestSource, /team\/index\.html[\s\S]*?date-range-panel\.css/, "SPA task route must load blue panel styles");
assert.match(northboundSource, /createDateRangePanel/, "northbound must remain on the shared blue panel");
assert.match(warrantySource, /createDateRangePanel/, "warranty must remain on the shared blue panel");

console.log("NB-ux-6 batch 1 contracts: PASS (single mode, finance, task due date, trilingual jump/clear)");
