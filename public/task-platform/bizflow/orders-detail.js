// bizflow 訂單詳情桌面屏(Figma 676:92291)。列表與深層明細均由 provider 的 R8a 快照契約提供。

import { getOrderCreateData, getOrderDetailData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { createPrintDialog } from "./print/print-dialog.js";
import { toPrintableOrder } from "./print/print-invoice.js";

const dict = {
  zh: {
    "orders.root": "訂單",
    "orders.shipping": "運送",
    "orders.payment": "付款",
    "orders.salesperson": "銷售人員",
    "orders.customer": "顧客",
    "orders.logistics": "物流單號",
    "orders.paid": "已付款",
    "orders.unpaid": "未付款",
    "orders.unshipped": "未發貨",
    "orders.source.framer": "Framer 表單",
    "orders.source.shopify": "Shopify",
    "orders.source.manual": "Manual",
    "orders.orderTime": "下單時間",
    "orders.addProduct": "新增商品",
    "orders.product": "商品",
    "orders.quantity": "數量",
    "orders.price": "單價",
    "orders.subtotal": "小計",
    "orders.markShipped": "標記為已出貨",
    "orders.shippingFee": "運送",
    "orders.free": "免費",
    "orders.deposit": "押金",
    "orders.discount": "優惠折扣",
    "orders.service": "手續費",
    "orders.total": "總計",
    "orders.paidAmount": "已付款",
    "orders.cancelChange": "撤銷修改",
    "orders.saveChange": "存儲修改",
    "orders.invoice": "發票",
    "orders.receipt": "收據",
    "orders.invoiceSub": "下單後可打印",
    "orders.receiptSub": "付款後可打印",
    "orders.printInvoice": "打印發票",
    "orders.printReceipt": "打印收據",
    "orders.edit": "編輯",
    "orders.carModel": "車型",
    "orders.phone": "電話",
    "orders.email": "郵箱",
    "orders.shippingAddress": "運送地址",
    "orders.trackingNo": "物流單號",
    "orders.cancel": "取消",
    "orders.confirmTracking": "確認單號",
    "orders.itemCount": "{count} 件商品",
    "orders.valuePlaceholder": "HKD$",
    "orders.modal.productTitle": "選取商品",
    "orders.modal.search": "搜尋商品",
    "orders.modal.add": "新增",
    "orders.modal.close": "關閉",
    "orders.product.option": "商品選項",
    "orders.sample.productName": "DC  aAdaptor Pro GBT-CCS2",
    "orders.empty": "暫無商品",
    "orders.notFound": "該記錄不存在或已合併",
    "orders.emptyValue": "—"
  },
  en: {
    "orders.root": "Orders",
    "orders.shipping": "Shipping",
    "orders.payment": "Payment",
    "orders.salesperson": "Salesperson",
    "orders.customer": "Customer",
    "orders.logistics": "Tracking number",
    "orders.paid": "Paid",
    "orders.unpaid": "Unpaid",
    "orders.unshipped": "Unshipped",
    "orders.source.framer": "Framer form",
    "orders.source.shopify": "Shopify",
    "orders.source.manual": "Manual",
    "orders.orderTime": "Order time",
    "orders.addProduct": "Add product",
    "orders.product": "Product",
    "orders.quantity": "Qty",
    "orders.price": "Unit price",
    "orders.subtotal": "Subtotal",
    "orders.markShipped": "Mark shipped",
    "orders.shippingFee": "Shipping",
    "orders.free": "Free",
    "orders.deposit": "Deposit",
    "orders.discount": "Discount",
    "orders.service": "Service fee",
    "orders.total": "Total",
    "orders.paidAmount": "Paid amount",
    "orders.cancelChange": "Revert changes",
    "orders.saveChange": "Save changes",
    "orders.invoice": "Invoice",
    "orders.receipt": "Receipt",
    "orders.invoiceSub": "Printable after order",
    "orders.receiptSub": "Printable after payment",
    "orders.printInvoice": "Print invoice",
    "orders.printReceipt": "Print receipt",
    "orders.edit": "Edit",
    "orders.carModel": "Vehicle model",
    "orders.phone": "Phone",
    "orders.email": "Email",
    "orders.shippingAddress": "Delivery address",
    "orders.trackingNo": "Tracking number",
    "orders.cancel": "Cancel",
    "orders.confirmTracking": "Confirm number",
    "orders.itemCount": "{count} items",
    "orders.valuePlaceholder": "HKD$",
    "orders.modal.productTitle": "Select products",
    "orders.modal.search": "Search products",
    "orders.modal.add": "Add",
    "orders.modal.close": "Close",
    "orders.product.option": "Product option",
    "orders.sample.productName": "DC  aAdaptor Pro GBT-CCS2",
    "orders.empty": "No products",
    "orders.notFound": "This record does not exist or has been merged",
    "orders.emptyValue": "—"
  },
  fr: {
    "orders.root": "Commandes",
    "orders.shipping": "Expédition",
    "orders.payment": "Paiement",
    "orders.salesperson": "Commercial",
    "orders.customer": "Client",
    "orders.logistics": "Numéro de suivi",
    "orders.paid": "Payé",
    "orders.unpaid": "Non payé",
    "orders.unshipped": "Non expédié",
    "orders.source.framer": "Formulaire Framer",
    "orders.source.shopify": "Shopify",
    "orders.source.manual": "Manual",
    "orders.orderTime": "Heure de commande",
    "orders.addProduct": "Ajouter produit",
    "orders.product": "Produit",
    "orders.quantity": "Qté",
    "orders.price": "Prix unitaire",
    "orders.subtotal": "Sous-total",
    "orders.markShipped": "Marquer expédié",
    "orders.shippingFee": "Livraison",
    "orders.free": "Gratuit",
    "orders.deposit": "Dépôt",
    "orders.discount": "Remise",
    "orders.service": "Frais",
    "orders.total": "Total",
    "orders.paidAmount": "Montant payé",
    "orders.cancelChange": "Annuler changements",
    "orders.saveChange": "Enregistrer",
    "orders.invoice": "Facture",
    "orders.receipt": "Reçu",
    "orders.invoiceSub": "Imprimable après commande",
    "orders.receiptSub": "Imprimable après paiement",
    "orders.printInvoice": "Imprimer facture",
    "orders.printReceipt": "Imprimer reçu",
    "orders.edit": "Modifier",
    "orders.carModel": "Modèle",
    "orders.phone": "Téléphone",
    "orders.email": "Email",
    "orders.shippingAddress": "Adresse de livraison",
    "orders.trackingNo": "Numéro de suivi",
    "orders.cancel": "Annuler",
    "orders.confirmTracking": "Confirmer numéro",
    "orders.itemCount": "{count} articles",
    "orders.valuePlaceholder": "HKD$",
    "orders.modal.productTitle": "Choisir les produits",
    "orders.modal.search": "Rechercher",
    "orders.modal.add": "Ajouter",
    "orders.modal.close": "Fermer",
    "orders.product.option": "Option produit",
    "orders.sample.productName": "DC  aAdaptor Pro GBT-CCS2",
    "orders.empty": "Aucun produit",
    "orders.notFound": "Cet enregistrement n’existe pas ou a été fusionné",
    "orders.emptyValue": "—"
  }
};

const params = new URLSearchParams(window.location.search);
const detailData = await getOrderDetailData(params.get("id"));
const pickerData = detailData ? await getOrderCreateData() : { productGroups: [] };

const state = {
  productModalOpen: false,
  productSearch: "",
  selectedOptions: new Set(),
  items: detailData?.detail.items.map((item) => ({ ...item })) ?? [],
  feesEnabled: {
    deposit: true,
    discount: Number(detailData?.detail.fees.discount || 0) !== 0,
    service: Number(detailData?.detail.fees.service || 0) !== 0
  },
  feesTouched: false
};

let currentHelpers = null;
const printDialog = createPrintDialog({ getLang: () => currentHelpers?.lang ?? "zh" });

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function sourceLabel(value, lang) {
  if (value === "Framer") return pageT(lang, "orders.source.framer");
  if (value === "Online Store" || value === "Shopify") return pageT(lang, "orders.source.shopify");
  return value || pageT(lang, "orders.source.manual");
}

function formatMoney(value) {
  return `HKD$ ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function moneyValue(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fieldValue(value, lang) {
  return value === null || value === undefined || value === "" ? pageT(lang, "orders.emptyValue") : String(value);
}

function shippingStatusLabel(value, lang) {
  return value === "unshipped" ? pageT(lang, "orders.unshipped") : fieldValue(value, lang);
}

function itemLabel(item, lang) {
  return item.name ?? pageT(lang, item.nameKey);
}

function renderLineRows(helpers) {
  const { escapeHtml, lang } = helpers;
  const rows = state.items.map((item) => `<div class="orders-figma-line-row">
    <span class="orders-line-product">
      <span class="orders-line-thumb" aria-hidden="true"></span>
      <span class="orders-line-name" title="${escapeHtml(itemLabel(item, lang))}">${escapeHtml(itemLabel(item, lang))}</span>
    </span>
    <span class="orders-qty-box">${escapeHtml(String(item.quantity))}</span>
    <span class="orders-line-price">${escapeHtml(formatMoney(item.price))}</span>
  </div>`).join("");
  return `<div class="orders-figma-table">
    <div class="orders-figma-line-row orders-figma-line-row--head">
      <span>${escapeHtml(pageT(lang, "orders.product"))}</span>
      <span class="orders-line-qty">${escapeHtml(pageT(lang, "orders.quantity"))}</span>
      <span class="orders-line-price">${escapeHtml(pageT(lang, "orders.price"))}</span>
    </div>
    ${rows || `<div class="orders-figma-line-row"><span>${escapeHtml(pageT(lang, "orders.empty"))}</span><span></span><span></span></div>`}
  </div>`;
}

function renderProductModal(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const term = state.productSearch.trim().toLowerCase();
  const groups = pickerData.productGroups.filter((group) => !term || group.name.toLowerCase().includes(term));
  const body = groups.map((group) => `<div class="orders-product-group">
    <div class="orders-product-group__name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</div>
    ${group.options.map((option) => {
      const label = option.label;
      return `<label class="orders-product-option" title="${escapeHtml(label)}">
        <input type="checkbox" data-product-option data-option-id="${escapeHtml(option.id)}"${state.selectedOptions.has(option.id) ? " checked" : ""}>
        <span class="orders-product-option__text">${escapeHtml(label)}</span>
        <span class="orders-product-option__price">${escapeHtml(formatMoney(option.price))}</span>
      </label>`;
    }).join("")}
  </div>`).join("");
  return `<div class="customers-modal-overlay${state.productModalOpen ? " customers-modal-overlay--open" : ""}" data-orders-product-overlay ${state.productModalOpen ? "" : "hidden"}>
    <section class="orders-product-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "orders.modal.productTitle"))}">
      <header class="orders-product-modal__head">
        <h2 class="orders-product-modal__title">${escapeHtml(pageT(lang, "orders.modal.productTitle"))}</h2>
        <button type="button" class="orders-product-modal__close" data-product-modal-close aria-label="${escapeHtml(pageT(lang, "orders.modal.close"))}"></button>
      </header>
      <label class="orders-product-search">
        ${icon("icon-nav-search", "icon")}
        <input type="search" data-product-search value="${escapeHtml(state.productSearch)}" placeholder="${escapeHtml(pageT(lang, "orders.modal.search"))}">
      </label>
      <div class="orders-product-list">${body || `<div class="orders-product-group">${escapeHtml(pageT(lang, "orders.empty"))}</div>`}</div>
      <footer class="orders-product-modal__footer">
        <button type="button" class="orders-secondary" data-product-modal-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="orders-primary" data-product-modal-add>${escapeHtml(pageT(lang, "orders.modal.add"))}</button>
      </footer>
    </section>
  </div>`;
}

function renderCheckControl(key, value, helpers) {
  const { escapeHtml, lang } = helpers;
  const checked = state.feesEnabled[key];
  return `<div class="orders-payment-check-row">
    <label class="orders-figma-check">
      <input type="checkbox" data-fee-toggle="${key}"${checked ? " checked" : ""}>
      <span class="orders-figma-check__box" aria-hidden="true"></span>
      <span>${escapeHtml(pageT(lang, `orders.${key}`))}</span>
    </label>
    <span class="orders-money-input${checked ? "" : " orders-money-input--placeholder"}">${escapeHtml(checked ? String(value) : pageT(lang, "orders.valuePlaceholder"))}</span>
  </div>`;
}

function renderPaymentBox(helpers, subtotal, totalAmount) {
  const { escapeHtml, icon, lang } = helpers;
  const detail = detailData.detail;
  const shippingFee = Number(detail.fees.shipping || 0);
  const totalText = moneyValue(totalAmount);
  return `<div class="orders-payment-detail-box">
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.subtotal"))}</span>
      <span>${escapeHtml(pageT(lang, "orders.itemCount").replace("{count}", String(state.items.length)))}</span>
      <strong><span>HKD$</span>${escapeHtml(moneyValue(subtotal))}</strong>
    </div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.shippingFee"))}</span>
      <button type="button" class="orders-free-select">${escapeHtml(shippingFee === 0 ? pageT(lang, "orders.free") : formatMoney(shippingFee))}${icon("icon-arrow-down", "icon")}</button>
      <strong><span>HKD$</span>${escapeHtml(moneyValue(shippingFee))}</strong>
    </div>
    <div class="orders-payment-divider"></div>
    ${renderCheckControl("deposit", detail.fees.deposit, helpers)}
    ${renderCheckControl("discount", detail.fees.discount, helpers)}
    ${renderCheckControl("service", detail.fees.service, helpers)}
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.total"))}</span>
      <span></span>
      <strong><span>HKD$</span>${escapeHtml(totalText)}</strong>
    </div>
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line orders-payment-line--paid">
      <span>${escapeHtml(pageT(lang, "orders.paidAmount"))}</span>
      <span></span>
      <strong><span>HKD$</span>${escapeHtml(totalText)}</strong>
    </div>
  </div>`;
}

function renderPrintCard(titleKey, subKey, actionKey, mode, disabled, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<div class="orders-print-box">
    <span class="orders-print-box__title">${escapeHtml(pageT(lang, titleKey))}</span>
    <span class="orders-print-box__sub">${escapeHtml(pageT(lang, subKey))}</span>
    <button type="button" class="${disabled ? "orders-disabled" : "orders-primary"}" ${disabled ? "disabled" : `data-print-open="${mode}"`}>${escapeHtml(pageT(lang, actionKey))}</button>
  </div>`;
}

function currentTotals() {
  const { detail } = detailData;
  const subtotal = state.items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const feeTotal = ["deposit", "discount", "service"].reduce(
    (sum, key) => sum + (state.feesEnabled[key] ? Number(detail.fees[key] || 0) : 0),
    Number(detail.fees.shipping || 0)
  );
  const paymentTotal = !state.feesTouched && Number.isFinite(detail.paymentTotal)
    ? detail.paymentTotal
    : subtotal + feeTotal;
  return { subtotal, paymentTotal };
}

function printableOrder() {
  return toPrintableOrder(detailData, {
    items: state.items.map((item) => ({
      name: item.name ?? pageT(currentHelpers?.lang ?? "zh", item.nameKey),
      quantity: item.quantity,
      price: item.price
    })),
    paymentTotal: currentTotals().paymentTotal
  });
}

function renderSalespersonCard(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const salesperson = fieldValue(detailData.detail.salesperson, lang);
  return `<section class="orders-detail-card">
    <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.salesperson"))}</h2>
    <div class="orders-select-like" title="${escapeHtml(salesperson)}">
      <span>${escapeHtml(salesperson)}</span>
      ${icon("icon-arrow-down", "icon")}
    </div>
  </section>`;
}

function renderCustomerInfo(helpers) {
  const { escapeHtml, lang } = helpers;
  const { order, detail } = detailData;
  const email = fieldValue(detail.email, lang);
  const carModel = fieldValue(detail.carModel, lang);
  const shippingAddress = fieldValue(detail.shippingAddress, lang);
  return `<section class="orders-detail-card">
    <div class="orders-card-head">
      <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.customer"))}</h2>
      <button type="button" class="orders-primary orders-hug-small">${escapeHtml(pageT(lang, "orders.edit"))}</button>
    </div>
    <div class="orders-customer-info">
      <div class="orders-customer-line">
        <span>${escapeHtml(pageT(lang, "orders.customer"))}</span>
        <strong title="${escapeHtml(order.customer)}">${escapeHtml(order.customer)}</strong>
        <strong title="${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</strong>
        <strong title="${escapeHtml(email)}">${escapeHtml(email)}</strong>
      </div>
      <div class="orders-customer-line">
        <span>${escapeHtml(pageT(lang, "orders.carModel"))}</span>
        <strong title="${escapeHtml(carModel)}">${escapeHtml(carModel)}</strong>
      </div>
      <div class="orders-field">
        <span class="orders-field__label">${escapeHtml(pageT(lang, "orders.shippingAddress"))}</span>
        <span class="orders-address-box">${escapeHtml(shippingAddress)}</span>
      </div>
    </div>
  </section>`;
}

function renderTrackingCard(helpers) {
  const { escapeHtml, lang } = helpers;
  const { carrier, trackingNo } = detailData.detail;
  const value = trackingNo ? [carrier, trackingNo].filter(Boolean).join(" · ") : fieldValue("", lang);
  return `<section class="orders-detail-card">
    <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.trackingNo"))}</h2>
    <span class="orders-select-like">${escapeHtml(value)}</span>
    <div class="orders-card-actions orders-card-actions--end">
      <button type="button" class="orders-secondary">${escapeHtml(pageT(lang, "orders.cancel"))}</button>
      <button type="button" class="orders-primary">${escapeHtml(pageT(lang, "orders.confirmTracking"))}</button>
    </div>
  </section>`;
}

function renderTimeline(helpers) {
  const { escapeHtml } = helpers;
  const timeline = detailData.detail.timeline;
  if (!timeline.length) return "";
  return `<div class="orders-timeline-panel">
    ${timeline.map((item, index) => `<div class="orders-timeline-row${index === 0 ? " orders-timeline-row--active" : ""}">
      <span class="orders-timeline-dot"></span>
      <span class="orders-timeline-text">${escapeHtml(item.label)}<small>${escapeHtml(item.time)}</small></span>
    </div>`).join("")}
  </div>`;
}

function renderDetail(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  if (!detailData) {
    const notFound = pageT(lang, "orders.notFound");
    return `<div class="orders-workspace" data-orders-detail-page data-order-not-found>
      <header class="orders-workspace__head">
        <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "orders.root"))}">
          <a href="./orders.html">${escapeHtml(pageT(lang, "orders.root"))}</a>
          <span>${escapeHtml(">")}</span>
          <span class="orders-breadcrumb__current">${escapeHtml(notFound)}</span>
        </nav>
      </header>
      <section class="orders-detail-card customer-purchase-empty">${escapeHtml(notFound)}</section>
    </div>`;
  }
  const { order, detail } = detailData;
  const paid = order.status === "completed";
  const shippingStatus = shippingStatusLabel(detail.shippingStatus, lang);
  const shipped = detail.shippingStatus !== "unshipped";
  const { subtotal, paymentTotal } = currentTotals();
  return `<div class="orders-workspace" data-orders-detail-page>
    <header class="orders-workspace__head">
      <div>
        <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "orders.root"))}">
          <a href="./orders.html">${escapeHtml(pageT(lang, "orders.root"))}</a>
          <span>${escapeHtml(">")}</span>
          <span class="orders-breadcrumb__current">${escapeHtml(detail.orderNo)}</span>
        </nav>
        <div class="orders-time">${escapeHtml(pageT(lang, "orders.orderTime"))}: ${escapeHtml(`${order.date} ${detail.time}`)}</div>
      </div>
      <div class="orders-head-chips">
        <span class="orders-chip ${paid ? "orders-chip--blue" : "orders-chip--yellow"}">${escapeHtml(pageT(lang, paid ? "orders.paid" : "orders.unpaid"))}</span>
        <span class="orders-chip ${shipped ? "orders-chip--blue" : "orders-chip--red"}">${escapeHtml(shippingStatus)}</span>
        <span class="orders-chip orders-chip--source">${escapeHtml(sourceLabel(order.channel, lang))}</span>
      </div>
    </header>

    <section class="orders-detail-card orders-shipping-card">
      <div class="orders-card-head">
        <span class="orders-chip orders-chip--shipping">${escapeHtml(shippingStatus)}</span>
        <button type="button" class="orders-dark" data-product-modal-open>${icon("icon-add-line-add", "icon")}${escapeHtml(pageT(lang, "orders.addProduct"))}</button>
      </div>
      ${renderLineRows(helpers)}
      <div class="orders-figma-total-row"><span>${escapeHtml(pageT(lang, "orders.total"))}</span><strong><span>HKD$</span>${escapeHtml(moneyValue(subtotal))}</strong></div>
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-primary">${escapeHtml(pageT(lang, "orders.markShipped"))}</button>
      </div>
    </section>

    <section class="orders-detail-card">
      <div class="orders-card-head">
        <span class="orders-chip ${paid ? "orders-chip--blue" : "orders-chip--yellow"}">${escapeHtml(pageT(lang, paid ? "orders.paid" : "orders.unpaid"))}</span>
      </div>
      ${renderPaymentBox(helpers, subtotal, paymentTotal)}
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-secondary">${escapeHtml(pageT(lang, "orders.cancelChange"))}</button>
        <button type="button" class="orders-primary">${escapeHtml(pageT(lang, "orders.saveChange"))}</button>
      </div>
    </section>

    <section class="orders-print-grid">
      ${renderPrintCard("orders.invoice", "orders.invoiceSub", "orders.printInvoice", "invoice", false, helpers)}
      ${renderPrintCard("orders.receipt", "orders.receiptSub", "orders.printReceipt", "receipt", false, helpers)}
    </section>

    ${renderSalespersonCard(helpers)}
    ${renderCustomerInfo(helpers)}
    ${renderTrackingCard(helpers)}
    ${renderTimeline(helpers)}
    ${renderProductModal(helpers)}
  </div>`;
}

function rerender({ focusProductSearch = false } = {}) {
  const page = document.querySelector("[data-orders-detail-page]");
  if (!page || !currentHelpers) return;
  page.outerHTML = renderDetail(currentHelpers);
  if (focusProductSearch) {
    const input = document.querySelector("[data-product-search]");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function closeProductModal() {
  state.productModalOpen = false;
  state.selectedOptions.clear();
  state.productSearch = "";
  rerender();
}

document.addEventListener("click", (event) => {
  const printOpen = event.target.closest("[data-print-open]");
  if (printOpen) {
    printDialog.open(printableOrder(), printOpen.getAttribute("data-print-open"), printOpen);
    return;
  }
  if (event.target.closest("[data-product-modal-open]")) {
    state.productModalOpen = true;
    rerender({ focusProductSearch: true });
    return;
  }
  if (event.target.closest("[data-product-modal-close]") || event.target.matches("[data-orders-product-overlay]")) {
    closeProductModal();
    return;
  }
  if (event.target.closest("[data-product-modal-add]")) {
    const selected = pickerData.productGroups.flatMap((group) => group.options.map((option) => ({ group, option })))
      .filter(({ option }) => state.selectedOptions.has(option.id));
    selected.forEach(({ option }) => {
      state.items.push({
        id: option.id,
        name: option.label,
        quantity: 1,
        price: option.price
      });
    });
    closeProductModal();
    return;
  }
});

document.addEventListener("change", (event) => {
  const option = event.target.closest("[data-product-option]");
  if (option) {
    const id = option.getAttribute("data-option-id");
    if (option.checked) state.selectedOptions.add(id);
    else state.selectedOptions.delete(id);
  }
  const fee = event.target.closest("[data-fee-toggle]");
  if (fee) {
    state.feesEnabled[fee.getAttribute("data-fee-toggle")] = fee.checked;
    state.feesTouched = true;
    rerender();
  }
});

document.addEventListener("input", (event) => {
  const search = event.target.closest("[data-product-search]");
  if (search) {
    state.productSearch = search.value;
    rerender({ focusProductSearch: true });
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.productModalOpen) closeProductModal();
});

window.__shellMenu = createBizflowMenu("orders");
window.__shellData = { unread: await getUnread(), user: await getCurrentUser() };
window.__shellContent = renderDetail;
await import("../shell/shell.js");
