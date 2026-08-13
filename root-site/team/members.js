// team 站团队成员桌面屏(Figma 443:5035)。成员与统计只读 provider 契约,不直写样板数据。

import { getTeamMembersData, getCurrentUser, getUnread, getUnreadWatermarks } from "../data/provider.js";
import { getSession } from "../data/auth.js";
import { markRead } from "../data/read-state.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { memberT as pageT } from "./members-i18n.js";
import { renderMemberDetailDialog } from "./members-detail.js";
import { attachMemberReviewController, renderMemberReviews } from "./members-review.js";
import { renderMemberDepartments } from "./members-departments.js";
import { renderDepartmentModal } from "./members-department-modal.js";
import { renderMemberPermissions } from "./members-permissions.js";
import { attachMemberCommissionController, renderMemberCommission } from "./members-commission.js";
import { attachMemberUpdateLogController, renderMemberUpdateLogs } from "./members-update-logs.js";
import { attachMemberCompanyController, renderMemberCompanies } from "./members-companies.js";
import { memberCanWrite, memberWriteAttrs } from "./members-write-access.js";
import {
  approveLiveRegistration,
  createLiveDepartment,
  createLiveMember,
  createLiveRole,
  deactivateLiveMember,
  deleteLiveDepartment,
  deleteLiveRole,
  rejectLiveRegistration,
  renameLiveRole,
  setLiveRolePermissions,
  updateLiveDepartment,
  updateLiveMember
} from "../data/live-members-writes.js";

const HELEN_EMAIL = "a1017339632@gmail.com";
const MEMBER_TAB_ORDER = ["members", "permissions", "departments", "reviews", "commission", "updates", "companies"];
const MEMBER_DATA_TABS = new Set(["members", "permissions", "departments", "reviews", "commission"]);
const MEMBER_EXTRAS_TABS = new Set(["reviews", "commission", "updates", "companies"]);
let currentUser = null;
let session = null;
let unread = null;
let unreadWatermarks = null;
let authenticated = false;
let memberAccess = null;
let visibleTabKeys = new Set(MEMBER_TAB_ORDER);
let data = null;
let visibleTabs = [];
let memberDataLoaded = false;
let memberExtrasScope = "none";
let state = null;
let activeScope = null;
let activeMountId = 0;

function isCurrentMemberMount(mountId, scope = activeScope) {
  return mountId === activeMountId && Boolean(scope?.isCurrent());
}

// G-mem-13: 原本 liveReadOnly = authenticated 是整页硬闸,live 登录态下成员域所有写按钮
// 一律 disabled。改成:整页只读只剩「一项写权限都没有」这一种情况,按钮点亮与否交给
// buildMemberAccess 已有的四个权限位(canManageEmployees / canManageRoles /
// canManageCompanies / canApproveRegistration)分项判定,写落库再由 RLS 兜底。
export function memberPageReadOnly(access) {
  return !(access.canManageEmployees || access.canManageRoles ||
    access.canManageCompanies || access.canApproveRegistration);
}

function memberCopy(key) {
  return pageT(currentHelpers?.lang ?? "zh", key);
}

let memberWritePending = false;

// 与 members-update-logs.js 的 runWrite 同一套:一次只允许一个写在飞,
// 失败弹原始报错(含 RLS 拒绝),过期挂载直接丢弃结果。
async function runMemberWrite(operation) {
  if (memberWritePending) return null;
  memberWritePending = true;
  try {
    const result = await operation();
    if (!activeScope?.isCurrent()) return null;
    return result ?? true;
  } catch (error) {
    if (!activeScope?.isCurrent()) return null;
    window.alert(error?.message || String(error));
    return null;
  } finally {
    memberWritePending = false;
  }
}

// 件5b (2026-08-04): 「更新日誌」tab 的紅標与 tasks/orders/inventory 侧栏红点同一套 markRead 水位
// 机制(read-state.js),但驱动的是本页内部 tab 徽标(renderTab),不是侧栏——所以除了 markRead 落盘,
// 还要把本模块自己缓存的 unread.updates 就地清零并重渲,不能干等 shell 的 tp:unread-change 监听
// (那条链路只管侧栏 DOM,不知道这个页面内部还有个 tab 徽标要同步)。
function markUpdatesTabRead() {
  markRead("updates", unreadWatermarks?.updates ?? "");
  unread = { ...unread, updates: 0 };
}

function createMemberState(initialTab) {
  return {
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
  editingUpdateCommentId: null,
  editingUpdateCommentDraft: "",
  updateLogsVisibleCount: 20,
  updateLogUser: {
    id: session?.user?.id || currentUser?.userId || "",
    name: currentUser?.name || data.currentUserName || ""
  },
  updateLogsLive: authenticated,
  companies: data.companies.map((company) => ({ ...company })),
  editingCompanyId: null,
  summary: { ...data.summary, reviewPending: data.reviews.length + data.joinPending.length },
  activeTab: initialTab,
  access: memberAccess,
  liveReadOnly: authenticated && memberPageReadOnly(memberAccess),
  membersLive: authenticated,
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
}
let currentHelpers = null;

function cloneMembers(rows) {
  return rows.map((member) => ({
    ...member,
    tasks: {
      tasking: member.tasks.tasking.map((task) => ({ ...task })),
      tasked: member.tasks.tasked.map((task) => ({ ...task }))
    }
  }));
}

function mergeMemberData(nextData, { members, extras }) {
  if (members) {
    state.members = cloneMembers(nextData.members);
    state.reviews = nextData.reviews.map((review) => ({ ...review }));
    state.reviewHistory = nextData.reviewHistory.map((review) => ({ ...review }));
    state.joinPending = nextData.joinPending.map((review) => ({ ...review }));
    state.departments = nextData.departments.map((department) => ({ ...department, memberIds: department.memberIds.slice() }));
    state.permissions = {
      rows: nextData.permissions.rows.map((row) => ({ ...row })),
      roles: nextData.permissions.roles.map((role) => ({ ...role, grants: { ...role.grants } }))
    };
    state.summary = {
      ...nextData.summary,
      reviewPending: nextData.reviews.length + nextData.joinPending.length
    };
    data.form = nextData.form;
    data.commissionSales = nextData.commissionSales;
  }
  if (extras) {
    state.joinHistory = nextData.joinHistory.map((review) => ({ ...review }));
    state.commission = nextData.commission.map((entry) => ({ ...entry }));
    state.updateLogs = nextData.updateLogs.map((entry) => ({
      ...entry,
      comments: entry.comments.map((comment) => ({ ...comment }))
    }));
    if (!state.updateLogs.some((entry) => entry.comments.some((comment) => comment.id === state.editingUpdateCommentId))) {
      state.editingUpdateCommentId = null;
      state.editingUpdateCommentDraft = "";
    }
    state.companies = nextData.companies.map((company) => ({ ...company }));
  }
}

async function ensureMemberTabData(tabKey) {
  const includeMembers = MEMBER_DATA_TABS.has(tabKey) && !memberDataLoaded;
  const requestedExtrasScope = tabKey === "updates" ? "updates" : "all";
  const includeExtras = MEMBER_EXTRAS_TABS.has(tabKey) && memberExtrasScope !== "all" && memberExtrasScope !== requestedExtrasScope;
  if (!includeMembers && !includeExtras) return;
  const mountId = activeMountId;
  const scope = activeScope;
  const nextData = await getTeamMembersData({ includeMembers, includeExtras, extrasScope: requestedExtrasScope });
  if (!isCurrentMemberMount(mountId, scope)) return;
  mergeMemberData(nextData, { members: includeMembers, extras: includeExtras });
  memberDataLoaded ||= includeMembers;
  if (includeExtras) memberExtrasScope = requestedExtrasScope;
}

function renderStatCard({ title, value, tone }, { escapeHtml }) {
  const mod = tone ? ` team-members-stat--${tone}` : "";
  return `<article class="team-members-stat${mod}">
    <span class="team-members-stat__title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
    <span class="team-members-stat__value">${escapeHtml(value)}</span>
  </article>`;
}

export function memberPageHeading(access, lang) {
  return pageT(lang, access?.canManageEmployees ? "members.title" : "members.tab.updates");
}

export function memberDocumentTitle(access) {
  return access?.canManageEmployees ? "Honnmono · Team" : "Honnmono · Update log";
}

function renderTab(tab, helpers) {
  const { escapeHtml, lang, redDot } = helpers;
  const text = pageT(lang, `members.tab.${tab.key}`);
  const active = tab.key === state.activeTab;
  // 件5b (2026-08-04, REDDOT-SURVEY 异常 #6): 「更新日誌」tab 原本硬编码 update:false,恒不亮。
  // 与相邻「審核」tab 同机制——一个真实动态布尔覆盖 provider.js 的静态占位值,只是数据源换成
  // unread.updates(read-state.js 时间水位,见 computeUnreadState),而不是 state 里当场算的计数,
  // 因为 updateLogs 只在真正切进该 tab 时才懒加载(ensureMemberTabData),初次落地在别的 tab 上时
  // state.updateLogs 可能还是空的,不能拿它判断"有没有新动态"。
  const update = tab.key === "reviews"
    ? state.reviews.length + state.joinPending.length > 0
    : tab.key === "updates"
      ? (unread?.updates ?? 0) > 0
      : tab.update;
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
  return `<button type="button" class="member-card member-card--add team-member-card team-member-card--add" data-member-add-open title="${escapeHtml(text)}"${memberWriteAttrs(state, "canManageEmployees")}>
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
  const pageHeading = memberPageHeading(state.access, lang);
  const stats = [
    { title: tt("members.stat.total"), value: state.summary.total, tone: "" },
    { title: tt("members.stat.active"), value: state.summary.active, tone: "blue" },
    { title: tt("members.stat.review"), value: state.summary.reviewPending, tone: "yellow" },
    { title: tt("members.stat.departed"), value: state.summary.departed, tone: "gray" }
  ];

  return `<div class="team-members-page" data-live-read-only="${state.liveReadOnly}">
    <h1 class="team-members-title" title="${escapeHtml(pageHeading)}">${escapeHtml(pageHeading)}</h1>
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

// 部门卡片的「移除」与弹窗里的「删除」同一条路径:二次确认 → 真删 → 才动本地数组。
// 删除会连带把部门成员绑定清掉、原属该部门的任务变回公司内可见,所以必须先确认。
async function removeMemberDepartment(departmentId) {
  if (!departmentId) return false;
  if (!await confirmInPage(memberCopy("members.department.removeConfirm"), { danger: true })) return false;
  if (!activeScope?.isCurrent()) return false;
  if (state.membersLive && !await runMemberWrite(() => deleteLiveDepartment(departmentId))) return false;
  state.departments = state.departments.filter((department) => department.id !== departmentId);
  return true;
}

async function onMembersClick(event) {
  const pageTab = event.target.closest("[data-members-tab]");
  if (pageTab) {
    const scope = activeScope;
    const nextTab = pageTab.getAttribute("data-members-tab") || "members";
    if (!visibleTabKeys.has(nextTab)) return;
    await ensureMemberTabData(nextTab);
    if (!isCurrentMemberMount(activeMountId, scope)) return;
    state.activeTab = nextTab;
    if (nextTab === "members") state.departmentFilter = null;
    if (nextTab === "updates") markUpdatesTabRead();
    rerenderMembers();
    document.querySelector(`[data-members-tab="${state.activeTab}"]`)?.focus();
    return;
  }
  const permissionToggle = event.target.closest("[data-permission-toggle]");
  if (permissionToggle) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const rowId = permissionToggle.getAttribute("data-permission-toggle");
    const roleId = permissionToggle.getAttribute("data-permission-role");
    const role = state.permissions.roles.find((item) => item.id === roleId);
    if (!role?.editable || !rowId) return;
    const nextGrants = { ...role.grants, [rowId]: role.grants[rowId] !== true };
    if (state.membersLive && !await runMemberWrite(() => setLiveRolePermissions(roleId, nextGrants))) return;
    role.grants = nextGrants;
    rerenderMembers();
    document.querySelector(`[data-permission-toggle="${CSS.escape(rowId)}"][data-permission-role="${CSS.escape(roleId)}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-permission-role-add]")) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const name = pageT(currentHelpers.lang, "members.permission.customRole");
    // live 态先落库拿真 uuid,别再造 custom-role-${Date.now()} 这种后续写不回去的本地 id。
    const created = state.membersLive
      ? await runMemberWrite(() => createLiveRole({ name }))
      : { id: `custom-role-${Date.now()}` };
    if (!created) return;
    const roleId = created.id;
    state.permissions.roles.push({
      id: roleId,
      name,
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
    if (!memberCanWrite(state, "canManageRoles")) return;
    const roleId = permissionRoleEdit.getAttribute("data-permission-role-edit");
    state.editingPermissionRoleId = roleId;
    rerenderMembers();
    document.querySelector(`[data-permission-role-name="${CSS.escape(roleId)}"]`)?.select();
    return;
  }
  const permissionRoleRemove = event.target.closest("[data-permission-role-remove]");
  if (permissionRoleRemove) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const roleId = permissionRoleRemove.getAttribute("data-permission-role-remove");
    if (!await confirmInPage(memberCopy("members.permission.removeRoleConfirm"), { danger: true })) return;
    if (!activeScope?.isCurrent()) return;
    if (state.membersLive && !await runMemberWrite(() => deleteLiveRole(roleId))) return;
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
    if (!memberCanWrite(state, "canManageRoles")) return;
    const department = state.departments.find((item) => item.id === departmentCard.getAttribute("data-department-card"));
    if (department) openDepartmentModal(department);
    return;
  }
  if (departmentCard && event.target.closest("[data-department-remove]")) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const id = departmentCard.getAttribute("data-department-card");
    if (!await removeMemberDepartment(id)) return;
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-add]")) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    openDepartmentModal(null);
    return;
  }
  if (event.target.closest("[data-department-modal-close]") || event.target.matches("[data-department-modal-overlay]")) {
    closeDepartmentModal();
    return;
  }
  const removedDepartmentMember = event.target.closest("[data-department-member-remove]");
  if (removedDepartmentMember && state.departmentDraft) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const id = removedDepartmentMember.getAttribute("data-department-member-remove");
    state.departmentDraft.memberIds = state.departmentDraft.memberIds.filter((memberId) => memberId !== id);
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-member-add]") && state.departmentDraft) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    const member = state.members.find((item) => !state.departmentDraft.memberIds.includes(item.id));
    if (member) state.departmentDraft.memberIds.push(member.id);
    rerenderMembers();
    return;
  }
  if (event.target.closest("[data-department-modal-delete]")) {
    if (!memberCanWrite(state, "canManageRoles")) return;
    // 草稿还没落库(新建未保存)时,删除等同关掉弹窗,不用打扰使用者。
    if (state.departmentDraft?.id && !await removeMemberDepartment(state.departmentDraft.id)) return;
    closeDepartmentModal();
    return;
  }
  const rejectedReview = event.target.closest("[data-member-review-reject]")?.closest("[data-member-review-card]");
  if (rejectedReview) {
    if (!memberCanWrite(state, "canApproveRegistration")) return;
    const id = rejectedReview.getAttribute("data-member-review-card");
    if (state.membersLive && !await runMemberWrite(() => rejectLiveRegistration(id))) return;
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
    if (!memberCanWrite(state, "canManageEmployees")) return;
    const member = state.members.find((item) => item.id === state.selectedMemberId);
    if (member && member.status !== "departed") {
      if (!await confirmInPage(memberCopy("members.detail.removeConfirm"), { danger: true })) return;
      if (!activeScope?.isCurrent()) return;
      if (state.membersLive && !await runMemberWrite(() => deactivateLiveMember(member.id))) return;
      member.status = "departed";
      state.summary.active = Math.max(0, state.summary.active - 1);
      state.summary.departed += 1;
    }
    closeMemberDetail();
    return;
  }
  if (event.target.closest("[data-member-add-open]")) {
    if (!memberCanWrite(state, "canManageEmployees")) return;
    state.addMemberOpen = true;
    rerenderMembers({ focusForm: true });
    return;
  }
  if (event.target.closest("[data-member-add-close]") || event.target.matches("[data-member-add-overlay]")) {
    closeAddMemberDialog();
  }
}

async function onMembersSubmit(event) {
  const departmentForm = event.target.closest("[data-department-modal-form]");
  if (departmentForm && state.departmentDraft) {
    event.preventDefault();
    if (!memberCanWrite(state, "canManageRoles")) return;
    const values = new FormData(departmentForm);
    state.departmentDraft.name = String(values.get("name") || "").trim();
    state.departmentDraft.managerId = String(values.get("managerId") || "");
    const manager = state.members.find((member) => member.id === state.departmentDraft.managerId)?.name ?? "";
    const existing = state.departments.find((department) => department.id === state.departmentDraft.id);
    const memberIds = state.departmentDraft.memberIds.slice();
    // departments 表只有 name,主管是页面侧的展示字段(库里没有对应列),所以只本地保留。
    if (existing) {
      const name = state.departmentDraft.name === state.departmentDraft.initialName && state.departmentDraft.nameKey
        ? pageT(currentHelpers.lang, state.departmentDraft.nameKey)
        : state.departmentDraft.name;
      if (state.membersLive && !await runMemberWrite(() => updateLiveDepartment(existing.id, {
        name,
        memberIds,
        previousMemberIds: existing.memberIds
      }))) return;
      if (state.departmentDraft.name === state.departmentDraft.initialName && state.departmentDraft.nameKey) {
        existing.nameKey = state.departmentDraft.nameKey;
        delete existing.name;
      } else {
        existing.name = state.departmentDraft.name;
        delete existing.nameKey;
      }
      existing.manager = manager;
      existing.memberIds = memberIds;
    } else {
      const created = state.membersLive
        ? await runMemberWrite(() => createLiveDepartment({ name: state.departmentDraft.name, memberIds }))
        : { id: `custom-department-${Date.now()}` };
      if (!created) return;
      state.departments.push({
        id: created.id,
        name: state.departmentDraft.name,
        icon: state.departmentDraft.icon,
        manager,
        memberIds
      });
    }
    closeDepartmentModal();
    return;
  }
  const reviewForm = event.target.closest("[data-member-review-card]");
  if (reviewForm) {
    event.preventDefault();
    if (!memberCanWrite(state, "canApproveRegistration")) return;
    const id = reviewForm.getAttribute("data-member-review-card");
    const review = state.reviews.find((item) => item.id === id);
    if (!review) return;
    const values = new FormData(reviewForm);
    const dept = String(values.get("dept") || review.dept);
    const roleId = String(values.get("role") || review.role);
    const approved = state.membersLive
      ? await runMemberWrite(() => approveLiveRegistration(id, { departmentId: dept || null, roleId: roleId || null }))
      : { id: `approved-${review.id}` };
    if (!approved) return;
    const memberId = approved.id;
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
    if (!memberCanWrite(state, "canManageEmployees")) return;
    const member = state.members.find((item) => item.id === state.selectedMemberId);
    if (member && state.memberDetailTab === "basic") {
      const values = new FormData(detailForm);
      const position = String(values.get("position") || "").trim();
      const email = String(values.get("email") || "").trim();
      const phone = String(values.get("phone") || "").trim();
      const dept = String(values.get("dept") || member.dept);
      const roleId = String(values.get("role") || member.role);
      if (state.membersLive && !await runMemberWrite(() => updateLiveMember(member.id, {
        position,
        email,
        phone,
        roleId,
        departmentId: dept || null,
        previousDepartmentId: member.dept || null
      }))) return;
      member.position = position;
      member.email = email;
      member.phone = phone;
      member.dept = dept;
      member.role = roleId;
      member.departmentName = data.form.departments.find((item) => (typeof item === "string" ? item : item.id) === member.dept)?.name ?? member.departmentName;
      member.roleName = data.form.roles.find((item) => (typeof item === "string" ? item : item.id) === member.role)?.name ?? member.roleName;
      // 入職時間讀 employees.created_at、佣金是快照算出來的,live 態下輸入框已鎖,只在演示態回寫本地。
      if (!state.membersLive) {
        member.joinedAt = String(values.get("joinedAt") || "").trim();
        const commission = String(values.get("commission") || "").trim();
        member.commission = commission === pageT(currentHelpers.lang, "members.detail.none") ? "none" : commission;
      }
    }
    closeMemberDetail();
    return;
  }
  const form = event.target.closest("[data-member-add-form]");
  if (!form) return;
  event.preventDefault();
  if (!memberCanWrite(state, "canManageEmployees")) return;
  const values = new FormData(form);
  const dept = String(values.get("dept") || data.form.defaults.dept);
  const created = state.membersLive
    ? await runMemberWrite(() => createLiveMember({
        name: String(values.get("name") || "").trim(),
        position: String(values.get("position") || "").trim(),
        email: String(values.get("email") || "").trim(),
        departmentId: dept || null,
        roleId: String(values.get("role") || data.form.defaults.role) || null
      }))
    : { id: `demo-member-${Date.now()}` };
  if (!created) return;
  const memberId = created.id;
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
}

function onMembersInput(event) {
  const roleNameInput = event.target.closest("[data-permission-role-name]");
  if (roleNameInput) {
    if (!memberCanWrite(state, "canManageRoles")) return;
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
}

function onMembersChange(event) {
  if (!event.target.closest("[data-department-modal-form]") || !state.departmentDraft) return;
  state.departmentDraft.managerId = String(event.target.form?.elements.managerId?.value || "");
}

async function onMembersKeydown(event) {
  const roleNameInput = event.target.closest?.("[data-permission-role-name]");
  if (roleNameInput && (event.key === "Enter" || event.key === "Escape")) {
    event.preventDefault();
    const roleId = roleNameInput.getAttribute("data-permission-role-name");
    const role = state.permissions.roles.find((item) => item.id === roleId);
    if (role) {
      // onMembersInput 已经把输入实时写进 role.name(草稿),这里是提交点:先落库再定稿。
      // 写失败就保持编辑态不收起,使用者看到报错还能改回去重试。
      const name = role.name.trim() || (role.nameKey ? pageT(currentHelpers.lang, role.nameKey) : pageT(currentHelpers.lang, "members.permission.customRole"));
      if (state.membersLive && !await runMemberWrite(() => renameLiveRole(roleId, name))) return;
      role.name = name;
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
}

function formHasValue(selector) {
  return [...document.querySelectorAll(selector)].some((form) => [...form.elements].some((field) => {
    if (!field.name || field.disabled || ["submit", "button"].includes(field.type)) return false;
    return String(field.value || "").trim() !== "";
  }));
}

function hasMemberUnsavedChanges() {
  return Boolean(state.departmentDraft)
    || Boolean(state.editingPermissionRoleId)
    || formHasValue("[data-member-add-form]")
    || formHasValue("[data-update-create-form]")
    || formHasValue("[data-update-edit-form]")
    || formHasValue("[data-update-comment-form]")
    || formHasValue("[data-update-comment-edit-form]")
    || formHasValue("[data-company-create-form]")
    || formHasValue("[data-company-name-form]");
}

function buildMemberAccess() {
  const sessionEmail = String(session?.user?.email || "").toLowerCase();
  const canViewCommission = !authenticated || currentUser.isSuperAdmin === true ||
    currentUser.hasPermission("can_view_commission") || currentUser.role === "銷售";
  memberAccess = {
    canManageEmployees: !authenticated || currentUser.isSuperAdmin === true || currentUser.isAdminOfAny === true || currentUser.hasPermission("can_manage_employees"),
    canApproveRegistration: !authenticated || currentUser.hasPermission("can_approve_registration"),
    canViewCommission,
    canManageRoles: !authenticated || currentUser.hasPermission("can_manage_roles"),
    canManageCompanies: !authenticated || currentUser.isSuperAdmin === true,
    canWriteUpdates: !authenticated || currentUser.isBfAdmin === true || sessionEmail === HELEN_EMAIL,
    canAdministerUpdateComments: !authenticated || currentUser.isBfAdmin === true,
    commissionLockedEmployeeId: authenticated && currentUser.isSuperAdmin !== true ? currentUser.id : null
  };
  visibleTabKeys = authenticated
    ? new Set([
        "updates",
        ...(memberAccess.canManageEmployees ? ["members"] : []),
        ...(memberAccess.canApproveRegistration ? ["reviews"] : []),
        ...(memberAccess.canViewCommission ? ["commission"] : []),
        ...(memberAccess.canManageRoles ? ["permissions", "departments"] : []),
        ...(memberAccess.canManageCompanies ? ["companies"] : [])
      ])
    : new Set(MEMBER_TAB_ORDER);
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  const mountId = ++activeMountId;
  activeScope = scope;
  const [nextCurrentUser, nextSession, nextUnread, nextUnreadWatermarks] = await Promise.all([
    getCurrentUser(), getSession(), getUnread(), getUnreadWatermarks()
  ]);
  throwIfPageAborted(signal, scope);
  currentUser = nextCurrentUser;
  session = nextSession;
  unread = nextUnread;
  unreadWatermarks = nextUnreadWatermarks;
  authenticated = typeof currentUser?.hasPermission === "function";
  buildMemberAccess();
  const restoredTab = visibleTabKeys.has(historyState?.activeTab) ? historyState.activeTab : null;
  const initialTab = restoredTab ?? MEMBER_TAB_ORDER.find((key) => visibleTabKeys.has(key)) ?? "updates";
  const initialIncludesMembers = MEMBER_DATA_TABS.has(initialTab);
  const initialIncludesExtras = MEMBER_EXTRAS_TABS.has(initialTab);
  const initialExtrasScope = initialTab === "updates" ? "updates" : "all";
  const nextData = await getTeamMembersData({
    includeMembers: initialIncludesMembers,
    includeExtras: initialIncludesExtras,
    extrasScope: initialExtrasScope
  });
  throwIfPageAborted(signal, scope);
  data = nextData;
  visibleTabs = data.tabs.filter((tab) => visibleTabKeys.has(tab.key));
  memberDataLoaded = initialIncludesMembers;
  memberExtrasScope = initialIncludesExtras ? initialExtrasScope : "none";
  state = createMemberState(initialTab);
  state.reviewMode = ["registration", "join"].includes(historyState?.reviewMode) ? historyState.reviewMode : "registration";
  state.commissionSale = typeof historyState?.commissionSale === "string" ? historyState.commissionSale : state.commissionSale;
  state.commissionMonth = typeof historyState?.commissionMonth === "string" ? historyState.commissionMonth : "all";
  state.departmentFilter = typeof historyState?.departmentFilter === "string" ? historyState.departmentFilter : null;

  return {
    page: {
      menu: [
        { key: "nav.tasks", icon: "icon-nav-task", href: "./index.html", unreadKey: "tasks" },
        { key: memberAccess.canManageEmployees ? "nav.team" : "nav.updates", icon: "icon-nav-user", href: "./members.html", active: true }
      ],
      data: { unread, user: currentUser },
      render: renderTeamMembers,
      title: memberDocumentTitle(memberAccess)
    },
    activate() {
      // 件5b (2026-08-04): 受限员工(仅 canWriteUpdates 类账号)默认直接落地在"updates" tab
      // (buildMemberAccess 的 visibleTabKeys 只给他们这一项),这种情况点击切换 tab 的分支永远不会
      // 跑到——落地即"看过",要在 activate 里也补一次,与 tasks.js activate() 里无条件
      // markRead("tasks", ...) 同一节奏,只是这里要看 activeTab 是不是 updates 才落。
      if (state.activeTab === "updates") markUpdatesTabRead();
      scope.listen(document, "click", onMembersClick);
      scope.listen(document, "submit", onMembersSubmit);
      scope.listen(document, "input", onMembersInput);
      scope.listen(document, "change", onMembersChange);
      scope.listen(document, "keydown", onMembersKeydown);
      attachMemberCommissionController({ state, rerender: rerenderMembers, scope });
      attachMemberUpdateLogController({ state, rerender: rerenderMembers, scope });
      attachMemberReviewController({ state, rerender: rerenderMembers, scope, runWrite: runMemberWrite });
      attachMemberCompanyController({ state, rerender: rerenderMembers, scope, runWrite: runMemberWrite });
    },
    hasUnsavedChanges: hasMemberUnsavedChanges,
    async canLeave() {
      if (!hasMemberUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "members.leaveUnsaved"));
    },
    captureState() {
      return {
        activeTab: state.activeTab,
        reviewMode: state.reviewMode,
        commissionSale: state.commissionSale,
        commissionMonth: state.commissionMonth,
        departmentFilter: state.departmentFilter
      };
    },
    dispose() {
      if (activeMountId === mountId) activeMountId += 1;
      currentUser = null;
      session = null;
      unread = null;
      unreadWatermarks = null;
      data = null;
      visibleTabs = [];
      currentHelpers = null;
      if (activeScope === scope) activeScope = null;
      state = null;
    }
  };
}
