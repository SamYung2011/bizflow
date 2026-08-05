import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";
import { isStrictCompletionMode, meetsTaskCompletionThreshold } from "./task-completion-threshold.js";

// 批3件D: 落库前归一驗收方式,任何非 'strict' 输入都写 'ratio'(与 migration 101 的 CHECK/DEFAULT 对齐)。
function normalizedCompletionMode(value) {
  return isStrictCompletionMode(value) ? "strict" : "ratio";
}

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

function storedAttachment(value) {
  if (!value || typeof value !== "object" || !value.url) return null;
  return {
    url: String(value.url),
    name: String(value.name || "attachment"),
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : 0,
    type: String(value.type || "application/octet-stream")
  };
}

async function invalidateTaskReads(...tables) {
  try {
    await invalidateLiveTables(tables);
  } catch (error) {
    console.warn("Task cache invalidation failed", error);
  }
}

export async function createLiveTask({ title, content, priority, startDate = null, due, requiresReview, completionMode = "ratio", assigneeIds, departmentId = null, files = [] }) {
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
      completion_mode: normalizedCompletionMode(completionMode),
      title,
      priority: taskPriority(priority),
      note: content || null,
      start_date: startDate || null,
      due_date: due || null,
      company_id: currentUser.activeCompanyId,
      department_id: departmentId || null
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
    await invalidateTaskReads("employee_tasks", "task_assignees");
    return { task, assignees: assigneeResult.data ?? [], attachments: uploads };
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("task-attachments").remove(uploadedPaths);
    if (task?.id) await client.from("employee_tasks").delete().eq("id", task.id);
    throw error;
  }
}

export async function updateLiveTask(taskId, { title, content, priority, startDate = null, due, requiresReview, completionMode = "ratio", assigneeIds, departmentId = null, originalTitle, trackTitleEdit, attachments }) {
  const { client, currentUser } = await writeContext();
  const assigned = uniqueIds(assigneeIds);
  if (!assigned.length) throw new Error("Task requires an assignee");
  const patch = {
    title,
    note: content || null,
    priority: taskPriority(priority),
    start_date: startDate || null,
    due_date: due || null,
    needs_approval: requiresReview === true,
    completion_mode: normalizedCompletionMode(completionMode),
    department_id: departmentId || null
  };
  if (trackTitleEdit && title !== originalTitle) {
    patch.title_edited_by = currentUser.employeeId;
    patch.title_edited_at = new Date().toISOString();
  }
  const uploadedPaths = [];
  const nextAttachments = [];
  let taskResult;
  try {
    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        if (attachment?.file) {
          const uploaded = await uploadTaskAttachment(client, attachment.file, taskId);
          uploadedPaths.push(uploaded.path);
          nextAttachments.push(uploaded.attachment);
        } else {
          const stored = storedAttachment(attachment);
          if (stored) nextAttachments.push(stored);
        }
      }
      patch.attachments = nextAttachments.length ? nextAttachments : null;
    }
    taskResult = await client.from("employee_tasks").update(patch).eq("id", taskId).select("*").single();
    throwIfError(taskResult.error);
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("task-attachments").remove(uploadedPaths);
    throw error;
  }

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
    await invalidateTaskReads("employee_tasks", "task_assignees");
    return { task: ownerResult.data, attachments: Array.isArray(attachments) ? nextAttachments : null };
  }
  await invalidateTaskReads("employee_tasks", "task_assignees");
  return { task: taskResult.data, attachments: Array.isArray(attachments) ? nextAttachments : null };
}

export async function createLiveTaskFeedback({ taskId, message, attachments = [], parentFeedbackId = null, mentionedUserIds = [] }) {
  const { client, currentUser } = await writeContext();
  const files = attachments.map((attachment) => attachment?.file ?? attachment).filter(Boolean);
  const mentions = uniqueIds(mentionedUserIds);
  if (!String(message || "").trim() && !files.length) throw new Error("Task feedback requires content or an attachment");
  const uploadedPaths = [];
  try {
    const uploads = [];
    for (const file of files) {
      const uploaded = await uploadTaskAttachment(client, file, taskId);
      uploadedPaths.push(uploaded.path);
      uploads.push(uploaded.attachment);
    }
    const result = await client.from("employee_task_feedbacks").insert({
      task_id: taskId,
      author_user_id: currentUser.userId,
      author_name: currentUser.name,
      body: String(message || "").trim() || null,
      parent_feedback_id: parentFeedbackId || null,
      mentioned_user_ids: mentions.length ? mentions : null,
      attachments: uploads.length ? uploads : null
    }).select("*").single();
    throwIfError(result.error);
    await invalidateTaskReads("employee_task_feedbacks");
    return { feedback: result.data, attachments: uploads };
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("task-attachments").remove(uploadedPaths);
    throw error;
  }
}

export async function updateLiveTaskFeedback(feedbackId, message) {
  const { client, currentUser } = await writeContext();
  const body = String(message || "").trim();
  if (!body) throw new Error("Task feedback body is required");
  const result = await client.from("employee_task_feedbacks")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", feedbackId)
    .eq("author_user_id", currentUser.userId)
    .select("*")
    .single();
  throwIfError(result.error);
  await invalidateTaskReads("employee_task_feedbacks");
  return result.data;
}

export function taskAttachmentStoragePath(value) {
  try {
    const marker = "/storage/v1/object/public/task-attachments/";
    const pathname = new URL(String(value || "")).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return "";
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const parts = path.split("/");
    return parts.length >= 2 && parts.every((part) => part && part !== "." && part !== "..") ? path : "";
  } catch {
    return "";
  }
}

export async function deleteLiveTaskFeedback(feedbackId) {
  const { client, currentUser } = await writeContext();
  const result = await client.from("employee_task_feedbacks")
    .delete()
    .eq("id", feedbackId)
    .eq("author_user_id", currentUser.userId)
    .select("id, attachments")
    .single();
  throwIfError(result.error);
  await invalidateTaskReads("employee_task_feedbacks");
  const paths = (Array.isArray(result.data.attachments) ? result.data.attachments : [])
    .map((attachment) => taskAttachmentStoragePath(attachment?.url))
    .filter(Boolean);
  if (paths.length) {
    try {
      const removeResult = await client.storage.from("task-attachments").remove(paths);
      throwIfError(removeResult.error);
    } catch (error) {
      console.warn("Task feedback deleted but attachment cleanup failed", error);
    }
  }
  return result.data;
}

export async function deleteLiveTask(taskId) {
  const { client } = await writeContext();
  // Mirrors team/src/components/EditTaskModal.jsx:115-120. Database cascades own
  // assignees, feedback and child tasks; a missing/RLS-hidden row must fail visibly.
  const result = await client.from("employee_tasks").delete().eq("id", taskId).select("id").single();
  throwIfError(result.error);
  await invalidateTaskReads("employee_tasks", "task_assignees", "employee_task_feedbacks");
  return result.data;
}

export async function completeLiveTask({ taskId, targetEmployeeId, wholeTask, needsApproval, completionMode = "ratio", completed = true }) {
  const { client, currentUser } = await writeContext();
  const completedAt = completed ? new Date().toISOString() : null;
  if (wholeTask) {
    if (!completed) {
      // 2026-08-04 (todo #260, 煊煊 approved): creator uncheck now resets the whole task AND every
      // task_assignees completion row together, so an assignee row can't be left showing "done"
      // under a task the creator just marked incomplete. Supersedes the 8-3 NR-task-1 port of the
      // old Tasks.jsx semantics (which cleared only the task's own terminal state and left every
      // assignee completion row untouched) — see test-nr-task-1.mjs for the flipped contract.
      // RLS: migration 082's task_assignees_update_manage lets a task's creator update any assignee
      // row on it (can_manage_task_assignees -> creator_employee_id = current_employee_id()), so
      // this bulk update needs no new policy. Unconditional across all rows (matches "every" above);
      // abandoned rows already carry completed_at: null (setLiveTaskParticipation clears it when
      // abandoning), so re-writing null there is a harmless no-op.
      const assigneeResult = await client.from("task_assignees")
        .update({ completed_at: null })
        .eq("task_id", taskId);
      throwIfError(assigneeResult.error);
      const taskResult = await client.from("employee_tasks")
        .update({ status: "open", completed_at: null, approved_at: null, approved_by: null })
        .eq("id", taskId)
        .select("*")
        .single();
      throwIfError(taskResult.error);
      await invalidateTaskReads("employee_tasks", "task_assignees");
      return { completedAt: null, wholeTask: true, taskDone: false };
    }
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
    await invalidateTaskReads("employee_tasks", "task_assignees");
    return { completedAt, wholeTask: true, taskDone: true };
  }

  if (String(targetEmployeeId || "") !== String(currentUser.employeeId)) {
    throw new Error("Assignees can only toggle their own task row");
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
  const rows = rowsResult.data ?? [];
  const allDone = completed && rows.length > 0 && rows.every((row) => row.completed_at != null);
  // 批3件C (2026-08-05 煊煊拍板 11:43「嘶。如果设定了负责人，负责人超过80%勾选完成就全部完成吧。」
  // + 11:52 追拍「那不坏菜了吗。按比例来！」): 勾完成行数 ≥ max(1, round(0.8×全部行数))(定义见
  // task-completion-threshold.js;放棄行 completed_at 恒 null 不进分子、但留在分母)也收整单,
  // 与既有全员完成规则并行、先到先触发,共用下面同一条任务收口 UPDATE,不造第二套。
  // 只在勾完成方向生效(completed 守卫)——反勾方向哪怕剩 4/5 也走重开,触发后任一反勾重开整单不变。
  // RLS: 触发者是普通 assignee,不 fan-out 其他 assignee 行(082 task_assignees_update_manage 只给
  // creator/admin/can_assign_others)——整单完成只落任务级 status/completed_at(083 触发器 D 段白名单
  // 恰好允许),其余 assignee 行保持原状(卡片上没勾的人无 ✓ 是诚实状态)。
  // 批3件D: completion_mode='strict'(嚴格驗收)时阈值整段不生效,只剩全员规则;'ratio' 照件C 走。
  const thresholdDone = !isStrictCompletionMode(completionMode) && completed && meetsTaskCompletionThreshold(
    rows.filter((row) => row.completed_at != null).length, rows.length);
  const taskDone = (allDone || thresholdDone) && !needsApproval;
  if (taskDone) {
    const taskResult = await client.from("employee_tasks")
      .update({ status: "done", completed_at: completedAt })
      .eq("id", taskId)
      .select("id")
      .single();
    throwIfError(taskResult.error);
  } else if (!completed) {
    // G-task-3 (2026-08-05): the assignee's own-row uncheck reopens the task with status/completed_at
    // ONLY — no approved_at/approved_by clearing. Two reasons, both load-bearing:
    // 1. RLS field guard: migration 082/083's prevent_task_field_hijack trigger limits a plain
    //    assignee (not creator/admin/validator/can_edit_others) to status/completed_at on
    //    employee_tasks; including approved_* in this patch makes the whole UPDATE raise on any
    //    previously-approved task, after the assignee row was already cleared — a partial write.
    // 2. Old-version parity: team/src/views/Tasks.jsx:381-383 wrote exactly
    //    { status: 'open', completed_at: null } here. Approval stamps only reset on the creator's
    //    wholeTask uncheck above (批2A/e821c45 semantics), where the trigger authorizes the caller.
    const taskResult = await client.from("employee_tasks")
      .update({ status: "open", completed_at: null })
      .eq("id", taskId)
      .select("id")
      .single();
    throwIfError(taskResult.error);
  }
  await invalidateTaskReads("employee_tasks", "task_assignees");
  return { completedAt, wholeTask: false, taskDone };
}

export async function approveLiveTask(taskId) {
  const { client, currentUser } = await writeContext();
  const [taskResult, assigneesResult] = await Promise.all([
    client.from("employee_tasks")
      .select("id,status,needs_approval,approved_at")
      .eq("id", taskId)
      .single(),
    client.from("task_assignees")
      .select("completed_at,abandoned_at")
      .eq("task_id", taskId)
  ]);
  throwIfError(taskResult.error);
  throwIfError(assigneesResult.error);
  const task = taskResult.data;
  const assignees = assigneesResult.data ?? [];
  const waiting = task?.status === "open" && task.needs_approval === true && task.approved_at == null &&
    assignees.length > 0 && assignees.every((row) => row.completed_at != null || row.abandoned_at != null);
  if (!waiting) throw new Error("Task is not waiting for approval");

  const approvedAt = new Date().toISOString();
  const status = assignees.some((row) => row.completed_at != null) ? "done" : "abandoned";
  const result = await client.from("employee_tasks")
    .update({
      status,
      completed_at: approvedAt,
      approved_at: approvedAt,
      approved_by: currentUser.employeeId
    })
    .eq("id", taskId)
    .eq("status", "open")
    .eq("needs_approval", true)
    .is("approved_at", null)
    .select("id,status,completed_at,approved_at,approved_by")
    .single();
  throwIfError(result.error);
  await invalidateTaskReads("employee_tasks");
  return { row: result.data, approvedBy: currentUser.name };
}

export async function setLiveSubtaskCompletion({ taskId, completed }) {
  const { client, currentUser } = await writeContext();
  const taskResult = await client.from("employee_tasks")
    .select("id,parent_task_id,needs_approval,completion_mode")
    .eq("id", taskId)
    .single();
  throwIfError(taskResult.error);
  if (!taskResult.data?.parent_task_id) throw new Error("Subtask completion requires a child task");

  // Never accept a target employee from the UI: the authenticated employee can
  // only update their own existing assignee row, matching migration 082 RLS.
  const ownResult = await client.from("task_assignees")
    .select("employee_id,completed_at,abandoned_at")
    .eq("task_id", taskId)
    .eq("employee_id", currentUser.employeeId)
    .single();
  throwIfError(ownResult.error);

  const completedAt = completed ? new Date().toISOString() : null;
  const assigneeResult = await client.from("task_assignees")
    .update({ completed_at: completedAt, abandoned_at: null })
    .eq("task_id", taskId)
    .eq("employee_id", currentUser.employeeId)
    .select("employee_id")
    .single();
  throwIfError(assigneeResult.error);

  const rowsResult = await client.from("task_assignees")
    .select("employee_id,completed_at,abandoned_at")
    .eq("task_id", taskId);
  throwIfError(rowsResult.error);
  const rows = rowsResult.data ?? [];
  const activeRows = rows.filter((row) => row.abandoned_at == null);
  const allDone = activeRows.length > 0 && activeRows.every((row) => row.completed_at != null);
  // 批3件C (2026-08-05 80% 阈值): 子任务走同一条「assignee 勾自己那行」触发时机,同一份阈值定义
  // (task-completion-threshold.js)。completed 守卫同上——uncheck 方向恒不触发,反勾重开语义不变。
  // 批3件D: 驗收方式取子任务自己那行的 fresh completion_mode(上面 select 一并带出,零额外请求);
  // strict 关阈值。094 的 create_employee_subtask RPC 不复制该列,子任务恒为列默认 'ratio'。
  const thresholdDone = !isStrictCompletionMode(taskResult.data.completion_mode) && completed && meetsTaskCompletionThreshold(
    rows.filter((row) => row.completed_at != null).length, rows.length);
  const taskDone = (allDone || thresholdDone) && taskResult.data.needs_approval !== true;
  const rowResult = await client.from("employee_tasks")
    .update({ status: taskDone ? "done" : "open", completed_at: taskDone ? completedAt : null })
    .eq("id", taskId)
    .select("id")
    .single();
  throwIfError(rowResult.error);

  await invalidateTaskReads("employee_tasks", "task_assignees");
  return { completedAt, allDone, taskDone };
}

export async function createLiveSubtask({ parentTaskId, title, assigneeId }) {
  const { client } = await writeContext();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle || !parentTaskId || !assigneeId) throw new Error("Subtask requires a title and assignee");
  const result = await client.rpc("create_employee_subtask", {
    p_parent_task_id: parentTaskId,
    p_title: normalizedTitle,
    p_assignee_id: assigneeId
  });
  throwIfError(result.error);
  if (!result.data?.task?.id || !result.data?.assignee?.employee_id) throw new Error("Subtask create returned an invalid result");
  await invalidateTaskReads("employee_tasks", "task_assignees");
  return result.data;
}

export async function updateLiveSubtaskTitle({ subtaskId, title }) {
  const { client } = await writeContext();
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle || !subtaskId) throw new Error("Subtask title is required");
  const result = await client.rpc("update_employee_subtask_title", {
    p_subtask_id: subtaskId,
    p_title: normalizedTitle
  });
  throwIfError(result.error);
  if (!result.data?.id || !result.data?.parent_task_id) throw new Error("Subtask update returned an invalid result");
  await invalidateTaskReads("employee_tasks");
  return result.data;
}

export async function deleteLiveSubtask(subtaskId) {
  const { client } = await writeContext();
  if (!subtaskId) throw new Error("Subtask ID is required");
  const result = await client.rpc("delete_employee_subtask", { p_subtask_id: subtaskId });
  throwIfError(result.error);
  if (!result.data?.id || !result.data?.parent_task_id) throw new Error("Subtask delete returned an invalid result");
  await invalidateTaskReads("employee_tasks", "task_assignees", "employee_task_feedbacks");
  return result.data;
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
  await invalidateTaskReads("employee_tasks", "task_assignees");
  return { changedAt };
}
