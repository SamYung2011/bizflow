import { getOrdersPageData, getPendingDeductionData } from "../data/provider.js";
import { renderManagementList } from "../components/management-list.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import {
  dismissLivePendingDeduction,
  reviewLivePendingDeduction
} from "../data/live-inventory-writes.js";

const copy = {
  zh: {
    title: "待扣庫存",
    auditTitle: "人工審核期",
    auditBody: "以下訂單已付款但尚未扣庫存，請逐張確認扣減。完成後會寫入庫存流水與審核記錄。",
    review: "審核扣減",
    dismiss: "忽略此單",
    reviewConfirm: "確認執行已預覽的扣減計劃（扣減 {count} 項），並寫入審核記錄？",
    dismissConfirm: "確認忽略此單？發票將標記為不扣庫存並移出待扣清單，發票本身不會刪除。",
    duplicateConfirm: "此發票已有 {count} 件庫存扣減記錄。再次確認會重複扣庫存，是否繼續？",
    reviewDone: "庫存補扣與審核記錄已完成",
    dismissDone: "此單已標記為不扣庫存",
    reviewFailed: "庫存補扣失敗，請重試",
    dismissFailed: "忽略此單失敗，請重試",
    orderMissing: "找不到這張訂單的即時記錄，請重新載入頁面",
    empty: "無待處理扣減",
    viewOrder: "查看訂單詳情",
    planTitle: "扣減計劃",
    planHint: "先核對商品、倉庫與扣減前後數量，再確認寫入。此步只預覽，不會改動庫存。",
    planDeductable: "會扣減",
    planSkipped: "會跳過",
    planTotal: "總計",
    planProduct: "商品",
    planWarehouse: "倉庫",
    planCurrent: "現有量",
    planDeduct: "扣多少",
    planAfter: "扣後量",
    planDecision: "處理",
    planReason: "原因",
    planApply: "扣減",
    planSkip: "跳過",
    planConfirmButton: "確認扣減 {count} 項",
    cancel: "取消",
    operationFailed: "操作失敗",
    "歷史發票": "歷史發票",
    "百老匯渠道": "百老匯渠道",
    "已標記為歷史，不扣庫存": "已標記為歷史，不扣庫存",
    "百老匯渠道：不扣本地庫存": "百老匯渠道：不扣本地庫存",
    "未配 line item 映射": "未配 line item 映射",
    "虛擬產品": "虛擬產品",
    "已歸檔老產品": "已歸檔老產品",
    "父 SKU 不扣": "父 SKU 不扣",
    "無倉庫": "無倉庫",
    "alias 標記為不扣": "alias 標記為不扣",
    "alias 未配產品": "alias 未配產品",
    "alias 引用的產品已刪除": "alias 引用的產品已刪除",
    sourceFramer: "Framer",
    sourceShopify: "Online Store",
    sourceManual: "Manual",
    loading: "正在載入待扣庫存"
  },
  en: {
    title: "Pending stock deductions",
    auditTitle: "Manual review period",
    auditBody: "These paid orders have not deducted stock. Confirm each deduction. Stock movements and audit records are written when complete.",
    review: "Review deduction",
    dismiss: "Dismiss order",
    reviewConfirm: "Apply the reviewed deduction plan ({count} deductions) and write the audit record?",
    dismissConfirm: "Dismiss this order? The invoice will be marked as no stock deduction and removed from this list. The invoice itself is not deleted.",
    duplicateConfirm: "This invoice already has deductions for {count} items. Continuing will deduct stock again. Continue?",
    reviewDone: "Stock deduction and audit recording are complete",
    dismissDone: "The order is marked as no stock deduction",
    reviewFailed: "Could not deduct stock. Try again",
    dismissFailed: "Could not dismiss the order. Try again",
    orderMissing: "The live order record could not be found. Reload the page",
    empty: "No pending deductions",
    viewOrder: "View order details",
    planTitle: "Deduction plan",
    planHint: "Check the product, warehouse, and quantities before confirming. This preview does not change stock.",
    planDeductable: "Will deduct",
    planSkipped: "Will skip",
    planTotal: "Total",
    planProduct: "Product",
    planWarehouse: "Warehouse",
    planCurrent: "Current",
    planDeduct: "Deduct",
    planAfter: "After",
    planDecision: "Action",
    planReason: "Reason",
    planApply: "Deduct",
    planSkip: "Skip",
    planConfirmButton: "Confirm {count} deductions",
    cancel: "Cancel",
    operationFailed: "Operation failed",
    "歷史發票": "Historical invoice",
    "百老匯渠道": "Broadway channel",
    "已標記為歷史，不扣庫存": "Marked as historical; stock is not deducted",
    "百老匯渠道：不扣本地庫存": "Broadway channel; local stock is not deducted",
    "未配 line item 映射": "No line item mapping",
    "虛擬產品": "Virtual product",
    "已歸檔老產品": "Archived legacy product",
    "父 SKU 不扣": "Parent SKU is not deducted",
    "無倉庫": "No warehouse",
    "alias 標記為不扣": "Alias is marked as no deduction",
    "alias 未配產品": "Alias has no mapped product",
    "alias 引用的產品已刪除": "The product referenced by the alias was deleted",
    sourceFramer: "Framer",
    sourceShopify: "Online Store",
    sourceManual: "Manual",
    loading: "Loading pending deductions"
  },
  fr: {
    title: "Déductions de stock en attente",
    auditTitle: "Période de contrôle manuel",
    auditBody: "Ces commandes payées n'ont pas encore déduit le stock. Confirmez chaque déduction. Les mouvements et l'audit sont enregistrés à la fin.",
    review: "Vérifier la déduction",
    dismiss: "Ignorer la commande",
    reviewConfirm: "Appliquer le plan vérifié ({count} déductions) et enregistrer l’audit ?",
    dismissConfirm: "Ignorer cette commande ? La facture sera marquée sans déduction de stock et retirée de cette liste. Elle ne sera pas supprimée.",
    duplicateConfirm: "Cette facture contient déjà des déductions pour {count} articles. Continuer déduira le stock une seconde fois. Continuer ?",
    reviewDone: "La déduction du stock et l’audit sont terminés",
    dismissDone: "La commande est marquée sans déduction de stock",
    reviewFailed: "Impossible de déduire le stock. Réessayez",
    dismissFailed: "Impossible d’ignorer la commande. Réessayez",
    orderMissing: "La commande active est introuvable. Rechargez la page",
    empty: "Aucune déduction en attente",
    viewOrder: "Voir la commande",
    planTitle: "Plan de déduction",
    planHint: "Vérifiez le produit, l’entrepôt et les quantités avant de confirmer. Cet aperçu ne modifie pas le stock.",
    planDeductable: "À déduire",
    planSkipped: "À ignorer",
    planTotal: "Total",
    planProduct: "Produit",
    planWarehouse: "Entrepôt",
    planCurrent: "Actuel",
    planDeduct: "Déduire",
    planAfter: "Après",
    planDecision: "Action",
    planReason: "Raison",
    planApply: "Déduire",
    planSkip: "Ignorer",
    planConfirmButton: "Confirmer {count} déductions",
    cancel: "Annuler",
    operationFailed: "Échec de l'opération",
    "歷史發票": "Facture historique",
    "百老匯渠道": "Canal Broadway",
    "已標記為歷史，不扣庫存": "Marquée comme historique ; le stock n’est pas déduit",
    "百老匯渠道：不扣本地庫存": "Canal Broadway ; le stock local n’est pas déduit",
    "未配 line item 映射": "Aucun mappage de ligne",
    "虛擬產品": "Produit virtuel",
    "已歸檔老產品": "Ancien produit archivé",
    "父 SKU 不扣": "Le SKU parent n’est pas déduit",
    "無倉庫": "Aucun entrepôt",
    "alias 標記為不扣": "L’alias est marqué sans déduction",
    "alias 未配產品": "L’alias n’a aucun produit associé",
    "alias 引用的產品已刪除": "Le produit référencé par l’alias a été supprimé",
    sourceFramer: "Framer",
    sourceShopify: "Online Store",
    sourceManual: "Manual",
    loading: "Chargement des déductions"
  }
};

const state = {
  loaded: false,
  orderLinksLoaded: false,
  invoices: [],
  orderIds: new Map(),
  busy: false,
  error: "",
  feedback: "",
  preview: null
};

let rerender = () => {};
let liveReadOnly = false;
let dataLoadVersion = 0;

function t(lang, key, values = {}) {
  const template = copy[lang]?.[key] ?? copy.zh[key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
}

export async function ensurePendingDeductionData({ scope = null, signal = scope?.signal } = {}) {
  if (state.loaded) return;
  const version = dataLoadVersion;
  const pending = await getPendingDeductionData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.invoices = pending.invoices;
  state.loaded = true;
}

export async function ensurePendingOrderLinks({ scope = null, signal = scope?.signal } = {}) {
  if (state.orderLinksLoaded) return;
  const version = dataLoadVersion;
  const orders = await getOrdersPageData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  state.orderIds = new Map(orders.orders.map((order) => [order.detail?.orderNo, order.id]).filter(([orderNo]) => orderNo));
  state.orderLinksLoaded = true;
}

export function pendingDeductionCount() {
  return state.loaded ? state.invoices.length : null;
}

function sourceLabel(source, lang) {
  if (source === "Framer") return t(lang, "sourceFramer");
  if (source === "Online Store" || source === "Shopify") return t(lang, "sourceShopify");
  if (source === "Manual") return t(lang, "sourceManual");
  return source;
}

function renderInvoice(invoice, helpers) {
  const { escapeHtml, lang } = helpers;
  const orderId = state.orderIds.get(invoice.orderNo);
  const orderNo = orderId
    ? `<a href="./orders-detail.html?id=${encodeURIComponent(orderId)}" title="${escapeHtml(t(lang, "viewOrder"))}" data-pending-order-link data-order-id="${escapeHtml(orderId)}">${escapeHtml(invoice.orderNo)}</a>`
    : `<span>${escapeHtml(invoice.orderNo)}</span>`;
  return `<article class="management-list__row pending-deduction-row" data-pending-invoice="${escapeHtml(invoice.orderNo)}">
    <div class="pending-deduction-row__main">
      <div class="pending-deduction-row__head">${orderNo}<span>${escapeHtml(sourceLabel(invoice.source, lang))}</span></div>
      <div class="pending-deduction-row__customer"><strong title="${escapeHtml(invoice.customer)}">${escapeHtml(invoice.customer)}</strong><span>${escapeHtml(invoice.phone)}</span><span>${escapeHtml(invoice.date)}</span></div>
      <div class="pending-deduction-row__items">${invoice.items.slice(0, 2).map((item) => `<span title="${escapeHtml(item.name)}">${escapeHtml(item.name)} ×${escapeHtml(String(item.qty))}</span>`).join("")}</div>
    </div>
    <div class="pending-deduction-row__tail"><strong>HKD$ ${escapeHtml(Number(invoice.amount).toLocaleString("en-US"))}</strong><div><button type="button" class="inventory-domain-button inventory-domain-button--small" data-pending-review="${escapeHtml(invoice.orderNo)}" data-inventory-write${liveReadOnly || state.busy ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "review"))}</button><button type="button" class="inventory-domain-button inventory-domain-button--small inventory-domain-button--danger" data-pending-dismiss="${escapeHtml(invoice.orderNo)}" data-inventory-write${liveReadOnly || state.busy ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "dismiss"))}</button></div></div>
  </article>`;
}

function renderDeductionPreview(helpers) {
  if (!state.preview) return "";
  const { escapeHtml, lang } = helpers;
  const preview = state.preview;
  const value = (number) => number == null ? "—" : String(number);
  return `<section class="pending-deduction-preview" data-pending-plan data-pending-plan-invoice="${escapeHtml(preview.invoiceId)}">
    <div class="pending-deduction-preview__head"><div><h3>${escapeHtml(t(lang, "planTitle"))} · ${escapeHtml(preview.orderNo)}</h3><p>${escapeHtml(t(lang, "planHint"))}</p></div></div>
    <div class="pending-deduction-stats"><span><strong>${escapeHtml(String(preview.deductions || 0))}</strong>${escapeHtml(t(lang, "planDeductable"))}</span><span><strong>${escapeHtml(String(preview.skipped || 0))}</strong>${escapeHtml(t(lang, "planSkipped"))}</span><span><strong>${escapeHtml(String(preview.plan?.length || 0))}</strong>${escapeHtml(t(lang, "planTotal"))}</span></div>
    <div class="pending-deduction-plan" role="table">
      <div class="pending-deduction-plan__head" role="row"><span>${escapeHtml(t(lang, "planProduct"))}</span><span>${escapeHtml(t(lang, "planWarehouse"))}</span><span>${escapeHtml(t(lang, "planCurrent"))}</span><span>${escapeHtml(t(lang, "planDeduct"))}</span><span>${escapeHtml(t(lang, "planAfter"))}</span><span>${escapeHtml(t(lang, "planDecision"))}</span><span>${escapeHtml(t(lang, "planReason"))}</span></div>
      ${(preview.plan || []).map((row) => `<div class="pending-deduction-plan__row" role="row" data-pending-plan-skip="${row.skip === true}"><span title="${escapeHtml(row.name)}">${escapeHtml(t(lang, row.product_name || row.name) || "—")}</span><span>${escapeHtml(row.warehouse_name || "—")}</span><span>${escapeHtml(value(row.current))}</span><span>${escapeHtml(value(row.qty))}</span><span>${escapeHtml(value(row.after))}</span><span>${escapeHtml(t(lang, row.skip ? "planSkip" : "planApply"))}</span><span title="${escapeHtml(row.reason || "")}">${escapeHtml(row.reason ? t(lang, row.reason) : "—")}</span></div>`).join("")}
    </div>
    <div class="inventory-domain-actions"><button type="button" class="inventory-domain-button inventory-domain-button--secondary" data-pending-plan-cancel${state.busy ? " disabled" : ""}>${escapeHtml(t(lang, "cancel"))}</button><button type="button" class="inventory-domain-button" data-pending-plan-confirm data-inventory-write${liveReadOnly || state.busy ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "planConfirmButton", { count: preview.deductions || 0 }))}</button></div>
  </section>`;
}

export function renderPendingDeduction(helpers) {
  liveReadOnly = helpers.liveReadOnly === true;
  const { escapeHtml, icon, lang } = helpers;
  if (!state.loaded) return `<div class="inventory-domain-empty">${escapeHtml(t(lang, "loading"))}</div>`;
  const content = state.invoices.length
    ? state.invoices.map((invoice) => renderInvoice(invoice, helpers)).join("")
    : `<div class="management-list__empty inventory-domain-empty">${icon("icon-task-done", "icon")}<span>${escapeHtml(t(lang, "empty"))}</span></div>`;
  return `<section class="inventory-domain-page pending-deduction-page" data-pending-page data-pending-count="${state.invoices.length}">
    <div class="inventory-domain-heading"><h2>${escapeHtml(t(lang, "title"))}<span>${state.invoices.length}</span></h2></div>
    ${state.error ? `<p class="inventory-domain-error">${escapeHtml(state.error)}</p>` : ""}
    ${state.feedback ? `<p class="inventory-domain-hint">${escapeHtml(state.feedback)}</p>` : ""}
    <div class="pending-deduction-banner">${icon("icon-task-alert", "icon")}<div><strong>${escapeHtml(t(lang, "auditTitle"))}</strong><p>${escapeHtml(t(lang, "auditBody"))}</p></div></div>
    ${renderDeductionPreview(helpers)}
    ${renderManagementList({ content })}
  </section>`;
}

function removeInvoice(orderNo) {
  if (liveReadOnly) return;
  state.invoices = state.invoices.filter((invoice) => invoice.orderNo !== orderNo);
  rerender();
}

export function attachPendingDeductionBehaviors({ rerender: nextRerender, scope }) {
  rerender = nextRerender;
  scope.listen(document, "click", async (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    if (event.target.closest("[data-pending-plan-cancel]")) {
      state.preview = null;
      state.error = "";
      rerender();
      return;
    }
    const planConfirm = event.target.closest("[data-pending-plan-confirm]");
    if (planConfirm && state.preview && await confirmInPage(t(currentLang(), "reviewConfirm", {
      count: state.preview.deductions || 0
    }))) {
      if (!scope.isCurrent()) return;
      const preview = state.preview;
      state.busy = true;
      state.error = "";
      state.feedback = "";
      rerender();
      try {
        await reviewLivePendingDeduction(preview.invoiceId, { allowDuplicate: preview.allowDuplicate === true });
        if (!scope.isCurrent()) return;
        state.preview = null;
        state.feedback = t(currentLang(), "reviewDone");
        removeInvoice(preview.orderNo);
      } catch (error) {
        state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    const review = event.target.closest("[data-pending-review]");
    if (review) {
      if (!scope.isCurrent()) return;
      const orderNo = review.getAttribute("data-pending-review");
      const invoiceId = state.orderIds.get(orderNo);
      if (!invoiceId) {
        state.error = t(currentLang(), "orderMissing");
        rerender();
        return;
      }
      state.busy = true;
      state.error = "";
      state.feedback = "";
      state.preview = null;
      rerender();
      try {
        let allowDuplicate = false;
        let preview;
        try {
          preview = await reviewLivePendingDeduction(invoiceId, { dryRun: true });
        } catch (error) {
          if (error?.code !== "PENDING_DEDUCTION_DUPLICATE") throw error;
          const accepted = await confirmInPage(t(currentLang(), "duplicateConfirm", {
            count: error?.detail?.deductedQty || 0
          }), { danger: true });
          if (!accepted || !scope.isCurrent()) return;
          allowDuplicate = true;
          preview = await reviewLivePendingDeduction(invoiceId, { allowDuplicate: true, dryRun: true });
        }
        if (!scope.isCurrent()) return;
        state.preview = { ...preview, orderNo, allowDuplicate };
      } catch (error) {
        state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
      return;
    }
    const dismiss = event.target.closest("[data-pending-dismiss]");
    if (dismiss && await confirmInPage(t(currentLang(), "dismissConfirm"), { danger: true })) {
      if (!scope.isCurrent()) return;
      const orderNo = dismiss.getAttribute("data-pending-dismiss");
      const invoiceId = state.orderIds.get(orderNo);
      if (!invoiceId) {
        state.error = t(currentLang(), "orderMissing");
        rerender();
        return;
      }
      state.busy = true;
      state.error = "";
      state.feedback = "";
      rerender();
      try {
        await dismissLivePendingDeduction(invoiceId);
        if (!scope.isCurrent()) return;
        if (state.preview?.invoiceId === invoiceId) state.preview = null;
        state.feedback = t(currentLang(), "dismissDone");
        removeInvoice(orderNo);
      } catch (error) {
        state.error = `${t(currentLang(), "operationFailed")}: ${error.message}`;
      } finally {
        state.busy = false;
        if (scope.isCurrent()) rerender();
      }
    }
  });
}

export function disposePendingDeductionState() {
  dataLoadVersion += 1;
  state.loaded = false;
  state.orderLinksLoaded = false;
  state.invoices = [];
  state.orderIds = new Map();
  state.busy = false;
  state.error = "";
  state.feedback = "";
  state.preview = null;
  liveReadOnly = false;
  rerender = () => {};
}

function currentLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
