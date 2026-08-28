function memberTaskCountMap(members) {
  return new Map(members.map((member) => [member.id, member.taskCount]));
}

export function createTaskCompletionSnapshot(task, { summary, members }) {
  return {
    task: {
      done: task.done,
      status: task.status,
      completedAt: task.completedAt,
      approvedAt: task.approvedAt,
      approvedBy: task.approvedBy,
      assignees: task.assignees.map((assignee) => ({
        employeeId: assignee.employeeId,
        completedAt: assignee.completedAt,
        abandonedAt: assignee.abandonedAt
      }))
    },
    before: {
      completed: summary.completed,
      inProgress: summary.inProgress,
      memberTaskCounts: memberTaskCountMap(members)
    },
    effects: null
  };
}

export function captureTaskCompletionEffects(snapshot, { summary, members }) {
  const currentMemberTaskCounts = memberTaskCountMap(members);
  snapshot.effects = {
    active: true,
    completed: summary.completed - snapshot.before.completed,
    inProgress: summary.inProgress - snapshot.before.inProgress,
    memberTaskCounts: new Map([...snapshot.before.memberTaskCounts].map(([id, before]) => {
      const current = currentMemberTaskCounts.get(id);
      return [id, Number.isFinite(before) && Number.isFinite(current) ? current - before : 0];
    }))
  };
}

export function restoreTaskCompletionSnapshot(task, snapshot, { summary, members }) {
  Object.assign(task, {
    done: snapshot.task.done,
    status: snapshot.task.status,
    completedAt: snapshot.task.completedAt,
    approvedAt: snapshot.task.approvedAt,
    approvedBy: snapshot.task.approvedBy
  });
  const assigneeSnapshots = new Map(snapshot.task.assignees.map((assignee) => [assignee.employeeId, assignee]));
  task.assignees.forEach((assignee) => {
    const previous = assigneeSnapshots.get(assignee.employeeId);
    if (!previous) return;
    assignee.completedAt = previous.completedAt;
    assignee.abandonedAt = previous.abandonedAt;
  });

  if (!snapshot.effects?.active) return;
  summary.completed = Math.max(0, summary.completed - snapshot.effects.completed);
  summary.inProgress = Math.max(0, summary.inProgress - snapshot.effects.inProgress);
  members.forEach((member) => {
    const delta = snapshot.effects.memberTaskCounts.get(member.id);
    if (Number.isFinite(delta) && Number.isFinite(member.taskCount)) {
      member.taskCount = Math.max(0, member.taskCount - delta);
    }
  });
  snapshot.effects.active = false;
}
