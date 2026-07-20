import { getCurrentUser, getExpenseData, getUnread } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { renderSegment } from "../components/segment.js";
import {
  expenseCategories as categories,
  expenseCategoryDbValues,
  expenseCategoryKeys as categoryKeys,
  expenseCounts,
  expenseCurrencies as currencies,
  expenseFilters as filters,
  filterExpenseRows,
  normalizeExpenseRows
} from "./expense-model.js";
import {
  approveLiveExpense,
  createLiveExpense,
  deleteLiveExpense,
  markLiveExpensePaid,
  rejectLiveExpense
} from "../data/live-expense-writes.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import { displayDateInput } from "../components/date-value.js";

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
    deleteConfirm: "確認刪除這筆報銷？",
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
    receiptUpload: "提交後上傳到報銷收據庫",
    removeReceipt: "移除收據",
    cancel: "取消",
    submit: "提交",
    close: "關閉",
    dateRequired: "請選擇日期",
    amountRequired: "金額必須大於 0",
    categoryRequired: "請選擇類別",
    saveFailed: "提交失敗，請稍後重試",
    actionFailed: "操作失敗，請稍後重試",
    noDescription: "—",
    receiptCount: "{count} 張",
    leaveUnsaved: "報銷草稿尚未提交，確定離開？",
    presets: "快捷日期",
    today: "今天",
    previousMonth: "上個月",
    nextMonth: "下個月",
    year: "年份",
    chooseMonth: "選擇年月",
    clear: "清除"
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
    deleteConfirm: "Delete this reimbursement?",
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
    receiptUpload: "Uploaded to the receipt store on submit.",
    removeReceipt: "Remove receipt",
    cancel: "Cancel",
    submit: "Submit",
    close: "Close",
    dateRequired: "Select a date",
    amountRequired: "Amount must be greater than 0",
    categoryRequired: "Select a category",
    saveFailed: "Submission failed. Please try again.",
    actionFailed: "Action failed. Please try again.",
    noDescription: "—",
    receiptCount: "{count} images",
    leaveUnsaved: "This reimbursement draft has not been submitted. Leave this page?",
    presets: "Quick dates",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    year: "Year",
    chooseMonth: "Choose year and month",
    clear: "Clear"
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
    deleteConfirm: "Supprimer ce remboursement ?",
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
    receiptUpload: "Envoyé au stockage des reçus lors de la soumission.",
    removeReceipt: "Retirer le reçu",
    cancel: "Annuler",
    submit: "Envoyer",
    close: "Fermer",
    dateRequired: "Sélectionnez une date",
    amountRequired: "Le montant doit être supérieur à 0",
    categoryRequired: "Sélectionnez une catégorie",
    saveFailed: "Échec de l’envoi. Réessayez.",
    actionFailed: "Échec de l’action. Réessayez.",
    noDescription: "—",
    receiptCount: "{count} images",
    leaveUnsaved: "Ce brouillon de remboursement n’est pas envoyé. Quitter cette page ?",
    presets: "Dates rapides",
    today: "Aujourd’hui",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    year: "Année",
    chooseMonth: "Choisir l’année et le mois",
    clear: "Effacer"
  }
};

let snapshot = null;
let currentUser = null;
let unread = null;
let authenticated = false;
let isAdmin = true;
let liveReadOnly = false;
let ownerKey = "";
const currencySymbols = { RMB: "¥", HKD: "HK$", USD: "US$" };

let state = {
  rows: [],
  filter: "pending",
  draft: null,
  error: "",
  actionError: "",
  writeBusy: false
};

let currentHelpers = null;
let activeScope = null;
let activeMountId = 0;
const expenseDatePanel = createDateRangePanel();

function isCurrentExpenseMount(mountId, scope = activeScope) {
  return mountId === activeMountId && Boolean(scope?.isCurrent());
}

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
  const pending = isAdmin && row.status === "pending";
  const canDelete = isAdmin || (row.employeeId === ownerKey && row.status === "pending");
  if (!pending && !canDelete) return `<span class="expense-muted">—</span>`;
  const writeAttributes = state.writeBusy ? ' disabled aria-disabled="true"' : "";
  return `<span class="expense-actions">
    ${pending ? `<button type="button" class="expense-action expense-action--approve" data-expense-approve="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "approve"))}</button><button type="button" class="expense-action expense-action--reject" data-expense-reject="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "reject"))}</button>` : ""}
    ${canDelete ? `<button type="button" class="expense-action expense-action--delete" data-expense-delete="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "remove"))}</button>` : ""}
  </span>`;
}

function renderPayment(row, helpers) {
  const { escapeHtml, lang } = helpers;
  if (row.paid) return `<span class="expense-payment expense-payment--paid">${escapeHtml(t(lang, "paid"))}</span>`;
  if (isAdmin && row.status === "approved") {
    const writeAttributes = state.writeBusy ? ' disabled aria-disabled="true"' : "";
    return `<button type="button" class="expense-action expense-action--pay" data-expense-pay="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "markPaid"))}</button>`;
  }
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
  const createWriteAttributes = state.writeBusy ? ' disabled aria-disabled="true"' : "";
  const options = (values, selected, label) => values.map((value) => `<option value="${e(value)}"${selected === value ? " selected" : ""}>${e(label(value))}</option>`).join("");
  return `<div class="expense-overlay" data-expense-overlay>
    <form class="expense-modal" data-expense-form role="dialog" aria-modal="true" aria-label="${e(t(lang, "modalTitle"))}">
      <header><h2>${e(t(lang, "modalTitle"))}</h2><button type="button" data-expense-close data-expense-create-write aria-label="${e(t(lang, "close"))}"${createWriteAttributes}>×</button></header>
      <div class="expense-modal__body">
        <div class="expense-form-grid">
          ${renderField("date", "date", `<button type="button" class="date-panel-trigger" data-expense-date-trigger data-expense-create-write aria-haspopup="dialog" aria-expanded="false"${createWriteAttributes}>${icon("icon-task-calendar", "icon")}<span class="date-panel-trigger__value">${e(displayDateInput(draft.date) || t(lang, "date"))}</span></button>`, helpers)}
          <div class="expense-amount-fields">
            ${renderField("currency", "currency", `<select data-expense-field="currency" data-expense-create-write${createWriteAttributes}>${options(currencies, draft.currency, (value) => value)}</select>`, helpers)}
            ${renderField("amount", "amount", `<input type="number" min="0" step="0.01" inputmode="decimal" data-expense-field="amount" data-expense-create-write value="${e(draft.amount)}" placeholder="0.00"${createWriteAttributes}>`, helpers)}
          </div>
        </div>
        ${renderField("category", "category", `<select data-expense-field="category" data-expense-create-write${createWriteAttributes}>${options(categories, draft.category, (value) => t(lang, categoryKeys[value]))}</select>`, helpers)}
        ${renderField("description", "description", `<textarea data-expense-field="description" data-expense-create-write placeholder="${e(t(lang, "descriptionPlaceholder"))}"${createWriteAttributes}>${e(draft.description)}</textarea>`, helpers)}
        <div class="expense-upload">
          <label class="expense-upload__trigger">${icon("icon-nav-file", "icon")}<span><strong>${e(t(lang, "receiptHint"))}</strong><small>${e(t(lang, authenticated ? "receiptUpload" : "receiptLocal"))}</small></span><input type="file" accept="image/*" multiple data-expense-receipts data-expense-create-write${createWriteAttributes}></label>
          ${draft.receipts.length ? `<div class="expense-preview-list">${draft.receipts.map((receipt, index) => `<figure><img src="${e(receipt.url)}" alt="${e(receipt.name)}"><button type="button" data-expense-receipt-remove="${index}" data-expense-create-write aria-label="${e(t(lang, "removeReceipt"))}"${createWriteAttributes}>×</button></figure>`).join("")}</div>` : ""}
        </div>
        ${state.error ? `<p class="expense-error" role="alert">${e(t(lang, state.error))}</p>` : ""}
      </div>
      <footer><button type="button" class="expense-button expense-button--secondary" data-expense-close data-expense-create-write${createWriteAttributes}>${e(t(lang, "cancel"))}</button><button type="submit" class="expense-button" data-expense-create-write${createWriteAttributes}>${e(t(lang, "submit"))}</button></footer>
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
    <header class="expense-head"><div><h1>${escapeHtml(t(lang, "title"))}</h1><p>${escapeHtml(t(lang, isAdmin ? "subtitleAdmin" : "subtitleMine"))}</p></div><button type="button" class="expense-add" data-expense-new data-expense-create-write${state.writeBusy ? ' disabled aria-disabled="true"' : ""}>${icon("icon-add-line-add", "icon")}<span>${escapeHtml(t(lang, "add"))}</span></button></header>
    ${state.actionError ? `<p class="expense-error" role="alert">${escapeHtml(t(lang, state.actionError))}</p>` : ""}
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
  if (state.writeBusy) return;
  expenseDatePanel.close({ restoreFocus: false });
  if (state.draft) revokeReceipts(state.draft.receipts);
  state.draft = null;
  state.error = "";
  rerender();
}

function findExpenseRow(id) {
  return state.rows.find((row) => row.id === id) ?? null;
}

function replaceExpenseRow(row, nextRow) {
  const normalized = normalizeExpenseRows([{ ...nextRow, employee: row.employee, local: false }])[0];
  state.rows = state.rows.map((item) => item.id === row.id ? normalized : item);
}

async function performLiveExpenseWrite(operation, applyResult) {
  const mountId = activeMountId;
  const scope = activeScope;
  state.writeBusy = true;
  state.actionError = "";
  rerender();
  try {
    const result = await operation();
    if (!isCurrentExpenseMount(mountId, scope)) return;
    applyResult(result);
  } catch (error) {
    if (!isCurrentExpenseMount(mountId, scope)) return;
    console.warn("Expense action failed", error);
    state.actionError = "actionFailed";
  } finally {
    if (!isCurrentExpenseMount(mountId, scope)) return;
    state.writeBusy = false;
    rerender();
  }
}

async function onExpenseClick(event) {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  if (state.writeBusy && event.target.closest("[data-expense-write]")) return;
  if (state.writeBusy && event.target.closest("[data-expense-create-write]")) return;
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
    state.actionError = "";
    rerender();
    return;
  }
  const dateTrigger = event.target.closest("[data-expense-date-trigger]");
  if (dateTrigger && state.draft) {
    if (dateTrigger.disabled || state.writeBusy) return;
    expenseDatePanel.open({
      anchor: dateTrigger,
      mode: "single",
      date: state.draft.date,
      language: currentHelpers?.lang ?? "zh",
      t: (key) => t(currentHelpers?.lang ?? "zh", key),
      onCommit: ({ date }) => {
        if (!activeScope?.isCurrent() || !state.draft) return;
        state.draft.date = date;
        state.error = "";
        rerender();
        activeScope.animationFrame(() => document.querySelector("[data-expense-date-trigger]")?.focus());
      }
    });
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
    const row = findExpenseRow(approve.getAttribute("data-expense-approve"));
    if (row && isAdmin && row.status === "pending") {
      if (authenticated) {
        await performLiveExpenseWrite(() => approveLiveExpense(row.id), (result) => replaceExpenseRow(row, result));
      } else {
        state.actionError = "";
        row.status = "approved";
        row.rejectReason = "";
        rerender();
      }
    }
    return;
  }
  const reject = event.target.closest("[data-expense-reject]");
  if (reject) {
    const row = findExpenseRow(reject.getAttribute("data-expense-reject"));
    if (!row || !isAdmin || row.status !== "pending") return;
    const reason = window.prompt(t(currentHelpers?.lang ?? "zh", "rejectReason"), row.rejectReason);
    if (reason !== null) {
      if (authenticated) {
        await performLiveExpenseWrite(() => rejectLiveExpense(row.id, reason), (result) => replaceExpenseRow(row, result));
      } else {
        state.actionError = "";
        row.status = "rejected";
        row.paid = false;
        row.rejectReason = reason.trim();
        rerender();
      }
    }
    return;
  }
  const pay = event.target.closest("[data-expense-pay]");
  if (pay) {
    const row = findExpenseRow(pay.getAttribute("data-expense-pay"));
    if (row && isAdmin && row.status === "approved" && !row.paid) {
      if (authenticated) {
        await performLiveExpenseWrite(() => markLiveExpensePaid(row.id), (result) => replaceExpenseRow(row, result));
      } else {
        state.actionError = "";
        row.paid = true;
        rerender();
      }
    }
    return;
  }
  const remove = event.target.closest("[data-expense-delete]");
  const removeRow = remove ? findExpenseRow(remove.getAttribute("data-expense-delete")) : null;
  const canDelete = removeRow && (isAdmin || (removeRow.employeeId === ownerKey && removeRow.status === "pending"));
  if (canDelete && await confirmInPage(t(currentHelpers?.lang ?? "zh", "deleteConfirm"), { danger: true })) {
    if (!activeScope?.isCurrent()) return;
    if (authenticated) {
      await performLiveExpenseWrite(() => deleteLiveExpense(removeRow.id), () => {
        state.rows = state.rows.filter((item) => item.id !== removeRow.id);
      });
    } else {
      state.actionError = "";
      revokeReceipts(removeRow.receipts);
      state.rows = state.rows.filter((item) => item.id !== removeRow.id);
      rerender();
    }
  }
}

function onExpenseInput(event) {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  if (state.writeBusy && event.target.closest("[data-expense-create-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (!field || !state.draft) return;
  state.draft[field.getAttribute("data-expense-field")] = field.value;
  state.error = "";
}

function onExpenseChange(event) {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  if (state.writeBusy && event.target.closest("[data-expense-create-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (field && state.draft) {
    state.draft[field.getAttribute("data-expense-field")] = field.value;
    state.error = "";
  }
  const fileInput = event.target.closest("[data-expense-receipts]");
  if (!fileInput || !state.draft) return;
  [...fileInput.files].filter((file) => file.type.startsWith("image/")).forEach((file) => {
    state.draft.receipts.push({ file, url: URL.createObjectURL(file), name: file.name });
  });
  rerender();
}

async function onExpenseSubmit(event) {
  if (!event.target.matches("[data-expense-form]") || !state.draft) return;
  event.preventDefault();
  if (state.writeBusy) return;
  const amount = Number(state.draft.amount);
  if (!state.draft.date) state.error = "dateRequired";
  else if (!Number.isFinite(amount) || amount <= 0) state.error = "amountRequired";
  else if (!categories.includes(state.draft.category)) state.error = "categoryRequired";
  else if (authenticated) {
    const mountId = activeMountId;
    const scope = activeScope;
    state.writeBusy = true;
    state.error = "";
    rerender();
    try {
      const result = await createLiveExpense({
        date: state.draft.date,
        amount,
        currency: state.draft.currency,
        category: expenseCategoryDbValues[state.draft.category],
        description: state.draft.description.trim(),
        files: state.draft.receipts.map((receipt) => receipt.file).filter(Boolean)
      });
      if (!isCurrentExpenseMount(mountId, scope)) return;
      const row = normalizeExpenseRows([{ ...result.row, employee: currentUser.name }])[0];
      revokeReceipts(state.draft.receipts);
      state.rows.unshift(row);
      state.filter = isAdmin ? "pending" : "mine";
      state.draft = null;
      state.error = "";
    } catch (error) {
      if (!isCurrentExpenseMount(mountId, scope)) return;
      console.warn("Expense submission failed", error);
      state.error = "saveFailed";
    } finally {
      if (!isCurrentExpenseMount(mountId, scope)) return;
      state.writeBusy = false;
    }
    rerender();
    return;
  }
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
}

function onExpenseKeydown(event) {
  if (event.key === "Escape" && state.draft) closeModal();
}

function hasExpenseUnsavedChanges() {
  if (!state.draft) return false;
  const blank = blankDraft();
  return state.draft.receipts.length > 0
    || ["date", "currency", "amount", "category", "description"]
      .some((key) => String(state.draft[key] ?? "") !== String(blank[key] ?? ""));
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  const mountId = ++activeMountId;
  activeScope = scope;
  const [nextSnapshot, nextCurrentUser, nextUnread] = await Promise.all([getExpenseData(), getCurrentUser(), getUnread()]);
  throwIfPageAborted(signal, scope);
  snapshot = nextSnapshot;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  authenticated = typeof currentUser?.hasPermission === "function";
  isAdmin = !authenticated || currentUser?.isBfAdmin === true;
  liveReadOnly = false;
  ownerKey = String(currentUser.employeeId || currentUser.email || currentUser.name || "");
  const restoredFilter = filters.includes(historyState?.filter) ? historyState.filter : isAdmin ? "pending" : "mine";
  state = {
    rows: normalizeExpenseRows(snapshot.reimbursements),
    filter: isAdmin ? restoredFilter : "mine",
    draft: null,
    error: "",
    actionError: "",
    writeBusy: false
  };

  return {
    page: {
      menu: createBizflowMenu("finance"),
      data: { unread, user: currentUser },
      render: renderExpense,
      title: "Honnmono · Finance"
    },
    activate() {
      scope.listen(document, "click", onExpenseClick);
      scope.listen(document, "input", onExpenseInput);
      scope.listen(document, "change", onExpenseChange);
      scope.listen(document, "submit", onExpenseSubmit);
      scope.listen(document, "keydown", onExpenseKeydown);
    },
    hasUnsavedChanges: hasExpenseUnsavedChanges,
    async canLeave() {
      if (!hasExpenseUnsavedChanges()) return true;
      return confirmInPage(t(currentHelpers?.lang ?? "zh", "leaveUnsaved"));
    },
    captureState: () => ({ filter: state.filter }),
    dispose() {
      if (activeMountId === mountId) activeMountId += 1;
      if (state.draft) revokeReceipts(state.draft.receipts);
      state.rows.forEach((row) => revokeReceipts(row.receipts ?? []));
      snapshot = null;
      currentUser = null;
      unread = null;
      currentHelpers = null;
      if (activeScope === scope) activeScope = null;
      expenseDatePanel.close({ restoreFocus: false });
      state.draft = null;
    }
  };
}
