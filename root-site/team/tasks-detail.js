import { taskT } from "./tasks-i18n.js";
import { canDeleteTaskForUser, canEditSubtaskTitle, canManageTaskSubtasks, isTaskCreator, isWaitingApproval, taskAssignee, taskSubtaskProgress } from "./tasks-model.js";
import { taskFeedbackMentionCandidates } from "./tasks-mentions.js";

function initials(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase();
}

function safeAttachmentUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function isImageAttachment(attachment, url) {
  const type = String(attachment?.type || "").toLocaleLowerCase();
  if (type.startsWith("image/")) return true;
  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url);
}

function renderAttachmentLinks(attachments, helpers) {
  const { escapeHtml, lang } = helpers;
  return (attachments ?? []).map((attachment) => {
    const url = safeAttachmentUrl(attachment?.url);
    if (!url) return "";
    const name = String(attachment?.name || taskT(lang, "tasks.detail.attachments"));
    if (isImageAttachment(attachment, url)) {
      return `<button type="button" class="task-detail__attachment-preview" data-task-attachment-preview="${escapeHtml(url)}" data-task-attachment-name="${escapeHtml(name)}" aria-label="${escapeHtml(taskT(lang, "tasks.detail.previewAttachment", { name }))}"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"><span>${escapeHtml(name)}</span></button>`;
    }
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(name)}">${escapeHtml(name)}</a>`;
  }).filter(Boolean).join("");
}

function renderAttachmentViewer(state, helpers) {
  if (!state.attachmentPreview?.url) return "";
  const { escapeHtml, lang } = helpers;
  const name = state.attachmentPreview.name || taskT(lang, "tasks.detail.attachments");
  return `<div class="task-attachment-viewer" data-task-attachment-viewer role="dialog" aria-modal="true" aria-label="${escapeHtml(name)}">
    <div class="task-attachment-viewer__dialog">
      <button type="button" data-task-attachment-viewer-close aria-label="${escapeHtml(taskT(lang, "tasks.detail.closeAttachmentPreview"))}">×</button>
      <img src="${escapeHtml(state.attachmentPreview.url)}" alt="${escapeHtml(name)}">
      <p>${escapeHtml(name)}</p>
    </div>
  </div>`;
}

function renderFeedbackEntry(entry, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const message = entry.message || (entry.messageKey ? taskT(lang, entry.messageKey) : "");
  const editing = entry.own && state.feedbackEditingId === entry.id;
  const menuOpen = state.feedbackMenuId === entry.id;
  const attachmentLinks = renderAttachmentLinks(entry.attachments, helpers);
  const attachment = attachmentLinks
    ? `<div class="task-detail__attachment-links">${attachmentLinks}</div>`
    : entry.attachmentCount > 0
      ? `<span class="task-detail__attachment-count">${escapeHtml(`${taskT(lang, "tasks.detail.attachments")} ${entry.attachmentCount}`)}</span>`
    : "";
  const body = `<div class="chat-bubble__content">
    <header class="chat-bubble__meta">
      <strong title="${escapeHtml(entry.author)}">${escapeHtml(entry.author)}</strong>
      <time>${escapeHtml(entry.timestamp)}</time>
      ${entry.own ? `<span class="chat-bubble__menu-wrap" data-task-feedback-menu-wrap="${escapeHtml(entry.id)}">
        <button type="button" class="chat-bubble__menu" data-task-feedback-menu-open="${escapeHtml(entry.id)}" aria-label="${escapeHtml(taskT(lang, "tasks.detail.feedbackMenu"))}" aria-haspopup="menu" aria-expanded="${menuOpen}"><span></span><span></span><span></span></button>
        ${menuOpen ? `<span class="chat-bubble__menu-popover" data-task-feedback-menu-popover role="menu">
          ${message.trim() ? `<button type="button" role="menuitem" data-task-feedback-edit-start="${escapeHtml(entry.id)}">${escapeHtml(taskT(lang, "tasks.detail.feedbackEdit"))}</button>` : ""}
          <button type="button" class="is-danger" role="menuitem" data-task-feedback-delete="${escapeHtml(entry.id)}">${escapeHtml(taskT(lang, "tasks.detail.feedbackDelete"))}</button>
        </span>` : ""}
      </span>` : ""}
    </header>
    ${editing ? `<form class="task-detail__feedback-edit" data-task-feedback-edit-form="${escapeHtml(entry.id)}">
      <textarea name="feedbackEdit" required aria-label="${escapeHtml(taskT(lang, "tasks.detail.feedbackEdit"))}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(state.feedbackEditDraft)}</textarea>
      ${state.feedbackEditError ? `<p role="alert">${escapeHtml(taskT(lang, state.feedbackEditError))}</p>` : ""}
      <footer><button type="button" data-task-feedback-edit-cancel="${escapeHtml(entry.id)}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(taskT(lang, "tasks.detail.feedbackCancel"))}</button><button type="submit"${state.writeBusy ? " disabled" : ""}>${escapeHtml(taskT(lang, "tasks.detail.feedbackSave"))}</button></footer>
    </form>` : message ? `<p class="chat-bubble__body">${escapeHtml(message)}</p>` : ""}
    ${attachment}
  </div>`;
  const avatar = `<span class="avatar--initial chat-bubble__avatar" aria-hidden="true">${escapeHtml(initials(entry.author))}</span>`;
  return `<article class="chat-bubble${entry.own ? " chat-bubble--own" : ""}">
    ${entry.own ? `${body}${avatar}` : `${avatar}${body}`}
  </article>`;
}

function renderSubtasks(task, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const department = task.departmentId
    ? (state.departments ?? []).find((item) => item.id === task.departmentId)
    : null;
  const departmentMemberIds = department ? new Set(department.memberIds ?? []) : null;
  const members = state.members.filter((member) => member.dept !== "all" &&
    (!task.departmentId || departmentMemberIds?.has(member.id)));
  const progress = taskSubtaskProgress(task);
  const canManage = canManageTaskSubtasks(task, state.currentUser);
  const addDraft = state.subtaskAddDraft ?? { title: "", assigneeId: "" };
  const rows = (task.subtasks ?? []).map((subtask) => {
    const assigneeNames = (subtask.assignees ?? []).map((assignee) => assignee.name).join(", ") || "—";
    const aggregateCompleted = subtask.done === true || subtask.status === "completed";
    const ownAssignee = taskAssignee(subtask, state.currentUser);
    const completed = state.liveTaskWrites && ownAssignee ? ownAssignee.completedAt != null : aggregateCompleted;
    const canToggle = state.liveTaskWrites ? Boolean(ownAssignee) : !state.liveReadOnly;
    const disabled = !canToggle || state.writeBusy;
    const toggleTitle = canToggle ? subtask.title : tt("tasks.detail.subtaskOnlyAssignee");
    const canEditTitle = canEditSubtaskTitle(subtask, state.currentUser, state.permissions);
    const editing = canEditTitle && state.subtaskEditingId === subtask.id;
    const title = editing
      ? `<form class="task-detail__subtask-edit" data-task-subtask-edit-form="${escapeHtml(subtask.id)}">
          <input name="subtaskTitle" required value="${escapeHtml(state.subtaskEditDraft ?? subtask.title)}" aria-label="${escapeHtml(tt("tasks.detail.subtaskTitle"))}">
          <button type="submit"${state.writeBusy ? " disabled" : ""}>${escapeHtml(tt("tasks.detail.saveSubtask"))}</button>
          <button type="button" data-task-subtask-edit-cancel="${escapeHtml(subtask.id)}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(tt("tasks.detail.cancelSubtask"))}</button>
        </form>`
      : `<span class="${aggregateCompleted ? "is-completed" : ""}" title="${escapeHtml(subtask.title)}">${escapeHtml(subtask.title)}</span>`;
    const actions = !editing && (canEditTitle || canManage) ? `<span class="task-detail__subtask-actions">
      ${canEditTitle ? `<button type="button" data-task-subtask-edit="${escapeHtml(subtask.id)}" aria-label="${escapeHtml(tt("tasks.detail.editSubtask"))}" title="${escapeHtml(tt("tasks.detail.editSubtask"))}"${state.writeBusy ? " disabled" : ""}>${escapeHtml(tt("tasks.detail.editSubtask"))}</button>` : ""}
      ${canManage ? `<button type="button" data-task-subtask-delete="${escapeHtml(subtask.id)}" aria-label="${escapeHtml(tt("tasks.detail.deleteSubtask"))}" title="${escapeHtml(tt("tasks.detail.deleteSubtask"))}"${state.writeBusy ? " disabled" : ""}>×</button>` : ""}
    </span>` : "";
    return `<div class="task-detail__subtask" data-task-subtask="${escapeHtml(subtask.id)}">
      <input type="checkbox" data-task-subtask-toggle="${escapeHtml(subtask.id)}"${completed ? " checked" : ""} aria-label="${escapeHtml(toggleTitle)}" title="${escapeHtml(toggleTitle)}"${disabled ? " disabled" : ""}>
      ${title}
      <small title="${escapeHtml(assigneeNames)}">${escapeHtml(assigneeNames)}</small>
      ${actions}
    </div>`;
  }).join("");
  return `<section class="task-detail__subtasks"><h3>${escapeHtml(tt("tasks.detail.subtasks"))}<span>${progress.done}/${progress.total}</span></h3>
    <div>${rows}</div>
    ${canManage ? `<form data-task-subtask-form data-parent-task-id="${escapeHtml(task.id)}">
      <input name="title" required value="${escapeHtml(addDraft.title)}" placeholder="${escapeHtml(tt("tasks.detail.subtaskTitle"))}" aria-label="${escapeHtml(tt("tasks.detail.subtaskTitle"))}"${state.writeBusy ? " disabled" : ""}>
      <select name="assigneeId" required aria-label="${escapeHtml(tt("tasks.detail.subtaskAssignee"))}"${state.writeBusy ? " disabled" : ""}><option value="">${escapeHtml(tt("tasks.detail.subtaskAssignee"))}</option>${members.map((member) => `<option value="${escapeHtml(member.id)}"${member.id === addDraft.assigneeId ? " selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select>
      <button type="submit"${state.writeBusy ? " disabled" : ""}>+ ${escapeHtml(tt("tasks.detail.addSubtask"))}</button>
    </form>` : ""}
  </section>`;
}

function renderApproval(task, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key, values) => taskT(lang, key, values);
  const waiting = isWaitingApproval(task);
  const isCreator = isTaskCreator(task, state.currentUser);
  const ownAssignee = (task.assignees ?? []).find((assignee) => assignee.employeeId
    ? assignee.employeeId === state.currentUser.id
    : String(assignee.name).toLocaleLowerCase() === String(state.currentUser.name).toLocaleLowerCase());
  const isAssignee = Boolean(ownAssignee);
  const approved = task.approvedAt ? `<div class="task-detail__approved">${icon("icon-task-done", "icon")}<span><strong>${escapeHtml(tt("tasks.detail.approved"))}</strong>${escapeHtml(tt("tasks.detail.approvedBy", { name: task.approvedBy || "—", time: task.approvedAt }))}</span></div>` : "";
  const canApprove = isCreator || state.permissions.canValidate;
  const approvalDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites);
  const pending = waiting ? `<div class="task-detail__approval-banner">${icon("icon-task-alert", "icon")}<span>${escapeHtml(tt("tasks.detail.approvalPending"))}</span>${canApprove ? `<button type="button" data-task-approve="${escapeHtml(task.id)}"${approvalDisabled ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(tt("tasks.detail.approve"))}</button>` : ""}</div>` : "";
  const abandoned = ownAssignee?.abandonedAt != null || ((task.assignees?.length ?? 0) === 1 && task.status === "abandoned");
  const showParticipation = isAssignee && (state.liveTaskWrites || task.status !== "abandoned");
  const participationDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites);
  const abandon = showParticipation ? `<button type="button" class="task-detail__abandon" data-task-abandon="${escapeHtml(task.id)}"${participationDisabled ? " disabled" : ""}>${escapeHtml(tt(abandoned ? "tasks.detail.resume" : "tasks.detail.abandon"))}</button>` : "";
  const canDelete = canDeleteTaskForUser(task, state.currentUser, state.permissions);
  const deleteTask = canDelete ? `<button type="button" class="task-detail__delete" data-task-action-delete="${escapeHtml(task.id)}"${participationDisabled ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(tt("tasks.action.delete"))}</button>` : "";
  const actions = abandon || deleteTask ? `<div class="task-detail__terminal-actions">${abandon}${deleteTask}</div>` : "";
  return `${pending}${approved}${actions}`;
}

function renderDetailContent(task, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const content = task.content || (task.contentKey ? tt(task.contentKey) : tt("tasks.detail.emptyValue"));
  const priorityKeys = ["high", "medium", "low"];
  return `<section class="task-detail__content" data-task-detail-panel="content">
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.name"))}</span>
      <span class="task-detail__control" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
    </label>
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.content"))}</span>
      <span class="task-detail__control task-detail__control--multiline">${escapeHtml(content)}</span>
    </label>
    <div class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.status"))}</span>
      <span class="task-detail__status task-detail__status--${escapeHtml(task.status)}">${escapeHtml(tt(`tasks.detail.status.${task.status}`))}</span>
    </div>
    <div class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.priority"))}</span>
      <div class="task-detail__priority">${priorityKeys.map((key) => `<span class="${key === task.priority ? "task-detail__priority--active" : ""}">${escapeHtml(tt(`tasks.priority.short.${key}`))}</span>`).join("")}</div>
    </div>
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.visibility"))}</span>
      <span class="task-detail__control task-detail__control--select">${escapeHtml(task.visibility === "department" && task.visibilityDepartment
        ? `${tt("tasks.detail.visibility.department")}: ${task.visibilityDepartment}`
        : tt(`tasks.detail.visibility.${task.visibility}`))}</span>
    </label>
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.assignee"))}</span>
      <span class="task-detail__control">${escapeHtml(task.owner)}</span>
    </label>
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.expectedAt"))}</span>
      <span class="task-detail__control">${escapeHtml(task.due || tt("tasks.detail.emptyValue"))}</span>
    </label>
    <label class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.members"))}</span>
      <span class="task-detail__control task-detail__assignees">${(task.assignees ?? []).length ? task.assignees.map((assignee) => `<span class="${assignee.completedAt ? "is-completed" : ""}">${assignee.completedAt ? "✓ " : ""}${escapeHtml(assignee.name)}</span>`).join("") : escapeHtml(tt("tasks.detail.emptyValue"))}</span>
    </label>
    ${task.attachmentCount > 0 ? `<div class="task-detail__field">
      <span>${escapeHtml(tt("tasks.detail.attachments"))}</span>
      ${task.attachments?.length
        ? `<span class="task-detail__control task-detail__attachment-links">${renderAttachmentLinks(task.attachments, helpers)}</span>`
        : `<span class="task-detail__control">${escapeHtml(String(task.attachmentCount))}</span>`}
    </div>` : ""}
    ${renderSubtasks(task, state, helpers)}
    ${renderApproval(task, state, helpers)}
  </section>`;
}

function renderTaskFeedback(task, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const attachments = state.feedbackDraft.attachments ?? [];
  const mentions = state.feedbackDraft.mentions ?? [];
  const selectedUserIds = new Set(mentions.map((mention) => mention.userId));
  const mentionCandidates = taskFeedbackMentionCandidates(state.members, state.currentUser)
    .filter((member) => !selectedUserIds.has(member.userId));
  const mentionMenu = state.feedbackDraft.mentionMenu ?? { open: false, query: "" };
  const mentionQuery = String(mentionMenu.query || "").toLocaleLowerCase();
  const visibleMentionCount = mentionCandidates.filter((member) => !mentionQuery || member.name.toLocaleLowerCase().includes(mentionQuery)).length;
  const writable = !state.liveReadOnly || state.liveTaskWrites;
  const disabled = !writable || state.writeBusy || Boolean(state.feedbackEditingId);
  return `<section class="task-detail__feedback" data-task-detail-panel="feedback" data-task-detail-sticky="feedback">
    <h3>${escapeHtml(tt("tasks.detail.feedbackTitle"))}</h3>
    <div class="task-detail__thread">${task.feedback.length
      ? task.feedback.map((entry) => renderFeedbackEntry(entry, state, helpers)).join("")
      : `<p class="team-kanban-empty">${escapeHtml(tt("tasks.detail.feedbackEmpty"))}</p>`}</div>
    <form class="task-detail__composer" data-task-feedback-form>
      <div class="task-detail__mention-editor" data-task-feedback-mention-editor>
        <textarea name="message" aria-label="${escapeHtml(tt("tasks.detail.feedbackPlaceholder"))}" placeholder="${escapeHtml(tt("tasks.detail.feedbackPlaceholder"))}" aria-autocomplete="list" aria-controls="task-feedback-mention-menu" aria-expanded="${mentionMenu.open === true}"${disabled ? " disabled" : ""}>${escapeHtml(state.feedbackDraft.message)}</textarea>
        <div id="task-feedback-mention-menu" class="task-detail__mention-popover" data-task-feedback-mention-menu role="listbox" aria-label="${escapeHtml(tt("tasks.detail.mentionCandidates"))}"${mentionMenu.open === true ? "" : " hidden"}>
          ${mentionCandidates.map((member) => {
            const visible = !mentionQuery || member.name.toLocaleLowerCase().includes(mentionQuery);
            return `<button type="button" role="option" aria-selected="false" data-task-feedback-mention-option="${escapeHtml(member.userId)}" data-task-feedback-mention-name="${escapeHtml(member.name)}"${visible ? "" : " hidden"}>${escapeHtml(member.name)}</button>`;
          }).join("")}
          <p data-task-feedback-mention-empty${visibleMentionCount ? " hidden" : ""}>${escapeHtml(tt("tasks.detail.mentionEmpty"))}</p>
        </div>
      </div>
      <input type="file" data-task-feedback-file multiple hidden${disabled ? " disabled" : ""}>
      ${mentions.length ? `<div class="task-detail__mention-drafts">${mentions.map((mention) => `<span class="task-detail__mention-chip"><span>@${escapeHtml(mention.name)}</span><button type="button" data-task-feedback-mention-remove="${escapeHtml(mention.userId)}" aria-label="${escapeHtml(taskT(lang, "tasks.detail.removeMention", { name: mention.name }))}"${disabled ? " disabled" : ""}>×</button></span>`).join("")}</div>` : ""}
      ${attachments.length ? `<div class="task-detail__attachment-drafts">${attachments.map((attachment, index) => `<span class="task-detail__attachment-chip"><span title="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</span><button type="button" data-task-feedback-attachment-remove="${index}" aria-label="${escapeHtml(`${tt("tasks.detail.removeAttachment")}: ${attachment.name}`)}"${disabled ? " disabled" : ""}>×</button></span>`).join("")}</div>` : ""}
      ${state.feedbackError ? `<p class="task-detail__feedback-error" role="alert">${escapeHtml(tt(state.feedbackError))}</p>` : ""}
      <footer>
        <button type="button" class="task-detail__attachment" data-task-feedback-attachment aria-label="${escapeHtml(tt("tasks.detail.addAttachment"))}"${disabled ? " disabled" : ""}>+ <span>${escapeHtml(tt("tasks.detail.attachments"))}</span></button>
        <button type="submit"${disabled ? " disabled" : ""}>${escapeHtml(tt("tasks.detail.send"))}</button>
      </footer>
    </form>
  </section>`;
}

export function renderTaskDetail({ state, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const task = state.tasks.find((item) => item.id === state.selectedTaskId);
  if (!state.detailOpen || !task) return "";
  const tt = (key) => taskT(lang, key);
  return `<div class="team-task-detail-view">
    <button type="button" class="task-detail-back" data-task-detail-close>${icon("icon-arrow-left", "icon")}<span>${escapeHtml(tt("tasks.detail.back"))}</span></button>
    <article class="tp-component task-detail task-detail--${escapeHtml(state.detailTab)}" aria-label="${escapeHtml(task.title)}">
      <header class="task-detail__head">
        <h2 title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</h2>
        <div class="task-detail__head-actions">
          ${state.permissions.canCreate ? `<button type="button" class="task-detail__copy" data-task-copy="${escapeHtml(task.id)}"${state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites) ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(tt("tasks.detail.copy"))}</button>` : ""}
          <button type="button" class="task-detail__close" data-task-detail-close aria-label="${escapeHtml(tt("tasks.detail.close"))}"></button>
        </div>
      </header>
      <div class="task-detail__tabs" role="tablist">
        <button type="button" class="${state.detailTab === "content" ? "task-detail__tab--active" : ""}" data-task-detail-tab="content" role="tab" aria-selected="${state.detailTab === "content"}">${escapeHtml(tt("tasks.detail.contentTab"))}</button>
        <button type="button" class="${state.detailTab === "feedback" ? "task-detail__tab--active" : ""}" data-task-detail-tab="feedback" role="tab" aria-selected="${state.detailTab === "feedback"}">${escapeHtml(tt("tasks.detail.feedbackTab"))}</button>
      </div>
      <div class="task-detail__body task-detail__body--${escapeHtml(state.detailTab)}">
        ${renderDetailContent(task, state, helpers)}
        ${renderTaskFeedback(task, state, helpers)}
      </div>
    </article>
    ${renderAttachmentViewer(state, helpers)}
  </div>`;
}
