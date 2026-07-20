import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createTaskBoardReadTracker, taskBoardFingerprint, TASK_BOARD_READ_STATE_STORAGE_KEY } from "../root-site/team/task-board-read-state.js";
import { renderTaskBoardGrid } from "../root-site/team/tasks-board.js";
import { renderTaskDetail } from "../root-site/team/tasks-detail.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

globalThis.matchMedia = () => ({ matches: false });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: (key) => values.get(key) ?? null
  };
}

function idleQueue() {
  const callbacks = [];
  return {
    schedule(callback) {
      callbacks.push(callback);
      return { type: "test", id: callbacks.length };
    },
    cancel() {},
    runOne() {
      callbacks.shift()?.({ didTimeout: true, timeRemaining: () => 8 });
    },
    runAll() {
      while (callbacks.length) this.runOne();
    },
    get length() { return callbacks.length; }
  };
}

function makeTask(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    content: "content",
    priority: "high",
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

// Priority unread is based on stable task content, not the old decorative count.
const fingerprintBase = makeTask("one");
assert.equal(taskBoardFingerprint(fingerprintBase), taskBoardFingerprint({ ...fingerprintBase, countBadge: "99" }));
assert.notEqual(taskBoardFingerprint(fingerprintBase), taskBoardFingerprint({ ...fingerprintBase, title: "Changed" }));
assert.notEqual(taskBoardFingerprint(fingerprintBase), taskBoardFingerprint({
  ...fingerprintBase,
  subtasks: [makeTask("child", { parentId: "one", status: "completed", done: true })]
}), "subtask progress must change its top-level task fingerprint");

const storage = memoryStorage();
const queue = idleQueue();
let unreadIds = new Set(["unexpected"]);
const tracker = createTaskBoardReadTracker({
  scopeKey: "company:employee",
  storage,
  schedule: queue.schedule.bind(queue),
  cancel: queue.cancel,
  onUnreadChange: (next) => { unreadIds = next; }
});
const initialTasks = Array.from({ length: 50 }, (_, index) => makeTask(`task-${index}`));
tracker.refresh(initialTasks);
assert.equal(queue.length, 1);
queue.runOne();
assert.equal(queue.length, 1, "50 tasks must yield after the first 24-task idle chunk");
queue.runAll();
assert.deepEqual([...unreadIds], [], "first run establishes a zero-unread baseline");
assert.ok(storage.value(TASK_BOARD_READ_STATE_STORAGE_KEY)?.includes("task-49"));

const changedTasks = initialTasks.map((task, index) => index === 1 ? { ...task, title: "Changed title" } : task);
changedTasks[2] = {
  ...changedTasks[2],
  subtasks: [makeTask("task-2-child", { parentId: "task-2", status: "completed", done: true })]
};
tracker.refresh(changedTasks);
queue.runAll();
assert.deepEqual([...unreadIds].sort(), ["task-1", "task-2"]);
assert.equal(tracker.markSeen(["task-1"]), true);
assert.deepEqual([...unreadIds], ["task-2"], "seeing one rendered column/task must not clear hidden changes");
tracker.dispose();

const boardTasks = [makeTask("high-unread"), makeTask("high-read"), makeTask("medium-read", { priority: "medium" })];
const boardHtml = renderTaskBoardGrid({
  state: {
    tasks: boardTasks,
    board: [
      { key: "high", tasks: boardTasks.slice(0, 2) },
      { key: "medium", tasks: boardTasks.slice(2) },
      { key: "low", tasks: [] }
    ],
    members: [],
    onlyMine: false,
    currentUser: { id: "employee-helen", name: "Helen" },
    permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
    liveReadOnly: true,
    actionTaskId: null,
    boardUnreadTaskIds: new Set(["high-unread"])
  },
  filterState: { member: "all", status: "inProgress", priority: "all", view: "board" },
  helpers
});
assert.match(boardHtml, /team-kanban-column__title[^]*?<span>2<\/span>/, "the plain number remains the total count");
assert.match(boardHtml, /data-task-column-unread="1"[^>]*>1<\/span>/, "the colored badge is unread-only");
assert.equal((boardHtml.match(/data-task-column-unread=/g) ?? []).length, 1);

const parent = makeTask("parent", {
  subtasks: [makeTask("subtask", {
    parentId: "parent",
    creator: "Creator",
    creatorId: "employee-creator",
    assignees: [{ employeeId: "employee-assignee", name: "Assignee", completedAt: null, abandonedAt: null }]
  })]
});
const detailState = (currentUser) => ({
  detailOpen: true,
  selectedTaskId: parent.id,
  detailTab: "content",
  attachmentPreview: null,
  tasks: [parent, ...parent.subtasks],
  members: [],
  currentUser,
  permissions: { canCreate: true, canValidate: true, canDeleteOthers: true },
  liveReadOnly: true,
  liveTaskWrites: true,
  writeBusy: false,
  feedbackDraft: { message: "", attachments: [] },
  feedbackError: ""
});
const assigneeDetail = renderTaskDetail({
  state: detailState({ id: "employee-assignee", name: "Assignee" }), helpers
});
assert.match(assigneeDetail, /data-task-subtask-toggle="subtask"(?![^>]* disabled)/,
  "the direct subtask assignee gets an enabled checkbox");
const creatorDetail = renderTaskDetail({
  state: detailState({ id: "employee-creator", name: "Creator", isSuperAdmin: true, isAdminOfActive: true }), helpers
});
assert.match(creatorDetail, /data-task-subtask-toggle="subtask"[^>]* disabled/,
  "creator/admin powers must not allow proxy completion");
assert.match(creatorDetail, /只有此子任務的直接負責人可以勾選/);

const [shellSource, homeSource, tasksSource, controllerSource, writesSource] = await Promise.all([
  readFile(new URL("../root-site/shell/shell.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8")
]);

assert.match(shellSource, /"\.\.\/bizflow\/home\.html#team-activity"/);
assert.match(shellSource, /user\.isBfAdmin === true \|\| user\.bizflowMainAccess === true/);
assert.doesNotMatch(shellSource, /data-shell-message[^]*?markRead\("messages"/,
  "topbar navigation must never clear the activity feed before it is seen");
assert.match(homeSource, /id="team-activity" data-home-team-activity/);
assert.match(homeSource, /entry\.intersectionRatio >= 0\.5/);
assert.match(homeSource, /document\.visibilityState === "hidden"/);
assert.match(homeSource, /markRead\("messages", unreadWatermarks\.messages\)/);
assert.match(homeSource, /unread: \{ \.\.\.\(homeData\.unread \?\? \{\}\), \.\.\.unread \}/,
  "the home card must render the same computed message unread value as the shell");

assert.match(tasksSource, /createTaskBoardReadTracker/);
assert.match(tasksSource, /entry\.intersectionRatio < 0\.75/);
assert.match(tasksSource, /\}, 500\)/, "column visibility must be stable before clearing");
assert.match(controllerSource, /if \(state\.liveTaskWrites\)[^]*?await toggleSubtaskCompletion\(subtask\)/);
assert.match(writesSource, /export async function setLiveSubtaskCompletion\(\{ taskId, completed \}\)/);
const subtaskWriteFlow = writesSource.slice(
  writesSource.indexOf("export async function setLiveSubtaskCompletion"),
  writesSource.indexOf("export async function setLiveTaskParticipation")
);
assert.doesNotMatch(subtaskWriteFlow, /targetEmployeeId|employeeId\s*[,}]/,
  "subtask write must not accept a proxy target employee");
assert.match(subtaskWriteFlow, /\.eq\("employee_id", currentUser\.employeeId\)/);
assert.match(subtaskWriteFlow, /if \(!taskResult\.data\?\.parent_task_id\) throw/);
assert.match(subtaskWriteFlow, /status: taskDone \? "done" : "open", completed_at: taskDone \? completedAt : null/);

["zh", "en", "fr"].forEach((lang) => {
  ["tasks.column.unreadChanges", "tasks.detail.subtaskOnlyAssignee", "tasks.write.failed"].forEach((key) => {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  });
});

console.log("Empty-shell batch 2 contracts: PASS (true-read messages, scoped topbar, idle board fingerprints, strict subtask completion)");
