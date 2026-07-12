import { getTeamTaskData, getCurrentUser, getUnread, getUnreadWatermarks } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { taskT as pageT } from "./tasks-i18n.js";
import { renderTaskDetail } from "./tasks-detail.js";
import { renderTaskSubmitDialog } from "./tasks-submit.js";
import { isTaskFilterGroup } from "./tasks-filters.js";
import { renderTaskCalendar } from "./tasks-calendar.js";
import { renderTaskOverview } from "./tasks-overview.js";
import { renderTaskAiDialog } from "./tasks-ai.js";
import { calendarRelatedTasks, isTaskCreator, memberIdentity, openAssignedTaskCount, taskAssignee } from "./tasks-model.js";
import { attachTaskDomainController } from "./tasks-domain-controller.js";
import { renderTaskBoardGrid, renderTaskToolbar } from "./tasks-board.js";
import { getSessionValue, setSessionValue } from "../data/session-state.js";

const data = await getTeamTaskData();
const currentUser = await getCurrentUser();
const authenticated = typeof currentUser?.hasPermission === "function";
const permissions = {
  canCreate: !authenticated || currentUser.hasPermission("can_create_task"),
  canAssignOthers: !authenticated || currentUser.hasPermission("can_assign_others"),
  canEditOthers: !authenticated || currentUser.hasPermission("can_edit_others_tasks"),
  canDeleteOthers: !authenticated || currentUser.hasPermission("can_delete_others_tasks"),
  canValidate: !authenticated || currentUser.hasPermission("can_validate_task")
};
const unreadWatermarks = await getUnreadWatermarks();
markRead("tasks", unreadWatermarks.tasks);
const clonedTasks = data.tasks.map((task) => ({
  ...task,
  assignees: (task.assignees ?? []).map((assignee) => ({ ...assignee })),
  feedback: task.feedback.map((entry) => ({ ...entry })),
  subtasks: []
}));
const clonedTaskById = new Map(clonedTasks.map((task) => [task.id, task]));
clonedTasks.forEach((task) => {
  if (task.parentId && clonedTaskById.has(task.parentId)) clonedTaskById.get(task.parentId).subtasks.push(task);
});
const currentMember = data.members.find((member) => member.name.toLocaleLowerCase() === currentUser.name.toLocaleLowerCase());
const now = new Date();
const storedViewMode = getSessionValue("team-tasks-view-mode");
const state = {
  summary: { ...data.summary },
  members: data.members.map((member) => ({ ...member })),
  tasks: clonedTasks,
  board: data.board.map((column) => ({
    ...column,
    tasks: column.tasks.map((task) => clonedTaskById.get(task.id)).filter(Boolean)
  })),
  currentUser: { ...currentUser, id: currentMember?.id || "" },
  permissions,
  liveReadOnly: authenticated,
  mode: "overview",
  overviewExpanded: new Set(),
  onlyMine: getSessionValue("team-tasks-only-mine") === "1",
  calendarYear: now.getFullYear(),
  calendarMonth: now.getMonth(),
  calendarExpandedDate: null,
  aiOpen: false,
  detailOpen: false,
  selectedTaskId: null,
  detailTab: "content",
  submitOpen: false,
  submitDraft: { ...data.form.defaults, attachments: [] },
  actionTaskId: null
};

const filterState = {
  status: data.filters?.status ?? "inProgress", // inProgress / completed / overdue
  priority: data.filters?.priority ?? "all", // all / high / medium / low
  view: ["board", "calendar"].includes(storedViewMode)
    ? storedViewMode
    : data.filters?.view ?? "board",
  member: "all"
};

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
    ? tasks.filter((task) => task.parentId === null && task.done !== true && task.status !== "completed" && task.status !== "abandoned").length
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
  const tt = (key) => pageT(lang, key);
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
        ? renderTaskOverview({ members: state.members, tasks: scopedTasks, expanded: state.overviewExpanded, helpers })
        : `<div class="team-kanban-grid">${renderTaskBoardGrid({ state, filterState, helpers })}</div>`;
  return `<div class="team-task-page${state.detailOpen ? " team-task-page--detail" : ""}" data-task-view="${escapeHtml(filterState.view)}" data-task-mode="${escapeHtml(state.mode)}" data-only-mine="${state.onlyMine}">
    <h1 class="team-task-title" title="${escapeHtml(tt("tasks.title"))}">${escapeHtml(tt("tasks.title"))}</h1>
    <section class="team-task-stats">${stats.map((stat) => renderStatCard(stat, helpers)).join("")}</section>
    ${state.detailOpen ? "" : renderTaskToolbar({ state, filterState, members: state.members, featureAiBatch: data.featureAiBatch, helpers })}
    <section class="team-board${calendarView ? " team-board--calendar" : ""}">
      ${calendarView ? "" : `<aside class="team-member-rail">
        <div class="team-member-list">${renderOverviewEntry(helpers)}${state.members.map((member) => renderMember(member, scopedTasks, helpers)).join("")}</div>
        <button type="button" class="team-member-add" tabindex="-1" aria-label="add"${state.liveReadOnly ? " disabled aria-disabled=\"true\"" : ""}>${icon("icon-add-surface-add")}</button>
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

function rerenderTaskPage({ focusDetail = false, restoreDetailFocus = false, focusFeedback = false, focusSubmit = false, restoreSubmitFocus = false, focusFilterGroup = "", focusActionMenu = false, restoreActionTaskId = "", focusBoard = false } = {}) {
  const page = document.querySelector(".team-task-page");
  if (!page || !currentHelpers) return;
  page.outerHTML = renderTaskManagement(currentHelpers);
  if (focusDetail) [...document.querySelectorAll("[data-task-detail-close]")].find((element) => element.offsetParent !== null)?.focus();
  if (restoreDetailFocus && state.selectedTaskId) {
    document.querySelector(`[data-task-detail-open="${CSS.escape(state.selectedTaskId)}"]`)?.focus();
  }
  if (focusFeedback) document.querySelector('[data-task-feedback-form] textarea[name="message"]')?.focus();
  if (focusSubmit) document.querySelector('[data-task-submit-form] input[name="title"]')?.focus();
  if (restoreSubmitFocus) document.querySelector("[data-task-submit-open]")?.focus();
  if (focusFilterGroup) document.querySelector(`[data-filter-trigger][data-filter-group="${CSS.escape(focusFilterGroup)}"]`)?.focus();
  if (focusActionMenu) document.querySelector("[data-task-action-popover]")?.focus();
  if (restoreActionTaskId) document.querySelector(`[data-task-action-open="${CSS.escape(restoreActionTaskId)}"]`)?.focus();
  if (focusBoard) document.querySelector("[data-task-submit-open]")?.focus();
}

const taskMobileViewport = matchMedia("(max-width: 768px)");
const onTaskViewportChange = () => rerenderTaskPage({ focusActionMenu: Boolean(state.actionTaskId) });
if (typeof taskMobileViewport.addEventListener === "function") taskMobileViewport.addEventListener("change", onTaskViewportChange);
else taskMobileViewport.addListener(onTaskViewportChange);

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId);
}

function closeTaskDetail() {
  state.detailOpen = false;
  state.detailTab = "content";
  rerenderTaskPage({ restoreDetailFocus: true });
}

function openTaskSubmit() {
  if (!state.permissions.canCreate || state.liveReadOnly) return;
  state.actionTaskId = null;
  state.submitOpen = true;
  state.submitDraft = {
    ...data.form.defaults,
    attachments: [],
    content: data.form.defaults.content ?? (data.form.defaults.contentKey ? pageT(currentHelpers.lang, data.form.defaults.contentKey) : "")
  };
  rerenderTaskPage({ focusSubmit: true });
}

function closeTaskSubmit() {
  state.submitOpen = false;
  rerenderTaskPage({ restoreSubmitFocus: true });
}

function closeTaskAction({ restoreFocus = true } = {}) {
  const taskId = state.actionTaskId;
  if (!taskId) return;
  state.actionTaskId = null;
  rerenderTaskPage({ restoreActionTaskId: restoreFocus ? taskId : "" });
}

function taskLocation(taskId) {
  for (const column of state.board) {
    const index = column.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) return { column, index, task: column.tasks[index] };
  }
  return null;
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

function decrementOpenTaskCounts(task) {
  adjustOpenTaskCounts(task, -1);
}

function selectedActionMember() {
  if (filterState.member === "all") return null;
  return state.members.find((member) => memberIdentity(member) === filterState.member) ?? null;
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

function performTaskAction(taskId, action) {
  if (state.liveReadOnly) return;
  const location = taskLocation(taskId);
  if (!location) return;
  const { column, index, task } = location;
  if (action === "complete" && !task.done) {
    const completedAt = localTimestamp();
    const scopedMember = selectedActionMember();
    const scopedAssignee = scopedMember ? taskAssignee(task, scopedMember) : null;
    // Mirrors bizflow_samyung/team/src/views/Tasks.jsx:368-385: member scope completes one assignee row.
    if (scopedAssignee) {
      scopedAssignee.completedAt = completedAt;
      scopedAssignee.abandonedAt = null;
      const allDone = task.assignees.length > 0 && task.assignees.every((assignee) => assignee.completedAt != null);
      if (allDone && !task.requiresReview) completeWholeTask(task, completedAt);
    } else if (!scopedMember || isTaskCreator(task, state.currentUser)) {
      // Mirrors Tasks.jsx:344-366: creator/all-scope action completes pending assignees and the whole task.
      completeWholeTask(task, completedAt);
    }
  }
  if (action === "delete") {
    const removedIds = new Set([task.id, ...(task.subtasks ?? []).map((subtask) => subtask.id)]);
    const removedTasks = state.tasks.filter((item) => removedIds.has(item.id));
    column.tasks.splice(index, 1);
    state.tasks = state.tasks.filter((item) => !removedIds.has(item.id));
    state.summary.total = Math.max(0, state.summary.total - removedIds.size);
    removedTasks.forEach((removedTask) => {
      if (removedTask.status === "completed") state.summary.completed = Math.max(0, state.summary.completed - 1);
      else if (removedTask.status !== "abandoned") {
        state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
        adjustOpenTaskCounts(removedTask, -1);
      }
    });
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

document.addEventListener("click", (event) => {
  const completeAction = event.target.closest("[data-task-action-complete]");
  if (completeAction) {
    if (completeAction.disabled || state.liveReadOnly) return;
    performTaskAction(completeAction.getAttribute("data-task-action-complete"), "complete");
    return;
  }

  const deleteAction = event.target.closest("[data-task-action-delete]");
  if (deleteAction) {
    if (deleteAction.disabled || state.liveReadOnly) return;
    performTaskAction(deleteAction.getAttribute("data-task-action-delete"), "delete");
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

  if (event.target.closest("[data-task-submit-attachment]")) {
    document.querySelector("[data-task-submit-file]")?.click();
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
    state.detailTab = "content";
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
      if (filterState[group] !== value) filterState[group] = value;
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
  if (state.actionTaskId && !event.target.closest("[data-task-action-popover]")) closeTaskAction();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
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
});

document.addEventListener("submit", (event) => {
  const taskForm = event.target.closest("[data-task-submit-form]");
  if (taskForm) {
    event.preventDefault();
    if (state.liveReadOnly || !state.permissions.canCreate) return;
    const values = new FormData(taskForm);
    const priority = String(values.get("priority") || "high");
    const owner = String(values.get("owner") || "");
    const members = String(values.get("members") || "").split(",").map((name) => name.trim()).filter(Boolean);
    const assignedMembers = [...new Set([owner, ...members].filter(Boolean))];
    const column = state.board.find((item) => item.key === priority) ?? state.board[0];
    const newTask = {
      id: `local-task-${Date.now()}`,
      title: String(values.get("title") || "").trim(),
      content: String(values.get("content") || "").trim(),
      due: String(values.get("due") || ""),
      owner,
      priority: column.key,
      status: "inProgress",
      done: false,
      countBadge: "",
      visibility: String(values.get("visibility") || "team"),
      requiresReview: values.get("requiresReview") === "yes",
      members: assignedMembers,
      feedback: [],
      startDate: "",
      createdAt: localTimestamp(),
      completedAt: "",
      creator: state.currentUser.name,
      creatorId: state.currentUser.id,
      parentId: null,
      visibilityDepartment: "",
      approvedAt: "",
      approvedBy: "",
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
    closeTaskSubmit();
    return;
  }
  const form = event.target.closest("[data-task-feedback-form]");
  if (!form) return;
  event.preventDefault();
  if (state.liveReadOnly) return;
  const message = String(new FormData(form).get("message") || "").trim();
  const task = selectedTask();
  if (!message || !task) return;
  task.feedback.push({
    id: `feedback-local-${Date.now()}`,
    author: currentUser.name,
    timestamp: new Intl.DateTimeFormat(currentHelpers.lang === "zh" ? "zh-HK" : currentHelpers.lang, { dateStyle: "short", timeStyle: "short" }).format(new Date()),
    message,
    own: true
  });
  rerenderTaskPage({ focusFeedback: true });
});

function syncTaskSubmitDraft(form) {
  const values = new FormData(form);
  for (const key of ["title", "content", "priority", "visibility", "owner", "requiresReview", "members", "due"]) {
    const value = values.get(key);
    if (value != null) state.submitDraft[key] = String(value);
  }
}

document.addEventListener("input", (event) => {
  const form = event.target.closest("[data-task-submit-form]");
  if (form) syncTaskSubmitDraft(form);
});

document.addEventListener("change", (event) => {
  const attachmentInput = event.target.closest("[data-task-submit-file]");
  if (attachmentInput) {
    if (state.liveReadOnly) return;
    const currentNames = new Set((state.submitDraft.attachments ?? []).map((file) => file.name));
    const nextFiles = [...attachmentInput.files]
      .filter((file) => !currentNames.has(file.name))
      .map((file) => ({ name: file.name, size: file.size, type: file.type }));
    state.submitDraft.attachments = [...(state.submitDraft.attachments ?? []), ...nextFiles];
    rerenderTaskPage();
    document.querySelector("[data-task-submit-attachment]")?.focus();
    return;
  }
  const form = event.target.closest("[data-task-submit-form]");
  if (!form) return;
  const name = event.target.name;
  const value = event.target.value;
  syncTaskSubmitDraft(form);
  rerenderTaskPage();
  document.querySelector(`[data-task-submit-form] [name="${CSS.escape(name)}"][value="${CSS.escape(value)}"], [data-task-submit-form] [name="${CSS.escape(name)}"]`)?.focus();
});

attachTaskDomainController({
  state,
  filterState,
  getHelpers: () => currentHelpers,
  rerender: rerenderTaskPage,
  closeTaskDetail,
  adjustOpenTaskCounts,
  localTimestamp
});

window.__shellMenu = [
  { key: "nav.tasks", icon: "icon-nav-task", href: "./index.html", active: true, unreadKey: "tasks" },
  { key: "nav.team", icon: "icon-nav-user", href: "./members.html" }
];
window.__shellData = { unread: await getUnread(), user: currentUser };
window.__shellContent = renderTaskManagement;
await import("../shell/shell.js");
