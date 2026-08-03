import { taskT } from "./tasks-i18n.js";
import { canEditSubtaskTitle, canManageTaskSubtasks, isTaskCreator, isWaitingApproval } from "./tasks-model.js";
import { setSessionValue } from "../data/session-state.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { attachLiveSnapshotRefresh } from "../data/live-snapshot-listener.js";
import { buildTaskSubtaskEcho } from "./tasks-submit-subtasks.js";

export function attachTaskDomainController({
  state,
  filterState,
  getHelpers,
  rerender,
  closeTaskDetail,
  leaveTaskDetailForNavigation,
  adjustOpenTaskCounts,
  localTimestamp,
  toggleTaskParticipation,
  toggleSubtaskCompletion,
  createSubtask,
  updateSubtaskTitle,
  deleteSubtask,
  refreshTaskBoardReadState,
  approveTask,
  refreshLiveData,
  isLiveRefreshBlocked,
  scope
}) {
  const liveRefresh = attachLiveSnapshotRefresh({
    scope,
    snapshots: ["tasks.json"],
    tables: ["employee_tasks", "task_assignees", "employee_task_feedbacks"],
    isBlocked: isLiveRefreshBlocked,
    refresh: refreshLiveData
  });
  const taskById = (taskId) => state.tasks.find((task) => task.id === taskId) ?? null;

  function removeSubtask(subtaskId) {
    const subtask = taskById(subtaskId);
    if (!subtask?.parentId) return;
    const parent = taskById(subtask.parentId);
    if (parent) parent.subtasks = parent.subtasks.filter((item) => item.id !== subtaskId);
    state.tasks = state.tasks.filter((item) => item.id !== subtaskId);
    state.summary.total = Math.max(0, state.summary.total - 1);
    if (subtask.status === "completed") state.summary.completed = Math.max(0, state.summary.completed - 1);
    else if (subtask.status !== "abandoned") {
      state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
      adjustOpenTaskCounts(subtask, -1);
    }
  }

  scope.listen(document, "click", async (event) => {
    if (event.target.closest("[data-task-overview-open]")) {
      leaveTaskDetailForNavigation();
      state.mode = "overview";
      filterState.view = "board";
      setSessionValue("team-tasks-view-mode", "board");
      rerender();
      return;
    }

    const memberTrigger = event.target.closest("[data-task-member]");
    if (memberTrigger) {
      leaveTaskDetailForNavigation();
      state.mode = "board";
      const nextMember = memberTrigger.getAttribute("data-task-member") || "all";
      if (filterState.member !== nextMember) state.boardExpandedPriorities.clear();
      filterState.member = nextMember;
      filterState.view = "board";
      setSessionValue("team-tasks-view-mode", "board");
      rerender();
      return;
    }

    const overviewToggle = event.target.closest("[data-overview-toggle]");
    if (overviewToggle) {
      const memberId = overviewToggle.getAttribute("data-overview-toggle");
      if (state.overviewExpanded.has(memberId)) state.overviewExpanded.delete(memberId);
      else state.overviewExpanded.add(memberId);
      rerender();
      return;
    }

    const completedToggle = event.target.closest("[data-overview-completed-toggle]");
    if (completedToggle) {
      const memberId = completedToggle.getAttribute("data-overview-completed-toggle");
      if (state.overviewCompletedExpanded.has(memberId)) state.overviewCompletedExpanded.delete(memberId);
      else state.overviewCompletedExpanded.add(memberId);
      rerender();
      return;
    }

    const calendarMonth = event.target.closest("button[data-calendar-month]");
    if (calendarMonth) {
      const direction = calendarMonth.getAttribute("data-calendar-month");
      if (!["previous", "next", "today"].includes(direction)) return;
      const anchor = direction === "today" ? new Date() : new Date(state.calendarYear, state.calendarMonth + (direction === "next" ? 1 : -1), 1);
      state.calendarYear = anchor.getFullYear();
      state.calendarMonth = anchor.getMonth();
      state.calendarExpandedDate = null;
      rerender();
      return;
    }

    const calendarExpand = event.target.closest("[data-calendar-expand]");
    if (calendarExpand) {
      state.calendarExpandedDate = calendarExpand.getAttribute("data-calendar-expand");
      rerender();
      return;
    }

    if (event.target.closest("[data-calendar-close]") || event.target.matches("[data-calendar-overlay]")) {
      state.calendarExpandedDate = null;
      rerender();
      return;
    }

    if (event.target.closest("[data-task-ai-open]")) {
      state.aiOpen = true;
      rerender();
      return;
    }

    if (event.target.closest("[data-task-ai-close]") || event.target.matches("[data-task-ai-overlay]")) {
      state.aiOpen = false;
      rerender();
      return;
    }

    const approve = event.target.closest("[data-task-approve]");
    if (approve) {
      if (approve.disabled || state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
      const task = taskById(approve.getAttribute("data-task-approve"));
      const ownTask = isTaskCreator(task, state.currentUser);
      if (task && isWaitingApproval(task) && (ownTask || state.permissions.canValidate)) {
        if (state.liveTaskWrites) await approveTask(task);
        else {
          task.approvedAt = localTimestamp();
          task.approvedBy = state.currentUser.name;
          task.done = true;
          task.status = "completed";
          state.summary.completed += 1;
          state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
          adjustOpenTaskCounts(task, -1);
          rerender();
        }
      }
      return;
    }

    const abandon = event.target.closest("[data-task-abandon]");
    if (abandon) {
      if (abandon.disabled || (state.liveReadOnly && !state.liveTaskWrites)) return;
      const task = taskById(abandon.getAttribute("data-task-abandon"));
      if (state.liveTaskWrites) {
        if (task) await toggleTaskParticipation(task);
        return;
      }
      if (task && task.status !== "abandoned") {
        const previousStatus = task.status;
        task.status = "abandoned";
        task.done = false;
        if (previousStatus === "completed") {
          state.summary.completed = Math.max(0, state.summary.completed - 1);
        } else {
          state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
          adjustOpenTaskCounts(task, -1);
        }
        closeTaskDetail();
      }
      return;
    }

    const subtaskToggle = event.target.closest("[data-task-subtask-toggle]");
    if (subtaskToggle) {
      if (subtaskToggle.disabled) return;
      const subtask = taskById(subtaskToggle.getAttribute("data-task-subtask-toggle"));
      if (state.liveTaskWrites) {
        if (subtask) await toggleSubtaskCompletion(subtask);
        return;
      }
      if (state.liveReadOnly) return;
      if (subtask) {
        const completed = subtask.status === "completed";
        subtask.status = completed ? "inProgress" : "completed";
        subtask.done = !completed;
        subtask.completedAt = completed ? "" : localTimestamp();
        subtask.assignees.forEach((assignee) => { assignee.completedAt = completed ? null : subtask.completedAt; });
        state.summary.completed += completed ? -1 : 1;
        state.summary.inProgress += completed ? 1 : -1;
        adjustOpenTaskCounts(subtask, completed ? 1 : -1);
        rerender();
      }
      return;
    }

    const subtaskEdit = event.target.closest("[data-task-subtask-edit]");
    if (subtaskEdit) {
      if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
      const subtask = taskById(subtaskEdit.getAttribute("data-task-subtask-edit"));
      if (!canEditSubtaskTitle(subtask, state.currentUser, state.permissions)) return;
      state.subtaskEditingId = subtask.id;
      state.subtaskEditDraft = subtask.title;
      state.subtaskEditOriginal = subtask.title;
      rerender({ focusSubtaskEditId: subtask.id });
      return;
    }

    const subtaskEditCancel = event.target.closest("[data-task-subtask-edit-cancel]");
    if (subtaskEditCancel) {
      if (state.writeBusy) return;
      const subtaskId = subtaskEditCancel.getAttribute("data-task-subtask-edit-cancel");
      state.subtaskEditingId = null;
      state.subtaskEditDraft = "";
      state.subtaskEditOriginal = "";
      rerender({ focusSubtaskId: subtaskId });
      return;
    }

    const subtaskDelete = event.target.closest("[data-task-subtask-delete]");
    if (subtaskDelete) {
      if (state.writeBusy || subtaskDelete.disabled || (state.liveReadOnly && !state.liveTaskWrites)) return;
      const subtask = taskById(subtaskDelete.getAttribute("data-task-subtask-delete"));
      const parent = subtask?.parentId ? taskById(subtask.parentId) : null;
      if (!subtask || !canManageTaskSubtasks(parent, state.currentUser)) return;
      if (await confirmInPage(taskT(getHelpers().lang, "tasks.detail.deleteSubtaskConfirm"), { danger: true })) {
        if (!scope.isCurrent()) return;
        if (state.liveTaskWrites && !await deleteSubtask(subtask)) {
          if (scope.isCurrent()) rerender({ focusSubtaskId: subtask.id });
          return;
        }
        if (!scope.isCurrent()) return;
        removeSubtask(subtask.id);
        if (state.subtaskEditingId === subtask.id) {
          state.subtaskEditingId = null;
          state.subtaskEditDraft = "";
          state.subtaskEditOriginal = "";
        }
        refreshTaskBoardReadState?.();
        rerender({ focusSubtaskAdd: true });
      }
      return;
    }
  });

  scope.listen(document, "submit", async (event) => {
    const editForm = event.target.closest("[data-task-subtask-edit-form]");
    if (editForm) {
      event.preventDefault();
      if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
      const subtask = taskById(editForm.getAttribute("data-task-subtask-edit-form"));
      const title = String(state.subtaskEditDraft || "").trim();
      if (!subtask || state.subtaskEditingId !== subtask.id || !title ||
        !canEditSubtaskTitle(subtask, state.currentUser, state.permissions)) return;
      if (title === subtask.title) {
        state.subtaskEditingId = null;
        state.subtaskEditDraft = "";
        state.subtaskEditOriginal = "";
        rerender({ focusSubtaskId: subtask.id });
        return;
      }
      const updated = state.liveTaskWrites ? await updateSubtaskTitle(subtask, title) : { title };
      if (!scope.isCurrent()) return;
      if (!updated) {
        rerender({ focusSubtaskEditId: subtask.id });
        return;
      }
      subtask.title = String(updated.title || title);
      state.subtaskEditingId = null;
      state.subtaskEditDraft = "";
      state.subtaskEditOriginal = "";
      refreshTaskBoardReadState?.();
      rerender({ focusSubtaskId: subtask.id });
      return;
    }

    const form = event.target.closest("[data-task-subtask-form]");
    if (!form) return;
    event.preventDefault();
    if (state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites)) return;
    const values = new FormData(form);
    const title = String(values.get("title") ?? state.subtaskAddDraft.title ?? "").trim();
    const assigneeId = String(values.get("assigneeId") ?? state.subtaskAddDraft.assigneeId ?? "");
    state.subtaskAddDraft = { title, assigneeId };
    const parent = taskById(form.getAttribute("data-parent-task-id"));
    const member = state.members.find((item) => item.id === assigneeId);
    const department = parent?.departmentId
      ? (state.departments ?? []).find((item) => item.id === parent.departmentId)
      : null;
    const eligible = !parent?.departmentId || department?.memberIds?.includes(member?.id);
    if (!title || !member || !parent || !eligible || !canManageTaskSubtasks(parent, state.currentUser)) return;
    const created = state.liveTaskWrites ? await createSubtask(parent, title, member) : null;
    if (!scope.isCurrent()) return;
    if (state.liveTaskWrites && !created) {
      rerender({ focusSubtaskAdd: true });
      return;
    }
    const subtask = buildTaskSubtaskEcho({
      parent,
      subtask: { title },
      member,
      result: created,
      localId: `local-subtask-${Date.now()}`,
      timestamp: localTimestamp()
    });
    parent.subtasks.push(subtask);
    state.tasks.push(subtask);
    state.summary.total += 1;
    state.summary.inProgress += 1;
    adjustOpenTaskCounts(subtask, 1);
    state.subtaskAddDraft = { title: "", assigneeId: "" };
    refreshTaskBoardReadState?.();
    rerender({ focusSubtaskAdd: true });
  });

  scope.listen(document, "input", (event) => {
    const addTitle = event.target.closest('[data-task-subtask-form] input[name="title"]');
    if (addTitle) {
      state.subtaskAddDraft.title = addTitle.value;
      return;
    }
    const editTitle = event.target.closest('[data-task-subtask-edit-form] input[name="subtaskTitle"]');
    if (editTitle && state.subtaskEditingId === editTitle.closest("[data-task-subtask-edit-form]")?.getAttribute("data-task-subtask-edit-form")) {
      state.subtaskEditDraft = editTitle.value;
    }
  });

  scope.listen(document, "change", (event) => {
    const subtaskAssignee = event.target.closest('[data-task-subtask-form] select[name="assigneeId"]');
    if (subtaskAssignee) {
      state.subtaskAddDraft.assigneeId = subtaskAssignee.value;
      return;
    }
    if (!event.target.matches("[data-task-only-mine]")) return;
    if (state.onlyMine !== event.target.checked) state.boardExpandedPriorities.clear();
    state.onlyMine = event.target.checked;
    setSessionValue("team-tasks-only-mine", state.onlyMine ? "1" : "0");
    rerender();
  });

  scope.listen(document, "keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.subtaskEditingId) {
      const subtaskId = state.subtaskEditingId;
      state.subtaskEditingId = null;
      state.subtaskEditDraft = "";
      state.subtaskEditOriginal = "";
      event.preventDefault();
      event.stopPropagation();
      rerender({ focusSubtaskId: subtaskId });
    } else if (state.aiOpen) {
      state.aiOpen = false;
      rerender();
    } else if (state.calendarExpandedDate) {
      state.calendarExpandedDate = null;
      rerender();
    }
  });

  const flushDeferredRefresh = () => scope.timeout(() => void liveRefresh.flush(), 0);
  scope.listen(document, "focusout", flushDeferredRefresh);
  return liveRefresh;
}
