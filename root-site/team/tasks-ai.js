import { taskT } from "./tasks-i18n.js";

const AI_PRIORITIES = ["high", "medium", "low"];

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

export function createTaskAiState() {
  return {
    stage: "input",
    text: "",
    cards: [],
    parseBusy: false,
    publishBusy: false,
    errorKey: "",
    errorValues: {}
  };
}

export function taskAiMembersForDepartment(context, departmentId) {
  const members = Array.isArray(context?.members) ? context.members : [];
  if (!departmentId) return members;
  const department = (context?.departments ?? []).find((item) => item.id === departmentId);
  if (!department) return [];
  const memberIds = new Set(department.memberIds ?? []);
  return members.filter((member) => memberIds.has(member.id));
}

function defaultAssigneeId(context, departmentId) {
  const members = taskAiMembersForDepartment(context, departmentId);
  const currentUserId = String(context?.currentUserId || "");
  if (members.some((member) => member.id === currentUserId)) return currentUserId;
  return context?.canAssignOthers ? String(members[0]?.id || "") : "";
}

export function normalizeTaskAiCards(tasks, context, createId = (index) => `ai-${Date.now()}-${index}`) {
  const departmentByName = new Map((context?.departments ?? []).map((department) => [
    normalizedName(department.name), department
  ]));
  return (Array.isArray(tasks) ? tasks : []).map((task, index) => {
    const department = departmentByName.get(normalizedName(task?.department_name));
    const departmentId = String(department?.id || "");
    return {
      id: createId(index),
      title: String(task?.title || "").trim().slice(0, 100),
      description: String(task?.description || "").trim().slice(0, 2000),
      departmentId,
      due: cleanDate(task?.due_date),
      priority: task?.priority === "mid"
        ? "medium"
        : AI_PRIORITIES.includes(task?.priority) ? task.priority : "medium",
      assigneeId: defaultAssigneeId(context, departmentId)
    };
  }).filter((task) => task.title);
}

export function updateTaskAiCardDepartment(card, departmentId, context) {
  const nextDepartmentId = (context?.departments ?? []).some((department) => department.id === departmentId)
    ? departmentId
    : "";
  const eligibleIds = new Set(taskAiMembersForDepartment(context, nextDepartmentId).map((member) => member.id));
  const assigneeId = eligibleIds.has(card.assigneeId)
    ? card.assigneeId
    : defaultAssigneeId(context, nextDepartmentId);
  return { ...card, departmentId: nextDepartmentId, assigneeId };
}

export function taskAiPublishItems(cards, context) {
  const departmentIds = new Set((context?.departments ?? []).map((department) => department.id));
  return (cards ?? []).map((card) => {
    const departmentId = departmentIds.has(card.departmentId) ? card.departmentId : "";
    const eligibleIds = new Set(taskAiMembersForDepartment(context, departmentId).map((member) => member.id));
    const assigneeId = eligibleIds.has(card.assigneeId) ? card.assigneeId : "";
    return {
      card,
      title: String(card.title || "").trim().slice(0, 100),
      content: String(card.description || "").trim().slice(0, 2000),
      priority: AI_PRIORITIES.includes(card.priority) ? card.priority : "medium",
      startDate: null,
      due: cleanDate(card.due) || null,
      requiresReview: false,
      completionMode: "ratio",
      assigneeIds: assigneeId ? [assigneeId] : [],
      departmentId: departmentId || null,
      files: []
    };
  });
}

export function taskAiCardsReady(cards, context) {
  const items = taskAiPublishItems(cards, context);
  return items.length > 0 && items.every((item) => item.title && item.assigneeIds.length === 1);
}

export async function createTaskAiTasks({ items, createTask, shouldContinue = () => true }) {
  const created = [];
  for (const item of items ?? []) {
    if (!shouldContinue()) {
      return { created, failure: { item, error: Object.assign(new Error("page_inactive"), { code: "page_inactive" }) } };
    }
    try {
      const result = await createTask(item);
      created.push({ item, result });
    } catch (error) {
      return { created, failure: { item, error } };
    }
  }
  return { created, failure: null };
}

export function taskAiErrorKey(error) {
  const code = String(error?.code || "");
  if (["text_required", "text_too_long"].includes(code)) return `tasks.ai.error.${code}`;
  if (["auth_required", "invalid_token"].includes(code)) return "tasks.ai.error.auth";
  if (code === "feature_not_enabled") return "tasks.ai.error.feature";
  if (code === "not_company_member") return "tasks.ai.error.membership";
  if (code === "ai_not_configured") return "tasks.ai.error.notConfigured";
  if (code === "no_tasks") return "tasks.ai.error.noTasks";
  if (code === "network_error") return "tasks.ai.error.network";
  return "tasks.ai.error.failed";
}

function renderOptions(items, selected, helpers) {
  const { escapeHtml } = helpers;
  return items.map(({ value, label }) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderPreviewCard(card, index, context, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key, values) => taskT(lang, key, values);
  const members = taskAiMembersForDepartment(context, card.departmentId)
    .filter((member) => context.canAssignOthers || member.id === context.currentUserId);
  const departments = [
    { value: "", label: tt("tasks.detail.visibility.team") },
    ...(context.departments ?? []).map((department) => ({ value: department.id, label: department.name }))
  ];
  const assignees = [
    { value: "", label: tt("tasks.submit.assigneePlaceholder") },
    ...members.map((member) => ({ value: member.id, label: member.name }))
  ];
  const priorities = AI_PRIORITIES.map((priority) => ({
    value: priority,
    label: tt(`tasks.priority.${priority}`)
  }));
  return `<article class="task-ai-card" data-task-ai-card="${escapeHtml(card.id)}">
    <header><strong>${escapeHtml(tt("tasks.ai.taskNumber", { number: index + 1 }))}</strong><button type="button" data-task-ai-remove="${escapeHtml(card.id)}" aria-label="${escapeHtml(tt("tasks.ai.remove", { number: index + 1 }))}">×</button></header>
    <label><span>${escapeHtml(tt("tasks.submit.name"))}</span><input type="text" maxlength="100" data-task-ai-field="title" data-task-ai-id="${escapeHtml(card.id)}" value="${escapeHtml(card.title)}" required></label>
    <label><span>${escapeHtml(tt("tasks.submit.content"))}</span><textarea maxlength="2000" data-task-ai-field="description" data-task-ai-id="${escapeHtml(card.id)}">${escapeHtml(card.description)}</textarea></label>
    <div class="task-ai-card__grid">
      <label><span>${escapeHtml(tt("tasks.submit.visibility"))}</span><select data-task-ai-field="departmentId" data-task-ai-id="${escapeHtml(card.id)}">${renderOptions(departments, card.departmentId, helpers)}</select></label>
      <label><span>${escapeHtml(tt("tasks.submit.assignee"))}</span><select data-task-ai-field="assigneeId" data-task-ai-id="${escapeHtml(card.id)}" required>${renderOptions(assignees, card.assigneeId, helpers)}</select></label>
      <label><span>${escapeHtml(tt("tasks.submit.expectedAt"))}</span><input type="date" data-task-ai-field="due" data-task-ai-id="${escapeHtml(card.id)}" value="${escapeHtml(card.due)}"></label>
      <label><span>${escapeHtml(tt("tasks.submit.priority"))}</span><select data-task-ai-field="priority" data-task-ai-id="${escapeHtml(card.id)}">${renderOptions(priorities, card.priority, helpers)}</select></label>
    </div>
  </article>`;
}

export function renderTaskAiDialog({ state, context, helpers }) {
  if (!state.aiOpen) return "";
  const { escapeHtml, lang } = helpers;
  const tt = (key, values) => taskT(lang, key, values);
  const draft = state.ai;
  const busy = draft.parseBusy || draft.publishBusy;
  const inputStage = draft.stage !== "preview";
  const error = draft.errorKey
    ? `<p class="task-ai-error" role="alert">${escapeHtml(tt(draft.errorKey, draft.errorValues))}</p>`
    : "";
  const body = inputStage
    ? `<p>${escapeHtml(tt("tasks.ai.description"))}</p>
      <label class="task-ai-input"><span>${escapeHtml(tt("tasks.ai.source"))}</span><textarea data-task-ai-text maxlength="20000" placeholder="${escapeHtml(tt("tasks.ai.placeholder"))}"${busy ? " disabled" : ""}>${escapeHtml(draft.text)}</textarea></label>`
    : `<p class="task-ai-preview-summary">${escapeHtml(tt("tasks.ai.previewSummary", { count: draft.cards.length }))}</p>
      <fieldset class="task-ai-list"${busy ? " disabled" : ""}>${draft.cards.map((card, index) => renderPreviewCard(card, index, context, helpers)).join("")}</fieldset>`;
  return `<div class="task-ai-overlay" data-task-ai-overlay>
    <form class="task-ai-dialog" data-task-ai-form="${inputStage ? "parse" : "publish"}" role="dialog" aria-modal="true" aria-label="${escapeHtml(tt("tasks.ai.title"))}">
      <header><h2>${escapeHtml(tt("tasks.ai.title"))}</h2><button type="button" data-task-ai-close aria-label="${escapeHtml(tt("tasks.ai.close"))}"${busy ? " disabled" : ""}>×</button></header>
      <div class="task-ai-body">${body}${error}</div>
      <footer>
        ${inputStage ? "" : `<button type="button" data-task-ai-back${busy ? " disabled" : ""}>${escapeHtml(tt("tasks.ai.back"))}</button>`}
        <button type="button" data-task-ai-close${busy ? " disabled" : ""}>${escapeHtml(tt("tasks.ai.cancel"))}</button>
        <button type="submit"${busy || (inputStage ? !draft.text.trim() : !taskAiCardsReady(draft.cards, context)) ? " disabled" : ""}>${escapeHtml(tt(inputStage ? (draft.parseBusy ? "tasks.ai.parsing" : "tasks.ai.parse") : (draft.publishBusy ? "tasks.ai.publishing" : "tasks.ai.publish")))}</button>
      </footer>
    </form>
  </div>`;
}
