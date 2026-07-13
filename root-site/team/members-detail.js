import { memberT } from "./members-i18n.js";

function renderTaskList(tasks, helpers) {
  const { escapeHtml, lang } = helpers;
  if (!tasks.length) return `<p class="member-panel__empty">${escapeHtml(memberT(lang, "members.detail.noTasks"))}</p>`;
  return `<div class="member-panel__tasks">${tasks.map((task) => {
    const title = task.title ?? memberT(lang, task.titleKey);
    return `<article class="member-panel__task">
      <span class="member-panel__task-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      <span class="member-panel__task-due">${escapeHtml(memberT(lang, "members.detail.due"))}: ${escapeHtml(task.due || "—")}</span>
    </article>`;
  }).join("")}</div>`;
}

export function renderMemberDetailDialog({ state, data, helpers }) {
  const { escapeHtml, lang } = helpers;
  const member = state.members.find((item) => item.id === state.selectedMemberId);
  if (!member || !state.memberDetailOpen) return "";
  const tt = (key) => memberT(lang, key);
  const departmentOptions = data.form.departments.map((department) => {
    const value = typeof department === "string" ? department : department.id;
    const label = typeof department === "string" ? tt(`members.dept.${department}`) : department.name;
    return `<option value="${escapeHtml(value)}"${value === member.dept ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const roleOptions = data.form.roles.map((role) => {
    const value = typeof role === "string" ? role : role.id;
    const label = typeof role === "string" ? tt(`members.role.${role}`) : role.name;
    return `<option value="${escapeHtml(value)}"${value === member.role ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const tabs = ["basic", "tasking", "tasked"];
  const tasks = member.tasks?.[state.memberDetailTab] ?? [];
  const body = state.memberDetailTab === "basic"
    ? `<div class="member-panel__form-grid">
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.position"))}</span>
          <input name="position" value="${escapeHtml(member.position || "")}"${state.liveReadOnly ? " disabled" : ""}>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.email"))}</span>
          <input name="email" type="email" value="${escapeHtml(member.email || "")}"${state.liveReadOnly ? " disabled" : ""}>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.phone"))}</span>
          <input name="phone" value="${escapeHtml(member.phone || "")}"${state.liveReadOnly ? " disabled" : ""}>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.department"))}</span>
          <select name="dept"${state.liveReadOnly ? " disabled" : ""}>${departmentOptions}</select>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.permission"))}</span>
          <select name="role"${state.liveReadOnly ? " disabled" : ""}>${roleOptions}</select>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.joinedAt"))}</span>
          <input name="joinedAt" value="${escapeHtml(member.joinedAt || "")}"${state.liveReadOnly ? " disabled" : ""}>
        </label>
        <label class="member-panel__field">
          <span>${escapeHtml(tt("members.detail.commission"))}</span>
          <input name="commission" value="${escapeHtml(member.commission === "none" ? tt("members.detail.none") : member.commission || "—")}"${state.liveReadOnly ? " disabled" : ""}>
        </label>
      </div>`
    : renderTaskList(tasks, helpers);

  return `<div class="members-modal-overlay members-modal-overlay--open" data-member-detail-overlay>
    <section class="tp-component member-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(member.name)}">
      <header class="member-panel__head">
        <span class="avatar--initial member-panel__avatar" aria-hidden="true">${escapeHtml(member.name.trim().charAt(0).toUpperCase() || "?")}</span>
        <div class="member-panel__identity">
          <h2 title="${escapeHtml(member.name)}">${escapeHtml(member.name)}</h2>
          <div class="member-panel__chips">
            <span title="${escapeHtml(member.departmentName ?? tt(`members.dept.${member.dept}`))}">${escapeHtml(member.departmentName ?? tt(`members.dept.${member.dept}`))}</span>
            <span title="${escapeHtml(member.roleName ?? tt(`members.role.${member.role}`))}">${escapeHtml(member.roleName ?? tt(`members.role.${member.role}`))}</span>
          </div>
        </div>
        <button type="button" class="member-panel__close" data-member-detail-close aria-label="${escapeHtml(tt("members.detail.close"))}"></button>
      </header>
      <form class="member-panel__content" data-member-detail-form>
        <div class="member-panel__tabs" role="tablist">
          ${tabs.map((tab) => {
            const active = tab === state.memberDetailTab;
            const count = tab === "basic" ? "" : ` (${member.tasks?.[tab]?.length ?? 0})`;
            return `<button type="button" class="tab-chip${active ? " tab-chip--active" : ""}" data-member-detail-tab="${tab}" role="tab" aria-selected="${active}">${escapeHtml(tt(`members.detail.${tab}`))}${escapeHtml(count)}</button>`;
          }).join("")}
        </div>
        <div class="member-panel__divider"></div>
        <div class="member-panel__body">${body}</div>
        <footer class="member-panel__footer">
          <button type="button" class="member-panel__button member-panel__button--remove" data-member-detail-remove${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.detail.remove"))}</button>
          <button type="submit" class="member-panel__button member-panel__button--save"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.detail.save"))}</button>
        </footer>
      </form>
    </section>
  </div>`;
}
