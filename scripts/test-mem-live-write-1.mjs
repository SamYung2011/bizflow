import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { memberPageReadOnly } from "../root-site/team/members.js";
import { memberCanWrite, memberWriteAttrs } from "../root-site/team/members-write-access.js";
import { renderMemberPermissions } from "../root-site/team/members-permissions.js";
import { renderMemberDepartments } from "../root-site/team/members-departments.js";
import { renderMemberCompanies } from "../root-site/team/members-companies.js";
import { renderMemberDetailDialog } from "../root-site/team/members-detail.js";
import { renderMemberReviews } from "../root-site/team/members-review.js";
import { memberDictionaries } from "../root-site/team/members-i18n.js";
import { snapshotsForTables } from "../root-site/data/live-snapshot-dependencies.js";

// G-mem-13 —— 成员域 live 写路径。锁三件事：
//   ① 有权者按钮点亮 + 写路径调用形态正确
//   ② 无权者仍 disabled
//   ③ 写后失效链触发（写哪张表 → 逐出哪份快照）

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
const helpers = {
  escapeHtml,
  lang: "zh",
  icon: (name, className = "") => `<svg data-icon="${name}" class="${className}"></svg>`,
  redDot: () => '<span class="red-dot"></span>'
};

const NO_ACCESS = Object.freeze({
  canManageEmployees: false,
  canApproveRegistration: false,
  canViewCommission: false,
  canManageRoles: false,
  canManageCompanies: false,
  canWriteUpdates: true,
  canAdministerUpdateComments: false,
  commissionLockedEmployeeId: "emp-1"
});
const FULL_ACCESS = Object.freeze({
  ...NO_ACCESS,
  canManageEmployees: true,
  canApproveRegistration: true,
  canViewCommission: true,
  canManageRoles: true,
  canManageCompanies: true
});

const data = {
  form: {
    defaults: { name: "", position: "", email: "", joinedAt: "2026-08-13", dept: "dept-1", role: "role-1" },
    departments: [{ id: "dept-1", name: "全員" }],
    roles: [{ id: "role-1", name: "銷售" }]
  }
};

function memberState(access) {
  return {
    access,
    // 这就是被修掉的硬闸：以前是 liveReadOnly = authenticated（登录即全锁），
    // 现在只有「一项写权限都没有」才整页只读。
    liveReadOnly: memberPageReadOnly(access),
    membersLive: true,
    permissions: {
      rows: [{ id: "can_create_task", labelKey: "members.permission.createTask" }],
      roles: [
        { id: "admin", nameKey: "members.permission.roleAdmin", editable: false, grants: { can_create_task: true } },
        { id: "role-1", name: "銷售", editable: true, grants: { can_create_task: false } }
      ]
    },
    editingPermissionRoleId: null,
    departments: [{ id: "dept-1", name: "全員", manager: "—", icon: "icon-dept-marketing", memberIds: ["emp-1"] }],
    companies: [{ id: "co-1", name: "Honnmono", featureAiBatch: false, employeeCount: 3, createdAt: "2026/01/01" }],
    editingCompanyId: null,
    members: [{
      id: "emp-1",
      name: "claude測試",
      position: "客服",
      email: "a@example.com",
      phone: "",
      dept: "dept-1",
      role: "role-1",
      departmentName: "全員",
      roleName: "銷售",
      commission: "—",
      joinedAt: "2026/01/01",
      status: "active",
      tasks: { tasking: [], tasked: [] }
    }],
    selectedMemberId: "emp-1",
    memberDetailOpen: true,
    memberDetailTab: "basic",
    reviewMode: "registration",
    reviews: [{ id: "pending-1", name: "新人", email: "n@example.com", position: "客服", dept: "dept-1", role: "role-1", appliedAt: "2026/08/01" }],
    reviewHistory: [],
    joinPending: [{ id: "join-1", employee: "外部員工", company: "Honnmono", appliedAt: "2026/08/02", note: "" }],
    joinHistory: [],
    summary: { total: 1, active: 1, departed: 0, reviewPending: 2 }
  };
}

const granted = memberState(FULL_ACCESS);
const denied = memberState(NO_ACCESS);

// ---- liveReadOnly 语义：任一写权限 → 整页不再只读；一项都没有 → 仍只读 ----
assert.equal(memberPageReadOnly(FULL_ACCESS), false,
  "a super admin must no longer land on a read-only member page");
assert.equal(memberPageReadOnly(NO_ACCESS), true,
  "an update-log-only employee keeps the read-only page");
for (const capability of ["canManageRoles", "canManageEmployees", "canManageCompanies", "canApproveRegistration"]) {
  assert.equal(memberPageReadOnly({ ...NO_ACCESS, [capability]: true }), false,
    `${capability} alone must already lift the page-wide read-only flag`);
}

// ---- memberWriteAttrs 是渲染层唯一的写闸：权限位 + 页面级只读都要过 ----
assert.equal(memberWriteAttrs(granted, "canManageRoles"), "");
assert.equal(memberWriteAttrs(denied, "canManageRoles"), ' disabled aria-disabled="true"');
assert.equal(memberCanWrite({ ...granted, liveReadOnly: true }, "canManageRoles"), false,
  "the coarse page-level flag must still win when it is set");

// ---- ① 有权者按钮点亮 / ② 无权者仍 disabled（逐个渲染真跑一遍）----
function controls(html, hook) {
  const tags = (html.match(/<(?:button|input|select|textarea)\b[^>]*>/g) || [])
    .filter((tag) => new RegExp(hook).test(tag));
  assert.ok(tags.length, `missing rendered control for ${hook}`);
  return tags;
}
function attrsOf(html, hook) {
  const tags = controls(html, hook);
  assert.equal(tags.length, 1, `expected exactly one control for ${hook}`);
  return tags[0];
}
function assertEnabled(html, hooks, label) {
  for (const hook of hooks) {
    for (const tag of controls(html, hook)) {
      assert.doesNotMatch(tag, /\sdisabled/, `${label}: ${hook} must be enabled for a permitted user`);
    }
  }
}
function assertDisabled(html, hooks, label) {
  for (const hook of hooks) {
    for (const tag of controls(html, hook)) {
      assert.match(tag, /\sdisabled/, `${label}: ${hook} must stay disabled without the permission`);
    }
  }
}

const permissionHooks = ["data-permission-role-add", 'data-permission-role-edit="role-1"', 'data-permission-role-remove="role-1"'];
const permissionsGranted = renderMemberPermissions({ state: granted, helpers });
const permissionsDenied = renderMemberPermissions({ state: denied, helpers });
assertEnabled(permissionsGranted, permissionHooks, "permission matrix");
assertDisabled(permissionsDenied, permissionHooks, "permission matrix");
assert.doesNotMatch(
  attrsOf(permissionsGranted, 'data-permission-toggle="can_create_task"[^>]*data-permission-role="role-1"'),
  /\sdisabled/,
  "an editable role's grant cell must be clickable for can_manage_roles holders");
assert.match(
  attrsOf(permissionsGranted, 'data-permission-toggle="can_create_task"[^>]*data-permission-role="admin"'),
  /\sdisabled/,
  "the synthetic admin column is not a DB role and must stay locked even for a super admin");
assert.match(
  attrsOf(permissionsDenied, 'data-permission-toggle="can_create_task"[^>]*data-permission-role="role-1"'),
  /\sdisabled/,
  "grant cells must stay locked without can_manage_roles");

const departmentHooks = ["data-department-edit", "data-department-remove", "data-department-add"];
assertEnabled(renderMemberDepartments({ state: granted, helpers }), departmentHooks, "departments");
assertDisabled(renderMemberDepartments({ state: denied, helpers }), departmentHooks, "departments");

const companyHooks = ['data-company-edit="co-1"', 'data-company-delete="co-1"', 'data-company-ai="co-1"'];
assertEnabled(renderMemberCompanies({ state: granted, helpers }), companyHooks, "companies");
assertDisabled(renderMemberCompanies({ state: denied, helpers }), companyHooks, "companies");

const detailGranted = renderMemberDetailDialog({ state: granted, data, helpers });
const detailDenied = renderMemberDetailDialog({ state: denied, data, helpers });
assertEnabled(detailGranted, ["data-member-detail-remove", 'name="position"', 'name="email"', 'name="phone"', 'name="role"'], "member detail");
assertDisabled(detailDenied, ["data-member-detail-remove", 'name="position"', 'name="email"'], "member detail");
// 入職時間 = employees.created_at、佣金是快照算出来的展示值，两者都没有写路径 → live 态锁死，
// 免得改了以为存上了。静态演示态（membersLive:false）维持可改。
for (const hook of ['name="joinedAt"', 'name="commission"']) {
  assert.match(attrsOf(detailGranted, hook), /\sdisabled/,
    `${hook} has no write path and must be locked in live mode`);
  assert.doesNotMatch(attrsOf(renderMemberDetailDialog({ state: { ...granted, membersLive: false }, data, helpers }), hook), /\sdisabled/,
    `${hook} must stay editable in the offline demo mode`);
}

const reviewHooks = ["data-member-review-reject", 'name="dept"', 'name="role"'];
assertEnabled(renderMemberReviews({ state: granted, data, helpers }), reviewHooks, "account review");
assertDisabled(renderMemberReviews({ state: denied, data, helpers }), reviewHooks, "account review");
const joinHooks = ['data-join-review-action="approve"', 'data-join-review-action="reject"'];
assertEnabled(renderMemberReviews({ state: { ...granted, reviewMode: "join" }, data, helpers }), joinHooks, "join review");
assertDisabled(renderMemberReviews({ state: { ...denied, reviewMode: "join" }, data, helpers }), joinHooks, "join review");

// ---- ③ 写后失效链：写哪张表 → 逐出哪份快照 ----
const snapshotsFor = (table) => snapshotsForTables(new Set([table]));
for (const table of ["roles", "departments", "employee_departments", "employees", "employee_companies", "task_pending", "company_join_pending"]) {
  assert.ok(snapshotsFor(table).has("members.json"),
    `writing ${table} must evict members.json so the member page rebuilds from the DB`);
}
for (const table of ["companies", "employee_companies", "company_join_pending"]) {
  assert.ok(snapshotsFor(table).has("team-extras.json"),
    `writing ${table} must evict team-extras.json (companies / join history live there)`);
}
assert.ok(snapshotsFor("employee_tasks").has("tasks.json"),
  "deleting a department releases its tasks back to company scope, so tasks.json must be evicted too");

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [writesSource, membersSource, accessSource, companiesSource, reviewSource, detailSource,
  permissionsSource, departmentsSource] = await Promise.all([
  read("root-site/data/live-members-writes.js"),
  read("root-site/team/members.js"),
  read("root-site/team/members-write-access.js"),
  read("root-site/team/members-companies.js"),
  read("root-site/team/members-review.js"),
  read("root-site/team/members-detail.js"),
  read("root-site/team/members-permissions.js"),
  read("root-site/team/members-departments.js")
]);

// ---- 硬闸真的拆了：整页 liveReadOnly 不再等于 authenticated，也不再和权限位并联当挡板 ----
assert.match(membersSource, /liveReadOnly: authenticated && memberPageReadOnly\(memberAccess\)/,
  "the page-wide flag must be permission-derived, not `authenticated`");
assert.doesNotMatch(membersSource, /liveReadOnly: authenticated,/,
  "the `liveReadOnly = authenticated` hard gate must be gone");
assert.match(membersSource, /membersLive: authenticated/,
  "live vs offline-demo must be a separate flag, mirroring state.updateLogsLive");
for (const source of [membersSource, companiesSource, reviewSource]) {
  assert.doesNotMatch(source, /state\.liveReadOnly \|\| !state\.access/,
    "handlers must gate on memberCanWrite alone, not on the old blanket read-only flag");
  assert.doesNotMatch(source, /if \(state\.liveReadOnly\) return;/,
    "no handler may keep an unconditional read-only bail-out");
}
for (const source of [permissionsSource, departmentsSource, detailSource, reviewSource, companiesSource]) {
  assert.doesNotMatch(source, /state\.liveReadOnly \? " disabled" : ""/,
    "renderers must derive disabled from the permission matrix via memberWriteAttrs");
}
assert.match(accessSource, /return state\?\.liveReadOnly !== true && state\?\.access\?\.\[capability\] === true;/);

// ---- 权限语义沿用页面既有矩阵：写路径与渲染层的判定逐字相同，不许漂移 ----
const accessBlock = membersSource.slice(
  membersSource.indexOf("function buildMemberAccess"),
  membersSource.indexOf("export async function mountPage"));
const writeAccessBlock = writesSource.slice(
  writesSource.indexOf("export function memberWriteAccess"),
  writesSource.indexOf("function throwIfError"));
for (const predicate of [
  'canManageEmployees: currentUser.isSuperAdmin === true || currentUser.isAdminOfAny === true || currentUser.hasPermission("can_manage_employees")',
  'canApproveRegistration: currentUser.hasPermission("can_approve_registration")',
  'canManageRoles: currentUser.hasPermission("can_manage_roles")',
  "canManageCompanies: currentUser.isSuperAdmin === true"
]) {
  assert.ok(writeAccessBlock.includes(predicate), `live write path is missing the page rule: ${predicate}`);
  assert.ok(accessBlock.includes(predicate.replace(/: /, ": !authenticated || ")),
    `members.js:buildMemberAccess no longer carries the rule the write path copies: ${predicate}`);
}
assert.match(writesSource, /if \(memberWriteAccess\(currentUser\)\[capability\] !== true\) \{\s*throw new Error/,
  "every write must re-check the permission server-side of the render layer");

// ---- ① 写路径调用形态：表名 / 字段 / 过滤条件 ----
const WRITE_EXPORTS = [
  "createLiveRole", "renameLiveRole", "setLiveRolePermissions", "deleteLiveRole",
  "createLiveDepartment", "updateLiveDepartment", "deleteLiveDepartment",
  "createLiveMember", "updateLiveMember", "deactivateLiveMember",
  "createLiveCompany", "renameLiveCompany", "deleteLiveCompany", "setLiveCompanyAiBatch",
  "approveLiveRegistration", "rejectLiveRegistration", "approveLiveJoinRequest", "rejectLiveJoinRequest"
];
for (const name of WRITE_EXPORTS) {
  assert.match(writesSource, new RegExp(`export async function ${name}\\(`), `missing write export ${name}`);
}
const blockOf = (name) => {
  const start = writesSource.indexOf(`export async function ${name}(`);
  const next = WRITE_EXPORTS
    .map((other) => writesSource.indexOf(`export async function ${other}(`))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0] ?? writesSource.length;
  return writesSource.slice(start, next);
};

assert.match(blockOf("createLiveRole"), /from\("roles"\)\.insert\(\{[\s\S]*?company_id: companyId,[\s\S]*?permissions: Object\.fromEntries\(RBAC_KEYS\.map/,
  "a new role must be scoped to the active company and seeded with every RBAC key false");
assert.match(blockOf("setLiveRolePermissions"), /select\("permissions"\)[\s\S]*?\{ \.\.\.\(current\.data\?\.permissions \?\? \{\}\), \.\.\.patch \}/,
  "a grant toggle must merge onto the stored JSONB, not overwrite keys the 9-key matrix does not show");
assert.match(blockOf("deleteLiveRole"), /finishWrite\(result, "roles", "employee_companies"\)/,
  "roles.role_id is ON DELETE SET NULL, so bindings must be invalidated together with roles");
assert.match(blockOf("deleteLiveDepartment"), /finishWrite\(result, "departments", "employee_departments", "employee_tasks"\)/);
assert.match(blockOf("updateLiveDepartment"), /syncDepartmentMembers\(client, departmentId, memberIds, previousMemberIds\)/,
  "department membership must be written as an add/remove diff, not a blind rewrite");
assert.match(writesSource, /from\("employee_departments"\)\s*\.insert\(added\.map/);
assert.match(writesSource, /from\("employee_departments"\)\.delete\(\)\s*\.eq\("department_id", departmentId\)\.in\("employee_id", removed\)/);

assert.match(blockOf("createLiveMember"), /from\("employees"\)\.insert\(\{[\s\S]*?kind: "employee"/);
assert.match(blockOf("createLiveMember"), /from\("employee_companies"\)\.insert\(\{[\s\S]*?is_default: true,[\s\S]*?is_company_admin: false,[\s\S]*?role_id: bindingRoleId/,
  "employee_companies is the real company binding — without it the new member sees no company and no tasks");
assert.match(blockOf("createLiveMember"), /if \(binding\.error\) \{[\s\S]*?from\("employees"\)\.delete\(\)\.eq\("id", created\.data\.id\)/,
  "a failed binding must roll the employee row back instead of leaving an orphan");
assert.match(blockOf("updateLiveMember"), /from\("employees"\)\.update\(\{\s*role: textOrNull\(position\),\s*email: textOrNull\(email\),\s*phone: textOrNull\(phone\)\s*\}\)\.eq\("id", employeeId\)/,
  "employees.role carries the position text; name/kind/user_id/is_super_admin are never patched from this form");
assert.match(blockOf("deactivateLiveMember"), /update\(\{ active: false \}\)/);
assert.doesNotMatch(blockOf("deactivateLiveMember"), /deactivated_at/,
  "deactivated_at starts migration 048's 6-day cron delete — that is G-mem-14's unbind semantics, not this button's");

assert.match(blockOf("createLiveCompany"), /upsert\(\{ name: requiredText\(name, "Company name is required"\) \}, \{ onConflict: "name" \}\)/);
assert.match(blockOf("setLiveCompanyAiBatch"), /update\(\{ feature_ai_batch: enabled === true \}\)/);
assert.match(blockOf("deleteLiveCompany"), /finishWrite\(result, "companies", "employee_companies"\)/);

assert.match(blockOf("approveLiveRegistration"), /from\("task_pending"\)\.update\(\{\s*approved: true,\s*reviewed_at: new Date\(\)\.toISOString\(\),\s*reviewed_by: session\.user\.id\s*\}\)/);
assert.match(blockOf("approveLiveRegistration"), /if \(binding\.error\) \{[\s\S]*?from\("employees"\)\.delete\(\)\.eq\("id", created\.data\.id\)/);
assert.match(blockOf("approveLiveJoinRequest"), /from\("employee_companies"\)\.select\("id"\)[\s\S]*?\.maybeSingle\(\)[\s\S]*?if \(!existing\.data\) \{/,
  "join approval must check the binding first so it never marks approved with the insert silently dropped");
assert.match(blockOf("rejectLiveRegistration"), /approved: false,\s*reject_reason: textOrNull\(reason\)/);
assert.match(blockOf("rejectLiveJoinRequest"), /approved: false,\s*reject_reason: textOrNull\(reason\)/);
assert.match(writesSource, /if \(result\.data\.reviewed_at != null\) throw new Error\("This request has already been reviewed"\)/,
  "an already-reviewed request must not be reviewable twice");
for (const name of ["approveLiveRegistration", "rejectLiveRegistration", "approveLiveJoinRequest", "rejectLiveJoinRequest"]) {
  assert.match(blockOf(name), /\.is\("reviewed_at", null\)/,
    `${name} must only match a still-open request, so a second reviewer cannot silently flip the verdict`);
}
// 审核页的部门/角色下拉给的是当前活跃公司的选项，申请人可能落到另一家公司 —— 跨公司 id 不许绑上去。
assert.match(blockOf("approveLiveRegistration"), /idScopedToCompany\(client, "roles", roleId, companyId\)/);
assert.match(blockOf("approveLiveRegistration"), /idScopedToCompany\(client, "departments", departmentId, companyId\)/);
assert.match(writesSource, /async function idScopedToCompany\(client, table, id, companyId\)[\s\S]*?\.eq\("id", id\)\.eq\("company_id", companyId\)\.maybeSingle\(\)/);

// ---- ③ 每个写导出都挂在失效链上（finishWrite 或直接 invalidateLiveTables）----
for (const name of WRITE_EXPORTS) {
  assert.match(blockOf(name), /finishWrite\(|invalidateLiveTables\(/,
    `${name} must invalidate its tables so the next read rebuilds from the DB`);
}
assert.match(writesSource, /async function finishWrite\(result, \.\.\.tables\) \{[\s\S]*?await invalidateLiveTables\(tables\);/);

// ---- 页面接线：每个写动作都先落库再动本地 state ----
for (const wiring of [
  /await runMemberWrite\(\(\) => setLiveRolePermissions\(roleId, nextGrants\)\)/,
  /await runMemberWrite\(\(\) => createLiveRole\(\{ name \}\)\)/,
  /await runMemberWrite\(\(\) => renameLiveRole\(roleId, name\)\)/,
  /await runMemberWrite\(\(\) => deleteLiveRole\(roleId\)\)/,
  /await runMemberWrite\(\(\) => deleteLiveDepartment\(departmentId\)\)/,
  /await runMemberWrite\(\(\) => createLiveDepartment\(/,
  /await runMemberWrite\(\(\) => updateLiveDepartment\(existing\.id, \{/,
  /await runMemberWrite\(\(\) => createLiveMember\(\{/,
  /await runMemberWrite\(\(\) => updateLiveMember\(member\.id, \{/,
  /await runMemberWrite\(\(\) => deactivateLiveMember\(member\.id\)\)/,
  /await runMemberWrite\(\(\) => approveLiveRegistration\(id, \{/,
  /await runMemberWrite\(\(\) => rejectLiveRegistration\(id\)\)/
]) {
  assert.match(membersSource, wiring, `members.js is missing a live write wiring: ${wiring}`);
}
assert.match(companiesSource, /runWrite\(\(\) => createLiveCompany\(name\)\)/);
assert.match(companiesSource, /runWrite\(\(\) => renameLiveCompany\(company\.id, name\)\)/);
assert.match(companiesSource, /runWrite\(\(\) => deleteLiveCompany\(company\.id\)\)/);
assert.match(companiesSource, /runWrite\(\(\) => setLiveCompanyAiBatch\(company\.id, next\)\)/);
assert.match(reviewSource, /approveLiveJoinRequest\(review\.id\)/);
assert.match(reviewSource, /rejectLiveJoinRequest\(review\.id\)/);
// 一次只允许一个写在飞，失败弹原始报错（含 RLS 拒绝），过期挂载丢弃结果 —— 与更新日志 runWrite 同套路。
assert.match(membersSource, /if \(memberWritePending\) return null;[\s\S]*?window\.alert\(error\?\.message \|\| String\(error\)\)/);
assert.match(membersSource, /attachMemberReviewController\(\{ state, rerender: rerenderMembers, scope, runWrite: runMemberWrite \}\)/);
assert.match(membersSource, /attachMemberCompanyController\(\{ state, rerender: rerenderMembers, scope, runWrite: runMemberWrite \}\)/);

// ---- 销毁性真写都要二次确认，且文案走三语字典 ----
for (const confirmKey of ["members.permission.removeRoleConfirm", "members.department.removeConfirm", "members.detail.removeConfirm"]) {
  for (const lang of ["zh", "en", "fr"]) {
    assert.equal(typeof memberDictionaries[lang][confirmKey], "string", `${lang}.${confirmKey} missing`);
  }
  assert.match(membersSource, new RegExp(`memberCopy\\("${confirmKey.replace(/\./g, "\\.")}"\\)`),
    `${confirmKey} must be used by the confirm prompt guarding its destructive write`);
}
assert.doesNotMatch(membersSource, /老板/, "member copy must never say 老板");

console.log("mem-live-write-1 contracts: PASS (permission-lit member writes, supabase call shape, invalidation chain)");
