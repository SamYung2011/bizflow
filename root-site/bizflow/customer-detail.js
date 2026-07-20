// bizflow 客戶詳情桌面屏(Figma 676:96729 / 676:96829 / 676:96938)。
// 视觉块复用 orders-detail 的订单/顾客卡片类与 customers 的弹窗/菜单类;本文件只做页面装配与交互。

import { getCurrentUser, getCustomerDetailData, getCustomerMergeCandidates, getOrdersPageData, getUnread } from "../data/provider.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { renderManagementPager } from "../components/management-list.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import {
  deleteLiveCustomerGroup,
  mergeLiveCustomerGroup,
  prepareLiveCustomerDeletion
} from "../data/live-customer-writes.js";
import { updateLiveOrderCustomer } from "../data/live-orders-writes.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { createPrintDialog } from "./print/print-dialog.js";
import { toPrintableOrder } from "./print/print-invoice.js";

const dict = {
  zh: {
    "customer.root": "客戶",
    "customer.moreActions": "更多動作",
    "customer.merge": "合併顧客",
    "customer.delete": "刪除顧客",
    "customer.merge.title": "合併顧客",
    "customer.merge.help": "選擇要保留的主顧客。這組顧客及其所有下層記錄會一併歸入主顧客。",
    "customer.merge.search": "輸入顧客姓名 / 電話 / Email",
    "customer.merge.loading": "正在載入顧客…",
    "customer.merge.prompt": "輸入關鍵字搜尋要保留的顧客",
    "customer.merge.empty": "找不到可合併的顧客",
    "customer.merge.confirm": "確認合併",
    "customer.merge.confirmText": "確定把「{source}」及其關聯記錄合併到「{target}」？合併後會統一由主顧客管理。",
    "customer.merge.failed": "合併顧客失敗，請重新整理後再試",
    "customer.merge.invalidTarget": "目標顧客已變更或會造成關係循環，請重新選擇",
    "customer.delete.checking": "正在檢查顧客關聯…",
    "customer.delete.blocked": "此顧客組仍有 {count} 張關聯發票，請先處理發票後再刪除",
    "customer.delete.confirmText": "確定刪除「{name}」及同組的 {count} 條顧客記錄？此操作無法復原。",
    "customer.delete.failed": "刪除顧客失敗，請重新整理後再試",
    "customer.spendTotal": "消費總金額",
    "customer.firstOrderTime": "首次下單時間",
    "customer.times": "次",
    "customer.customer": "顧客",
    "customer.edit": "編輯",
    "customer.carModel": "車型",
    "customer.shippingAddress": "運送地址",
    "customer.purchaseHistory": "購買記錄",
    "customer.paid": "已付款",
    "customer.unpaid": "未付款",
    "customer.unshipped": "未發貨",
    "customer.source.framer": "Framer",
    "customer.source.shopify": "Shopify",
    "customer.orderDate": "訂單日期",
    "customer.product": "商品",
    "customer.quantity": "數量",
    "customer.price": "單價",
    "customer.total": "總價",
    "customer.printOrder": "列印",
    "customer.purchaseEmpty": "暫無購買記錄",
    "customer.pager.prev": "上一頁",
    "customer.pager.next": "下一頁",
    "customer.modal.title": "修改顧客信息",
    "customer.field.name": "名字",
    "customer.field.phone": "聯繫電話",
    "customer.field.email": "Email",
    "customer.field.carModel": "車型",
    "customer.field.imei": "產品IMEI碼",
    "customer.field.address": "收貨地址",
    "customer.action.cancel": "取消",
    "customer.action.submit": "提交",
    "customer.action.close": "關閉",
    "customer.action.saving": "保存中…",
    "customer.saved": "顧客資料已更新",
    "customer.failed": "更新顧客資料失敗，請稍後再試",
    "customer.deviceFailed": "顧客資料已更新，但 IMEI 未能保存",
    "customer.imeiConflict": "顧客資料已更新，但 IMEI 已屬於其他顧客",
    "customer.validation.name": "請輸入顧客姓名",
    "customer.validation.imei": "IMEI 必須為 15 位數字",
    "customer.leaveUnsaved": "顧客資料尚未保存，確定離開？",
    "customer.empty": "—",
    "customer.notFound": "該記錄不存在或已合併",
    "customer.currency": "HKD$"
  },
  en: {
    "customer.root": "Customers",
    "customer.moreActions": "More actions",
    "customer.merge": "Merge customer",
    "customer.delete": "Delete customer",
    "customer.merge.title": "Merge customer",
    "customer.merge.help": "Choose the customer to keep. This customer group and every descendant record will move under the keeper.",
    "customer.merge.search": "Search name / phone / email",
    "customer.merge.loading": "Loading customers…",
    "customer.merge.prompt": "Search for the customer you want to keep",
    "customer.merge.empty": "No eligible customer found",
    "customer.merge.confirm": "Confirm merge",
    "customer.merge.confirmText": "Merge “{source}” and its related records into “{target}”? The keeper will manage the combined group.",
    "customer.merge.failed": "Could not merge the customer. Refresh and try again.",
    "customer.merge.invalidTarget": "The target changed or would create a relationship cycle. Choose another customer.",
    "customer.delete.checking": "Checking customer relationships…",
    "customer.delete.blocked": "This customer group still has {count} related invoice(s). Deal with those invoices before deleting it.",
    "customer.delete.confirmText": "Delete “{name}” and all {count} customer record(s) in this group? This cannot be undone.",
    "customer.delete.failed": "Could not delete the customer. Refresh and try again.",
    "customer.spendTotal": "Total spend",
    "customer.firstOrderTime": "First order time",
    "customer.times": "orders",
    "customer.customer": "Customer",
    "customer.edit": "Edit",
    "customer.carModel": "Vehicle model",
    "customer.shippingAddress": "Shipping address",
    "customer.purchaseHistory": "Purchase history",
    "customer.paid": "Paid",
    "customer.unpaid": "Unpaid",
    "customer.unshipped": "Unshipped",
    "customer.source.framer": "Framer",
    "customer.source.shopify": "Shopify",
    "customer.orderDate": "Order date",
    "customer.product": "Product",
    "customer.quantity": "Qty",
    "customer.price": "Unit price",
    "customer.total": "Total",
    "customer.printOrder": "Print",
    "customer.purchaseEmpty": "No purchase history",
    "customer.pager.prev": "Previous page",
    "customer.pager.next": "Next page",
    "customer.modal.title": "Edit customer information",
    "customer.field.name": "Name",
    "customer.field.phone": "Phone",
    "customer.field.email": "Email",
    "customer.field.carModel": "Vehicle model",
    "customer.field.imei": "Product IMEI",
    "customer.field.address": "Shipping address",
    "customer.action.cancel": "Cancel",
    "customer.action.submit": "Submit",
    "customer.action.close": "Close",
    "customer.action.saving": "Saving…",
    "customer.saved": "Customer details updated",
    "customer.failed": "Could not update the customer. Please try again.",
    "customer.deviceFailed": "Customer updated, but the IMEI could not be saved",
    "customer.imeiConflict": "Customer updated, but the IMEI belongs to another customer",
    "customer.validation.name": "Enter a customer name",
    "customer.validation.imei": "IMEI must contain 15 digits",
    "customer.leaveUnsaved": "Customer changes have not been saved. Leave this page?",
    "customer.empty": "—",
    "customer.notFound": "This record does not exist or has been merged",
    "customer.currency": "HKD$"
  },
  fr: {
    "customer.root": "Clients",
    "customer.moreActions": "Plus d'actions",
    "customer.merge": "Fusionner client",
    "customer.delete": "Supprimer client",
    "customer.merge.title": "Fusionner le client",
    "customer.merge.help": "Choisissez le client principal à conserver. Ce groupe et tous ses descendants seront rattachés à ce client.",
    "customer.merge.search": "Rechercher nom / téléphone / e-mail",
    "customer.merge.loading": "Chargement des clients…",
    "customer.merge.prompt": "Recherchez le client principal à conserver",
    "customer.merge.empty": "Aucun client admissible trouvé",
    "customer.merge.confirm": "Confirmer la fusion",
    "customer.merge.confirmText": "Fusionner « {source} » et ses enregistrements liés dans « {target} » ? Le client principal gérera le groupe fusionné.",
    "customer.merge.failed": "Impossible de fusionner le client. Actualisez et réessayez.",
    "customer.merge.invalidTarget": "La cible a changé ou créerait une boucle. Choisissez un autre client.",
    "customer.delete.checking": "Vérification des relations client…",
    "customer.delete.blocked": "Ce groupe a encore {count} facture(s) liée(s). Traitez-les avant de supprimer le client.",
    "customer.delete.confirmText": "Supprimer « {name} » et les {count} enregistrement(s) client de ce groupe ? Cette action est irréversible.",
    "customer.delete.failed": "Impossible de supprimer le client. Actualisez et réessayez.",
    "customer.spendTotal": "Dépense totale",
    "customer.firstOrderTime": "Première commande",
    "customer.times": "fois",
    "customer.customer": "Client",
    "customer.edit": "Modifier",
    "customer.carModel": "Modèle",
    "customer.shippingAddress": "Adresse de livraison",
    "customer.purchaseHistory": "Historique des achats",
    "customer.paid": "Payé",
    "customer.unpaid": "Non payé",
    "customer.unshipped": "Non expédié",
    "customer.source.framer": "Framer",
    "customer.source.shopify": "Shopify",
    "customer.orderDate": "Date de commande",
    "customer.product": "Produit",
    "customer.quantity": "Qté",
    "customer.price": "Prix unitaire",
    "customer.total": "Total",
    "customer.printOrder": "Imprimer",
    "customer.purchaseEmpty": "Aucun historique d'achat",
    "customer.pager.prev": "Page précédente",
    "customer.pager.next": "Page suivante",
    "customer.modal.title": "Modifier les informations client",
    "customer.field.name": "Nom",
    "customer.field.phone": "Téléphone",
    "customer.field.email": "Email",
    "customer.field.carModel": "Modèle",
    "customer.field.imei": "IMEI du produit",
    "customer.field.address": "Adresse de livraison",
    "customer.action.cancel": "Annuler",
    "customer.action.submit": "Soumettre",
    "customer.action.close": "Fermer",
    "customer.action.saving": "Enregistrement…",
    "customer.saved": "Informations client mises à jour",
    "customer.failed": "Impossible de mettre à jour le client. Réessayez.",
    "customer.deviceFailed": "Client mis à jour, mais l’IMEI n’a pas pu être enregistré",
    "customer.imeiConflict": "Client mis à jour, mais l’IMEI appartient à un autre client",
    "customer.validation.name": "Saisissez le nom du client",
    "customer.validation.imei": "L’IMEI doit contenir 15 chiffres",
    "customer.leaveUnsaved": "Les modifications du client ne sont pas enregistrées. Quitter cette page ?",
    "customer.empty": "—",
    "customer.notFound": "Cet enregistrement n’existe pas ou a été fusionné",
    "customer.currency": "HKD$"
  }
};

let detailData = null;
let currentUser = null;
let unread = null;
let liveMode = false;
let liveWritable = false;
let liveReadOnly = false;
let writeAttributes = "";
let deferredActionAttributes = "";
let activeNavigation = null;

let state = {
  actionMenuOpen: false,
  editModalOpen: false,
  editDraft: {},
  editModelFallback: false,
  mergeModalOpen: false,
  mergeLoading: false,
  mergeQuery: "",
  mergeTargetId: "",
  mergeCandidates: [],
  mergeError: "",
  writeBusy: false,
  notice: "",
  noticeType: "error",
  purchasePage: 1
};

const PURCHASE_PAGE_SIZE = 6;

let currentHelpers = null;
let printDialog = null;
let printOrdersPromise = null;
let activeScope = null;
let activeMountId = 0;

function isCurrentCustomerDetailMount(mountId, scope = activeScope) {
  return mountId === activeMountId && Boolean(scope?.isCurrent());
}

async function getFullOrderForPrint(orderNo) {
  if (!printOrdersPromise) printOrdersPromise = getOrdersPageData();
  const ordersPage = await printOrdersPromise;
  return ordersPage.orders.find((order) => order.detail?.orderNo === orderNo) ?? null;
}

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function pageTf(lang, key, values = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? "")),
    pageT(lang, key)
  );
}

function money(amount, lang) {
  return `${pageT(lang, "customer.currency")} ${Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fieldValue(value, lang) {
  return value === null || value === undefined || value === "" ? pageT(lang, "customer.empty") : String(value);
}

function sourceLabel(value, lang) {
  if (value === "Framer") return pageT(lang, "customer.source.framer");
  if (value === "Online Store" || value === "Shopify") return pageT(lang, "customer.source.shopify");
  return fieldValue(value, lang);
}

function paymentStatusLabel(value, lang) {
  if (value === "paid") return pageT(lang, "customer.paid");
  if (value === "unpaid") return pageT(lang, "customer.unpaid");
  return fieldValue(value, lang);
}

function shippingStatusLabel(value, lang) {
  return value === "unshipped" ? pageT(lang, "customer.unshipped") : fieldValue(value, lang);
}

function renderActionMenu(helpers) {
  const { escapeHtml, lang } = helpers;
  return `<span class="customer-detail-action-anchor">
    <button type="button" class="orders-primary orders-hug-small" data-customer-actions-trigger data-customer-write aria-haspopup="menu" aria-expanded="${state.actionMenuOpen}" title="${escapeHtml(pageT(lang, "customer.moreActions"))}"${deferredActionAttributes}>
      ${escapeHtml(pageT(lang, "customer.moreActions"))}
    </button>
    <div class="menu-popover customers-filter-menu customer-detail-action-menu${state.actionMenuOpen ? " menu-popover--open" : ""}" data-customer-actions-menu role="menu" ${state.actionMenuOpen ? "" : "hidden"}>
      <button type="button" class="dropdown-item" data-customer-action="merge" data-customer-write role="menuitem" title="${escapeHtml(pageT(lang, "customer.merge"))}"${deferredActionAttributes}>
        <span class="tp-line">${escapeHtml(pageT(lang, "customer.merge"))}</span>
      </button>
      <button type="button" class="dropdown-item customer-detail-action-danger" data-customer-action="delete" data-customer-write role="menuitem" title="${escapeHtml(pageT(lang, "customer.delete"))}"${deferredActionAttributes}>
        <span class="tp-line">${escapeHtml(pageT(lang, "customer.delete"))}</span>
      </button>
    </div>
  </span>`;
}

function renderStatCard(helpers) {
  const { escapeHtml, lang } = helpers;
  const { customer, detail } = detailData;
  return `<section class="orders-detail-card customer-detail-stat-card">
    <div class="customer-detail-stat-copy">
      <div class="customer-detail-stat-line">
        <span>${escapeHtml(pageT(lang, "customer.spendTotal"))}</span>
        <strong>${escapeHtml(money(detail.totalAmount, lang))}</strong>
      </div>
      <div class="customer-detail-stat-sub">
        <span>${escapeHtml(pageT(lang, "customer.firstOrderTime"))}</span>
        <span>${escapeHtml(fieldValue(detail.firstOrderDate, lang))}</span>
      </div>
    </div>
    <span class="customer-detail-count-chip" title="${escapeHtml(`${customer.orderCount}${pageT(lang, "customer.times")}`)}">${escapeHtml(String(customer.orderCount))}${escapeHtml(pageT(lang, "customer.times"))}</span>
  </section>`;
}

function renderCustomerCard(helpers) {
  const { escapeHtml, lang } = helpers;
  const { customer, detail } = detailData;
  const email = fieldValue(detail.email, lang);
  const carModel = fieldValue(detail.carModel, lang);
  const shippingAddress = fieldValue(detail.shippingAddress, lang);
  return `<section class="orders-detail-card">
    <div class="orders-card-head">
      <h2 class="orders-card-title">${escapeHtml(pageT(lang, "customer.customer"))}</h2>
      <button type="button" class="orders-primary orders-hug-small" data-customer-edit-open data-customer-write${writeAttributes}>${escapeHtml(pageT(lang, "customer.edit"))}</button>
    </div>
    <div class="orders-customer-info">
      <div class="orders-customer-line customer-detail-customer-line customer-detail-name-line">
        <span>${escapeHtml(pageT(lang, "customer.customer"))}</span>
        <strong title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</strong>
        <strong title="${escapeHtml(fieldValue(customer.phone, lang))}">${escapeHtml(fieldValue(customer.phone, lang))}</strong>
        <strong title="${escapeHtml(email)}">${escapeHtml(email)}</strong>
      </div>
      <div class="orders-customer-line customer-detail-customer-line">
        <span>${escapeHtml(pageT(lang, "customer.carModel"))}</span>
        <strong title="${escapeHtml(carModel)}">${escapeHtml(carModel)}</strong>
      </div>
      <div class="orders-field">
        <span class="orders-field__label">${escapeHtml(pageT(lang, "customer.shippingAddress"))}</span>
        <span class="orders-address-box">${escapeHtml(shippingAddress)}</span>
      </div>
    </div>
  </section>`;
}

function renderPurchaseRow(order, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const paid = order.status === "paid";
  const shipped = order.shippingStatus !== "unshipped";
  return `<article class="customer-purchase-row" data-customer-purchase-row data-order-no="${escapeHtml(order.no)}">
    <div class="customer-purchase-row__lead">
      <strong class="customer-purchase-row__no">${escapeHtml(order.no)}</strong>
      <div class="customer-purchase-row__chips">
        <span class="orders-chip ${paid ? "orders-chip--blue" : "orders-chip--yellow"}">${escapeHtml(paymentStatusLabel(order.status, lang))}</span>
        <span class="orders-chip ${shipped ? "orders-chip--green" : "orders-chip--red"}">${escapeHtml(shippingStatusLabel(order.shippingStatus, lang))}</span>
        <span class="orders-chip orders-chip--source">${escapeHtml(sourceLabel(order.source, lang))}</span>
      </div>
    </div>
    <div class="customer-purchase-row__product">
      <strong title="${escapeHtml(fieldValue(order.productName, lang))}">${escapeHtml(fieldValue(order.productName, lang))}</strong>
      <span>${escapeHtml(`${pageT(lang, "customer.quantity")} ×${order.quantity}`)}</span>
    </div>
    <div class="customer-purchase-row__tail">
      <strong>${escapeHtml(money(order.price, lang))}</strong>
      <span>${escapeHtml(fieldValue(order.date, lang))}</span>
      <button type="button" class="customer-purchase-row__print" data-customer-order-print aria-label="${escapeHtml(pageT(lang, "customer.printOrder"))}" title="${escapeHtml(pageT(lang, "customer.printOrder"))}">
        ${icon("icon-nav-print", "icon")}
      </button>
    </div>
  </article>`;
}

function renderPurchaseHistory(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const orders = detailData.detail.orders;
  const pages = Math.max(1, Math.ceil(orders.length / PURCHASE_PAGE_SIZE));
  state.purchasePage = Math.min(Math.max(state.purchasePage, 1), pages);
  const start = (state.purchasePage - 1) * PURCHASE_PAGE_SIZE;
  const pageOrders = orders.slice(start, start + PURCHASE_PAGE_SIZE);
  const pager = renderManagementPager({
    page: state.purchasePage,
    pages,
    visible: orders.length > PURCHASE_PAGE_SIZE,
    icon,
    escapeHtml,
    previousLabel: pageT(lang, "customer.pager.prev"),
    nextLabel: pageT(lang, "customer.pager.next")
  });
  const rows = pageOrders.length
    ? pageOrders.map((order) => renderPurchaseRow(order, helpers)).join("")
    : `<div class="customer-purchase-empty">${escapeHtml(pageT(lang, "customer.purchaseEmpty"))}</div>`;
  return `<section class="orders-detail-card customer-purchase-card" data-customer-purchase-history data-purchase-total="${orders.length}" data-purchase-page="${state.purchasePage}" data-purchase-pages="${pages}">
    <div class="orders-card-head">
      <h2 class="orders-card-title">${escapeHtml(pageT(lang, "customer.purchaseHistory"))}</h2>
      <span class="customer-detail-count-chip">${escapeHtml(String(orders.length))}</span>
    </div>
    <div class="customer-purchase-list">${rows}</div>
    ${pager}
  </section>`;
}

function renderEditInput(key, value, helpers, disabledAttributes = "") {
  const { escapeHtml, lang } = helpers;
  return `<div class="form-new-customer__field">
    <label class="form-new-customer__label" for="customer-edit-${escapeHtml(key)}">${escapeHtml(pageT(lang, `customer.field.${key}`))}</label>
    <input id="customer-edit-${escapeHtml(key)}" class="form-new-customer__value" data-customer-edit-field="${escapeHtml(key)}" value="${escapeHtml(value)}"${disabledAttributes}>
  </div>`;
}

function renderEditModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const disabled = liveReadOnly || state.writeBusy;
  const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";
  const values = state.editDraft;
  return `<div class="customers-modal-overlay${state.editModalOpen ? " customers-modal-overlay--open" : ""}" data-customer-edit-overlay ${state.editModalOpen ? "" : 'hidden aria-hidden="true"'}>
    <section class="tp-component form-new-customer customer-detail-edit-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "customer.modal.title"))}">
      <button type="button" class="form-new-customer__close" data-customer-edit-close aria-label="${escapeHtml(pageT(lang, "customer.action.close"))}"${state.writeBusy ? disabledAttributes : ""}></button>
      <h2 class="form-new-customer__title">${escapeHtml(pageT(lang, "customer.modal.title"))}</h2>
      ${state.notice ? `<p class="customer-write-notice customer-write-notice--${escapeHtml(state.noticeType || "error")}" role="${state.noticeType === "success" ? "status" : "alert"}">${escapeHtml(state.notice)}</p>` : ""}
      <div class="form-new-customer__fields">
        <div class="form-new-customer__row">
          ${renderEditInput("name", values.name ?? "", helpers, disabledAttributes)}
          ${renderEditInput("phone", values.phone ?? "", helpers, disabledAttributes)}
        </div>
        ${renderEditInput("email", values.email ?? "", helpers, disabledAttributes)}
        ${renderEditInput("carModel", values.carModel ?? "", helpers, disabledAttributes)}
        ${renderEditInput("imei", values.imei ?? "", helpers, disabledAttributes)}
        <div class="form-new-customer__field">
          <label class="form-new-customer__address-label" for="customer-edit-address">${escapeHtml(pageT(lang, "customer.field.address"))}</label>
          <textarea id="customer-edit-address" class="form-new-customer__address" data-customer-edit-field="address"${disabledAttributes}>${escapeHtml(values.address ?? "")}</textarea>
        </div>
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-edit-close${state.writeBusy ? disabledAttributes : ""}>${escapeHtml(pageT(lang, "customer.action.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-edit-submit data-customer-write${disabledAttributes}>${escapeHtml(pageT(lang, state.writeBusy ? "customer.action.saving" : "customer.action.submit"))}</button>
      </div>
    </section>
  </div>`;
}

function mergeCandidateSearchText(customer) {
  return [customer?.name, customer?.phone, customer?.detail?.email]
    .map((value) => String(value || "").trim().toLocaleLowerCase())
    .filter(Boolean)
    .join("\n");
}

function visibleMergeCandidates() {
  const query = state.mergeQuery.trim().toLocaleLowerCase();
  if (!query) return [];
  const matches = state.mergeCandidates.filter((customer) => mergeCandidateSearchText(customer).includes(query));
  const selected = state.mergeCandidates.find((customer) => customer.id === state.mergeTargetId);
  if (selected && !matches.some((customer) => customer.id === selected.id)) matches.unshift(selected);
  return matches.slice(0, 30);
}

function renderMergeResults(helpers) {
  const { escapeHtml, lang } = helpers;
  if (state.mergeLoading) {
    return `<p class="customer-merge-status">${escapeHtml(pageT(lang, "customer.merge.loading"))}</p>`;
  }
  if (!state.mergeQuery.trim()) {
    return `<p class="customer-merge-status">${escapeHtml(pageT(lang, "customer.merge.prompt"))}</p>`;
  }
  const candidates = visibleMergeCandidates();
  if (!candidates.length) {
    return `<p class="customer-merge-status">${escapeHtml(pageT(lang, "customer.merge.empty"))}</p>`;
  }
  return candidates.map((customer) => {
    const selected = customer.id === state.mergeTargetId;
    const secondary = [customer.phone, customer.detail?.email].filter(Boolean).join(" · ") || pageT(lang, "customer.empty");
    return `<button type="button" class="customer-merge-option${selected ? " customer-merge-option--selected" : ""}" data-customer-merge-target="${escapeHtml(customer.id)}" aria-pressed="${selected}"${state.writeBusy ? ' disabled aria-disabled="true"' : ""}>
      <strong title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</strong>
      <span title="${escapeHtml(secondary)}">${escapeHtml(secondary)}</span>
    </button>`;
  }).join("");
}

function renderMergeModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const disabled = state.writeBusy || state.mergeLoading;
  const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";
  return `<div class="customers-modal-overlay${state.mergeModalOpen ? " customers-modal-overlay--open" : ""}" data-customer-merge-overlay ${state.mergeModalOpen ? "" : 'hidden aria-hidden="true"'}>
    <section class="tp-component form-new-customer customer-merge-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "customer.merge.title"))}">
      <button type="button" class="form-new-customer__close" data-customer-merge-close aria-label="${escapeHtml(pageT(lang, "customer.action.close"))}"${state.writeBusy ? ' disabled aria-disabled="true"' : ""}></button>
      <h2 class="form-new-customer__title">${escapeHtml(pageT(lang, "customer.merge.title"))}</h2>
      <p class="customer-merge-help">${escapeHtml(pageT(lang, "customer.merge.help"))}</p>
      ${state.mergeError ? `<p class="customer-write-notice customer-write-notice--error" role="alert">${escapeHtml(state.mergeError)}</p>` : ""}
      <label class="form-new-customer__field">
        <span class="form-new-customer__label">${escapeHtml(pageT(lang, "customer.merge.search"))}</span>
        <input class="form-new-customer__value customer-merge-search" type="search" autocomplete="off" data-customer-merge-query value="${escapeHtml(state.mergeQuery)}" placeholder="${escapeHtml(pageT(lang, "customer.merge.search"))}"${disabledAttributes}>
      </label>
      <div class="customer-merge-results" data-customer-merge-results>${renderMergeResults(helpers)}</div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-merge-close${state.writeBusy ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(pageT(lang, "customer.action.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-merge-submit data-customer-write${disabled || !state.mergeTargetId ? ' disabled aria-disabled="true"' : ""}>${escapeHtml(pageT(lang, state.writeBusy ? "customer.action.saving" : "customer.merge.confirm"))}</button>
      </div>
    </section>
  </div>`;
}

function renderCustomerDetail(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, lang } = helpers;
  if (!detailData) {
    const notFound = pageT(lang, "customer.notFound");
    return `<div class="orders-workspace customer-detail-page" data-customer-detail-page data-live-read-only="${liveReadOnly}" data-customer-not-found>
      <header class="orders-workspace__head customer-detail-head">
        <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "customer.root"))}">
          <a href="./customers.html" data-spa-back="./customers.html">${escapeHtml(pageT(lang, "customer.root"))}</a>
          <span>${escapeHtml(">")}</span>
          <span class="orders-breadcrumb__current">${escapeHtml(notFound)}</span>
        </nav>
      </header>
      <section class="orders-detail-card customer-purchase-empty">${escapeHtml(notFound)}</section>
    </div>`;
  }
  const { customer } = detailData;
  return `<div class="orders-workspace customer-detail-page" data-customer-detail-page data-live-read-only="${liveReadOnly}">
    ${state.notice && !state.editModalOpen ? `<p class="customer-write-notice customer-write-notice--${escapeHtml(state.noticeType || "error")}" role="${state.noticeType === "success" ? "status" : "alert"}">${escapeHtml(state.notice)}</p>` : ""}
    <header class="orders-workspace__head customer-detail-head">
      <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "customer.root"))}">
        <a href="./customers.html" data-spa-back="./customers.html">${escapeHtml(pageT(lang, "customer.root"))}</a>
        <span>${escapeHtml(">")}</span>
        <span class="orders-breadcrumb__current" title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</span>
      </nav>
      ${renderActionMenu(helpers)}
    </header>
    ${renderStatCard(helpers)}
    ${renderCustomerCard(helpers)}
    ${renderPurchaseHistory(helpers)}
    ${renderEditModal(helpers)}
    ${renderMergeModal(helpers)}
  </div>`;
}

function rerender() {
  const page = document.querySelector("[data-customer-detail-page]");
  if (page && currentHelpers) page.outerHTML = renderCustomerDetail(currentHelpers);
}

function closeActionMenu() {
  if (!state.actionMenuOpen) return;
  state.actionMenuOpen = false;
  rerender();
}

function setCustomerDetailNotice(message, type = "error") {
  state.notice = message;
  state.noticeType = type;
}

function customerEditBaseline() {
  if (!detailData) return {};
  const { customer, detail } = detailData;
  return {
    name: customer.name || "",
    phone: customer.phone || "",
    email: detail.email || "",
    carModel: liveMode ? (detail.carModelValue ?? detail.carModel ?? "") : (detail.carModel ?? ""),
    imei: liveMode ? "" : (customer.imei || ""),
    address: detail.shippingAddress || ""
  };
}

function customerEditChanged() {
  if (!state.editModalOpen) return false;
  const baseline = customerEditBaseline();
  return Object.keys(baseline).some((key) => String(state.editDraft[key] ?? "") !== String(baseline[key]));
}

function hasCustomerDetailUnsavedChanges() {
  return state.writeBusy || customerEditChanged();
}

function openEditModal() {
  state.editDraft = customerEditBaseline();
  state.editModelFallback = liveMode && detailData?.detail?.carModelValue === undefined;
  state.editModalOpen = true;
  state.actionMenuOpen = false;
  setCustomerDetailNotice("");
  rerender();
}

function closeEditModal() {
  if (!state.editModalOpen || state.writeBusy) return;
  state.editModalOpen = false;
  state.editDraft = {};
  state.editModelFallback = false;
  setCustomerDetailNotice("");
  rerender();
}

function sourceCustomerIds() {
  const ids = detailData?.customer?.groupCids;
  return Array.isArray(ids) && ids.length ? ids.slice() : [detailData?.customer?.id].filter(Boolean);
}

function closeMergeModal() {
  if (!state.mergeModalOpen || state.writeBusy) return;
  state.mergeModalOpen = false;
  state.mergeLoading = false;
  state.mergeQuery = "";
  state.mergeTargetId = "";
  state.mergeCandidates = [];
  state.mergeError = "";
  rerender();
}

async function openMergeModal() {
  const mountId = activeMountId;
  const scope = activeScope;
  state.actionMenuOpen = false;
  state.mergeModalOpen = true;
  state.mergeLoading = true;
  state.mergeQuery = "";
  state.mergeTargetId = "";
  state.mergeCandidates = [];
  state.mergeError = "";
  setCustomerDetailNotice("");
  rerender();
  try {
    const candidates = await getCustomerMergeCandidates();
    if (!isCurrentCustomerDetailMount(mountId, scope) || !state.mergeModalOpen) return;
    const sourceIds = new Set(sourceCustomerIds());
    state.mergeCandidates = candidates.filter((customer) =>
      !(Array.isArray(customer.groupCids) ? customer.groupCids : [customer.id]).some((id) => sourceIds.has(id)));
  } catch (error) {
    if (!isCurrentCustomerDetailMount(mountId, scope) || !state.mergeModalOpen) return;
    console.error("[customer-detail] merge candidates failed", error);
    state.mergeError = pageT(currentHelpers?.lang ?? "zh", "customer.merge.failed");
  } finally {
    if (!isCurrentCustomerDetailMount(mountId, scope) || !state.mergeModalOpen) return;
    state.mergeLoading = false;
    rerender();
    document.querySelector("[data-customer-merge-query]")?.focus();
  }
}

function friendlyCustomerMergeError(error) {
  const lang = currentHelpers?.lang ?? "zh";
  if (["CUSTOMER_KEEPER_STALE", "CUSTOMER_KEEPER_NOT_ROOT", "CUSTOMER_MERGE_CYCLE", "CUSTOMER_SOURCE_STALE"].includes(error?.code)) {
    return pageT(lang, "customer.merge.invalidTarget");
  }
  return pageT(lang, "customer.merge.failed");
}

function deleteBlockedMessage(invoiceCount) {
  return pageTf(currentHelpers?.lang ?? "zh", "customer.delete.blocked", { count: invoiceCount });
}

function navigateTo(relative) {
  const url = new URL(relative, window.location.href);
  if (typeof activeNavigation?.navigate === "function") void activeNavigation.navigate(url);
  else if (typeof activeNavigation?.hardNavigate === "function") activeNavigation.hardNavigate(url);
  else window.location.assign(url.href);
}

async function mergeCustomerFromModal() {
  const target = state.mergeCandidates.find((customer) => customer.id === state.mergeTargetId);
  if (!target || state.writeBusy) return;
  const mountId = activeMountId;
  const scope = activeScope;
  const lang = currentHelpers?.lang ?? "zh";
  const confirmed = await confirmInPage(pageTf(lang, "customer.merge.confirmText", {
    source: detailData.customer.name,
    target: target.name
  }));
  if (!confirmed || !isCurrentCustomerDetailMount(mountId, scope)) return;

  state.writeBusy = true;
  state.mergeError = "";
  rerender();
  let navigated = false;
  try {
    const result = await mergeLiveCustomerGroup({
      sourceCustomerIds: sourceCustomerIds(),
      keeperCustomerId: target.id
    });
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    state.writeBusy = false;
    rerender();
    navigateTo(`./customer-detail.html?id=${encodeURIComponent(result.keeperCustomerId)}`);
    navigated = true;
  } catch (error) {
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    console.error("[customer-detail] customer merge failed", error);
    state.mergeError = friendlyCustomerMergeError(error);
  } finally {
    if (!isCurrentCustomerDetailMount(mountId, scope) || navigated) return;
    state.writeBusy = false;
    rerender();
  }
}

async function deleteCustomerFromAction() {
  const mountId = activeMountId;
  const scope = activeScope;
  const lang = currentHelpers?.lang ?? "zh";
  state.actionMenuOpen = false;
  state.writeBusy = true;
  setCustomerDetailNotice(pageT(lang, "customer.delete.checking"), "success");
  rerender();
  let navigated = false;
  try {
    const plan = await prepareLiveCustomerDeletion(sourceCustomerIds());
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    if (plan.invoiceCount > 0) {
      setCustomerDetailNotice(deleteBlockedMessage(plan.invoiceCount));
      return;
    }
    const confirmed = await confirmInPage(pageTf(lang, "customer.delete.confirmText", {
      name: detailData.customer.name,
      count: plan.customerIds.length
    }), { danger: true });
    if (!confirmed || !isCurrentCustomerDetailMount(mountId, scope)) {
      setCustomerDetailNotice("");
      return;
    }
    await deleteLiveCustomerGroup(sourceCustomerIds());
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    state.writeBusy = false;
    rerender();
    navigateTo("./customers.html");
    navigated = true;
  } catch (error) {
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    console.error("[customer-detail] customer delete failed", error);
    setCustomerDetailNotice(error?.code === "CUSTOMER_HAS_INVOICES"
      ? deleteBlockedMessage(error.invoiceCount)
      : pageT(lang, "customer.delete.failed"));
  } finally {
    if (!isCurrentCustomerDetailMount(mountId, scope) || navigated) return;
    state.writeBusy = false;
    rerender();
  }
}

function friendlyCustomerDetailWriteError(error) {
  const message = String(error?.message || "");
  const lang = currentHelpers?.lang ?? "zh";
  if (message.includes("Customer name is required")) return pageT(lang, "customer.validation.name");
  if (message.includes("IMEI")) return pageT(lang, "customer.validation.imei");
  return pageT(lang, "customer.failed");
}

function applyUpdatedCustomer(result, values) {
  const { customer, detail } = detailData;
  customer.name = result.customer.name || "";
  customer.phone = result.customer.phone || "";
  detail.email = result.customer.email || "";
  detail.carMake = result.customer.car_make || "";
  detail.carModelValue = result.customer.car_model || "";
  detail.carModel = [result.customer.car_make, result.customer.car_model].filter(Boolean).join(" ") || null;
  detail.shippingAddress = result.customer.address || "";
  const imei = String(values.imei || "").replace(/[\s-]+/g, "");
  if (imei && !result.deviceConflicts.length && !result.deviceError) customer.imei = imei;
}

async function saveCustomerEdit() {
  const mountId = activeMountId;
  const scope = activeScope;
  const values = { ...state.editDraft };
  const preserveCarModel = state.editModelFallback && values.carModel === customerEditBaseline().carModel;
  state.writeBusy = true;
  setCustomerDetailNotice("");
  rerender();
  try {
    const result = await updateLiveOrderCustomer(detailData.customer.id, values, { preserveCarModel });
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    applyUpdatedCustomer(result, values);
    state.editModalOpen = false;
    state.editDraft = {};
    state.editModelFallback = false;
    if (result.deviceError) console.error("[customer-detail] customer device write failed", result.deviceError);
    const noticeKey = result.deviceError
      ? "customer.deviceFailed"
      : result.deviceConflicts.length
        ? "customer.imeiConflict"
        : "customer.saved";
    setCustomerDetailNotice(pageT(currentHelpers?.lang ?? "zh", noticeKey), noticeKey === "customer.saved" ? "success" : "error");
  } catch (error) {
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    console.error("[customer-detail] customer write failed", error);
    setCustomerDetailNotice(friendlyCustomerDetailWriteError(error));
  } finally {
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    state.writeBusy = false;
    rerender();
  }
}

async function onCustomerDetailClick(event) {
  if ((liveReadOnly || state.writeBusy) && event.target.closest("[data-customer-write]")) return;
  if (event.target.closest("[data-customer-actions-trigger]")) {
    state.actionMenuOpen = !state.actionMenuOpen;
    rerender();
    return;
  }

  const customerAction = event.target.closest("[data-customer-action]");
  if (customerAction) {
    const action = customerAction.getAttribute("data-customer-action");
    if (!liveMode) {
      state.actionMenuOpen = false;
      rerender();
    } else if (liveWritable && action === "merge") await openMergeModal();
    else if (liveWritable && action === "delete") await deleteCustomerFromAction();
    return;
  }

  const mergeTarget = event.target.closest("[data-customer-merge-target]");
  if (mergeTarget && state.mergeModalOpen && !state.writeBusy) {
    state.mergeTargetId = mergeTarget.getAttribute("data-customer-merge-target") || "";
    state.mergeError = "";
    rerender();
    return;
  }

  if (event.target.closest("[data-customer-merge-submit]")) {
    if (liveWritable && state.mergeTargetId && !state.writeBusy) await mergeCustomerFromModal();
    return;
  }

  if (event.target.closest("[data-customer-merge-close]") || event.target.matches("[data-customer-merge-overlay]")) {
    closeMergeModal();
    return;
  }

  if (event.target.closest("[data-customer-edit-open]")) {
    openEditModal();
    return;
  }

  if (event.target.closest("[data-customer-edit-submit]")) {
    if (!liveMode) closeEditModal();
    else if (liveWritable && !state.writeBusy) await saveCustomerEdit();
    return;
  }

  if (event.target.closest("[data-customer-edit-close]") || event.target.matches("[data-customer-edit-overlay]")) {
    closeEditModal();
    return;
  }

  const purchasePage = event.target.closest("[data-management-page]");
  if (purchasePage && !purchasePage.disabled) {
    state.purchasePage += purchasePage.getAttribute("data-management-page") === "next" ? 1 : -1;
    rerender();
    return;
  }

  const printButton = event.target.closest("[data-customer-order-print]");
  if (printButton) {
    const mountId = activeMountId;
    const scope = activeScope;
    event.stopPropagation();
    const orderNo = printButton.closest("[data-customer-purchase-row]")?.getAttribute("data-order-no");
    printButton.disabled = true;
    printButton.setAttribute("aria-busy", "true");
    let order = null;
    try {
      order = await getFullOrderForPrint(orderNo);
    } catch {
      order = null;
    } finally {
      if (printButton.isConnected) {
        printButton.disabled = false;
        printButton.removeAttribute("aria-busy");
      }
    }
    if (!isCurrentCustomerDetailMount(mountId, scope)) return;
    printDialog.open(order ? toPrintableOrder(order) : null, "both", printButton);
    return;
  }

  if (state.actionMenuOpen && !event.target.closest("[data-customer-actions-menu]")) {
    closeActionMenu();
  }
}

function onCustomerDetailInput(event) {
  const mergeQuery = event.target.closest("[data-customer-merge-query]");
  if (mergeQuery && state.mergeModalOpen && !state.writeBusy) {
    state.mergeQuery = mergeQuery.value;
    state.mergeTargetId = "";
    state.mergeError = "";
    const results = document.querySelector("[data-customer-merge-results]");
    if (results && currentHelpers) results.innerHTML = renderMergeResults(currentHelpers);
    const submit = document.querySelector("[data-customer-merge-submit]");
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-disabled", "true");
    }
    return;
  }
  const field = event.target.closest("[data-customer-edit-field]");
  if (!field || !state.editModalOpen || state.writeBusy) return;
  state.editDraft[field.getAttribute("data-customer-edit-field")] = field.value;
}

function onCustomerDetailKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.mergeModalOpen) closeMergeModal();
  else if (state.editModalOpen) closeEditModal();
  else closeActionMenu();
}

function restoredState(value = null) {
  const next = value && typeof value === "object" ? value : {};
  return {
    actionMenuOpen: false,
    editModalOpen: false,
    editDraft: {},
    editModelFallback: false,
    mergeModalOpen: false,
    mergeLoading: false,
    mergeQuery: "",
    mergeTargetId: "",
    mergeCandidates: [],
    mergeError: "",
    writeBusy: false,
    notice: "",
    noticeType: "error",
    purchasePage: Number.isInteger(next.purchasePage) && next.purchasePage > 0 ? next.purchasePage : 1
  };
}

export async function mountPage({ scope, signal, url = new URL(window.location.href), historyState = null, navigation = null } = {}) {
  const mountId = ++activeMountId;
  activeScope = scope;
  activeNavigation = navigation;
  const customerId = url.searchParams.get("id");
  const [nextDetailData, nextCurrentUser, nextUnread] = await Promise.all([
    getCustomerDetailData(customerId),
    getCurrentUser(),
    getUnread()
  ]);
  throwIfPageAborted(signal, scope);
  detailData = nextDetailData;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  liveMode = typeof currentUser?.hasPermission === "function";
  liveWritable = liveMode && currentUser?.bizflowMainAccess === true;
  liveReadOnly = liveMode && !liveWritable;
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  deferredActionAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  state = restoredState(historyState);
  printOrdersPromise = null;
  printDialog = createPrintDialog({ getLang: () => currentHelpers?.lang ?? "zh", scope });

  return {
    page: {
      menu: createBizflowMenu("customers"),
      data: { unread, user: currentUser },
      render: renderCustomerDetail,
      title: detailData?.customer?.name ? `Honnmono · ${detailData.customer.name}` : "Honnmono · Customer"
    },
    activate() {
      scope.listen(document, "click", onCustomerDetailClick);
      scope.listen(document, "input", onCustomerDetailInput);
      scope.listen(document, "keydown", onCustomerDetailKeydown);
    },
    hasUnsavedChanges: hasCustomerDetailUnsavedChanges,
    async canLeave() {
      if (!hasCustomerDetailUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "customer.leaveUnsaved"));
    },
    captureState: () => ({ purchasePage: state.purchasePage }),
    dispose() {
      if (activeMountId === mountId) activeMountId += 1;
      printDialog?.dispose();
      printDialog = null;
      printOrdersPromise = null;
      detailData = null;
      currentUser = null;
      unread = null;
      currentHelpers = null;
      activeNavigation = null;
      if (activeScope === scope) activeScope = null;
    }
  };
}
