// bizflow 站商品庫存桌面屏(Figma 676:99455 / 676:99512)。
// 列表数据走 provider;R9 真图有 URL 才显示,空 URL 保留灰底占位。

import { getInventoryPageData, getUnread, getUnreadWatermarks, getCurrentUser } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { managementPageSize, renderManagementList, renderManagementPager } from "../components/management-list.js";
import { renderSegment as renderSharedSegment } from "../components/segment.js";
import { consumeNavigationPreset, navigationPresetKeys } from "../components/navigation-presets.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import {
  cleanupLiveInventoryImage,
  createLiveInventoryProduct,
  getShopifyCredentialHealth,
  SHOPIFY_PRODUCT_IMAGE_ACCEPT,
  shopifyWriteReady,
  uploadLiveInventoryImage
} from "../data/live-inventory-writes.js";
import {
  attachItemMapBehaviors, captureItemMapState, disposeItemMapState, ensureItemMapData,
  hasItemMapUnsavedChanges, renderItemMap, restoreItemMapState
} from "./inventory-item-map.js";
import {
  attachShopifyBehaviors, captureShopifyState, disposeShopifyState, ensureShopifyData,
  hasShopifyUnsavedChanges, renderShopify, restoreShopifyState
} from "./inventory-shopify.js";
import {
  attachSupplierBehaviors, captureSupplierState, disposeSupplierState, ensureSuppliersData,
  hasSupplierUnsavedChanges, renderSuppliers, restoreSupplierState
} from "./inventory-suppliers.js";
import {
  attachPendingDeductionBehaviors,
  disposePendingDeductionState,
  ensurePendingDeductionData,
  ensurePendingOrderLinks,
  pendingDeductionCount,
  renderPendingDeduction
} from "./inventory-pending.js";

const dict = {
  zh: {
    "inventory.title": "商品庫存",
    "inventory.add": "新增商品",
    "inventory.tab.products": "產品列表",
    "inventory.tab.itemMap": "Item 映射",
    "inventory.tab.shopify": "Shopify API",
    "inventory.tab.suppliers": "供應商",
    "inventory.tab.pending": "待扣庫存",
    "inventory.category": "商品類別",
    "inventory.search": "搜索",
    "inventory.stock": "庫存：",
    "inventory.status.enabled": "啟用",
    "inventory.status.draft": "草稿",
    "inventory.status.active": "啟用",
    "inventory.status.discontinued": "停售",
    "inventory.category.all": "全部",
    "inventory.category.adapter": "轉插",
    "inventory.category.portable": "便攜充電",
    "inventory.category.cable": "充電線",
    "inventory.category.charger": "充電樁",
    "inventory.category.other": "其它",
    "inventory.empty.products": "暫無符合條件的商品",
    "inventory.empty.tab": "暫無內容",
    "inventory.prevPage": "上一頁",
    "inventory.nextPage": "下一頁",
    "inventory.addModal.title": "新增商品",
    "inventory.addModal.image": "商品圖片",
    "inventory.addModal.name": "商品名稱",
    "inventory.addModal.category": "商品類別",
    "inventory.addModal.price": "價格",
    "inventory.addModal.specs": "規格",
    "inventory.addModal.warranty": "保修月數",
    "inventory.addModal.code": "商品 SKU",
    "inventory.addModal.productType": "Shopify 商品類型",
    "inventory.addModal.tags": "標籤（逗號分隔）",
    "inventory.addModal.collections": "集合（逗號分隔）",
    "inventory.image.choose": "選擇圖片",
    "inventory.image.replace": "更換圖片",
    "inventory.image.remove": "移除圖片",
    "inventory.image.uploading": "正在驗證並上傳…",
    "inventory.image.hint": "JPG、PNG、WebP 或 GIF；最大 20MB、4472×4472。",
    "inventory.image.error.type": "只支援 JPG、PNG、WebP 或 GIF 圖片。",
    "inventory.image.error.size": "圖片不可超過 20MB。",
    "inventory.image.error.dimensions": "圖片尺寸不可超過 4472×4472（20MP）。",
    "inventory.image.error.content": "圖片內容無法驗證，請改選另一張圖片。",
    "inventory.image.error.upload": "商品圖片上傳失敗，請重試。",
    "inventory.image.error.cleanup": "未能清理尚未保存的圖片，請重試。",
    "inventory.addModal.cancel": "取消",
    "inventory.addModal.confirm": "確認新增",
    "inventory.addModal.close": "關閉",
    "inventory.leaveUnsaved": "尚有未保存的庫存資料，確定離開？",
    "inventory.shopifyWriteNotReady": "Shopify 寫入憑證未就緒",
    "inventory.shopifyWriteHint": "目前只讀連接正常；補齊 write_products、write_inventory 後即可保存。",
    "inventory.adminOnly": "商品目錄與庫存只限管理員修改",
    "inventory.writeReady": "Shopify 寫入連接已就緒",
    "inventory.saving": "正在同步 Shopify 與 BizFlow…",
    "inventory.created": "商品已同步建立",
    "inventory.createFailed": "建立商品失敗"
  },
  en: {
    "inventory.title": "Product inventory",
    "inventory.add": "Add product",
    "inventory.tab.products": "Product list",
    "inventory.tab.itemMap": "Item mapping",
    "inventory.tab.shopify": "Shopify API",
    "inventory.tab.suppliers": "Suppliers",
    "inventory.tab.pending": "Pending stock",
    "inventory.category": "Product category",
    "inventory.search": "Search",
    "inventory.stock": "Stock:",
    "inventory.status.enabled": "Enabled",
    "inventory.status.draft": "Draft",
    "inventory.status.active": "Enabled",
    "inventory.status.discontinued": "Discontinued",
    "inventory.category.all": "All",
    "inventory.category.adapter": "Adapters",
    "inventory.category.portable": "Portable chargers",
    "inventory.category.cable": "Charging cables",
    "inventory.category.charger": "Wall chargers",
    "inventory.category.other": "Other",
    "inventory.empty.products": "No products match the filters",
    "inventory.empty.tab": "No content",
    "inventory.prevPage": "Previous page",
    "inventory.nextPage": "Next page",
    "inventory.addModal.title": "Add product",
    "inventory.addModal.image": "Product image",
    "inventory.addModal.name": "Product name",
    "inventory.addModal.category": "Product category",
    "inventory.addModal.price": "Price",
    "inventory.addModal.specs": "Specification",
    "inventory.addModal.warranty": "Warranty months",
    "inventory.addModal.code": "Product SKU",
    "inventory.addModal.productType": "Shopify product type",
    "inventory.addModal.tags": "Tags (comma separated)",
    "inventory.addModal.collections": "Collections (comma separated)",
    "inventory.image.choose": "Choose image",
    "inventory.image.replace": "Replace image",
    "inventory.image.remove": "Remove image",
    "inventory.image.uploading": "Validating and uploading…",
    "inventory.image.hint": "JPG, PNG, WebP, or GIF; max 20 MB and 4472×4472.",
    "inventory.image.error.type": "Use a JPG, PNG, WebP, or GIF image.",
    "inventory.image.error.size": "The image must not exceed 20 MB.",
    "inventory.image.error.dimensions": "The image must not exceed 4472×4472 (20 MP).",
    "inventory.image.error.content": "The image could not be verified. Choose another file.",
    "inventory.image.error.upload": "The product image could not be uploaded. Try again.",
    "inventory.image.error.cleanup": "The unsaved image could not be removed. Try again.",
    "inventory.addModal.cancel": "Cancel",
    "inventory.addModal.confirm": "Add product",
    "inventory.addModal.close": "Close",
    "inventory.leaveUnsaved": "There are unsaved inventory changes. Leave this page?",
    "inventory.shopifyWriteNotReady": "Shopify write credential is not ready",
    "inventory.shopifyWriteHint": "The read connection works. Add write_products and write_inventory to enable saving.",
    "inventory.adminOnly": "Only administrators can modify the catalogue and inventory",
    "inventory.writeReady": "Shopify write connection is ready",
    "inventory.saving": "Syncing Shopify and BizFlow…",
    "inventory.created": "Product created and synchronized",
    "inventory.createFailed": "Could not create product"
  },
  fr: {
    "inventory.title": "Stock produits",
    "inventory.add": "Ajouter un produit",
    "inventory.tab.products": "Liste produits",
    "inventory.tab.itemMap": "Mappage Item",
    "inventory.tab.shopify": "API Shopify",
    "inventory.tab.suppliers": "Fournisseurs",
    "inventory.tab.pending": "Stock à déduire",
    "inventory.category": "Catégorie produit",
    "inventory.search": "Rechercher",
    "inventory.stock": "Stock :",
    "inventory.status.enabled": "Activé",
    "inventory.status.draft": "Brouillon",
    "inventory.status.active": "Activé",
    "inventory.status.discontinued": "Arrêté",
    "inventory.category.all": "Tous",
    "inventory.category.adapter": "Adaptateurs",
    "inventory.category.portable": "Chargeurs portables",
    "inventory.category.cable": "Câbles de charge",
    "inventory.category.charger": "Bornes de charge",
    "inventory.category.other": "Autres",
    "inventory.empty.products": "Aucun produit ne correspond aux filtres",
    "inventory.empty.tab": "Aucun contenu",
    "inventory.prevPage": "Page précédente",
    "inventory.nextPage": "Page suivante",
    "inventory.addModal.title": "Ajouter un produit",
    "inventory.addModal.image": "Image du produit",
    "inventory.addModal.name": "Nom du produit",
    "inventory.addModal.category": "Catégorie",
    "inventory.addModal.price": "Prix",
    "inventory.addModal.specs": "Spécification",
    "inventory.addModal.warranty": "Garantie en mois",
    "inventory.addModal.code": "SKU produit",
    "inventory.addModal.productType": "Type de produit Shopify",
    "inventory.addModal.tags": "Étiquettes (séparées par des virgules)",
    "inventory.addModal.collections": "Collections (séparées par des virgules)",
    "inventory.image.choose": "Choisir une image",
    "inventory.image.replace": "Remplacer l'image",
    "inventory.image.remove": "Supprimer l'image",
    "inventory.image.uploading": "Validation et téléversement…",
    "inventory.image.hint": "JPG, PNG, WebP ou GIF ; 20 Mo et 4472×4472 maximum.",
    "inventory.image.error.type": "Utilisez une image JPG, PNG, WebP ou GIF.",
    "inventory.image.error.size": "L'image ne doit pas dépasser 20 Mo.",
    "inventory.image.error.dimensions": "L'image ne doit pas dépasser 4472×4472 (20 MP).",
    "inventory.image.error.content": "L'image n'a pas pu être vérifiée. Choisissez un autre fichier.",
    "inventory.image.error.upload": "Échec du téléversement de l'image. Réessayez.",
    "inventory.image.error.cleanup": "L'image non enregistrée n'a pas pu être supprimée. Réessayez.",
    "inventory.addModal.cancel": "Annuler",
    "inventory.addModal.confirm": "Ajouter",
    "inventory.addModal.close": "Fermer",
    "inventory.leaveUnsaved": "Des modifications de stock ne sont pas enregistrées. Quitter cette page ?",
    "inventory.shopifyWriteNotReady": "Les identifiants d'écriture Shopify ne sont pas prêts",
    "inventory.shopifyWriteHint": "La connexion en lecture fonctionne. Ajoutez write_products et write_inventory pour enregistrer.",
    "inventory.adminOnly": "Seuls les administrateurs peuvent modifier le catalogue et le stock",
    "inventory.writeReady": "La connexion d'écriture Shopify est prête",
    "inventory.saving": "Synchronisation de Shopify et BizFlow…",
    "inventory.created": "Produit créé et synchronisé",
    "inventory.createFailed": "Impossible de créer le produit"
  }
};

let data = null;
let unreadWatermarks = null;
let unread = null;
let currentUser = null;
let shopifyHealth = null;
let authenticated = false;
let liveReadOnly = false;
let writeAttributes = "";
const tabs = ["products", "itemMap", "shopify", "suppliers", "pending"];
const categoryLabelKeys = {
  "轉插": "inventory.category.adapter",
  "便攜充電": "inventory.category.portable",
  "充電線": "inventory.category.cable",
  "充電樁": "inventory.category.charger",
  "其它": "inventory.category.other"
};

let state = {
  tab: "products",
  category: "all",
  categoryOpen: false,
  addModalOpen: false,
  addDraft: {},
  addImage: null,
  addImageBusy: false,
  addImageError: "",
  search: "",
  page: 1,
  addDraftDirty: false,
  writeBusy: false,
  feedback: "",
  error: ""
};

let currentHelpers = null;
let activeScope = null;
let inventoryRenderQueued = false;
let inventoryRenderGeneration = 0;
let pendingFocusSearch = false;
let pendingFocusAddName = false;
let activeNavigation = null;

function isCurrentInventoryScope(scope = activeScope) {
  return Boolean(scope && scope === activeScope && scope.isCurrent());
}

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function imageErrorText(lang, error) {
  const code = String(error?.code || "");
  if (code === "SHOPIFY_IMAGE_TYPE_UNSUPPORTED") return pageT(lang, "inventory.image.error.type");
  if (code === "SHOPIFY_IMAGE_SIZE_INVALID") return pageT(lang, "inventory.image.error.size");
  if (code === "SHOPIFY_IMAGE_DIMENSIONS_INVALID") return pageT(lang, "inventory.image.error.dimensions");
  if (code.includes("CONTENT") || code.includes("DIGEST")) return pageT(lang, "inventory.image.error.content");
  return pageT(lang, "inventory.image.error.upload");
}

function formatHkd(value) {
  return `HKD$ ${Number(value).toLocaleString("en-US")}`;
}

function categoryOptions(lang) {
  return [{ key: "all", label: pageT(lang, "inventory.category.all") }]
    .concat(data.categories.map((key) => ({
      key,
      label: categoryLabelKeys[key] ? pageT(lang, categoryLabelKeys[key]) : key
    })));
}

function filteredProducts() {
  const term = state.search.trim().toLowerCase();
  return data.products.filter((product) => {
    if (state.category !== "all" && product.bucket !== state.category) return false;
    if (term && !product.name.toLowerCase().includes(term)) return false;
    return true;
  });
}

function totalPages() {
  return Math.max(1, Math.ceil(filteredProducts().length / managementPageSize()));
}

function currentProducts() {
  const pageSize = managementPageSize();
  const start = (state.page - 1) * pageSize;
  return filteredProducts().slice(start, start + pageSize);
}

function tabKey(tab) {
  if (tab === "itemMap") return "inventory.tab.itemMap";
  if (tab === "shopify") return "inventory.tab.shopify";
  if (tab === "suppliers") return "inventory.tab.suppliers";
  if (tab === "pending") return "inventory.tab.pending";
  return "inventory.tab.products";
}

function renderSegment(helpers) {
  const { escapeHtml, lang } = helpers;
  const pendingCount = pendingDeductionCount();
  return renderSharedSegment({
    items: tabs.map((tab) => ({
      key: tab,
      label: pageT(lang, tabKey(tab)),
      badge: tab === "pending" && pendingCount > 0 ? pendingCount : null
    })),
    active: state.tab,
    ariaLabel: pageT(lang, "inventory.title"),
    escapeHtml,
    dataAttribute: "data-inventory-tab",
    variant: "domain"
  });
}

function renderCategoryFilter(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const selected = categoryOptions(lang).find((option) => option.key === state.category);
  const triggerLabel = state.category === "all" ? pageT(lang, "inventory.category") : selected.label;
  const options = categoryOptions(lang).map((option) => {
    const isSelected = option.key === state.category;
    return `<button type="button" role="option" aria-selected="${isSelected}" class="dropdown-item${isSelected ? " dropdown-item--selected" : ""}" data-inventory-category-option data-category="${escapeHtml(option.key)}" title="${escapeHtml(option.label)}">
      <span class="tp-line">${escapeHtml(option.label)}</span>
    </button>`;
  }).join("");
  return `<span class="inventory-category menu-anchor" data-inventory-category-menu>
    <button type="button" class="inventory-category__trigger" data-inventory-category-trigger aria-haspopup="listbox" aria-expanded="${state.categoryOpen}" title="${escapeHtml(triggerLabel)}">
      <span>${escapeHtml(triggerLabel)}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="tp-component menu-popover inventory-category__menu${state.categoryOpen ? " menu-popover--open" : ""}" role="listbox" data-inventory-category-popover>${options}</div>
  </span>`;
}

function renderToolbar(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  return `<div class="inventory-toolbar">
    ${renderCategoryFilter(helpers)}
    <label class="inventory-search">
      ${icon("icon-nav-search", "icon")}
      <input type="search" data-inventory-search placeholder="${escapeHtml(pageT(lang, "inventory.search"))}" value="${escapeHtml(state.search)}" title="${escapeHtml(pageT(lang, "inventory.search"))}">
    </label>
  </div>`;
}

function renderProductCard(product, helpers) {
  const { escapeHtml, lang } = helpers;
  const inactive = product.status === "draft" || product.status === "discontinued";
  // Mirrors bizflow Products.jsx lowStockSkus and the Dashboard threshold used by order-metrics.js.
  const lowStock = product.status !== "discontinued" && Number(product.stock) < 50;
  const statusLabel = pageT(lang, `inventory.status.${product.status}`);
  const image = product.imageUrl
    ? `<img class="inventory-thumb" src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy">`
    : `<span class="inventory-thumb" aria-hidden="true"></span>`;
  const tag = product.localOnly ? "article" : "button";
  const attributes = product.localOnly ? ' data-local-product aria-disabled="true"' : ` type="button" data-inventory-product data-product-id="${escapeHtml(product.id)}"`;
  return `<${tag} class="management-list__row inventory-product-card${lowStock ? " inventory-product-card--low-stock" : ""}"${attributes} data-low-stock="${lowStock}" title="${escapeHtml(product.name)}">
    ${image}
    <span class="inventory-product-main">
      <span class="inventory-product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</span>
      <span class="inventory-product-price" title="${escapeHtml(formatHkd(product.price))}">${escapeHtml(formatHkd(product.price))}</span>
    </span>
    <span class="inventory-product-stock">
      <span class="inventory-stock-label">${escapeHtml(pageT(lang, "inventory.stock"))}</span>
      <span class="inventory-stock-count">${escapeHtml(String(product.stock))}</span>
    </span>
    <span class="inventory-status-chip${inactive ? " inventory-status-chip--draft" : ""}" data-inventory-write aria-disabled="${liveReadOnly}" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>
  </${tag}>`;
}

function addDraftValue(name) {
  return String(state.addDraft?.[name] ?? "");
}

function renderAddImageUpload(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const imageUrl = state.addImage?.publicUrl || "";
  const disabled = !authenticated || liveReadOnly || state.writeBusy || state.addImageBusy;
  const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";
  const preview = imageUrl
    ? `<img class="inventory-image-upload__preview" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(pageT(lang, "inventory.addModal.image"))}">`
    : `<span class="inventory-image-upload__empty" aria-hidden="true">${icon("icon-nav-inventory", "icon")}</span>`;
  const chooseLabel = imageUrl ? pageT(lang, "inventory.image.replace") : pageT(lang, "inventory.image.choose");
  return `<div class="inventory-image-upload" data-inventory-image-upload aria-label="${escapeHtml(pageT(lang, "inventory.addModal.image"))}">
    ${preview}
    <div class="inventory-image-upload__body">
      <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.addModal.image"))}</span>
      <span class="inventory-image-upload__hint">${escapeHtml(pageT(lang, "inventory.image.hint"))}</span>
      <div class="inventory-image-upload__actions">
        <label class="inventory-image-upload__choose${disabled ? " is-disabled" : ""}">
          <input type="file" accept="${escapeHtml(SHOPIFY_PRODUCT_IMAGE_ACCEPT)}" data-inventory-add-image-input data-inventory-write${disabledAttributes}>
          <span>${escapeHtml(state.addImageBusy ? pageT(lang, "inventory.image.uploading") : chooseLabel)}</span>
        </label>
        ${imageUrl ? `<button type="button" class="inventory-image-upload__remove" data-inventory-add-image-remove data-inventory-write${disabledAttributes}>${escapeHtml(pageT(lang, "inventory.image.remove"))}</button>` : ""}
      </div>
      <span class="inventory-image-upload__error" role="status" aria-live="polite">${escapeHtml(state.addImageError || "")}</span>
    </div>
  </div>`;
}

function renderAddProductModal(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const requiredLabel = (key) => `${escapeHtml(pageT(lang, key))}<span class="inventory-required-mark" aria-hidden="true">*</span>`;
  const categoryOptionsHtml = data.categories.map((key) => {
    const label = categoryLabelKeys[key] ? pageT(lang, categoryLabelKeys[key]) : key;
    return `<option value="${escapeHtml(key)}"${addDraftValue("category") === key ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<div class="inventory-add-overlay${state.addModalOpen ? " inventory-add-overlay--open" : ""}" data-inventory-add-overlay ${state.addModalOpen ? "" : 'aria-hidden="true"'}>
    <form class="inventory-subitem-modal inventory-add-modal" data-inventory-add-form role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "inventory.addModal.title"))}">
      <div class="inventory-subitem-modal__head">
        <h2 class="inventory-subitem-modal__title">${escapeHtml(pageT(lang, "inventory.addModal.title"))}</h2>
      </div>
      <button type="button" class="inventory-subitem-modal__close" data-inventory-add-close aria-label="${escapeHtml(pageT(lang, "inventory.addModal.close"))}"></button>
      <div class="inventory-subitem-modal__body inventory-add-modal__body">
        ${renderAddImageUpload(helpers)}
        <div class="inventory-modal-grid">
          <label class="inventory-modal-field inventory-modal-field--wide">
            <span class="inventory-modal-label">${requiredLabel("inventory.addModal.name")}</span>
            <input class="inventory-modal-input" name="name" data-inventory-add-name data-inventory-write required value="${escapeHtml(addDraftValue("name"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${requiredLabel("inventory.addModal.code")}</span>
            <input class="inventory-modal-input" name="internalCode" data-inventory-write required value="${escapeHtml(addDraftValue("internalCode"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${requiredLabel("inventory.addModal.category")}</span>
            <select class="inventory-modal-input" name="category" data-inventory-write required${writeAttributes}>${categoryOptionsHtml}</select>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.addModal.productType"))}</span>
            <input class="inventory-modal-input" name="productType" data-inventory-write value="${escapeHtml(addDraftValue("productType"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field inventory-modal-field--wide">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.addModal.tags"))}</span>
            <input class="inventory-modal-input" name="tags" data-inventory-write value="${escapeHtml(addDraftValue("tags"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field inventory-modal-field--wide">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.addModal.collections"))}</span>
            <input class="inventory-modal-input" name="collections" data-inventory-write value="${escapeHtml(addDraftValue("collections"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${requiredLabel("inventory.addModal.price")}</span>
            <input class="inventory-modal-input" name="price" type="number" min="0" step="0.01" data-inventory-write required value="${escapeHtml(addDraftValue("price"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.addModal.specs"))}</span>
            <input class="inventory-modal-input" name="specs" data-inventory-write value="${escapeHtml(addDraftValue("specs"))}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${requiredLabel("inventory.addModal.warranty")}</span>
            <input class="inventory-modal-input" name="warrantyMonths" type="number" min="0" step="1" data-inventory-write required value="${escapeHtml(addDraftValue("warrantyMonths"))}"${writeAttributes}>
          </label>
        </div>
      </div>
      <div class="inventory-subitem-modal__footer">
        <button type="button" class="inventory-modal-cancel" data-inventory-add-close>${escapeHtml(pageT(lang, "inventory.addModal.cancel"))}</button>
        <button type="submit" class="inventory-modal-confirm" data-inventory-write${writeAttributes}>${escapeHtml(state.writeBusy ? pageT(lang, "inventory.saving") : pageT(lang, "inventory.addModal.confirm"))}</button>
      </div>
    </form>
  </div>`;
}

function renderWriteStatus(helpers) {
  if (!authenticated) return "";
  const { escapeHtml, lang } = helpers;
  const admin = currentUser?.isBfAdmin === true;
  const ready = admin && shopifyWriteReady(shopifyHealth);
  const title = !admin ? pageT(lang, "inventory.adminOnly")
    : ready ? pageT(lang, "inventory.writeReady") : pageT(lang, "inventory.shopifyWriteNotReady");
  const hint = admin && !ready ? pageT(lang, "inventory.shopifyWriteHint") : "";
  const message = state.error || state.feedback;
  return `<section class="inventory-write-status${ready ? " is-ready" : " is-blocked"}" data-shopify-write-ready="${ready}">
    <strong>${escapeHtml(title)}</strong>${hint ? `<span>${escapeHtml(hint)}</span>` : ""}
    ${message ? `<span class="${state.error ? "inventory-domain-error" : "inventory-domain-hint"}">${escapeHtml(message)}</span>` : ""}
  </section>`;
}

function renderEmpty(helpers, key = "inventory.empty.products") {
  const { escapeHtml, icon, lang } = helpers;
  return `<div class="inventory-empty">
    ${icon("icon-nav-inventory", "icon")}
    <span>${escapeHtml(pageT(lang, key))}</span>
  </div>`;
}

function renderProductsPanel(helpers) {
  const products = currentProducts();
  const pageSize = managementPageSize();
  const filteredCount = filteredProducts().length;
  const shouldPaginate = filteredCount > pageSize;
  const pager = renderManagementPager({
    page: state.page,
    pages: totalPages(),
    visible: shouldPaginate,
    icon: helpers.icon,
    escapeHtml: helpers.escapeHtml,
    previousLabel: pageT(helpers.lang, "inventory.prevPage"),
    nextLabel: pageT(helpers.lang, "inventory.nextPage")
  });
  const content = products.length
    ? products.map((product) => renderProductCard(product, helpers)).join("")
    : renderEmpty(helpers);
  return renderManagementList({ content, pager, paged: shouldPaginate });
}

function renderPanel(helpers) {
  const domainHelpers = { ...helpers, liveReadOnly };
  // Batch 5 opens only the Shopify-owned catalogue path. The older alias,
  // supplier and pending panels keep their pre-existing production read-only
  // boundary instead of becoming writable merely because Shopify scopes exist.
  const legacyDomainHelpers = { ...helpers, liveReadOnly: authenticated };
  if (state.tab === "itemMap") return renderItemMap(legacyDomainHelpers, data.mappingProducts);
  if (state.tab === "shopify") return renderShopify(domainHelpers, data.mappingProducts);
  if (state.tab === "suppliers") return renderSuppliers(legacyDomainHelpers);
  if (state.tab === "pending") return renderPendingDeduction(legacyDomainHelpers);
  return renderProductsPanel(helpers);
}

export function renderInventory(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  const pages = totalPages();
  state.page = Math.min(Math.max(state.page, 1), pages);
  return `<div class="inventory-page" data-node-id="676:99455" data-inventory-page data-live-read-only="${liveReadOnly}" data-tab="${escapeHtml(state.tab)}" data-category-open="${state.categoryOpen}" data-current-page="${state.page}">
    <header class="inventory-head">
      <h1 class="inventory-title" title="${escapeHtml(pageT(lang, "inventory.title"))}">${escapeHtml(pageT(lang, "inventory.title"))}</h1>
      ${state.tab === "products" ? `<button type="button" class="inventory-primary-btn" data-inventory-add data-inventory-write title="${escapeHtml(pageT(lang, "inventory.add"))}"${writeAttributes}>
        ${icon("icon-add-line-add", "icon")}
        <span>${escapeHtml(pageT(lang, "inventory.add"))}</span>
      </button>` : ""}
    </header>
    ${renderSegment(helpers)}
    ${state.tab === "products" || state.tab === "shopify" ? renderWriteStatus(helpers) : ""}
    ${state.tab === "products" ? renderToolbar(helpers) : ""}
    ${renderPanel(helpers)}
    ${renderAddProductModal(helpers)}
  </div>`;
}

async function ensureTabData(tab, { scope = activeScope, signal = scope?.signal } = {}) {
  if (tab === "itemMap") await ensureItemMapData({ scope, signal });
  else if (tab === "shopify") await ensureShopifyData({ scope, signal });
  else if (tab === "suppliers") await ensureSuppliersData({ scope, signal });
  else if (tab === "pending") await Promise.all([
    ensurePendingDeductionData({ scope, signal }),
    ensurePendingOrderLinks({ scope, signal })
  ]);
}

function rerenderInventoryPage({ focusSearch = false, focusAddName = false } = {}) {
  pendingFocusSearch ||= focusSearch;
  pendingFocusAddName ||= focusAddName;
  if (inventoryRenderQueued) return;
  inventoryRenderQueued = true;
  const generation = ++inventoryRenderGeneration;
  const scope = activeScope;
  queueMicrotask(() => {
    if (generation !== inventoryRenderGeneration) return;
    inventoryRenderQueued = false;
    const shouldFocusSearch = pendingFocusSearch;
    const shouldFocusAddName = pendingFocusAddName;
    pendingFocusSearch = false;
    pendingFocusAddName = false;
    if (!currentHelpers || !isCurrentInventoryScope(scope)) return;
    const page = document.querySelector("[data-inventory-page]");
    const parent = page?.parentNode;
    if (!page || !parent || !page.isConnected) return;
    const template = document.createElement("template");
    template.innerHTML = renderInventory(currentHelpers).trim();
    const nextPage = template.content.firstElementChild;
    if (!nextPage || page.parentNode !== parent || document.querySelector("[data-inventory-page]") !== page) return;
    parent.replaceChild(nextPage, page);
    if (shouldFocusSearch) {
      const input = document.querySelector("[data-inventory-search]");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (shouldFocusAddName) document.querySelector("[data-inventory-add-name]")?.focus();
  });
}

function closeCategoryMenu() {
  state.categoryOpen = false;
  const page = document.querySelector("[data-inventory-page]");
  const trigger = document.querySelector("[data-inventory-category-trigger]");
  const popover = document.querySelector("[data-inventory-category-popover]");
  if (page) page.setAttribute("data-category-open", "false");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  if (popover) popover.classList.remove("menu-popover--open");
}

function resetAddProductDraft() {
  state.addModalOpen = false;
  state.addDraft = {};
  state.addImage = null;
  state.addImageBusy = false;
  state.addImageError = "";
  state.addDraftDirty = false;
}

async function cleanupAddProductImage() {
  const imageUrl = state.addImage?.publicUrl || "";
  if (!imageUrl) return true;
  if (state.addImage?.uploadedByThisDraft !== true) {
    state.addImage = null;
    return true;
  }
  try {
    await cleanupLiveInventoryImage(imageUrl);
    state.addImage = null;
    return true;
  } catch {
    state.addImageError = pageT(currentHelpers?.lang ?? "zh", "inventory.image.error.cleanup");
    return false;
  }
}

async function closeAddProductModal() {
  if (state.addImageBusy || state.writeBusy) return false;
  if (!await cleanupAddProductImage()) {
    rerenderInventoryPage();
    return false;
  }
  resetAddProductDraft();
  rerenderInventoryPage();
  return true;
}

async function onInventoryClick(event) {
  if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
  if (event.target.closest("[data-inventory-add]")) {
    state.addModalOpen = true;
    state.categoryOpen = false;
    state.addDraft = { category: data.categories[0] || "" };
    state.addImage = null;
    state.addImageBusy = false;
    state.addImageError = "";
    state.addDraftDirty = false;
    rerenderInventoryPage({ focusAddName: true });
    return;
  }

  if (event.target.closest("[data-inventory-add-close]") || event.target.matches("[data-inventory-add-overlay]")) {
    await closeAddProductModal();
    return;
  }

  if (event.target.closest("[data-inventory-add-image-remove]")) {
    if (state.addImageBusy || state.writeBusy) return;
    state.addImageBusy = true;
    state.addImageError = "";
    rerenderInventoryPage();
    const removed = await cleanupAddProductImage();
    state.addImageBusy = false;
    if (removed) state.addDraftDirty = true;
    rerenderInventoryPage();
    return;
  }

  const tab = event.target.closest("[data-inventory-tab]");
  if (tab) {
    const nextTab = tab.getAttribute("data-inventory-tab");
    if (tabs.includes(nextTab) && state.tab !== nextTab) {
      const scope = activeScope;
      if (hasInventoryUnsavedChanges()) {
        const leave = await confirmInPage(pageT(currentHelpers?.lang ?? "zh", "inventory.leaveUnsaved"));
        if (!leave) return;
        if (!isCurrentInventoryScope(scope)) return;
        if (!await discardTransientDrafts()) return;
      }
      state.tab = nextTab;
      state.page = 1;
      closeCategoryMenu();
      rerenderInventoryPage();
      await ensureTabData(nextTab, { scope });
      if (isCurrentInventoryScope(scope) && state.tab === nextTab) rerenderInventoryPage();
    }
    return;
  }

  const categoryTrigger = event.target.closest("[data-inventory-category-trigger]");
  if (categoryTrigger) {
    state.categoryOpen = !state.categoryOpen;
    rerenderInventoryPage();
    return;
  }

  const categoryOption = event.target.closest("[data-inventory-category-option]");
  if (categoryOption) {
    const value = categoryOption.getAttribute("data-category");
    if (value && state.category !== value) {
      state.category = value;
      state.page = 1;
    }
    state.categoryOpen = false;
    rerenderInventoryPage();
    return;
  }

  const pageButton = event.target.closest("[data-management-page]");
  if (pageButton && !pageButton.disabled) {
    state.page += pageButton.getAttribute("data-management-page") === "next" ? 1 : -1;
    closeCategoryMenu();
    rerenderInventoryPage();
    return;
  }

  const product = event.target.closest("[data-inventory-product]");
  if (product) {
    const id = product.getAttribute("data-product-id");
    if (id) navigateTo(`./inventory-detail.html?id=${encodeURIComponent(id)}`);
    return;
  }

  if (!event.target.closest("[data-inventory-category-menu]")) closeCategoryMenu();
}

async function onInventoryInput(event) {
  if (event.target.closest("[data-inventory-add-form]")) {
    state.addDraftDirty = true;
    if (event.target.name) state.addDraft[event.target.name] = event.target.value;
  }
  const imageInput = event.target.closest("[data-inventory-add-image-input]");
  if (imageInput?.files?.[0]) {
    if (!authenticated || liveReadOnly || state.addImageBusy || state.writeBusy) return;
    const previousImage = state.addImage;
    const previousImageUrl = previousImage?.publicUrl || "";
    state.addImageBusy = true;
    state.addImageError = "";
    rerenderInventoryPage();
    try {
      const image = await uploadLiveInventoryImage(imageInput.files[0]);
      state.addImage = image;
      if (previousImage?.uploadedByThisDraft === true && previousImageUrl && previousImageUrl !== image.publicUrl) {
        try {
          await cleanupLiveInventoryImage(previousImageUrl);
        } catch {
          state.addImageError = pageT(currentHelpers?.lang ?? "zh", "inventory.image.error.cleanup");
        }
      }
    } catch (error) {
      state.addImageError = imageErrorText(currentHelpers?.lang ?? "zh", error);
    } finally {
      state.addImageBusy = false;
      rerenderInventoryPage();
    }
    return;
  }
  const search = event.target.closest("[data-inventory-search]");
  if (!search) return;
  state.search = search.value;
  state.page = 1;
  state.categoryOpen = false;
  rerenderInventoryPage({ focusSearch: true });
}

async function onInventoryKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.addModalOpen) {
    await closeAddProductModal();
    return;
  }
  closeCategoryMenu();
}

async function onInventorySubmit(event) {
  const form = event.target.closest("[data-inventory-add-form]");
  if (!form) return;
  event.preventDefault();
  if (liveReadOnly || state.addImageBusy || state.writeBusy) return;
  const values = new FormData(form);
  const name = String(values.get("name") || "").trim();
  const category = String(values.get("category") || "");
  const price = Number(values.get("price"));
  const specs = String(values.get("specs") || "").trim();
  const warrantyMonths = Number(values.get("warrantyMonths"));
  const internalCode = String(values.get("internalCode") || "").trim();
  if (!name || (authenticated && !internalCode) || !data.categories.includes(category) || !Number.isFinite(price) || !Number.isFinite(warrantyMonths)) return;
  if (authenticated) {
    state.writeBusy = true;
    state.error = "";
    state.feedback = "";
    rerenderInventoryPage();
    try {
      await createLiveInventoryProduct({
        id: globalThis.crypto.randomUUID(),
        name,
        internalCode,
        category,
        productType: String(values.get("productType") || "").trim(),
        price,
        warrantyMonths,
        specs,
        tags: String(values.get("tags") || "").split(",").map((value) => value.trim()).filter(Boolean),
        collections: String(values.get("collections") || "").split(",").map((value) => value.trim()).filter(Boolean),
        imageUrl: String(state.addImage?.publicUrl || "").trim(),
        status: "draft",
        stocks: [],
        variants: []
      });
      data = await getInventoryPageData();
      resetAddProductDraft();
      state.feedback = pageT(currentHelpers?.lang ?? "zh", "inventory.created");
      state.page = 1;
    } catch (error) {
      state.error = `${pageT(currentHelpers?.lang ?? "zh", "inventory.createFailed")}: ${error.message}`;
    } finally {
      state.writeBusy = false;
      rerenderInventoryPage();
    }
    return;
  }
  const id = `local-product-${Date.now()}`;
  data.products.unshift({
    id,
    name,
    category,
    bucket: category,
    price,
    stock: 0,
    status: "draft",
    imageUrl: "",
    localOnly: true,
    detail: { productId: id, warrantyMonths, specs, collections: [], tags: [], images: [], warehouses: [], variants: [] }
  });
  state.addModalOpen = false;
  state.addDraft = {};
  state.addImage = null;
  state.addImageError = "";
  state.addDraftDirty = false;
  state.category = "all";
  state.search = "";
  state.page = 1;
  rerenderInventoryPage();
}

function navigateTo(relative) {
  const url = new URL(relative, window.location.href);
  if (typeof activeNavigation?.navigate === "function") void activeNavigation.navigate(url);
  else if (typeof activeNavigation?.hardNavigate === "function") activeNavigation.hardNavigate(url);
  else window.location.assign(url.href);
}

function hasInventoryUnsavedChanges() {
  return (state.addModalOpen && state.addDraftDirty)
    || hasItemMapUnsavedChanges()
    || hasShopifyUnsavedChanges()
    || hasSupplierUnsavedChanges();
}

async function discardTransientDrafts() {
  if (!await cleanupAddProductImage()) return false;
  resetAddProductDraft();
  restoreItemMapState(captureItemMapState());
  restoreShopifyState(captureShopifyState());
  restoreSupplierState(captureSupplierState());
  return true;
}

function restoredState(value = null, presetSearch = "") {
  const next = value && typeof value === "object" ? value : {};
  return {
    tab: tabs.includes(next.tab) ? next.tab : "products",
    category: typeof next.category === "string" ? next.category : "all",
    categoryOpen: false,
    addModalOpen: false,
    addDraft: {},
    addImage: null,
    addImageBusy: false,
    addImageError: "",
    search: typeof next.search === "string" ? next.search : presetSearch,
    page: Number.isInteger(next.page) && next.page > 0 ? next.page : 1,
    addDraftDirty: false,
    writeBusy: false,
    feedback: "",
    error: ""
  };
}

export async function mountPage({ scope, signal, historyState = null, navigation = null } = {}) {
  activeScope = scope;
  activeNavigation = navigation;
  const presetSearch = consumeNavigationPreset(navigationPresetKeys.inventorySearch) ?? "";
  const [nextData, nextUnreadWatermarks, nextCurrentUser, nextUnread] = await Promise.all([
    getInventoryPageData(), getUnreadWatermarks(), getCurrentUser(), getUnread()
  ]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  unreadWatermarks = nextUnreadWatermarks;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  authenticated = typeof currentUser?.hasPermission === "function";
  shopifyHealth = currentUser?.isBfAdmin === true
    ? await getShopifyCredentialHealth({ refresh: true })
    : null;
  throwIfPageAborted(signal, scope);
  liveReadOnly = authenticated && (currentUser?.isBfAdmin !== true || !shopifyWriteReady(shopifyHealth));
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  state = restoredState(historyState, presetSearch);
  restoreItemMapState(historyState?.itemMap);
  restoreSupplierState(historyState?.suppliers);
  await ensureTabData(state.tab, { scope, signal });
  throwIfPageAborted(signal, scope);
  restoreShopifyState(historyState?.shopify);

  return {
    page: {
      menu: createBizflowMenu("inventory"),
      data: { unread, user: currentUser },
      render: renderInventory,
      title: "Honnmono · Inventory"
    },
    activate() {
      markRead("inventory", unreadWatermarks.inventory);
      scope.listen(document, "click", onInventoryClick);
      scope.listen(document, "input", onInventoryInput);
      scope.listen(document, "change", onInventoryInput);
      scope.listen(document, "keydown", onInventoryKeydown);
      scope.listen(document, "submit", onInventorySubmit);
      attachItemMapBehaviors({ rerender: rerenderInventoryPage, scope });
      attachShopifyBehaviors({ rerender: rerenderInventoryPage, scope });
      attachSupplierBehaviors({ rerender: rerenderInventoryPage, scope });
      attachPendingDeductionBehaviors({ rerender: rerenderInventoryPage, scope });
      // Warm the expensive pending snapshot only after the visible product list has painted.
      scope.animationFrame(() => scope.timeout(() => {
        ensurePendingDeductionData({ scope })
          .then(() => { if (isCurrentInventoryScope(scope)) rerenderInventoryPage(); })
          .catch((error) => console.warn("[inventory] pending deduction preload failed", error));
      }, 0));
    },
    hasUnsavedChanges: hasInventoryUnsavedChanges,
    async canLeave() {
      if (!hasInventoryUnsavedChanges()) return true;
      const leave = await confirmInPage(pageT(currentHelpers?.lang ?? "zh", "inventory.leaveUnsaved"));
      if (!leave) return false;
      return discardTransientDrafts();
    },
    captureState() {
      return {
        tab: state.tab,
        category: state.category,
        search: state.search,
        page: state.page,
        itemMap: captureItemMapState(),
        shopify: captureShopifyState(),
        suppliers: captureSupplierState()
      };
    },
    dispose() {
      closeCategoryMenu();
      disposeItemMapState();
      disposeShopifyState();
      disposeSupplierState();
      disposePendingDeductionState();
      data = null;
      unreadWatermarks = null;
      unread = null;
      currentUser = null;
      shopifyHealth = null;
      authenticated = false;
      currentHelpers = null;
      inventoryRenderGeneration += 1;
      inventoryRenderQueued = false;
      pendingFocusSearch = false;
      pendingFocusAddName = false;
      if (activeScope === scope) activeScope = null;
      if (activeNavigation === navigation) activeNavigation = null;
    }
  };
}
