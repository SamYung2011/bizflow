import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";

async function writeContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || !currentUser?.employeeId || !currentUser?.activeCompanyId) {
    throw new Error("Authenticated task write context required");
  }
  return { client, currentUser };
}

function throwIfError(error) {
  if (error) throw error;
}

function uniqueIds(values) {
  return [...new Set((values ?? []).map((value) => String(value || "")).filter(Boolean))];
}

function taskPriority(value) {
  return value === "medium" ? "mid" : ["high", "low", "none"].includes(value) ? value : "low";
}

async function uploadTaskAttachment(client, file, taskId) {
  const extension = (String(file.name || "").split(".").pop() || "bin").toLowerCase();
  const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const upload = await client.storage.from("task-attachments").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  throwIfError(upload.error);
  const publicUrl = client.storage.from("task-attachments").getPublicUrl(path).data.publicUrl;
  return {
    path,
    attachment: {
      url: publicUrl,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream"
    }
  };
}

export async function createLiveTask({ title, content, priority, due, requiresReview, assigneeIds, files = [] }) {
  const { client, currentUser } = await writeContext();
  const assigned = uniqueIds(assigneeIds);
  if (!assigned.length) throw new Error("Task requires an assignee");
  let task = null;
  const uploadedPaths = [];
  try {
    const taskResult = await client.from("employee_tasks").insert({
      employee_id: assigned[0],
      creator_employee_id: currentUser.employeeId,
      needs_approval: requiresReview === true,
      title,
      priority: taskPriority(priority),
      note: content || null,
      start_date: null,
      due_date: due || null,
      company_id: currentUser.activeCompanyId,
      department_id: null
    }).select("*").single();
    throwIfError(taskResult.error);
    task = taskResult.data;

    const assigneeResult = await client.from("task_assignees").insert(
      assigned.map((employeeId) => ({ task_id: task.id, employee_id: employeeId }))
    ).select("*");
    throwIfError(assigneeResult.error);

    const uploads = [];
    for (const file of files) {
      const uploaded = await uploadTaskAttachment(client, file, task.id);
      uploadedPaths.push(uploaded.path);
      uploads.push(uploaded.attachment);
    }
    if (uploads.length) {
      const attachmentResult = await client.from("employee_tasks")
        .update({ attachments: uploads })
        .eq("id", task.id)
        .select("*")
        .single();
      throwIfError(attachmentResult.error);
      task = attachmentResult.data;
    }
    return { task, assignees: assigneeResult.data ?? [], attachments: uploads };
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("task-attachments").remove(uploadedPaths);
    if (task?.id) await client.from("employee_tasks").delete().eq("id", task.id);
    throw error;
  }
}

export async function updateLiveTask(taskId, { title, content, priority, due, requiresReview, assigneeIds, originalTitle, trackTitleEdit }) {
  const { client, currentUser } = await writeContext();
  const assigned = uniqueIds(assigneeIds);
  if (!assigned.length) throw new Error("Task requires an assignee");
  const patch = {
    title,
    note: content || null,
    priority: taskPriority(priority),
    due_date: due || null,
    needs_approval: requiresReview === true
  };
  if (trackTitleEdit && title !== originalTitle) {
    patch.title_edited_by = currentUser.employeeId;
    patch.title_edited_at = new Date().toISOString();
  }
  const taskResult = await client.from("employee_tasks").update(patch).eq("id", taskId).select("*").single();
  throwIfError(taskResult.error);

  const currentResult = await client.from("task_assignees").select("employee_id").eq("task_id", taskId);
  throwIfError(currentResult.error);
  const current = uniqueIds((currentResult.data ?? []).map((row) => row.employee_id));
  const toAdd = assigned.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !assigned.includes(id));
  if (toAdd.length) {
    const addResult = await client.from("task_assignees").insert(
      toAdd.map((employeeId) => ({ task_id: taskId, employee_id: employeeId }))
    );
    throwIfError(addResult.error);
  }
  if (toRemove.length) {
    const removeResult = await client.from("task_assignees").delete().eq("task_id", taskId).in("employee_id", toRemove);
    throwIfError(removeResult.error);
  }
  if (taskResult.data.employee_id !== assigned[0]) {
    const ownerResult = await client.from("employee_tasks").update({ employee_id: assigned[0] }).eq("id", taskId).select("*").single();
    throwIfError(ownerResult.error);
    return ownerResult.data;
  }
  return taskResult.data;
}

export async function completeLiveTask({ taskId, targetEmployeeId, wholeTask, needsApproval }) {
  const { client, currentUser } = await writeContext();
  const completedAt = new Date().toISOString();
  if (wholeTask) {
    const assigneeResult = await client.from("task_assignees")
      .update({ completed_at: completedAt })
      .eq("task_id", taskId)
      .is("completed_at", null)
      .is("abandoned_at", null);
    throwIfError(assigneeResult.error);
    const patch = { status: "done", completed_at: completedAt };
    if (needsApproval) {
      patch.approved_at = completedAt;
      patch.approved_by = currentUser.employeeId;
    }
    const taskResult = await client.from("employee_tasks").update(patch).eq("id", taskId).select("*").single();
    throwIfError(taskResult.error);
    return { completedAt, wholeTask: true };
  }

  const assigneeResult = await client.from("task_assignees")
    .update({ completed_at: completedAt, abandoned_at: null })
    .eq("task_id", taskId)
    .eq("employee_id", targetEmployeeId)
    .select("employee_id")
    .single();
  throwIfError(assigneeResult.error);
  const rowsResult = await client.from("task_assignees").select("completed_at,abandoned_at").eq("task_id", taskId);
  throwIfError(rowsResult.error);
  const allDone = (rowsResult.data ?? []).length > 0 && (rowsResult.data ?? []).every((row) => row.completed_at != null);
  if (allDone && !needsApproval) {
    const taskResult = await client.from("employee_tasks")
      .update({ status: "done", completed_at: completedAt })
      .eq("id", taskId)
      .select("id")
      .single();
    throwIfError(taskResult.error);
  }
  return { completedAt, wholeTask: allDone && !needsApproval };
}

export async function setLiveTaskParticipation({ taskId, employeeId, abandoned, singleAssignee }) {
  const { client } = await writeContext();
  const changedAt = abandoned ? new Date().toISOString() : null;
  const assigneeResult = await client.from("task_assignees")
    .update({ abandoned_at: changedAt, completed_at: null })
    .eq("task_id", taskId)
    .eq("employee_id", employeeId)
    .select("employee_id")
    .single();
  throwIfError(assigneeResult.error);
  if (singleAssignee) {
    const taskResult = await client.from("employee_tasks")
      .update({ status: abandoned ? "abandoned" : "open", completed_at: changedAt })
      .eq("id", taskId)
      .select("id")
      .single();
    throwIfError(taskResult.error);
  }
  return { changedAt };
}
