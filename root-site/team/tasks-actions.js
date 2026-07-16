import { taskT } from "./tasks-i18n.js";
import { isTaskCreator, isWaitingApproval, taskAssignee } from "./tasks-model.js";

export function renderTaskActionPopover({ task, open, state, helpers }) {
  if (!open) return "";
  const { escapeHtml, lang } = helpers;
  const ownTask = isTaskCreator(task, state.currentUser);
  const currentAssignee = taskAssignee(task, state.currentUser);
  const assigned = currentAssignee !== null;
  const canComplete = ownTask || assigned || (!state.liveTaskWrites && state.permissions.canEditOthers);
  const canEdit = ownTask || state.currentUser.isSuperAdmin || state.currentUser.isAdminOfActive || state.permissions.canEditOthers;
  const canDelete = ownTask || state.currentUser.isSuperAdmin || state.currentUser.isAdminOfActive || state.permissions.canDeleteOthers;
  const canCopy = state.permissions.canCreate;
  const completeDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : "";
  const writeDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : "";
  return `<div class="task-action-popover" role="menu" tabindex="-1" data-task-action-popover data-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(taskT(lang, "tasks.action.menu"))}">
    ${state.liveTaskWrites && canEdit ? `<button type="button" role="menuitem" data-task-action-edit="${escapeHtml(task.id)}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(taskT(lang, "tasks.action.edit"))}</button>` : ""}
    ${canCopy ? `<button type="button" role="menuitem" data-task-action-copy="${escapeHtml(task.id)}"${writeDisabled}>${escapeHtml(taskT(lang, "tasks.action.copy"))}</button>` : ""}
    ${canComplete ? `<button type="button" role="menuitem" data-task-action-complete="${escapeHtml(task.id)}"${task.done || (!ownTask && currentAssignee?.completedAt) || isWaitingApproval(task) ? " disabled aria-disabled=\"true\"" : completeDisabled}>${escapeHtml(taskT(lang, "tasks.action.complete"))}</button>` : ""}
    ${canDelete ? `<button type="button" role="menuitem" class="task-action-popover__delete" data-task-action-delete="${escapeHtml(task.id)}"${writeDisabled}>${escapeHtml(taskT(lang, "tasks.action.delete"))}</button>` : ""}
  </div>`;
}
