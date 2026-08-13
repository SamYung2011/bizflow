// 成員域 live 寫路徑（G-mem-13）。形態對齊 7 月 P1 第一批已上線的
// live-orders-writes.js / live-warranty-writes.js / live-task-writes.js：
// 每個導出 = 一次 supabase 真寫 + 寫後按依賴表失效（invalidateLiveTables →
// live-snapshot-dependencies 再把 members.json / team-extras.json 逐出）。
// 權限判定原樣沿用 root-site/team/members.js:buildMemberAccess 的權限矩陣，
// 不新增權限點；渲染層 disable 只是第一道，這裡再判一次，RLS 是最後兜底。

import { getCurrentUser, getSession, getSupabaseClient, RBAC_KEYS } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

const DEFAULT_ROLE_NAME = "普通員工";

// 與 members.js:buildMemberAccess 的四個寫權限位逐字一致（那邊多的 !authenticated 分支
// 是未登入的靜態演示態，走不到 live 寫）。scripts/test-mem-live-write-1.mjs 鎖住兩邊不漂移。
export function memberWriteAccess(currentUser) {
  return {
    canManageEmployees: currentUser.isSuperAdmin === true || currentUser.isAdminOfAny === true || currentUser.hasPermission("can_manage_employees"),
    canApproveRegistration: currentUser.hasPermission("can_approve_registration"),
    canManageRoles: currentUser.hasPermission("can_manage_roles"),
    canManageCompanies: currentUser.isSuperAdmin === true
  };
}

function throwIfError(error) {
  if (error) throw error;
}

function requiredText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(message);
  return text;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "")).filter(Boolean))];
}

// capability = memberWriteAccess 上的權限位名，寫路徑再判一次，
// 不信任渲染層是否真的把按鈕 disable 住。
async function writeContext(capability) {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || !currentUser?.employeeId) {
    throw new Error("Authenticated member write context required");
  }
  if (memberWriteAccess(currentUser)[capability] !== true) {
    throw new Error(`Member write permission required: ${capability}`);
  }
  return { client, session, currentUser };
}

function requireActiveCompany(currentUser) {
  const companyId = currentUser?.activeCompanyId;
  if (!companyId) throw new Error("Active company required for member writes");
  return companyId;
}

async function finishWrite(result, ...tables) {
  throwIfError(result.error);
  await invalidateLiveTables(tables);
  return result.data;
}

async function defaultRoleIdFor(client, companyId) {
  const result = await client.from("roles").select("id")
    .eq("company_id", companyId).eq("name", DEFAULT_ROLE_NAME).maybeSingle();
  throwIfError(result.error);
  return result.data?.id ?? null;
}

// 审核页的部门 / 角色下拉给的是「当前活跃公司」的选项,而申请人可能落到另一家公司。
// 跨公司的 id 直接丢弃,不让它绑上去(审核本身照常通过,不因为一个下拉不匹配就卡住)。
async function idScopedToCompany(client, table, id, companyId) {
  if (!id) return null;
  const result = await client.from(table).select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
  throwIfError(result.error);
  return result.data?.id ?? null;
}

// ---------- 職位 / 權限矩陣（canManageRoles）----------

export async function createLiveRole({ name }) {
  const { client, currentUser } = await writeContext("canManageRoles");
  const companyId = requireActiveCompany(currentUser);
  const result = await client.from("roles").insert({
    company_id: companyId,
    name: requiredText(name, "Role name is required"),
    permissions: Object.fromEntries(RBAC_KEYS.map((key) => [key, false]))
  }).select("*").single();
  return finishWrite(result, "roles");
}

export async function renameLiveRole(roleId, name) {
  const { client } = await writeContext("canManageRoles");
  if (!roleId) throw new Error("Role id is required");
  const result = await client.from("roles")
    .update({ name: requiredText(name, "Role name is required") })
    .eq("id", roleId).select("*").single();
  return finishWrite(result, "roles");
}

// 權限矩陣的勾選格。roles.permissions 是 JSONB，快照只投影 RBAC_KEYS 這 9 個鍵，
// 所以先讀回原行再合併寫回 —— 否則庫裡的 can_post_update_log 之類會被整包覆蓋掉。
export async function setLiveRolePermissions(roleId, grants) {
  const { client } = await writeContext("canManageRoles");
  if (!roleId) throw new Error("Role id is required");
  const current = await client.from("roles").select("permissions").eq("id", roleId).single();
  throwIfError(current.error);
  const patch = Object.fromEntries(RBAC_KEYS.map((key) => [key, grants?.[key] === true]));
  const result = await client.from("roles")
    .update({ permissions: { ...(current.data?.permissions ?? {}), ...patch } })
    .eq("id", roleId).select("*").single();
  return finishWrite(result, "roles");
}

export async function deleteLiveRole(roleId) {
  const { client } = await writeContext("canManageRoles");
  if (!roleId) throw new Error("Role id is required");
  const result = await client.from("roles").delete().eq("id", roleId).select("id").single();
  // employee_companies.role_id 是 ON DELETE SET NULL，綁定行跟著變，一起失效。
  return finishWrite(result, "roles", "employee_companies");
}

// ---------- 部門（canManageRoles，沿用頁面現有口徑）----------

async function syncDepartmentMembers(client, departmentId, memberIds, previousMemberIds) {
  const next = uniqueIds(memberIds);
  const previous = uniqueIds(previousMemberIds);
  const added = next.filter((id) => !previous.includes(id));
  const removed = previous.filter((id) => !next.includes(id));
  if (added.length) {
    const insert = await client.from("employee_departments")
      .insert(added.map((employeeId) => ({ employee_id: employeeId, department_id: departmentId })));
    throwIfError(insert.error);
  }
  if (removed.length) {
    const remove = await client.from("employee_departments").delete()
      .eq("department_id", departmentId).in("employee_id", removed);
    throwIfError(remove.error);
  }
  return { added, removed };
}

export async function createLiveDepartment({ name, memberIds = [] }) {
  const { client, currentUser } = await writeContext("canManageRoles");
  const companyId = requireActiveCompany(currentUser);
  const created = await client.from("departments").insert({
    company_id: companyId,
    name: requiredText(name, "Department name is required")
  }).select("*").single();
  throwIfError(created.error);
  await syncDepartmentMembers(client, created.data.id, memberIds, []);
  await invalidateLiveTables(["departments", "employee_departments"]);
  return created.data;
}

export async function updateLiveDepartment(departmentId, { name, memberIds = [], previousMemberIds = [] }) {
  const { client } = await writeContext("canManageRoles");
  if (!departmentId) throw new Error("Department id is required");
  const updated = await client.from("departments")
    .update({ name: requiredText(name, "Department name is required") })
    .eq("id", departmentId).select("*").single();
  throwIfError(updated.error);
  await syncDepartmentMembers(client, departmentId, memberIds, previousMemberIds);
  await invalidateLiveTables(["departments", "employee_departments"]);
  return updated.data;
}

export async function deleteLiveDepartment(departmentId) {
  const { client } = await writeContext("canManageRoles");
  if (!departmentId) throw new Error("Department id is required");
  const result = await client.from("departments").delete().eq("id", departmentId).select("id").single();
  // 部門成員綁定隨 FK cascade 走，任務的 department_id 變回 NULL（公司內可見）。
  return finishWrite(result, "departments", "employee_departments", "employee_tasks");
}

// ---------- 成員（canManageEmployees）----------

export async function createLiveMember({ name, position, email, phone, departmentId, roleId }) {
  const { client, currentUser } = await writeContext("canManageEmployees");
  const companyId = requireActiveCompany(currentUser);
  const created = await client.from("employees").insert({
    name: requiredText(name, "Member name is required"),
    role: textOrNull(position),
    email: textOrNull(email),
    phone: textOrNull(phone),
    company_id: companyId,
    kind: "employee"
  }).select("*").single();
  throwIfError(created.error);
  const bindingRoleId = roleId || await defaultRoleIdFor(client, companyId);
  const binding = await client.from("employee_companies").insert({
    employee_id: created.data.id,
    company_id: companyId,
    is_default: true,
    is_company_admin: false,
    role_id: bindingRoleId
  });
  if (binding.error) {
    // 對齊原版 team/src/views/Employees.jsx:283-286：綁定失敗就把員工行回滾掉，
    // 不留下一個沒有公司歸屬的孤兒（會導致切換器空、看不到任何任務）。
    await client.from("employees").delete().eq("id", created.data.id);
    throw binding.error;
  }
  if (departmentId) {
    const department = await client.from("employee_departments")
      .insert({ employee_id: created.data.id, department_id: departmentId });
    throwIfError(department.error);
  }
  await invalidateLiveTables(["employees", "employee_companies", "employee_departments"]);
  return created.data;
}

export async function updateLiveMember(employeeId, {
  position, email, phone, roleId = null, departmentId = null, previousDepartmentId = null
}) {
  const { client, currentUser } = await writeContext("canManageEmployees");
  if (!employeeId) throw new Error("Member id is required");
  const companyId = requireActiveCompany(currentUser);
  // employees.role 存的是職位文本（快照映射成 position），角色綁定另存 employee_companies.role_id。
  const updated = await client.from("employees").update({
    role: textOrNull(position),
    email: textOrNull(email),
    phone: textOrNull(phone)
  }).eq("id", employeeId).select("*").single();
  throwIfError(updated.error);
  const tables = ["employees"];
  if (roleId !== null) {
    const binding = await client.from("employee_companies")
      .update({ role_id: roleId || null })
      .eq("employee_id", employeeId).eq("company_id", companyId);
    throwIfError(binding.error);
    tables.push("employee_companies");
  }
  if (departmentId !== previousDepartmentId) {
    if (previousDepartmentId) {
      const remove = await client.from("employee_departments").delete()
        .eq("employee_id", employeeId).eq("department_id", previousDepartmentId);
      throwIfError(remove.error);
    }
    if (departmentId) {
      const add = await client.from("employee_departments")
        .insert({ employee_id: employeeId, department_id: departmentId });
      throwIfError(add.error);
    }
    tables.push("employee_departments");
  }
  await invalidateLiveTables(tables);
  return updated.data;
}

// 「移出團隊」= 停用（快照的 status 由 employees.active 推出）。
// deactivated_at 刻意不寫：migration 048 的 pg_cron 會在 6 天後按該欄位真刪員工 + auth 帳號，
// 那是原版「解除最後一家公司綁定 = 銷號」的語義（G-mem-14），不是本按鈕的語義。
export async function deactivateLiveMember(employeeId) {
  const { client } = await writeContext("canManageEmployees");
  if (!employeeId) throw new Error("Member id is required");
  const result = await client.from("employees")
    .update({ active: false })
    .eq("id", employeeId).select("*").single();
  return finishWrite(result, "employees");
}

// ---------- 公司（canManageCompanies = super admin）----------

export async function createLiveCompany(name) {
  const { client } = await writeContext("canManageCompanies");
  // upsert onConflict name：對齊原版 Companies.jsx:32，防同名併發插入撞 UNIQUE。
  const result = await client.from("companies")
    .upsert({ name: requiredText(name, "Company name is required") }, { onConflict: "name" })
    .select("*").single();
  return finishWrite(result, "companies");
}

export async function renameLiveCompany(companyId, name) {
  const { client } = await writeContext("canManageCompanies");
  if (!companyId) throw new Error("Company id is required");
  const result = await client.from("companies")
    .update({ name: requiredText(name, "Company name is required") })
    .eq("id", companyId).select("*").single();
  return finishWrite(result, "companies");
}

export async function deleteLiveCompany(companyId) {
  const { client } = await writeContext("canManageCompanies");
  if (!companyId) throw new Error("Company id is required");
  const result = await client.from("companies").delete().eq("id", companyId).select("id").single();
  return finishWrite(result, "companies", "employee_companies");
}

export async function setLiveCompanyAiBatch(companyId, enabled) {
  const { client } = await writeContext("canManageCompanies");
  if (!companyId) throw new Error("Company id is required");
  const result = await client.from("companies")
    .update({ feature_ai_batch: enabled === true })
    .eq("id", companyId).select("*").single();
  return finishWrite(result, "companies");
}

// ---------- 帳號審核（canApproveRegistration）----------

async function loadPendingRow(client, table, id) {
  const result = await client.from(table).select("*").eq("id", id).single();
  throwIfError(result.error);
  if (result.data.reviewed_at != null) throw new Error("This request has already been reviewed");
  return result.data;
}

export async function approveLiveRegistration(pendingId, { departmentId = null, roleId = null } = {}) {
  const { client, session } = await writeContext("canApproveRegistration");
  if (!pendingId) throw new Error("Registration request id is required");
  const pending = await loadPendingRow(client, "task_pending", pendingId);
  const companyName = requiredText(pending.company_name, "The registration request has no company name");
  const company = await client.from("companies").select("id").eq("name", companyName).maybeSingle();
  throwIfError(company.error);
  // 原版在找不到公司時 prompt 新建 / 改綁（G-mem-17 未銷項），這裡不臆造分支，直接讓審核方知情。
  if (!company.data?.id) throw new Error(`Company not found for this request: ${companyName}`);
  const companyId = company.data.id;
  const created = await client.from("employees").insert({
    name: pending.name,
    email: pending.email,
    user_id: pending.user_id,
    company_id: companyId,
    kind: "task"
  }).select("*").single();
  throwIfError(created.error);
  const binding = await client.from("employee_companies").insert({
    employee_id: created.data.id,
    company_id: companyId,
    is_default: true,
    is_company_admin: false,
    role_id: await idScopedToCompany(client, "roles", roleId, companyId) || await defaultRoleIdFor(client, companyId)
  });
  if (binding.error) {
    await client.from("employees").delete().eq("id", created.data.id);
    throw binding.error;
  }
  const scopedDepartmentId = await idScopedToCompany(client, "departments", departmentId, companyId);
  if (scopedDepartmentId) {
    const department = await client.from("employee_departments")
      .insert({ employee_id: created.data.id, department_id: scopedDepartmentId });
    throwIfError(department.error);
  }
  const reviewed = await client.from("task_pending").update({
    approved: true,
    reviewed_at: new Date().toISOString(),
    reviewed_by: session.user.id
  }).eq("id", pendingId).is("reviewed_at", null).select("id").single();
  throwIfError(reviewed.error);
  await invalidateLiveTables(["task_pending", "employees", "employee_companies", "employee_departments"]);
  return created.data;
}

export async function rejectLiveRegistration(pendingId, reason = null) {
  const { client, session } = await writeContext("canApproveRegistration");
  if (!pendingId) throw new Error("Registration request id is required");
  // .is("reviewed_at", null) 是防重闸:已经处理过的申请匹配不到行,写会直接报错而不是悄悄改掉结论。
  const result = await client.from("task_pending").update({
    approved: false,
    reject_reason: textOrNull(reason),
    reviewed_at: new Date().toISOString(),
    reviewed_by: session.user.id
  }).eq("id", pendingId).is("reviewed_at", null).select("*").single();
  return finishWrite(result, "task_pending");
}

export async function approveLiveJoinRequest(joinId) {
  const { client, session } = await writeContext("canApproveRegistration");
  if (!joinId) throw new Error("Join request id is required");
  const pending = await loadPendingRow(client, "company_join_pending", joinId);
  // 對齊原版 AccountReview.jsx:39-61：先查綁定在不在，不在才 INSERT，
  // 插失敗立刻拋 —— 不允許出現「標了 approved 但綁定沒建」的靜默半成品。
  const existing = await client.from("employee_companies").select("id")
    .eq("employee_id", pending.employee_id).eq("company_id", pending.company_id).maybeSingle();
  throwIfError(existing.error);
  if (!existing.data) {
    const binding = await client.from("employee_companies").insert({
      employee_id: pending.employee_id,
      company_id: pending.company_id,
      is_default: false,
      is_company_admin: false,
      role_id: await defaultRoleIdFor(client, pending.company_id)
    });
    throwIfError(binding.error);
  }
  const reviewed = await client.from("company_join_pending").update({
    approved: true,
    reviewed_at: new Date().toISOString(),
    reviewed_by: session.user.id
  }).eq("id", joinId).is("reviewed_at", null).select("*").single();
  throwIfError(reviewed.error);
  await invalidateLiveTables(["company_join_pending", "employee_companies"]);
  return reviewed.data;
}

export async function rejectLiveJoinRequest(joinId, reason = null) {
  const { client, session } = await writeContext("canApproveRegistration");
  if (!joinId) throw new Error("Join request id is required");
  const result = await client.from("company_join_pending").update({
    approved: false,
    reject_reason: textOrNull(reason),
    reviewed_at: new Date().toISOString(),
    reviewed_by: session.user.id
  }).eq("id", joinId).is("reviewed_at", null).select("*").single();
  return finishWrite(result, "company_join_pending");
}
