import { getTeamTaskData, getCurrentUser, getUnread, getUnreadWatermarks } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { taskT as pageT } from "./tasks-i18n.js";
import { renderTaskDetail } from "./tasks-detail.js";
import { availableTaskDepartments, renderTaskSubmitDialog, taskMembersForDepartment } from "./tasks-submit.js";
import { isTaskFilterGroup } from "./tasks-filters.js";
import { renderTaskCalendar } from "./tasks-calendar.js";
import { renderTaskOverview } from "./tasks-overview.js";
import { renderTaskAiDialog } from "./tasks-ai.js";
import { calendarRelatedTasks, canDeleteTaskForUser, defaultTaskViewForUser, isOpenTask, isTaskCreator, isTaskMentionedForMember, isWaitingApproval, memberIdentity, openAssignedTaskCount, taskAssignee, taskCompletionForMember } from "./tasks-model.js";
import { attachTaskDomainController } from "./tasks-domain-controller.js";
import { renderTaskBoardGrid, renderTaskToolbar } from "./tasks-board.js";
import { getSessionValue, setSessionValue } from "../data/session-state.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { approveLiveTask, completeLiveTask, createLiveSubtask, createLiveTask, createLiveTaskFeedback, deleteLiveSubtask, deleteLiveTask, deleteLiveTaskFeedback, setLiveSubtaskCompletion, setLiveTaskParticipation, updateLiveSubtaskTitle, updateLiveTask, updateLiveTaskFeedback } from "../data/live-task-writes.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import { createTaskBoardColumnReadObserver, createTaskBoardReadTracker } from "./task-board-read-state.js";
import { consumeNavigationPreset, navigationPresetKeys } from "../components/navigation-presets.js";
import { closeTaskFeedbackMention, createTaskFeedbackDraft, removeTaskFeedbackMention, selectTaskFeedbackMention, taskFeedbackMentionCandidates, updateTaskFeedbackMentionInput } from "./tasks-mentions.js";
import { pastedTaskFeedbackImages, revokeTaskFeedbackAttachmentDrafts, taskFeedbackAttachmentDraft } from "./tasks-clipboard.js";
import { buildTaskSubtaskEcho, createTaskSubmitSubtaskDraft, createTaskSubmitSubtasks, normalizeTaskSubmitSubtasks } from "./tasks-submit-subtasks.js";

let data = null;
let currentUser = null;
let unread = null;
let unreadWatermarks = null;
let authenticated = false;
let permissions = null;
let state = null;
let filterState = null;
let taskMobileViewport = null;
let activeScope = null;
let activeMountId = 0;
let taskLiveRefresh = null;
let taskBoardReadTracker = null;
let taskBoardColumnReadObserver = null;
const taskDueDatePanel = createDateRangePanel();
const taskStartDatePanel = createDateRangePanel();

function isCurrentTaskMount(mountId, scope = activeScope) {
  return mountId === activeMountId && Boolean(scope?.isCurrent());
}

function createTaskState(nextData, historyState = null) {
  const clonedTasks = nextData.tasks.map((task) => ({
    ...task,
    attachments: (task.attachments ?? []).map((attachment) => ({ ...attachment })),
    assignees: (task.assignees ?? []).map((assignee) => ({ ...assignee })),
    feedback: task.feedback.map((entry) => ({
      ...entry,
      own: entry.authorUserId && currentUser?.userId
        ? entry.authorUserId === currentUser.userId
        : entry.own === true,
      attachments: (entry.attachments ?? []).map((attachment) => ({ ...attachment })),
      mentionedUserIds: (entry.mentionedUserIds ?? []).slice()
    })),
    subtasks: []
  }));
  const clonedTaskById = new Map(clonedTasks.map((task) => [task.id, task]));
  clonedTasks.forEach((task) => {
    if (task.parentId && clonedTaskById.has(task.parentId)) clonedTaskById.get(task.parentId).subtasks.push(task);
  });
  const clonedMembers = nextData.members.map((member, index) => ({ ...member, id: member.id || `mock-member-${index}` }));
  const currentMember = clonedMembers.find((member) => member.name.toLocaleLowerCase() === currentUser.name.toLocaleLowerCase());
  const now = new Date();
  const storedViewMode = getSessionValue("team-tasks-view-mode");
  const restored = historyState && typeof historyState === "object" ? historyState : {};
  const initialView = defaultTaskViewForUser(currentUser, currentMember);
  const nextState = {
    summary: { ...nextData.summary },
    members: clonedMembers,
    departments: (nextData.departments ?? []).map((department) => ({
      ...department,
      memberIds: (department.memberIds ?? []).slice()
    })),
    tasks: clonedTasks,
    board: nextData.board.map((column) => ({ ...column, tasks: column.tasks.map((task) => clonedTaskById.get(task.id)).filter(Boolean) })),
    currentUser: { ...currentUser, id: currentUser.employeeId || currentMember?.id || "" },
    permissions,
    liveReadOnly: authenticated,
    liveTaskWrites: authenticated,
    mode: ["overview", "board"].includes(restored.mode) ? restored.mode : initialView.mode,
    overviewExpanded: new Set(Array.isArray(restored.overviewExpanded) ? restored.overviewExpanded : []),
    overviewCompletedExpanded: new Set(Array.isArray(restored.overviewCompletedExpanded) ? restored.overviewCompletedExpanded : []),
    boardExpandedPriorities: new Set(Array.isArray(restored.boardExpandedPriorities)
      ? restored.boardExpandedPriorities.filter((key) => ["high", "medium", "low"].includes(key))
      : []),
    feedbackPanelExpandedTaskIds: new Set(Array.isArray(restored.feedbackPanelExpandedTaskIds)
      ? restored.feedbackPanelExpandedTaskIds.map(String)
      : []),
    onlyMine: typeof restored.onlyMine === "boolean" ? restored.onlyMine : getSessionValue("team-tasks-only-mine") === "1",
    calendarYear: Number.isInteger(restored.calendarYear) ? restored.calendarYear : now.getFullYear(),
    calendarMonth: Number.isInteger(restored.calendarMonth) ? restored.calendarMonth : now.getMonth(),
    calendarExpandedDate: null,
    aiOpen: false,
    detailOpen: false,
    selectedTaskId: null,
    detailTab: "content",
    submitOpen: false,
    submitMode: "create",
    submitTaskId: null,
    submitOriginalDepartmentId: "",
    submitCanAssignOthers: permissions.canAssignOthers,
    submitDraft: { ...nextData.form.defaults, memberIds: [], memberQuery: "", memberMenuOpen: false, attachments: [], subtasks: [] },
    submitError: "",
    feedbackDraft: createTaskFeedbackDraft(),
    feedbackError: "",
    feedbackMenuId: null,
    feedbackEditingId: null,
    feedbackEditDraft: "",
    feedbackEditOriginal: "",
    feedbackEditError: "",
    subtaskAddDraft: { title: "", assigneeId: "" },
    subtaskEditingId: null,
    subtaskEditDraft: "",
    subtaskEditOriginal: "",
    attachmentPreview: null,
    writeBusy: false,
    writeError: "",
    writeErrorValues: {},
    writeNotice: "",
    actionTaskId: null,
    boardUnreadTaskIds: new Set()
  };
  const nextFilterState = {
    status: ["inProgress", "completed", "abandoned", "overdue"].includes(restored.status) ? restored.status : nextData.filters?.status ?? "inProgress",
    priority: ["all", "high", "medium", "low"].includes(restored.priority) ? restored.priority : nextData.filters?.priority ?? "all",
    view: ["board", "calendar"].includes(restored.view) ? restored.view : ["board", "calendar"].includes(storedViewMode) ? storedViewMode : nextData.filters?.view ?? "board",
    member: typeof restored.member === "string" ? restored.member : initialView.member
  };
  return { state: nextState, filterState: nextFilterState };
}

function initializeTaskState(historyState = null) {
  ({ state, filterState } = createTaskState(data, historyState));
}

function initials(name) {
  const text = String(name || "H").trim();
  return text.slice(0, 1).toUpperCase();
}

function countBadge(value) {
  if (!value) return "";
  return `<span class="team-count-badge">${value}</span>`;
}

function renderStatCard({ title, value, tone }, { escapeHtml }) {
  const mod = tone ? ` team-stat-card--${tone}` : "";
  return `<article class="team-stat-card${mod}">
    <span class="team-stat-card__title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
    <span class="team-stat-card__value">${escapeHtml(value)}</span>
  </article>`;
}

function renderMember(member, tasks, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const memberKey = member.dept === "all" ? "all" : memberIdentity(member);
  const active = state.mode === "board" && filterState.member === memberKey ? " team-member-task--active" : "";
  const dept = member.deptLabel ?? pageT(lang, `tasks.dept.${member.dept}`);
  const openCount = member.dept === "all"
    ? tasks.filter((task) => task.parentId === null && isOpenTask(task)).length
    : openAssignedTaskCount(member, tasks);
  return `<button type="button" class="team-member-task${active}" data-task-member="${escapeHtml(memberKey)}">
    <span class="avatar--initial team-member-task__avatar" style="--component-width:60px;--component-height:60px">${escapeHtml(initials(member.name))}</span>
    <div class="team-member-task__body">
      <div class="team-member-task__top">
        <span class="team-member-task__name" title="${escapeHtml(member.name)}">${escapeHtml(member.name)}</span>
        <span class="team-member-task__dept" title="${escapeHtml(dept)}">${escapeHtml(dept)}</span>
      </div>
      <div class="team-member-task__meta">
        <span>${escapeHtml(openCount)}</span>
        <span title="${escapeHtml(pageT(lang, "tasks.member.pending"))}">${escapeHtml(pageT(lang, "tasks.member.pending"))}</span>
      </div>
    </div>
    ${member.badge ? countBadge(member.badge) : icon("icon-arrow-right", "icon team-member-task__arrow")}
  </button>`;
}

function renderOverviewEntry(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  return `<button type="button" class="team-member-task team-member-task--overview${state.mode === "overview" ? " team-member-task--active" : ""}" data-task-overview-open>
    <span class="team-member-task__overview-icon">${icon("icon-task-list", "icon")}</span>
    <span class="team-member-task__body"><span class="team-member-task__name">${escapeHtml(pageT(lang, "tasks.overview.title"))}</span><span class="team-member-task__meta">${escapeHtml(String(state.members.length - 1))}</span></span>
    ${icon("icon-arrow-right", "icon team-member-task__arrow")}
  </button>`;
}

// shell 每次重渲染都会调本函数(带最新 lang);捕获 helpers 供筛选联动就地重渲用
let currentHelpers = null;

export function renderTaskManagement(helpers) {
  currentHelpers = helpers;
  const { icon, escapeHtml, lang } = helpers;
  const tt = (key, values) => pageT(lang, key, values);
  const stats = [
    { title: tt("tasks.stat.total"), value: state.summary.total, tone: "" },
    { title: tt("tasks.stat.completed"), value: state.summary.completed, tone: "blue" },
    { title: tt("tasks.stat.inProgress"), value: state.summary.inProgress, tone: "yellow" }
  ];

  const scopedTasks = state.onlyMine
    ? state.tasks.filter((task) => task.creatorId === state.currentUser.id || task.creator.toLocaleLowerCase() === state.currentUser.name.toLocaleLowerCase())
    : state.tasks;
  const calendarTasks = calendarRelatedTasks(state.tasks, { onlyMine: state.onlyMine, currentUser: state.currentUser });
  const calendarView = filterState.view === "calendar" && !state.detailOpen;
  // Figma member-rail Add uses the generic add-surface component but has no authored flow; live P0 keeps it disabled.
  const content = state.detailOpen
    ? renderTaskDetail({ state, helpers })
    : calendarView
      ? renderTaskCalendar({ tasks: calendarTasks, state, helpers })
      : state.mode === "overview"
        ? renderTaskOverview({
          members: state.members,
          tasks: scopedTasks,
          expanded: state.overviewExpanded,
          completedExpanded: state.overviewCompletedExpanded,
          helpers
        })
        : `<div class="team-kanban-grid">${renderTaskBoardGrid({ state, filterState, helpers })}</div>`;
  return `<div class="team-task-page${state.detailOpen ? " team-task-page--detail" : ""}" data-task-view="${escapeHtml(filterState.view)}" data-task-mode="${escapeHtml(state.mode)}" data-only-mine="${state.onlyMine}">
    <h1 class="team-task-title" title="${escapeHtml(tt("tasks.title"))}">${escapeHtml(tt("tasks.title"))}</h1>
    ${state.writeError ? `<p class="team-task-write-error" role="alert">${escapeHtml(tt(state.writeError, state.writeErrorValues))}</p>` : ""}
    ${state.writeNotice ? `<p class="team-task-write-notice" role="status" aria-live="polite">${escapeHtml(tt(state.writeNotice))}</p>` : ""}
    <section class="team-task-stats">${stats.map((stat) => renderStatCard(stat, helpers)).join("")}</section>
    ${state.detailOpen ? "" : renderTaskToolbar({ state, filterState, members: state.members, featureAiBatch: data.featureAiBatch, helpers })}
    <section class="team-board${calendarView ? " team-board--calendar" : ""}">
      ${calendarView ? "" : `<aside class="team-member-rail">
        <div class="team-member-list">${renderOverviewEntry(helpers)}${state.members.map((member) => renderMember(member, scopedTasks, helpers)).join("")}</div>
        ${state.permissions.canManageEmployees ? `<button type="button" class="team-member-add" data-task-members-manage aria-label="${escapeHtml(tt("tasks.members.manage"))}" title="${escapeHtml(tt("tasks.members.manage"))}">${icon("icon-add-surface-add")}</button>` : ""}
      </aside>`}
      <main class="team-kanban${state.detailOpen ? " team-kanban--detail" : ""}">
        ${content}
      </main>
    </section>
    ${renderTaskSubmitDialog({ state, data: { ...data, members: state.members }, helpers })}
    ${renderTaskAiDialog({ state, helpers })}
  </div>`;
}

function closeAllFilterMenus(except) {
  document.querySelectorAll("[data-filter-popover]").forEach((pop) => {
    if (pop === except) return;
    pop.classList.remove("menu-popover--open");
    const trigger = pop.parentElement.querySelector("[data-filter-trigger]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function rerenderTaskPage({ focusDetail = false, restoreDetailFocus = false, focusFeedback = false, feedbackCursor = null, focusFeedbackMenuId = "", focusFeedbackEditId = "", focusSubmit = false, focusSubmitSubtaskId = "", restoreSubmitFocus = false, focusFilterGroup = "", focusActionMenu = false, restoreActionTaskId = "", focusBoard = false, focusSubtaskId = "", focusSubtaskAdd = false, focusSubtaskEditId = "" } = {}) {
  taskDueDatePanel.close({ restoreFocus: false });
  taskStartDatePanel.close({ restoreFocus: false });
  const page = document.querySelector(".team-task-page");
  if (!page || !currentHelpers) return;
  page.outerHTML = renderTaskManagement(currentHelpers);
  if (focusDetail) [...document.querySelectorAll("[data-task-detail-close]")].find((element) => element.offsetParent !== null)?.focus();
  if (restoreDetailFocus && state.selectedTaskId) {
    document.querySelector(`[data-task-detail-open="${CSS.escape(state.selectedTaskId)}"]`)?.focus();
  }
  if (focusFeedback) {
    const feedbackInput = document.querySelector('[data-task-feedback-form] textarea[name="message"]');
    feedbackInput?.focus();
    if (feedbackInput && Number.isInteger(feedbackCursor)) feedbackInput.setSelectionRange(feedbackCursor, feedbackCursor);
  }
  if (focusFeedbackMenuId) document.querySelector(`[data-task-feedback-menu-open="${CSS.escape(focusFeedbackMenuId)}"]`)?.focus();
  if (focusFeedbackEditId) document.querySelector(`[data-task-feedback-edit-form="${CSS.escape(focusFeedbackEditId)}"] textarea`)?.focus();
  if (focusSubmit) document.querySelector('[data-task-submit-form] input[name="title"]')?.focus();
  if (focusSubmitSubtaskId) document.querySelector(`[data-task-submit-subtask-title="${CSS.escape(focusSubmitSubtaskId)}"]`)?.focus();
  if (restoreSubmitFocus) document.querySelector("[data-task-submit-open]")?.focus();
  if (focusFilterGroup) document.querySelector(`[data-filter-trigger][data-filter-group="${CSS.escape(focusFilterGroup)}"]`)?.focus();
  if (focusActionMenu) document.querySelector("[data-task-action-popover]")?.focus();
  if (restoreActionTaskId) document.querySelector(`[data-task-action-open="${CSS.escape(restoreActionTaskId)}"]`)?.focus();
  if (focusBoard) document.querySelector("[data-task-submit-open]")?.focus();
  if (focusSubtaskId) document.querySelector(`[data-task-subtask-toggle="${CSS.escape(focusSubtaskId)}"]`)?.focus();
  if (focusSubtaskAdd) document.querySelector('[data-task-subtask-form] input[name="title"]')?.focus();
  if (focusSubtaskEditId) document.querySelector(`[data-task-subtask-edit-form="${CSS.escape(focusSubtaskEditId)}"] input[name="subtaskTitle"]`)?.focus();
  activeScope?.animationFrame(observeTaskBoardUnreadColumns);
  if (taskLiveRefresh?.pending) queueMicrotask(() => void taskLiveRefresh.flush());
}

function clearTaskBoardColumnObservers() {
  taskBoardColumnReadObserver?.clear();
}

function observeTaskBoardUnreadColumns() {
  clearTaskBoardColumnObservers();
  if (!state || !taskBoardReadTracker || state.detailOpen || state.mode !== "board" || filterState?.view !== "board") return;
  taskBoardColumnReadObserver?.observe();
}

const onTaskViewportChange = () => rerenderTaskPage({ focusActionMenu: Boolean(state.actionTaskId) });

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId);
}

function selectedFeedback(feedbackId) {
  return selectedTask()?.feedback.find((entry) => entry.id === feedbackId) ?? null;
}

function resetFeedbackActions() {
  state.feedbackMenuId = null;
  state.feedbackEditingId = null;
  state.feedbackEditDraft = "";
  state.feedbackEditOriginal = "";
  state.feedbackEditError = "";
}

function clearFeedbackDraftAttachments() {
  revokeTaskFeedbackAttachmentDrafts(state?.feedbackDraft?.attachments);
}

function resetFeedbackDraft() {
  clearFeedbackDraftAttachments();
  state.feedbackDraft = createTaskFeedbackDraft();
}

function resetSubtaskDrafts() {
  state.subtaskAddDraft = { title: "", assigneeId: "" };
  state.subtaskEditingId = null;
  state.subtaskEditDraft = "";
  state.subtaskEditOriginal = "";
}

function closeFeedbackMenuInPlace({ restoreFocus = false } = {}) {
  const feedbackId = state.feedbackMenuId;
  if (!feedbackId) return;
  state.feedbackMenuId = null;
  document.querySelector("[data-task-feedback-menu-popover]")?.remove();
  const trigger = document.querySelector(`[data-task-feedback-menu-open="${CSS.escape(feedbackId)}"]`);
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger?.focus();
}

function syncFeedbackMentionMenuInPlace(input) {
  const editor = input?.closest("[data-task-feedback-mention-editor]");
  const menu = editor?.querySelector("[data-task-feedback-mention-menu]");
  if (!menu) return;
  const mentionMenu = state.feedbackDraft.mentionMenu;
  if (!mentionMenu?.open) {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  const query = String(mentionMenu.query || "").toLocaleLowerCase();
  let visibleCount = 0;
  menu.querySelectorAll("[data-task-feedback-mention-option]").forEach((option) => {
    const visible = !query || String(option.getAttribute("data-task-feedback-mention-name") || "").toLocaleLowerCase().includes(query);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = menu.querySelector("[data-task-feedback-mention-empty]");
  if (empty) empty.hidden = visibleCount > 0;
  menu.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function closeFeedbackMentionMenuInPlace() {
  if (!state.feedbackDraft.mentionMenu?.open) return;
  state.feedbackDraft = closeTaskFeedbackMention(state.feedbackDraft);
  const input = document.querySelector('[data-task-feedback-form] textarea[name="message"]');
  const menu = document.querySelector("[data-task-feedback-mention-menu]");
  if (menu) menu.hidden = true;
  input?.setAttribute("aria-expanded", "false");
}

function chooseFeedbackMention(userId) {
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return false;
  const member = taskFeedbackMentionCandidates(state.members, state.currentUser)
    .find((candidate) => candidate.userId === userId);
  const selection = selectTaskFeedbackMention(state.feedbackDraft, member);
  if (!selection) return false;
  state.feedbackDraft = selection.draft;
  rerenderTaskPage({ focusFeedback: true, feedbackCursor: selection.cursor });
  return true;
}

function onTaskMousedown(event) {
  const mentionOption = event.target.closest("[data-task-feedback-mention-option]");
  if (!mentionOption || event.button !== 0) return;
  event.preventDefault();
  chooseFeedbackMention(mentionOption.getAttribute("data-task-feedback-mention-option"));
}

function taskSubmitData() {
  return { ...data, members: state.members };
}

function taskSubmitDepartment(departmentId) {
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  return departments.find((department) => department.id === departmentId) ?? null;
}

function reconcileTaskSubmitAssignees(departmentId) {
  const eligibleMembers = taskMembersForDepartment(taskSubmitData(), departmentId);
  const eligibleNames = new Set(eligibleMembers.map((member) => member.name));
  const eligibleIds = new Set(eligibleMembers.map((member) => member.id));
  if (!state.submitCanAssignOthers && state.submitMode === "edit") {
    const task = state.tasks.find((item) => item.id === state.submitTaskId);
    const retained = (task?.assignees ?? []).filter((assignee) => eligibleMembers.some((member) => member.id === assignee.employeeId));
    state.submitDraft.owner = retained[0]?.name || "";
    state.submitDraft.memberIds = retained.slice(1).map((assignee) => assignee.employeeId);
    return;
  }
  const preferredOwner = eligibleMembers.find((member) => member.id === state.currentUser.id) ?? eligibleMembers[0];
  const owner = eligibleNames.has(state.submitDraft.owner) ? state.submitDraft.owner : preferredOwner?.name || "";
  const ownerId = eligibleMembers.find((member) => member.name === owner)?.id || "";
  state.submitDraft.owner = owner;
  state.submitDraft.memberIds = [...new Set(state.submitDraft.memberIds ?? [])]
    .filter((id) => eligibleIds.has(id) && id !== ownerId);
  state.submitDraft.memberQuery = "";
  state.submitDraft.memberMenuOpen = false;
  state.submitDraft.subtasks = (state.submitDraft.subtasks ?? []).map((subtask) =>
    subtask.assigneeId && !eligibleIds.has(subtask.assigneeId) ? { ...subtask, assigneeId: "" } : subtask);
}

function focusTaskMemberQuery() {
  activeScope?.animationFrame(() => {
    const input = document.querySelector("[data-task-member-query]");
    if (!input || input.disabled) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function filterTaskMemberCandidatesInPlace(input) {
  const editor = input?.closest("[data-task-member-editor]");
  const menu = editor?.querySelector("[data-task-member-menu]");
  if (!menu) return;
  const query = String(input.value || "").replace(/^@/, "").trim().toLocaleLowerCase();
  let visibleCount = 0;
  menu.querySelectorAll("[data-task-member-option]").forEach((option) => {
    const visible = !query || String(option.getAttribute("data-task-member-name") || "").toLocaleLowerCase().includes(query);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = menu.querySelector("[data-task-member-empty]");
  if (empty) empty.hidden = visibleCount > 0;
  menu.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function closeTaskMemberMenuInPlace() {
  state.submitDraft.memberMenuOpen = false;
  const input = document.querySelector("[data-task-member-query]");
  const menu = document.querySelector("[data-task-member-menu]");
  if (menu) menu.hidden = true;
  input?.setAttribute("aria-expanded", "false");
}

function closeTaskDetail() {
  state.detailOpen = false;
  state.detailTab = "content";
  state.attachmentPreview = null;
  resetFeedbackDraft();
  state.feedbackError = "";
  resetFeedbackActions();
  resetSubtaskDrafts();
  rerenderTaskPage({ restoreDetailFocus: true });
}

function leaveTaskDetailForNavigation() {
  state.detailOpen = false;
  state.selectedTaskId = null;
  state.detailTab = "content";
  state.attachmentPreview = null;
  resetFeedbackDraft();
  state.feedbackError = "";
  resetFeedbackActions();
  resetSubtaskDrafts();
}

function openTaskSubmit(priority = "") {
  if (!state.permissions.canCreate || (state.liveReadOnly && !state.liveTaskWrites)) return;
  state.actionTaskId = null;
  state.submitOpen = true;
  state.submitMode = "create";
  state.submitTaskId = null;
  state.submitOriginalDepartmentId = "";
  state.submitCanAssignOthers = state.permissions.canAssignOthers;
  state.submitError = "";
  state.writeError = "";
  state.writeErrorValues = {};
  state.writeNotice = "";
  state.submitDraft = {
    ...data.form.defaults,
    priority: ["high", "medium", "low"].includes(priority) ? priority : data.form.defaults.priority,
    owner: authenticated ? state.currentUser.name : data.form.defaults.owner,
    memberIds: [],
    memberQuery: "",
    memberMenuOpen: false,
    attachments: [],
    subtasks: [],
    content: data.form.defaults.content ?? (data.form.defaults.contentKey ? pageT(currentHelpers.lang, data.form.defaults.contentKey) : "")
  };
  rerenderTaskPage({ focusSubmit: true });
}

function canEditTask(task) {
  return Boolean(task) && (isTaskCreator(task, state.currentUser) || state.currentUser.isSuperAdmin ||
    state.currentUser.isAdminOfActive || state.permissions.canEditOthers);
}

function openTaskCopy(taskId) {
  if (!state.permissions.canCreate || state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const originalDepartmentId = String(task.departmentId || "");
  const departmentAvailable = availableTaskDepartments(state, taskSubmitData())
    .some((department) => department.id === originalDepartmentId);
  const currentUserEligible = taskMembersForDepartment(taskSubmitData(), originalDepartmentId)
    .some((member) => member.id === state.currentUser.id);
  const departmentId = originalDepartmentId && departmentAvailable && currentUserEligible ? originalDepartmentId : "";
  state.actionTaskId = null;
  state.submitOpen = true;
  state.submitMode = "create";
  state.submitTaskId = null;
  state.submitOriginalDepartmentId = "";
  state.submitCanAssignOthers = state.permissions.canAssignOthers;
  state.submitError = "";
  state.writeError = "";
  state.writeErrorValues = {};
  state.writeNotice = "";
  state.submitDraft = {
    ...data.form.defaults,
    title: task.title,
    content: task.content || "",
    priority: task.priority,
    visibility: departmentId ? "department" : "team",
    departmentId,
    owner: state.currentUser.name,
    memberIds: [],
    memberQuery: "",
    memberMenuOpen: false,
    startDate: String(task.startDate || "").replaceAll("/", "-"),
    attachments: [],
    subtasks: []
  };
  rerenderTaskPage({ focusSubmit: true });
}

function openTaskEdit(taskId) {
  if (!state.liveTaskWrites || state.writeBusy) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!canEditTask(task)) return;
  state.actionTaskId = null;
  state.submitOpen = true;
  state.submitMode = "edit";
  state.submitTaskId = task.id;
  state.submitOriginalDepartmentId = task.departmentId || "";
  state.submitCanAssignOthers = isTaskCreator(task, state.currentUser) || state.currentUser.isSuperAdmin ||
    state.currentUser.isAdminOfActive || state.permissions.canAssignOthers;
  state.submitError = "";
  state.writeError = "";
  state.writeErrorValues = {};
  state.writeNotice = "";
  state.submitDraft = {
    title: task.title,
    content: task.content,
    priority: task.priority,
    visibility: task.visibility,
    departmentId: task.departmentId || "",
    owner: task.assignees[0]?.name || "",
    requiresReview: task.requiresReview ? "yes" : "no",
    memberIds: task.assignees.slice(1).map((assignee) => assignee.employeeId).filter(Boolean),
    memberQuery: "",
    memberMenuOpen: false,
    startDate: String(task.startDate || "").replaceAll("/", "-"),
    due: String(task.due || "").replaceAll("/", "-"),
    attachments: (task.attachments ?? []).map((attachment) => ({ ...attachment }))
  };
  rerenderTaskPage({ focusSubmit: true });
}

function closeTaskSubmit() {
  if (state.writeBusy) return;
  taskDueDatePanel.close({ restoreFocus: false });
  taskStartDatePanel.close({ restoreFocus: false });
  state.submitOpen = false;
  state.submitOriginalDepartmentId = "";
  state.submitError = "";
  rerenderTaskPage({ restoreSubmitFocus: true });
}

function closeTaskAction({ restoreFocus = true } = {}) {
  const taskId = state.actionTaskId;
  if (!taskId) return;
  state.actionTaskId = null;
  rerenderTaskPage({ restoreActionTaskId: restoreFocus ? taskId : "" });
}

function descendantTaskIds(taskId) {
  const ids = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    state.tasks.forEach((task) => {
      if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        changed = true;
      }
    });
  }
  return ids;
}

function restoreAttachmentPreviewFocus(url) {
  [...document.querySelectorAll("[data-task-attachment-preview]")]
    .find((element) => element.getAttribute("data-task-attachment-preview") === url)
    ?.focus();
}

function adjustOpenTaskCounts(task, delta) {
  const allMembers = state.members.find((member) => member.dept === "all");
  if (allMembers) allMembers.taskCount = Math.max(0, allMembers.taskCount + delta);
  const assignedNames = new Set(task.members.map((name) => name.toLocaleLowerCase()));
  state.members.forEach((member) => {
    if (member.dept !== "all" && assignedNames.has(member.name.toLocaleLowerCase())) {
      member.taskCount = Math.max(0, member.taskCount + delta);
    }
  });
}

function appendTaskSubmitSubtaskEcho(parent, createdEntry, index) {
  const member = state.members.find((candidate) => candidate.id === createdEntry.subtask.assigneeId);
  if (!member) throw new Error(`Created subtask assignee is unavailable: ${createdEntry.subtask.assigneeId}`);
  const subtask = buildTaskSubtaskEcho({
    parent,
    subtask: createdEntry.subtask,
    member,
    result: createdEntry.result,
    localId: `local-subtask-${parent.id}-${Date.now()}-${index}`,
    timestamp: localTimestamp()
  });
  parent.subtasks.push(subtask);
  state.tasks.push(subtask);
  state.summary.total += 1;
  state.summary.inProgress += 1;
  adjustOpenTaskCounts(subtask, 1);
  return subtask;
}

function decrementOpenTaskCounts(task) {
  adjustOpenTaskCounts(task, -1);
}

function completeWholeTask(task, completedAt) {
  const wasComplete = task.done === true || task.status === "completed";
  task.assignees.forEach((assignee) => {
    if (assignee.completedAt == null && assignee.abandonedAt == null) assignee.completedAt = completedAt;
  });
  task.done = true;
  task.status = "completed";
  task.completedAt = completedAt;
  if (task.requiresReview) {
    task.approvedAt = completedAt;
    task.approvedBy = state.currentUser.name;
  }
  if (!wasComplete) {
    state.summary.completed += 1;
    state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
    decrementOpenTaskCounts(task);
  }
}

function reopenWholeTask(task) {
  const wasComplete = task.done === true || task.status === "completed";
  task.done = false;
  task.status = "inProgress";
  task.completedAt = "";
  task.approvedAt = "";
  task.approvedBy = "";
  if (wasComplete) {
    state.summary.completed = Math.max(0, state.summary.completed - 1);
    state.summary.inProgress += 1;
    adjustOpenTaskCounts(task, 1);
  }
}

async function toggleTaskCompletion(taskId, { forceComplete = false } = {}) {
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const completion = taskCompletionForMember(task, state.currentUser);
  if (!completion.canToggle) return;
  const completed = forceComplete ? true : !completion.checked;
  if (forceComplete && completion.checked) return;
  const targetAssignee = completion.wholeTask ? null : taskAssignee(task, state.currentUser);
  if (!completion.wholeTask && !targetAssignee) return;
  const mountId = activeMountId;
  const scope = activeScope;
  if (state.liveTaskWrites) {
    state.writeBusy = true;
    state.writeError = "";
    rerenderTaskPage();
    try {
      const result = await completeLiveTask({
        taskId: task.id,
        targetEmployeeId: targetAssignee?.employeeId,
        wholeTask: completion.wholeTask,
        needsApproval: task.requiresReview,
        completed
      });
      if (!isCurrentTaskMount(mountId, scope)) return;
      if (completion.wholeTask) {
        if (completed) completeWholeTask(task, result.completedAt);
        else reopenWholeTask(task);
      } else {
        targetAssignee.completedAt = result.completedAt;
        targetAssignee.abandonedAt = null;
        if (result.taskDone) completeWholeTask(task, result.completedAt);
        else if (!completed) reopenWholeTask(task);
      }
    } catch (error) {
      if (!isCurrentTaskMount(mountId, scope)) return;
      console.warn("Task completion update failed", error);
      state.writeError = "tasks.write.failed";
    } finally {
      if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
    }
  } else if (completion.wholeTask) {
    if (completed) completeWholeTask(task, localTimestamp());
    else reopenWholeTask(task);
  } else {
    targetAssignee.completedAt = completed ? localTimestamp() : null;
    targetAssignee.abandonedAt = null;
    const allDone = task.assignees.length > 0 && task.assignees.every((assignee) => assignee.completedAt != null);
    if (allDone && !task.requiresReview) completeWholeTask(task, targetAssignee.completedAt);
    else if (!completed) reopenWholeTask(task);
  }
  if (!isCurrentTaskMount(mountId, scope)) return;
  state.actionTaskId = null;
  taskBoardReadTracker?.refresh(state.tasks);
  rerenderTaskPage({ focusBoard: true });
}

async function approveWaitingTask(task) {
  if (!state.liveTaskWrites || state.writeBusy || !isWaitingApproval(task)) return;
  const mountId = activeMountId;
  const scope = activeScope;
  state.writeBusy = true;
  state.writeError = "";
  rerenderTaskPage();
  try {
    const result = await approveLiveTask(task.id);
    if (!isCurrentTaskMount(mountId, scope)) return;
    const completed = result.row.status === "done";
    task.approvedAt = result.row.approved_at;
    task.approvedBy = result.approvedBy;
    task.completedAt = result.row.completed_at;
    task.done = completed;
    task.status = completed ? "completed" : "abandoned";
    if (completed) state.summary.completed += 1;
    state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
    adjustOpenTaskCounts(task, -1);
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return;
    console.warn("Task approval failed", error);
    state.writeError = "tasks.write.failed";
  } finally {
    if (!isCurrentTaskMount(mountId, scope)) return;
    state.writeBusy = false;
    rerenderTaskPage();
  }
}

async function performTaskAction(taskId, action) {
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  if (action === "complete") {
    await toggleTaskCompletion(taskId, { forceComplete: true });
    return;
  }
  const mountId = activeMountId;
  const scope = activeScope;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (action === "delete") {
    if (!canDeleteTaskForUser(task, state.currentUser, state.permissions)) return;
    state.writeError = "";
    state.writeNotice = "";
    if (state.liveTaskWrites) {
      state.writeBusy = true;
      rerenderTaskPage();
      try {
        await deleteLiveTask(task.id);
      } catch (error) {
        if (!isCurrentTaskMount(mountId, scope)) return;
        console.warn("Task deletion failed", error);
        state.writeError = "tasks.write.failed";
        state.writeBusy = false;
        rerenderTaskPage({ focusBoard: true });
        return;
      }
      if (!isCurrentTaskMount(mountId, scope)) return;
      state.writeBusy = false;
    }
    const removedIds = descendantTaskIds(task.id);
    const removedTasks = state.tasks.filter((item) => removedIds.has(item.id));
    state.board.forEach((boardColumn) => {
      boardColumn.tasks = boardColumn.tasks.filter((item) => !removedIds.has(item.id));
    });
    state.tasks = state.tasks.filter((item) => !removedIds.has(item.id));
    state.summary.total = Math.max(0, state.summary.total - removedIds.size);
    removedTasks.forEach((removedTask) => {
      if (removedTask.status === "completed") state.summary.completed = Math.max(0, state.summary.completed - 1);
      else if (removedTask.status !== "abandoned") {
        state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
        adjustOpenTaskCounts(removedTask, -1);
      }
    });
    if (removedIds.has(state.selectedTaskId)) leaveTaskDetailForNavigation();
    state.writeNotice = "tasks.write.deleted";
  }
  state.actionTaskId = null;
  rerenderTaskPage({ focusBoard: true });
}

function localTimestamp() {
  return new Intl.DateTimeFormat(currentHelpers?.lang === "fr" ? "fr-FR" : currentHelpers?.lang === "en" ? "en-GB" : "zh-HK", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date());
}

async function toggleTaskParticipation(task) {
  if (!state.liveTaskWrites || state.writeBusy) return;
  const mountId = activeMountId;
  const scope = activeScope;
  const assignee = taskAssignee(task, state.currentUser);
  if (!assignee) return;
  const abandoned = assignee.abandonedAt != null || ((task.assignees?.length ?? 0) === 1 && task.status === "abandoned");
  const nextAbandoned = !abandoned;
  // Mirrors old team: this is per-assignee participation, not task deletion.
  // Abandoning removes the task from that member's open scope without deleting its row.
  const singleAssignee = task.assignees.length === 1 && !task.requiresReview;
  state.writeBusy = true;
  state.writeError = "";
  rerenderTaskPage();
  try {
    const result = await setLiveTaskParticipation({
      taskId: task.id,
      employeeId: assignee.employeeId,
      abandoned: nextAbandoned,
      singleAssignee
    });
    if (!isCurrentTaskMount(mountId, scope)) return;
    assignee.abandonedAt = result.changedAt;
    assignee.completedAt = null;
    if (singleAssignee) {
      task.status = nextAbandoned ? "abandoned" : "inProgress";
      task.done = false;
      task.completedAt = result.changedAt || "";
      state.summary.inProgress = Math.max(0, state.summary.inProgress + (nextAbandoned ? -1 : 1));
      adjustOpenTaskCounts(task, nextAbandoned ? -1 : 1);
    }
    if (nextAbandoned) state.detailOpen = false;
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return;
    console.warn("Task participation update failed", error);
    state.writeError = "tasks.write.failed";
  } finally {
    if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
  }
  if (!isCurrentTaskMount(mountId, scope)) return;
  rerenderTaskPage({ focusDetail: state.detailOpen, focusBoard: !state.detailOpen });
}

async function toggleSubtaskCompletion(subtask) {
  if (!state.liveTaskWrites || state.writeBusy || !subtask?.parentId) return;
  const ownAssignee = taskAssignee(subtask, state.currentUser);
  if (!ownAssignee) return;
  const mountId = activeMountId;
  const scope = activeScope;
  const nextCompleted = ownAssignee.completedAt == null;
  const wasDone = subtask.done === true || subtask.status === "completed";
  state.writeBusy = true;
  state.writeError = "";
  rerenderTaskPage({ focusSubtaskId: subtask.id });
  try {
    const result = await setLiveSubtaskCompletion({ taskId: subtask.id, completed: nextCompleted });
    if (!isCurrentTaskMount(mountId, scope)) return;
    ownAssignee.completedAt = result.completedAt;
    ownAssignee.abandonedAt = null;
    subtask.done = result.taskDone;
    subtask.status = result.taskDone ? "completed" : "inProgress";
    subtask.completedAt = result.taskDone ? result.completedAt : "";
    if (result.taskDone && !wasDone) {
      state.summary.completed += 1;
      state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
      adjustOpenTaskCounts(subtask, -1);
    } else if (!result.taskDone && wasDone) {
      state.summary.completed = Math.max(0, state.summary.completed - 1);
      state.summary.inProgress += 1;
      adjustOpenTaskCounts(subtask, 1);
    }
    taskBoardReadTracker?.refresh(state.tasks);
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return;
    console.warn("Subtask completion update failed", error);
    state.writeError = "tasks.write.failed";
  } finally {
    if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
  }
  if (!isCurrentTaskMount(mountId, scope)) return;
  rerenderTaskPage({ focusSubtaskId: subtask.id });
}

async function createSubtaskWrite(parent, title, member) {
  if (!state.liveTaskWrites || state.writeBusy || !parent || !member) return null;
  const mountId = activeMountId;
  const scope = activeScope;
  state.writeBusy = true;
  state.writeError = "";
  state.writeNotice = "";
  rerenderTaskPage();
  try {
    const result = await createLiveSubtask({
      parentTaskId: parent.id,
      title,
      assigneeId: member.id
    });
    if (!isCurrentTaskMount(mountId, scope)) return null;
    state.writeNotice = "tasks.write.subtaskCreated";
    return result;
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return null;
    console.warn("Subtask create failed", error);
    state.writeError = "tasks.write.failed";
    return null;
  } finally {
    if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
  }
}

async function updateSubtaskTitleWrite(subtask, title) {
  if (!state.liveTaskWrites || state.writeBusy || !subtask?.parentId) return null;
  const mountId = activeMountId;
  const scope = activeScope;
  state.writeBusy = true;
  state.writeError = "";
  state.writeNotice = "";
  rerenderTaskPage({ focusSubtaskEditId: subtask.id });
  try {
    const result = await updateLiveSubtaskTitle({ subtaskId: subtask.id, title });
    if (!isCurrentTaskMount(mountId, scope)) return null;
    state.writeNotice = "tasks.write.subtaskSaved";
    return result;
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return null;
    console.warn("Subtask title update failed", error);
    state.writeError = "tasks.write.failed";
    return null;
  } finally {
    if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
  }
}

async function deleteSubtaskWrite(subtask) {
  if (!state.liveTaskWrites || state.writeBusy || !subtask?.parentId) return false;
  const mountId = activeMountId;
  const scope = activeScope;
  state.writeBusy = true;
  state.writeError = "";
  state.writeNotice = "";
  rerenderTaskPage();
  try {
    await deleteLiveSubtask(subtask.id);
    if (!isCurrentTaskMount(mountId, scope)) return false;
    state.writeNotice = "tasks.write.subtaskDeleted";
    return true;
  } catch (error) {
    if (!isCurrentTaskMount(mountId, scope)) return false;
    console.warn("Subtask deletion failed", error);
    state.writeError = "tasks.write.failed";
    return false;
  } finally {
    if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
  }
}

async function onTaskClick(event) {
  if (state.feedbackMenuId && !event.target.closest("[data-task-feedback-menu-wrap]")) {
    closeFeedbackMenuInPlace();
  }
  if (state.feedbackDraft.mentionMenu?.open && !event.target.closest("[data-task-feedback-mention-editor]")) {
    closeFeedbackMentionMenuInPlace();
  }

  const feedbackPanelToggle = event.target.closest("[data-task-feedback-panel-toggle]");
  if (feedbackPanelToggle) {
    const taskId = feedbackPanelToggle.getAttribute("data-task-feedback-panel-toggle");
    if (state.feedbackPanelExpandedTaskIds.has(taskId)) state.feedbackPanelExpandedTaskIds.delete(taskId);
    else state.feedbackPanelExpandedTaskIds.add(taskId);
    rerenderTaskPage();
    activeScope?.animationFrame(() => document.querySelector(`[data-task-feedback-panel-toggle="${CSS.escape(taskId)}"]`)?.focus());
    return;
  }

  const columnExpand = event.target.closest("[data-task-column-expand]");
  if (columnExpand) {
    const priority = columnExpand.getAttribute("data-task-column-expand");
    if (!["high", "medium", "low"].includes(priority)) return;
    if (state.boardExpandedPriorities.has(priority)) state.boardExpandedPriorities.delete(priority);
    else state.boardExpandedPriorities.add(priority);
    rerenderTaskPage();
    activeScope?.animationFrame(() => document.querySelector(`[data-task-column-expand="${CSS.escape(priority)}"]`)?.focus());
    return;
  }

  const columnAdd = event.target.closest("[data-task-column-add]");
  if (columnAdd) {
    if (columnAdd.disabled) return;
    openTaskSubmit(columnAdd.getAttribute("data-task-column-add"));
    return;
  }

  if (event.target.closest("[data-task-members-manage]")) {
    window.location.href = "./members.html";
    return;
  }

  const completionToggle = event.target.closest("[data-task-completion-toggle]");
  if (completionToggle) {
    if (completionToggle.disabled) return;
    await toggleTaskCompletion(completionToggle.getAttribute("data-task-completion-toggle"));
    return;
  }

  const completeAction = event.target.closest("[data-task-action-complete]");
  if (completeAction) {
    if (completeAction.disabled || (state.liveReadOnly && !state.liveTaskWrites)) return;
    await performTaskAction(completeAction.getAttribute("data-task-action-complete"), "complete");
    return;
  }

  const editAction = event.target.closest("[data-task-action-edit]");
  if (editAction) {
    if (editAction.disabled) return;
    openTaskEdit(editAction.getAttribute("data-task-action-edit"));
    return;
  }

  const copyAction = event.target.closest("[data-task-action-copy]");
  if (copyAction) {
    if (copyAction.disabled) return;
    openTaskCopy(copyAction.getAttribute("data-task-action-copy"));
    return;
  }

  const deleteAction = event.target.closest("[data-task-action-delete]");
  if (deleteAction) {
    if (deleteAction.disabled || (state.liveReadOnly && !state.liveTaskWrites)) return;
    const taskId = deleteAction.getAttribute("data-task-action-delete");
    const task = state.tasks.find((item) => item.id === taskId);
    if (!canDeleteTaskForUser(task, state.currentUser, state.permissions)) return;
    if (await confirmInPage(pageT(currentHelpers.lang, "tasks.action.deleteConfirm"), { danger: true })) {
      if (!activeScope?.isCurrent()) return;
      await performTaskAction(taskId, "delete");
    }
    return;
  }

  const actionTrigger = event.target.closest("[data-task-action-open]");
  if (actionTrigger) {
    const taskId = actionTrigger.getAttribute("data-task-action-open");
    if (state.actionTaskId === taskId) closeTaskAction();
    else {
      state.actionTaskId = taskId;
      closeAllFilterMenus(null);
      rerenderTaskPage({ focusActionMenu: true });
    }
    return;
  }

  if (event.target.closest("[data-task-submit-open]")) {
    openTaskSubmit();
    return;
  }

  const dueTrigger = event.target.closest("[data-task-due-trigger]");
  if (dueTrigger) {
    if (dueTrigger.disabled || state.writeBusy) return;
    taskStartDatePanel.close({ restoreFocus: false });
    taskDueDatePanel.open({
      anchor: dueTrigger,
      mode: "single",
      date: state.submitDraft.due,
      language: currentHelpers?.lang ?? "zh",
      t: (key) => pageT(currentHelpers?.lang ?? "zh", `tasks.date.${key}`),
      onCommit: ({ date }) => {
        if (!activeScope?.isCurrent() || !state.submitOpen) return;
        state.submitDraft.due = date;
        if (state.submitError === "tasks.submit.dueRequired") state.submitError = "";
        rerenderTaskPage({ focusSubmit: false });
        activeScope.animationFrame(() => document.querySelector("[data-task-due-trigger]")?.focus());
      }
    });
    return;
  }

  const startTrigger = event.target.closest("[data-task-start-trigger]");
  if (startTrigger) {
    if (startTrigger.disabled || state.writeBusy) return;
    taskDueDatePanel.close({ restoreFocus: false });
    taskStartDatePanel.open({
      anchor: startTrigger,
      mode: "single",
      date: state.submitDraft.startDate,
      language: currentHelpers?.lang ?? "zh",
      t: (key) => key === "date"
        ? pageT(currentHelpers?.lang ?? "zh", "tasks.submit.startAt")
        : pageT(currentHelpers?.lang ?? "zh", `tasks.date.${key}`),
      onCommit: ({ date }) => {
        if (!activeScope?.isCurrent() || !state.submitOpen) return;
        state.submitDraft.startDate = date;
        rerenderTaskPage({ focusSubmit: false });
        activeScope.animationFrame(() => document.querySelector("[data-task-start-trigger]")?.focus());
      }
    });
    return;
  }

  const detailCopy = event.target.closest("[data-task-copy]");
  if (detailCopy) {
    if (detailCopy.disabled) return;
    openTaskCopy(detailCopy.getAttribute("data-task-copy"));
    return;
  }

  const attachmentPreview = event.target.closest("[data-task-attachment-preview]");
  if (attachmentPreview) {
    state.attachmentPreview = {
      url: attachmentPreview.getAttribute("data-task-attachment-preview"),
      name: attachmentPreview.getAttribute("data-task-attachment-name") || ""
    };
    rerenderTaskPage();
    document.querySelector("[data-task-attachment-viewer-close]")?.focus();
    return;
  }

  if (event.target.closest("[data-task-attachment-viewer-close]") || event.target.matches("[data-task-attachment-viewer]")) {
    const previewUrl = state.attachmentPreview?.url || "";
    state.attachmentPreview = null;
    rerenderTaskPage();
    if (previewUrl) restoreAttachmentPreviewFocus(previewUrl);
    return;
  }

  if (event.target.closest("[data-task-submit-attachment]")) {
    document.querySelector("[data-task-submit-file]")?.click();
    return;
  }

  if (event.target.closest("[data-task-submit-subtask-add]")) {
    if (state.submitMode === "edit" || state.writeBusy) return;
    const subtask = createTaskSubmitSubtaskDraft();
    state.submitDraft.subtasks = [...(state.submitDraft.subtasks ?? []), subtask];
    rerenderTaskPage({ focusSubmitSubtaskId: subtask.id });
    return;
  }

  const submitSubtaskRemove = event.target.closest("[data-task-submit-subtask-remove]");
  if (submitSubtaskRemove) {
    if (state.submitMode === "edit" || submitSubtaskRemove.disabled || state.writeBusy) return;
    const subtaskId = submitSubtaskRemove.getAttribute("data-task-submit-subtask-remove");
    state.submitDraft.subtasks = (state.submitDraft.subtasks ?? []).filter((subtask) => subtask.id !== subtaskId);
    rerenderTaskPage();
    activeScope?.animationFrame(() => document.querySelector("[data-task-submit-subtask-add]")?.focus());
    return;
  }

  const submitAttachmentRemove = event.target.closest("[data-task-submit-attachment-remove]");
  if (submitAttachmentRemove) {
    if (submitAttachmentRemove.disabled || state.writeBusy) return;
    const index = Number(submitAttachmentRemove.getAttribute("data-task-submit-attachment-remove"));
    if (Number.isInteger(index)) state.submitDraft.attachments.splice(index, 1);
    rerenderTaskPage({ focusSubmit: true });
    return;
  }

  const memberOption = event.target.closest("[data-task-member-option]");
  if (memberOption) {
    if (!state.submitCanAssignOthers || state.writeBusy) return;
    const memberId = memberOption.getAttribute("data-task-member-option");
    const eligibleMembers = taskMembersForDepartment(taskSubmitData(), state.submitDraft.departmentId || "");
    const member = eligibleMembers.find((item) => item.id === memberId);
    const ownerId = eligibleMembers.find((item) => item.name === state.submitDraft.owner)?.id || "";
    if (!member || member.id === ownerId) return;
    state.submitDraft.memberIds = [...new Set([...(state.submitDraft.memberIds ?? []), member.id])];
    state.submitDraft.memberQuery = "";
    state.submitDraft.memberMenuOpen = true;
    rerenderTaskPage();
    focusTaskMemberQuery();
    return;
  }

  const memberRemove = event.target.closest("[data-task-member-remove]");
  if (memberRemove) {
    if (memberRemove.disabled || !state.submitCanAssignOthers || state.writeBusy) return;
    const memberId = memberRemove.getAttribute("data-task-member-remove");
    state.submitDraft.memberIds = (state.submitDraft.memberIds ?? []).filter((id) => id !== memberId);
    state.submitDraft.memberMenuOpen = true;
    rerenderTaskPage();
    focusTaskMemberQuery();
    return;
  }

  if (event.target.closest("[data-task-feedback-attachment]")) {
    document.querySelector("[data-task-feedback-file]")?.click();
    return;
  }

  const feedbackMentionOption = event.target.closest("[data-task-feedback-mention-option]");
  if (feedbackMentionOption) {
    chooseFeedbackMention(feedbackMentionOption.getAttribute("data-task-feedback-mention-option"));
    return;
  }

  const feedbackMentionRemove = event.target.closest("[data-task-feedback-mention-remove]");
  if (feedbackMentionRemove) {
    if (feedbackMentionRemove.disabled || state.writeBusy) return;
    const userId = feedbackMentionRemove.getAttribute("data-task-feedback-mention-remove");
    state.feedbackDraft = removeTaskFeedbackMention(state.feedbackDraft, userId);
    rerenderTaskPage({ focusFeedback: true });
    return;
  }

  const feedbackAttachmentRemove = event.target.closest("[data-task-feedback-attachment-remove]");
  if (feedbackAttachmentRemove) {
    if (feedbackAttachmentRemove.disabled || state.writeBusy) return;
    const index = Number(feedbackAttachmentRemove.getAttribute("data-task-feedback-attachment-remove"));
    if (Number.isInteger(index)) {
      const removed = state.feedbackDraft.attachments.splice(index, 1);
      revokeTaskFeedbackAttachmentDrafts(removed);
    }
    rerenderTaskPage({ focusFeedback: true });
    return;
  }

  const feedbackMenuOpen = event.target.closest("[data-task-feedback-menu-open]");
  if (feedbackMenuOpen) {
    const feedbackId = feedbackMenuOpen.getAttribute("data-task-feedback-menu-open");
    const entry = selectedFeedback(feedbackId);
    if (!entry?.own) return;
    const willOpen = state.feedbackMenuId !== feedbackId;
    state.feedbackMenuId = willOpen ? feedbackId : null;
    rerenderTaskPage({ focusFeedbackMenuId: feedbackId });
    if (willOpen) activeScope?.animationFrame(() => document.querySelector("[data-task-feedback-menu-popover] [role=menuitem]")?.focus());
    return;
  }

  const feedbackEditStart = event.target.closest("[data-task-feedback-edit-start]");
  if (feedbackEditStart) {
    const feedbackId = feedbackEditStart.getAttribute("data-task-feedback-edit-start");
    const entry = selectedFeedback(feedbackId);
    const message = String(entry?.message || "");
    if (!entry?.own || !message.trim() || state.writeBusy) return;
    state.feedbackMenuId = null;
    state.feedbackEditingId = feedbackId;
    state.feedbackEditDraft = message;
    state.feedbackEditOriginal = message;
    state.feedbackEditError = "";
    rerenderTaskPage({ focusFeedbackEditId: feedbackId });
    return;
  }

  const feedbackEditCancel = event.target.closest("[data-task-feedback-edit-cancel]");
  if (feedbackEditCancel) {
    if (feedbackEditCancel.disabled || state.writeBusy) return;
    const feedbackId = feedbackEditCancel.getAttribute("data-task-feedback-edit-cancel");
    resetFeedbackActions();
    rerenderTaskPage({ focusFeedbackMenuId: feedbackId });
    return;
  }

  const feedbackDelete = event.target.closest("[data-task-feedback-delete]");
  if (feedbackDelete) {
    if (feedbackDelete.disabled || state.writeBusy) return;
    const feedbackId = feedbackDelete.getAttribute("data-task-feedback-delete");
    const task = selectedTask();
    const entry = selectedFeedback(feedbackId);
    if (!task || !entry?.own) return;
    if (!await confirmInPage(pageT(currentHelpers.lang, "tasks.detail.feedbackDeleteConfirm"), { danger: true })) {
      if (activeScope?.isCurrent()) rerenderTaskPage({ focusFeedbackMenuId: feedbackId });
      return;
    }
    const mountId = activeMountId;
    const scope = activeScope;
    state.writeBusy = true;
    state.feedbackMenuId = null;
    state.feedbackError = "";
    rerenderTaskPage();
    try {
      if (state.liveTaskWrites) await deleteLiveTaskFeedback(feedbackId);
      if (!isCurrentTaskMount(mountId, scope)) return;
      task.feedback = task.feedback.filter((item) => item.id !== feedbackId);
      task.countBadge = task.feedback.length ? String(task.feedback.length) : "";
      resetFeedbackActions();
    } catch (error) {
      if (!isCurrentTaskMount(mountId, scope)) return;
      console.warn("Task feedback delete failed", error);
      state.feedbackError = "tasks.write.failed";
    } finally {
      if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
    }
    if (isCurrentTaskMount(mountId, scope)) rerenderTaskPage({ focusFeedback: true });
    return;
  }

  if (event.target.closest("[data-task-submit-close]") || event.target.matches("[data-task-submit-overlay]")) {
    closeTaskSubmit();
    return;
  }

  const detailTrigger = event.target.closest("[data-task-detail-open]");
  if (detailTrigger) {
    state.actionTaskId = null;
    state.selectedTaskId = detailTrigger.getAttribute("data-task-detail-open");
    state.detailOpen = true;
    state.detailTab = isTaskMentionedForMember(selectedTask(), state.currentUser) ? "feedback" : "content";
    if (detailTrigger.hasAttribute("data-task-feedback-panel-open")) state.detailTab = "feedback";
    state.attachmentPreview = null;
    resetFeedbackDraft();
    state.feedbackError = "";
    resetFeedbackActions();
    resetSubtaskDrafts();
    state.calendarExpandedDate = null;
    closeAllFilterMenus(null);
    rerenderTaskPage({ focusDetail: true });
    return;
  }

  if (event.target.closest("[data-task-detail-close]")) {
    closeTaskDetail();
    return;
  }

  const detailTab = event.target.closest("[data-task-detail-tab]");
  if (detailTab) {
    state.detailTab = detailTab.getAttribute("data-task-detail-tab") || "content";
    if (state.detailTab !== "feedback") resetFeedbackActions();
    rerenderTaskPage();
    document.querySelector(`[data-task-detail-tab="${CSS.escape(state.detailTab)}"]`)?.focus();
    return;
  }

  let trigger = event.target.closest("[data-filter-trigger]");
  if (trigger) {
    if (state.actionTaskId) {
      const group = trigger.getAttribute("data-filter-group");
      state.actionTaskId = null;
      rerenderTaskPage();
      trigger = document.querySelector(`[data-filter-trigger][data-filter-group="${CSS.escape(group)}"]`);
    }
    const anchor = trigger.closest("[data-filter-menu]");
    const popover = anchor && anchor.querySelector("[data-filter-popover]");
    if (!popover) return;
    const willOpen = !popover.classList.contains("menu-popover--open");
    closeAllFilterMenus(willOpen ? popover : null);
    popover.classList.toggle("menu-popover--open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
    return;
  }

  const option = event.target.closest("[data-filter-option]");
  if (option) {
    const group = option.getAttribute("data-filter-group");
    const value = option.getAttribute("data-filter-value");
    closeAllFilterMenus(null);
    if (isTaskFilterGroup(group)) {
      if (filterState[group] !== value) {
        filterState[group] = value;
        state.boardExpandedPriorities.clear();
      }
      if (group === "member") state.mode = "board";
      if (group === "view") setSessionValue("team-tasks-view-mode", value);
      rerenderTaskPage({ focusFilterGroup: group }); // 选中自动关 + 就地重渲筛后看板
    }
    return;
  }

  // 点浮层外部:全部关闭(浮层内部非选项的点击不关)
  if (!event.target.closest("[data-filter-popover]")) {
    closeAllFilterMenus(null);
  }
  if (state.submitDraft.memberMenuOpen && !event.target.closest("[data-task-member-editor]")) closeTaskMemberMenuInPlace();
  if (state.actionTaskId && !event.target.closest("[data-task-action-popover]")) closeTaskAction();
}

function onTaskKeydown(event) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && event.target.closest("[data-task-feedback-message]")) {
    event.preventDefault();
    event.target.form?.requestSubmit();
    return;
  }
  if (event.key !== "Escape") return;
  if (state.feedbackDraft.mentionMenu?.open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeFeedbackMentionMenuInPlace();
    return;
  }
  if (state.subtaskEditingId) {
    const subtaskId = state.subtaskEditingId;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.subtaskEditingId = null;
    state.subtaskEditDraft = "";
    state.subtaskEditOriginal = "";
    rerenderTaskPage({ focusSubtaskId: subtaskId });
    return;
  }
  if (state.feedbackEditingId) {
    const feedbackId = state.feedbackEditingId;
    event.preventDefault();
    resetFeedbackActions();
    rerenderTaskPage({ focusFeedbackMenuId: feedbackId });
    return;
  }
  if (state.feedbackMenuId) {
    event.preventDefault();
    closeFeedbackMenuInPlace({ restoreFocus: true });
    return;
  }
  if (event.target.closest("[data-task-member-query]") && state.submitDraft.memberMenuOpen) {
    event.preventDefault();
    event.stopPropagation();
    closeTaskMemberMenuInPlace();
    return;
  }
  if (state.attachmentPreview) {
    const previewUrl = state.attachmentPreview.url;
    state.attachmentPreview = null;
    rerenderTaskPage();
    restoreAttachmentPreviewFocus(previewUrl);
    return;
  }
  if (state.submitOpen) {
    closeTaskSubmit();
    return;
  }
  if (state.detailOpen) {
    closeTaskDetail();
    return;
  }
  if (state.actionTaskId) {
    closeTaskAction();
    return;
  }
  const openFilter = document.querySelector("[data-filter-popover].menu-popover--open");
  const filterTrigger = openFilter?.parentElement.querySelector("[data-filter-trigger]");
  closeAllFilterMenus(null);
  filterTrigger?.focus();
}

async function onTaskSubmit(event) {
  const mountId = activeMountId;
  const scope = activeScope;
  const feedbackEditForm = event.target.closest("[data-task-feedback-edit-form]");
  if (feedbackEditForm) {
    event.preventDefault();
    const feedbackId = feedbackEditForm.getAttribute("data-task-feedback-edit-form");
    const entry = selectedFeedback(feedbackId);
    const message = String(state.feedbackEditDraft || "").trim();
    if (!entry?.own || state.feedbackEditingId !== feedbackId || state.writeBusy) return;
    if (!message) {
      state.feedbackEditError = "tasks.detail.feedbackRequired";
      rerenderTaskPage({ focusFeedbackEditId: feedbackId });
      return;
    }
    if (message === state.feedbackEditOriginal) {
      resetFeedbackActions();
      rerenderTaskPage({ focusFeedbackMenuId: feedbackId });
      return;
    }
    state.writeBusy = true;
    state.feedbackEditError = "";
    rerenderTaskPage({ focusFeedbackEditId: feedbackId });
    try {
      const result = state.liveTaskWrites
        ? await updateLiveTaskFeedback(feedbackId, message)
        : { body: message };
      if (!isCurrentTaskMount(mountId, scope)) return;
      entry.message = result.body || message;
      resetFeedbackActions();
    } catch (error) {
      if (!isCurrentTaskMount(mountId, scope)) return;
      console.warn("Task feedback edit failed", error);
      state.feedbackEditError = "tasks.write.failed";
    } finally {
      if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
    }
    if (isCurrentTaskMount(mountId, scope)) {
      rerenderTaskPage(state.feedbackEditingId
        ? { focusFeedbackEditId: feedbackId }
        : { focusFeedbackMenuId: feedbackId });
    }
    return;
  }
  const taskForm = event.target.closest("[data-task-submit-form]");
  if (taskForm) {
    event.preventDefault();
    const editingTask = state.submitMode === "edit"
      ? state.tasks.find((task) => task.id === state.submitTaskId)
      : null;
    if (state.writeBusy || (state.submitMode === "create" && !state.permissions.canCreate) ||
      (state.submitMode === "edit" && !canEditTask(editingTask)) ||
      (state.liveReadOnly && !state.liveTaskWrites)) return;
    const values = new FormData(taskForm);
    const priority = String(values.get("priority") || "high");
    const departmentId = String(values.get("departmentId") ?? state.submitDraft.departmentId ?? "");
    const availableDepartmentIds = new Set(availableTaskDepartments(state, taskSubmitData()).map((department) => department.id));
    if (departmentId && !availableDepartmentIds.has(departmentId)) {
      state.submitError = "tasks.submit.invalidDepartment";
      rerenderTaskPage({ focusSubmit: true });
      return;
    }
    const eligibleMembers = taskMembersForDepartment(taskSubmitData(), departmentId);
    const eligibleMemberIds = new Set(eligibleMembers.map((member) => member.id));
    const owner = String(values.get("owner") ?? state.submitDraft.owner ?? "");
    // Old team AssigneeChipEditor persists selected employee ids to task_assignees;
    // the free-text @ query is intentionally excluded from the write payload.
    const ownerRow = eligibleMembers.find((member) => member.name === owner);
    const selectedMemberIds = [...new Set(state.submitDraft.memberIds ?? [])].filter(Boolean);
    const selectedRows = selectedMemberIds
      .map((memberId) => eligibleMembers.find((member) => member.id === memberId))
      .filter(Boolean);
    const assignedRows = state.submitCanAssignOthers
      ? [ownerRow, ...selectedRows].filter((member, index, rows) => member && rows.findIndex((row) => row?.id === member.id) === index)
      : state.submitMode === "edit"
        ? (state.tasks.find((task) => task.id === state.submitTaskId)?.assignees ?? [])
          .map((assignee) => state.members.find((member) => member.id === assignee.employeeId))
          .filter((member) => member && eligibleMemberIds.has(member.id))
        : eligibleMembers.filter((member) => member.id === state.currentUser.id);
    const invalidSelection = state.submitCanAssignOthers && (!ownerRow || selectedRows.length !== selectedMemberIds.length);
    if (!assignedRows.length || invalidSelection) {
      state.submitError = assignedRows.length ? "tasks.submit.invalidAssignee" : "tasks.submit.assigneeRequired";
      rerenderTaskPage({ focusSubmit: true });
      return;
    }
    const title = String(values.get("title") || "").trim();
    const content = String(values.get("content") || "").trim();
    const startDate = String(values.get("startDate") || "");
    const due = String(values.get("due") || "");
    const requiresReview = values.get("requiresReview") === "yes";
    const assignedMembers = assignedRows.map((member) => member.name);
    const subtaskEligibleMembers = state.submitCanAssignOthers
      ? eligibleMembers
      : eligibleMembers.filter((member) => member.id === state.currentUser.id);
    const submitSubtasks = state.submitMode === "create"
      ? normalizeTaskSubmitSubtasks(state.submitDraft.subtasks, {
        parentAssigneeId: assignedRows[0]?.id,
        eligibleMembers: subtaskEligibleMembers
      })
      : [];
    if (!due) {
      state.submitError = "tasks.submit.dueRequired";
      rerenderTaskPage({ focusSubmit: true });
      return;
    }
    if (state.liveTaskWrites) {
      state.writeBusy = true;
      state.submitError = "";
      state.writeError = "";
      state.writeErrorValues = {};
      state.writeNotice = "";
      rerenderTaskPage();
      try {
        if (state.submitMode === "edit") {
          const task = state.tasks.find((item) => item.id === state.submitTaskId);
          if (!task || !canEditTask(task)) throw new Error("Task edit permission required");
          const originalTitle = task.title;
          const trackTitleEdit = !isTaskCreator(task, state.currentUser);
          const result = await updateLiveTask(task.id, {
            title,
            content,
            priority: task.dbPriority === "none" && task.priority === "low" && priority === "low" ? "none" : priority,
            startDate,
            due,
            requiresReview,
            assigneeIds: assignedRows.map((member) => member.id),
            departmentId,
            originalTitle,
            trackTitleEdit,
            attachments: state.submitDraft.attachments
          });
          if (!isCurrentTaskMount(mountId, scope)) return;
          try {
            task.title = title;
            if (trackTitleEdit && title !== originalTitle) {
              task.titleEditedBy = state.currentUser.name;
              task.titleEditedAt = localTimestamp();
            }
            task.content = content;
            task.priority = priority;
            task.dbPriority = task.dbPriority === "none" && priority === "low" ? "none" : priority === "medium" ? "mid" : priority;
            task.startDate = startDate;
            task.due = due;
            task.requiresReview = requiresReview;
            task.departmentId = departmentId;
            task.visibility = departmentId ? "department" : "team";
            task.visibilityDepartment = taskSubmitDepartment(departmentId)?.name || "";
            task.assignees = assignedRows.map((member) => ({
              employeeId: member.id,
              name: member.name,
              completedAt: task.assignees.find((assignee) => assignee.employeeId === member.id)?.completedAt ?? null,
              abandonedAt: task.assignees.find((assignee) => assignee.employeeId === member.id)?.abandonedAt ?? null
            }));
            task.members = task.assignees.map((assignee) => assignee.name);
            task.owner = task.members.join("、") || "—";
            task.attachments = result.attachments ?? task.attachments;
            task.attachmentCount = task.attachments.length;
          } catch (echoError) {
            console.error("Task update persisted but local echo failed", echoError);
          }
          state.writeNotice = "tasks.write.saved";
        } else {
          const result = await createLiveTask({
            title,
            content,
            priority,
            startDate,
            due,
            requiresReview,
            assigneeIds: assignedRows.map((member) => member.id),
            departmentId,
            files: state.submitDraft.attachments.map((attachment) => attachment.file).filter(Boolean)
          });
          if (!isCurrentTaskMount(mountId, scope)) return;
          let newTask = null;
          try {
            const column = state.board.find((item) => item.key === priority) ?? state.board[0];
            const attachments = Array.isArray(result.attachments) ? result.attachments : [];
            newTask = {
              id: result.task.id,
              title,
              content,
              due,
              owner: assignedRows.map((member) => member.name).join("、"),
              priority: column.key,
              dbPriority: column.key === "medium" ? "mid" : column.key,
              status: "inProgress",
              done: false,
              countBadge: "",
              departmentId,
              visibility: departmentId ? "department" : "team",
              requiresReview,
              members: assignedRows.map((member) => member.name),
              feedback: [],
              startDate,
              createdAt: localTimestamp(),
              completedAt: "",
              creator: state.currentUser.name,
              creatorId: state.currentUser.id,
              parentId: null,
              visibilityDepartment: taskSubmitDepartment(departmentId)?.name || "",
              approvedAt: "",
              approvedBy: "",
              attachments: attachments.map((attachment) => ({ ...attachment })),
              attachmentCount: attachments.length,
              assignees: assignedRows.map((member) => ({ employeeId: member.id, name: member.name, completedAt: null, abandonedAt: null })),
              subtasks: []
            };
            column.tasks.unshift(newTask);
            state.tasks.unshift(newTask);
            state.summary.total += 1;
            state.summary.inProgress += 1;
            adjustOpenTaskCounts(newTask, 1);
          } catch (echoError) {
            // A committed create must never look failed: otherwise a retry creates a duplicate task.
            console.error("Task create persisted but local echo failed", echoError);
          }
          const subtaskOutcome = await createTaskSubmitSubtasks({
            parentTaskId: result.task.id,
            subtasks: submitSubtasks,
            createSubtask: createLiveSubtask
          });
          if (!isCurrentTaskMount(mountId, scope)) return;
          if (newTask) {
            subtaskOutcome.created.forEach((createdEntry, index) => {
              try {
                appendTaskSubmitSubtaskEcho(newTask, createdEntry, index);
              } catch (echoError) {
                console.error("Subtask create persisted but local echo failed", echoError);
              }
            });
          }
          if (subtaskOutcome.failure) {
            console.warn(`Subtask create failed: ${subtaskOutcome.failure.subtask.title}`, subtaskOutcome.failure.error);
            state.writeError = "tasks.write.subtaskCreatePartial";
            state.writeErrorValues = { title: subtaskOutcome.failure.subtask.title };
          }
          state.writeNotice = "tasks.write.created";
        }
        state.submitOpen = false;
        state.submitTaskId = null;
        state.submitOriginalDepartmentId = "";
        state.submitError = "";
      } catch (error) {
        if (!isCurrentTaskMount(mountId, scope)) return;
        console.warn("Task save failed", error);
        state.submitError = "tasks.write.failed";
      } finally {
        if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
      }
      if (!isCurrentTaskMount(mountId, scope)) return;
      rerenderTaskPage({ focusBoard: !state.submitOpen, focusSubmit: state.submitOpen });
      return;
    }
    const column = state.board.find((item) => item.key === priority) ?? state.board[0];
    const newTask = {
      id: `local-task-${Date.now()}`,
      title,
      content,
      due,
      owner,
      priority: column.key,
      status: "inProgress",
      done: false,
      countBadge: "",
      departmentId,
      visibility: departmentId ? "department" : "team",
      requiresReview,
      members: assignedMembers,
      feedback: [],
      startDate,
      createdAt: localTimestamp(),
      completedAt: "",
      creator: state.currentUser.name,
      creatorId: state.currentUser.id,
      parentId: null,
      visibilityDepartment: taskSubmitDepartment(departmentId)?.name || "",
      approvedAt: "",
      approvedBy: "",
      attachments: [],
      attachmentCount: state.submitDraft.attachments?.length ?? 0,
      assignees: assignedMembers.map((name) => ({
        employeeId: state.members.find((member) => member.name === name)?.id || "",
        name,
        completedAt: null,
        abandonedAt: null
      })),
      subtasks: []
    };
    column.tasks.unshift(newTask);
    state.tasks.unshift(newTask);
    state.summary.total += 1;
    state.summary.inProgress += 1;
    adjustOpenTaskCounts(newTask, 1);
    const mockSubtaskOutcome = await createTaskSubmitSubtasks({
      parentTaskId: newTask.id,
      subtasks: submitSubtasks,
      createSubtask: async ({ title }) => ({ task: { title } })
    });
    mockSubtaskOutcome.created.forEach((createdEntry, index) => appendTaskSubmitSubtaskEcho(newTask, createdEntry, index));
    closeTaskSubmit();
    return;
  }
  const form = event.target.closest("[data-task-feedback-form]");
  if (!form) return;
  event.preventDefault();
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const message = String(state.feedbackDraft.message || "").trim();
  const attachments = state.feedbackDraft.attachments ?? [];
  const mentionedUserIds = [...new Set((state.feedbackDraft.mentions ?? []).map((mention) => mention.userId).filter(Boolean))];
  const task = selectedTask();
  if ((!message && !attachments.length) || !task) return;
  state.feedbackError = "";
  if (state.liveTaskWrites) {
    state.writeBusy = true;
    rerenderTaskPage({ focusFeedback: true });
    try {
      const result = await createLiveTaskFeedback({
        taskId: task.id,
        message,
        attachments,
        parentFeedbackId: null,
        mentionedUserIds
      });
      if (!isCurrentTaskMount(mountId, scope)) return;
      task.feedback.push({
        id: String(result.feedback.id),
        author: result.feedback.author_name || currentUser.name,
        authorUserId: result.feedback.author_user_id || currentUser.userId || null,
        timestamp: localTimestamp(),
        message: result.feedback.body || "",
        parentId: result.feedback.parent_feedback_id || null,
        mentionedUserIds: result.feedback.mentioned_user_ids ?? mentionedUserIds,
        attachments: result.attachments.map((attachment) => ({ ...attachment })),
        attachmentCount: result.attachments.length,
        own: true
      });
      task.countBadge = String(task.feedback.length);
      resetFeedbackDraft();
    } catch (error) {
      if (!isCurrentTaskMount(mountId, scope)) return;
      console.warn("Task feedback save failed", error);
      state.feedbackError = "tasks.write.failed";
    } finally {
      if (isCurrentTaskMount(mountId, scope)) state.writeBusy = false;
    }
  } else {
    task.feedback.push({
      id: `feedback-local-${Date.now()}`,
      author: currentUser.name,
      authorUserId: currentUser.userId || null,
      timestamp: localTimestamp(),
      message,
      parentId: null,
      mentionedUserIds,
      attachments: [],
      attachmentCount: attachments.length,
      own: true
    });
    task.countBadge = String(task.feedback.length);
    resetFeedbackDraft();
  }
  if (isCurrentTaskMount(mountId, scope)) rerenderTaskPage({ focusFeedback: true });
}

function syncTaskSubmitDraft(form) {
  const values = new FormData(form);
  for (const key of ["title", "content", "priority", "visibility", "departmentId", "owner", "requiresReview", "startDate", "due"]) {
    const value = values.get(key);
    if (value != null) state.submitDraft[key] = String(value);
  }
}

function onTaskPaste(event) {
  const input = event.target.closest("[data-task-feedback-message]");
  if (!input || input.disabled || state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const pasted = pastedTaskFeedbackImages(event.clipboardData);
  if (!pasted.length) return;
  event.preventDefault();
  state.feedbackDraft.attachments = [...(state.feedbackDraft.attachments ?? []), ...pasted];
  rerenderTaskPage({ focusFeedback: true, feedbackCursor: input.selectionStart });
}

function syncTaskSubmitSegment(control) {
  const segment = control.closest(".form-task-submit__segment");
  if (!segment) return;
  segment.querySelectorAll("label").forEach((label) => {
    const input = label.querySelector('input[type="radio"]');
    label.classList.toggle("form-task-submit__segment--active", input?.checked === true);
  });
}

function onTaskInput(event) {
  const feedbackEditInput = event.target.closest('[data-task-feedback-edit-form] textarea[name="feedbackEdit"]');
  if (feedbackEditInput) {
    state.feedbackEditDraft = feedbackEditInput.value;
    return;
  }
  const feedbackInput = event.target.closest('[data-task-feedback-form] textarea[name="message"]');
  if (feedbackInput) {
    state.feedbackDraft = updateTaskFeedbackMentionInput(
      state.feedbackDraft,
      feedbackInput.value,
      feedbackInput.selectionStart
    );
    syncFeedbackMentionMenuInPlace(feedbackInput);
    return;
  }
  const memberQuery = event.target.closest("[data-task-member-query]");
  if (memberQuery) {
    state.submitDraft.memberQuery = memberQuery.value;
    state.submitDraft.memberMenuOpen = true;
    filterTaskMemberCandidatesInPlace(memberQuery);
    return;
  }
  const submitSubtaskTitle = event.target.closest("[data-task-submit-subtask-title]");
  if (submitSubtaskTitle) {
    const subtaskId = submitSubtaskTitle.getAttribute("data-task-submit-subtask-title");
    const subtask = (state.submitDraft.subtasks ?? []).find((item) => item.id === subtaskId);
    if (subtask) subtask.title = submitSubtaskTitle.value;
    return;
  }
  const form = event.target.closest("[data-task-submit-form]");
  if (form) syncTaskSubmitDraft(form);
}

function onTaskChange(event) {
  const feedbackAttachmentInput = event.target.closest("[data-task-feedback-file]");
  if (feedbackAttachmentInput) {
    if (state.liveReadOnly && !state.liveTaskWrites) return;
    const currentFiles = new Set((state.feedbackDraft.attachments ?? []).map((attachment) => `${attachment.name}:${attachment.size}:${attachment.lastModified ?? ""}`));
    const nextFiles = [...feedbackAttachmentInput.files]
      .filter((file) => !currentFiles.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => taskFeedbackAttachmentDraft(file))
      .filter(Boolean);
    state.feedbackDraft.attachments = [...(state.feedbackDraft.attachments ?? []), ...nextFiles];
    rerenderTaskPage({ focusFeedback: true });
    return;
  }
  const attachmentInput = event.target.closest("[data-task-submit-file]");
  if (attachmentInput) {
    if (state.liveReadOnly && !state.liveTaskWrites) return;
    const currentNames = new Set((state.submitDraft.attachments ?? []).map((file) => `${file.name}:${file.size}:${file.lastModified ?? ""}`));
    const nextFiles = [...attachmentInput.files]
      .filter((file) => !currentNames.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => ({ file, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }));
    state.submitDraft.attachments = [...(state.submitDraft.attachments ?? []), ...nextFiles];
    rerenderTaskPage();
    document.querySelector("[data-task-submit-attachment]")?.focus();
    return;
  }
  const submitSubtaskAssignee = event.target.closest("[data-task-submit-subtask-assignee]");
  if (submitSubtaskAssignee) {
    const subtaskId = submitSubtaskAssignee.getAttribute("data-task-submit-subtask-assignee");
    const subtask = (state.submitDraft.subtasks ?? []).find((item) => item.id === subtaskId);
    if (subtask) subtask.assigneeId = submitSubtaskAssignee.value;
    return;
  }
  const form = event.target.closest("[data-task-submit-form]");
  if (!form) return;
  const name = event.target.name;
  const value = event.target.value;
  const previousDepartmentId = state.submitDraft.departmentId || "";
  syncTaskSubmitDraft(form);
  if (!state.submitOpen || !form.isConnected) return;
  if (name === "departmentId" && value !== previousDepartmentId) {
    state.submitDraft.visibility = value ? "department" : "team";
    reconcileTaskSubmitAssignees(value);
    rerenderTaskPage();
    document.querySelector('[data-task-submit-form] [name="departmentId"]')?.focus();
    return;
  }
  if (name === "owner") {
    const ownerId = taskMembersForDepartment(taskSubmitData(), state.submitDraft.departmentId || "")
      .find((member) => member.name === value)?.id || "";
    state.submitDraft.memberIds = (state.submitDraft.memberIds ?? []).filter((id) => id !== ownerId);
    state.submitDraft.memberQuery = "";
    state.submitDraft.memberMenuOpen = false;
    rerenderTaskPage();
    document.querySelector('[data-task-submit-form] [name="owner"]')?.focus();
    return;
  }
  // Text controls dispatch change while losing focus. Replacing the form here would remove
  // the submit button between pointerdown and click, so keep non-dependent updates in place.
  if (event.target.matches('input[type="radio"]')) syncTaskSubmitSegment(event.target);
}

function onTaskFocus(event) {
  const feedbackInput = event.target.closest('[data-task-feedback-form] textarea[name="message"]');
  if (feedbackInput && !feedbackInput.disabled) {
    state.feedbackDraft = updateTaskFeedbackMentionInput(
      state.feedbackDraft,
      feedbackInput.value,
      feedbackInput.selectionStart
    );
    syncFeedbackMentionMenuInPlace(feedbackInput);
    return;
  }
  const memberQuery = event.target.closest("[data-task-member-query]");
  if (!memberQuery || memberQuery.disabled) return;
  state.submitDraft.memberMenuOpen = true;
  filterTaskMemberCandidatesInPlace(memberQuery);
}

function hasTaskSubmitUnsavedChanges() {
  if (!state.submitOpen) return false;
  const draft = state.submitDraft;
  if (state.submitMode !== "edit") {
    return Boolean(String(draft.title || "").trim() || String(draft.content || "").trim() ||
      draft.attachments?.length || draft.subtasks?.length);
  }
  const task = state.tasks.find((item) => item.id === state.submitTaskId);
  if (!task) return true;
  const taskMemberIds = (task.assignees ?? []).map((assignee) => assignee.employeeId).filter(Boolean).sort();
  const draftMemberIds = [
    state.members.find((member) => member.name === draft.owner)?.id,
    ...(draft.memberIds ?? [])
  ].filter(Boolean).sort();
  return String(draft.title || "") !== String(task.title || "")
    || String(draft.content || "") !== String(task.content || "")
    || String(draft.priority || "") !== String(task.priority || "")
    || String(draft.startDate || "") !== String(task.startDate || "").replaceAll("/", "-")
    || String(draft.due || "") !== String(task.due || "")
    || String(draft.departmentId || "") !== String(task.departmentId || "")
    || String(draft.requiresReview || "no") !== (task.requiresReview ? "yes" : "no")
    || JSON.stringify(draftMemberIds) !== JSON.stringify(taskMemberIds)
    || Boolean(draft.attachments?.some((attachment) => attachment.file));
}

function hasTaskUnsavedChanges() {
  return hasTaskSubmitUnsavedChanges()
    || Boolean(state.feedbackDraft.message.trim() || state.feedbackDraft.attachments.length || state.feedbackDraft.mentions?.length)
    || Boolean(state.feedbackEditingId && state.feedbackEditDraft !== state.feedbackEditOriginal)
    || Boolean(String(state.subtaskAddDraft.title || "").trim() || state.subtaskAddDraft.assigneeId)
    || Boolean(state.subtaskEditingId && state.subtaskEditDraft !== state.subtaskEditOriginal);
}

function hasTaskRealtimeRefreshBlock() {
  if (state.writeBusy || state.submitOpen || state.feedbackEditingId || hasTaskUnsavedChanges()) return true;
  const active = document.activeElement;
  return Boolean(active?.closest?.("[data-task-feedback-form], [data-task-feedback-edit-form], [data-task-subtask-form], [data-task-subtask-edit-form], [data-task-submit-form]"));
}

function currentTaskViewState() {
  return {
    mode: state.mode,
    overviewExpanded: [...state.overviewExpanded],
    overviewCompletedExpanded: [...state.overviewCompletedExpanded],
    boardExpandedPriorities: [...state.boardExpandedPriorities],
    feedbackPanelExpandedTaskIds: [...state.feedbackPanelExpandedTaskIds],
    onlyMine: state.onlyMine,
    calendarYear: state.calendarYear,
    calendarMonth: state.calendarMonth,
    status: filterState.status,
    priority: filterState.priority,
    view: filterState.view,
    member: filterState.member
  };
}

function applyRealtimeTaskData(nextData) {
  const currentState = state;
  const currentFilters = filterState;
  const selectedTaskId = currentState.selectedTaskId;
  const actionTaskId = currentState.actionTaskId;
  const next = createTaskState(nextData, currentTaskViewState());
  const nextTaskIds = new Set(next.state.tasks.map((task) => task.id));
  const keepDetail = currentState.detailOpen && nextTaskIds.has(selectedTaskId);
  if (!keepDetail) revokeTaskFeedbackAttachmentDrafts(currentState.feedbackDraft?.attachments);
  Object.assign(next.state, {
    calendarExpandedDate: currentState.calendarExpandedDate,
    aiOpen: currentState.aiOpen,
    detailOpen: keepDetail,
    selectedTaskId: keepDetail ? selectedTaskId : null,
    detailTab: keepDetail ? currentState.detailTab : "content",
    feedbackDraft: keepDetail ? currentState.feedbackDraft : createTaskFeedbackDraft(),
    feedbackError: keepDetail ? currentState.feedbackError : "",
    feedbackMenuId: keepDetail ? currentState.feedbackMenuId : null,
    feedbackEditingId: keepDetail ? currentState.feedbackEditingId : null,
    feedbackEditDraft: keepDetail ? currentState.feedbackEditDraft : "",
    feedbackEditOriginal: keepDetail ? currentState.feedbackEditOriginal : "",
    feedbackEditError: keepDetail ? currentState.feedbackEditError : "",
    subtaskAddDraft: keepDetail ? currentState.subtaskAddDraft : { title: "", assigneeId: "" },
    subtaskEditingId: keepDetail ? currentState.subtaskEditingId : null,
    subtaskEditDraft: keepDetail ? currentState.subtaskEditDraft : "",
    subtaskEditOriginal: keepDetail ? currentState.subtaskEditOriginal : "",
    attachmentPreview: keepDetail ? currentState.attachmentPreview : null,
    writeError: currentState.writeError,
    writeErrorValues: currentState.writeErrorValues,
    writeNotice: currentState.writeNotice,
    actionTaskId: nextTaskIds.has(actionTaskId) ? actionTaskId : null,
    boardUnreadTaskIds: currentState.boardUnreadTaskIds
  });
  data = nextData;
  Object.assign(currentState, next.state);
  Object.assign(currentFilters, next.filterState);
  state = currentState;
  filterState = currentFilters;
  rerenderTaskPage({ focusDetail: keepDetail });
  taskBoardReadTracker?.refresh(state.tasks);
}

async function refreshLiveTaskSnapshot({ defer, isCurrent }) {
  const nextData = await getTeamTaskData();
  if (!isCurrent()) return;
  if (hasTaskRealtimeRefreshBlock()) {
    defer();
    return;
  }
  applyRealtimeTaskData(nextData);
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  const mountId = ++activeMountId;
  activeScope = scope;
  const [nextData, nextCurrentUser, nextUnreadWatermarks, nextUnread] = await Promise.all([
    getTeamTaskData(), getCurrentUser(), getUnreadWatermarks(), getUnread()
  ]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  currentUser = nextCurrentUser;
  unreadWatermarks = nextUnreadWatermarks;
  unread = nextUnread;
  authenticated = typeof currentUser?.hasPermission === "function";
  permissions = {
    canCreate: !authenticated || currentUser.hasPermission("can_create_task"),
    canAssignOthers: !authenticated || currentUser.hasPermission("can_assign_others"),
    canEditOthers: !authenticated || currentUser.hasPermission("can_edit_others_tasks"),
    canDeleteOthers: !authenticated || currentUser.hasPermission("can_delete_others_tasks"),
    canValidate: !authenticated || currentUser.hasPermission("can_validate_task"),
    canManageEmployees: !authenticated || currentUser.isSuperAdmin === true || currentUser.isAdminOfAny === true || currentUser.hasPermission("can_manage_employees")
  };
  initializeTaskState(historyState);
  const openCreatePreset = consumeNavigationPreset(navigationPresetKeys.taskCreate) === "1";
  taskMobileViewport = matchMedia("(max-width: 768px)");

  return {
    page: {
      menu: [
        { key: "nav.tasks", icon: "icon-nav-task", href: "./index.html", active: true, unreadKey: "tasks" },
        { key: "nav.team", icon: "icon-nav-user", href: "./members.html" }
      ],
      data: { unread, user: currentUser },
      render: renderTaskManagement,
      title: "Honnmono · Tasks"
    },
    activate() {
      markRead("tasks", unreadWatermarks.tasks);
      scope.listen(document, "mousedown", onTaskMousedown);
      scope.listen(document, "click", onTaskClick);
      scope.listen(document, "keydown", onTaskKeydown);
      scope.listen(document, "paste", onTaskPaste);
      scope.listen(document, "submit", onTaskSubmit);
      scope.listen(document, "input", onTaskInput);
      scope.listen(document, "change", onTaskChange);
      scope.listen(document, "focusin", onTaskFocus);
      if (typeof taskMobileViewport.addEventListener === "function") scope.listen(taskMobileViewport, "change", onTaskViewportChange);
      else {
        const viewport = taskMobileViewport;
        const guardedViewportChange = (event) => {
          if (scope.isCurrent()) onTaskViewportChange(event);
        };
        viewport.addListener(guardedViewportChange);
        scope.onCleanup(() => viewport.removeListener(guardedViewportChange));
      }
      taskLiveRefresh = attachTaskDomainController({
        state,
        filterState,
        getHelpers: () => currentHelpers,
        rerender: rerenderTaskPage,
        closeTaskDetail,
        leaveTaskDetailForNavigation,
        adjustOpenTaskCounts,
        localTimestamp,
        toggleTaskParticipation,
        toggleSubtaskCompletion,
        createSubtask: createSubtaskWrite,
        updateSubtaskTitle: updateSubtaskTitleWrite,
        deleteSubtask: deleteSubtaskWrite,
        refreshTaskBoardReadState: () => taskBoardReadTracker?.refresh(state.tasks),
        approveTask: approveWaitingTask,
        refreshLiveData: refreshLiveTaskSnapshot,
        isLiveRefreshBlocked: hasTaskRealtimeRefreshBlock,
        scope
      });
      const readScopeKey = `${currentUser.activeCompanyId || "demo"}:${state.currentUser.id || "anonymous"}`;
      const readTracker = createTaskBoardReadTracker({
        scopeKey: readScopeKey,
        onUnreadChange(nextUnreadIds) {
          if (!scope.isCurrent() || !state) return;
          const previous = state.boardUnreadTaskIds;
          const unchanged = previous.size === nextUnreadIds.size && [...previous].every((id) => nextUnreadIds.has(id));
          if (unchanged) return;
          state.boardUnreadTaskIds = nextUnreadIds;
          if (!state.detailOpen && state.mode === "board" && filterState.view === "board") rerenderTaskPage();
        }
      });
      taskBoardReadTracker = readTracker;
      const columnReadObserver = createTaskBoardColumnReadObserver({ tracker: readTracker });
      taskBoardColumnReadObserver = columnReadObserver;
      scope.onCleanup(() => readTracker.dispose());
      scope.onCleanup(() => columnReadObserver.dispose());
      scope.listen(document, "visibilitychange", observeTaskBoardUnreadColumns);
      taskBoardReadTracker.refresh(state.tasks);
      if (openCreatePreset) scope.animationFrame(() => openTaskSubmit());
    },
    hasUnsavedChanges: hasTaskUnsavedChanges,
    async canLeave() {
      if (!hasTaskUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "tasks.submit.leaveConfirm"));
    },
    captureState() {
      return {
        mode: state.mode,
        overviewExpanded: [...state.overviewExpanded],
        overviewCompletedExpanded: [...state.overviewCompletedExpanded],
        boardExpandedPriorities: [...state.boardExpandedPriorities],
        feedbackPanelExpandedTaskIds: [...state.feedbackPanelExpandedTaskIds],
        onlyMine: state.onlyMine,
        calendarYear: state.calendarYear,
        calendarMonth: state.calendarMonth,
        status: filterState.status,
        priority: filterState.priority,
        view: filterState.view,
        member: filterState.member
      };
    },
    dispose() {
      if (activeMountId === mountId) activeMountId += 1;
      closeAllFilterMenus(null);
      taskDueDatePanel.close({ restoreFocus: false });
      taskStartDatePanel.close({ restoreFocus: false });
      clearFeedbackDraftAttachments();
      data = null;
      currentUser = null;
      unread = null;
      unreadWatermarks = null;
      currentHelpers = null;
      taskMobileViewport = null;
      if (activeScope === scope) activeScope = null;
      taskLiveRefresh = null;
      taskBoardReadTracker = null;
      clearTaskBoardColumnObservers();
      taskBoardColumnReadObserver = null;
      state = null;
      filterState = null;
    }
  };
}
