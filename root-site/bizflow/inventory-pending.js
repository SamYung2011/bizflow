import { getOrdersPageData, getPendingDeductionData } from "../data/provider.js";
import { renderManagementList } from "../components/management-list.js";
import { confirmInPage } from "../components/confirm-dialog.js";

const copy = {
  zh: {
    title: "待扣庫存",
    auditTitle: "人工審核期",
    auditBody: "以下訂單已付款但尚未扣庫存，請逐張查看扣減計劃。正式寫入與 audit 記錄待 API 接入。",
    review: "審核扣減",
    dismiss: "忽略此單",
    reviewConfirm: "確認本地標記這張訂單已完成扣減審核？",
    dismissConfirm: "確認本地忽略這張訂單？訂單本身不會刪除。",
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
    auditBody: "These paid orders have not deducted stock. Review each deduction plan. API writes and audit records will be connected later.",
    review: "Review deduction",
    dismiss: "Dismiss order",
    reviewConfirm: "Mark this order as reviewed in local state?",
    dismissConfirm: "Dismiss this order locally? The order itself will not be deleted.",
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
    auditBody: "Ces commandes payées n'ont pas encore déduit le stock. Vérifiez chaque plan. Les écritures API et l'audit seront connectés ultérieurement.",
    review: "Vérifier la déduction",
    dismiss: "Ignorer la commande",
    reviewConfirm: "Marquer cette commande comme vérifiée dans l'état local ?",
    dismissConfirm: "Ignorer cette commande localement ? La commande ne sera pas supprimée.",
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
  orderIds: new Map()
};

let rerender = () => {};
let attached = false;
let liveReadOnly = false;

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

export async function ensurePendingDeductionData() {
  if (state.loaded) return;
  const pending = await getPendingDeductionData();
  state.invoices = pending.invoices;
  state.loaded = true;
}

export async function ensurePendingOrderLinks() {
  if (state.orderLinksLoaded) return;
  const orders = await getOrdersPageData();
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
    <div class="pending-deduction-row__tail"><strong>HKD$ ${escapeHtml(Number(invoice.amount).toLocaleString("en-US"))}</strong><div><button type="button" class="inventory-domain-button inventory-domain-button--small" data-pending-review="${escapeHtml(invoice.orderNo)}" data-inventory-write${liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "review"))}</button><button type="button" class="inventory-domain-button inventory-domain-button--small inventory-domain-button--danger" data-pending-dismiss="${escapeHtml(invoice.orderNo)}" data-inventory-write${liveReadOnly ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(t(lang, "dismiss"))}</button></div></div>
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
    <div class="pending-deduction-banner">${icon("icon-task-alert", "icon")}<div><strong>${escapeHtml(t(lang, "auditTitle"))}</strong><p>${escapeHtml(t(lang, "auditBody"))}</p></div></div>
    ${renderManagementList({ content })}
  </section>`;
}

function removeInvoice(orderNo) {
  if (liveReadOnly) return;
  state.invoices = state.invoices.filter((invoice) => invoice.orderNo !== orderNo);
  rerender();
}

export function attachPendingDeductionBehaviors({ rerender: nextRerender }) {
  rerender = nextRerender;
  if (attached) return;
  attached = true;
  document.addEventListener("click", async (event) => {
    if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
    const review = event.target.closest("[data-pending-review]");
    if (review && await confirmInPage(t(currentLang(), "reviewConfirm"))) {
      // Local-only demonstration. Production deduction and audit writes require the future API.
      removeInvoice(review.getAttribute("data-pending-review"));
      return;
    }
    const dismiss = event.target.closest("[data-pending-dismiss]");
    if (dismiss && await confirmInPage(t(currentLang(), "dismissConfirm"), { danger: true })) {
      // Local-only demonstration. Production legacy_skip_deduct and audit writes require the future API.
      removeInvoice(dismiss.getAttribute("data-pending-dismiss"));
    }
  });
}

function currentLang() {
  return document.documentElement.lang === "fr" ? "fr" : document.documentElement.lang === "en" ? "en" : "zh";
}
