import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { dictionaries as shellDictionaries } from "../root-site/shell/shell-i18n.js";
import { renderTaskActionPopover } from "../root-site/team/tasks-actions.js";
import { taskDictionaries } from "../root-site/team/tasks-i18n.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const helpers = { escapeHtml, icon: () => "", lang: "zh" };

const task = {
  id: "task-delete-parity",
  title: "刪除權限契約",
  creator: "Jack",
  creatorId: "employee-jack",
  assignees: [{ employeeId: "employee-member", name: "Member", completedAt: null, abandonedAt: null }],
  done: false,
  status: "inProgress",
  requiresReview: false
};
const person = (id, flags = {}) => ({
  id,
  name: id,
  isSuperAdmin: false,
  isAdminOfActive: false,
  ...flags
});
const menuFor = (currentUser, permissions = {}) => renderTaskActionPopover({
  task,
  open: true,
  state: {
    currentUser,
    permissions: {
      canCreate: false,
      canEditOthers: false,
      canDeleteOthers: false,
      ...permissions
    },
    liveTaskWrites: true,
    liveReadOnly: true,
    writeBusy: false
  },
  helpers
});

assert.match(menuFor(person("employee-jack")), /data-task-action-delete="task-delete-parity"/,
  "task creator must get the delete action without delete-others permission");
assert.match(menuFor(person("employee-super", { isSuperAdmin: true })), /data-task-action-delete=/,
  "super admin must get the delete action");
assert.match(menuFor(person("employee-company-admin", { isAdminOfActive: true })), /data-task-action-delete=/,
  "active-company admin must get the delete action");
assert.match(menuFor(person("employee-permitted"), { canDeleteOthers: true }), /data-task-action-delete=/,
  "can_delete_others_tasks must get the delete action");
assert.doesNotMatch(menuFor(person("employee-member")), /data-task-action-delete=/,
  "being assigned alone must not grant task deletion");

const [
  shellSource,
  shellBundle,
  membersSource,
  providerSource,
  snapshotSource,
  dependencySource,
  tasksSource,
  taskWritesSource,
  northboundSource
] = await Promise.all([
  readFile(new URL("../root-site/shell/shell.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/shell/shell.bundle.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/members.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-snapshot-dependencies.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/team/tasks.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-task-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/orders-northbound.js", import.meta.url), "utf8")
]);

// ⑤ Low-permission users keep the same destination but see it named as the
// update log. Shell and page access must share the employee-management gate.
const shellMenuFlow = shellSource.slice(shellSource.indexOf("function buildMenuItems"), shellSource.indexOf("let menuItems"));
assert.match(shellMenuFlow, /user\.isSuperAdmin === true \|\| user\.isAdminOfAny === true \|\|\s*user\.hasPermission\("can_manage_employees"\)/);
assert.match(shellMenuFlow, /\["nav\.team", "nav\.updates"\]\.includes\(item\.key\) && !canManageEmployees \? "nav\.updates" : item\.key/);
assert.match(shellBundle, /\["nav\.team", "nav\.updates"\]\.includes\(item\.key\) && !canManageEmployees \? "nav\.updates" : item\.key/,
  "built shell must carry the same low-permission label gate");
const memberAccessFlow = membersSource.slice(membersSource.indexOf("function buildMemberAccess"), membersSource.indexOf("export async function mountPage"));
assert.match(memberAccessFlow, /currentUser\.isSuperAdmin === true \|\| currentUser\.isAdminOfAny === true \|\| currentUser\.hasPermission\("can_manage_employees"\)/);
assert.match(memberAccessFlow, /"updates",\s*\.\.\.\(memberAccess\.canManageEmployees \? \["members"\] : \[\]\)/,
  "updates must remain visible when member management is hidden");
assert.match(membersSource, /memberAccess\.canManageEmployees \? "nav\.team" : "nav\.updates"/);
["zh", "en", "fr"].forEach((lang) => {
  assert.equal(typeof shellDictionaries[lang]["nav.updates"], "string", `${lang}.nav.updates missing`);
  assert.notEqual(shellDictionaries[lang]["nav.updates"], shellDictionaries[lang]["nav.team"],
    `${lang} low-permission label must not claim employee management`);
});

// ④ The update-log landing path must not pull members/home. Other datasets load
// only when their visible tab is selected, and stale mounts cannot merge them.
const teamProviderFlow = providerSource.slice(
  providerSource.indexOf("export async function getTeamMembersData"),
  providerSource.indexOf("// ---------- bizflow 客户管理屏")
);
assert.match(teamProviderFlow, /extrasScope === "updates" \? loadTeamUpdateLogsSnapshot\(\) : loadTeamExtrasSnapshot\(\)/);
assert.match(teamProviderFlow, /if \(!includeMembers\) return buildEmptyTeamMembersData\(teamExtras\)/);
assert.match(teamProviderFlow, /if \(isR9MembersSnapshot\(snapshot\)\) return buildR9MembersData\(snapshot, null, teamExtras\)/,
  "valid members data must be self-contained instead of loading home");
assert.ok(teamProviderFlow.indexOf("const home = await getHomeData()") > teamProviderFlow.indexOf("isR9MembersSnapshot(snapshot)"),
  "home may remain only after the invalid-snapshot fallback gate");
assert.match(membersSource, /const MEMBER_DATA_TABS = new Set\(\["members", "permissions", "departments", "reviews", "commission"\]\)/);
assert.match(membersSource, /const MEMBER_EXTRAS_TABS = new Set\(\["reviews", "commission", "updates", "companies"\]\)/);
const tabLoaderFlow = membersSource.slice(membersSource.indexOf("async function ensureMemberTabData"), membersSource.indexOf("function renderStatCard"));
assert.match(tabLoaderFlow, /getTeamMembersData\(\{ includeMembers, includeExtras, extrasScope: requestedExtrasScope \}\)/);
assert.match(tabLoaderFlow, /if \(!isCurrentMemberMount\(mountId, scope\)\) return/,
  "late tab data must not merge into a stale SPA mount");
assert.match(membersSource, /const initialIncludesMembers = MEMBER_DATA_TABS\.has\(initialTab\)/);
assert.match(membersSource, /const initialExtrasScope = initialTab === "updates" \? "updates" : "all"/);
assert.match(snapshotSource, /async function buildTeamUpdateLogsSnapshot\(\)[\s\S]*?allRows\("team_update_logs"[\s\S]*?allRows\("team_update_log_comments"[\s\S]*?allRows\("employees"/);
assert.match(snapshotSource, /"team-update-logs\.json": buildTeamUpdateLogsSnapshot/);
assert.match(snapshotSource, /"members\.json": buildMembersSnapshot/);
assert.match(dependencySource, /"team-update-logs\.json": \["team_update_logs", "team_update_log_comments", "employees"\]/);

// ③ UI visibility, click-time authorization and write-time authorization stay
// aligned. Abandoning is participation only and intentionally has no confirm.
assert.match(tasksSource, /function canDeleteTask\(task\)[\s\S]*?isTaskCreator\(task, state\.currentUser\)[\s\S]*?state\.currentUser\.isSuperAdmin[\s\S]*?state\.currentUser\.isAdminOfActive[\s\S]*?state\.permissions\.canDeleteOthers/);
const deleteClickFlow = tasksSource.slice(tasksSource.indexOf("const deleteAction ="), tasksSource.indexOf("const actionTrigger ="));
assert.match(deleteClickFlow, /if \(!canDeleteTask\(task\)\) return/);
assert.match(deleteClickFlow, /confirmInPage\(pageT\(currentHelpers\.lang, "tasks\.action\.deleteConfirm"\), \{ danger: true \}\)/);
assert.match(deleteClickFlow, /if \(!activeScope\?\.isCurrent\(\)\) return/);
const deleteActionFlow = tasksSource.slice(tasksSource.indexOf('if (action === "delete")'), tasksSource.indexOf("function localTimestamp"));
assert.match(deleteActionFlow, /if \(!canDeleteTask\(task\)\) return/,
  "delete execution must recheck authorization after confirmation");
assert.match(deleteActionFlow, /await deleteLiveTask\(task\.id\)/);
assert.match(deleteActionFlow, /descendantTaskIds\(task\.id\)/,
  "local task state must remove database-cascaded child tasks too");
const abandonFlow = tasksSource.slice(tasksSource.indexOf("async function toggleTaskParticipation"), tasksSource.indexOf("async function onTaskClick"));
assert.match(abandonFlow, /setLiveTaskParticipation/);
assert.doesNotMatch(abandonFlow, /confirmInPage/,
  "abandon/restore participation intentionally stays confirmation-free");
assert.match(taskWritesSource, /export async function deleteLiveTask\(taskId\)[\s\S]*?\.delete\(\)\.eq\("id", taskId\)\.select\("id"\)\.single\(\)/);
["zh", "en", "fr"].forEach((lang) => {
  ["tasks.action.delete", "tasks.action.deleteConfirm"].forEach((key) => {
    assert.equal(typeof taskDictionaries[lang][key], "string", `${lang}.${key} missing`);
  });
});

// ⑥ Search is controlled by state and records the first character before a
// debounced full render replaces the input node; focus/caret are restored after.
assert.match(northboundSource, /data-northbound-search value="\$\{escapeHtml\(state\.search\)\}"/);
assert.match(northboundSource, /const query = state\.search\.trim\(\)\.toLocaleLowerCase\(\)/);
assert.match(northboundSource, /\[record\.name, record\.plateNo, record\.phoneHk, record\.phoneMainland\]/);
const searchInputFlow = northboundSource.slice(
  northboundSource.indexOf('scope.listen(document, "input"'),
  northboundSource.indexOf('scope.listen(document, "change"')
);
assert.ok(searchInputFlow.indexOf("state.search = search.value") < searchInputFlow.indexOf("if (event.isComposing) return"),
  "the first character must reach state before any composing/debounce branch");
assert.match(searchInputFlow, /clearTimeout\(searchRenderTimer\)/);
assert.match(searchInputFlow, /searchRenderTimer = scope\.timeout\(\(\) => \{[\s\S]*?rerender\(\)[\s\S]*?input\?\.focus\(\)[\s\S]*?input\?\.setSelectionRange\(input\.value\.length, input\.value\.length\)[\s\S]*?\}, 180\)/);
assert.match(northboundSource, /export function disposeNorthboundState\(\)[\s\S]*?clearTimeout\(searchRenderTimer\)[\s\S]*?searchRenderTimer = null/,
  "route disposal must cancel a pending search render");

console.log("TP-tasks-2 batch 3 contracts: PASS (low-permission entry, lazy members data, delete parity, northbound first character)");
