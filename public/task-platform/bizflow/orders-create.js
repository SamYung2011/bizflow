// bizflow 建立訂單桌面屏(Figma 676:93247 / 676:93440 / 676:93614)。草稿不落庫,商品小計只由本頁加入行即時計算。

import { getOrderCreateData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { renderNewCustomerFields } from "../components/new-customer-fields.js";

const dict = {
  zh: {
    "orders.root": "訂單",
    "orders.create": "建立訂單草稿",
    "orders.shipping": "運送",
    "orders.payment": "付款",
    "orders.salesperson": "銷售人員",
    "orders.customer": "顧客",
    "orders.logistics": "物流單號",
    "orders.orderTime": "下單時間",
    "orders.unshipped": "未發貨",
    "orders.addProduct": "新增商品",
    "orders.product": "商品",
    "orders.productName": "商品名稱",
    "orders.quantity": "數量",
    "orders.price": "單價",
    "orders.emptyLine": "暫未新增商品",
    "orders.subtotal": "小計",
    "orders.shippingFee": "運送",
    "orders.free": "免費",
    "orders.total": "總計",
    "orders.markPaid": "標記為已付款",
    "orders.deposit": "押金",
    "orders.discount": "優惠折扣",
    "orders.service": "手續費",
    "orders.paidAmount": "已付款",
    "orders.invoice": "發票",
    "orders.receipt": "收據",
    "orders.invoiceSub": "下單後可打印",
    "orders.receiptSub": "付款後可打印",
    "orders.printInvoice": "打印發票",
    "orders.printReceipt": "打印收據",
    "orders.chooseSalesperson": "選擇銷售人員",
    "orders.selectCustomer": "選擇顧客",
    "orders.searchCustomer": "搜尋姓名、電話或電郵",
    "orders.customerNoResults": "沒有符合的顧客",
    "orders.addCustomer": "新增顧客",
    "orders.carModel": "車型",
    "orders.phone": "電話",
    "orders.email": "郵箱",
    "orders.shippingAddress": "運送地址",
    "orders.delivery": "快遞物流",
    "orders.pickup": "上門取貨",
    "orders.trackingNo": "物流單號",
    "orders.modal.productTitle": "選取商品",
    "orders.modal.search": "搜尋商品",
    "orders.modal.add": "新增",
    "orders.modal.close": "關閉",
    "orders.product.option": "商品選項",
    "orders.cancel": "取消",
    "orders.confirmTracking": "確認單號",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "新增顧客",
    "orders.field.name": "姓名",
    "orders.field.phone": "聯絡電話",
    "orders.field.email": "Email",
    "orders.field.carModel": "車型",
    "orders.field.imei": "產品IMEI碼",
    "orders.field.address": "運送地址",
    "orders.action.submit": "提交",
    "orders.action.close": "關閉"
  },
  en: {
    "orders.root": "Orders",
    "orders.create": "Create draft order",
    "orders.shipping": "Shipping",
    "orders.payment": "Payment",
    "orders.salesperson": "Salesperson",
    "orders.customer": "Customer",
    "orders.logistics": "Tracking number",
    "orders.orderTime": "Order time",
    "orders.unshipped": "Unshipped",
    "orders.addProduct": "Add product",
    "orders.product": "Product",
    "orders.productName": "Product name",
    "orders.quantity": "Qty",
    "orders.price": "Unit price",
    "orders.emptyLine": "No products added",
    "orders.subtotal": "Subtotal",
    "orders.shippingFee": "Shipping",
    "orders.free": "Free",
    "orders.total": "Total",
    "orders.markPaid": "Mark as paid",
    "orders.deposit": "Deposit",
    "orders.discount": "Discount",
    "orders.service": "Service fee",
    "orders.paidAmount": "Paid amount",
    "orders.invoice": "Invoice",
    "orders.receipt": "Receipt",
    "orders.invoiceSub": "Printable after order",
    "orders.receiptSub": "Printable after payment",
    "orders.printInvoice": "Print invoice",
    "orders.printReceipt": "Print receipt",
    "orders.chooseSalesperson": "Choose salesperson",
    "orders.selectCustomer": "Select customer",
    "orders.searchCustomer": "Search name, phone or email",
    "orders.customerNoResults": "No matching customers",
    "orders.addCustomer": "Add customer",
    "orders.carModel": "Vehicle model",
    "orders.phone": "Phone",
    "orders.email": "Email",
    "orders.shippingAddress": "Delivery address",
    "orders.delivery": "Delivery",
    "orders.pickup": "Pickup",
    "orders.trackingNo": "Tracking number",
    "orders.modal.productTitle": "Select products",
    "orders.modal.search": "Search products",
    "orders.modal.add": "Add",
    "orders.modal.close": "Close",
    "orders.product.option": "Product option",
    "orders.cancel": "Cancel",
    "orders.confirmTracking": "Confirm number",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "Add customer",
    "orders.field.name": "Name",
    "orders.field.phone": "Phone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Vehicle model",
    "orders.field.imei": "Product IMEI",
    "orders.field.address": "Shipping address",
    "orders.action.submit": "Submit",
    "orders.action.close": "Close"
  },
  fr: {
    "orders.root": "Commandes",
    "orders.create": "Créer brouillon",
    "orders.shipping": "Expédition",
    "orders.payment": "Paiement",
    "orders.salesperson": "Commercial",
    "orders.customer": "Client",
    "orders.logistics": "Numéro de suivi",
    "orders.orderTime": "Heure de commande",
    "orders.unshipped": "Non expédié",
    "orders.addProduct": "Ajouter produit",
    "orders.product": "Produit",
    "orders.productName": "Nom produit",
    "orders.quantity": "Qté",
    "orders.price": "Prix unitaire",
    "orders.emptyLine": "Aucun produit ajouté",
    "orders.subtotal": "Sous-total",
    "orders.shippingFee": "Livraison",
    "orders.free": "Gratuit",
    "orders.total": "Total",
    "orders.markPaid": "Marquer payé",
    "orders.deposit": "Dépôt",
    "orders.discount": "Remise",
    "orders.service": "Frais",
    "orders.paidAmount": "Montant payé",
    "orders.invoice": "Facture",
    "orders.receipt": "Reçu",
    "orders.invoiceSub": "Imprimable après commande",
    "orders.receiptSub": "Imprimable après paiement",
    "orders.printInvoice": "Imprimer facture",
    "orders.printReceipt": "Imprimer reçu",
    "orders.chooseSalesperson": "Choisir commercial",
    "orders.selectCustomer": "Choisir client",
    "orders.searchCustomer": "Rechercher nom, téléphone ou e-mail",
    "orders.customerNoResults": "Aucun client correspondant",
    "orders.addCustomer": "Ajouter client",
    "orders.carModel": "Modèle",
    "orders.phone": "Téléphone",
    "orders.email": "Email",
    "orders.shippingAddress": "Adresse de livraison",
    "orders.delivery": "Livraison",
    "orders.pickup": "Retrait",
    "orders.trackingNo": "Numéro de suivi",
    "orders.modal.productTitle": "Choisir les produits",
    "orders.modal.search": "Rechercher",
    "orders.modal.add": "Ajouter",
    "orders.modal.close": "Fermer",
    "orders.product.option": "Option produit",
    "orders.cancel": "Annuler",
    "orders.confirmTracking": "Confirmer numéro",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "Ajouter un client",
    "orders.field.name": "Nom",
    "orders.field.phone": "Téléphone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Modèle",
    "orders.field.imei": "IMEI produit",
    "orders.field.address": "Adresse livraison",
    "orders.action.submit": "Soumettre",
    "orders.action.close": "Fermer"
  }
};

const [data, currentUser] = await Promise.all([getOrderCreateData(), getCurrentUser()]);
const liveReadOnly = typeof currentUser?.hasPermission === "function";
const writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
const draftCreatedAt = new Date();
const CUSTOMER_RESULTS_LIMIT = 20; // 联想下拉只渲染前 20 条匹配,避免 4198 行 DOM。

const state = {
  productModalOpen: false,
  productSearch: "",
  selectedOptions: new Set(),
  lineItems: [],
  customerMenuOpen: false,
  customerSearch: "",
  selectedCustomerId: "",
  customerModalOpen: false,
  shippingMode: "delivery",
  feesEnabled: { deposit: true, discount: false, service: false }
};

let currentHelpers = null;

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function formatMoney(value) {
  return `HKD$ ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function selectedCustomer() {
  return data.customers.find((customer) => customer.id === state.selectedCustomerId) ?? null;
}

function formatDraftTime(value) {
  const pad = (part) => String(part).padStart(2, "0");
  return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function matchingCustomers() {
  const term = state.customerSearch.trim().toLocaleLowerCase();
  return data.customers.filter((customer) => !term || [
    customer.name,
    customer.phone,
    customer.detail?.email
  ].some((value) => String(value || "").toLocaleLowerCase().includes(term))).slice(0, CUSTOMER_RESULTS_LIMIT);
}

function total() {
  return state.lineItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
}

function renderLineRows(helpers) {
  const { escapeHtml, lang } = helpers;
  const realRows = state.lineItems.map((item) => `<div class="orders-create-item-row">
    <span class="orders-line-product">
      <span class="orders-line-thumb" aria-hidden="true"></span>
      <span class="orders-line-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    </span>
    <span class="orders-qty-box">${escapeHtml(String(item.quantity))}</span>
    <span class="orders-line-price">${escapeHtml(formatMoney(item.price * item.quantity))}</span>
    <button type="button" class="orders-remove-dot" data-remove-line="${escapeHtml(item.id)}" data-orders-write aria-label="${escapeHtml(pageT(lang, "orders.cancel"))}"${writeAttributes}></button>
  </div>`).join("");
  return `<div class="orders-create-lines">${realRows || `<div class="orders-create-empty">${escapeHtml(pageT(lang, "orders.emptyLine"))}</div>`}</div>`;
}

function renderProductModal(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const term = state.productSearch.trim().toLowerCase();
  const groups = data.productGroups.filter((group) => !term || group.name.toLowerCase().includes(term));
  return `<div class="customers-modal-overlay${state.productModalOpen ? " customers-modal-overlay--open" : ""}" data-orders-product-overlay ${state.productModalOpen ? "" : "hidden"}>
    <section class="orders-product-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "orders.modal.productTitle"))}">
      <header class="orders-product-modal__head">
        <h2 class="orders-product-modal__title">${escapeHtml(pageT(lang, "orders.modal.productTitle"))}</h2>
        <button type="button" class="orders-product-modal__close" data-product-modal-close aria-label="${escapeHtml(pageT(lang, "orders.modal.close"))}"></button>
      </header>
      <label class="orders-product-search">
        ${icon("icon-nav-search", "icon")}
        <input type="search" data-product-search data-orders-write value="${escapeHtml(state.productSearch)}" placeholder="${escapeHtml(pageT(lang, "orders.modal.search"))}"${writeAttributes}>
      </label>
      <div class="orders-product-list">
        ${groups.map((group) => `<div class="orders-product-group">
          <div class="orders-product-group__name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</div>
          ${group.options.map((option) => {
            const label = option.label;
            return `<label class="orders-product-option" title="${escapeHtml(label)}">
              <input type="checkbox" data-product-option data-orders-write data-option-id="${escapeHtml(option.id)}"${state.selectedOptions.has(option.id) ? " checked" : ""}${writeAttributes}>
              <span class="orders-product-option__text">${escapeHtml(label)}</span>
              <span class="orders-product-option__price">${escapeHtml(formatMoney(option.price))}</span>
            </label>`;
          }).join("")}
        </div>`).join("")}
      </div>
      <footer class="orders-product-modal__footer">
        <button type="button" class="orders-secondary" data-product-modal-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="orders-primary" data-product-modal-add data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.modal.add"))}</button>
      </footer>
    </section>
  </div>`;
}

function renderCustomerSelect(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const customer = selectedCustomer();
  const options = matchingCustomers().map((item) => `<button type="button" role="option" aria-selected="${item.id === state.selectedCustomerId}" class="dropdown-item${item.id === state.selectedCustomerId ? " dropdown-item--selected" : ""}" data-customer-option="${escapeHtml(item.id)}" data-orders-write title="${escapeHtml([item.name, item.phone].filter(Boolean).join(" · "))}"${writeAttributes}>
    <span class="tp-line">${escapeHtml([item.name, item.phone].filter(Boolean).join(" · "))}</span>
  </button>`).join("");
  return `<div class="orders-select menu-anchor">
    <button type="button" class="orders-select__trigger" data-customer-trigger data-orders-write aria-expanded="${state.customerMenuOpen}" title="${escapeHtml(customer?.name ?? pageT(lang, "orders.selectCustomer"))}"${writeAttributes}>
      <span>${escapeHtml(customer?.name ?? pageT(lang, "orders.selectCustomer"))}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="menu-popover orders-select__menu${state.customerMenuOpen ? " menu-popover--open" : ""}" data-customer-menu>
      <label class="orders-customer-search">
        ${icon("icon-nav-search", "icon")}
        <input type="search" data-customer-search data-orders-write value="${escapeHtml(state.customerSearch)}" placeholder="${escapeHtml(pageT(lang, "orders.searchCustomer"))}" aria-label="${escapeHtml(pageT(lang, "orders.searchCustomer"))}"${writeAttributes}>
      </label>
      <div class="orders-customer-results" role="listbox">
        ${options || `<span class="orders-customer-empty">${escapeHtml(pageT(lang, "orders.customerNoResults"))}</span>`}
      </div>
    </div>
  </div>`;
}

function renderAddCustomerModal(helpers) {
  const { escapeHtml, lang } = helpers;
  return `<div class="customers-modal-overlay${state.customerModalOpen ? " customers-modal-overlay--open" : ""}" data-create-customer-overlay ${state.customerModalOpen ? "" : "hidden"}>
    <section class="tp-component form-new-customer" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "orders.customerModal.title"))}">
      <button type="button" class="form-new-customer__close" data-customer-modal-close aria-label="${escapeHtml(pageT(lang, "orders.action.close"))}"></button>
      <h2 class="form-new-customer__title">${escapeHtml(pageT(lang, "orders.customerModal.title"))}</h2>
      <div class="form-new-customer__fields">
        ${renderNewCustomerFields({
          lang,
          escapeHtml,
          label: (key) => pageT(lang, `orders.field.${key}`),
          idPrefix: "orders-new-customer",
          disabled: liveReadOnly
        })}
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-modal-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-modal-close data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.action.submit"))}</button>
      </div>
    </section>
  </div>`;
}

function renderCreateCheckControl(key, value, helpers) {
  const { escapeHtml, lang } = helpers;
  const checked = state.feesEnabled[key];
  return `<div class="orders-payment-check-row">
    <label class="orders-figma-check">
      <input type="checkbox" data-fee-toggle="${key}" data-orders-write${checked ? " checked" : ""}${writeAttributes}>
      <span class="orders-figma-check__box" aria-hidden="true"></span>
      <span>${escapeHtml(pageT(lang, `orders.${key}`))}</span>
    </label>
    <span class="orders-money-input${checked ? "" : " orders-money-input--placeholder"}">${escapeHtml(checked ? String(value) : pageT(lang, "orders.valuePlaceholder"))}</span>
  </div>`;
}

function renderCreatePaymentBox(helpers, sum) {
  const { escapeHtml, icon, lang } = helpers;
  const totalText = formatMoney(sum).replace("HKD$ ", "");
  return `<div class="orders-payment-detail-box">
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.subtotal"))}</span>
      <span></span>
      <strong><span>HKD$</span>${escapeHtml(totalText)}</strong>
    </div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.shippingFee"))}</span>
      <button type="button" class="orders-free-select" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.free"))}${icon("icon-arrow-down", "icon")}</button>
      <strong><span>HKD$</span>0.00</strong>
    </div>
    <div class="orders-payment-divider"></div>
    ${renderCreateCheckControl("deposit", 0, helpers)}
    ${renderCreateCheckControl("discount", 0, helpers)}
    ${renderCreateCheckControl("service", 0, helpers)}
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

function renderPrintCard(titleKey, subKey, actionKey, disabled, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<div class="orders-print-box">
    <span class="orders-print-box__title">${escapeHtml(pageT(lang, titleKey))}</span>
    <span class="orders-print-box__sub">${escapeHtml(pageT(lang, subKey))}</span>
    <button type="button" class="${disabled ? "orders-disabled" : "orders-primary"}" ${disabled ? "disabled" : ""}>${escapeHtml(pageT(lang, actionKey))}</button>
  </div>`;
}

function renderSalespersonCard(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  return `<section class="orders-detail-card">
    <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.salesperson"))}</h2>
    <div class="orders-select-like" title="${escapeHtml(pageT(lang, "orders.chooseSalesperson"))}">
      <span>${escapeHtml(pageT(lang, "orders.chooseSalesperson"))}</span>
      ${icon("icon-arrow-down", "icon")}
    </div>
  </section>`;
}

function renderSelectedCustomerInfo(helpers) {
  const { escapeHtml, lang } = helpers;
  const customer = selectedCustomer();
  const email = customer?.detail?.email ?? "";
  const carModel = customer?.detail?.carModel ?? "";
  const shippingAddress = customer?.detail?.shippingAddress ?? "";
  return `<div class="orders-customer-info">
    <div class="orders-customer-line">
      <span>${escapeHtml(pageT(lang, "orders.customer"))}</span>
      <strong title="${escapeHtml(customer?.name ?? "")}">${escapeHtml(customer?.name ?? "")}</strong>
      <strong title="${escapeHtml(customer?.phone ?? "")}">${escapeHtml(customer?.phone ?? "")}</strong>
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
  </div>`;
}

function renderCreate(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  const sum = total();
  return `<div class="orders-workspace" data-orders-create-page data-live-read-only="${liveReadOnly}">
    <header class="orders-workspace__head">
      <div>
        <nav class="orders-breadcrumb" aria-label="${escapeHtml(pageT(lang, "orders.root"))}">
          <a href="./orders.html">${escapeHtml(pageT(lang, "orders.root"))}</a>
          <span>${escapeHtml(">")}</span>
          <span class="orders-breadcrumb__current">${escapeHtml(pageT(lang, "orders.create"))}</span>
        </nav>
        <div class="orders-time">${escapeHtml(pageT(lang, "orders.orderTime"))}: ${escapeHtml(formatDraftTime(draftCreatedAt))}</div>
      </div>
    </header>

    <section class="orders-detail-card orders-shipping-card">
      <div class="orders-card-head">
        <span class="orders-chip orders-chip--shipping">${escapeHtml(pageT(lang, "orders.unshipped"))}</span>
        <button type="button" class="orders-dark" data-product-modal-open data-orders-write${writeAttributes}>${icon("icon-add-line-add", "icon")}${escapeHtml(pageT(lang, "orders.addProduct"))}</button>
      </div>
      ${renderLineRows(helpers)}
    </section>

    <section class="orders-detail-card">
      ${renderCreatePaymentBox(helpers, sum)}
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-primary" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.markPaid"))}</button>
      </div>
    </section>

    <section class="orders-print-grid">
      ${renderPrintCard("orders.invoice", "orders.invoiceSub", "orders.printInvoice", true, helpers)}
      ${renderPrintCard("orders.receipt", "orders.receiptSub", "orders.printReceipt", true, helpers)}
    </section>

    <section class="orders-detail-card">
      <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.customer"))}</h2>
      ${renderCustomerSelect(helpers)}
      <button type="button" class="orders-primary orders-full-btn" data-customer-modal-open data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.addCustomer"))}</button>
      ${renderSelectedCustomerInfo(helpers)}
    </section>

    ${renderSalespersonCard(helpers)}

    <section class="orders-detail-card">
      <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.logistics"))}</h2>
      <div class="orders-logistics-segment" role="tablist">
        <button type="button" class="${state.shippingMode === "delivery" ? "is-active" : ""}" data-shipping-mode="delivery" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.delivery"))}</button>
        <button type="button" class="${state.shippingMode === "pickup" ? "is-active" : ""}" data-shipping-mode="pickup" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.pickup"))}</button>
      </div>
      <div class="orders-field">
        <span class="orders-field__label">${escapeHtml(pageT(lang, "orders.trackingNo"))}</span>
        <span class="orders-select-like">${escapeHtml(pageT(lang, "orders.unshipped"))}</span>
      </div>
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-secondary" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="orders-primary" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.confirmTracking"))}</button>
      </div>
    </section>

    ${renderProductModal(helpers)}
    ${renderAddCustomerModal(helpers)}
  </div>`;
}

function rerender({ focusProductSearch = false, focusCustomerSearch = false } = {}) {
  const page = document.querySelector("[data-orders-create-page]");
  if (!page || !currentHelpers) return;
  page.outerHTML = renderCreate(currentHelpers);
  if (focusProductSearch) {
    const input = document.querySelector("[data-product-search]");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  if (focusCustomerSearch) {
    const input = document.querySelector("[data-customer-search]");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function closeProductModal() {
  state.productModalOpen = false;
  state.productSearch = "";
  state.selectedOptions.clear();
  rerender();
}

function closeCustomerModal() {
  state.customerModalOpen = false;
  rerender();
}

document.addEventListener("click", (event) => {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (event.target.closest("[data-product-modal-open]")) {
    state.productModalOpen = true;
    state.customerMenuOpen = false;
    rerender({ focusProductSearch: true });
    return;
  }
  if (event.target.closest("[data-product-modal-close]") || event.target.matches("[data-orders-product-overlay]")) {
    closeProductModal();
    return;
  }
  if (event.target.closest("[data-product-modal-add]")) {
    const selected = data.productGroups.flatMap((group) => group.options.map((option) => ({ group, option })))
      .filter(({ option }) => state.selectedOptions.has(option.id));
    selected.forEach(({ option }) => {
      state.lineItems.push({
        id: `${option.id}-${Date.now()}-${state.lineItems.length}`,
        name: option.label,
        quantity: 1,
        price: option.price
      });
    });
    closeProductModal();
    return;
  }
  const remove = event.target.closest("[data-remove-line]");
  if (remove) {
    state.lineItems = state.lineItems.filter((item) => item.id !== remove.getAttribute("data-remove-line"));
    rerender();
    return;
  }
  if (event.target.closest("[data-customer-trigger]")) {
    state.customerMenuOpen = !state.customerMenuOpen;
    state.customerSearch = "";
    rerender({ focusCustomerSearch: state.customerMenuOpen });
    return;
  }
  const customerOption = event.target.closest("[data-customer-option]");
  if (customerOption) {
    state.selectedCustomerId = customerOption.getAttribute("data-customer-option");
    state.customerMenuOpen = false;
    state.customerSearch = "";
    rerender();
    return;
  }
  if (event.target.closest("[data-customer-modal-open]")) {
    state.customerModalOpen = true;
    state.customerMenuOpen = false;
    rerender();
    return;
  }
  if (event.target.closest("[data-customer-modal-close]") || event.target.matches("[data-create-customer-overlay]")) {
    closeCustomerModal();
    return;
  }
  const mode = event.target.closest("[data-shipping-mode]");
  if (mode) {
    state.shippingMode = mode.getAttribute("data-shipping-mode");
    rerender();
    return;
  }
  if (!event.target.closest("[data-customer-menu]") && state.customerMenuOpen) {
    state.customerMenuOpen = false;
    state.customerSearch = "";
    rerender();
  }
});

document.addEventListener("change", (event) => {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  const option = event.target.closest("[data-product-option]");
  if (option) {
    const id = option.getAttribute("data-option-id");
    if (option.checked) state.selectedOptions.add(id);
    else state.selectedOptions.delete(id);
    return;
  }
  const fee = event.target.closest("[data-fee-toggle]");
  if (fee) {
    state.feesEnabled[fee.getAttribute("data-fee-toggle")] = fee.checked;
    rerender();
  }
});

document.addEventListener("input", (event) => {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  const productSearch = event.target.closest("[data-product-search]");
  if (productSearch) {
    state.productSearch = productSearch.value;
    rerender({ focusProductSearch: true });
    return;
  }
  const customerSearch = event.target.closest("[data-customer-search]");
  if (!customerSearch) return;
  state.customerSearch = customerSearch.value;
  rerender({ focusCustomerSearch: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.productModalOpen) closeProductModal();
  else if (state.customerModalOpen) closeCustomerModal();
  else if (state.customerMenuOpen) {
    state.customerMenuOpen = false;
    state.customerSearch = "";
    rerender();
  }
});

window.__shellMenu = createBizflowMenu("orders");
window.__shellData = { unread: await getUnread(), user: currentUser };
window.__shellContent = renderCreate;
await import("../shell/shell.js");
