import { taskT } from "./tasks-i18n.js";

function renderSegment({ name, values, selected, helpers }) {
  const { escapeHtml, lang } = helpers;
  return `<div class="form-task-submit__segment">${values.map(({ value, key }) => `<label class="${value === selected ? "form-task-submit__segment--active" : ""}">
    <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${value === selected ? " checked" : ""}>
    <span>${escapeHtml(taskT(lang, key))}</span>
  </label>`).join("")}</div>`;
}

export function renderTaskSubmitDialog({ state, data, helpers }) {
  if (!state.submitOpen) return "";
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const draft = state.submitDraft;
  const attachments = draft.attachments ?? [];
  const owners = data.members.filter((member) => member.dept !== "all");
  const ownerOptions = owners.map((member) => `<option value="${escapeHtml(member.name)}"${member.name === draft.owner ? " selected" : ""}>${escapeHtml(member.name)}</option>`).join("");
  return `<div class="task-submit-overlay task-submit-overlay--open" data-task-submit-overlay>
    <form class="tp-component form-task-submit" data-task-submit-form role="dialog" aria-modal="true" aria-label="${escapeHtml(tt("tasks.submit.title"))}">
      <header class="form-task-submit__head">
        <h2>${escapeHtml(tt("tasks.submit.title"))}</h2>
        <button type="button" class="form-task-submit__close" data-task-submit-close aria-label="${escapeHtml(tt("tasks.submit.close"))}"></button>
      </header>
      <div class="form-task-submit__body">
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.name"))}</span>
          <input name="title" value="${escapeHtml(draft.title)}" required>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.content"))}</span>
          <textarea name="content" required>${escapeHtml(draft.content)}</textarea>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.priority"))}</span>
          ${renderSegment({ name: "priority", selected: draft.priority, values: ["high", "medium", "low"].map((value) => ({ value, key: `tasks.priority.short.${value}` })), helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.visibility"))}</span>
          <select name="visibility"><option value="team">${escapeHtml(tt("tasks.detail.visibility.team"))}</option></select>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.assignee"))}</span>
          <select name="owner" required${state.permissions.canAssignOthers ? "" : " disabled"}>
            <option value="">${escapeHtml(tt("tasks.submit.assigneePlaceholder"))}</option>
            ${ownerOptions}
          </select>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.review"))}</span>
          ${renderSegment({ name: "requiresReview", selected: draft.requiresReview, values: [
            { value: "no", key: "tasks.submit.noReview" },
            { value: "yes", key: "tasks.submit.requiresReview" }
          ], helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.members"))}</span>
          <input name="members" value="${escapeHtml(draft.members)}" placeholder="${escapeHtml(tt("tasks.submit.membersPlaceholder"))}"${state.permissions.canAssignOthers ? "" : " disabled"}>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.expectedAt"))}</span>
          <input type="date" name="due" value="${escapeHtml(draft.due)}" required>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.attachments"))}</span>
          <input type="file" data-task-submit-file multiple hidden>
          ${attachments.length ? `<div class="form-task-submit__attachment-list" data-task-submit-attachment-list>${attachments.map((file) => `<span class="form-task-submit__attachment-chip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`).join("")}</div>` : ""}
          <button type="button" class="form-task-submit__attachment" data-task-submit-attachment aria-label="${escapeHtml(tt("tasks.submit.addAttachment"))}"${state.liveReadOnly ? " disabled" : ""}>+</button>
        </div>
      </div>
      <footer class="form-task-submit__footer">
        <button type="button" class="form-task-submit__button form-task-submit__button--cancel" data-task-submit-close>${escapeHtml(tt("tasks.submit.cancel"))}</button>
        <button type="submit" class="form-task-submit__button form-task-submit__button--confirm"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("tasks.submit.confirm"))}</button>
      </footer>
    </form>
  </div>`;
}
