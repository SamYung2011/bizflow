import { taskT } from "./tasks-i18n.js";
import { canDeleteTaskForUser, isTaskCreator, isWaitingApproval, taskAssignee, taskCompletionForMember } from "./tasks-model.js";

export function renderTaskActionPopover({ task, open, state, helpers }) {
  if (!open) return "";
  const { escapeHtml, lang } = helpers;
  const ownTask = isTaskCreator(task, state.currentUser);
  const currentAssignee = taskAssignee(task, state.currentUser);
  const assigned = currentAssignee !== null;
  const canComplete = ownTask || assigned || (!state.liveTaskWrites && state.permissions.canEditOthers);
  const canEdit = ownTask || state.currentUser.isSuperAdmin || state.currentUser.isAdminOfActive || state.permissions.canEditOthers;
  const canDelete = canDeleteTaskForUser(task, state.currentUser, state.permissions);
  const canCopy = state.permissions.canCreate;
  const completion = taskCompletionForMember(task, state.currentUser);
  const writeBlocked = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites);
  const writeDisabled = writeBlocked ? " disabled aria-disabled=\"true\"" : "";
  const deleteUnavailable = state.liveReadOnly && !state.liveTaskWrites;
  const deleteAttributes = deleteUnavailable ? " disabled aria-disabled=\"true\"" : " data-task-delete-enabled=\"true\"";
  // 2026-08-04 Figma 对稿拆除令: 卡片勾选框整拆(件1),完成态收进本菜单。
  // done/放弃卡(completion.checked 或 task.status==="abandoned")显示「取消完成」,
  // 点击走 toggleTaskCompletion 的 wholeTask 反勾路径(e821c45 全员重置语义,见 tasks.js);
  // open 卡保留原「完成」按钮,disabled 判定原样不动("open 卡菜单已有「完成」保持")。
  const isTerminalCard = completion.checked || task.status === "abandoned";
  const completeButton = isTerminalCard
    ? `<button type="button" role="menuitem" data-task-action-uncomplete="${escapeHtml(task.id)}"${!completion.canToggle || writeBlocked ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(taskT(lang, "tasks.action.uncomplete"))}</button>`
    : `<button type="button" role="menuitem" data-task-action-complete="${escapeHtml(task.id)}"${!completion.canToggle || completion.checked || isWaitingApproval(task) ? " disabled aria-disabled=\"true\"" : writeDisabled}>${escapeHtml(taskT(lang, "tasks.action.complete"))}</button>`;
  return `<div class="task-action-popover" role="menu" tabindex="-1" data-task-action-popover data-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(taskT(lang, "tasks.action.menu"))}">
    ${state.liveTaskWrites && canEdit ? `<button type="button" role="menuitem" data-task-action-edit="${escapeHtml(task.id)}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(taskT(lang, "tasks.action.edit"))}</button>` : ""}
    ${canCopy ? `<button type="button" role="menuitem" data-task-action-copy="${escapeHtml(task.id)}"${writeDisabled}>${escapeHtml(taskT(lang, "tasks.action.copy"))}</button>` : ""}
    ${canComplete ? completeButton : ""}
    ${canDelete ? `<button type="button" role="menuitem" class="task-action-popover__delete" data-task-action-delete="${escapeHtml(task.id)}"${deleteAttributes}>${escapeHtml(taskT(lang, "tasks.action.delete"))}</button>` : ""}
  </div>`;
}
