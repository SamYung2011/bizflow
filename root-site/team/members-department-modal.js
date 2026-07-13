import { memberT } from "./members-i18n.js";

export function renderDepartmentModal({ state, helpers }) {
  if (!state.departmentModalOpen || !state.departmentDraft) return "";
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const draft = state.departmentDraft;
  const managerOptions = `<option value=""${draft.managerId ? "" : " selected"}>—</option>` +
    state.members.map((member) => `<option value="${escapeHtml(member.id)}"${member.id === draft.managerId ? " selected" : ""}>${escapeHtml(member.name)}</option>`).join("");
  const memberRows = draft.memberIds.map((id) => {
    const member = state.members.find((item) => item.id === id);
    if (!member) return "";
    return `<div class="modal-add-dept__member">
      <span title="${escapeHtml(member.name)}">${escapeHtml(member.name)}</span>
      <button type="button" data-department-member-remove="${escapeHtml(id)}" aria-label="${escapeHtml(`${tt("members.department.removeMember")}: ${member.name}`)}"></button>
    </div>`;
  }).join("");

  return `<div class="members-modal-overlay members-modal-overlay--open" data-department-modal-overlay>
    <form class="tp-component modal-add-dept" data-department-modal-form role="dialog" aria-modal="true" aria-label="${escapeHtml(draft.name || tt("members.department.add"))}">
      <div class="modal-add-dept__title-row">
        <span class="icon-dept-shell modal-add-dept__icon">${icon(draft.icon, "icon icon-dept")}</span>
        <label class="modal-add-dept__name">
          <input name="name" value="${escapeHtml(draft.name)}" placeholder="${escapeHtml(tt("members.department.modalName"))}" aria-label="${escapeHtml(tt("members.department.modalName"))}" required>
          ${icon("icon-edit-default", "icon")}
        </label>
      </div>
      <label class="modal-add-dept__field">
        <span>${escapeHtml(tt("members.department.manager"))}</span>
        <select name="managerId">${managerOptions}</select>
      </label>
      <div class="modal-add-dept__members">
        <span class="modal-add-dept__label">${escapeHtml(tt("members.department.members"))}</span>
        <div class="modal-add-dept__member-list">${memberRows}</div>
        <button type="button" class="modal-add-dept__add-member" data-department-member-add aria-label="${escapeHtml(tt("members.department.addMember"))}">
          ${icon("icon-add-surface-add", "icon")}
        </button>
      </div>
      <footer class="modal-add-dept__footer">
        <button type="button" class="modal-add-dept__button modal-add-dept__button--back" data-department-modal-close>${escapeHtml(tt("members.department.back"))}</button>
        <button type="button" class="modal-add-dept__button modal-add-dept__button--delete" data-department-modal-delete>${escapeHtml(tt("members.department.delete"))}</button>
        <button type="submit" class="modal-add-dept__button modal-add-dept__button--confirm">${escapeHtml(tt("members.department.confirm"))}</button>
      </footer>
    </form>
  </div>`;
}
