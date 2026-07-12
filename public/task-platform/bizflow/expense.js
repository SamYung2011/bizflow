import { getCurrentUser, getExpenseData, getUnread } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { renderSegment } from "../components/segment.js";
import {
  expenseCategories as categories,
  expenseCategoryKeys as categoryKeys,
  expenseCounts,
  expenseCurrencies as currencies,
  expenseFilters as filters,
  filterExpenseRows,
  normalizeExpenseRows
} from "./expense-model.js";

const copy = {
  zh: {
    title: "財務",
    subtitleAdmin: "審批 / 打款 / 查看所有員工報銷",
    subtitleMine: "提交自己的報銷，等待審批與打款",
    add: "新增報銷",
    pending: "待審批",
    approved: "已通過",
    rejected: "已拒絕",
    paid: "已打款",
    mine: "我的報銷",
    all: "全部",
    mineSummary: "我的報銷 · 共 {count} 筆",
    visible: "可見 {count} 筆",
    approvedTotal: "已通過總額",
    empty: "暫無報銷記錄",
    date: "日期",
    employee: "員工",
    category: "類別",
    amount: "金額",
    description: "說明",
    receipt: "收據",
    status: "狀態",
    payment: "打款",
    actions: "操作",
    unpaid: "未打款",
    approve: "通過",
    reject: "拒絕",
    markPaid: "標記已打款",
    remove: "刪除",
    deleteConfirm: "確認刪除這筆本地報銷？",
    rejectReason: "拒絕理由（選填）",
    modalTitle: "新增報銷",
    currency: "幣種",
    categoryFood: "餐飲",
    categoryTransport: "交通",
    categoryOffice: "辦公",
    categoryMaterial: "物料",
    categoryCommunication: "通訊",
    categoryOther: "其他",
    descriptionPlaceholder: "選填，描述用途",
    receiptHint: "選擇收據圖片",
    receiptLocal: "僅本地預覽，不會上傳",
    removeReceipt: "移除收據",
    cancel: "取消",
    submit: "提交",
    close: "關閉",
    dateRequired: "請選擇日期",
    amountRequired: "金額必須大於 0",
    categoryRequired: "請選擇類別",
    noDescription: "—",
    receiptCount: "{count} 張"
  },
  en: {
    title: "Finance",
    subtitleAdmin: "Approve, pay and view all employee reimbursements",
    subtitleMine: "Submit your reimbursements for approval and payment",
    add: "Add reimbursement",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    paid: "Paid",
    mine: "My reimbursements",
    all: "All",
    mineSummary: "My reimbursements · {count} entries",
    visible: "{count} visible",
    approvedTotal: "Approved total",
    empty: "No reimbursement records",
    date: "Date",
    employee: "Employee",
    category: "Category",
    amount: "Amount",
    description: "Description",
    receipt: "Receipt",
    status: "Status",
    payment: "Payment",
    actions: "Actions",
    unpaid: "Unpaid",
    approve: "Approve",
    reject: "Reject",
    markPaid: "Mark paid",
    remove: "Delete",
    deleteConfirm: "Delete this local reimbursement?",
    rejectReason: "Rejection reason (optional)",
    modalTitle: "Add reimbursement",
    currency: "Currency",
    categoryFood: "Meals",
    categoryTransport: "Transport",
    categoryOffice: "Office",
    categoryMaterial: "Materials",
    categoryCommunication: "Communications",
    categoryOther: "Other",
    descriptionPlaceholder: "Optional purpose description",
    receiptHint: "Choose receipt images",
    receiptLocal: "Local preview only. Nothing is uploaded.",
    removeReceipt: "Remove receipt",
    cancel: "Cancel",
    submit: "Submit",
    close: "Close",
    dateRequired: "Select a date",
    amountRequired: "Amount must be greater than 0",
    categoryRequired: "Select a category",
    noDescription: "—",
    receiptCount: "{count} images"
  },
  fr: {
    title: "Finance",
    subtitleAdmin: "Valider, payer et consulter tous les remboursements",
    subtitleMine: "Soumettez vos remboursements pour validation et paiement",
    add: "Ajouter un remboursement",
    pending: "En attente",
    approved: "Approuvé",
    rejected: "Refusé",
    paid: "Payé",
    mine: "Mes remboursements",
    all: "Tous",
    mineSummary: "Mes remboursements · {count} entrées",
    visible: "{count} visibles",
    approvedTotal: "Total approuvé",
    empty: "Aucun remboursement",
    date: "Date",
    employee: "Employé",
    category: "Catégorie",
    amount: "Montant",
    description: "Description",
    receipt: "Reçu",
    status: "Statut",
    payment: "Paiement",
    actions: "Actions",
    unpaid: "Non payé",
    approve: "Approuver",
    reject: "Refuser",
    markPaid: "Marquer payé",
    remove: "Supprimer",
    deleteConfirm: "Supprimer ce remboursement local ?",
    rejectReason: "Motif du refus (facultatif)",
    modalTitle: "Ajouter un remboursement",
    currency: "Devise",
    categoryFood: "Repas",
    categoryTransport: "Transport",
    categoryOffice: "Bureau",
    categoryMaterial: "Matériel",
    categoryCommunication: "Communications",
    categoryOther: "Autre",
    descriptionPlaceholder: "Description facultative de l'usage",
    receiptHint: "Choisir des images de reçus",
    receiptLocal: "Aperçu local uniquement. Aucun envoi.",
    removeReceipt: "Retirer le reçu",
    cancel: "Annuler",
    submit: "Envoyer",
    close: "Fermer",
    dateRequired: "Sélectionnez une date",
    amountRequired: "Le montant doit être supérieur à 0",
    categoryRequired: "Sélectionnez une catégorie",
    noDescription: "—",
    receiptCount: "{count} images"
  }
};

const [snapshot, currentUser, unread] = await Promise.all([getExpenseData(), getCurrentUser(), getUnread()]);
const authenticated = typeof currentUser?.hasPermission === "function";
const isAdmin = !authenticated || currentUser?.isBfAdmin === true;
const liveReadOnly = authenticated;
const writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
const ownerKey = String(currentUser.employeeId || currentUser.email || currentUser.name || "");
const currencySymbols = { RMB: "¥", HKD: "HK$", USD: "US$" };

const state = {
  rows: normalizeExpenseRows(snapshot.reimbursements),
  filter: isAdmin ? "pending" : "mine",
  draft: null,
  error: ""
};

let currentHelpers = null;

function t(lang, key, values = {}) {
  const template = copy[lang]?.[key] ?? copy.zh[key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
}

function todayInHongKong() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function blankDraft() {
  return { date: todayInHongKong(), currency: "RMB", amount: "", category: "Food", description: "", receipts: [] };
}

function formatAmount(value) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(currency, value) {
  return `${currencySymbols[currency] || currency || "¥"} ${formatAmount(value)}`;
}

function approvedTotals(rows) {
  const totals = {};
  rows.filter((row) => row.status === "approved").forEach((row) => {
    totals[row.currency] = (totals[row.currency] || 0) + row.amount;
  });
  return totals;
}

function renderStats(rows, helpers) {
  const { escapeHtml, lang } = helpers;
  const totals = approvedTotals(rows);
  const entries = Object.entries(totals).filter(([, value]) => value > 0);
  const amounts = entries.length ? entries : [["RMB", 0]];
  return `<div class="expense-stats">
    <strong>${escapeHtml(t(lang, "visible", { count: rows.length }))}</strong>
    <span>${escapeHtml(t(lang, "approvedTotal"))}</span>
    ${amounts.map(([currency, amount]) => `<span>${escapeHtml(formatCurrency(currency, amount))}</span>`).join("")}
  </div>`;
}

function renderReceiptCell(row, helpers) {
  const { escapeHtml, lang } = helpers;
  if (!row.receipts.length) return `<span class="expense-muted">—</span>`;
  const receipt = row.receipts[0];
  return `<span class="expense-receipt-cell"><img src="${escapeHtml(receipt.url)}" alt="" loading="lazy"><span>${escapeHtml(t(lang, "receiptCount", { count: row.receipts.length }))}</span></span>`;
}

function renderActions(row, helpers) {
  const { escapeHtml, lang } = helpers;
  if (!row.local) return `<span class="expense-muted">—</span>`;
  const pending = row.status === "pending";
  return `<span class="expense-actions">
    ${pending ? `<button type="button" class="expense-action expense-action--approve" data-expense-approve="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "approve"))}</button><button type="button" class="expense-action expense-action--reject" data-expense-reject="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "reject"))}</button>` : ""}
    <button type="button" class="expense-action expense-action--delete" data-expense-delete="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "remove"))}</button>
  </span>`;
}

function renderPayment(row, helpers) {
  const { escapeHtml, lang } = helpers;
  if (row.paid) return `<span class="expense-payment expense-payment--paid">${escapeHtml(t(lang, "paid"))}</span>`;
  if (row.local && row.status === "approved") return `<button type="button" class="expense-action expense-action--pay" data-expense-pay="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "markPaid"))}</button>`;
  return `<span class="expense-payment">${escapeHtml(t(lang, "unpaid"))}</span>`;
}

function renderRow(row, helpers) {
  const { escapeHtml, lang } = helpers;
  const e = escapeHtml;
  const cell = (key, value, className = "") => `<td class="${className}" data-label="${e(t(lang, key))}">${value}</td>`;
  const categoryKey = categoryKeys[row.category];
  return `<tr class="expense-row" data-expense-row="${e(row.id)}" data-expense-status="${e(row.status)}" data-expense-paid="${row.paid}">
    ${cell("date", e(row.date))}
    ${isAdmin ? cell("employee", e(row.employee)) : ""}
    ${cell("category", e(categoryKey ? t(lang, categoryKey) : row.category))}
    ${cell("amount", e(formatCurrency(row.currency, row.amount)), "expense-amount")}
    ${cell("description", `<span title="${e(row.description || t(lang, "noDescription"))}">${e(row.description || t(lang, "noDescription"))}</span>`, "expense-description")}
    ${cell("receipt", renderReceiptCell(row, helpers))}
    ${cell("status", `<span class="expense-status-cell"><span class="expense-status expense-status--${e(row.status)}">${e(t(lang, row.status))}</span>${row.status === "rejected" && row.rejectReason ? `<small title="${e(row.rejectReason)}">${e(row.rejectReason)}</small>` : ""}</span>`)}
    ${cell("payment", renderPayment(row, helpers))}
    ${cell("actions", renderActions(row, helpers), "expense-actions-cell")}
  </tr>`;
}

function renderTable(rows, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const headers = ["date", ...(isAdmin ? ["employee"] : []), "category", "amount", "description", "receipt", "status", "payment", "actions"];
  return `<div class="expense-table-shell">
    <table class="expense-table">
      <thead><tr>${headers.map((key) => `<th>${escapeHtml(t(lang, key))}</th>`).join("")}</tr></thead>
      <tbody>${rows.length ? rows.map((row) => renderRow(row, helpers)).join("") : `<tr class="expense-empty-row"><td colspan="${headers.length}"><div class="expense-empty">${icon("icon-nav-sales", "icon")}<span>${escapeHtml(t(lang, "empty"))}</span></div></td></tr>`}</tbody>
    </table>
  </div>`;
}

function renderField(name, labelKey, control, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<label class="expense-field"><span>${escapeHtml(t(lang, labelKey))}</span>${control}</label>`;
}

function renderModal(helpers) {
  if (!state.draft) return "";
  const { escapeHtml, icon, lang } = helpers;
  const e = escapeHtml;
  const draft = state.draft;
  const options = (values, selected, label) => values.map((value) => `<option value="${e(value)}"${selected === value ? " selected" : ""}>${e(label(value))}</option>`).join("");
  return `<div class="expense-overlay" data-expense-overlay>
    <form class="expense-modal" data-expense-form role="dialog" aria-modal="true" aria-label="${e(t(lang, "modalTitle"))}">
      <header><h2>${e(t(lang, "modalTitle"))}</h2><button type="button" data-expense-close aria-label="${e(t(lang, "close"))}">×</button></header>
      <div class="expense-modal__body">
        <div class="expense-form-grid">
          ${renderField("date", "date", `<input type="date" data-expense-field="date" data-expense-write value="${e(draft.date)}"${writeAttributes}>`, helpers)}
          <div class="expense-amount-fields">
            ${renderField("currency", "currency", `<select data-expense-field="currency" data-expense-write${writeAttributes}>${options(currencies, draft.currency, (value) => value)}</select>`, helpers)}
            ${renderField("amount", "amount", `<input type="number" min="0" step="0.01" inputmode="decimal" data-expense-field="amount" data-expense-write value="${e(draft.amount)}" placeholder="0.00"${writeAttributes}>`, helpers)}
          </div>
        </div>
        ${renderField("category", "category", `<select data-expense-field="category" data-expense-write${writeAttributes}>${options(categories, draft.category, (value) => t(lang, categoryKeys[value]))}</select>`, helpers)}
        ${renderField("description", "description", `<textarea data-expense-field="description" data-expense-write placeholder="${e(t(lang, "descriptionPlaceholder"))}"${writeAttributes}>${e(draft.description)}</textarea>`, helpers)}
        <div class="expense-upload">
          <label class="expense-upload__trigger">${icon("icon-nav-file", "icon")}<span><strong>${e(t(lang, "receiptHint"))}</strong><small>${e(t(lang, "receiptLocal"))}</small></span><input type="file" accept="image/*" multiple data-expense-receipts data-expense-write${writeAttributes}></label>
          ${draft.receipts.length ? `<div class="expense-preview-list">${draft.receipts.map((receipt, index) => `<figure><img src="${e(receipt.url)}" alt="${e(receipt.name)}"><button type="button" data-expense-receipt-remove="${index}" data-expense-write aria-label="${e(t(lang, "removeReceipt"))}"${writeAttributes}>×</button></figure>`).join("")}</div>` : ""}
        </div>
        ${state.error ? `<p class="expense-error" role="alert">${e(t(lang, state.error))}</p>` : ""}
      </div>
      <footer><button type="button" class="expense-button expense-button--secondary" data-expense-close>${e(t(lang, "cancel"))}</button><button type="submit" class="expense-button" data-expense-write${writeAttributes}>${e(t(lang, "submit"))}</button></footer>
    </form>
  </div>`;
}

export function renderExpense(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  // Mirrors bizflow_samyung/src/views/Expense.jsx:223-229: non-admins can only see their own rows.
  const rows = isAdmin ? filterExpenseRows(state.rows, state.filter, ownerKey) : filterExpenseRows(state.rows, "mine", ownerKey);
  const filterCounts = expenseCounts(state.rows, ownerKey);
  const segment = isAdmin ? renderSegment({
    items: filters.map((filter) => ({ key: filter, label: t(lang, filter), badge: filterCounts[filter] })),
    active: state.filter,
    ariaLabel: t(lang, "title"),
    escapeHtml,
    dataAttribute: "data-expense-filter"
  }) : "";
  return `<div class="expense-page" data-expense-page data-live-read-only="${liveReadOnly}" data-expense-admin="${isAdmin}" data-expense-filter-value="${escapeHtml(state.filter)}" data-expense-visible="${rows.length}" ${filters.map((filter) => `data-expense-count-${filter}="${filterCounts[filter]}"`).join(" ")}>
    <header class="expense-head"><div><h1>${escapeHtml(t(lang, "title"))}</h1><p>${escapeHtml(t(lang, isAdmin ? "subtitleAdmin" : "subtitleMine"))}</p></div><button type="button" class="expense-add" data-expense-new data-expense-write${writeAttributes}>${icon("icon-add-line-add", "icon")}<span>${escapeHtml(t(lang, "add"))}</span></button></header>
    ${isAdmin ? `<div class="expense-segment">${segment}</div>` : `<div class="expense-mine-summary">${escapeHtml(t(lang, "mineSummary", { count: rows.length }))}</div>`}
    ${renderStats(rows, helpers)}
    ${renderTable(rows, helpers)}
    ${renderModal(helpers)}
  </div>`;
}

function rerender() {
  const page = document.querySelector("[data-expense-page]");
  if (page && currentHelpers) page.outerHTML = renderExpense(currentHelpers);
}

function revokeReceipts(receipts) {
  receipts.forEach((receipt) => {
    if (receipt.url.startsWith("blob:")) URL.revokeObjectURL(receipt.url);
  });
}

function closeModal() {
  if (state.draft) revokeReceipts(state.draft.receipts);
  state.draft = null;
  state.error = "";
  rerender();
}

function findLocalRow(id) {
  return state.rows.find((row) => row.id === id && row.local);
}

document.addEventListener("click", (event) => {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  const filter = event.target.closest("[data-expense-filter]");
  if (filter) {
    const value = filter.getAttribute("data-expense-filter");
    if (filters.includes(value)) state.filter = value;
    rerender();
    return;
  }
  if (event.target.closest("[data-expense-new]")) {
    state.draft = blankDraft();
    state.error = "";
    rerender();
    return;
  }
  if (event.target.closest("[data-expense-close]") || event.target.matches("[data-expense-overlay]")) {
    closeModal();
    return;
  }
  const receiptRemove = event.target.closest("[data-expense-receipt-remove]");
  if (receiptRemove && state.draft) {
    const index = Number(receiptRemove.getAttribute("data-expense-receipt-remove"));
    const [receipt] = state.draft.receipts.splice(index, 1);
    if (receipt) revokeReceipts([receipt]);
    rerender();
    return;
  }
  const approve = event.target.closest("[data-expense-approve]");
  if (approve) {
    const row = findLocalRow(approve.getAttribute("data-expense-approve"));
    if (row) {
      row.status = "approved";
      row.rejectReason = "";
      rerender();
    }
    return;
  }
  const reject = event.target.closest("[data-expense-reject]");
  if (reject) {
    const row = findLocalRow(reject.getAttribute("data-expense-reject"));
    if (!row) return;
    const reason = window.prompt(t(currentHelpers?.lang ?? "zh", "rejectReason"), row.rejectReason);
    if (reason !== null) {
      row.status = "rejected";
      row.paid = false;
      row.rejectReason = reason.trim();
      rerender();
    }
    return;
  }
  const pay = event.target.closest("[data-expense-pay]");
  if (pay) {
    const row = findLocalRow(pay.getAttribute("data-expense-pay"));
    if (row && row.status === "approved") {
      row.paid = true;
      rerender();
    }
    return;
  }
  const remove = event.target.closest("[data-expense-delete]");
  if (remove && window.confirm(t(currentHelpers?.lang ?? "zh", "deleteConfirm"))) {
    const id = remove.getAttribute("data-expense-delete");
    const row = findLocalRow(id);
    if (row) {
      revokeReceipts(row.receipts);
      state.rows = state.rows.filter((item) => item.id !== id);
      rerender();
    }
  }
});

document.addEventListener("input", (event) => {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (!field || !state.draft) return;
  state.draft[field.getAttribute("data-expense-field")] = field.value;
  state.error = "";
});

document.addEventListener("change", (event) => {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (field && state.draft) {
    state.draft[field.getAttribute("data-expense-field")] = field.value;
    state.error = "";
  }
  const fileInput = event.target.closest("[data-expense-receipts]");
  if (!fileInput || !state.draft) return;
  [...fileInput.files].filter((file) => file.type.startsWith("image/")).forEach((file) => {
    state.draft.receipts.push({ url: URL.createObjectURL(file), name: file.name });
  });
  rerender();
});

document.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-expense-form]") || !state.draft) return;
  event.preventDefault();
  if (liveReadOnly) return;
  const amount = Number(state.draft.amount);
  if (!state.draft.date) state.error = "dateRequired";
  else if (!Number.isFinite(amount) || amount <= 0) state.error = "amountRequired";
  else if (!categories.includes(state.draft.category)) state.error = "categoryRequired";
  else {
    state.rows.unshift({
      id: `local-expense-${Date.now()}`,
      employeeId: ownerKey,
      employee: currentUser.name,
      date: state.draft.date,
      currency: state.draft.currency,
      amount,
      category: state.draft.category,
      description: state.draft.description.trim(),
      receipts: state.draft.receipts.map((receipt) => ({ ...receipt })),
      status: "pending",
      paid: false,
      rejectReason: "",
      local: true
    });
    state.filter = isAdmin ? "pending" : "mine";
    state.draft = null;
    state.error = "";
  }
  rerender();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.draft) closeModal();
});

window.__shellMenu = createBizflowMenu("finance");
window.__shellData = { unread, user: currentUser };
window.__shellContent = renderExpense;
await import("../shell/shell.js");
