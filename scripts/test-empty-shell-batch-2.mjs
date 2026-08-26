import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createTaskBoardColumnReadObserver, createTaskBoardReadTracker, taskBoardFingerprint, TASK_BOARD_READ_STATE_STORAGE_KEY } from "../root-site/team/task-board-read-state.js";
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
const volatileTask = makeTask("volatile", {
  owner: "Helen、Sam",
  creator: "Helen",
  attachments: [{
    url: "https://project.supabase.co/storage/v1/object/sign/task-attachments/a.png?token=first&expires=1",
    name: "a.png",
    type: "image/png",
    size: 12
  }],
  assignees: [
    { employeeId: "employee-helen", name: "Helen", completedAt: null, abandonedAt: null },
    { employeeId: "employee-sam", name: "Sam", completedAt: null, abandonedAt: null }
  ]
});
assert.equal(taskBoardFingerprint(volatileTask), taskBoardFingerprint({
  ...volatileTask,
  owner: "Sam、Helen",
  creator: "Helen renamed",
  attachments: [{ ...volatileTask.attachments[0], url: "https://project.supabase.co/storage/v1/object/sign/task-attachments/a.png?token=second&expires=2" }],
  assignees: [...volatileTask.assignees].reverse()
}), "derived assignee order and rotating signed-URL query params must not create false unread");

// 2026-08-04 批4 (件1「红点跟账号走」): createTaskBoardReadTracker 现在要求 accountId 才会真正
// 读写 storage(没有 accountId 时整个 tracker 惰性化,见下面新增的 inert 断言)——这里的 fixtures
// 全部补一个占位账号 id,继续覆盖这个文件本来要测的 idle 分片/指纹 diff/legacy baseline 行为,不是
// 在测账号隔离本身(账号隔离的专项断言在 test-reddot-1.mjs)。
const testAccountId = "acct-batch2-test";
const scopedStorageKey = `${TASK_BOARD_READ_STATE_STORAGE_KEY}:acct:${testAccountId}`;

const storage = memoryStorage();
const queue = idleQueue();
let unreadIds = new Set(["unexpected"]);
const tracker = createTaskBoardReadTracker({
  scopeKey: "company:employee",
  accountId: testAccountId,
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
assert.ok(storage.value(scopedStorageKey)?.includes("task-49"), "signatures persist under the account-scoped key, not the bare base key");
assert.equal(storage.value(TASK_BOARD_READ_STATE_STORAGE_KEY), null, "the old unsuffixed global key must never be written by an account-scoped tracker");

// 件1 新增: 没有账号身份(accountId 缺失/未登录/身份未就绪)时 tracker 必须整个惰性化——不读、不算、
// 不亮,而不是退回旧的无账号共享 key 或猜一个默认身份。
const inertQueue = idleQueue();
let inertUnread = new Set(["unexpected"]);
const inertTracker = createTaskBoardReadTracker({
  scopeKey: "company:employee",
  storage,
  schedule: inertQueue.schedule.bind(inertQueue),
  cancel: inertQueue.cancel,
  onUnreadChange: (next) => { inertUnread = next; }
});
inertTracker.refresh(initialTasks);
inertQueue.runAll();
assert.deepEqual([...inertUnread], [], "an accountId-less tracker must report zero unread, never a guessed default");
assert.equal(inertTracker.markSeen(["task-0"]), false, "markSeen must no-op (return false) without an account identity");
inertTracker.dispose();

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

let intersectionCallback = null;
let settledCallback = null;
let settledDelay = null;
const cards = [{ getAttribute: () => "task-2" }];
const column = {
  querySelector: (selector) => selector === "[data-task-column-unread]" ? {} : null,
  querySelectorAll: (selector) => selector === "[data-task-card]" ? cards : []
};
const header = { isConnected: true, closest: () => column };
class TestIntersectionObserver {
  constructor(callback) { intersectionCallback = callback; }
  observe() {}
  disconnect() {}
}
const visibleDocument = { visibilityState: "visible", querySelectorAll: () => [header] };
const columnObserver = createTaskBoardColumnReadObserver({
  tracker,
  documentRef: visibleDocument,
  Observer: TestIntersectionObserver,
  schedule(callback, delay) {
    settledCallback = callback;
    settledDelay = delay;
    return 1;
  },
  cancel() {}
});
columnObserver.observe();
intersectionCallback([{ target: header, isIntersecting: true, intersectionRatio: 0.8 }]);
assert.equal(settledDelay, 500);
assert.deepEqual([...unreadIds], ["task-2"], "intersection alone must wait for stable visibility");
settledCallback();
assert.deepEqual([...unreadIds], [], "visible + intersecting column must persist its rendered task signatures as read");
columnObserver.dispose();

const reloadQueue = idleQueue();
let reloadUnread = new Set(["unexpected"]);
const reloadTracker = createTaskBoardReadTracker({
  scopeKey: "company:employee",
  accountId: testAccountId,
  storage,
  schedule: reloadQueue.schedule.bind(reloadQueue),
  cancel: reloadQueue.cancel,
  onUnreadChange: (next) => { reloadUnread = next; }
});
reloadTracker.refresh(changedTasks);
reloadQueue.runAll();
assert.deepEqual([...reloadUnread], [], "a reload must retain the visible-column clear");
reloadTracker.dispose();
tracker.dispose();

// "legacy" here names an incomplete-baseline *scope* fixture (a stored scope object missing the
// complete:true marker, e.g. from an older code version) — unrelated to today's old-global-key
// cleanup. It's still seeded under this account's own scoped storage key, since that's the only
// key an account-scoped tracker ever reads.
const legacyAccountId = "acct-legacy-baseline-test";
const legacyScopedStorageKey = `${TASK_BOARD_READ_STATE_STORAGE_KEY}:acct:${legacyAccountId}`;
const legacyStorage = memoryStorage();
legacyStorage.setItem(legacyScopedStorageKey, JSON.stringify({
  version: 1,
  scopes: { legacy: { signatures: { "task-0": taskBoardFingerprint(initialTasks[0]) } } }
}));
const legacyQueue = idleQueue();
let legacyUnread = new Set(["unexpected"]);
const legacyTracker = createTaskBoardReadTracker({
  scopeKey: "legacy",
  accountId: legacyAccountId,
  storage: legacyStorage,
  schedule: legacyQueue.schedule.bind(legacyQueue),
  cancel: legacyQueue.cancel,
  onUnreadChange: (next) => { legacyUnread = next; }
});
legacyTracker.refresh(initialTasks.slice(0, 2));
legacyQueue.runAll();
assert.deepEqual([...legacyUnread], [], "an incomplete/legacy baseline must absorb missing task fingerprints as first-seen");
assert.equal(JSON.parse(legacyStorage.value(legacyScopedStorageKey)).scopes.legacy.complete, true);
legacyTracker.refresh(initialTasks.slice(0, 3));
legacyQueue.runAll();
assert.deepEqual([...legacyUnread], ["task-2"], "a task missing from a completed baseline is a real new unread task");
legacyTracker.dispose();

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
assert.match(assigneeDetail, /<h3>子任務<span>0\/1<\/span><\/h3>/,
  "detail subtask header must start at zero completed");
const creatorDetail = renderTaskDetail({
  state: detailState({ id: "employee-creator", name: "Creator", isSuperAdmin: true, isAdminOfActive: true }), helpers
});
assert.match(creatorDetail, /data-task-subtask-toggle="subtask"[^>]* disabled/,
  "creator/admin powers must not allow proxy completion");
assert.match(creatorDetail, /只有此子任務的直接負責人可以勾選/);
parent.subtasks[0].done = true;
parent.subtasks[0].status = "completed";
parent.subtasks[0].assignees[0].completedAt = "2026/07/20 20:00";
const completedDetail = renderTaskDetail({
  state: detailState({ id: "employee-assignee", name: "Assignee" }), helpers
});
assert.match(completedDetail, /<h3>子任務<span>1\/1<\/span><\/h3>/,
  "detail subtask header must show completed/total progress");
const completedBoard = renderTaskBoardGrid({
  state: {
    tasks: [parent, ...parent.subtasks],
    board: [
      { key: "high", tasks: [parent] },
      { key: "medium", tasks: [] },
      { key: "low", tasks: [] }
    ],
    members: [],
    onlyMine: false,
    currentUser: { id: "employee-assignee", name: "Assignee" },
    permissions: { canCreate: false, canEditOthers: false, canDeleteOthers: false },
    liveReadOnly: true,
    actionTaskId: null,
    boardUnreadTaskIds: new Set()
  },
  filterState: { member: "all", status: "inProgress", priority: "all", view: "board" },
  helpers
});
assert.match(completedBoard, /☑ 1\/1/, "board card must consume the same live subtask progress");

const [shellSource, homeSource, tasksSource, controllerSource, writesSource] = await Promise.all([
  readFile(new URL("../root-site/shell/shell.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/home.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-domain-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8")
]);

assert.match(shellSource, /function renderMessageButton\(\)\s*\{[^]*?href="\.\.\/team\/index\.html"/,
  "the topbar message button must always open task management");
assert.doesNotMatch(shellSource, /home\.html#team-activity/,
  "the topbar message button must not route Bizflow users back to the Home activity anchor");
assert.match(shellSource, /user\.isBfAdmin === true \|\| user\.bizflowMainAccess === true/);
assert.doesNotMatch(shellSource, /data-shell-message[^]*?markRead\("messages"/,
  "topbar navigation must never clear the activity feed before it is seen");
assert.match(homeSource, /id="team-activity" data-home-team-activity/);
assert.match(homeSource, /entry\.intersectionRatio >= 0\.5/);
assert.match(homeSource, /document\.visibilityState === "hidden"/);
assert.match(homeSource, /markRead\("messages", unreadWatermarks\.messages\)/);
assert.match(homeSource, /cachedPageUnread\(dashboard\.currentUser\)/,
  "the home card must use the same cached unread state as the shell without blocking first paint");
assert.match(homeSource, /unread: \{ \.\.\.\(homeData\.unread \?\? \{\}\), \.\.\.cached\.unread \}/,
  "the home card must merge the shared cached message unread value into its dashboard data");
assert.match(homeSource, /data\.unread = \{ \.\.\.\(data\.unread \?\? \{\}\), \.\.\.nextUnread\.unread \}/,
  "the home card must apply the asynchronously refreshed unread value after first paint");

assert.match(tasksSource, /createTaskBoardReadTracker/);
assert.match(tasksSource, /createTaskBoardColumnReadObserver\(\{ tracker: readTracker \}\)/);
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
