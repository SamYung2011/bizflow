import { memberT } from "./members-i18n.js";
import { confirmInPage } from "../components/confirm-dialog.js";

function currentLang() {
  return document.documentElement.lang === "zh-Hant" ? "zh" : document.documentElement.lang;
}

function hongKongDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replaceAll("-", "/");
}

function renderCompanyRow(company, state, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const editing = state.editingCompanyId === company.id;
  const name = editing
    ? `<form class="member-company-name-form" data-company-name-form data-company-id="${escapeHtml(company.id)}"><input name="name" value="${escapeHtml(company.name)}" required${state.liveReadOnly ? " disabled" : ""}><button type="submit" aria-label="${escapeHtml(tt("members.companies.save"))}"${state.liveReadOnly ? " disabled" : ""}>✓</button><button type="button" data-company-edit-cancel aria-label="${escapeHtml(tt("members.companies.cancel"))}">×</button></form>`
    : `<strong title="${escapeHtml(company.name)}">${escapeHtml(company.name)}</strong>`;
  return `<article class="member-company-row" data-company-row="${escapeHtml(company.id)}">
    <div data-company-cell="${escapeHtml(tt("members.companies.name"))}">${name}</div>
    <div data-company-cell="${escapeHtml(tt("members.companies.employeeCount"))}"><span>${escapeHtml(company.employeeCount)}</span></div>
    <div data-company-cell="${escapeHtml(tt("members.companies.createdAt"))}"><time>${escapeHtml(company.createdAt)}</time></div>
    <div data-company-cell="${escapeHtml(tt("members.companies.ai"))}"><label class="member-company-ai"><input type="checkbox" data-company-ai="${escapeHtml(company.id)}"${company.featureAiBatch ? " checked" : ""}${state.liveReadOnly ? " disabled" : ""}><span>${escapeHtml(tt("members.companies.ai"))}</span></label></div>
    <div class="member-company-row__actions" data-company-cell="${escapeHtml(tt("members.companies.actions"))}">
      <button type="button" data-company-edit="${escapeHtml(company.id)}" aria-label="${escapeHtml(tt("members.companies.edit"))}"${state.liveReadOnly ? " disabled" : ""}>${icon("icon-edit-default", "icon icon--sm")}</button>
      <button type="button" data-company-delete="${escapeHtml(company.id)}" aria-label="${escapeHtml(tt("members.companies.delete"))}"${state.liveReadOnly ? " disabled" : ""}>×</button>
    </div>
  </article>`;
}

export function renderMemberCompanies({ state, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  return `<section class="member-companies" data-member-companies data-company-count="${state.companies.length}">
    <form class="member-company-create" data-company-create-form><input name="name" placeholder="${escapeHtml(tt("members.companies.addPlaceholder"))}" required${state.liveReadOnly ? " disabled" : ""}><button type="submit" class="member-domain-button member-domain-button--primary"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.companies.add"))}</button></form>
    <div class="member-company-table">
      <header><span>${escapeHtml(tt("members.companies.name"))}</span><span>${escapeHtml(tt("members.companies.employeeCount"))}</span><span>${escapeHtml(tt("members.companies.createdAt"))}</span><span>${escapeHtml(tt("members.companies.ai"))}</span><span>${escapeHtml(tt("members.companies.actions"))}</span></header>
      ${state.companies.map((company) => renderCompanyRow(company, state, helpers)).join("")}
      ${state.companies.length ? "" : `<p class="member-domain-empty">${escapeHtml(tt("members.companies.empty"))}</p>`}
    </div>
  </section>`;
}

export function attachMemberCompanyController({ state, rerender, scope }) {
  // 现网该页受 isSuperAdmin 门控；静态复刻按真数据展示，所有动作只改本地 state。
  scope.listen(document, "click", async (event) => {
    if (state.liveReadOnly) return;
    const edit = event.target.closest("[data-company-edit]");
    if (edit) {
      state.editingCompanyId = edit.getAttribute("data-company-edit");
      rerender();
      return;
    }
    if (event.target.closest("[data-company-edit-cancel]")) {
      state.editingCompanyId = null;
      rerender();
      return;
    }
    const remove = event.target.closest("[data-company-delete]");
    if (!remove) return;
    const company = state.companies.find((item) => item.id === remove.getAttribute("data-company-delete"));
    if (!company) return;
    if (company.employeeCount > 0) {
      window.alert(memberT(currentLang(), "members.companies.employeeBlocked"));
      return;
    }
    if (await confirmInPage(memberT(currentLang(), "members.companies.deleteConfirm"), { danger: true })) {
      if (scope.disposed) return;
      state.companies = state.companies.filter((item) => item.id !== company.id);
      rerender();
    }
  });

  scope.listen(document, "change", (event) => {
    if (state.liveReadOnly) return;
    const toggle = event.target.closest("[data-company-ai]");
    if (!toggle) return;
    const company = state.companies.find((item) => item.id === toggle.getAttribute("data-company-ai"));
    if (company) company.featureAiBatch = toggle.checked;
    rerender();
  });

  scope.listen(document, "submit", (event) => {
    const createForm = event.target.closest("[data-company-create-form]");
    const nameForm = event.target.closest("[data-company-name-form]");
    if (!createForm && !nameForm) return;
    event.preventDefault();
    if (state.liveReadOnly) return;
    const values = new FormData(event.target);
    const name = String(values.get("name") || "").trim();
    if (!name) return;
    if (createForm) {
      state.companies.push({
        id: `local-company-${Date.now()}`,
        name,
        featureAiBatch: false,
        employeeCount: 0,
        createdAt: hongKongDate()
      });
    } else {
      const company = state.companies.find((item) => item.id === nameForm.getAttribute("data-company-id"));
      if (company) company.name = name;
      state.editingCompanyId = null;
    }
    rerender();
  });
}
