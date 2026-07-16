import { taskT } from "./tasks-i18n.js";
import { isWaitingApproval } from "./tasks-model.js";

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

function renderFeedbackEntry(entry, helpers) {
  const { escapeHtml, lang } = helpers;
  const message = entry.message || taskT(lang, entry.messageKey);
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
      <button type="button" class="chat-bubble__menu" aria-label="${escapeHtml(taskT(lang, "tasks.detail.feedbackMenu"))}" tabindex="-1"><span></span><span></span><span></span></button>
    </header>
    ${message ? `<p class="chat-bubble__body">${escapeHtml(message)}</p>` : ""}
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
  const members = state.members.filter((member) => member.dept !== "all");
  const rows = (task.subtasks ?? []).map((subtask) => {
    const assigneeNames = (subtask.assignees ?? []).map((assignee) => assignee.name).join(", ") || "—";
    const completed = subtask.done === true || subtask.status === "completed";
    return `<div class="task-detail__subtask" data-task-subtask="${escapeHtml(subtask.id)}">
      <input type="checkbox" data-task-subtask-toggle="${escapeHtml(subtask.id)}"${completed ? " checked" : ""} aria-label="${escapeHtml(subtask.title)}"${state.liveReadOnly ? " disabled" : ""}>
      <span class="${completed ? "is-completed" : ""}" title="${escapeHtml(subtask.title)}">${escapeHtml(subtask.title)}</span>
      <small title="${escapeHtml(assigneeNames)}">${escapeHtml(assigneeNames)}</small>
      <button type="button" data-task-subtask-delete="${escapeHtml(subtask.id)}" aria-label="${escapeHtml(tt("tasks.detail.deleteSubtask"))}" title="${escapeHtml(tt("tasks.detail.deleteSubtask"))}"${state.liveReadOnly ? " disabled" : ""}>×</button>
    </div>`;
  }).join("");
  return `<section class="task-detail__subtasks"><h3>${escapeHtml(tt("tasks.detail.subtasks"))}<span>${task.subtasks?.length ?? 0}</span></h3>
    <div>${rows}</div>
    <form data-task-subtask-form data-parent-task-id="${escapeHtml(task.id)}">
      <input name="title" required placeholder="${escapeHtml(tt("tasks.detail.subtaskTitle"))}" aria-label="${escapeHtml(tt("tasks.detail.subtaskTitle"))}">
      <select name="assignee" required aria-label="${escapeHtml(tt("tasks.detail.subtaskAssignee"))}"><option value="">${escapeHtml(tt("tasks.detail.subtaskAssignee"))}</option>${members.map((member) => `<option value="${escapeHtml(member.name)}">${escapeHtml(member.name)}</option>`).join("")}</select>
      <button type="submit"${state.liveReadOnly ? " disabled" : ""}>+ ${escapeHtml(tt("tasks.detail.addSubtask"))}</button>
    </form>
  </section>`;
}

function renderApproval(task, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key, values) => taskT(lang, key, values);
  const waiting = isWaitingApproval(task);
  const isCreator = String(task.creator).toLocaleLowerCase() === String(state.currentUser.name).toLocaleLowerCase();
  const ownAssignee = (task.assignees ?? []).find((assignee) => assignee.employeeId
    ? assignee.employeeId === state.currentUser.id
    : String(assignee.name).toLocaleLowerCase() === String(state.currentUser.name).toLocaleLowerCase());
  const isAssignee = Boolean(ownAssignee);
  const approved = task.approvedAt ? `<div class="task-detail__approved">${icon("icon-task-done", "icon")}<span><strong>${escapeHtml(tt("tasks.detail.approved"))}</strong>${escapeHtml(tt("tasks.detail.approvedBy", { name: task.approvedBy || "—", time: task.approvedAt }))}</span></div>` : "";
  const canApprove = isCreator || state.permissions.canValidate;
  const pending = waiting ? `<div class="task-detail__approval-banner">${icon("icon-task-alert", "icon")}<span>${escapeHtml(tt("tasks.detail.approvalPending"))}</span>${canApprove ? `<button type="button" data-task-approve="${escapeHtml(task.id)}"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("tasks.detail.approve"))}</button>` : ""}</div>` : "";
  const abandoned = ownAssignee?.abandonedAt != null || ((task.assignees?.length ?? 0) === 1 && task.status === "abandoned");
  const showParticipation = isAssignee && (state.liveTaskWrites || task.status !== "abandoned");
  const participationDisabled = state.writeBusy || (state.liveReadOnly && !state.liveTaskWrites);
  const abandon = showParticipation ? `<button type="button" class="task-detail__abandon" data-task-abandon="${escapeHtml(task.id)}"${participationDisabled ? " disabled" : ""}>${escapeHtml(tt(abandoned ? "tasks.detail.resume" : "tasks.detail.abandon"))}</button>` : "";
  return `${pending}${approved}${abandon}`;
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
  const writable = !state.liveReadOnly || state.liveTaskWrites;
  const disabled = !writable || state.writeBusy;
  return `<section class="task-detail__feedback" data-task-detail-panel="feedback">
    <h3>${escapeHtml(tt("tasks.detail.feedbackTitle"))}</h3>
    <div class="task-detail__thread">${task.feedback.length
      ? task.feedback.map((entry) => renderFeedbackEntry(entry, helpers)).join("")
      : `<p class="team-kanban-empty">${escapeHtml(tt("tasks.detail.feedbackEmpty"))}</p>`}</div>
    <form class="task-detail__composer" data-task-feedback-form>
      <textarea name="message" aria-label="${escapeHtml(tt("tasks.detail.feedbackPlaceholder"))}" placeholder="${escapeHtml(tt("tasks.detail.feedbackPlaceholder"))}"${disabled ? " disabled" : ""}>${escapeHtml(state.feedbackDraft.message)}</textarea>
      <input type="file" data-task-feedback-file multiple hidden${disabled ? " disabled" : ""}>
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
