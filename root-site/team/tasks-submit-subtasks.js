let submitSubtaskDraftSequence = 0;

export function createTaskSubmitSubtaskDraft() {
  submitSubtaskDraftSequence += 1;
  return {
    id: `submit-subtask-${Date.now()}-${submitSubtaskDraftSequence}`,
    title: "",
    assigneeId: ""
  };
}

export function normalizeTaskSubmitSubtasks(items, { parentAssigneeId, eligibleMembers }) {
  const eligibleIds = new Set((eligibleMembers ?? []).map((member) => String(member.id || "")).filter(Boolean));
  const fallbackAssigneeId = eligibleIds.has(String(parentAssigneeId || "")) ? String(parentAssigneeId) : "";
  return (items ?? []).map((item) => ({
    id: String(item?.id || ""),
    title: String(item?.title || "").trim(),
    assigneeId: eligibleIds.has(String(item?.assigneeId || ""))
      ? String(item.assigneeId)
      : fallbackAssigneeId
  })).filter((item) => item.title && item.assigneeId);
}

export async function createTaskSubmitSubtasks({ parentTaskId, subtasks, createSubtask }) {
  const created = [];
  for (const subtask of subtasks ?? []) {
    try {
      const result = await createSubtask({
        parentTaskId,
        title: subtask.title,
        assigneeId: subtask.assigneeId
      });
      created.push({ subtask, result });
    } catch (error) {
      return { created, failure: { subtask, error } };
    }
  }
  return { created, failure: null };
}

export function buildTaskSubtaskEcho({ parent, subtask, member, result = null, localId, timestamp }) {
  const task = result?.task ?? null;
  return {
    id: String(task?.id || localId),
    title: String(task?.title || subtask.title),
    content: "",
    owner: member.name,
    members: [member.name],
    priority: "low",
    dbPriority: "none",
    status: "inProgress",
    done: false,
    due: "",
    startDate: "",
    createdAt: timestamp,
    completedAt: "",
    creator: parent.creator,
    creatorId: parent.creatorId,
    parentId: parent.id,
    departmentId: parent.departmentId || "",
    visibility: parent.visibility,
    visibilityDepartment: parent.visibilityDepartment,
    requiresReview: parent.requiresReview,
    approvedAt: "",
    approvedBy: "",
    attachments: [],
    attachmentCount: 0,
    countBadge: "",
    assignees: [{ employeeId: member.id, name: member.name, completedAt: null, abandonedAt: null }],
    feedback: [],
    subtasks: []
  };
}
