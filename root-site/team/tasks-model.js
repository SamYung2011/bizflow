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

const DAY_MS = 86400000;

function dateOnlyUtc(value) {
  const match = String(value || "").replaceAll("/", "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function timestampMs(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const normalized = text.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, "$1-$2-$3");
  return Date.parse(normalized);
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

export function canManageTaskSubtasks(task, member) {
  return Boolean(task) && task.parentId == null && (isTaskCreator(task, member) ||
    member?.isSuperAdmin === true || member?.isAdminOfActive === true);
}

export function canEditSubtaskTitle(task, member, permissions = {}) {
  return Boolean(task?.parentId) && (isTaskCreator(task, member) ||
    member?.isSuperAdmin === true || member?.isAdminOfActive === true ||
    permissions.canEditOthers === true);
}

export function isTaskAssignedTo(task, member) {
  return taskAssignee(task, member) !== null;
}

// Mirrors team/src/views/Tasks.jsx:329-342: a mention is a separate durable
// inbox relation only when the target is not already an assignee. Ignore a
// malformed/self-authored @ so it cannot create a notification for its author.
export function isTaskMentionedForMember(task, member) {
  const userId = String(member?.userId || "");
  if (!userId || isTaskAssignedTo(task, member)) return false;
  return (task?.feedback ?? []).some((entry) =>
    entry?.authorUserId !== userId &&
    (entry?.mentionedUserIds ?? []).some((mentionedUserId) => String(mentionedUserId) === userId));
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

export function isOpenTask(task) {
  return Boolean(task) && task.done !== true && task.status !== "completed" && task.status !== "abandoned";
}

// Mirrors bizflow_samyung/team/src/views/Tasks.jsx:148: sidebar counts assignees only.
export function openAssignedTaskCount(member, tasks) {
  return tasks.filter((task) => task.parentId === null && isTaskAssignedTo(task, member) &&
    !taskDoneForMember(task, member) && !taskAbandonedForMember(task, member)).length;
}

export function isTaskOwnedByMember(task, member) {
  return isTaskAssignedTo(task, member) || isTaskCreator(task, member);
}

export function isTaskVisibleToMember(task, member) {
  return isTaskOwnedByMember(task, member) || isTaskMentionedForMember(task, member);
}

export function defaultTaskViewForUser(currentUser, currentMember) {
  const admin = currentUser?.isSuperAdmin === true || currentUser?.isAdminOfActive === true;
  return {
    mode: admin ? "overview" : "board",
    member: admin ? "all" : memberIdentity(currentMember) || "all"
  };
}

export function taskCompletionForMember(task, member) {
  if (!task) {
    return { checked: false, canToggle: false, wholeTask: false };
  }
  const assignee = taskAssignee(task, member);
  if (assignee) {
    return {
      checked: assignee.completedAt != null && assignee.abandonedAt == null,
      canToggle: true,
      wholeTask: false
    };
  }
  const creator = isTaskCreator(task, member);
  return {
    checked: taskDoneForMember(task, member),
    canToggle: creator && !taskAbandonedForMember(task, member),
    wholeTask: creator
  };
}

export function taskDuePresentation(task, now = new Date()) {
  const due = dateOnlyUtc(task?.due);
  if (!Number.isFinite(due)) return { tone: "none", days: null };
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due - today) / DAY_MS);
  if (!isOpenTask(task)) return { tone: "terminal", days };
  if (days < 0) return { tone: "overdue", days: Math.abs(days) };
  if (days <= 2) return { tone: "soon", days };
  return { tone: "normal", days };
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
  if (!isOpenTask(task)) return false;
  if (creatorAwaitingApproval) return status === "overdue" ? task.status === "overdue" : true;
  if (assigned && (done || abandoned)) return false;
  if (status === "overdue") return task.status === "overdue";
  return true;
}

export function terminalTasksForMember(member, tasks, { now = Date.now(), windowDays = 180 } = {}) {
  const owned = tasks.filter((task) => isTaskOwnedByMember(task, member));
  const ownedById = new Map(owned.map((task) => [task.id, task]));
  const cutoff = now - (windowDays * DAY_MS);
  const visibleTerminalChild = (task) => {
    if (task.parentId === null) return true;
    const parent = ownedById.get(task.parentId);
    return !parent || isOpenTask(parent);
  };
  const withinWindow = (task) => {
    const assignee = taskAssignee(task, member);
    // Match the old board exactly: assignee completion wins, then the task
    // terminal timestamp, then creation time. A row-level abandon timestamp
    // alone does not extend the task's 180-day visibility window.
    const stamp = timestampMs(assignee?.completedAt || task.completedAt || task.createdAt);
    return Number.isFinite(stamp) && stamp >= cutoff;
  };
  const candidates = owned.filter((task) => visibleTerminalChild(task) && withinWindow(task));
  return {
    completed: candidates.filter((task) => taskDoneForMember(task, member) && !taskAbandonedForMember(task, member)),
    abandoned: candidates.filter((task) => taskAbandonedForMember(task, member) && !taskDoneForMember(task, member))
  };
}

export function isTaskRelated(task, currentUser) {
  return isTaskVisibleToMember(task, currentUser);
}

export function isWaitingApproval(task) {
  const assignees = task.assignees ?? [];
  return isOpenTask(task) && task.requiresReview === true && !task.approvedAt && assignees.length > 0 &&
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
    // A feedback @ on a child task is its own inbox entry. Keep it reachable
    // even when the parent is already visible through assignment/creation.
    const mentionTarget = member ?? currentUser;
    if (task.parentId !== null && isTaskMentionedForMember(task, mentionTarget)) return true;
    if (!member) return task.parentId === null;
    if (!isTaskVisibleToMember(task, member)) return false;
    if (task.parentId === null) return true;
    // Mirrors bizflow_samyung/team/src/views/Tasks.jsx:265-273: promote an orphan in this member scope.
    const parent = scoped.find((candidate) => candidate.id === task.parentId);
    return !parent || !isTaskVisibleToMember(parent, member);
  });
}

export function calendarRelatedTasks(tasks, { onlyMine = false, currentUser } = {}) {
  return scopedTopTasks(tasks, { onlyMine, currentUser })
    .filter((task) => isTaskRelated(task, currentUser));
}

export function overviewForMember(member, tasks) {
  // Overview historically counts roots only. Mentions are the sole child-task
  // exception so this feature does not change ordinary orphan-child totals.
  const visibleTasks = tasks.filter((task) =>
    task.parentId === null || isTaskMentionedForMember(task, member));
  const rows = visibleTasks.map((task) => ({ task, assignee: taskAssignee(task, member) }))
    .filter(({ task }) => isTaskVisibleToMember(task, member));
  const mentioned = rows.filter(({ task }) => isTaskMentionedForMember(task, member));
  // Mirrors bizflow_samyung/team/src/views/Tasks.jsx:200-205 overview member counts.
  const open = rows.filter(({ task }) => isOpenTask(task) &&
    !taskDoneForMember(task, member) && !taskAbandonedForMember(task, member));
  const completed = rows.filter(({ task }) => taskDoneForMember(task, member));
  const recentlyCompleted = completed
    .sort((a, b) => String(b.assignee?.completedAt || b.task.completedAt || b.task.createdAt)
      .localeCompare(String(a.assignee?.completedAt || a.task.completedAt || a.task.createdAt)));
  return {
    open,
    mentioned,
    completedCount: completed.length,
    recentlyCompleted,
    groups: {
      high: open.filter(({ task }) => task.priority === "high"),
      medium: open.filter(({ task }) => task.priority === "medium"),
      low: open.filter(({ task }) => task.priority === "low")
    }
  };
}
