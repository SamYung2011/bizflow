import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { availableQuickCreateActions } from "../root-site/components/quick-create.js";
import { taskAttachmentStoragePath } from "../root-site/data/live-task-writes.js";
import { dictionaries as shellDictionaries } from "../root-site/shell/shell-i18n.js";
import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { lang: "zh", escapeHtml, icon: (name) => `<svg data-icon="${name}"></svg>` };

const monitor = await readFile(new URL("../root-site/bizflow/ocpp-monitor.js", import.meta.url), "utf8");

assert.match(monitor, /const OCPP_AUTO_REFRESH_INTERVAL_MS = 30_000;/,
  "OCPP monitor must retain the approved 30-second polling cadence");
assert.match(monitor, /autoRefresh: typeof saved\.autoRefresh === "boolean" \? saved\.autoRefresh : true/,
  "auto refresh must default on while preserving an explicit captured off state");
assert.match(monitor, /activeScope\.timeout\(async \(\) => \{[^]*await refreshMonitorData\(\);[^]*scheduleAutoRefresh\(\);[^]*OCPP_AUTO_REFRESH_INTERVAL_MS/,
  "polling must be lifecycle-scoped and recursively scheduled after each refresh");
assert.match(monitor, /if \(state\.autoRefresh\) void refreshMonitorData\(\);[^]*scheduleAutoRefresh\(\);/,
  "turning polling on must refresh immediately and start the timer");
assert.match(monitor, /logs: preserveDeferredLogs \? data\.logs : result\.logs/,
  "the lightweight status poll must not discard already-loaded deferred OCPP logs");
assert.match(monitor, /dispose\(\) \{[^]*cancelAutoRefresh\(\);/,
  "SPA disposal must cancel the pending OCPP poll");

const denyAll = { hasPermission: () => false, isBfAdmin: false, bizflowMainAccess: false };
assert.deepEqual(availableQuickCreateActions(denyAll), [], "users without either domain permission must not see an empty add shell");
assert.deepEqual(availableQuickCreateActions({ ...denyAll, hasPermission: (key) => key === "can_create_task" }), ["task"]);
assert.deepEqual(availableQuickCreateActions({ ...denyAll, bizflowMainAccess: true }), ["order", "customer"]);
assert.deepEqual(availableQuickCreateActions(null), ["task", "order", "customer"], "the demo path keeps all three actions");

function makeTask(id, priority, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    content: "",
    priority,
    status: "inProgress",
    done: false,
    due: "2026/07/31",
    startDate: "",
    completedAt: "",
    owner: "Helen",
    creator: "Helen",
    creatorId: "employee-helen",
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
    assignees: [{ employeeId: "employee-helen", name: "Helen", completedAt: null, abandonedAt: null }],
    feedback: [],
    subtasks: [],
    members: ["Helen"],
    ...overrides
  };
}

const priorities = ["high", "medium", "low"];
const boardTasks = priorities.flatMap((priority) => Array.from({ length: 7 }, (_, index) => makeTask(`${priority}-${index}`, priority)));
const boardState = {
  tasks: boardTasks,
  board: priorities.map((key) => ({ key, count: 7, tasks: boardTasks.filter((task) => task.priority === key) })),
  members: [],
  currentUser: { id: "employee-helen", name: "Helen" },
  permissions: { canCreate: true, canEditOthers: false, canDeleteOthers: false },
  onlyMine: false,
  boardExpandedPriorities: new Set(),
  boardUnreadTaskIds: new Set(["low-6"]),
  actionTaskId: null,
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false
};
const filterState = { status: "inProgress", priority: "all", view: "board", member: "all" };
const collapsedBoard = renderTaskBoardGrid({ state: boardState, filterState, helpers });
assert.equal((collapsedBoard.match(/data-task-card=/g) ?? []).length, 15, "each board column must initially render at most five cards");
assert.equal((collapsedBoard.match(/data-task-column-expand=/g) ?? []).length, 3, "every long column gets a real expand control");
assert.equal((collapsedBoard.match(/data-task-column-add=/g) ?? []).length, 3, "create-capable users get a priority-prefilled add control on every column");
assert.match(collapsedBoard, /data-task-column-unread="1"/, "hidden changed cards still contribute to the column unread count");
boardState.boardExpandedPriorities.add("low");
const expandedBoard = renderTaskBoardGrid({ state: boardState, filterState, helpers });
assert.equal((expandedBoard.match(/data-task-card=/g) ?? []).length, 17, "only the explicitly expanded column renders its full list");
assert.match(expandedBoard, /data-task-column-expand="low" aria-expanded="true"/);

const feedbackTask = makeTask("feedback-task", "high", {
  feedback: [
    { id: "own-text", author: "Helen", authorUserId: "user-helen", timestamp: "20/07/2026", message: "Editable", attachments: [], attachmentCount: 0, own: true },
    { id: "own-file", author: "Helen", authorUserId: "user-helen", timestamp: "20/07/2026", message: "", attachments: [{ url: "https://example.test/a.png", name: "a.png", type: "image/png" }], attachmentCount: 1, own: true },
    { id: "other-text", author: "Sam", authorUserId: "user-sam", timestamp: "20/07/2026", message: "Read only", attachments: [], attachmentCount: 0, own: false }
  ]
});
function feedbackState(overrides = {}) {
  return {
    detailOpen: true,
    selectedTaskId: feedbackTask.id,
    detailTab: "feedback",
    attachmentPreview: null,
    tasks: [feedbackTask],
    members: [],
    currentUser: { id: "employee-helen", userId: "user-helen", name: "Helen" },
    permissions: { canCreate: false, canValidate: false, canDeleteOthers: false },
    liveReadOnly: true,
    liveTaskWrites: true,
    writeBusy: false,
    feedbackDraft: { message: "", attachments: [] },
    feedbackError: "",
    feedbackMenuId: null,
    feedbackEditingId: null,
    feedbackEditDraft: "",
    feedbackEditOriginal: "",
    feedbackEditError: "",
    ...overrides
  };
}
const ownTextMenu = renderTaskDetail({ state: feedbackState({ feedbackMenuId: "own-text" }), helpers });
assert.match(ownTextMenu, /data-task-feedback-edit-start="own-text"/);
assert.match(ownTextMenu, /data-task-feedback-delete="own-text"/);
assert.doesNotMatch(ownTextMenu, /data-task-feedback-menu-open="other-text"/,
  "another author's comment must not expose the action menu");
const ownFileMenu = renderTaskDetail({ state: feedbackState({ feedbackMenuId: "own-file" }), helpers });
assert.doesNotMatch(ownFileMenu, /data-task-feedback-edit-start="own-file"/,
  "attachment-only feedback must not offer text editing");
assert.match(ownFileMenu, /data-task-feedback-delete="own-file"/,
  "attachment-only feedback remains deletable by its author");

assert.equal(taskAttachmentStoragePath("https://project.supabase.co/storage/v1/object/public/task-attachments/task-id/file%20name.png?x=1"), "task-id/file name.png");
assert.equal(taskAttachmentStoragePath("https://example.test/not-our-bucket/file.png"), "");
assert.equal(taskAttachmentStoragePath("javascript:alert(1)"), "");

const [
  shellSource,
  homeSource,
  customerSource,
  createOrderSource,
  detailOrderSource,
  taskSource,
  taskControllerSource,
  taskWritesSource
] = await Promise.all([
  readFile(new URL("../root-site/shell/shell.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/customers.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-create.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-detail.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8")
]);
assert.match(shellSource, /data-quick-create-open/);
assert.match(homeSource, /data-quick-create-open[^]*data-home-task-filter-option[^]*captureState: \(\) => \(\{ taskFilter: homeTaskFilter \}\)/,
  "home FAB/add card and My Tasks filter must be wired and BF-restorable");
assert.match(customerSource, /consumeNavigationPreset\(navigationPresetKeys\.customersAdd\)/,
  "the shared customer action must open the existing customer form rather than a second flow");
assert.match(taskSource, /consumeNavigationPreset\(navigationPresetKeys\.taskCreate\)/,
  "the shared task action must open the existing task form rather than a second flow");
assert.match(taskSource, /state\.boardExpandedPriorities\.clear\(\)/,
  "filter changes must reset expanded columns to the approved five-card baseline");
assert.match(taskControllerSource, /state\.boardExpandedPriorities\.clear\(\)/,
  "member and My Tasks filters must also reset column expansion");
for (const source of [createOrderSource, detailOrderSource]) {
  assert.doesNotMatch(source, /data-shipping-fee(?:\s|=)/,
    "the old raw shipping input must not survive beside the shared panel trigger");
  assert.match(source, /data-shipping-fee-trigger/);
  assert.match(source, /orders-free-select--readonly/,
    "read-only order pages must render shipping as value text, not a dead button");
}
assert.match(detailOrderSource, /state\.fees\.shipping = value;[^]*state\.feesTouched = true;/,
  "detail shipping stays a draft until the existing order save path persists it");
assert.match(taskWritesSource, /export async function updateLiveTaskFeedback[^]*\.eq\("author_user_id", currentUser\.userId\)/,
  "comment editing must be author-scoped even for privileged users");
assert.match(taskWritesSource, /export async function deleteLiveTaskFeedback[^]*\.eq\("author_user_id", currentUser\.userId\)/,
  "comment deletion must be author-scoped even for privileged users");
assert.match(taskSource, /Boolean\(state\.feedbackEditingId && state\.feedbackEditDraft !== state\.feedbackEditOriginal\)/,
  "an edited comment draft must participate in the SPA leave guard");

for (const lang of ["zh", "en", "fr"]) {
  for (const key of ["quickCreate.title", "quickCreate.task", "quickCreate.order", "quickCreate.customer", "quickCreate.close"]) {
    assert.ok(shellDictionaries[lang][key], `${lang} is missing ${key}`);
  }
  for (const key of ["tasks.column.expand", "tasks.column.collapse", "tasks.column.add", "tasks.members.manage", "tasks.detail.feedbackEdit", "tasks.detail.feedbackDelete", "tasks.detail.feedbackSave", "tasks.detail.feedbackCancel", "tasks.detail.feedbackDeleteConfirm", "tasks.detail.feedbackRequired"]) {
    assert.ok(taskDictionaries[lang][key], `${lang} is missing ${key}`);
  }
}

console.log("Empty-shell batch 4 contracts: PASS (quick create, task filter/board, shipping, feedback writes, OCPP polling)");
