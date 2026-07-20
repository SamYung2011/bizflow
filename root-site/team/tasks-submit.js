import { taskT } from "./tasks-i18n.js";
import { displayDateInput } from "../components/date-value.js";

export function availableTaskDepartments(state, data) {
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  // Match team/src/components/EditTaskModal.jsx:160-195: admins see all; staff see own plus the task's current department.
  if (state.currentUser?.isSuperAdmin || state.currentUser?.isAdminOfActive) return departments;
  const currentUserId = String(state.currentUser?.id || "");
  const originalDepartmentId = String(state.submitOriginalDepartmentId || "");
  return departments.filter((department) => department.id === originalDepartmentId ||
    (currentUserId && (department.memberIds ?? []).includes(currentUserId)));
}

export function taskMembersForDepartment(data, departmentId) {
  const members = (Array.isArray(data?.members) ? data.members : []).filter((member) => member.dept !== "all");
  if (!departmentId) return members;
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  const department = departments.find((item) => item.id === departmentId);
  if (!department) return [];
  const memberIds = new Set(department.memberIds ?? []);
  return members.filter((member) => memberIds.has(member.id));
}

function assignableTaskMembers(state, data, departmentId) {
  return taskMembersForDepartment(data, departmentId).filter((member) =>
    state.submitCanAssignOthers || member.id === state.currentUser.id);
}

function renderMemberEditor({ state, data, departmentId, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => taskT(lang, key);
  const allMembers = (Array.isArray(data?.members) ? data.members : []).filter((member) => member.dept !== "all");
  const eligibleMembers = taskMembersForDepartment(data, departmentId);
  const selectedIds = [...new Set(Array.isArray(state.submitDraft.memberIds) ? state.submitDraft.memberIds : [])];
  const selectedIdSet = new Set(selectedIds);
  const owner = eligibleMembers.find((member) => member.name === state.submitDraft.owner);
  const selectedMembers = selectedIds
    .map((id) => allMembers.find((member) => member.id === id))
    .filter(Boolean);
  const candidates = state.submitCanAssignOthers
    ? eligibleMembers.filter((member) => member.id !== owner?.id && !selectedIdSet.has(member.id))
    : [];
  const query = String(state.submitDraft.memberQuery || "");
  const normalizedQuery = query.replace(/^@/, "").trim().toLocaleLowerCase();
  const menuOpen = Boolean(state.submitDraft.memberMenuOpen) && !state.writeBusy;
  const disabled = !state.submitCanAssignOthers || state.writeBusy;
  const chips = selectedMembers.map((member) => `<span class="form-task-submit__member-chip">
    <span>@${escapeHtml(member.name)}</span>
    <button type="button" data-task-member-remove="${escapeHtml(member.id)}" aria-label="${escapeHtml(taskT(lang, "tasks.submit.removeMember", { name: member.name }))}"${disabled ? " disabled" : ""}>×</button>
  </span>`).join("");
  let visibleCandidateCount = 0;
  const options = candidates.map((member) => {
    const visible = !normalizedQuery || member.name.toLocaleLowerCase().includes(normalizedQuery);
    if (visible) visibleCandidateCount += 1;
    return `<button type="button" role="option" data-task-member-option="${escapeHtml(member.id)}" data-task-member-name="${escapeHtml(member.name)}"${visible ? "" : " hidden"}>
    <span>${escapeHtml(member.name)}</span>
    ${member.role ? `<small>${escapeHtml(member.role)}</small>` : ""}
  </button>`;
  }).join("");

  return `<div class="form-task-submit__member-editor" data-task-member-editor>
    <div class="form-task-submit__member-control">
      ${chips}
      <input type="text" data-task-member-query value="${escapeHtml(query)}" placeholder="${escapeHtml(tt("tasks.submit.membersPlaceholder"))}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="task-submit-member-menu" aria-expanded="${menuOpen}"${disabled ? " disabled" : ""}>
    </div>
    <div id="task-submit-member-menu" class="form-task-submit__member-menu" data-task-member-menu role="listbox" aria-label="${escapeHtml(tt("tasks.submit.memberCandidates"))}"${menuOpen ? "" : " hidden"}>
      ${options}
      <p data-task-member-empty${visibleCandidateCount ? " hidden" : ""}>${escapeHtml(tt("tasks.submit.noMemberMatches"))}</p>
    </div>
  </div>`;
}

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
  const departmentId = String(draft.departmentId || "");
  const departments = availableTaskDepartments(state, data);
  const owners = assignableTaskMembers(state, data, departmentId);
  const departmentOptions = departments.map((department) => `<option value="${escapeHtml(department.id)}"${department.id === departmentId ? " selected" : ""}>${escapeHtml(department.name)}</option>`).join("");
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
          <textarea name="content" placeholder="${escapeHtml(tt("tasks.submit.contentPlaceholder"))}"${busy}>${escapeHtml(draft.content)}</textarea>
        </label>
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.priority"))}</span>
          ${renderSegment({ name: "priority", selected: draft.priority, disabled: state.writeBusy, values: ["high", "medium", "low"].map((value) => ({ value, key: `tasks.priority.short.${value}` })), helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.visibility"))}</span>
          <select name="departmentId"${busy}>
            <option value="">${escapeHtml(tt("tasks.detail.visibility.team"))}</option>
            ${departmentOptions}
          </select>
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
        <div class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.members"))}</span>
          ${renderMemberEditor({ state, data, departmentId, helpers })}
        </div>
        <label class="form-task-submit__field">
          <span>${escapeHtml(tt("tasks.submit.expectedAt"))}</span>
          <button type="button" class="date-panel-trigger" data-task-due-trigger aria-haspopup="dialog" aria-expanded="false"${busy}>${helpers.icon("icon-task-calendar", "icon")}<span class="date-panel-trigger__value">${escapeHtml(displayDateInput(draft.due) || tt("tasks.submit.selectDue"))}</span></button>
          <input type="hidden" name="due" value="${escapeHtml(draft.due)}">
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
