// bizflow 客戶詳情桌面屏(Figma 676:96729 / 676:96829 / 676:96938)。
// 视觉块复用 orders-detail 的订单/顾客卡片类与 customers 的弹窗/菜单类;本文件只做页面装配与交互。

import { getCurrentUser, getCustomerDetailData, getOrdersPageData, getUnread } from "../data/provider.js";
import { renderManagementPager } from "../components/management-list.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { createPrintDialog } from "./print/print-dialog.js";
import { toPrintableOrder } from "./print/print-invoice.js";

const dict = {
  zh: {
    "customer.root": "客戶",
    "customer.moreActions": "更多動作",
    "customer.merge": "合併顧客",
    "customer.delete": "刪除顧客",
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
    "customer.empty": "—",
    "customer.notFound": "該記錄不存在或已合併",
    "customer.currency": "HKD$"
  },
  en: {
    "customer.root": "Customers",
    "customer.moreActions": "More actions",
    "customer.merge": "Merge customer",
    "customer.delete": "Delete customer",
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
    "customer.empty": "—",
    "customer.notFound": "This record does not exist or has been merged",
    "customer.currency": "HKD$"
  },
  fr: {
    "customer.root": "Clients",
    "customer.moreActions": "Plus d'actions",
    "customer.merge": "Fusionner client",
    "customer.delete": "Supprimer client",
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
    "customer.empty": "—",
    "customer.notFound": "Cet enregistrement n’existe pas ou a été fusionné",
    "customer.currency": "HKD$"
  }
};

let detailData = null;
let currentUser = null;
let unread = null;
let liveReadOnly = false;
let writeAttributes = "";

let state = {
  actionMenuOpen: false,
  editModalOpen: false,
  purchasePage: 1
};

const PURCHASE_PAGE_SIZE = 6;

let currentHelpers = null;
let printDialog = null;
let printOrdersPromise = null;
let activeMountId = 0;

async function getFullOrderForPrint(orderNo) {
  if (!printOrdersPromise) printOrdersPromise = getOrdersPageData();
  const ordersPage = await printOrdersPromise;
  return ordersPage.orders.find((order) => order.detail?.orderNo === orderNo) ?? null;
}

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
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
    <button type="button" class="orders-primary orders-hug-small" data-customer-actions-trigger data-customer-write aria-haspopup="menu" aria-expanded="${state.actionMenuOpen}" title="${escapeHtml(pageT(lang, "customer.moreActions"))}"${writeAttributes}>
      ${escapeHtml(pageT(lang, "customer.moreActions"))}
    </button>
    <div class="menu-popover customers-filter-menu customer-detail-action-menu${state.actionMenuOpen ? " menu-popover--open" : ""}" data-customer-actions-menu role="menu" ${state.actionMenuOpen ? "" : "hidden"}>
      <button type="button" class="dropdown-item" data-customer-action="merge" data-customer-write role="menuitem" title="${escapeHtml(pageT(lang, "customer.merge"))}"${writeAttributes}>
        <span class="tp-line">${escapeHtml(pageT(lang, "customer.merge"))}</span>
      </button>
      <button type="button" class="dropdown-item customer-detail-action-danger" data-customer-action="delete" data-customer-write role="menuitem" title="${escapeHtml(pageT(lang, "customer.delete"))}"${writeAttributes}>
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

function renderEditInput(key, value, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<div class="form-new-customer__field">
    <label class="form-new-customer__label" for="customer-edit-${escapeHtml(key)}">${escapeHtml(pageT(lang, `customer.field.${key}`))}</label>
    <input id="customer-edit-${escapeHtml(key)}" class="form-new-customer__value" data-customer-edit-field="${escapeHtml(key)}" value="${escapeHtml(value)}"${writeAttributes}>
  </div>`;
}

function renderEditModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const { customer, detail } = detailData;
  return `<div class="customers-modal-overlay${state.editModalOpen ? " customers-modal-overlay--open" : ""}" data-customer-edit-overlay ${state.editModalOpen ? "" : 'hidden aria-hidden="true"'}>
    <section class="tp-component form-new-customer customer-detail-edit-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "customer.modal.title"))}">
      <button type="button" class="form-new-customer__close" data-customer-edit-close aria-label="${escapeHtml(pageT(lang, "customer.action.close"))}"></button>
      <h2 class="form-new-customer__title">${escapeHtml(pageT(lang, "customer.modal.title"))}</h2>
      <div class="form-new-customer__fields">
        <div class="form-new-customer__row">
          ${renderEditInput("name", customer.name, helpers)}
          ${renderEditInput("phone", fieldValue(customer.phone, lang), helpers)}
        </div>
        ${renderEditInput("email", detail.email ?? "", helpers)}
        ${renderEditInput("carModel", detail.carModel ?? "", helpers)}
        ${renderEditInput("imei", fieldValue(customer.imei, lang), helpers)}
        <div class="form-new-customer__field">
          <label class="form-new-customer__address-label" for="customer-edit-address">${escapeHtml(pageT(lang, "customer.field.address"))}</label>
          <textarea id="customer-edit-address" class="form-new-customer__address" data-customer-edit-field="address"${writeAttributes}>${escapeHtml(detail.shippingAddress ?? "")}</textarea>
        </div>
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-edit-close>${escapeHtml(pageT(lang, "customer.action.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-edit-close data-customer-write${writeAttributes}>${escapeHtml(pageT(lang, "customer.action.submit"))}</button>
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
          <a href="./customers.html">${escapeHtml(pageT(lang, "customer.root"))}</a>
          <span>${escapeHtml(">")}</span>
          <span class="orders-breadcrumb__current">${escapeHtml(notFound)}</span>
        </nav>
      </header>
      <section class="orders-detail-card customer-purchase-empty">${escapeHtml(notFound)}</section>
    </div>`;
  }
  const { customer } = detailData;
  return `<div class="orders-workspace customer-detail-page" data-customer-detail-page data-live-read-only="${liveReadOnly}">
    <header class="orders-workspace__head customer-detail-head">
      <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "customer.root"))}">
        <a href="./customers.html">${escapeHtml(pageT(lang, "customer.root"))}</a>
        <span>${escapeHtml(">")}</span>
        <span class="orders-breadcrumb__current" title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</span>
      </nav>
      ${renderActionMenu(helpers)}
    </header>
    ${renderStatCard(helpers)}
    ${renderCustomerCard(helpers)}
    ${renderPurchaseHistory(helpers)}
    ${renderEditModal(helpers)}
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

function closeEditModal() {
  if (!state.editModalOpen) return;
  state.editModalOpen = false;
  rerender();
}

async function onCustomerDetailClick(event) {
  if (liveReadOnly && event.target.closest("[data-customer-write]")) return;
  if (event.target.closest("[data-customer-actions-trigger]")) {
    state.actionMenuOpen = !state.actionMenuOpen;
    rerender();
    return;
  }

  if (event.target.closest("[data-customer-action]")) {
    state.actionMenuOpen = false;
    rerender();
    return;
  }

  if (event.target.closest("[data-customer-edit-open]")) {
    state.editModalOpen = true;
    state.actionMenuOpen = false;
    rerender();
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
    if (mountId !== activeMountId) return;
    printDialog.open(order ? toPrintableOrder(order) : null, "both", printButton);
    return;
  }

  if (state.actionMenuOpen && !event.target.closest("[data-customer-actions-menu]")) {
    closeActionMenu();
  }
}

function onCustomerDetailKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.editModalOpen) closeEditModal();
  else closeActionMenu();
}

function restoredState(value = null) {
  const next = value && typeof value === "object" ? value : {};
  return {
    actionMenuOpen: false,
    editModalOpen: false,
    purchasePage: Number.isInteger(next.purchasePage) && next.purchasePage > 0 ? next.purchasePage : 1
  };
}

export async function mountPage({ scope, signal, url = new URL(window.location.href), historyState = null } = {}) {
  const mountId = ++activeMountId;
  const customerId = url.searchParams.get("id");
  [detailData, currentUser, unread] = await Promise.all([
    getCustomerDetailData(customerId),
    getCurrentUser(),
    getUnread()
  ]);
  throwIfPageAborted(signal);
  liveReadOnly = typeof currentUser?.hasPermission === "function";
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
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
      scope.listen(document, "keydown", onCustomerDetailKeydown);
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
    }
  };
}
