import { taskT } from "./tasks-i18n.js";
import { isWaitingApproval } from "./tasks-model.js";

export function renderTaskActionPopover({ task, open, state, helpers }) {
  if (!open) return "";
  const { escapeHtml, lang } = helpers;
  const currentName = String(state.currentUser.name || "").toLocaleLowerCase();
  const ownTask = String(task.creator || "").toLocaleLowerCase() === currentName;
  const assigned = (task.assignees ?? []).some((assignee) => String(assignee.name || "").toLocaleLowerCase() === currentName);
  const currentAssignee = (task.assignees ?? []).find((assignee) => String(assignee.name || "").toLocaleLowerCase() === currentName);
  const canComplete = ownTask || assigned || (!state.liveTaskWrites && state.permissions.canEditOthers);
  const canEdit = ownTask || state.currentUser.isSuperAdmin || state.currentUser.isAdminOfActive || state.permissions.canEditOthers;
  const canDelete = ownTask || state.permissions.canDeleteOthers;
  const completeDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : "";
  const deleteDisabled = state.writeBusy || state.liveReadOnly ? " disabled aria-disabled=\"true\"" : "";
  return `<div class="task-action-popover" role="menu" tabindex="-1" data-task-action-popover data-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(taskT(lang, "tasks.action.menu"))}">
    ${state.liveTaskWrites && canEdit ? `<button type="button" role="menuitem" data-task-action-edit="${escapeHtml(task.id)}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(taskT(lang, "tasks.action.edit"))}</button>` : ""}
    ${canComplete ? `<button type="button" role="menuitem" data-task-action-complete="${escapeHtml(task.id)}"${task.done || (!ownTask && currentAssignee?.completedAt) || isWaitingApproval(task) ? " disabled aria-disabled=\"true\"" : completeDisabled}>${escapeHtml(taskT(lang, "tasks.action.complete"))}</button>` : ""}
    ${canDelete ? `<button type="button" role="menuitem" class="task-action-popover__delete" data-task-action-delete="${escapeHtml(task.id)}"${deleteDisabled}>${escapeHtml(taskT(lang, "tasks.action.delete"))}</button>` : ""}
  </div>`;
}
