import { memberT } from "./members-i18n.js";

function renderDepartmentCard(department, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const name = department.name || tt(department.nameKey);
  return `<article class="tp-component dept-card" data-department-card="${escapeHtml(department.id)}">
    <header class="dept-card__head">
      <span class="icon-dept-shell dept-card__icon">${icon(department.icon, "icon icon-dept")}</span>
      <div class="dept-card__identity">
        <h2 title="${escapeHtml(name)}">${escapeHtml(name)}</h2>
        <span>${escapeHtml(tt("members.department.manager"))}: ${escapeHtml(department.manager)}</span>
      </div>
    </header>
    <div class="dept-card__count">${escapeHtml(tt("members.department.memberCount"))}: <strong>${escapeHtml(department.memberIds.length)}</strong></div>
    <footer class="dept-card__actions">
      <button type="button" class="dept-card__button dept-card__button--view" data-department-view>${escapeHtml(tt("members.department.view"))}</button>
      <button type="button" class="dept-card__button dept-card__button--edit" data-department-edit${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.department.edit"))}</button>
      <button type="button" class="dept-card__button dept-card__button--remove" data-department-remove${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.department.remove"))}</button>
    </footer>
  </article>`;
}

export function renderMemberDepartments({ state, helpers }) {
  const { escapeHtml, icon, lang } = helpers;
  const addText = memberT(lang, "members.department.add");
  const cards = state.departments.map((department) => renderDepartmentCard(department, state, helpers)).join("");
  const empty = state.departments.length ? "" : `<div class="team-members-empty">${escapeHtml(memberT(lang, "members.department.empty"))}</div>`;
  return `<div class="team-members-departments">
    ${cards}
    ${empty}
    <button type="button" class="tp-component dept-card dept-card--add" data-department-add title="${escapeHtml(addText)}"${state.liveReadOnly ? " disabled" : ""}>
      ${icon("icon-add-line-add", "icon-add-line dept-card__add-icon")}
      <span>${escapeHtml(addText)}</span>
    </button>
  </div>`;
}
