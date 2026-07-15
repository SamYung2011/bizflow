// bizflow 建立訂單桌面屏(Figma 676:93247 / 676:93440 / 676:93614)。未登录演示态保持本地草稿；登录态接生产写入。

import { getOrderCreateData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { renderNewCustomerFields } from "../components/new-customer-fields.js";
import {
  createAndPayLiveOrder,
  createLiveOrderCustomer,
  getLiveOrderWriteOptions
} from "../data/live-orders-writes.js";

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
    "orders.shippingPermission": "需要發貨權限",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "新增顧客",
    "orders.field.name": "姓名",
    "orders.field.phone": "聯絡電話",
    "orders.field.email": "Email",
    "orders.field.carModel": "車型",
    "orders.field.imei": "產品IMEI碼",
    "orders.field.address": "運送地址",
    "orders.action.submit": "提交",
    "orders.action.close": "關閉",
    "orders.salesperson.none": "（無）",
    "orders.write.saving": "正在保存…",
    "orders.write.failed": "訂單保存失敗，請重試",
    "orders.write.recoveryFailed": "訂單保存失敗，且自動還原未完成，請立即核對訂單與庫存",
    "orders.validation.customer": "請先選擇顧客",
    "orders.validation.items": "請至少新增一件商品",
    "orders.validation.total": "訂單總額必須大於 0",
    "orders.validation.customerName": "請輸入顧客姓名",
    "orders.validation.imei": "IMEI 必須為 15 位數字",
    "orders.validation.tracking": "物流單號格式不正確",
    "orders.customer.created": "顧客已新增",
    "orders.customer.failed": "新增顧客失敗，請重試",
    "orders.customer.imeiConflict": "顧客已新增，但 IMEI 已屬於其他顧客",
    "orders.customer.deviceFailed": "顧客已新增，但 IMEI 未能保存",
    "orders.tracking.ready": "物流資料會在付款時一併保存"
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
    "orders.shippingPermission": "Shipping permission required",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "Add customer",
    "orders.field.name": "Name",
    "orders.field.phone": "Phone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Vehicle model",
    "orders.field.imei": "Product IMEI",
    "orders.field.address": "Shipping address",
    "orders.action.submit": "Submit",
    "orders.action.close": "Close",
    "orders.salesperson.none": "(None)",
    "orders.write.saving": "Saving…",
    "orders.write.failed": "Could not save the order. Try again.",
    "orders.write.recoveryFailed": "The order failed and automatic recovery was incomplete. Check the order and stock now.",
    "orders.validation.customer": "Select a customer first",
    "orders.validation.items": "Add at least one product",
    "orders.validation.total": "The order total must be greater than 0",
    "orders.validation.customerName": "Enter a customer name",
    "orders.validation.imei": "IMEI must contain 15 digits",
    "orders.validation.tracking": "The tracking number format is invalid",
    "orders.customer.created": "Customer added",
    "orders.customer.failed": "Could not add the customer. Try again.",
    "orders.customer.imeiConflict": "Customer added, but the IMEI belongs to another customer",
    "orders.customer.deviceFailed": "Customer added, but the IMEI could not be saved",
    "orders.tracking.ready": "Shipping details will be saved with the payment"
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
    "orders.shippingPermission": "Autorisation d’expédition requise",
    "orders.valuePlaceholder": "HKD$",
    "orders.customerModal.title": "Ajouter un client",
    "orders.field.name": "Nom",
    "orders.field.phone": "Téléphone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Modèle",
    "orders.field.imei": "IMEI produit",
    "orders.field.address": "Adresse livraison",
    "orders.action.submit": "Soumettre",
    "orders.action.close": "Fermer",
    "orders.salesperson.none": "(Aucun)",
    "orders.write.saving": "Enregistrement…",
    "orders.write.failed": "Impossible d’enregistrer la commande. Réessayez.",
    "orders.write.recoveryFailed": "Échec de la commande et restauration automatique incomplète. Vérifiez immédiatement la commande et le stock.",
    "orders.validation.customer": "Sélectionnez d’abord un client",
    "orders.validation.items": "Ajoutez au moins un produit",
    "orders.validation.total": "Le total doit être supérieur à 0",
    "orders.validation.customerName": "Saisissez le nom du client",
    "orders.validation.imei": "L’IMEI doit contenir 15 chiffres",
    "orders.validation.tracking": "Le format du numéro de suivi est incorrect",
    "orders.customer.created": "Client ajouté",
    "orders.customer.failed": "Impossible d’ajouter le client. Réessayez.",
    "orders.customer.imeiConflict": "Client ajouté, mais l’IMEI appartient à un autre client",
    "orders.customer.deviceFailed": "Client ajouté, mais l’IMEI n’a pas pu être enregistré",
    "orders.tracking.ready": "Les données d’expédition seront enregistrées avec le paiement"
  }
};

const [data, currentUser] = await Promise.all([getOrderCreateData(), getCurrentUser()]);
const liveMode = typeof currentUser?.hasPermission === "function";
const liveWritable = liveMode && currentUser?.bizflowMainAccess === true;
const liveReadOnly = liveMode && !liveWritable;
const writeOptions = liveWritable
  ? await getLiveOrderWriteOptions()
  : { defaultWarehouseId: null, salespeople: [] };
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
  customerDraft: {},
  shippingMode: "delivery",
  trackingNumber: "",
  salespersonId: "",
  feesEnabled: { deposit: true, discount: false, service: false },
  fees: { shipping: 0, deposit: 0, discount: 0, service: 0 },
  busy: false,
  notice: "",
  noticeType: ""
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

function subtotal() {
  return state.lineItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
}

function total() {
  return subtotal()
    + Number(state.fees.shipping || 0)
    + (state.feesEnabled.deposit ? Number(state.fees.deposit || 0) : 0)
    + (state.feesEnabled.service ? Number(state.fees.service || 0) : 0)
    - (state.feesEnabled.discount ? Number(state.fees.discount || 0) : 0);
}

function renderLineRows(helpers) {
  const { escapeHtml, lang } = helpers;
  const realRows = state.lineItems.map((item) => `<div class="orders-create-item-row">
    <span class="orders-line-product">
      <span class="orders-line-thumb" aria-hidden="true"></span>
      <span class="orders-line-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    </span>
    ${liveWritable
      ? `<input class="orders-qty-box orders-line-number" type="number" min="1" step="1" data-line-quantity="${escapeHtml(item.id)}" data-orders-write value="${escapeHtml(String(item.quantity))}">
        <input class="orders-line-price orders-line-number" type="number" min="0" step="0.01" data-line-price="${escapeHtml(item.id)}" data-orders-write value="${escapeHtml(String(item.price))}">`
      : `<span class="orders-qty-box">${escapeHtml(String(item.quantity))}</span>
        <span class="orders-line-price">${escapeHtml(formatMoney(item.price * item.quantity))}</span>`}
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
          disabled: liveReadOnly,
          values: state.customerDraft
        })}
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-modal-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-submit data-orders-write${state.busy ? " disabled aria-disabled=\"true\"" : writeAttributes}>${escapeHtml(pageT(lang, state.busy ? "orders.write.saving" : "orders.action.submit"))}</button>
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
    ${liveWritable && checked
      ? `<input type="number" min="0" step="0.01" class="orders-money-input" data-fee-amount="${key}" data-orders-write value="${escapeHtml(String(value || ""))}" placeholder="${escapeHtml(pageT(lang, "orders.valuePlaceholder"))}">`
      : `<span class="orders-money-input${checked ? "" : " orders-money-input--placeholder"}">${escapeHtml(checked ? String(value) : pageT(lang, "orders.valuePlaceholder"))}</span>`}
  </div>`;
}

function renderCreatePaymentBox(helpers, subtotalAmount, totalAmount) {
  const { escapeHtml, icon, lang } = helpers;
  const subtotalText = formatMoney(subtotalAmount).replace("HKD$ ", "");
  const totalText = formatMoney(totalAmount).replace("HKD$ ", "");
  return `<div class="orders-payment-detail-box">
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.subtotal"))}</span>
      <span></span>
      <strong><span>HKD$</span><output data-create-subtotal>${escapeHtml(subtotalText)}</output></strong>
    </div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.shippingFee"))}</span>
      ${liveWritable
        ? `<input type="number" min="0" step="0.01" class="orders-free-select orders-shipping-fee-input" data-shipping-fee data-orders-write value="${escapeHtml(String(state.fees.shipping || ""))}" placeholder="${escapeHtml(pageT(lang, "orders.free"))}">`
        : `<button type="button" class="orders-free-select" data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.free"))}${icon("icon-arrow-down", "icon")}</button>`}
      <strong><span>HKD$</span><output data-create-shipping>${escapeHtml(Number(state.fees.shipping || 0).toFixed(2))}</output></strong>
    </div>
    <div class="orders-payment-divider"></div>
    ${renderCreateCheckControl("deposit", state.fees.deposit, helpers)}
    ${renderCreateCheckControl("discount", state.fees.discount, helpers)}
    ${renderCreateCheckControl("service", state.fees.service, helpers)}
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.total"))}</span>
      <span></span>
      <strong><span>HKD$</span><output data-create-total>${escapeHtml(totalText)}</output></strong>
    </div>
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line orders-payment-line--paid">
      <span>${escapeHtml(pageT(lang, "orders.paidAmount"))}</span>
      <span></span>
      <strong><span>HKD$</span><output data-create-total>${escapeHtml(totalText)}</output></strong>
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
    ${liveWritable
      ? `<select class="orders-select-like orders-select-control" data-salesperson-select data-orders-write>
          <option value="">${escapeHtml(pageT(lang, "orders.salesperson.none"))}</option>
          ${writeOptions.salespeople.map((person) => `<option value="${escapeHtml(person.id)}"${person.id === state.salespersonId ? " selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
        </select>`
      : `<div class="orders-select-like" title="${escapeHtml(pageT(lang, "orders.chooseSalesperson"))}">
          <span>${escapeHtml(pageT(lang, "orders.chooseSalesperson"))}</span>
          ${icon("icon-arrow-down", "icon")}
        </div>`}
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
  const subtotalAmount = subtotal();
  const sum = total();
  const shippingPermissionDenied = liveMode && currentUser?.canShip !== true;
  const shippingAttributes = shippingPermissionDenied
    ? ` disabled aria-disabled="true" title="${escapeHtml(pageT(lang, "orders.shippingPermission"))}"`
    : writeAttributes;
  return `<div class="orders-workspace" data-orders-create-page data-live-read-only="${liveReadOnly}">
    ${state.notice ? `<p class="orders-write-notice orders-write-notice--${escapeHtml(state.noticeType || "error")}" role="${state.noticeType === "success" ? "status" : "alert"}">${escapeHtml(state.notice)}</p>` : ""}
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
      ${renderCreatePaymentBox(helpers, subtotalAmount, sum)}
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-primary" data-order-submit data-orders-write${state.busy ? " disabled aria-disabled=\"true\"" : writeAttributes}>${escapeHtml(pageT(lang, state.busy ? "orders.write.saving" : "orders.markPaid"))}</button>
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
        <button type="button" class="${state.shippingMode === "delivery" ? "is-active" : ""}" data-shipping-mode="delivery" data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.delivery"))}</button>
        <button type="button" class="${state.shippingMode === "pickup" ? "is-active" : ""}" data-shipping-mode="pickup" data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.pickup"))}</button>
      </div>
      <div class="orders-field">
        <span class="orders-field__label">${escapeHtml(pageT(lang, "orders.trackingNo"))}</span>
        ${liveWritable && currentUser?.canShip === true && state.shippingMode === "delivery"
          ? `<input class="orders-select-like orders-tracking-input" type="text" data-tracking-input data-orders-write value="${escapeHtml(state.trackingNumber)}" placeholder="${escapeHtml(pageT(lang, "orders.unshipped"))}">`
          : `<span class="orders-select-like">${escapeHtml(state.shippingMode === "pickup" ? pageT(lang, "orders.pickup") : pageT(lang, "orders.unshipped"))}</span>`}
      </div>
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-secondary" data-tracking-cancel data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="orders-primary" data-tracking-confirm data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.confirmTracking"))}</button>
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
  state.customerDraft = {};
  rerender();
}

function setNotice(message, type = "error") {
  state.notice = message;
  state.noticeType = type;
}

function friendlyWriteError(error, fallbackKey) {
  const lang = currentHelpers?.lang ?? "zh";
  const message = String(error?.message || "");
  if (message.includes("Customer name is required")) return pageT(lang, "orders.validation.customerName");
  if (message.includes("IMEI")) return pageT(lang, "orders.validation.imei");
  if (message.includes("customer is required")) return pageT(lang, "orders.validation.customer");
  if (message.includes("at least one product") || message.includes("product selection")) return pageT(lang, "orders.validation.items");
  if (message.includes("total must be greater")) return pageT(lang, "orders.validation.total");
  if (message.includes("tracking number") || message.includes("Invalid tracking")) return pageT(lang, "orders.validation.tracking");
  if (message.includes("recovery was incomplete")) return pageT(lang, "orders.write.recoveryFailed");
  return pageT(lang, fallbackKey);
}

function readNewCustomerFields() {
  return Object.fromEntries([...document.querySelectorAll("[data-create-customer-overlay] [data-new-customer-field]")]
    .map((field) => [field.getAttribute("data-new-customer-field"), field.value]));
}

function syncLiveFormInputs() {
  if (!liveWritable) return;
  document.querySelectorAll("[data-line-quantity]").forEach((input) => {
    const item = state.lineItems.find((row) => row.id === input.getAttribute("data-line-quantity"));
    if (item) item.quantity = Math.max(1, Math.floor(Number(input.value) || 1));
  });
  document.querySelectorAll("[data-line-price]").forEach((input) => {
    const item = state.lineItems.find((row) => row.id === input.getAttribute("data-line-price"));
    if (item) item.price = Math.max(0, Number(input.value) || 0);
  });
  document.querySelectorAll("[data-fee-amount]").forEach((input) => {
    state.fees[input.getAttribute("data-fee-amount")] = Math.max(0, Number(input.value) || 0);
  });
  const shippingFee = document.querySelector("[data-shipping-fee]");
  if (shippingFee) state.fees.shipping = Math.max(0, Number(shippingFee.value) || 0);
  state.trackingNumber = document.querySelector("[data-tracking-input]")?.value ?? state.trackingNumber;
}

function syncLiveNumberInput(target) {
  const quantity = target.closest("[data-line-quantity]");
  if (quantity) {
    const item = state.lineItems.find((row) => row.id === quantity.getAttribute("data-line-quantity"));
    if (item) item.quantity = Math.max(1, Math.floor(Number(quantity.value) || 1));
    return true;
  }
  const price = target.closest("[data-line-price]");
  if (price) {
    const item = state.lineItems.find((row) => row.id === price.getAttribute("data-line-price"));
    if (item) item.price = Math.max(0, Number(price.value) || 0);
    return true;
  }
  const feeAmount = target.closest("[data-fee-amount]");
  if (feeAmount) {
    state.fees[feeAmount.getAttribute("data-fee-amount")] = Math.max(0, Number(feeAmount.value) || 0);
    return true;
  }
  const shippingFee = target.closest("[data-shipping-fee]");
  if (shippingFee) {
    state.fees.shipping = Math.max(0, Number(shippingFee.value) || 0);
    return true;
  }
  return false;
}

function refreshLiveTotals() {
  const subtotalText = formatMoney(subtotal()).replace("HKD$ ", "");
  const totalText = formatMoney(total()).replace("HKD$ ", "");
  document.querySelectorAll("[data-create-subtotal]").forEach((node) => { node.textContent = subtotalText; });
  document.querySelectorAll("[data-create-shipping]").forEach((node) => {
    node.textContent = Number(state.fees.shipping || 0).toFixed(2);
  });
  document.querySelectorAll("[data-create-total]").forEach((node) => { node.textContent = totalText; });
}

async function submitLiveCustomer() {
  const values = readNewCustomerFields();
  state.customerDraft = values;
  state.busy = true;
  setNotice("");
  rerender();
  try {
    const result = await createLiveOrderCustomer(values);
    data.customers.unshift({
      id: result.customer.id,
      name: result.customer.name || "",
      phone: result.customer.phone || "",
      detail: {
        email: result.customer.email || "",
        carModel: [result.customer.car_make, result.customer.car_model].filter(Boolean).join(" "),
        shippingAddress: result.customer.address || ""
      }
    });
    state.selectedCustomerId = result.customer.id;
    state.customerModalOpen = false;
    state.customerDraft = {};
    if (result.deviceError) console.error("[orders-create] customer device write failed", result.deviceError);
    const noticeKey = result.deviceError
      ? "orders.customer.deviceFailed"
      : result.deviceConflicts.length
        ? "orders.customer.imeiConflict"
        : "orders.customer.created";
    setNotice(pageT(currentHelpers?.lang ?? "zh", noticeKey), noticeKey === "orders.customer.created" ? "success" : "error");
  } catch (error) {
    console.error("[orders-create] customer write failed", error);
    setNotice(friendlyWriteError(error, "orders.customer.failed"));
  } finally {
    state.busy = false;
    rerender();
  }
}

async function submitLiveOrder() {
  syncLiveFormInputs();
  const lang = currentHelpers?.lang ?? "zh";
  if (!state.selectedCustomerId) {
    setNotice(pageT(lang, "orders.validation.customer"));
    rerender();
    return;
  }
  if (!state.lineItems.length) {
    setNotice(pageT(lang, "orders.validation.items"));
    rerender();
    return;
  }
  if (total() <= 0) {
    setNotice(pageT(lang, "orders.validation.total"));
    rerender();
    return;
  }
  state.busy = true;
  setNotice("");
  rerender();
  try {
    const result = await createAndPayLiveOrder({
      customerId: state.selectedCustomerId,
      salespersonId: state.salespersonId,
      items: state.lineItems.map((item) => ({ ...item })),
      fees: {
        deposit: state.feesEnabled.deposit ? state.fees.deposit : 0,
        discount: state.feesEnabled.discount ? state.fees.discount : 0,
        service: state.feesEnabled.service ? state.fees.service : 0,
        shipping: state.fees.shipping
      },
      shipping: currentUser?.canShip === true
        ? { mode: state.shippingMode, trackingNumber: state.trackingNumber }
        : null
    });
    if (result.deviceConflicts.length) console.warn("[orders-create] item IMEI conflicts", result.deviceConflicts);
    window.location.href = `./orders-detail.html?id=${encodeURIComponent(result.invoice.id)}`;
  } catch (error) {
    console.error("[orders-create] order write failed", error);
    state.busy = false;
    setNotice(friendlyWriteError(error, "orders.write.failed"));
    rerender();
  }
}

document.addEventListener("click", async (event) => {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (state.busy && event.target.closest("[data-orders-write]")) return;
  if (event.target.closest("[data-order-submit]")) {
    if (liveWritable && !state.busy) await submitLiveOrder();
    return;
  }
  if (event.target.closest("[data-customer-submit]")) {
    if (liveWritable && !state.busy) await submitLiveCustomer();
    else if (!liveMode) closeCustomerModal();
    return;
  }
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
        productId: option.id,
        warehouseId: writeOptions.defaultWarehouseId,
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
    if (liveMode && currentUser?.canShip !== true) return;
    state.shippingMode = mode.getAttribute("data-shipping-mode");
    rerender();
    return;
  }
  if (event.target.closest("[data-tracking-cancel]")) {
    state.trackingNumber = "";
    setNotice("");
    rerender();
    return;
  }
  if (event.target.closest("[data-tracking-confirm]")) {
    syncLiveFormInputs();
    if (liveWritable && state.shippingMode === "delivery" && state.trackingNumber && !/^[A-Za-z0-9]{6,}$/.test(state.trackingNumber)) {
      setNotice(pageT(currentHelpers?.lang ?? "zh", "orders.validation.tracking"));
    } else if (liveWritable) {
      setNotice(pageT(currentHelpers?.lang ?? "zh", "orders.tracking.ready"), "success");
    }
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
  if (state.busy && event.target.closest("[data-orders-write]")) return;
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
    return;
  }
  const salesperson = event.target.closest("[data-salesperson-select]");
  if (salesperson) {
    state.salespersonId = salesperson.value;
    return;
  }
  const quantity = event.target.closest("[data-line-quantity]");
  if (quantity) {
    syncLiveNumberInput(quantity);
    refreshLiveTotals();
    return;
  }
  const price = event.target.closest("[data-line-price]");
  if (price) {
    syncLiveNumberInput(price);
    refreshLiveTotals();
    return;
  }
  const feeAmount = event.target.closest("[data-fee-amount]");
  if (feeAmount) {
    syncLiveNumberInput(feeAmount);
    refreshLiveTotals();
    return;
  }
  const shippingFee = event.target.closest("[data-shipping-fee]");
  if (shippingFee) {
    syncLiveNumberInput(shippingFee);
    refreshLiveTotals();
  }
});

document.addEventListener("input", (event) => {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (state.busy && event.target.closest("[data-orders-write]")) return;
  if (syncLiveNumberInput(event.target)) {
    refreshLiveTotals();
    return;
  }
  const customerField = event.target.closest("[data-create-customer-overlay] [data-new-customer-field]");
  if (customerField) {
    state.customerDraft[customerField.getAttribute("data-new-customer-field")] = customerField.value;
    return;
  }
  const productSearch = event.target.closest("[data-product-search]");
  if (productSearch) {
    state.productSearch = productSearch.value;
    rerender({ focusProductSearch: true });
    return;
  }
  const trackingInput = event.target.closest("[data-tracking-input]");
  if (trackingInput) {
    state.trackingNumber = trackingInput.value;
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
