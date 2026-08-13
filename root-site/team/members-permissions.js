import { memberT } from "./members-i18n.js";
import { memberCanWrite, memberWriteAttrs } from "./members-write-access.js";

function renderRoleHeader(role, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const name = role.name || tt(role.nameKey);
  if (state.editingPermissionRoleId === role.id) {
    return `<label class="permission-matrix__role permission-matrix__role--editing">
      <input value="${escapeHtml(name)}" data-permission-role-name="${escapeHtml(role.id)}" aria-label="${escapeHtml(tt("members.permission.roleName"))}">
    </label>`;
  }

  const writeAttrs = memberWriteAttrs(state, "canManageRoles");
  const editButton = role.editable ? `<button type="button" class="permission-matrix__role-action permission-matrix__role-edit" data-permission-role-edit="${escapeHtml(role.id)}" aria-label="${escapeHtml(`${tt("members.permission.editRole")}: ${name}`)}"${writeAttrs}>
      ${icon("icon-edit-default", "icon")}
    </button>` : "";
  const removeButton = role.editable ? `<button type="button" class="permission-matrix__role-action permission-matrix__role-remove" data-permission-role-remove="${escapeHtml(role.id)}" aria-label="${escapeHtml(`${tt("members.permission.removeRole")}: ${name}`)}"${writeAttrs}></button>` : "";

  return `<div class="permission-matrix__role${role.editable ? " permission-matrix__role--editable" : ""}">
    ${editButton}
    <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
    ${removeButton}
  </div>`;
}

function renderPermissionToggle(row, role, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const granted = role.grants[row.id] === true;
  const name = role.name || memberT(lang, role.nameKey);
  const permission = memberT(lang, row.labelKey);
  const action = memberT(lang, granted ? "members.permission.disable" : "members.permission.enable");
  return `<button type="button" class="permission-matrix__toggle${granted ? " permission-matrix__toggle--on" : ""}" data-permission-toggle="${escapeHtml(row.id)}" data-permission-role="${escapeHtml(role.id)}" aria-pressed="${granted}" aria-label="${escapeHtml(`${action}: ${permission}, ${name}`)}"${role.editable && memberCanWrite(state, "canManageRoles") ? "" : ' disabled aria-disabled="true"'}></button>`;
}

export function renderMemberPermissions({ state, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const roles = state.permissions.roles;
  const rows = state.permissions.rows;
  const roleHeaders = roles.map((role) => renderRoleHeader(role, state, helpers)).join("");
  const permissionRows = rows.map((row) => `<div class="permission-matrix__label">${escapeHtml(tt(row.labelKey))}</div>
    ${roles.map((role) => renderPermissionToggle(row, role, state, helpers)).join("")}
    <span class="permission-matrix__row-end" aria-hidden="true"></span>`).join("");

  return `<div class="permission-matrix-scroll" data-scroll-restore="team.members.permissions" tabindex="0" aria-label="${escapeHtml(tt("members.permission.scrollLabel"))}">
    <section class="tp-component permission-matrix" style="--permission-role-count:${roles.length};--permission-row-count:${rows.length}" aria-label="${escapeHtml(tt("members.tab.permissions"))}">
      <span class="permission-matrix__corner" aria-hidden="true"></span>
      ${roleHeaders}
      <button type="button" class="permission-matrix__add-role" data-permission-role-add aria-label="${escapeHtml(tt("members.permission.addRole"))}"${memberWriteAttrs(state, "canManageRoles")}></button>
      <span class="permission-matrix__spacer" aria-hidden="true"></span>
      ${permissionRows}
    </section>
  </div>`;
}
