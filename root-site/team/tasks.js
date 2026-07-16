import { getTeamTaskData, getCurrentUser, getUnread, getUnreadWatermarks } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { taskT as pageT } from "./tasks-i18n.js";
import { renderTaskDetail } from "./tasks-detail.js";
import { availableTaskDepartments, renderTaskSubmitDialog, taskMembersForDepartment } from "./tasks-submit.js";
import { isTaskFilterGroup } from "./tasks-filters.js";
import { renderTaskCalendar } from "./tasks-calendar.js";
import { renderTaskOverview } from "./tasks-overview.js";
import { renderTaskAiDialog } from "./tasks-ai.js";
import { calendarRelatedTasks, isTaskCreator, memberIdentity, openAssignedTaskCount, taskAssignee } from "./tasks-model.js";
import { attachTaskDomainController } from "./tasks-domain-controller.js";
import { renderTaskBoardGrid, renderTaskToolbar } from "./tasks-board.js";
import { getSessionValue, setSessionValue } from "../data/session-state.js";
import { completeLiveTask, createLiveTask, createLiveTaskFeedback, setLiveTaskParticipation, updateLiveTask } from "../data/live-task-writes.js";

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
  attachments: (task.attachments ?? []).map((attachment) => ({ ...attachment })),
  assignees: (task.assignees ?? []).map((assignee) => ({ ...assignee })),
  feedback: task.feedback.map((entry) => ({
    ...entry,
    attachments: (entry.attachments ?? []).map((attachment) => ({ ...attachment })),
    mentionedUserIds: (entry.mentionedUserIds ?? []).slice()
  })),
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
  currentUser: { ...currentUser, id: currentUser.employeeId || currentMember?.id || "" },
  permissions,
  liveReadOnly: authenticated,
  liveTaskWrites: authenticated,
  mode: "overview",
  overviewExpanded: new Set(),
  overviewCompletedExpanded: new Set(),
  onlyMine: getSessionValue("team-tasks-only-mine") === "1",
  calendarYear: now.getFullYear(),
  calendarMonth: now.getMonth(),
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
  submitDraft: { ...data.form.defaults, attachments: [] },
  submitError: "",
  feedbackDraft: { message: "", attachments: [] },
  feedbackError: "",
  writeBusy: false,
  writeError: "",
  writeNotice: "",
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
    ${state.writeError ? `<p class="team-task-write-error" role="alert">${escapeHtml(tt(state.writeError))}</p>` : ""}
    ${state.writeNotice ? `<p class="team-task-write-notice" role="status" aria-live="polite">${escapeHtml(tt(state.writeNotice))}</p>` : ""}
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
  if (!state.submitCanAssignOthers && state.submitMode === "edit") {
    const task = state.tasks.find((item) => item.id === state.submitTaskId);
    const retained = (task?.assignees ?? []).filter((assignee) => eligibleMembers.some((member) => member.id === assignee.employeeId));
    state.submitDraft.owner = retained[0]?.name || "";
    state.submitDraft.members = retained.slice(1).map((assignee) => assignee.name).join(", ");
    return;
  }
  const currentNames = [
    state.submitDraft.owner,
    ...String(state.submitDraft.members || "").split(",").map((name) => name.trim()).filter(Boolean)
  ];
  const retained = [...new Set(currentNames.filter((name) => eligibleNames.has(name)))];
  const preferredOwner = eligibleMembers.find((member) => member.id === state.currentUser.id) ?? eligibleMembers[0];
  const owner = eligibleNames.has(state.submitDraft.owner) ? state.submitDraft.owner : preferredOwner?.name || "";
  state.submitDraft.owner = owner;
  state.submitDraft.members = retained.filter((name) => name !== owner).join(", ");
}

function closeTaskDetail() {
  state.detailOpen = false;
  state.detailTab = "content";
  state.feedbackDraft = { message: "", attachments: [] };
  state.feedbackError = "";
  rerenderTaskPage({ restoreDetailFocus: true });
}

function leaveTaskDetailForNavigation() {
  state.detailOpen = false;
  state.selectedTaskId = null;
  state.detailTab = "content";
  state.feedbackDraft = { message: "", attachments: [] };
  state.feedbackError = "";
}

function openTaskSubmit() {
  if (!state.permissions.canCreate || (state.liveReadOnly && !state.liveTaskWrites)) return;
  state.actionTaskId = null;
  state.submitOpen = true;
  state.submitMode = "create";
  state.submitTaskId = null;
  state.submitOriginalDepartmentId = "";
  state.submitCanAssignOthers = state.permissions.canAssignOthers;
  state.submitError = "";
  state.writeError = "";
  state.writeNotice = "";
  state.submitDraft = {
    ...data.form.defaults,
    owner: authenticated ? state.currentUser.name : data.form.defaults.owner,
    attachments: [],
    content: data.form.defaults.content ?? (data.form.defaults.contentKey ? pageT(currentHelpers.lang, data.form.defaults.contentKey) : "")
  };
  rerenderTaskPage({ focusSubmit: true });
}

function canEditTask(task) {
  return Boolean(task) && (isTaskCreator(task, state.currentUser) || state.currentUser.isSuperAdmin ||
    state.currentUser.isAdminOfActive || state.permissions.canEditOthers);
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
  state.writeNotice = "";
  state.submitDraft = {
    title: task.title,
    content: task.content,
    priority: task.priority,
    visibility: task.visibility,
    departmentId: task.departmentId || "",
    owner: task.assignees[0]?.name || "",
    requiresReview: task.requiresReview ? "yes" : "no",
    members: task.assignees.slice(1).map((assignee) => assignee.name).join(", "),
    due: String(task.due || "").replaceAll("/", "-"),
    attachments: (task.attachments ?? []).map((attachment) => ({ ...attachment }))
  };
  rerenderTaskPage({ focusSubmit: true });
}

function closeTaskSubmit() {
  if (state.writeBusy) return;
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

async function performTaskAction(taskId, action) {
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const location = taskLocation(taskId);
  if (!location) return;
  const { column, index, task } = location;
  if (action === "complete" && !task.done) {
    const scopedMember = selectedActionMember();
    const scopedAssignee = scopedMember ? taskAssignee(task, scopedMember) : null;
    const currentAssignee = taskAssignee(task, state.currentUser);
    const targetAssignee = scopedAssignee ?? (!scopedMember ? currentAssignee : null);
    const wholeTask = !scopedMember && isTaskCreator(task, state.currentUser);
    if (state.liveTaskWrites) {
      if (!wholeTask && !targetAssignee) return;
      state.writeBusy = true;
      state.writeError = "";
      rerenderTaskPage();
      try {
        const result = await completeLiveTask({
          taskId: task.id,
          targetEmployeeId: targetAssignee?.employeeId,
          wholeTask,
          needsApproval: task.requiresReview
        });
        if (result.wholeTask) completeWholeTask(task, result.completedAt);
        else {
          targetAssignee.completedAt = result.completedAt;
          targetAssignee.abandonedAt = null;
        }
      } catch (error) {
        console.warn("Task completion failed", error);
        state.writeError = "tasks.write.failed";
      } finally {
        state.writeBusy = false;
      }
      state.actionTaskId = null;
      rerenderTaskPage({ focusBoard: true });
      return;
    }
    const completedAt = localTimestamp();
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

async function toggleTaskParticipation(task) {
  if (!state.liveTaskWrites || state.writeBusy) return;
  const assignee = taskAssignee(task, state.currentUser);
  if (!assignee) return;
  const abandoned = assignee.abandonedAt != null || ((task.assignees?.length ?? 0) === 1 && task.status === "abandoned");
  const nextAbandoned = !abandoned;
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
    console.warn("Task participation update failed", error);
    state.writeError = "tasks.write.failed";
  } finally {
    state.writeBusy = false;
  }
  rerenderTaskPage({ focusDetail: state.detailOpen, focusBoard: !state.detailOpen });
}

document.addEventListener("click", async (event) => {
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

  const submitAttachmentRemove = event.target.closest("[data-task-submit-attachment-remove]");
  if (submitAttachmentRemove) {
    if (submitAttachmentRemove.disabled || state.writeBusy) return;
    const index = Number(submitAttachmentRemove.getAttribute("data-task-submit-attachment-remove"));
    if (Number.isInteger(index)) state.submitDraft.attachments.splice(index, 1);
    rerenderTaskPage({ focusSubmit: true });
    return;
  }

  if (event.target.closest("[data-task-feedback-attachment]")) {
    document.querySelector("[data-task-feedback-file]")?.click();
    return;
  }

  const feedbackAttachmentRemove = event.target.closest("[data-task-feedback-attachment-remove]");
  if (feedbackAttachmentRemove) {
    if (feedbackAttachmentRemove.disabled || state.writeBusy) return;
    const index = Number(feedbackAttachmentRemove.getAttribute("data-task-feedback-attachment-remove"));
    if (Number.isInteger(index)) state.feedbackDraft.attachments.splice(index, 1);
    rerenderTaskPage({ focusFeedback: true });
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
    state.feedbackDraft = { message: "", attachments: [] };
    state.feedbackError = "";
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

document.addEventListener("submit", async (event) => {
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
    const members = String(values.get("members") ?? state.submitDraft.members ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    const assignedMembers = [...new Set([owner, ...members].filter(Boolean))];
    const assignedRows = state.submitCanAssignOthers
      ? assignedMembers.map((name) => eligibleMembers.find((member) => member.name === name)).filter(Boolean)
      : state.submitMode === "edit"
        ? (state.tasks.find((task) => task.id === state.submitTaskId)?.assignees ?? [])
          .map((assignee) => state.members.find((member) => member.id === assignee.employeeId))
          .filter((member) => member && eligibleMemberIds.has(member.id))
        : eligibleMembers.filter((member) => member.id === state.currentUser.id);
    if (!assignedRows.length || (state.submitCanAssignOthers && assignedRows.length !== assignedMembers.length)) {
      state.submitError = assignedRows.length ? "tasks.submit.invalidAssignee" : "tasks.submit.assigneeRequired";
      rerenderTaskPage({ focusSubmit: true });
      return;
    }
    const title = String(values.get("title") || "").trim();
    const content = String(values.get("content") || "").trim();
    const due = String(values.get("due") || "");
    const requiresReview = values.get("requiresReview") === "yes";
    if (state.liveTaskWrites) {
      state.writeBusy = true;
      state.submitError = "";
      state.writeError = "";
      state.writeNotice = "";
      rerenderTaskPage();
      try {
        if (state.submitMode === "edit") {
          const task = state.tasks.find((item) => item.id === state.submitTaskId);
          if (!task || !canEditTask(task)) throw new Error("Task edit permission required");
          const result = await updateLiveTask(task.id, {
            title,
            content,
            priority: task.dbPriority === "none" && task.priority === "low" && priority === "low" ? "none" : priority,
            due,
            requiresReview,
            assigneeIds: assignedRows.map((member) => member.id),
            departmentId,
            originalTitle: task.title,
            trackTitleEdit: !isTaskCreator(task, state.currentUser),
            attachments: state.submitDraft.attachments
          });
          try {
            task.title = title;
            task.content = content;
            task.priority = priority;
            task.dbPriority = task.dbPriority === "none" && priority === "low" ? "none" : priority === "medium" ? "mid" : priority;
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
            due,
            requiresReview,
            assigneeIds: assignedRows.map((member) => member.id),
            departmentId,
            files: state.submitDraft.attachments.map((attachment) => attachment.file).filter(Boolean)
          });
          try {
            const column = state.board.find((item) => item.key === priority) ?? state.board[0];
            const attachments = Array.isArray(result.attachments) ? result.attachments : [];
            const newTask = {
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
              startDate: "",
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
          state.writeNotice = "tasks.write.created";
        }
        state.submitOpen = false;
        state.submitTaskId = null;
        state.submitOriginalDepartmentId = "";
        state.submitError = "";
        state.writeError = "";
      } catch (error) {
        console.warn("Task save failed", error);
        state.submitError = "tasks.write.failed";
      } finally {
        state.writeBusy = false;
      }
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
      startDate: "",
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
    closeTaskSubmit();
    return;
  }
  const form = event.target.closest("[data-task-feedback-form]");
  if (!form) return;
  event.preventDefault();
  if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
  const message = String(state.feedbackDraft.message || "").trim();
  const attachments = state.feedbackDraft.attachments ?? [];
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
        mentionedUserIds: []
      });
      task.feedback.push({
        id: String(result.feedback.id),
        author: result.feedback.author_name || currentUser.name,
        authorUserId: result.feedback.author_user_id || currentUser.userId || null,
        timestamp: localTimestamp(),
        message: result.feedback.body || "",
        parentId: result.feedback.parent_feedback_id || null,
        mentionedUserIds: result.feedback.mentioned_user_ids ?? [],
        attachments: result.attachments.map((attachment) => ({ ...attachment })),
        attachmentCount: result.attachments.length,
        own: true
      });
      task.countBadge = String(task.feedback.length);
      state.feedbackDraft = { message: "", attachments: [] };
    } catch (error) {
      console.warn("Task feedback save failed", error);
      state.feedbackError = "tasks.write.failed";
    } finally {
      state.writeBusy = false;
    }
  } else {
    task.feedback.push({
      id: `feedback-local-${Date.now()}`,
      author: currentUser.name,
      timestamp: localTimestamp(),
      message,
      attachments: [],
      attachmentCount: attachments.length,
      own: true
    });
    task.countBadge = String(task.feedback.length);
    state.feedbackDraft = { message: "", attachments: [] };
  }
  rerenderTaskPage({ focusFeedback: true });
});

function syncTaskSubmitDraft(form) {
  const values = new FormData(form);
  for (const key of ["title", "content", "priority", "visibility", "departmentId", "owner", "requiresReview", "members", "due"]) {
    const value = values.get(key);
    if (value != null) state.submitDraft[key] = String(value);
  }
}

function syncTaskSubmitSegment(control) {
  const segment = control.closest(".form-task-submit__segment");
  if (!segment) return;
  segment.querySelectorAll("label").forEach((label) => {
    const input = label.querySelector('input[type="radio"]');
    label.classList.toggle("form-task-submit__segment--active", input?.checked === true);
  });
}

document.addEventListener("input", (event) => {
  const feedbackInput = event.target.closest('[data-task-feedback-form] textarea[name="message"]');
  if (feedbackInput) {
    state.feedbackDraft.message = feedbackInput.value;
    return;
  }
  const form = event.target.closest("[data-task-submit-form]");
  if (form) syncTaskSubmitDraft(form);
});

document.addEventListener("change", (event) => {
  const feedbackAttachmentInput = event.target.closest("[data-task-feedback-file]");
  if (feedbackAttachmentInput) {
    if (state.liveReadOnly && !state.liveTaskWrites) return;
    const currentFiles = new Set((state.feedbackDraft.attachments ?? []).map((attachment) => `${attachment.name}:${attachment.size}:${attachment.lastModified ?? ""}`));
    const nextFiles = [...feedbackAttachmentInput.files]
      .filter((file) => !currentFiles.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => ({ file, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }));
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
  // Text controls dispatch change while losing focus. Replacing the form here would remove
  // the submit button between pointerdown and click, so keep non-dependent updates in place.
  if (event.target.matches('input[type="radio"]')) syncTaskSubmitSegment(event.target);
});

attachTaskDomainController({
  state,
  filterState,
  getHelpers: () => currentHelpers,
  rerender: rerenderTaskPage,
  closeTaskDetail,
  leaveTaskDetailForNavigation,
  adjustOpenTaskCounts,
  localTimestamp,
  toggleTaskParticipation
});

window.__shellMenu = [
  { key: "nav.tasks", icon: "icon-nav-task", href: "./index.html", active: true, unreadKey: "tasks" },
  { key: "nav.team", icon: "icon-nav-user", href: "./members.html" }
];
window.__shellData = { unread: await getUnread(), user: currentUser };
window.__shellContent = renderTaskManagement;
await import("../shell/shell.js");
