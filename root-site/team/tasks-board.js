import { taskT } from "./tasks-i18n.js";
import { filterTaskColumns, renderTaskFilter } from "./tasks-filters.js";
import { renderTaskActionPopover } from "./tasks-actions.js";
import { isTaskCreator, isWaitingApproval, memberIdentity, scopedTopTasks, taskAssignee, taskSubtaskProgress } from "./tasks-model.js";

function renderTaskCard(task, columnKey, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const actionOpen = state.actionTaskId === task.id;
  const hasBadge = task.countBadge !== "" && task.countBadge != null;
  const subtaskProgress = taskSubtaskProgress(task);
  const waitingApproval = isWaitingApproval(task);
  const assignees = (task.assignees ?? []).length > 1
    ? task.assignees.map((assignee) => `<span class="${assignee.completedAt ? "is-completed" : ""}" title="${escapeHtml(assignee.completedAt || assignee.name)}">${assignee.completedAt ? "✓ " : ""}${escapeHtml(assignee.name)}</span>`).join("")
    : "";
  const ownTask = isTaskCreator(task, state.currentUser);
  const assigned = taskAssignee(task, state.currentUser) !== null;
  const canOpenActions = ownTask || assigned || state.permissions.canCreate || state.permissions.canEditOthers || state.permissions.canDeleteOthers;
  return `<article class="team-task-card team-task-card--${columnKey}${actionOpen ? " team-task-card--action-open" : ""}" data-task-card="${escapeHtml(task.id)}">
    <button type="button" class="team-task-card__body" data-task-detail-open="${escapeHtml(task.id)}" aria-label="${escapeHtml(`${taskT(lang, "tasks.detail.open")}: ${task.title}`)}">
      <h3 class="team-task-card__title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</h3>
      <div class="team-task-card__meta"><span>${escapeHtml(taskT(lang, "tasks.due"))}</span><span>${escapeHtml(task.due)}</span></div>
      <div class="team-task-card__meta"><span>${escapeHtml(taskT(lang, "tasks.owner"))}</span><span title="${escapeHtml(task.owner)}">${escapeHtml(task.owner)}</span></div>
      <div class="team-task-card__signals">
        ${subtaskProgress.total ? `<span title="${escapeHtml(taskT(lang, "tasks.card.subtasks"))}">☑ ${subtaskProgress.done}/${subtaskProgress.total}</span>` : ""}
        ${task.attachmentCount > 0 ? `<span title="${escapeHtml(taskT(lang, "tasks.card.attachments"))}">📎 ${task.attachmentCount}</span>` : ""}
        ${task.feedback.length ? `<span title="${escapeHtml(taskT(lang, "tasks.card.feedback"))}">💬 ${task.feedback.length}</span>` : ""}
        ${task.visibility === "department" ? `<span class="team-task-card__department">${escapeHtml(task.visibilityDepartment || taskT(lang, "tasks.card.department"))}</span>` : ""}
      </div>
      ${assignees ? `<div class="team-task-card__assignees">${assignees}</div>` : ""}
      ${waitingApproval ? `<span class="team-task-card__approval">${escapeHtml(taskT(lang, "tasks.card.waitingApproval", { name: task.creator }))}</span>` : ""}
    </button>
    <div class="team-task-card__actions">
      <span class="team-count-badge${hasBadge ? "" : " team-count-badge--empty"}" aria-hidden="${hasBadge ? "false" : "true"}">${escapeHtml(hasBadge ? task.countBadge : "0")}</span>
      ${canOpenActions ? `<button type="button" class="team-more-button" data-task-action-open="${escapeHtml(task.id)}" aria-haspopup="menu" aria-expanded="${actionOpen}" aria-label="${escapeHtml(`${taskT(lang, "tasks.action.open")}: ${task.title}`)}"><span></span><span></span><span></span></button>` : ""}
    </div>
    ${renderTaskActionPopover({ task, open: actionOpen, state, helpers })}
  </article>`;
}

function renderColumn(column, state, filterState, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const title = taskT(lang, `tasks.priority.${column.key}`);
  const emptyKey = filterState.status === "completed"
    ? "tasks.empty.completed"
    : filterState.status === "abandoned"
      ? "tasks.empty.abandoned"
      : filterState.status === "overdue" ? "tasks.empty.overdue" : "tasks.empty.default";
  const expanded = state.boardExpandedPriorities?.has(column.key) === true;
  const visibleTasks = expanded ? column.tasks : column.tasks.slice(0, 5);
  const hiddenCount = Math.max(0, column.tasks.length - visibleTasks.length);
  const body = visibleTasks.length
    ? visibleTasks.map((task) => renderTaskCard(task, column.key, state, helpers)).join("")
    : `<p class="team-kanban-empty">${escapeHtml(taskT(lang, emptyKey))}</p>`;
  const unreadCount = column.tasks.filter((task) => state.boardUnreadTaskIds?.has(task.id)).length;
  const unreadLabel = taskT(lang, "tasks.column.unreadChanges", { count: unreadCount });
  return `<section class="team-kanban-column team-kanban-column--${column.key}" data-task-column="${column.key}" data-column-count="${column.count}">
    <header class="team-kanban-column__head" data-task-column-read="${column.key}"><div class="team-kanban-column__title"><span title="${escapeHtml(title)}">${escapeHtml(title)}</span><span>${column.count}</span></div>${unreadCount > 0 ? `<span class="team-count-badge team-count-badge--unread" data-task-column-unread="${unreadCount}" aria-label="${escapeHtml(unreadLabel)}" title="${escapeHtml(unreadLabel)}">${unreadCount}</span>` : ""}</header>
    <div class="team-kanban-column__tasks">${body}</div>
    <div class="team-kanban-column__footer">
      ${column.tasks.length > 5 ? `<button type="button" class="team-column-expand${expanded ? " team-column-expand--open" : ""}" data-task-column-expand="${column.key}" aria-expanded="${expanded}" aria-label="${escapeHtml(taskT(lang, expanded ? "tasks.column.collapse" : "tasks.column.expand", { count: hiddenCount }))}" title="${escapeHtml(taskT(lang, expanded ? "tasks.column.collapse" : "tasks.column.expand", { count: hiddenCount }))}">${icon("icon-arrow-down")}${icon("icon-arrow-down")}</button>` : ""}
      ${state.permissions.canCreate ? `<button type="button" class="team-column-add" data-task-column-add="${column.key}" aria-label="${escapeHtml(taskT(lang, "tasks.column.add", { priority: title }))}" title="${escapeHtml(taskT(lang, "tasks.column.add", { priority: title }))}"${state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : ""}>${icon("icon-add-surface-add")}</button>` : ""}
    </div>
  </section>`;
}

export function renderTaskBoardGrid({ state, filterState, helpers }) {
  const scopedMember = filterState.member === "all"
    ? null
    : state.members.find((member) => memberIdentity(member) === filterState.member) ?? null;
  const scopedTasks = scopedTopTasks(state.tasks, {
    onlyMine: state.onlyMine,
    currentUser: state.currentUser,
    member: scopedMember
  });
  const scopedBoard = state.board.map((column) => ({
    ...column,
    tasks: scopedTasks.filter((task) => task.priority === column.key)
  }));
  const columns = filterTaskColumns(scopedBoard, filterState, {
    mobile: matchMedia("(max-width: 768px)").matches,
    members: state.members
  });
  return columns.map((column) => renderColumn(column, state, filterState, helpers)).join("");
}

export function renderTaskToolbar({ state, filterState, members, featureAiBatch, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const memberFilter = filterState.view === "board" ? renderTaskFilter({ group: "member", filterState, members, helpers }) : "";
  const boardFilters = filterState.view === "board" && state.mode === "board"
    ? `${renderTaskFilter({ group: "status", filterState, members, helpers })}${renderTaskFilter({ group: "priority", filterState, members, helpers })}`
    : "";
  return `<div class="team-kanban-toolbar team-domain-toolbar">
    <div class="team-kanban-filters">${memberFilter}${boardFilters}${renderTaskFilter({ group: "view", filterState, members, helpers })}<label class="team-only-mine"><input type="checkbox" data-task-only-mine${state.onlyMine ? " checked" : ""}><span>${escapeHtml(taskT(lang, "tasks.onlyMine"))}</span></label></div>
    <div class="team-domain-toolbar__actions">${featureAiBatch ? `<button type="button" class="team-ai-task" data-task-ai-open>${icon("icon-task-list", "icon")}<span>${escapeHtml(taskT(lang, "tasks.ai.open"))}</span></button>` : ""}${state.permissions.canCreate ? `<button type="button" class="team-new-task" data-task-submit-open${state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : ""}>${icon("icon-add-line-add")}<span>${escapeHtml(taskT(lang, "tasks.new"))}</span></button>` : ""}</div>
  </div>`;
}
