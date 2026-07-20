function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function memberIdentity(member) {
  if (member && typeof member === "object" && member.id) return String(member.id);
  return normalizedName(member && typeof member === "object" ? member.name : member);
}

function assigneeIdentity(assignee) {
  return assignee?.employeeId ? String(assignee.employeeId) : normalizedName(assignee?.name);
}

export function taskAssignee(task, member) {
  const identity = memberIdentity(member);
  return (task.assignees ?? []).find((assignee) => assigneeIdentity(assignee) === identity) ?? null;
}

export function isTaskCreator(task, member) {
  const identity = memberIdentity(member);
  const creatorIdentity = task.creatorId ? String(task.creatorId) : normalizedName(task.creator);
  return creatorIdentity === identity;
}

export function canDeleteTaskForUser(task, member, permissions = {}) {
  return Boolean(task) && (isTaskCreator(task, member) || member?.isSuperAdmin === true ||
    member?.isAdminOfActive === true || permissions.canDeleteOthers === true);
}

export function isTaskAssignedTo(task, member) {
  return taskAssignee(task, member) !== null;
}

// Mirrors bizflow_samyung/team/src/lib/taskHelpers.js:9-20 (empDoneFor/empAbandonedFor).
export function taskDoneForMember(task, member) {
  const assignee = taskAssignee(task, member);
  if (assignee) return assignee.completedAt != null && assignee.abandonedAt == null;
  return task.done === true || task.status === "completed";
}

export function taskAbandonedForMember(task, member) {
  const assignee = taskAssignee(task, member);
  if (assignee) return assignee.abandonedAt != null;
  return task.status === "abandoned";
}

// Mirrors bizflow_samyung/team/src/views/Tasks.jsx:148: sidebar counts assignees only.
export function openAssignedTaskCount(member, tasks) {
  return tasks.filter((task) => task.parentId === null && isTaskAssignedTo(task, member) &&
    !taskDoneForMember(task, member) && !taskAbandonedForMember(task, member)).length;
}

export function isTaskOwnedByMember(task, member) {
  return isTaskAssignedTo(task, member) || isTaskCreator(task, member);
}

// Mirrors bizflow_samyung/team/src/views/Tasks.jsx:293-307 (showInOpen/showInDone/showInAb).
export function taskMatchesMemberStatus(task, member, status) {
  const assigned = isTaskAssignedTo(task, member);
  const done = taskDoneForMember(task, member);
  const abandoned = taskAbandonedForMember(task, member);
  const creatorAwaitingApproval = isTaskCreator(task, member) && isWaitingApproval(task);
  if (status === "completed") {
    if (creatorAwaitingApproval) return false;
    return assigned ? done && !abandoned : task.done === true || task.status === "completed";
  }
  if (status === "abandoned") return assigned ? abandoned && !done : task.status === "abandoned";
  const overallOpen = task.done !== true && task.status !== "completed" && task.status !== "abandoned";
  if (!overallOpen) return false;
  if (creatorAwaitingApproval) return status === "overdue" ? task.status === "overdue" : true;
  if (assigned && (done || abandoned)) return false;
  if (status === "overdue") return task.status === "overdue";
  return true;
}

export function isTaskRelated(task, currentUser) {
  return isTaskOwnedByMember(task, currentUser);
}

export function isWaitingApproval(task) {
  const assignees = task.assignees ?? [];
  const overallOpen = task.done !== true && task.status !== "completed" && task.status !== "abandoned";
  return overallOpen && task.requiresReview === true && !task.approvedAt && assignees.length > 0 &&
    assignees.every((assignee) => Boolean(assignee.completedAt) || Boolean(assignee.abandonedAt));
}

export function taskSubtaskProgress(task) {
  const subtasks = task.subtasks ?? [];
  return {
    done: subtasks.filter((subtask) => subtask.done === true || subtask.status === "completed").length,
    total: subtasks.length
  };
}

export function scopedTopTasks(tasks, { onlyMine = false, currentUser, member = null } = {}) {
  const currentName = normalizedName(currentUser?.name);
  const currentId = currentUser?.id || "";
  const scoped = tasks.filter((task) => !onlyMine ||
    task.creatorId === currentId || normalizedName(task.creator) === currentName);
  return scoped.filter((task) => {
    if (!member) return task.parentId === null;
    if (!isTaskOwnedByMember(task, member)) return false;
    if (task.parentId === null) return true;
    // Mirrors bizflow_samyung/team/src/views/Tasks.jsx:265-273: promote an orphan in this member scope.
    const parent = scoped.find((candidate) => candidate.id === task.parentId);
    return !parent || !isTaskOwnedByMember(parent, member);
  });
}

export function calendarRelatedTasks(tasks, { onlyMine = false, currentUser } = {}) {
  return scopedTopTasks(tasks, { onlyMine, currentUser }).filter((task) => isTaskRelated(task, currentUser));
}

export function overviewForMember(member, tasks) {
  const topTasks = tasks.filter((task) => task.parentId === null);
  const rows = topTasks.map((task) => ({ task, assignee: taskAssignee(task, member) }))
    .filter(({ task }) => isTaskOwnedByMember(task, member));
  // Mirrors bizflow_samyung/team/src/views/Tasks.jsx:200-205 overview member counts.
  const open = rows.filter(({ task }) =>
    task.done !== true && task.status !== "completed" && task.status !== "abandoned" &&
    !taskDoneForMember(task, member) && !taskAbandonedForMember(task, member));
  const completed = rows.filter(({ task }) => taskDoneForMember(task, member));
  const recentlyCompleted = completed
    .sort((a, b) => String(b.assignee?.completedAt || b.task.completedAt || b.task.createdAt)
      .localeCompare(String(a.assignee?.completedAt || a.task.completedAt || a.task.createdAt)));
  return {
    open,
    completedCount: completed.length,
    recentlyCompleted,
    groups: {
      high: open.filter(({ task }) => task.priority === "high"),
      medium: open.filter(({ task }) => task.priority === "medium"),
      low: open.filter(({ task }) => task.priority === "low")
    }
  };
}
