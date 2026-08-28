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
    reviewConfirm: "確認按現有商品映射補扣這張訂單的庫存，並寫入審核記錄？",
    dismissConfirm: "確認忽略此單？發票將標記為不扣庫存並移出待扣清單，發票本身不會刪除。",
    duplicateConfirm: "此發票已有 {count} 件庫存扣減記錄。再次確認會重複扣庫存，是否繼續？",
    reviewDone: "庫存補扣與審核記錄已完成",
    dismissDone: "此單已標記為不扣庫存",
    reviewFailed: "庫存補扣失敗，請重試",
    dismissFailed: "忽略此單失敗，請重試",
    orderMissing: "找不到這張訂單的即時記錄，請重新載入頁面",
    empty: "無待處理扣減",
    viewOrder: "查看訂單詳情",
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
    reviewConfirm: "Deduct stock for this order using the current product mappings and write the audit record?",
    dismissConfirm: "Dismiss this order? The invoice will be marked as no stock deduction and removed from this list. The invoice itself is not deleted.",
    duplicateConfirm: "This invoice already has deductions for {count} items. Continuing will deduct stock again. Continue?",
    reviewDone: "Stock deduction and audit recording are complete",
    dismissDone: "The order is marked as no stock deduction",
    reviewFailed: "Could not deduct stock. Try again",
    dismissFailed: "Could not dismiss the order. Try again",
    orderMissing: "The live order record could not be found. Reload the page",
    empty: "No pending deductions",
    viewOrder: "View order details",
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
    reviewConfirm: "Déduire le stock de cette commande selon les mappages actuels et enregistrer l’audit ?",
    dismissConfirm: "Ignorer cette commande ? La facture sera marquée sans déduction de stock et retirée de cette liste. Elle ne sera pas supprimée.",
    duplicateConfirm: "Cette facture contient déjà des déductions pour {count} articles. Continuer déduira le stock une seconde fois. Continuer ?",
    reviewDone: "La déduction du stock et l’audit sont terminés",
    dismissDone: "La commande est marquée sans déduction de stock",
    reviewFailed: "Impossible de déduire le stock. Réessayez",
    dismissFailed: "Impossible d’ignorer la commande. Réessayez",
    orderMissing: "La commande active est introuvable. Rechargez la page",
    empty: "Aucune déduction en attente",
    viewOrder: "Voir la commande",
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
  feedback: ""
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
    const review = event.target.closest("[data-pending-review]");
    if (review && await confirmInPage(t(currentLang(), "reviewConfirm"))) {
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
      rerender();
      try {
        try {
          await reviewLivePendingDeduction(invoiceId);
        } catch (error) {
          if (error?.code !== "PENDING_DEDUCTION_DUPLICATE") throw error;
          const accepted = await confirmInPage(t(currentLang(), "duplicateConfirm", {
            count: error?.detail?.deductedQty || 0
          }), { danger: true });
          if (!accepted || !scope.isCurrent()) return;
          await reviewLivePendingDeduction(invoiceId, { allowDuplicate: true });
        }
        if (!scope.isCurrent()) return;
        state.feedback = t(currentLang(), "reviewDone");
        removeInvoice(orderNo);
      } catch {
        state.error = t(currentLang(), "reviewFailed");
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
        state.feedback = t(currentLang(), "dismissDone");
        removeInvoice(orderNo);
      } catch {
        state.error = t(currentLang(), "dismissFailed");
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
  liveReadOnly = false;
  rerender = () => {};
}

function currentLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
