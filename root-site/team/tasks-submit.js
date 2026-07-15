import { taskT } from "./tasks-i18n.js";

function renderSegment({ name, values, selected, disabled, helpers }) {
  const { escapeHtml, lang } = helpers;
  return `<div class="form-task-submit__segment">${values.map(({ value, key }) => `<label class="${value === selected ? "form-task-submit__segment--active" : ""}">
    <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${value === selected ? " checked" : ""}${disabled ? " disabled" : ""}>
    <span>${escapeHtml(taskT(lang, key))}</span>
  </label>`).join("")}</div>`;
}

export function renderTaskSubmitDialog({ state, data, helpers }) {
  if (!state.submitOpen) return "";
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const draft = state.submitDraft;
  const attachments = draft.attachments ?? [];
  const owners = data.members.filter((member) => member.dept !== "all" &&
    (state.submitCanAssignOthers || member.id === state.currentUser.id));
  const ownerOptions = owners.map((member) => `<option value="${escapeHtml(member.name)}"${member.name === draft.owner ? " selected" : ""}>${escapeHtml(member.name)}</option>`).join("");
  const busy = state.writeBusy ? " disabled" : "";
  const writable = !state.liveReadOnly || state.liveTaskWrites;
  return `<div class="task-submit-overlay task-submit-overlay--open" data-task-submit-overlay>
    <form class="tp-component form-task-submit" data-task-submit-form role="dialog" aria-modal="true" aria-label="${escapeHtml(tt(state.submitMode === "edit" ? "tasks.submit.editTitle" : "tasks.submit.title"))}">
      <header class="form-task-submit__head">
        <h2>${escapeHtml(tt(state.submitMode === "edit" ? "tasks.submit.editTitle" : "tasks.submit.title"))}</h2>
        <button type="button" class="form-task-submit__close" data-task-submit-close aria-label="${escapeHtml(tt("tasks.submit.close"))}"${busy}></button>
      </header>
      <div class="form-task-submit__body">
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.name"))}</span>
          <input name="title" value="${escapeHtml(draft.title)}" required${busy}>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.content"))}</span>
          <textarea name="content" required${busy}>${escapeHtml(draft.content)}</textarea>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.priority"))}</span>
          ${renderSegment({ name: "priority", selected: draft.priority, disabled: state.writeBusy, values: ["high", "medium", "low"].map((value) => ({ value, key: `tasks.priority.short.${value}` })), helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.visibility"))}</span>
          <select name="visibility"${busy}><option value="team">${escapeHtml(tt("tasks.detail.visibility.team"))}</option></select>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.assignee"))}</span>
          <select name="owner" required${state.submitCanAssignOthers ? busy : " disabled"}>
            <option value="">${escapeHtml(tt("tasks.submit.assigneePlaceholder"))}</option>
            ${ownerOptions}
          </select>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.review"))}</span>
          ${renderSegment({ name: "requiresReview", selected: draft.requiresReview, disabled: state.writeBusy, values: [
            { value: "no", key: "tasks.submit.noReview" },
            { value: "yes", key: "tasks.submit.requiresReview" }
          ], helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.members"))}</span>
          <input name="members" value="${escapeHtml(draft.members)}" placeholder="${escapeHtml(tt("tasks.submit.membersPlaceholder"))}"${state.submitCanAssignOthers ? busy : " disabled"}>
        </label>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.expectedAt"))}</span>
          <input type="date" name="due" value="${escapeHtml(draft.due)}" required${busy}>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.attachments"))}</span>
          <input type="file" data-task-submit-file multiple hidden${busy}>
          ${attachments.length ? `<div class="form-task-submit__attachment-list" data-task-submit-attachment-list>${attachments.map((file, index) => `<span class="form-task-submit__attachment-chip"><span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><button type="button" data-task-submit-attachment-remove="${index}" aria-label="${escapeHtml(`${tt("tasks.submit.removeAttachment")}: ${file.name}`)}"${!writable || state.writeBusy ? " disabled" : ""}>×</button></span>`).join("")}</div>` : ""}
          <button type="button" class="form-task-submit__attachment" data-task-submit-attachment aria-label="${escapeHtml(tt("tasks.submit.addAttachment"))}"${!writable || state.writeBusy ? " disabled" : ""}>+ <span>${escapeHtml(tt("tasks.submit.attachments"))}</span></button>
        </div>
        ${state.submitError ? `<p class="form-task-submit__error" role="alert">${escapeHtml(tt(state.submitError))}</p>` : ""}
      </div>
      <footer class="form-task-submit__footer">
        <button type="button" class="form-task-submit__button form-task-submit__button--cancel" data-task-submit-close${busy}>${escapeHtml(tt("tasks.submit.cancel"))}</button>
        <button type="submit" class="form-task-submit__button form-task-submit__button--confirm"${!writable || state.writeBusy ? " disabled" : ""}>${escapeHtml(tt(state.submitMode === "edit" ? "tasks.submit.save" : "tasks.submit.confirm"))}</button>
      </footer>
    </form>
  </div>`;
}
