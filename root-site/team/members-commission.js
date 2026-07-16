import { memberT } from "./members-i18n.js";

function localeFor(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "fr") return "fr-FR";
  return "zh-HK";
}

function availableMonths(entries, lang) {
  return [...new Set(entries.map((entry) => String(entry.date ?? entry.createdAt ?? "").slice(0, 7)).filter((value) => /^\d{4}-\d{2}$/.test(value)))]
    .sort((a, b) => b.localeCompare(a))
    .map((value) => {
      const [year, month] = value.split("-").map(Number);
      return {
        value,
        label: new Intl.DateTimeFormat(localeFor(lang), { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1))
      };
    });
}

function numberValue(entry, key) {
  return typeof entry?.[key] === "number" ? entry[key] : 0;
}

export function renderMemberCommission({ state, data, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const lockedEmployeeId = state.access.commissionLockedEmployeeId;
  const rows = state.commission.filter((entry) => {
    const salespersonId = entry.salespersonId ?? entry.employeeId ?? "";
    const date = String(entry.date ?? entry.createdAt ?? "");
    const matchesEmployee = lockedEmployeeId
      ? salespersonId === lockedEmployeeId
      : state.commissionSale === "all" || salespersonId === state.commissionSale;
    return matchesEmployee && (state.commissionMonth === "all" || date.startsWith(state.commissionMonth));
  });
  const total = rows.reduce((sum, entry) => sum + numberValue(entry, "commission"), 0);
  const salesOptions = data.commissionSales.map((member) =>
    `<option value="${escapeHtml(member.id)}"${state.commissionSale === member.id ? " selected" : ""}>${escapeHtml(member.name)}</option>`).join("");
  const monthOptions = availableMonths(state.commission, lang).map((month) =>
    `<option value="${escapeHtml(month.value)}"${state.commissionMonth === month.value ? " selected" : ""}>${escapeHtml(month.label)}</option>`).join("");

  // Mirrors bizflow_samyung/team/src/views/Commission.jsx:7-15,28-48.
  const salesFilter = lockedEmployeeId ? "" : `<label><span>${escapeHtml(tt("members.commission.sales"))}</span><select data-commission-filter="sale"><option value="all">${escapeHtml(tt("members.commission.allSales"))}</option>${salesOptions}</select></label>`;
  return `<section class="member-commission" data-member-commission data-commission-count="${rows.length}" data-sales-option-count="${lockedEmployeeId ? 0 : data.commissionSales.length}" data-commission-locked-employee="${escapeHtml(lockedEmployeeId ?? "")}">
    <div class="member-commission__toolbar">
      <div class="member-commission__filters">
        ${salesFilter}
        <label><span>${escapeHtml(tt("members.commission.month"))}</span><select data-commission-filter="month"><option value="all"${state.commissionMonth === "all" ? " selected" : ""}>${escapeHtml(tt("members.commission.allMonths"))}</option>${monthOptions}</select></label>
      </div>
      <strong>${escapeHtml(tt("members.commission.total"))} <span>${escapeHtml(tt("members.commission.currency"))} ${escapeHtml(total.toLocaleString(localeFor(lang)))}</span></strong>
    </div>
    <div class="member-commission__table-wrap">
      <table class="member-commission__table">
        <thead><tr><th>${escapeHtml(tt("members.commission.date"))}</th><th>${escapeHtml(tt("members.commission.sales"))}</th><th>${escapeHtml(tt("members.commission.invoice"))}</th><th>${escapeHtml(tt("members.commission.amount"))}</th><th>${escapeHtml(tt("members.commission.commission"))}</th><th>${escapeHtml(tt("members.commission.status"))}</th></tr></thead>
        <tbody>${rows.map((entry) => `<tr><td>${escapeHtml(entry.date ?? entry.createdAt ?? "—")}</td><td>${escapeHtml(entry.salesperson ?? entry.employee ?? "—")}</td><td>${escapeHtml(entry.invoiceNo ?? "—")}</td><td>${escapeHtml(numberValue(entry, "amount"))}</td><td>${escapeHtml(numberValue(entry, "commission"))}</td><td>${escapeHtml(entry.status ?? "—")}</td></tr>`).join("")}</tbody>
      </table>
      ${rows.length ? "" : `<p class="member-domain-empty">${escapeHtml(tt("members.commission.empty"))}</p>`}
    </div>
    <p class="member-commission__rule">${escapeHtml(tt("members.commission.rule"))}</p>
  </section>`;
}

export function attachMemberCommissionController({ state, rerender, scope }) {
  // 现网由 canCommission 门控；super admin 可看全部，其余获准使用者只能查看自己。
  scope.listen(document, "change", (event) => {
    const filter = event.target.closest("[data-commission-filter]");
    if (!filter) return;
    if (filter.getAttribute("data-commission-filter") === "sale") {
      if (state.access.commissionLockedEmployeeId) return;
      state.commissionSale = filter.value;
    }
    else state.commissionMonth = filter.value;
    rerender();
  });
}
