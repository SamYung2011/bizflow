import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calendarRelatedTasks, isOpenTask, overviewForMember } from "../root-site/team/tasks-model.js";

const currentUser = { id: "member-1", name: "Helen" };
const task = (id, overrides = {}) => ({
  id,
  parentId: null,
  creatorId: currentUser.id,
  creator: currentUser.name,
  assignees: [],
  done: false,
  status: "open",
  priority: "medium",
  due: "2026/07/22",
  ...overrides
});
const input = [
  task("open"),
  task("done-flag", { done: true }),
  task("completed", { status: "completed" }),
  task("abandoned", { status: "abandoned" }),
  task("unrelated", { creatorId: "member-2", creator: "Other" })
];

assert.equal(isOpenTask(input[0]), true);
assert.equal(isOpenTask(input[1]), false);
assert.equal(isOpenTask(input[2]), false);
assert.equal(isOpenTask(input[3]), false);
assert.equal(isOpenTask(null), false);
assert.deepEqual(calendarRelatedTasks(input, { currentUser }).map((row) => row.id), ["open"],
  "calendar input must exclude completed, abandoned, done, and unrelated tasks");
assert.deepEqual(overviewForMember(currentUser, input).open.map(({ task: row }) => row.id), ["open"],
  "member overview must share the same open-task contract");

const [model, tasks, calendar] = await Promise.all([
  readFile(new URL("../root-site/team/tasks-model.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks-calendar.js", import.meta.url), "utf8")
]);
assert.equal((model.match(/task\.done !== true && task\.status !== "completed" && task\.status !== "abandoned"/g) ?? []).length, 1,
  "the raw open-task predicate must have one source of truth");
assert.match(model, /export function isOpenTask\(task\)/);
assert.match(model, /calendarRelatedTasks[\s\S]*?isOpenTask\(task\) && isTaskRelated\(task, currentUser\)/);
assert.match(tasks, /calendarRelatedTasks\(state\.tasks,[\s\S]*?renderTaskCalendar\(\{ tasks: calendarTasks/,
  "calendar bars and day dialogs must consume the filtered calendar task list");
assert.match(tasks, /task\.parentId === null && isOpenTask\(task\)/,
  "the member rail total must reuse the shared open-task predicate");
assert.doesNotMatch(calendar, /task\.status !== "completed"|task\.status !== "abandoned"/,
  "calendar rendering must not carry a second status predicate");
assert.match(calendar, /data-calendar-related-count="\$\{tasks\.length\}"[\s\S]*data-calendar-scheduled-count="\$\{scheduledCount\}"/,
  "calendar counters must derive from the already-filtered input");

console.log("CAL-filter-1 contracts: PASS (shared open predicate, calendar bars/dialogs/counters)");
