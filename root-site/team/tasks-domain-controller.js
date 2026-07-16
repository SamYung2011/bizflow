import { taskT } from "./tasks-i18n.js";
import { isWaitingApproval } from "./tasks-model.js";
import { setSessionValue } from "../data/session-state.js";
import { confirmInPage } from "../components/confirm-dialog.js";

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
  scope
}) {
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
      filterState.member = memberTrigger.getAttribute("data-task-member") || "all";
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
      if (state.liveReadOnly || approve.disabled) return;
      const task = taskById(approve.getAttribute("data-task-approve"));
      const ownTask = task?.creator.toLocaleLowerCase() === state.currentUser.name.toLocaleLowerCase();
      if (task && isWaitingApproval(task) && (ownTask || state.permissions.canValidate)) {
        task.approvedAt = localTimestamp();
        task.approvedBy = state.currentUser.name;
        task.done = true;
        task.status = "completed";
        state.summary.completed += 1;
        state.summary.inProgress = Math.max(0, state.summary.inProgress - 1);
        adjustOpenTaskCounts(task, -1);
        rerender();
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
      if (state.liveReadOnly || subtaskToggle.disabled) return;
      const subtask = taskById(subtaskToggle.getAttribute("data-task-subtask-toggle"));
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

    const subtaskDelete = event.target.closest("[data-task-subtask-delete]");
    if (subtaskDelete) {
      if (state.liveReadOnly || subtaskDelete.disabled) return;
      if (await confirmInPage(taskT(getHelpers().lang, "tasks.detail.deleteSubtaskConfirm"), { danger: true })) {
        if (scope.disposed) return;
        removeSubtask(subtaskDelete.getAttribute("data-task-subtask-delete"));
        rerender();
      }
    }
  });

  scope.listen(document, "submit", (event) => {
    const form = event.target.closest("[data-task-subtask-form]");
    if (!form) return;
    event.preventDefault();
    if (state.liveReadOnly || !state.permissions.canCreate) return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const assigneeName = String(values.get("assignee") || "").trim();
    const parent = taskById(form.getAttribute("data-parent-task-id"));
    const member = state.members.find((item) => item.name === assigneeName);
    if (!title || !assigneeName || !parent) return;
    const subtask = {
      id: `local-subtask-${Date.now()}`,
      title,
      content: "",
      owner: assigneeName,
      members: [assigneeName],
      priority: "low",
      status: "inProgress",
      done: false,
      due: "",
      startDate: "",
      createdAt: localTimestamp(),
      completedAt: "",
      creator: state.currentUser.name,
      creatorId: state.currentUser.id,
      parentId: parent.id,
      visibility: parent.visibility,
      visibilityDepartment: parent.visibilityDepartment,
      requiresReview: parent.requiresReview,
      approvedAt: "",
      approvedBy: "",
      attachmentCount: 0,
      countBadge: "",
      assignees: [{ employeeId: member?.id || "", name: assigneeName, completedAt: null, abandonedAt: null }],
      feedback: [],
      subtasks: []
    };
    parent.subtasks.push(subtask);
    state.tasks.push(subtask);
    state.summary.total += 1;
    state.summary.inProgress += 1;
    adjustOpenTaskCounts(subtask, 1);
    rerender();
  });

  scope.listen(document, "change", (event) => {
    if (!event.target.matches("[data-task-only-mine]")) return;
    state.onlyMine = event.target.checked;
    setSessionValue("team-tasks-only-mine", state.onlyMine ? "1" : "0");
    rerender();
  });

  scope.listen(document, "keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.aiOpen) {
      state.aiOpen = false;
      rerender();
    } else if (state.calendarExpandedDate) {
      state.calendarExpandedDate = null;
      rerender();
    }
  });
}
