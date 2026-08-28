import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { orderedTaskRailMembers } from "../root-site/team/task-member-order.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [tasksSource, tasksCss, domainCss] = await Promise.all([
  readFile(join(root, "root-site/team/tasks.js"), "utf8"),
  readFile(join(root, "root-site/team/tasks.css"), "utf8"),
  readFile(join(root, "root-site/team/tasks-domain.css"), "utf8")
]);

const members = [
  { id: "all", dept: "all", name: "Honnmono 任務總覽" },
  { id: "employee-vincent", userId: "user-vincent", name: "Vincent" },
  { id: "employee-helen", userId: "user-helen", name: "Helen" },
  { id: "employee-jack", userId: "user-jack", name: "Jack" },
  { id: "employee-hoey", userId: "user-hoey", name: "Hoey" }
];

function ids(rows) {
  return rows.map((member) => member.id);
}

assert.deepEqual(
  ids(orderedTaskRailMembers(members, { id: "employee-jack", userId: "user-jack" })),
  ["all", "employee-jack", "employee-vincent", "employee-helen", "employee-hoey"],
  "all must stay first, the current employee must render second, and everyone else must keep their relative order"
);
assert.deepEqual(
  ids(orderedTaskRailMembers(members, { userId: "user-helen" })),
  ["all", "employee-helen", "employee-vincent", "employee-jack", "employee-hoey"],
  "the auth user id must be a stable fallback when an employee id is unavailable"
);
assert.deepEqual(
  ids(orderedTaskRailMembers(members, { id: "employee-missing", userId: "user-missing" })),
  ids(members),
  "a current user absent from the member list must leave the source order unchanged"
);
assert.deepEqual(
  ids(orderedTaskRailMembers(members, { name: "Jack" })),
  ids(members),
  "display names must never be used to identify the current member"
);
assert.deepEqual(
  ids(orderedTaskRailMembers(members, { id: "employee-vincent" })),
  ids(members),
  "sorting must be idempotent when the current member is already second"
);
assert.deepEqual(ids(members), ["all", "employee-vincent", "employee-helen", "employee-jack", "employee-hoey"], "display sorting must not mutate provider order");

assert.match(tasksSource, /const railMembers = orderedTaskRailMembers\(state\.members, currentUser\);/, "rail identity must come from the authenticated provider user, not name-derived task state");
assert.match(tasksSource, /class="team-member-list">\$\{railMembers\.map\(\(member\) => renderMember\(member, memberTasks, helpers\)\)/);
assert.match(tasksSource, /renderTaskOverview\(\{\s*members: state\.members,/s, "overview must keep consuming provider order");

assert.match(tasksCss, /\.team-board\s*\{[^}]*--task-member-viewport-height:\s*calc\(100vh - \(var\(--space-40\) \* 2\)\);/s);
assert.match(tasksCss, /\.team-member-rail\s*\{[^}]*max-height:\s*var\(--task-member-viewport-height\);/s);
assert.match(tasksCss, /\.team-task-page\[data-task-mode="overview"\]\[data-task-view="board"\] \.team-kanban\s*\{[^}]*max-height:\s*var\(--task-member-viewport-height\);[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s, "only the non-calendar overview canvas should share the adaptive rail height");
assert.match(domainCss, /\.task-overview\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;/s);
assert.match(domainCss, /\.task-overview > div\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;/s, "expanded overview content must remain inside its own scroll container");

console.log("task UX fixes 2 contracts passed");
