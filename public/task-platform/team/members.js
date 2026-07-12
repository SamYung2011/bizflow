// team 站团队成员桌面屏(Figma 443:5035)。成员与统计只读 provider 契约,不直写样板数据。

import { getTeamMembersData, getCurrentUser, getUnread } from "../data/provider.js";
import { getSession } from "../data/auth.js";
import { memberT as pageT } from "./members-i18n.js";
import { renderMemberDetailDialog } from "./members-detail.js";
import { attachMemberReviewController, renderMemberReviews } from "./members-review.js";
import { renderMemberDepartments } from "./members-departments.js";
import { renderDepartmentModal } from "./members-department-modal.js";
import { renderMemberPermissions } from "./members-permissions.js";
import { attachMemberCommissionController, renderMemberCommission } from "./members-commission.js";
import { attachMemberUpdateLogController, renderMemberUpdateLogs } from "./members-update-logs.js";
import { attachMemberCompanyController, renderMemberCompanies } from "./members-companies.js";

const HELEN_EMAIL = "a1017339632@gmail.com";
const [data, currentUser, session] = await Promise.all([getTeamMembersData(), getCurrentUser(), getSession()]);
const authenticated = typeof currentUser?.hasPermission === "function";
const sessionEmail = String(session?.user?.email || "").toLowerCase();
// Mirrors bizflow_samyung/team/src/admin.jsx:28,32: sales can always view their own commission.
const canViewCommission = !authenticated || currentUser.isSuperAdmin === true ||
  currentUser.hasPermission("can_view_commission") || currentUser.role === "銷售";
const memberAccess = {
  // Mirrors bizflow_samyung/team/src/admin.jsx:29-37.
  canManageEmployees: !authenticated || currentUser.isSuperAdmin === true || currentUser.isAdminOfAny === true ||
    currentUser.hasPermission("can_manage_employees"),
  canApproveRegistration: !authenticated || currentUser.hasPermission("can_approve_registration"),
  canViewCommission,
  canManageRoles: !authenticated || currentUser.hasPermission("can_manage_roles"),
  canManageCompanies: !authenticated || currentUser.isSuperAdmin === true,
  // Mirrors bizflow_samyung/team/src/views/UpdateLog.jsx:8,16.
  canWriteUpdates: !authenticated || currentUser.isBfAdmin === true || sessionEmail === HELEN_EMAIL,
  canAdministerUpdateComments: !authenticated || currentUser.isBfAdmin === true,
  // Mirrors bizflow_samyung/team/src/admin.jsx:50-52: every authenticated non-super user is self-only.
  commissionLockedEmployeeId: authenticated && currentUser.isSuperAdmin !== true ? currentUser.id : null
};
const visibleTabKeys = authenticated
  ? new Set([
      "updates",
      ...(memberAccess.canManageEmployees ? ["members"] : []),
      ...(memberAccess.canApproveRegistration ? ["reviews"] : []),
      ...(memberAccess.canViewCommission ? ["commission"] : []),
      // Mirrors bizflow_samyung/team/src/admin.jsx:33,37 and RolesAndDepartments.jsx:22-53.
      ...(memberAccess.canManageRoles ? ["permissions", "departments"] : []),
      ...(memberAccess.canManageCompanies ? ["companies"] : [])
    ])
  : new Set(data.tabs.map((tab) => tab.key));
const visibleTabs = data.tabs.filter((tab) => visibleTabKeys.has(tab.key));
const state = {
  members: data.members.map((member) => ({
    ...member,
    tasks: {
      tasking: member.tasks.tasking.map((task) => ({ ...task })),
      tasked: member.tasks.tasked.map((task) => ({ ...task }))
    }
  })),
  reviews: data.reviews.map((review) => ({ ...review })),
  reviewHistory: data.reviewHistory.map((review) => ({ ...review })),
  joinPending: data.joinPending.map((review) => ({ ...review })),
  joinHistory: data.joinHistory.map((review) => ({ ...review })),
  reviewMode: "registration",
  departments: data.departments.map((department) => ({ ...department, memberIds: department.memberIds.slice() })),
  permissions: {
    rows: data.permissions.rows.map((row) => ({ ...row })),
    roles: data.permissions.roles.map((role) => ({ ...role, grants: { ...role.grants } }))
  },
  commission: data.commission.map((entry) => ({ ...entry })),
  commissionSale: memberAccess.commissionLockedEmployeeId ?? "all",
  commissionMonth: "all",
  updateLogs: data.updateLogs.map((entry) => ({
    ...entry,
    comments: entry.comments.map((comment) => ({ ...comment }))
  })),
  editingUpdateId: null,
  updateLogUser: {
    id: session?.user?.id || currentUser?.userId || "",
    name: currentUser?.name || data.currentUserName || ""
  },
  companies: data.companies.map((company) => ({ ...company })),
  editingCompanyId: null,
  summary: { ...data.summary, reviewPending: data.reviews.length + data.joinPending.length },
  activeTab: visibleTabs[0]?.key ?? "updates",
  access: memberAccess,
  liveReadOnly: authenticated,
  departmentFilter: null,
  addMemberOpen: false,
  memberDetailOpen: false,
  selectedMemberId: null,
  memberDetailTab: "basic",
  departmentModalOpen: false,
  departmentDraft: null,
  departmentReturnFocus: null,
  editingPermissionRoleId: null
};
let currentHelpers = null;

function renderStatCard({ title, value, tone }, { escapeHtml }) {
  const mod = tone ? ` team-members-stat--${tone}` : "";
  return `<article class="team-members-stat${mod}">
    <span class="team-members-stat__title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
    <span class="team-members-stat__value">${escapeHtml(value)}</span>
  </article>`;
}

function renderTab(tab, helpers) {
  const { escapeHtml, lang, redDot } = helpers;
  const text = pageT(lang, `members.tab.${tab.key}`);
  const active = tab.key === state.activeTab;
  const update = tab.key === "reviews" ? state.reviews.length + state.joinPending.length > 0 : tab.update;
  const mod = active ? " team-members-tab--active" : "";
  return `<button type="button" class="team-members-tab${mod}" data-members-tab="${escapeHtml(tab.key)}" role="tab" aria-selected="${active}" title="${escapeHtml(text)}">
    <span>${escapeHtml(text)}</span>
    ${update ? redDot() : ""}
  </button>`;
}

function renderMemberCard(member, helpers) {
  const { escapeHtml, lang } = helpers;
  const departed = member.status === "departed";
  const dept = member.departmentName ?? pageT(lang, `members.dept.${member.dept}`);
  const role = member.roleName ?? pageT(lang, `members.role.${member.role}`);
  const status = pageT(lang, departed ? "members.status.departed" : "members.status.active");
  const joinedPill = member.joinedAt ? `${pageT(lang, departed ? "members.status.departed" : "members.joined")}： ${member.joinedAt}` : null;
  const mod = departed ? " member-card--off team-member-card--off" : "";

  return `<button type="button" class="member-card team-member-card${mod}" data-member-detail-open="${escapeHtml(member.id)}" title="${escapeHtml(member.name)}">
    <span class="avatar--initial team-member-card__avatar-initial" style="--component-width:64px;--component-height:64px">${escapeHtml((member.name || "?").trim().charAt(0).toUpperCase())}</span>
    <div class="team-member-card__body">
      <h2 class="team-member-card__name" title="${escapeHtml(member.name)}">${escapeHtml(member.name)}</h2>
      <p class="team-member-card__meta" title="${escapeHtml(`${dept} / ${role}`)}">${escapeHtml(dept)} / ${escapeHtml(role)}</p>
    </div>
    ${joinedPill ? `<span class="team-member-card__pill ${departed ? "team-member-card__pill--neutral" : "team-member-card__pill--blue"}" title="${escapeHtml(`${status} · ${joinedPill}`)}">
      ${escapeHtml(joinedPill)}
    </span>` : ""}
  </button>`;
}

function renderAddCard({ escapeHtml, icon, lang }) {
  const text = pageT(lang, "members.add");
  return `<button type="button" class="member-card member-card--add team-member-card team-member-card--add" data-member-add-open title="${escapeHtml(text)}"${state.liveReadOnly ? " disabled aria-disabled=\"true\"" : ""}>
    ${icon("icon-add-line-add", "icon-add-line team-member-card__add-icon")}
    <span class="team-member-card__add-label">${escapeHtml(text)}</span>
  </button>`;
}

function renderAddMemberDialog(helpers) {
  if (!state.access.canManageEmployees) return "";
  const { escapeHtml, lang } = helpers;
  const tt = (key) => pageT(lang, key);
  const defaults = data.form.defaults;
  const departmentOptions = data.form.departments.map((department) => {
    const value = typeof department === "string" ? department : department.id;
    const label = typeof department === "string" ? tt(`members.dept.${department}`) : department.name;
    return `<option value="${escapeHtml(value)}"${value === defaults.dept ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const roleOptions = data.form.roles.map((role) => {
    const value = typeof role === "string" ? role : role.id;
    const label = typeof role === "string" ? tt(`members.role.${role}`) : role.name;
    return `<option value="${escapeHtml(value)}"${value === defaults.role ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const openClass = state.addMemberOpen ? " members-modal-overlay--open" : "";

  return `<div class="members-modal-overlay${openClass}" data-member-add-overlay${state.addMemberOpen ? "" : ' aria-hidden="true"'}>
    <form class="tp-component form-new-member" data-member-add-form role="dialog" aria-modal="true" aria-label="${escapeHtml(tt("members.add"))}">
      <button type="button" class="form-new-member__close" data-member-add-close aria-label="${escapeHtml(tt("members.form.close"))}"></button>
      <span class="avatar--initial form-new-member__avatar" data-member-form-avatar aria-hidden="true">${escapeHtml(defaults.name.charAt(0).toUpperCase())}</span>
      <div class="form-new-member__fields">
        <div class="form-new-member__row">
          <label class="form-new-member__field">
            <span class="form-new-member__label">${escapeHtml(tt("members.form.name"))}</span>
            <input class="form-new-member__control" name="name" value="${escapeHtml(defaults.name)}" required autocomplete="name">
          </label>
          <label class="form-new-member__field">
            <span class="form-new-member__label">${escapeHtml(tt("members.form.position"))}</span>
            <input class="form-new-member__control" name="position" value="${escapeHtml(defaults.position)}" placeholder="${escapeHtml(tt("members.form.positionPlaceholder"))}">
          </label>
        </div>
        <label class="form-new-member__field">
          <span class="form-new-member__label">${escapeHtml(tt("members.form.email"))}</span>
          <input class="form-new-member__control" name="email" type="email" value="${escapeHtml(defaults.email)}" required autocomplete="email">
        </label>
        <label class="form-new-member__field">
          <span class="form-new-member__label">${escapeHtml(tt("members.form.joinedAt"))}</span>
          <input class="form-new-member__control" name="joinedAt" value="${escapeHtml(defaults.joinedAt)}" required>
        </label>
        <label class="form-new-member__field">
          <span class="form-new-member__label">${escapeHtml(tt("members.form.department"))}</span>
          <select class="form-new-member__control" name="dept">${departmentOptions}</select>
        </label>
        <label class="form-new-member__field">
          <span class="form-new-member__label">${escapeHtml(tt("members.form.permission"))}</span>
          <select class="form-new-member__control" name="role">${roleOptions}</select>
        </label>
      </div>
      <footer class="form-new-member__footer">
        <button type="button" class="form-new-member__button form-new-member__button--cancel" data-member-add-close>${escapeHtml(tt("members.form.cancel"))}</button>
        <button type="submit" class="form-new-member__button form-new-member__button--submit">${escapeHtml(tt("members.form.submit"))}</button>
      </footer>
    </form>
  </div>`;
}

function renderActiveTab(helpers) {
  if (state.activeTab === "reviews") return renderMemberReviews({ state, data, helpers });
  if (state.activeTab === "departments") return renderMemberDepartments({ state, helpers });
  if (state.activeTab === "permissions") return renderMemberPermissions({ state, helpers });
  if (state.activeTab === "commission") return renderMemberCommission({ state, data, helpers });
  if (state.activeTab === "updates") return renderMemberUpdateLogs({ state, helpers });
  if (state.activeTab === "companies") return renderMemberCompanies({ state, helpers });
  if (state.activeTab !== "members") return "";
  const members = state.departmentFilter
    ? state.members.filter((member) => state.departments.find((department) => department.id === state.departmentFilter)?.memberIds.includes(member.id))
    : state.members;
  return `<div class="team-members-grid">
    ${members.map((member) => renderMemberCard(member, helpers)).join("")}
    ${state.access.canManageEmployees ? renderAddCard(helpers) : ""}
  </div>`;
}

export function renderTeamMembers({ icon, escapeHtml, lang, redDot }) {
  currentHelpers = { icon, escapeHtml, lang, redDot };
  const tt = (key) => pageT(lang, key);
  const helpers = { icon, escapeHtml, lang, redDot };
  const stats = [
    { title: tt("members.stat.total"), value: state.summary.total, tone: "" },
    { title: tt("members.stat.active"), value: state.summary.active, tone: "blue" },
    { title: tt("members.stat.review"), value: state.summary.reviewPending, tone: "yellow" },
    { title: tt("members.stat.departed"), value: state.summary.departed, tone: "gray" }
  ];

  return `<div class="team-members-page" data-live-read-only="${state.liveReadOnly}">
    <h1 class="team-members-title" title="${escapeHtml(tt("members.title"))}">${escapeHtml(tt("members.title"))}</h1>
    ${state.access.canManageEmployees ? `<section class="team-members-stats">${stats.map((stat) => renderStatCard(stat, helpers)).join("")}</section>` : ""}
    <section class="team-members-panel">
      <div class="team-members-tabs" role="tablist">${visibleTabs.map((tab) => renderTab(tab, helpers)).join("")}</div>
      <div class="team-members-content">${renderActiveTab(helpers)}</div>
    </section>
    ${renderAddMemberDialog(helpers)}
    ${renderMemberDetailDialog({ state, data, helpers })}
    ${renderDepartmentModal({ state, helpers })}
  </div>`;
}

function rerenderMembers({ focusForm = false, restoreAddFocus = false, focusDetail = false, restoreDetailFocus = false, focusDepartment = false, restoreDepartmentFocus = false } = {}) {
  const page = document.querySelector(".team-members-page");
  if (!page || !currentHelpers) return;
  page.outerHTML = renderTeamMembers(currentHelpers);
  if (focusForm) document.querySelector('[data-member-add-form] input[name="name"]')?.focus();
  if (restoreAddFocus) document.querySelector("[data-member-add-open]")?.focus();
  if (focusDetail) document.querySelector("[data-member-detail-close]")?.focus();
  if (restoreDetailFocus && state.selectedMemberId) {
    document.querySelector(`[data-member-detail-open="${CSS.escape(state.selectedMemberId)}"]`)?.focus();
  }
  if (focusDepartment) document.querySelector('.modal-add-dept input[name="name"]')?.focus();
  if (restoreDepartmentFocus && state.departmentReturnFocus) {
    const selector = state.departmentReturnFocus === "add"
      ? "[data-department-add]"
      : `[data-department-card="${CSS.escape(state.departmentReturnFocus)}"] [data-department-edit]`;
    document.querySelector(selector)?.focus();
  }
}

function closeAddMemberDialog() {
  state.addMemberOpen = false;
  rerenderMembers({ restoreAddFocus: true });
}

function closeMemberDetail() {
  state.memberDetailOpen = false;
  state.memberDetailTab = "basic";
  rerenderMembers({ restoreDetailFocus: true });
}

function openDepartmentModal(department) {
  const manager = state.members.find((member) => member.name === department?.manager);
  const name = department ? (department.name || pageT(currentHelpers.lang, department.nameKey)) : "";
  state.departmentModalOpen = true;
  state.departmentReturnFocus = department?.id ?? "add";
  state.departmentDraft = {
    id: department?.id ?? null,
    name,
    initialName: name,
    nameKey: department?.nameKey ?? null,
    icon: department?.icon ?? "icon-dept-marketing",
    managerId: manager?.id ?? "",
    memberIds: department?.memberIds.slice() ?? []
  };
  rerenderMembers({ focusDepartment: true });
}

function closeDepartmentModal() {
  state.departmentModalOpen = false;
  rerenderMembers({ restoreDepartmentFocus: true });
  state.departmentDraft = null;
}

document.addEventListener("click", (event) => {
  const pageTab = event.target.closest("[data-members-tab]");
  if (pageTab) {
    const nextTab = pageTab.getAttribute("data-members-tab") || "members";
    if (!visibleTabKeys.has(nextTab)) return;
    state.activeTab = nextTab;
    if (nextTab === "members") state.departmentFilter = null;
    rerenderMembers();
    document.querySelector(`[data-members-tab="${state.activeTab}"]`)?.focus();
    return;
  }
  const permissionToggle = event.target.closest("[data-permission-toggle]");
  if (permissionToggle) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const rowId = permissionToggle.getAttribute("data-permission-toggle");
    const roleId = permissionToggle.getAttribute("data-permission-role");
    const role = state.permissions.roles.find((item) => item.id === roleId);
    if (role?.editable && rowId) role.grants[rowId] = role.grants[rowId] !== true;
    rerenderMembers();
    document.querySelector(`[data-permission-toggle="${CSS.escape(rowId)}"][data-permission-role="${CSS.escape(roleId)}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-permission-role-add]")) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const roleId = `custom-role-${Date.now()}`;
    state.permissions.roles.push({
      id: roleId,
      name: pageT(currentHelpers.lang, "members.permission.customRole"),
      nameKey: null,
      editable: true,
      grants: Object.fromEntries(state.permissions.rows.map((row) => [row.id, false]))
    });
    state.editingPermissionRoleId = roleId;
    rerenderMembers();
    document.querySelector(`[data-permission-role-name="${CSS.escape(roleId)}"]`)?.select();
    return;
  }
  const permissionRoleEdit = event.target.closest("[data-permission-role-edit]");
  if (permissionRoleEdit) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const roleId = permissionRoleEdit.getAttribute("data-permission-role-edit");
    state.editingPermissionRoleId = roleId;
    rerenderMembers();
    document.querySelector(`[data-permission-role-name="${CSS.escape(roleId)}"]`)?.select();
    return;
  }
  const permissionRoleRemove = event.target.closest("[data-permission-role-remove]");
  if (permissionRoleRemove) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const roleId = permissionRoleRemove.getAttribute("data-permission-role-remove");
    state.permissions.roles = state.permissions.roles.filter((role) => role.id !== roleId);
    if (state.editingPermissionRoleId === roleId) state.editingPermissionRoleId = null;
    rerenderMembers();
    document.querySelector("[data-permission-role-add]")?.focus();
    return;
  }
  const departmentCard = event.target.closest("[data-department-card]");
  if (departmentCard && event.target.closest("[data-department-view]")) {
    state.departmentFilter = departmentCard.getAttribute("data-department-card");
    state.activeTab = "members";
    rerenderMembers();
    document.querySelector("[data-members-tab=\"members\"]")?.focus();
    return;
  }
  if (departmentCard && event.target.closest("[data-department-edit]")) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const department = state.departments.find((item) => item.id === departmentCard.getAttribute("data-department-card"));
    if (department) openDepartmentModal(department);
    return;
  }
  if (departmentCard && event.target.closest("[data-department-remove]")) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const id = departmentCard.getAttribute("data-department-card");
    state.departments = state.departments.filter((department) => department.id !== id);
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-add]")) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    openDepartmentModal(null);
    return;
  }
  if (event.target.closest("[data-department-modal-close]") || event.target.matches("[data-department-modal-overlay]")) {
    closeDepartmentModal();
    return;
  }
  const removedDepartmentMember = event.target.closest("[data-department-member-remove]");
  if (removedDepartmentMember && state.departmentDraft) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const id = removedDepartmentMember.getAttribute("data-department-member-remove");
    state.departmentDraft.memberIds = state.departmentDraft.memberIds.filter((memberId) => memberId !== id);
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-member-add]") && state.departmentDraft) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const member = state.members.find((item) => !state.departmentDraft.memberIds.includes(item.id));
    if (member) state.departmentDraft.memberIds.push(member.id);
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-modal-delete]")) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    if (state.departmentDraft?.id) {
      state.departments = state.departments.filter((department) => department.id !== state.departmentDraft.id);
    }
    closeDepartmentModal();
    return;
  }
  const rejectedReview = event.target.closest("[data-member-review-reject]")?.closest("[data-member-review-card]");
  if (rejectedReview) {
    if (state.liveReadOnly || !state.access.canApproveRegistration) return;
    const id = rejectedReview.getAttribute("data-member-review-card");
    state.reviews = state.reviews.filter((review) => review.id !== id);
    state.summary.reviewPending = state.reviews.length + state.joinPending.length;
    rerenderMembers();
    return;
  }
  const memberTrigger = event.target.closest("[data-member-detail-open]");
  if (memberTrigger) {
    state.selectedMemberId = memberTrigger.getAttribute("data-member-detail-open");
    state.memberDetailOpen = true;
    state.memberDetailTab = "basic";
    rerenderMembers({ focusDetail: true });
    return;
  }
  if (event.target.closest("[data-member-detail-close]") || event.target.matches("[data-member-detail-overlay]")) {
    closeMemberDetail();
    return;
  }
  const detailTab = event.target.closest("[data-member-detail-tab]");
  if (detailTab) {
    state.memberDetailTab = detailTab.getAttribute("data-member-detail-tab") || "basic";
    rerenderMembers();
    document.querySelector(`[data-member-detail-tab="${state.memberDetailTab}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-member-detail-remove]")) {
    if (state.liveReadOnly || !state.access.canManageEmployees) return;
    const member = state.members.find((item) => item.id === state.selectedMemberId);
    if (member && member.status !== "departed") {
      member.status = "departed";
      state.summary.active = Math.max(0, state.summary.active - 1);
      state.summary.departed += 1;
    }
    closeMemberDetail();
    return;
  }
  if (event.target.closest("[data-member-add-open]")) {
    if (state.liveReadOnly || !state.access.canManageEmployees) return;
    state.addMemberOpen = true;
    rerenderMembers({ focusForm: true });
    return;
  }
  if (event.target.closest("[data-member-add-close]") || event.target.matches("[data-member-add-overlay]")) {
    closeAddMemberDialog();
  }
});

document.addEventListener("submit", (event) => {
  const departmentForm = event.target.closest("[data-department-modal-form]");
  if (departmentForm && state.departmentDraft) {
    event.preventDefault();
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const values = new FormData(departmentForm);
    state.departmentDraft.name = String(values.get("name") || "").trim();
    state.departmentDraft.managerId = String(values.get("managerId") || "");
    const manager = state.members.find((member) => member.id === state.departmentDraft.managerId)?.name ?? "";
    const existing = state.departments.find((department) => department.id === state.departmentDraft.id);
    if (existing) {
      if (state.departmentDraft.name === state.departmentDraft.initialName && state.departmentDraft.nameKey) {
        existing.nameKey = state.departmentDraft.nameKey;
        delete existing.name;
      } else {
        existing.name = state.departmentDraft.name;
        delete existing.nameKey;
      }
      existing.manager = manager;
      existing.memberIds = state.departmentDraft.memberIds.slice();
    } else {
      state.departments.push({
        id: `custom-department-${Date.now()}`,
        name: state.departmentDraft.name,
        icon: state.departmentDraft.icon,
        manager,
        memberIds: state.departmentDraft.memberIds.slice()
      });
    }
    closeDepartmentModal();
    return;
  }
  const reviewForm = event.target.closest("[data-member-review-card]");
  if (reviewForm) {
    event.preventDefault();
    if (state.liveReadOnly || !state.access.canApproveRegistration) return;
    const id = reviewForm.getAttribute("data-member-review-card");
    const review = state.reviews.find((item) => item.id === id);
    if (!review) return;
    const values = new FormData(reviewForm);
    const memberId = `approved-${review.id}`;
    const dept = String(values.get("dept") || review.dept);
    state.members.push({
      id: memberId,
      name: review.name,
      position: String(values.get("position") || review.position),
      email: review.email,
      joinedAt: review.appliedAt,
      dept,
      role: String(values.get("role") || review.role),
      departmentName: data.form.departments.find((item) => (typeof item === "string" ? item : item.id) === dept)?.name ?? dept,
      roleName: data.form.roles.find((item) => (typeof item === "string" ? item : item.id) === String(values.get("role") || review.role))?.name ?? String(values.get("role") || review.role),
      commission: "—",
      openTasks: 0,
      bizflowMainAccess: false,
      status: "active",
      tasks: { tasking: [], tasked: [] }
    });
    state.departments.find((department) => department.id === dept)?.memberIds.push(memberId);
    state.reviews = state.reviews.filter((item) => item.id !== id);
    state.summary.total += 1;
    state.summary.active += 1;
    state.summary.reviewPending = state.reviews.length + state.joinPending.length;
    rerenderMembers();
    return;
  }
  const detailForm = event.target.closest("[data-member-detail-form]");
  if (detailForm) {
    event.preventDefault();
    if (state.liveReadOnly || !state.access.canManageEmployees) return;
    const member = state.members.find((item) => item.id === state.selectedMemberId);
    if (member && state.memberDetailTab === "basic") {
      const values = new FormData(detailForm);
      member.position = String(values.get("position") || "").trim();
      member.email = String(values.get("email") || "").trim();
      member.phone = String(values.get("phone") || "").trim();
      member.dept = String(values.get("dept") || member.dept);
      member.role = String(values.get("role") || member.role);
      member.departmentName = data.form.departments.find((item) => (typeof item === "string" ? item : item.id) === member.dept)?.name ?? member.departmentName;
      member.roleName = data.form.roles.find((item) => (typeof item === "string" ? item : item.id) === member.role)?.name ?? member.roleName;
      member.joinedAt = String(values.get("joinedAt") || "").trim();
      const commission = String(values.get("commission") || "").trim();
      member.commission = commission === pageT(currentHelpers.lang, "members.detail.none") ? "none" : commission;
    }
    closeMemberDetail();
    return;
  }
  const form = event.target.closest("[data-member-add-form]");
  if (!form) return;
  event.preventDefault();
  if (state.liveReadOnly || !state.access.canManageEmployees) return;
  const values = new FormData(form);
  const memberId = `demo-member-${Date.now()}`;
  const dept = String(values.get("dept") || data.form.defaults.dept);
  state.members.push({
    id: memberId,
    name: String(values.get("name") || "").trim(),
    position: String(values.get("position") || "").trim(),
    email: String(values.get("email") || "").trim(),
    phone: "",
    commission: "—",
    joinedAt: String(values.get("joinedAt") || "").trim(),
    dept,
    departmentName: data.form.departments.find((item) => (typeof item === "string" ? item : item.id) === dept)?.name ?? dept,
    role: String(values.get("role") || data.form.defaults.role),
    roleName: data.form.roles.find((item) => (typeof item === "string" ? item : item.id) === String(values.get("role") || data.form.defaults.role))?.name ?? String(values.get("role") || data.form.defaults.role),
    openTasks: 0,
    bizflowMainAccess: false,
    status: "active",
    tasks: { tasking: [], tasked: [] }
  });
  state.departments.find((department) => department.id === dept)?.memberIds.push(memberId);
  state.summary.total += 1;
  state.summary.active += 1;
  closeAddMemberDialog();
});

document.addEventListener("input", (event) => {
  const roleNameInput = event.target.closest("[data-permission-role-name]");
  if (roleNameInput) {
    if (state.liveReadOnly || !state.access.canManageRoles) return;
    const role = state.permissions.roles.find((item) => item.id === roleNameInput.getAttribute("data-permission-role-name"));
    if (role) role.name = roleNameInput.value;
    return;
  }
  const departmentForm = event.target.closest("[data-department-modal-form]");
  if (departmentForm && state.departmentDraft) {
    const values = new FormData(departmentForm);
    state.departmentDraft.name = String(values.get("name") || "");
    state.departmentDraft.managerId = String(values.get("managerId") || "");
  }
  const nameInput = event.target.closest('[data-member-add-form] input[name="name"]');
  if (!nameInput) return;
  const avatar = document.querySelector("[data-member-form-avatar]");
  if (avatar) avatar.textContent = nameInput.value.trim().charAt(0).toUpperCase() || "?";
});

document.addEventListener("change", (event) => {
  if (!event.target.closest("[data-department-modal-form]") || !state.departmentDraft) return;
  state.departmentDraft.managerId = String(event.target.form?.elements.managerId?.value || "");
});

document.addEventListener("keydown", (event) => {
  const roleNameInput = event.target.closest?.("[data-permission-role-name]");
  if (roleNameInput && (event.key === "Enter" || event.key === "Escape")) {
    event.preventDefault();
    const roleId = roleNameInput.getAttribute("data-permission-role-name");
    const role = state.permissions.roles.find((item) => item.id === roleId);
    if (role) {
      role.name = role.name.trim() || (role.nameKey ? pageT(currentHelpers.lang, role.nameKey) : pageT(currentHelpers.lang, "members.permission.customRole"));
    }
    state.editingPermissionRoleId = null;
    rerenderMembers();
    document.querySelector(`[data-permission-role-edit="${CSS.escape(roleId)}"]`)?.focus();
    return;
  }
  if (event.key !== "Escape") return;
  if (state.memberDetailOpen) {
    closeMemberDetail();
    return;
  }
  if (state.departmentModalOpen) {
    closeDepartmentModal();
    return;
  }
  if (state.addMemberOpen) closeAddMemberDialog();
});

window.__shellMenu = [
  { key: "nav.tasks", icon: "icon-nav-task", href: "./index.html", unreadKey: "tasks" },
  { key: "nav.team", icon: "icon-nav-user", href: "./members.html", active: true }
];
attachMemberCommissionController({ state, rerender: rerenderMembers });
attachMemberUpdateLogController({ state, rerender: rerenderMembers });
attachMemberReviewController({ state, rerender: rerenderMembers });
attachMemberCompanyController({ state, rerender: rerenderMembers });
window.__shellData = { unread: await getUnread(), user: currentUser };
window.__shellContent = renderTeamMembers;
await import("../shell/shell.js");
