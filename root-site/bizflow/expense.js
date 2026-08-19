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
  deleteLiveExpenseReceiptUploads,
  deleteLiveExpense,
  markLiveExpensePaid,
  rejectLiveExpense,
  revertLiveExpenseToPending,
  unmarkLiveExpensePaid,
  updateLiveExpense,
  uploadLiveExpenseReceipt
} from "../data/live-expense-writes.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import { displayDateInput } from "../components/date-value.js";
import { attachLiveSnapshotRefresh } from "../data/live-snapshot-listener.js";

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
    paidOn: "打款日 {date}",
    edit: "編輯",
    remove: "刪除",
    revert: "撤回",
    revertConfirm: "確認撤回審批，重置為待審批？",
    unpay: "撤銷打款",
    unpayConfirm: "確認撤銷打款，重置為未打款？",
    deleteConfirm: "確認刪除這筆報銷？",
    rejectReason: "拒絕理由（選填）",
    modalTitle: "新增報銷",
    editModalTitle: "編輯報銷",
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
    receiptUpload: "選檔後立即上傳到報銷收據庫",
    receiptProgress: "上傳進度 {done}/{total}",
    receiptStatusUploading: "{name} · 上傳中",
    receiptStatusUploaded: "{name} · 已上傳",
    receiptStatusFailed: "{name} · 上傳失敗",
    receiptCleanupFailed: "清理本次新上傳收據失敗，請稍後重試",
    saveFailedRolledBack: "保存失敗，本次新上傳收據已回滾，請重選後重試",
    removeReceipt: "移除收據",
    cancel: "取消",
    submit: "提交",
    save: "保存",
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
    paidOn: "Paid on {date}",
    edit: "Edit",
    remove: "Delete",
    revert: "Revert to pending",
    revertConfirm: "Withdraw approval and reset this reimbursement to pending?",
    unpay: "Undo payment",
    unpayConfirm: "Undo this payment and mark the reimbursement as unpaid?",
    deleteConfirm: "Delete this reimbursement?",
    rejectReason: "Rejection reason (optional)",
    modalTitle: "Add reimbursement",
    editModalTitle: "Edit reimbursement",
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
    receiptUpload: "Uploaded to the receipt store immediately after selection.",
    receiptProgress: "Upload progress {done}/{total}",
    receiptStatusUploading: "{name} · Uploading",
    receiptStatusUploaded: "{name} · Uploaded",
    receiptStatusFailed: "{name} · Upload failed",
    receiptCleanupFailed: "Could not remove the newly uploaded receipts. Please try again.",
    saveFailedRolledBack: "Save failed. Newly uploaded receipts were removed; select them again and retry.",
    removeReceipt: "Remove receipt",
    cancel: "Cancel",
    submit: "Submit",
    save: "Save",
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
    paidOn: "Payé le {date}",
    edit: "Modifier",
    remove: "Supprimer",
    revert: "Repasser en attente",
    revertConfirm: "Retirer l'approbation et remettre ce remboursement en attente ?",
    unpay: "Annuler le paiement",
    unpayConfirm: "Annuler ce paiement et remettre le remboursement en non payé ?",
    deleteConfirm: "Supprimer ce remboursement ?",
    rejectReason: "Motif du refus (facultatif)",
    modalTitle: "Ajouter un remboursement",
    editModalTitle: "Modifier le remboursement",
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
    receiptUpload: "Envoyé au stockage des reçus dès la sélection.",
    receiptProgress: "Progression de l’envoi {done}/{total}",
    receiptStatusUploading: "{name} · Envoi en cours",
    receiptStatusUploaded: "{name} · Envoyé",
    receiptStatusFailed: "{name} · Échec de l’envoi",
    receiptCleanupFailed: "Impossible de supprimer les nouveaux reçus envoyés. Réessayez.",
    saveFailedRolledBack: "Échec de l’enregistrement. Les nouveaux reçus ont été supprimés ; sélectionnez-les de nouveau.",
    removeReceipt: "Retirer le reçu",
    cancel: "Annuler",
    submit: "Envoyer",
    save: "Enregistrer",
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
const EXPENSE_LIVE_SNAPSHOTS = ["expense.json"];
const EXPENSE_LIVE_TABLES = ["expense_reimbursements"];

let state = {
  rows: [],
  filter: "pending",
  draft: null,
  error: "",
  actionError: "",
  writeBusy: false,
  uploadBusy: false,
  uploadProgress: null
};

let currentHelpers = null;
let activeScope = null;
let activeMountId = 0;
let expenseLiveRefresh = null;
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
  return {
    editingId: "",
    date: todayInHongKong(),
    currency: "RMB",
    amount: "",
    category: "Food",
    description: "",
    receipts: [],
    original: null
  };
}

function draftFromExpenseRow(row) {
  const draft = {
    editingId: row.id,
    date: row.date,
    currency: row.currency,
    amount: String(row.amount),
    category: row.category,
    description: row.description,
    receipts: row.receipts.map((receipt) => ({
      ...receipt,
      status: "uploaded",
      path: "",
      newlyUploaded: false,
      showUploadStatus: false
    }))
  };
  draft.original = expenseDraftComparable(draft);
  return draft;
}

function expenseDraftComparable(draft) {
  return {
    date: String(draft.date || ""),
    currency: String(draft.currency || ""),
    amount: String(draft.amount || ""),
    category: String(draft.category || ""),
    description: String(draft.description || ""),
    receiptUrls: draft.receipts
      .filter((receipt) => receipt.status !== "failed" && receipt.status !== "uploading" && receipt.status !== "queued")
      .map((receipt) => String(receipt.url || ""))
  };
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
  // G-exp-5: withdraw only reaches an approved row that has not been paid yet;
  // a paid row must be unpaid first (see renderPayment's canUnpay button).
  const canRevert = isAdmin && row.status === "approved" && !row.paid;
  const canEdit = row.employeeId === ownerKey && row.status === "pending";
  const canDelete = isAdmin || (row.employeeId === ownerKey && row.status === "pending");
  if (!pending && !canRevert && !canEdit && !canDelete) return `<span class="expense-muted">—</span>`;
  const writeAttributes = state.writeBusy ? ' disabled aria-disabled="true"' : "";
  return `<span class="expense-actions">
    ${pending ? `<button type="button" class="expense-action expense-action--approve" data-expense-approve="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "approve"))}</button><button type="button" class="expense-action expense-action--reject" data-expense-reject="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "reject"))}</button>` : ""}
    ${canRevert ? `<button type="button" class="expense-action" data-expense-revert="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "revert"))}</button>` : ""}
    ${canEdit ? `<button type="button" class="expense-action" data-expense-edit="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "edit"))}</button>` : ""}
    ${canDelete ? `<button type="button" class="expense-action expense-action--delete" data-expense-delete="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "remove"))}</button>` : ""}
  </span>`;
}

function renderPayment(row, helpers) {
  const { escapeHtml, lang } = helpers;
  const writeAttributes = state.writeBusy ? ' disabled aria-disabled="true"' : "";
  if (row.paid) {
    const paidDate = displayDateInput(String(row.paidAt || "").slice(0, 10));
    // G-exp-1: undo payment lives alongside the paid badge, symmetric with markPaid below.
    const canUnpay = isAdmin && row.status === "approved";
    return `<span class="expense-payment-cell"><span class="expense-payment expense-payment--paid">${escapeHtml(t(lang, "paid"))}</span>${paidDate ? `<small>${escapeHtml(t(lang, "paidOn", { date: paidDate }))}</small>` : ""}${canUnpay ? `<button type="button" class="expense-action" data-expense-unpay="${escapeHtml(row.id)}" data-expense-write${writeAttributes}>${escapeHtml(t(lang, "unpay"))}</button>` : ""}</span>`;
  }
  if (isAdmin && row.status === "approved") {
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
  return `<div class="expense-table-shell" data-scroll-restore="bizflow.expense.table">
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
  const modalBusy = state.writeBusy || state.uploadBusy;
  const createWriteAttributes = modalBusy ? ' disabled aria-disabled="true"' : "";
  const titleKey = draft.editingId ? "editModalTitle" : "modalTitle";
  const options = (values, selected, label) => values.map((value) => `<option value="${e(value)}"${selected === value ? " selected" : ""}>${e(label(value))}</option>`).join("");
  const uploadStatuses = draft.receipts.filter((receipt) => receipt.showUploadStatus);
  return `<div class="expense-overlay" data-expense-overlay>
    <form class="expense-modal" data-expense-form data-expense-editing-id="${e(draft.editingId)}" role="dialog" aria-modal="true" aria-label="${e(t(lang, titleKey))}">
      <header><h2>${e(t(lang, titleKey))}</h2><button type="button" data-expense-close data-expense-create-write aria-label="${e(t(lang, "close"))}"${createWriteAttributes}>×</button></header>
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
          ${state.uploadProgress ? `<p class="expense-upload__progress" role="status">${e(t(lang, "receiptProgress", state.uploadProgress))}</p>` : ""}
          ${draft.receipts.length ? `<div class="expense-preview-list">${draft.receipts.map((receipt, index) => `<figure data-expense-receipt-status="${e(receipt.status || "uploaded")}"><img src="${e(receipt.url)}" alt="${e(receipt.name)}"><button type="button" data-expense-receipt-remove="${index}" data-expense-create-write aria-label="${e(t(lang, "removeReceipt"))}"${createWriteAttributes}>×</button></figure>`).join("")}</div>` : ""}
          ${uploadStatuses.length ? `<ul class="expense-upload__statuses" aria-live="polite">${uploadStatuses.map((receipt) => `<li data-expense-upload-result="${e(receipt.status)}"><span>${e(t(lang, receipt.status === "failed" ? "receiptStatusFailed" : receipt.status === "uploaded" ? "receiptStatusUploaded" : "receiptStatusUploading", { name: receipt.name }))}</span></li>`).join("")}</ul>` : ""}
        </div>
        ${state.error ? `<p class="expense-error" role="alert">${e(t(lang, state.error))}</p>` : ""}
      </div>
      <footer><button type="button" class="expense-button expense-button--secondary" data-expense-close data-expense-create-write${createWriteAttributes}>${e(t(lang, "cancel"))}</button><button type="submit" class="expense-button" data-expense-create-write${createWriteAttributes}>${e(t(lang, draft.editingId ? "save" : "submit"))}</button></footer>
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
    if (String(receipt.url || "").startsWith("blob:")) URL.revokeObjectURL(receipt.url);
  });
}

function newDraftReceiptPaths(draft = state.draft) {
  return (draft?.receipts ?? [])
    .filter((receipt) => receipt.newlyUploaded && receipt.path)
    .map((receipt) => receipt.path);
}

async function discardNewDraftReceipts(draft) {
  const paths = newDraftReceiptPaths(draft);
  if (!paths.length) return true;
  await deleteLiveExpenseReceiptUploads(paths);
  return true;
}

function isExpenseRefreshBlocked() {
  return state.writeBusy || state.uploadBusy || Boolean(state.draft);
}

async function refreshExpenseRows(mountId = activeMountId, scope = activeScope) {
  const nextSnapshot = await getExpenseData();
  if (!isCurrentExpenseMount(mountId, scope)) return false;
  snapshot = nextSnapshot;
  state.rows = normalizeExpenseRows(nextSnapshot.reimbursements);
  return true;
}

async function closeModal() {
  if (state.writeBusy || state.uploadBusy) return;
  const draft = state.draft;
  if (!draft) return;
  const mountId = activeMountId;
  const scope = activeScope;
  if (newDraftReceiptPaths(draft).length) {
    state.uploadBusy = true;
    state.error = "";
    rerender();
    try {
      await discardNewDraftReceipts(draft);
    } catch (error) {
      if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
      console.warn("Expense receipt cleanup failed", error);
      state.uploadBusy = false;
      state.error = "receiptCleanupFailed";
      rerender();
      return;
    }
  }
  if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
  expenseDatePanel.close({ restoreFocus: false });
  revokeReceipts(draft.receipts);
  state.draft = null;
  state.uploadBusy = false;
  state.uploadProgress = null;
  state.error = "";
  rerender();
  void expenseLiveRefresh?.flush();
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
    rerender();
    try {
      await refreshExpenseRows(mountId, scope);
    } catch (error) {
      if (isCurrentExpenseMount(mountId, scope)) console.warn("Expense refresh after action failed", error);
    }
  } catch (error) {
    if (!isCurrentExpenseMount(mountId, scope)) return;
    console.warn("Expense action failed", error);
    state.actionError = "actionFailed";
  } finally {
    if (!isCurrentExpenseMount(mountId, scope)) return;
    state.writeBusy = false;
    rerender();
    await expenseLiveRefresh?.flush();
  }
}

async function onExpenseClick(event) {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  if (state.writeBusy && event.target.closest("[data-expense-write]")) return;
  if ((state.writeBusy || state.uploadBusy) && event.target.closest("[data-expense-create-write]")) return;
  const filter = event.target.closest("[data-expense-filter]");
  if (filter) {
    const value = filter.getAttribute("data-expense-filter");
    if (filters.includes(value)) state.filter = value;
    rerender();
    return;
  }
  if (event.target.closest("[data-expense-new]")) {
    state.draft = blankDraft();
    state.uploadProgress = null;
    state.error = "";
    state.actionError = "";
    rerender();
    return;
  }
  const edit = event.target.closest("[data-expense-edit]");
  if (edit) {
    const row = findExpenseRow(edit.getAttribute("data-expense-edit"));
    if (!row || row.employeeId !== ownerKey || row.status !== "pending") return;
    state.draft = draftFromExpenseRow(row);
    state.uploadProgress = null;
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
    await closeModal();
    return;
  }
  const receiptRemove = event.target.closest("[data-expense-receipt-remove]");
  if (receiptRemove && state.draft) {
    const index = Number(receiptRemove.getAttribute("data-expense-receipt-remove"));
    const receipt = state.draft.receipts[index];
    if (receipt?.newlyUploaded && receipt.path && authenticated) {
      const draft = state.draft;
      const mountId = activeMountId;
      const scope = activeScope;
      state.uploadBusy = true;
      state.error = "";
      rerender();
      try {
        await deleteLiveExpenseReceiptUploads([receipt.path]);
      } catch (error) {
        if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
        console.warn("Expense receipt removal failed", error);
        state.uploadBusy = false;
        state.error = "receiptCleanupFailed";
        rerender();
        return;
      }
      if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
      state.uploadBusy = false;
    }
    const [removedReceipt] = state.draft.receipts.splice(index, 1);
    if (removedReceipt) revokeReceipts([removedReceipt]);
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
  const revert = event.target.closest("[data-expense-revert]");
  if (revert) {
    const row = findExpenseRow(revert.getAttribute("data-expense-revert"));
    const canRevert = row && isAdmin && row.status === "approved" && !row.paid;
    if (canRevert && await confirmInPage(t(currentHelpers?.lang ?? "zh", "revertConfirm"))) {
      if (!activeScope?.isCurrent()) return;
      if (authenticated) {
        await performLiveExpenseWrite(() => revertLiveExpenseToPending(row.id), (result) => replaceExpenseRow(row, result));
      } else {
        state.actionError = "";
        row.status = "pending";
        row.rejectReason = "";
        row.paid = false;
        row.paidAt = "";
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
  const unpay = event.target.closest("[data-expense-unpay]");
  if (unpay) {
    const row = findExpenseRow(unpay.getAttribute("data-expense-unpay"));
    const canUnpay = row && isAdmin && row.status === "approved" && row.paid;
    if (canUnpay && await confirmInPage(t(currentHelpers?.lang ?? "zh", "unpayConfirm"))) {
      if (!activeScope?.isCurrent()) return;
      if (authenticated) {
        await performLiveExpenseWrite(() => unmarkLiveExpensePaid(row.id), (result) => replaceExpenseRow(row, result));
      } else {
        state.actionError = "";
        row.paid = false;
        row.paidAt = "";
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
  if ((state.writeBusy || state.uploadBusy) && event.target.closest("[data-expense-create-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (!field || !state.draft) return;
  state.draft[field.getAttribute("data-expense-field")] = field.value;
  state.error = "";
}

async function onExpenseChange(event) {
  if (liveReadOnly && event.target.closest("[data-expense-write]")) return;
  if ((state.writeBusy || state.uploadBusy) && event.target.closest("[data-expense-create-write]")) return;
  const field = event.target.closest("[data-expense-field]");
  if (field && state.draft) {
    state.draft[field.getAttribute("data-expense-field")] = field.value;
    state.error = "";
  }
  const fileInput = event.target.closest("[data-expense-receipts]");
  if (!fileInput || !state.draft) return;
  const files = [...fileInput.files].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  const draft = state.draft;
  const mountId = activeMountId;
  const scope = activeScope;
  const receipts = files.map((file) => ({
    file,
    url: URL.createObjectURL(file),
    name: file.name,
    status: authenticated ? "queued" : "local",
    path: "",
    newlyUploaded: false,
    showUploadStatus: authenticated
  }));
  draft.receipts.push(...receipts);
  state.error = "";
  if (!authenticated) {
    rerender();
    return;
  }

  state.uploadBusy = true;
  state.uploadProgress = { done: 0, total: receipts.length };
  rerender();
  for (const [index, receipt] of receipts.entries()) {
    if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) break;
    receipt.status = "uploading";
    rerender();
    try {
      const uploaded = await uploadLiveExpenseReceipt(receipt.file);
      if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) {
        try {
          await deleteLiveExpenseReceiptUploads([uploaded.path]);
        } catch (cleanupError) {
          console.warn("Detached expense receipt cleanup failed", cleanupError);
        }
        break;
      }
      revokeReceipts([receipt]);
      receipt.file = null;
      receipt.url = uploaded.url;
      receipt.path = uploaded.path;
      receipt.newlyUploaded = true;
      receipt.status = "uploaded";
    } catch (error) {
      if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) break;
      console.warn(`Expense receipt upload failed: ${receipt.name}`, error);
      receipt.status = "failed";
    }
    state.uploadProgress = { done: index + 1, total: receipts.length };
    rerender();
  }
  if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
  state.uploadBusy = false;
  state.uploadProgress = null;
  rerender();
}

async function onExpenseSubmit(event) {
  if (!event.target.matches("[data-expense-form]") || !state.draft) return;
  event.preventDefault();
  if (state.writeBusy || state.uploadBusy) return;
  const amount = Number(state.draft.amount);
  if (!state.draft.date) state.error = "dateRequired";
  else if (!Number.isFinite(amount) || amount <= 0) state.error = "amountRequired";
  else if (!categories.includes(state.draft.category)) state.error = "categoryRequired";
  else if (authenticated) {
    const mountId = activeMountId;
    const scope = activeScope;
    const draft = state.draft;
    const editingRow = draft.editingId ? findExpenseRow(draft.editingId) : null;
    if (draft.editingId && (!editingRow || editingRow.employeeId !== ownerKey || editingRow.status !== "pending")) {
      state.error = "actionFailed";
      rerender();
      return;
    }
    state.writeBusy = true;
    state.error = "";
    rerender();
    try {
      const payload = {
        date: state.draft.date,
        amount,
        currency: state.draft.currency,
        category: expenseCategoryDbValues[state.draft.category],
        description: state.draft.description.trim(),
        receiptUrls: state.draft.receipts
          .filter((receipt) => !["failed", "uploading", "queued"].includes(receipt.status))
          .map((receipt) => receipt.url)
          .filter(Boolean)
      };
      const result = draft.editingId
        ? await updateLiveExpense(draft.editingId, payload)
        : await createLiveExpense(payload);
      if (!isCurrentExpenseMount(mountId, scope)) return;
      if (draft.editingId) replaceExpenseRow(editingRow, result);
      else {
        const row = normalizeExpenseRows([{ ...result.row, employee: currentUser.name }])[0];
        state.rows.unshift(row);
        state.filter = isAdmin ? "pending" : "mine";
      }
      revokeReceipts(draft.receipts);
      state.draft = null;
      state.error = "";
      try {
        await refreshExpenseRows(mountId, scope);
      } catch (error) {
        if (isCurrentExpenseMount(mountId, scope)) console.warn("Expense refresh after save failed", error);
      }
    } catch (error) {
      if (!isCurrentExpenseMount(mountId, scope)) return;
      console.warn("Expense submission failed", error);
      const uploadedReceipts = draft.receipts.filter((receipt) => receipt.newlyUploaded && receipt.path);
      if (uploadedReceipts.length) {
        try {
          await discardNewDraftReceipts(draft);
          if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
          draft.receipts = draft.receipts.filter((receipt) => !receipt.newlyUploaded);
          state.error = "saveFailedRolledBack";
        } catch (cleanupError) {
          if (!isCurrentExpenseMount(mountId, scope) || state.draft !== draft) return;
          console.warn("Expense receipt rollback failed", cleanupError);
          state.error = "receiptCleanupFailed";
        }
      } else state.error = "saveFailed";
    } finally {
      if (!isCurrentExpenseMount(mountId, scope)) return;
      state.writeBusy = false;
    }
    rerender();
    await expenseLiveRefresh?.flush();
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
      paidAt: "",
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
  if (event.key === "Escape" && state.draft) void closeModal();
}

function hasExpenseUnsavedChanges() {
  if (!state.draft) return false;
  if (state.draft.original) {
    if (state.draft.receipts.some((receipt) => ["queued", "uploading", "failed"].includes(receipt.status))) return true;
    return JSON.stringify(expenseDraftComparable(state.draft)) !== JSON.stringify(state.draft.original);
  }
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
    writeBusy: false,
    uploadBusy: false,
    uploadProgress: null
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
      expenseLiveRefresh = attachLiveSnapshotRefresh({
        scope,
        snapshots: EXPENSE_LIVE_SNAPSHOTS,
        tables: EXPENSE_LIVE_TABLES,
        isBlocked: isExpenseRefreshBlocked,
        async refresh({ defer, isCurrent }) {
          const nextSnapshot = await getExpenseData();
          if (!isCurrent()) return;
          if (isExpenseRefreshBlocked()) {
            defer();
            return;
          }
          snapshot = nextSnapshot;
          state.rows = normalizeExpenseRows(nextSnapshot.reimbursements);
          rerender();
        }
      });
    },
    hasUnsavedChanges: hasExpenseUnsavedChanges,
    async canLeave() {
      if (!hasExpenseUnsavedChanges()) return true;
      return confirmInPage(t(currentHelpers?.lang ?? "zh", "leaveUnsaved"));
    },
    captureState: () => ({ filter: state.filter }),
    dispose() {
      const draft = state.draft;
      const cleanupPaths = newDraftReceiptPaths(draft);
      if (authenticated && cleanupPaths.length) {
        void deleteLiveExpenseReceiptUploads(cleanupPaths)
          .catch((error) => console.warn("Expense receipt cleanup on leave failed", error));
      }
      if (activeMountId === mountId) activeMountId += 1;
      if (draft) revokeReceipts(draft.receipts);
      state.rows.forEach((row) => revokeReceipts(row.receipts ?? []));
      snapshot = null;
      currentUser = null;
      unread = null;
      currentHelpers = null;
      if (activeScope === scope) activeScope = null;
      expenseLiveRefresh = null;
      expenseDatePanel.close({ restoreFocus: false });
      state.draft = null;
    }
  };
}
