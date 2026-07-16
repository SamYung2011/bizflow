// bizflow 訂單詳情桌面屏(Figma 676:92291)。列表與深層明細均由 provider 的 R8a 快照契約提供。

import { getOrderCreateData, getOrderDetailData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { renderNewCustomerFields } from "../components/new-customer-fields.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import {
  getLiveOrderWriteOptions,
  updateLiveOrder,
  updateLiveOrderCustomer,
  updateLiveOrderShipping
} from "../data/live-orders-writes.js";
import { createPrintDialog } from "./print/print-dialog.js";
import { toPrintableOrder } from "./print/print-invoice.js";

const dict = {
  zh: {
    "orders.root": "訂單",
    "orders.shipping": "運送",
    "orders.pickup": "自取",
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
    "orders.shippingPermission": "需要發貨權限",
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
    "orders.emptyValue": "—",
    "orders.salesperson.none": "（無）",
    "orders.write.saving": "正在保存…",
    "orders.write.failed": "訂單保存失敗，請重試",
    "orders.write.saved": "訂單修改已保存",
    "orders.write.deviceFailed": "訂單修改已保存，但 IMEI 未能同步到顧客資料",
    "orders.write.deviceConflict": "訂單修改已保存，但 IMEI 已屬於其他顧客",
    "orders.validation.items": "請至少保留一件商品",
    "orders.validation.total": "訂單總額必須大於 0",
    "orders.validation.tracking": "請輸入至少 6 位英數物流單號",
    "orders.shipping.failed": "物流資料保存失敗，請重試",
    "orders.shipping.saved": "物流資料已保存",
    "orders.customerModal.title": "編輯顧客",
    "orders.customer.saved": "顧客資料已保存",
    "orders.customer.failed": "顧客資料保存失敗，請重試",
    "orders.customer.imeiConflict": "顧客資料已保存，但 IMEI 已屬於其他顧客",
    "orders.customer.deviceFailed": "顧客資料已保存，但 IMEI 未能保存",
    "orders.field.name": "姓名",
    "orders.field.phone": "聯絡電話",
    "orders.field.email": "Email",
    "orders.field.carModel": "車型",
    "orders.field.imei": "產品IMEI碼",
    "orders.field.address": "運送地址",
    "orders.action.submit": "提交",
    "orders.action.close": "關閉",
    "orders.leaveUnsaved": "訂單修改尚未保存，確定離開？"
  },
  en: {
    "orders.root": "Orders",
    "orders.shipping": "Shipping",
    "orders.pickup": "Pickup",
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
    "orders.shippingPermission": "Shipping permission required",
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
    "orders.emptyValue": "—",
    "orders.salesperson.none": "(None)",
    "orders.write.saving": "Saving…",
    "orders.write.failed": "Could not save the order. Try again.",
    "orders.write.saved": "Order changes saved",
    "orders.write.deviceFailed": "Order changes saved, but the IMEI could not be synced to the customer",
    "orders.write.deviceConflict": "Order changes saved, but the IMEI belongs to another customer",
    "orders.validation.items": "Keep at least one product",
    "orders.validation.total": "The order total must be greater than 0",
    "orders.validation.tracking": "Enter a tracking number with at least 6 letters or digits",
    "orders.shipping.failed": "Could not save shipping details. Try again.",
    "orders.shipping.saved": "Shipping details saved",
    "orders.customerModal.title": "Edit customer",
    "orders.customer.saved": "Customer details saved",
    "orders.customer.failed": "Could not save customer details. Try again.",
    "orders.customer.imeiConflict": "Customer details saved, but the IMEI belongs to another customer",
    "orders.customer.deviceFailed": "Customer details saved, but the IMEI could not be saved",
    "orders.field.name": "Name",
    "orders.field.phone": "Phone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Vehicle model",
    "orders.field.imei": "Product IMEI",
    "orders.field.address": "Shipping address",
    "orders.action.submit": "Submit",
    "orders.action.close": "Close",
    "orders.leaveUnsaved": "Order changes have not been saved. Leave this page?"
  },
  fr: {
    "orders.root": "Commandes",
    "orders.shipping": "Expédition",
    "orders.pickup": "Retrait",
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
    "orders.shippingPermission": "Autorisation d’expédition requise",
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
    "orders.emptyValue": "—",
    "orders.salesperson.none": "(Aucun)",
    "orders.write.saving": "Enregistrement…",
    "orders.write.failed": "Impossible d’enregistrer la commande. Réessayez.",
    "orders.write.saved": "Modifications enregistrées",
    "orders.write.deviceFailed": "Commande enregistrée, mais l’IMEI n’a pas pu être synchronisé avec le client",
    "orders.write.deviceConflict": "Commande enregistrée, mais l’IMEI appartient à un autre client",
    "orders.validation.items": "Conservez au moins un produit",
    "orders.validation.total": "Le total doit être supérieur à 0",
    "orders.validation.tracking": "Saisissez un numéro de suivi d’au moins 6 lettres ou chiffres",
    "orders.shipping.failed": "Impossible d’enregistrer l’expédition. Réessayez.",
    "orders.shipping.saved": "Données d’expédition enregistrées",
    "orders.customerModal.title": "Modifier le client",
    "orders.customer.saved": "Données client enregistrées",
    "orders.customer.failed": "Impossible d’enregistrer le client. Réessayez.",
    "orders.customer.imeiConflict": "Client enregistré, mais l’IMEI appartient à un autre client",
    "orders.customer.deviceFailed": "Client enregistré, mais l’IMEI n’a pas pu être enregistré",
    "orders.field.name": "Nom",
    "orders.field.phone": "Téléphone",
    "orders.field.email": "Email",
    "orders.field.carModel": "Modèle",
    "orders.field.imei": "IMEI produit",
    "orders.field.address": "Adresse livraison",
    "orders.action.submit": "Soumettre",
    "orders.action.close": "Fermer",
    "orders.leaveUnsaved": "Les modifications de la commande ne sont pas enregistrées. Quitter cette page ?"
  }
};

let detailData = null;
let currentUser = null;
let unread = null;
let liveMode = false;
let liveWritable = false;
let liveReadOnly = false;
let pickerData = { productGroups: [] };
let writeOptions = { invoice: null, defaultWarehouseId: null, salespeople: [] };
let writeAttributes = "";

function cloneItems(items) {
  return items.map((item) => ({ ...item }));
}

let state = initialDetailState();

let currentHelpers = null;
let printDialog = null;
let activeScope = null;
let activeMountId = 0;

function isCurrentOrderDetailMount(mountId, scope = activeScope) {
  return mountId === activeMountId && Boolean(scope?.isCurrent());
}

function initialDetailState() {
  const initialItems = cloneItems(detailData?.detail.items ?? []);
  const initialFees = {
    shipping: Number(detailData?.detail.fees.shipping || 0),
    deposit: Number(detailData?.detail.fees.deposit || 0),
    discount: Math.abs(Number(detailData?.detail.fees.discount || 0)),
    service: Number(detailData?.detail.fees.service || 0)
  };
  const feesEnabled = {
    deposit: true,
    discount: Number(detailData?.detail.fees.discount || 0) !== 0,
    service: Number(detailData?.detail.fees.service || 0) !== 0
  };
  const salespersonId = writeOptions.invoice?.salesperson_id ?? detailData?.detail.salespersonId ?? "";
  const shippingMode = detailData?.detail.carrier === "self_pickup" ? "pickup" : "delivery";
  const trackingNumber = detailData?.detail.trackingNo ?? "";
  return {
    productModalOpen: false,
    productSearch: "",
    selectedOptions: new Set(),
    items: cloneItems(initialItems),
    savedItems: cloneItems(initialItems),
    feesEnabled,
    savedFeesEnabled: { ...feesEnabled },
    fees: { ...initialFees },
    savedFees: { ...initialFees },
    feesTouched: false,
    salespersonId,
    savedSalespersonId: salespersonId,
    shippingMode,
    trackingNumber,
    savedShippingMode: shippingMode,
    savedTrackingNumber: trackingNumber,
    customerModalOpen: false,
    customerDraft: {},
    busy: "",
    notice: "",
    noticeType: ""
  };
}

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
    ${liveWritable
      ? `<input class="orders-qty-box orders-line-number" type="number" min="1" step="1" data-line-quantity="${escapeHtml(item.id)}" data-orders-write value="${escapeHtml(String(item.quantity))}">
        <input class="orders-line-price orders-line-number" type="number" min="0" step="0.01" data-line-price="${escapeHtml(item.id)}" data-orders-write value="${escapeHtml(String(item.price))}">`
      : `<span class="orders-qty-box">${escapeHtml(String(item.quantity))}</span>
        <span class="orders-line-price">${escapeHtml(formatMoney(item.price))}</span>`}
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
        <input type="checkbox" data-product-option data-orders-write data-option-id="${escapeHtml(option.id)}"${state.selectedOptions.has(option.id) ? " checked" : ""}${writeAttributes}>
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
        <input type="search" data-product-search data-orders-write value="${escapeHtml(state.productSearch)}" placeholder="${escapeHtml(pageT(lang, "orders.modal.search"))}"${writeAttributes}>
      </label>
      <div class="orders-product-list">${body || `<div class="orders-product-group">${escapeHtml(pageT(lang, "orders.empty"))}</div>`}</div>
      <footer class="orders-product-modal__footer">
        <button type="button" class="orders-secondary" data-product-modal-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="orders-primary" data-product-modal-add data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.modal.add"))}</button>
      </footer>
    </section>
  </div>`;
}

function renderCheckControl(key, value, helpers) {
  const { escapeHtml, lang } = helpers;
  const checked = state.feesEnabled[key];
  return `<div class="orders-payment-check-row">
    <label class="orders-figma-check">
      <input type="checkbox" data-fee-toggle="${key}" data-orders-write${checked ? " checked" : ""}${writeAttributes}>
      <span class="orders-figma-check__box" aria-hidden="true"></span>
      <span>${escapeHtml(pageT(lang, `orders.${key}`))}</span>
    </label>
    ${liveWritable && checked
      ? `<input type="number" min="0" step="0.01" class="orders-money-input" data-fee-amount="${key}" data-orders-write value="${escapeHtml(String(Math.abs(Number(value || 0)) || ""))}" placeholder="${escapeHtml(pageT(lang, "orders.valuePlaceholder"))}">`
      : `<span class="orders-money-input${checked ? "" : " orders-money-input--placeholder"}">${escapeHtml(checked ? String(value) : pageT(lang, "orders.valuePlaceholder"))}</span>`}
  </div>`;
}

function renderPaymentBox(helpers, subtotal, totalAmount) {
  const { escapeHtml, icon, lang } = helpers;
  const shippingFee = Number(state.fees.shipping || 0);
  const totalText = moneyValue(totalAmount);
  return `<div class="orders-payment-detail-box">
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.subtotal"))}</span>
      <span>${escapeHtml(pageT(lang, "orders.itemCount").replace("{count}", String(state.items.length)))}</span>
      <strong><span>HKD$</span><output data-detail-subtotal>${escapeHtml(moneyValue(subtotal))}</output></strong>
    </div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.shippingFee"))}</span>
      ${liveWritable
        ? `<input type="number" min="0" step="0.01" class="orders-free-select orders-shipping-fee-input" data-shipping-fee data-orders-write value="${escapeHtml(String(shippingFee || ""))}" placeholder="${escapeHtml(pageT(lang, "orders.free"))}">`
        : `<button type="button" class="orders-free-select" data-orders-write${writeAttributes}>${escapeHtml(shippingFee === 0 ? pageT(lang, "orders.free") : formatMoney(shippingFee))}${icon("icon-arrow-down", "icon")}</button>`}
      <strong><span>HKD$</span><output data-detail-shipping>${escapeHtml(moneyValue(shippingFee))}</output></strong>
    </div>
    <div class="orders-payment-divider"></div>
    ${renderCheckControl("deposit", state.fees.deposit, helpers)}
    ${renderCheckControl("discount", state.fees.discount, helpers)}
    ${renderCheckControl("service", state.fees.service, helpers)}
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line">
      <span>${escapeHtml(pageT(lang, "orders.total"))}</span>
      <span></span>
      <strong><span>HKD$</span><output data-detail-total>${escapeHtml(totalText)}</output></strong>
    </div>
    <div class="orders-payment-divider"></div>
    <div class="orders-payment-line orders-payment-line--paid">
      <span>${escapeHtml(pageT(lang, "orders.paidAmount"))}</span>
      <span></span>
      <strong><span>HKD$</span><output data-detail-total>${escapeHtml(totalText)}</output></strong>
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
    (sum, key) => sum + (state.feesEnabled[key]
      ? (key === "discount" ? -Math.abs(Number(state.fees[key] || 0)) : Number(state.fees[key] || 0))
      : 0),
    Number(state.fees.shipping || 0)
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
    ${liveWritable
      ? `<select class="orders-select-like orders-select-control" data-salesperson-select data-orders-write>
          <option value="">${escapeHtml(pageT(lang, "orders.salesperson.none"))}</option>
          ${writeOptions.salespeople.map((person) => `<option value="${escapeHtml(person.id)}"${person.id === state.salespersonId ? " selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
        </select>`
      : `<div class="orders-select-like" title="${escapeHtml(salesperson)}">
          <span>${escapeHtml(salesperson)}</span>
          ${icon("icon-arrow-down", "icon")}
        </div>`}
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
      <button type="button" class="orders-primary orders-hug-small" data-customer-edit-open data-orders-write${writeAttributes}>${escapeHtml(pageT(lang, "orders.edit"))}</button>
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
  const shippingDisabled = liveMode && currentUser?.canShip !== true;
  const shippingAttributes = shippingDisabled
    ? ` disabled aria-disabled="true" title="${escapeHtml(pageT(lang, "orders.shippingPermission"))}"`
    : "";
  const shippingDisabledClass = shippingDisabled ? " orders-disabled" : "";
  return `<section class="orders-detail-card">
    <h2 class="orders-card-title">${escapeHtml(pageT(lang, "orders.trackingNo"))}</h2>
    ${liveWritable
      ? `<div class="orders-logistics-segment" role="tablist">
          <button type="button" class="${state.shippingMode === "delivery" ? "is-active" : ""}${shippingDisabledClass}" data-shipping-mode="delivery" data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.shipping"))}</button>
          <button type="button" class="${state.shippingMode === "pickup" ? "is-active" : ""}${shippingDisabledClass}" data-shipping-mode="pickup" data-shipping-write data-orders-write${shippingAttributes}>${escapeHtml(pageT(lang, "orders.pickup"))}</button>
        </div>
        ${state.shippingMode === "delivery"
          ? `<input class="orders-select-like orders-tracking-input${shippingDisabledClass}" type="text" data-tracking-input data-shipping-write data-orders-write value="${escapeHtml(state.trackingNumber)}" placeholder="${escapeHtml(pageT(lang, "orders.unshipped"))}"${shippingAttributes}>`
          : `<span class="orders-select-like">${escapeHtml(pageT(lang, "orders.pickup"))}</span>`}`
      : `<span class="orders-select-like">${escapeHtml(value)}</span>`}
    <div class="orders-card-actions orders-card-actions--end">
      <button type="button" class="orders-secondary${shippingDisabledClass}" data-shipping-cancel data-shipping-write data-orders-write${shippingDisabled ? shippingAttributes : writeAttributes}>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
      <button type="button" class="orders-primary${shippingDisabledClass}" data-shipping-save data-shipping-write data-orders-write${shippingDisabled ? shippingAttributes : state.busy === "shipping" ? ' disabled aria-disabled="true"' : writeAttributes}>${escapeHtml(pageT(lang, state.busy === "shipping" ? "orders.write.saving" : "orders.confirmTracking"))}</button>
    </div>
  </section>`;
}

function renderCustomerEditModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const values = state.customerDraft;
  return `<div class="customers-modal-overlay${state.customerModalOpen ? " customers-modal-overlay--open" : ""}" data-order-customer-overlay ${state.customerModalOpen ? "" : "hidden"}>
    <section class="tp-component form-new-customer" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "orders.customerModal.title"))}">
      <button type="button" class="form-new-customer__close" data-customer-edit-close aria-label="${escapeHtml(pageT(lang, "orders.action.close"))}"></button>
      <h2 class="form-new-customer__title">${escapeHtml(pageT(lang, "orders.customerModal.title"))}</h2>
      <div class="form-new-customer__fields">
        ${renderNewCustomerFields({
          lang,
          escapeHtml,
          label: (key) => pageT(lang, `orders.field.${key}`),
          idPrefix: "orders-edit-customer",
          disabled: liveReadOnly,
          values
        })}
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customer-edit-close>${escapeHtml(pageT(lang, "orders.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customer-edit-save data-orders-write${state.busy === "customer" ? ' disabled aria-disabled="true"' : writeAttributes}>${escapeHtml(pageT(lang, state.busy === "customer" ? "orders.write.saving" : "orders.action.submit"))}</button>
      </div>
    </section>
  </div>`;
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
    return `<div class="orders-workspace" data-orders-detail-page data-live-read-only="${liveReadOnly}" data-order-not-found>
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
  const shippingPermissionDenied = liveMode && currentUser?.canShip !== true;
  const { subtotal, paymentTotal } = currentTotals();
  return `<div class="orders-workspace" data-orders-detail-page data-live-read-only="${liveReadOnly}">
    ${state.notice ? `<p class="orders-write-notice orders-write-notice--${escapeHtml(state.noticeType || "error")}" role="${state.noticeType === "success" ? "status" : "alert"}">${escapeHtml(state.notice)}</p>` : ""}
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
        <button type="button" class="orders-dark" data-product-modal-open data-orders-write${writeAttributes}>${icon("icon-add-line-add", "icon")}${escapeHtml(pageT(lang, "orders.addProduct"))}</button>
      </div>
      ${renderLineRows(helpers)}
      <div class="orders-figma-total-row"><span>${escapeHtml(pageT(lang, "orders.total"))}</span><strong><span>HKD$</span><output data-detail-subtotal>${escapeHtml(moneyValue(subtotal))}</output></strong></div>
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-primary${shippingPermissionDenied ? " orders-disabled" : ""}" data-mark-shipped data-shipping-write data-orders-write${shippingPermissionDenied ? ` disabled aria-disabled="true" title="${escapeHtml(pageT(lang, "orders.shippingPermission"))}"` : state.busy === "shipping" ? ' disabled aria-disabled="true"' : writeAttributes}>${escapeHtml(pageT(lang, state.busy === "shipping" ? "orders.write.saving" : "orders.markShipped"))}</button>
      </div>
    </section>

    <section class="orders-detail-card">
      <div class="orders-card-head">
        <span class="orders-chip ${paid ? "orders-chip--blue" : "orders-chip--yellow"}">${escapeHtml(pageT(lang, paid ? "orders.paid" : "orders.unpaid"))}</span>
      </div>
      ${renderPaymentBox(helpers, subtotal, paymentTotal)}
      <div class="orders-card-actions orders-card-actions--end">
        <button type="button" class="orders-secondary" data-order-changes-cancel data-orders-write${state.busy ? ' disabled aria-disabled="true"' : writeAttributes}>${escapeHtml(pageT(lang, "orders.cancelChange"))}</button>
        <button type="button" class="orders-primary" data-order-changes-save data-orders-write${state.busy ? ' disabled aria-disabled="true"' : writeAttributes}>${escapeHtml(pageT(lang, state.busy === "order" ? "orders.write.saving" : "orders.saveChange"))}</button>
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
    ${renderCustomerEditModal(helpers)}
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

function setNotice(message, type = "error") {
  state.notice = message;
  state.noticeType = type;
}

function friendlyWriteError(error, fallbackKey) {
  const lang = currentHelpers?.lang ?? "zh";
  const message = String(error?.message || "");
  if (message.includes("at least one product")) return pageT(lang, "orders.validation.items");
  if (message.includes("total must be greater")) return pageT(lang, "orders.validation.total");
  if (message.includes("Tracking number") || message.includes("tracking number") || message.includes("Invalid tracking")) {
    return pageT(lang, "orders.validation.tracking");
  }
  return pageT(lang, fallbackKey);
}

function syncLiveFormInputs() {
  if (!liveWritable) return;
  let changedInput = false;
  document.querySelectorAll("[data-line-quantity]").forEach((input) => {
    const item = state.items.find((row) => row.id === input.getAttribute("data-line-quantity"));
    const next = Math.max(1, Math.floor(Number(input.value) || 1));
    if (item && item.quantity !== next) {
      item.quantity = next;
      changedInput = true;
    }
  });
  document.querySelectorAll("[data-line-price]").forEach((input) => {
    const item = state.items.find((row) => row.id === input.getAttribute("data-line-price"));
    const next = Math.max(0, Number(input.value) || 0);
    if (item && item.price !== next) {
      item.price = next;
      changedInput = true;
    }
  });
  document.querySelectorAll("[data-fee-amount]").forEach((input) => {
    const key = input.getAttribute("data-fee-amount");
    const next = Math.max(0, Number(input.value) || 0);
    if (state.fees[key] !== next) {
      state.fees[key] = next;
      changedInput = true;
    }
  });
  const shippingFee = document.querySelector("[data-shipping-fee]");
  if (shippingFee) {
    const next = Math.max(0, Number(shippingFee.value) || 0);
    if (state.fees.shipping !== next) {
      state.fees.shipping = next;
      changedInput = true;
    }
  }
  state.trackingNumber = document.querySelector("[data-tracking-input]")?.value ?? state.trackingNumber;
  if (changedInput) state.feesTouched = true;
}

function syncLiveNumberInput(target) {
  const quantity = target.closest("[data-line-quantity]");
  if (quantity) {
    const item = state.items.find((row) => row.id === quantity.getAttribute("data-line-quantity"));
    if (item) item.quantity = Math.max(1, Math.floor(Number(quantity.value) || 1));
    state.feesTouched = true;
    return true;
  }
  const price = target.closest("[data-line-price]");
  if (price) {
    const item = state.items.find((row) => row.id === price.getAttribute("data-line-price"));
    if (item) item.price = Math.max(0, Number(price.value) || 0);
    state.feesTouched = true;
    return true;
  }
  const feeAmount = target.closest("[data-fee-amount]");
  if (feeAmount) {
    state.fees[feeAmount.getAttribute("data-fee-amount")] = Math.max(0, Number(feeAmount.value) || 0);
    state.feesTouched = true;
    return true;
  }
  const shippingFee = target.closest("[data-shipping-fee]");
  if (shippingFee) {
    state.fees.shipping = Math.max(0, Number(shippingFee.value) || 0);
    state.feesTouched = true;
    return true;
  }
  return false;
}

function refreshLiveTotals() {
  const { subtotal, paymentTotal } = currentTotals();
  document.querySelectorAll("[data-detail-subtotal]").forEach((node) => {
    node.textContent = moneyValue(subtotal);
  });
  document.querySelectorAll("[data-detail-shipping]").forEach((node) => {
    node.textContent = moneyValue(state.fees.shipping);
  });
  document.querySelectorAll("[data-detail-total]").forEach((node) => {
    node.textContent = moneyValue(paymentTotal);
  });
}

function resetOrderChanges() {
  state.items = cloneItems(state.savedItems);
  state.feesEnabled = { ...state.savedFeesEnabled };
  state.fees = { ...state.savedFees };
  state.salespersonId = state.savedSalespersonId;
  state.feesTouched = false;
  setNotice("");
  rerender();
}

async function saveOrderChanges() {
  const mountId = activeMountId;
  const scope = activeScope;
  syncLiveFormInputs();
  const lang = currentHelpers?.lang ?? "zh";
  if (!state.items.length) {
    setNotice(pageT(lang, "orders.validation.items"));
    rerender();
    return;
  }
  const totals = currentTotals();
  if (totals.paymentTotal <= 0) {
    setNotice(pageT(lang, "orders.validation.total"));
    rerender();
    return;
  }
  state.busy = "order";
  setNotice("");
  rerender();
  try {
    const result = await updateLiveOrder(detailData.order.id, {
      items: cloneItems(state.items),
      fees: {
        shipping: state.fees.shipping,
        deposit: state.feesEnabled.deposit ? state.fees.deposit : 0,
        discount: state.feesEnabled.discount ? state.fees.discount : 0,
        service: state.feesEnabled.service ? state.fees.service : 0
      },
      salespersonId: state.salespersonId,
      totalOverride: state.feesTouched ? undefined : detailData.detail.paymentTotal
    });
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    detailData.detail.paymentTotal = Number(result.invoice.total) || 0;
    detailData.detail.salespersonId = result.invoice.salesperson_id ?? null;
    detailData.detail.salesperson = writeOptions.salespeople.find((person) => person.id === state.salespersonId)?.name ?? "";
    state.savedItems = cloneItems(state.items);
    state.savedFees = { ...state.fees };
    state.savedFeesEnabled = { ...state.feesEnabled };
    state.savedSalespersonId = state.salespersonId;
    state.feesTouched = false;
    if (result.deviceError) console.error("[orders-detail] item device write failed", result.deviceError);
    if (result.deviceConflicts.length) console.warn("[orders-detail] item IMEI conflicts", result.deviceConflicts);
    const noticeKey = result.deviceError
      ? "orders.write.deviceFailed"
      : result.deviceConflicts.length
        ? "orders.write.deviceConflict"
        : "orders.write.saved";
    setNotice(pageT(lang, noticeKey), noticeKey === "orders.write.saved" ? "success" : "error");
  } catch (error) {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    console.error("[orders-detail] order write failed", error);
    setNotice(friendlyWriteError(error, "orders.write.failed"));
  } finally {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    state.busy = "";
    rerender();
  }
}

function openCustomerEdit() {
  state.customerDraft = {
    name: detailData.order.customer || "",
    phone: detailData.order.phone || "",
    email: detailData.detail.email || "",
    carModel: detailData.detail.carModelValue ?? detailData.detail.carModel ?? "",
    imei: "",
    address: detailData.detail.shippingAddress || ""
  };
  state.customerModalOpen = true;
  rerender();
}

function closeCustomerEdit() {
  state.customerModalOpen = false;
  state.customerDraft = {};
  rerender();
}

async function saveCustomerEdit() {
  const mountId = activeMountId;
  const scope = activeScope;
  const lang = currentHelpers?.lang ?? "zh";
  state.busy = "customer";
  setNotice("");
  rerender();
  try {
    const result = await updateLiveOrderCustomer(detailData.detail.customerId ?? detailData.order.customerId, state.customerDraft);
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    detailData.order.customer = result.customer.name || "";
    detailData.order.phone = result.customer.phone || "";
    detailData.detail.email = result.customer.email || "";
    detailData.detail.carModelValue = result.customer.car_model || "";
    detailData.detail.carModel = [detailData.detail.carMake, result.customer.car_model].filter(Boolean).join(" ") || null;
    detailData.detail.shippingAddress = result.customer.address || "";
    state.customerModalOpen = false;
    state.customerDraft = {};
    if (result.deviceError) console.error("[orders-detail] customer device write failed", result.deviceError);
    const noticeKey = result.deviceError
      ? "orders.customer.deviceFailed"
      : result.deviceConflicts.length
        ? "orders.customer.imeiConflict"
        : "orders.customer.saved";
    setNotice(pageT(lang, noticeKey), noticeKey === "orders.customer.saved" ? "success" : "error");
  } catch (error) {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    console.error("[orders-detail] customer write failed", error);
    setNotice(friendlyWriteError(error, "orders.customer.failed"));
  } finally {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    state.busy = "";
    rerender();
  }
}

async function saveShipping() {
  const mountId = activeMountId;
  const scope = activeScope;
  syncLiveFormInputs();
  const lang = currentHelpers?.lang ?? "zh";
  if (state.shippingMode === "delivery" && !/^[A-Za-z0-9]{6,}$/.test(state.trackingNumber.trim())) {
    setNotice(pageT(lang, "orders.validation.tracking"));
    rerender();
    document.querySelector("[data-tracking-input]")?.focus();
    return;
  }
  state.busy = "shipping";
  setNotice("");
  rerender();
  try {
    const invoice = await updateLiveOrderShipping(detailData.order.id, {
      mode: state.shippingMode,
      trackingNumber: state.trackingNumber
    });
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    detailData.detail.carrier = invoice.carrier || "";
    detailData.detail.trackingNo = invoice.tracking_number || "";
    detailData.detail.shippingStatus = invoice.shipping_status || "unshipped";
    state.trackingNumber = invoice.tracking_number || "";
    state.savedTrackingNumber = state.trackingNumber;
    state.savedShippingMode = state.shippingMode;
    setNotice(pageT(lang, "orders.shipping.saved"), "success");
  } catch (error) {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    console.error("[orders-detail] shipping write failed", error);
    setNotice(friendlyWriteError(error, "orders.shipping.failed"));
  } finally {
    if (!isCurrentOrderDetailMount(mountId, scope)) return;
    state.busy = "";
    rerender();
  }
}

async function onOrderDetailClick(event) {
  const printOpen = event.target.closest("[data-print-open]");
  if (printOpen) {
    printDialog.open(printableOrder(), printOpen.getAttribute("data-print-open"), printOpen);
    return;
  }
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (state.busy && event.target.closest("[data-orders-write]")) return;
  if (event.target.closest("[data-order-changes-cancel]")) {
    if (liveWritable) resetOrderChanges();
    return;
  }
  if (event.target.closest("[data-order-changes-save]")) {
    if (liveWritable && !state.busy) await saveOrderChanges();
    return;
  }
  if (event.target.closest("[data-customer-edit-open]")) {
    if (liveWritable) openCustomerEdit();
    return;
  }
  if (event.target.closest("[data-customer-edit-close]") || event.target.matches("[data-order-customer-overlay]")) {
    closeCustomerEdit();
    return;
  }
  if (event.target.closest("[data-customer-edit-save]")) {
    if (liveWritable && !state.busy) await saveCustomerEdit();
    return;
  }
  if (event.target.closest("[data-shipping-cancel]")) {
    state.shippingMode = state.savedShippingMode;
    state.trackingNumber = state.savedTrackingNumber;
    setNotice("");
    rerender();
    return;
  }
  if (event.target.closest("[data-shipping-save]") || event.target.closest("[data-mark-shipped]")) {
    if (liveWritable && currentUser?.canShip === true && !state.busy) await saveShipping();
    return;
  }
  const shippingMode = event.target.closest("[data-shipping-mode]");
  if (shippingMode) {
    if (liveWritable && currentUser?.canShip === true) {
      state.shippingMode = shippingMode.getAttribute("data-shipping-mode");
      rerender();
    }
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
        id: `${option.id}-${Date.now()}-${state.items.length}`,
        productId: option.id,
        warehouseId: writeOptions.defaultWarehouseId,
        name: option.label,
        quantity: 1,
        price: option.price
      });
      state.feesTouched = true;
    });
    closeProductModal();
    return;
  }
}

function onOrderDetailChange(event) {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (state.busy && event.target.closest("[data-orders-write]")) return;
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
}

function onOrderDetailInput(event) {
  if (liveReadOnly && event.target.closest("[data-orders-write]")) return;
  if (state.busy && event.target.closest("[data-orders-write]")) return;
  if (syncLiveNumberInput(event.target)) {
    refreshLiveTotals();
    return;
  }
  const customerField = event.target.closest("[data-order-customer-overlay] [data-new-customer-field]");
  if (customerField) {
    state.customerDraft[customerField.getAttribute("data-new-customer-field")] = customerField.value;
    return;
  }
  const trackingInput = event.target.closest("[data-tracking-input]");
  if (trackingInput) {
    state.trackingNumber = trackingInput.value;
    return;
  }
  const search = event.target.closest("[data-product-search]");
  if (search) {
    state.productSearch = search.value;
    rerender({ focusProductSearch: true });
  }
}

function onOrderDetailKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.productModalOpen) closeProductModal();
  else if (state.customerModalOpen) closeCustomerEdit();
}

function comparableItems(items) {
  return items.map(({ productId, name, quantity, price, warehouseId }) => ({ productId, name, quantity, price, warehouseId }));
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function customerDraftChanged() {
  if (!state.customerModalOpen) return false;
  const baseline = {
    name: detailData?.order.customer || "",
    phone: detailData?.order.phone || "",
    email: detailData?.detail.email || "",
    carModel: detailData?.detail.carModelValue ?? detailData?.detail.carModel ?? "",
    imei: "",
    address: detailData?.detail.shippingAddress || ""
  };
  return Object.keys(baseline).some((key) => String(state.customerDraft[key] ?? "") !== String(baseline[key]));
}

function hasOrderDetailUnsavedChanges() {
  return !sameRecord(comparableItems(state.items), comparableItems(state.savedItems))
    || !sameRecord(state.feesEnabled, state.savedFeesEnabled)
    || !sameRecord(state.fees, state.savedFees)
    || state.salespersonId !== state.savedSalespersonId
    || state.shippingMode !== state.savedShippingMode
    || state.trackingNumber !== state.savedTrackingNumber
    || customerDraftChanged();
}

export async function mountPage({ scope, signal, url = new URL(window.location.href) } = {}) {
  const mountId = ++activeMountId;
  activeScope = scope;
  const orderId = url.searchParams.get("id");
  const [nextDetailData, nextCurrentUser, nextUnread] = await Promise.all([
    getOrderDetailData(orderId),
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
  const [nextPickerData, nextWriteOptions] = await Promise.all([
    detailData ? getOrderCreateData() : Promise.resolve({ productGroups: [] }),
    liveWritable && detailData
      ? getLiveOrderWriteOptions(detailData.order.id)
      : Promise.resolve({ invoice: null, defaultWarehouseId: null, salespeople: [] })
  ]);
  throwIfPageAborted(signal, scope);
  pickerData = nextPickerData;
  writeOptions = nextWriteOptions;
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  state = initialDetailState();
  printDialog = createPrintDialog({ getLang: () => currentHelpers?.lang ?? "zh", scope });

  return {
    page: {
      menu: createBizflowMenu("orders"),
      data: { unread, user: currentUser },
      render: renderDetail,
      title: detailData?.detail?.orderNo ? `Honnmono · ${detailData.detail.orderNo}` : "Honnmono · Order"
    },
    activate() {
      scope.listen(document, "click", onOrderDetailClick);
      scope.listen(document, "change", onOrderDetailChange);
      scope.listen(document, "input", onOrderDetailInput);
      scope.listen(document, "keydown", onOrderDetailKeydown);
    },
    hasUnsavedChanges: hasOrderDetailUnsavedChanges,
    async canLeave() {
      if (!hasOrderDetailUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "orders.leaveUnsaved"));
    },
    captureState: () => null,
    dispose() {
      if (activeMountId === mountId) activeMountId += 1;
      printDialog?.dispose();
      printDialog = null;
      detailData = null;
      currentUser = null;
      unread = null;
      pickerData = { productGroups: [] };
      writeOptions = { invoice: null, defaultWarehouseId: null, salespeople: [] };
      currentHelpers = null;
      if (activeScope === scope) activeScope = null;
      state = initialDetailState();
    }
  };
}
