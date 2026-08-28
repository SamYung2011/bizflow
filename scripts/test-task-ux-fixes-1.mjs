import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createOptimisticWriteCoordinator } from "../root-site/team/task-optimistic-write.js";
import { captureTaskCompletionEffects, createTaskCompletionSnapshot, restoreTaskCompletionSnapshot } from "../root-site/team/task-completion-state.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

// 件1: apply must run before the background write settles. A same-task second click is
// ignored, while another task is allowed to progress independently.
const coordinator = createOptimisticWriteCoordinator();
const firstWrite = deferred();
const firstState = { checked: false, error: "" };
let firstWriteCalls = 0;
const firstPending = coordinator.run("task-a", {
  apply() {
    firstState.checked = true;
  },
  write() {
    firstWriteCalls += 1;
    return firstWrite.promise;
  },
  rollback() {
    firstState.checked = false;
  },
  onFailure() {
    firstState.error = "tasks.write.failed";
  }
});
assert.equal(firstState.checked, true, "the completion check is visible synchronously, before the write resolves");
assert.equal(coordinator.pending, true);
assert.equal(coordinator.run("task-a", { apply() {}, write() {} }), null,
  "a repeated click on the same in-flight task must not start another write");
assert.equal(firstWriteCalls, 1);

const secondState = { checked: false, corrected: false };
const secondPending = coordinator.run("task-b", {
  apply() {
    secondState.checked = true;
  },
  write: async () => ({ taskDone: false, completedAt: "server-time" }),
  reconcile(result) {
    secondState.checked = result.taskDone;
    secondState.corrected = true;
  }
});
assert.equal(secondState.checked, true, "a different task is not blocked by task-a");
await secondPending;
assert.deepEqual(secondState, { checked: false, corrected: true },
  "the server result corrects a mismatched optimistic prediction");

firstWrite.reject(new Error("simulated write failure"));
await firstPending;
assert.deepEqual(firstState, { checked: false, error: "tasks.write.failed" },
  "a failed write restores the pre-click state and exposes the existing error key");
assert.equal(coordinator.pending, false);

// Different tasks may be optimistic at the same time. Rolling task A back must subtract
// only A's aggregate deltas, leaving task B's task/summary/member changes intact.
const aggregate = {
  summary: { completed: 0, inProgress: 2 },
  members: [{ id: "member", taskCount: 2 }]
};
const aggregateTask = (id) => ({
  id,
  done: false,
  status: "inProgress",
  completedAt: "",
  approvedAt: "",
  approvedBy: "",
  assignees: [{ employeeId: "member", completedAt: null, abandonedAt: null }]
});
const taskA = aggregateTask("aggregate-a");
const taskB = aggregateTask("aggregate-b");
const snapshotA = createTaskCompletionSnapshot(taskA, aggregate);
Object.assign(taskA, { done: true, status: "completed", completedAt: "local-a" });
aggregate.summary.completed += 1;
aggregate.summary.inProgress -= 1;
aggregate.members[0].taskCount -= 1;
captureTaskCompletionEffects(snapshotA, aggregate);
const snapshotB = createTaskCompletionSnapshot(taskB, aggregate);
Object.assign(taskB, { done: true, status: "completed", completedAt: "local-b" });
aggregate.summary.completed += 1;
aggregate.summary.inProgress -= 1;
aggregate.members[0].taskCount -= 1;
captureTaskCompletionEffects(snapshotB, aggregate);
restoreTaskCompletionSnapshot(taskA, snapshotA, aggregate);
assert.deepEqual(aggregate.summary, { completed: 1, inProgress: 1 });
assert.equal(aggregate.members[0].taskCount, 1);
assert.equal(taskA.status, "inProgress");
assert.equal(taskB.status, "completed", "task B must survive task A's rollback");

// A late response from a disposed mount must not clear the same task id's newer-mount guard.
const mountCoordinator = createOptimisticWriteCoordinator();
const oldMountWrite = deferred();
const newMountWrite = deferred();
const oldMountPending = mountCoordinator.run("same-task", { apply() {}, write: () => oldMountWrite.promise });
mountCoordinator.clear();
const newMountPending = mountCoordinator.run("same-task", { apply() {}, write: () => newMountWrite.promise });
oldMountWrite.resolve({ taskDone: true });
await oldMountPending;
assert.equal(mountCoordinator.has("same-task"), true,
  "an old mount's late finally must not release the newer mount's same-task guard");
newMountWrite.resolve({ taskDone: true });
await newMountPending;
assert.equal(mountCoordinator.has("same-task"), false);

const [tasksSource, cssSource] = await Promise.all([
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.css", import.meta.url), "utf8")
]);

const mainToggle = tasksSource.slice(
  tasksSource.indexOf("async function toggleTaskCompletion"),
  tasksSource.indexOf("async function approveWaitingTask")
);
const subtaskToggle = tasksSource.slice(
  tasksSource.indexOf("async function toggleSubtaskCompletion"),
  tasksSource.indexOf("async function createSubtaskWrite")
);
for (const [label, source] of [["main task", mainToggle], ["subtask", subtaskToggle]]) {
  assert.match(source, /taskCompletionWrites\.run\(/, `${label} completion must use the per-task coordinator`);
  assert.match(source, /applyPredictedTaskCompletion\(/, `${label} must render the local prediction first`);
  assert.match(source, /restoreTaskCompletionSnapshot\(/, `${label} must restore its own deltas on failure`);
  assert.match(source, /state\.writeError = "tasks\.write\.failed"/, `${label} must retain the existing failure message`);
  assert.doesNotMatch(source, /state\.writeBusy = true/, `${label} must not put the whole page into a busy state`);
}
const reconciliation = tasksSource.slice(
  tasksSource.indexOf("function reconcileTaskCompletion"),
  tasksSource.indexOf("// 批3件C")
);
assert.match(reconciliation, /if \(result\.taskDone\)/,
  "the shared main/subtask correction must use the server taskDone result");
assert.match(mainToggle, /reconcile\(result\)[\s\S]*?reconcileTaskCompletion\([^;]*?result/,
  "main-task completion must pass the fresh server result into correction");
assert.match(subtaskToggle, /reconcile\(result\)[\s\S]*?reconcileTaskCompletion\([^;]*?result/,
  "subtask completion must pass the fresh server result into correction");
assert.match(tasksSource, /function hasTaskRealtimeRefreshBlock\(\) \{\s*\n\s*if \(state\.writeBusy \|\| taskCompletionWrites\.pending \|\| state\.actionTaskId/,
  "realtime refresh must wait behind optimistic completion writes and an open action menu");
assert.match(tasksSource, /function rerenderTaskPageFromBackground\(options = \{\}\) \{\s*\n\s*if \(state\.actionTaskId\) return false;/,
  "background rerenders must preserve the open action-popover DOM");
assert.equal((tasksSource.match(/rerenderTaskPageFromBackground\(/g) ?? []).length, 3,
  "the helper plus realtime-data and unread background callers are pinned");

const railCss = cssSource.slice(cssSource.indexOf(".team-member-rail"), cssSource.indexOf(".team-member-task"));
assert.match(cssSource, /--task-member-viewport-height: calc\(100vh - /, "the shared member viewport limit follows the viewport instead of a fixed pixel height");
assert.match(railCss, /max-height: var\(--task-member-viewport-height\);/, "the rail consumes the adaptive member viewport limit");
assert.match(railCss, /\.team-member-list[\s\S]*?min-height: 0;/, "the member list may shrink inside its flex rail");
assert.match(railCss, /\.team-member-list[\s\S]*?overflow-y: auto;/, "overflowing members scroll inside the rail");
assert.match(railCss, /scrollbar-gutter: stable;/, "the scroll area follows the site's stable-scrollbar treatment");

console.log("task-ux-fixes-1 contracts: PASS (instant optimistic UI, per-task concurrency, server correction, failure rollback, menu-safe background refresh, adaptive member-list scrolling)");
