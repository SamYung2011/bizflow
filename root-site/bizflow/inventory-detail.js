// bizflow 商品庫存详情桌面屏(Figma 676:99575 / 676:99691)。
// 详情页读取 URL id,演示表单和子类弹窗走 provider 样稿轮;保存/确认修改回列表。

import { getInventoryDetailData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import {
  deleteLiveInventoryProduct,
  getShopifyCredentialHealth,
  shopifyWriteReady,
  updateLiveInventoryProduct
} from "../data/live-inventory-writes.js";

const dict = {
  zh: {
    "inventory.detail.product": "商品",
    "inventory.detail.save": "保存修改",
    "inventory.field.name": "商品名稱",
    "inventory.field.productId": "商品ID",
    "inventory.field.category": "原始類別",
    "inventory.field.stock": "庫存",
    "inventory.field.price": "價格 HKD$",
    "inventory.field.warranty": "保修月數",
    "inventory.field.productType": "Shopify 商品類型",
    "inventory.field.imageUrl": "商品圖片 URL",
    "inventory.field.specs": "規格",
    "inventory.field.tags": "標籤（逗號分隔）",
    "inventory.field.variantSku": "子類 SKU",
    "inventory.field.variantName": "子類名稱",
    "inventory.stockByWarehouse": "分倉庫存",
    "inventory.status.title": "商品狀態",
    "inventory.status.enabled": "啟用",
    "inventory.status.draft": "草稿",
    "inventory.status.active": "啟用",
    "inventory.status.discontinued": "停售",
    "inventory.subitems.title": "子類",
    "inventory.subitems.add": "新增子類",
    "inventory.subitem.sampleName": "子類名稱",
    "inventory.series.title": "商品系列",
    "inventory.series.all": "所有系列",
    "inventory.series.new": "新系列 {count}",
    "inventory.delete": "刪除商品",
    "inventory.confirmModify": "確認修改",
    "inventory.modal.title": "產品子類修改",
    "inventory.modal.price": "價格 HKD$",
    "inventory.modal.warranty": "保修（年）",
    "inventory.modal.warehouseQuantity": "倉庫&數量",
    "inventory.warehouse.hk": "香港",
    "inventory.warehouse.zh": "珠海",
    "inventory.warehouse.zhuhai": "珠海",
    "inventory.warehouse.bizflowOnly": "僅 BizFlow",
    "inventory.warehouse.bizflowOnlyHint": "此倉庫庫存只保留在 BizFlow，不會推送至 Shopify。",
    "inventory.empty.subitems": "暫無子類",
    "inventory.empty.series": "暫無商品系列",
    "inventory.empty.warehouses": "暫無倉存資料",
    "inventory.cancel": "取消",
    "inventory.confirm": "確認",
    "inventory.close": "關閉",
    "inventory.leaveUnsaved": "商品修改尚未保存，確定離開？",
    "inventory.shopifyWriteNotReady": "Shopify 寫入憑證未就緒",
    "inventory.shopifyWriteHint": "目前只讀連接正常；補齊 write_products、write_inventory 後即可保存。",
    "inventory.writeReady": "Shopify 寫入連接已就緒",
    "inventory.bindingRequired": "此老商品尚未綁定 Shopify 商品，請先到 Shopify API 頁確認綁定。",
    "inventory.adminOnly": "商品目錄與庫存只限管理員修改",
    "inventory.saving": "正在同步 Shopify 與 BizFlow…",
    "inventory.saved": "商品已同步保存",
    "inventory.saveFailed": "保存失敗",
    "inventory.conflict.title": "Shopify 變更衝突",
    "inventory.conflict.message": "Shopify 商品已在外部變更，現已取得最新版本。繼續會以目前 BizFlow 表單內容覆蓋外部改動。",
    "inventory.conflict.confirm": "使用目前內容保存",
    "inventory.conflict.cancelled": "已保留目前表單，尚未覆蓋 Shopify 的外部改動。",
    "inventory.deleteConfirm": "刪除會同時從 Shopify 與 BizFlow 真實刪除，是否繼續？",
    "inventory.deleteFinal": "最後確認：此操作不可還原。",
    "inventory.deleteFailed": "刪除失敗",
    "inventory.subitem.delete": "刪除子類"
  },
  en: {
    "inventory.detail.product": "Product",
    "inventory.detail.save": "Save changes",
    "inventory.field.name": "Product name",
    "inventory.field.productId": "Product ID",
    "inventory.field.category": "Source category",
    "inventory.field.stock": "Stock",
    "inventory.field.price": "Price HKD$",
    "inventory.field.warranty": "Warranty months",
    "inventory.field.productType": "Shopify product type",
    "inventory.field.imageUrl": "Product image URL",
    "inventory.field.specs": "Specification",
    "inventory.field.tags": "Tags (comma separated)",
    "inventory.field.variantSku": "Variant SKU",
    "inventory.field.variantName": "Variant name",
    "inventory.stockByWarehouse": "Stock by warehouse",
    "inventory.status.title": "Product status",
    "inventory.status.enabled": "Enabled",
    "inventory.status.draft": "Draft",
    "inventory.status.active": "Enabled",
    "inventory.status.discontinued": "Discontinued",
    "inventory.subitems.title": "Subitems",
    "inventory.subitems.add": "Add subitem",
    "inventory.subitem.sampleName": "Subitem name",
    "inventory.series.title": "Product series",
    "inventory.series.all": "All series",
    "inventory.series.new": "New series {count}",
    "inventory.delete": "Delete product",
    "inventory.confirmModify": "Confirm changes",
    "inventory.modal.title": "Edit product subitem",
    "inventory.modal.price": "Price HKD$",
    "inventory.modal.warranty": "Warranty (years)",
    "inventory.modal.warehouseQuantity": "Warehouse & quantity",
    "inventory.warehouse.hk": "Hong Kong",
    "inventory.warehouse.zh": "Zhuhai",
    "inventory.warehouse.zhuhai": "Zhuhai",
    "inventory.warehouse.bizflowOnly": "BizFlow only",
    "inventory.warehouse.bizflowOnlyHint": "This warehouse remains in BizFlow and is not sent to Shopify.",
    "inventory.empty.subitems": "No subitems",
    "inventory.empty.series": "No product series",
    "inventory.empty.warehouses": "No warehouse stock",
    "inventory.cancel": "Cancel",
    "inventory.confirm": "Confirm",
    "inventory.close": "Close",
    "inventory.leaveUnsaved": "Product changes have not been saved. Leave this page?",
    "inventory.shopifyWriteNotReady": "Shopify write credential is not ready",
    "inventory.shopifyWriteHint": "The read connection works. Add write_products and write_inventory to enable saving.",
    "inventory.writeReady": "Shopify write connection is ready",
    "inventory.bindingRequired": "This existing product is not bound. Confirm its Shopify product in the Shopify API tab first.",
    "inventory.adminOnly": "Only administrators can modify the catalogue and inventory",
    "inventory.saving": "Syncing Shopify and BizFlow…",
    "inventory.saved": "Product synchronized and saved",
    "inventory.saveFailed": "Save failed",
    "inventory.conflict.title": "Shopify change conflict",
    "inventory.conflict.message": "This Shopify product changed outside BizFlow. The latest version is now loaded. Continuing will overwrite those external changes with the current BizFlow form.",
    "inventory.conflict.confirm": "Save current form",
    "inventory.conflict.cancelled": "The current form was kept and the external Shopify changes were not overwritten.",
    "inventory.deleteConfirm": "This permanently deletes the product from Shopify and BizFlow. Continue?",
    "inventory.deleteFinal": "Final confirmation: this cannot be undone.",
    "inventory.deleteFailed": "Delete failed",
    "inventory.subitem.delete": "Delete variant"
  },
  fr: {
    "inventory.detail.product": "Produit",
    "inventory.detail.save": "Enregistrer",
    "inventory.field.name": "Nom du produit",
    "inventory.field.productId": "ID produit",
    "inventory.field.category": "Catégorie source",
    "inventory.field.stock": "Stock",
    "inventory.field.price": "Prix HKD$",
    "inventory.field.warranty": "Garantie en mois",
    "inventory.field.productType": "Type de produit Shopify",
    "inventory.field.imageUrl": "URL de l'image produit",
    "inventory.field.specs": "Spécification",
    "inventory.field.tags": "Étiquettes (séparées par des virgules)",
    "inventory.field.variantSku": "SKU de variante",
    "inventory.field.variantName": "Nom de variante",
    "inventory.stockByWarehouse": "Stock par entrepôt",
    "inventory.status.title": "Statut produit",
    "inventory.status.enabled": "Activé",
    "inventory.status.draft": "Brouillon",
    "inventory.status.active": "Activé",
    "inventory.status.discontinued": "Arrêté",
    "inventory.subitems.title": "Sous-catégories",
    "inventory.subitems.add": "Ajouter",
    "inventory.subitem.sampleName": "Nom de sous-catégorie",
    "inventory.series.title": "Série produit",
    "inventory.series.all": "Toutes les séries",
    "inventory.series.new": "Nouvelle série {count}",
    "inventory.delete": "Supprimer",
    "inventory.confirmModify": "Confirmer",
    "inventory.modal.title": "Modifier la sous-catégorie",
    "inventory.modal.price": "Prix HKD$",
    "inventory.modal.warranty": "Garantie (ans)",
    "inventory.modal.warehouseQuantity": "Entrepôt et quantité",
    "inventory.warehouse.hk": "Hong Kong",
    "inventory.warehouse.zh": "Zhuhai",
    "inventory.warehouse.zhuhai": "Zhuhai",
    "inventory.warehouse.bizflowOnly": "BizFlow uniquement",
    "inventory.warehouse.bizflowOnlyHint": "Cet entrepôt reste dans BizFlow et n'est pas envoyé à Shopify.",
    "inventory.empty.subitems": "Aucune sous-catégorie",
    "inventory.empty.series": "Aucune série produit",
    "inventory.empty.warehouses": "Aucun stock d'entrepôt",
    "inventory.cancel": "Annuler",
    "inventory.confirm": "Confirmer",
    "inventory.close": "Fermer",
    "inventory.leaveUnsaved": "Les modifications du produit ne sont pas enregistrées. Quitter cette page ?",
    "inventory.shopifyWriteNotReady": "Les identifiants d'écriture Shopify ne sont pas prêts",
    "inventory.shopifyWriteHint": "La lecture fonctionne. Ajoutez write_products et write_inventory pour enregistrer.",
    "inventory.writeReady": "La connexion d'écriture Shopify est prête",
    "inventory.bindingRequired": "Ce produit existant n'est pas associé. Confirmez d'abord le produit Shopify dans l'onglet API Shopify.",
    "inventory.adminOnly": "Seuls les administrateurs peuvent modifier le catalogue et le stock",
    "inventory.saving": "Synchronisation de Shopify et BizFlow…",
    "inventory.saved": "Produit synchronisé et enregistré",
    "inventory.saveFailed": "Échec de l'enregistrement",
    "inventory.conflict.title": "Conflit de modification Shopify",
    "inventory.conflict.message": "Ce produit Shopify a été modifié hors de BizFlow. La dernière version est maintenant chargée. Continuer remplacera ces modifications externes par le formulaire BizFlow actuel.",
    "inventory.conflict.confirm": "Enregistrer ce formulaire",
    "inventory.conflict.cancelled": "Le formulaire actuel est conservé et les modifications Shopify externes n'ont pas été remplacées.",
    "inventory.deleteConfirm": "Cette action supprime définitivement le produit de Shopify et BizFlow. Continuer ?",
    "inventory.deleteFinal": "Confirmation finale : cette action est irréversible.",
    "inventory.deleteFailed": "Échec de la suppression",
    "inventory.subitem.delete": "Supprimer la variante"
  }
};

let detail = null;
let currentUser = null;
let unread = null;
let shopifyHealth = null;
let authenticated = false;
let liveReadOnly = false;
let writeAttributes = "";
let statusOptions = [];
let warehouseOptions = [];

let state = {
  status: "",
  statusOpen: false,
  modalOpen: false,
  modalItem: null,
  warehouseOpen: null,
  basicDirty: false,
  seriesCount: 0,
  busy: false,
  error: "",
  feedback: ""
};

let currentHelpers = null;
let activeNavigation = null;
let detailCommitted = false;

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function formatHkd(value) {
  return `HKD$ ${Number(value).toLocaleString("en-US")}`;
}

function cloneModalItem(item) {
  if (!item) {
    return {
      id: "new",
      name: "",
      quantity: "",
      price: "",
      editPrice: "",
      internalCode: "",
      warrantyMonths: 0,
      status: "active",
      imageUrl: "",
      specs: "",
      warehouses: (detail.availableWarehouses || []).map((row) => ({ ...row, quantity: 0, updatedAt: "" }))
    };
  }
  return {
    ...item,
    warehouses: item.warehouses.map((row) => ({ ...row }))
  };
}

function renderField({ labelKey, value, field, wide = false, readonly = false, type = "text" }, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<label class="inventory-field${wide ? " inventory-field--wide" : ""}">
    <span class="inventory-field__label" title="${escapeHtml(pageT(lang, labelKey))}">${escapeHtml(pageT(lang, labelKey))}</span>
    <input class="inventory-input" data-detail-field="${escapeHtml(field || "")}" type="${escapeHtml(type)}"${readonly ? ' readonly aria-readonly="true"' : " data-inventory-write"} value="${escapeHtml(value ?? "")}"${readonly ? "" : writeAttributes}>
  </label>`;
}

function renderStatusSelect(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const label = pageT(lang, `inventory.status.${state.status}`);
  const options = statusOptions.map((status) => {
    const selected = state.status === status;
    const optionLabel = pageT(lang, `inventory.status.${status}`);
    return `<button type="button" role="option" aria-selected="${selected}" class="dropdown-item${selected ? " dropdown-item--selected" : ""}" data-detail-status-option data-inventory-write data-status="${escapeHtml(status)}" title="${escapeHtml(optionLabel)}"${writeAttributes}>
      <span class="tp-line">${escapeHtml(optionLabel)}</span>
    </button>`;
  }).join("");
  return `<span class="inventory-select-anchor" data-detail-status-menu>
    <button type="button" class="inventory-select-trigger" data-detail-status-trigger data-inventory-write aria-haspopup="listbox" aria-expanded="${state.statusOpen}" title="${escapeHtml(label)}"${writeAttributes}>
      <span>${escapeHtml(label)}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="tp-component menu-popover inventory-select-menu${state.statusOpen ? " menu-popover--open" : ""}" role="listbox" data-detail-status-popover>${options}</div>
  </span>`;
}

function renderBasicCard(helpers) {
  const { escapeHtml } = helpers;
  const image = detail.product.imageUrl
    ? `<img class="inventory-detail-image" src="${escapeHtml(detail.product.imageUrl)}" alt="" loading="lazy">`
    : `<span class="inventory-detail-image" aria-hidden="true"></span>`;
  return `<section class="inventory-detail-card">
    <div class="inventory-basic">
      ${image}
      <div class="inventory-basic-fields">
        ${renderField({ labelKey: "inventory.field.name", value: detail.product.name, field: "name", wide: true }, helpers)}
        ${renderField({ labelKey: "inventory.field.productId", value: detail.product.productId, field: "productId" }, helpers)}
        ${renderField({ labelKey: "inventory.field.stock", value: detail.product.stock, readonly: true }, helpers)}
        ${renderField({ labelKey: "inventory.field.category", value: detail.product.category, field: "category", wide: true }, helpers)}
        ${renderField({ labelKey: "inventory.field.price", value: detail.product.price, field: "price", type: "number" }, helpers)}
        ${renderField({ labelKey: "inventory.field.warranty", value: detail.product.warrantyMonths, field: "warrantyMonths", type: "number" }, helpers)}
        ${renderField({ labelKey: "inventory.field.productType", value: detail.product.productType, field: "productType" }, helpers)}
        ${renderField({ labelKey: "inventory.field.imageUrl", value: detail.product.imageUrl, field: "imageUrl", wide: true, type: "url" }, helpers)}
        ${renderField({ labelKey: "inventory.field.specs", value: detail.product.specs, field: "specs", wide: true }, helpers)}
        ${renderField({ labelKey: "inventory.field.tags", value: (detail.product.tags || []).join(", "), field: "tags", wide: true }, helpers)}
      </div>
    </div>
  </section>`;
}

function renderStatusCard(helpers) {
  const { escapeHtml, lang } = helpers;
  return `<section class="inventory-detail-card">
    <span class="inventory-card-title" title="${escapeHtml(pageT(lang, "inventory.status.title"))}">${escapeHtml(pageT(lang, "inventory.status.title"))}</span>
    ${renderStatusSelect(helpers)}
  </section>`;
}

function renderWarehouseScopeBadge(warehouse, helpers) {
  if (warehouse?.shopifyMapped !== false) return "";
  const { escapeHtml, lang } = helpers;
  const label = pageT(lang, "inventory.warehouse.bizflowOnly");
  const hint = pageT(lang, "inventory.warehouse.bizflowOnlyHint");
  return `<span class="inventory-warehouse-scope-badge" title="${escapeHtml(hint)}">${escapeHtml(label)}</span>`;
}

function renderParentStocksCard(helpers) {
  if (detail.subitems.length) return "";
  const { escapeHtml, lang } = helpers;
  const rows = (detail.warehouses || []).map((warehouse) => `<label class="inventory-warehouse-row">
    <span class="inventory-warehouse-label">
      <span>${escapeHtml(warehouse.name || pageT(lang, `inventory.warehouse.${warehouse.key}`))}</span>
      ${renderWarehouseScopeBadge(warehouse, helpers)}
    </span>
    <input class="inventory-quantity-input" type="number" min="0" step="1" data-parent-warehouse-qty="${escapeHtml(warehouse.id)}" data-inventory-write value="${escapeHtml(warehouse.quantity)}"${writeAttributes}>
  </label>`).join("");
  return `<section class="inventory-detail-card">
    <span class="inventory-card-title">${escapeHtml(pageT(lang, "inventory.stockByWarehouse"))}</span>
    <div class="inventory-warehouse-block">${rows}</div>
  </section>`;
}

function renderSubitemRow(item, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const name = item.name ?? pageT(lang, item.nameKey);
  return `<div class="inventory-subitem-row" role="button" tabindex="${liveReadOnly ? "-1" : "0"}" data-subitem-row data-inventory-write data-subitem-id="${escapeHtml(item.id)}" aria-disabled="${liveReadOnly}" title="${escapeHtml(name)}">
    <span class="inventory-subitem-image" aria-hidden="true"></span>
    <span class="inventory-subitem-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    <span class="inventory-quantity-input" aria-label="${escapeHtml(pageT(lang, "inventory.field.stock"))}">${escapeHtml(item.quantity)}</span>
    <span class="inventory-subitem-price" title="${escapeHtml(formatHkd(item.price))}">${escapeHtml(formatHkd(item.price))}</span>
    <span class="inventory-subitem-icon">${icon("icon-add-surface-add", "icon")}</span>
  </div>`;
}

function renderSubitemsCard(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const rows = detail.subitems.length
    ? detail.subitems.map((item) => renderSubitemRow(item, helpers)).join("")
    : `<p class="inventory-detail-empty">${escapeHtml(pageT(lang, "inventory.empty.subitems"))}</p>`;
  return `<section class="inventory-detail-card">
    <div class="inventory-card-head">
      <span class="inventory-card-title" title="${escapeHtml(pageT(lang, "inventory.subitems.title"))}">${escapeHtml(pageT(lang, "inventory.subitems.title"))}</span>
      <button type="button" class="inventory-subitem-add" data-subitem-new data-inventory-write title="${escapeHtml(pageT(lang, "inventory.subitems.add"))}"${writeAttributes}>
        ${icon("icon-add-line-add", "icon")}
        <span>${escapeHtml(pageT(lang, "inventory.subitems.add"))}</span>
      </button>
    </div>
    <div class="inventory-subitem-list">${rows}</div>
  </section>`;
}

function renderSeriesCard(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const rows = detail.series.length
    ? detail.series.map((item) => {
        const label = item.name ?? pageT(lang, item.nameKey).replace("{count}", String(item.localIndex ?? ""));
        return `<div class="inventory-series-row">
          <input class="inventory-series-name" data-series-name="${escapeHtml(item.id)}" data-inventory-write value="${escapeHtml(label)}" title="${escapeHtml(label)}"${writeAttributes}>
          <button type="button" class="inventory-series-icon" data-series-remove="${escapeHtml(item.id)}" data-inventory-write aria-label="×"${writeAttributes}>×</button>
        </div>`;
      }).join("")
    : `<p class="inventory-detail-empty">${escapeHtml(pageT(lang, "inventory.empty.series"))}</p>`;
  return `<section class="inventory-detail-card">
    <span class="inventory-card-title" title="${escapeHtml(pageT(lang, "inventory.series.title"))}">${escapeHtml(pageT(lang, "inventory.series.title"))}</span>
    <div class="inventory-series-list">
      ${rows}
      <button type="button" class="inventory-series-add" data-series-add data-inventory-write aria-label="${escapeHtml(pageT(lang, "inventory.series.title"))}"${writeAttributes}>
        ${icon("icon-add-surface-add", "icon")}
      </button>
    </div>
  </section>`;
}

function renderWarehouseSelect(row, index, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const label = row.name || pageT(lang, `inventory.warehouse.${row.key}`);
  const open = state.warehouseOpen === index;
  const options = warehouseOptions.map((warehouse) => {
    const selected = row.id === warehouse.id;
    const optionLabel = warehouse.name || pageT(lang, `inventory.warehouse.${warehouse.key}`);
    return `<button type="button" role="option" aria-selected="${selected}" class="dropdown-item${selected ? " dropdown-item--selected" : ""}" data-modal-warehouse-option data-inventory-write data-warehouse-index="${index}" data-warehouse-id="${escapeHtml(warehouse.id)}" title="${escapeHtml(optionLabel)}"${writeAttributes}>
      <span class="tp-line">${escapeHtml(optionLabel)}</span>
    </button>`;
  }).join("");
  return `<span class="inventory-select-anchor" data-modal-warehouse-menu>
    <button type="button" class="inventory-select-trigger" data-modal-warehouse-trigger data-inventory-write data-warehouse-index="${index}" aria-haspopup="listbox" aria-expanded="${open}" title="${escapeHtml(label)}"${writeAttributes}>
      <span>${escapeHtml(label)}</span>
      ${renderWarehouseScopeBadge(row, helpers)}
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="tp-component menu-popover inventory-select-menu${open ? " menu-popover--open" : ""}" role="listbox" data-modal-warehouse-popover>${options}</div>
  </span>`;
}

function renderSubitemModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const item = state.modalItem ?? cloneModalItem(null);
  return `<div class="customers-modal-overlay inventory-subitem-overlay${state.modalOpen ? " customers-modal-overlay--open" : ""}" data-inventory-subitem-overlay ${state.modalOpen ? "" : 'aria-hidden="true"'}>
    <section class="inventory-subitem-modal" data-node-id="676:99691" role="dialog" aria-modal="true" aria-label="${escapeHtml(pageT(lang, "inventory.modal.title"))}">
      <div class="inventory-subitem-modal__head">
        <h2 class="inventory-subitem-modal__title" title="${escapeHtml(pageT(lang, "inventory.modal.title"))}">${escapeHtml(pageT(lang, "inventory.modal.title"))}</h2>
      </div>
      <button type="button" class="inventory-subitem-modal__close" data-modal-close aria-label="${escapeHtml(pageT(lang, "inventory.close"))}"></button>
      <div class="inventory-subitem-modal__body">
        <div class="inventory-modal-grid">
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.field.variantName"))}</span>
            <input class="inventory-modal-input" data-modal-name data-inventory-write value="${escapeHtml(item.name)}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label">${escapeHtml(pageT(lang, "inventory.field.variantSku"))}</span>
            <input class="inventory-modal-input" data-modal-code data-inventory-write value="${escapeHtml(item.internalCode || "")}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label" title="${escapeHtml(pageT(lang, "inventory.modal.price"))}">${escapeHtml(pageT(lang, "inventory.modal.price"))}</span>
            <input class="inventory-modal-input" data-modal-price data-inventory-write value="${escapeHtml(item.editPrice)}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label" title="${escapeHtml(pageT(lang, "inventory.modal.warranty"))}">${escapeHtml(pageT(lang, "inventory.modal.warranty"))}</span>
            <input class="inventory-modal-input" type="number" min="0" step="1" data-modal-warranty data-inventory-write value="${escapeHtml(item.warrantyMonths ?? 0)}"${writeAttributes}>
          </label>
        </div>
        <div class="inventory-warehouse-block">
          <span class="inventory-warehouse-title" title="${escapeHtml(pageT(lang, "inventory.modal.warehouseQuantity"))}">${escapeHtml(pageT(lang, "inventory.modal.warehouseQuantity"))}</span>
          ${item.warehouses.length ? item.warehouses.map((row, index) => `<div class="inventory-warehouse-row">
            ${renderWarehouseSelect(row, index, helpers)}
            <input class="inventory-quantity-input" data-modal-warehouse-qty="${index}" data-inventory-write value="${escapeHtml(row.quantity)}"${writeAttributes}>
          </div>`).join("") : `<p class="inventory-detail-empty">${escapeHtml(pageT(lang, "inventory.empty.warehouses"))}</p>`}
        </div>
      </div>
      <div class="inventory-subitem-modal__footer">
        ${item.id !== "new" ? `<button type="button" class="inventory-detail-danger" data-modal-delete data-inventory-write${writeAttributes}>${escapeHtml(pageT(lang, "inventory.subitem.delete"))}</button>` : ""}
        <button type="button" class="inventory-modal-cancel" data-modal-close>${escapeHtml(pageT(lang, "inventory.cancel"))}</button>
        <button type="button" class="inventory-modal-confirm" data-modal-confirm data-inventory-write${writeAttributes}>${escapeHtml(pageT(lang, "inventory.confirm"))}</button>
      </div>
    </section>
  </div>`;
}

function renderWriteStatus(helpers) {
  if (!authenticated) return "";
  const { escapeHtml, lang } = helpers;
  const isAdmin = currentUser?.isBfAdmin === true;
  const writeReady = isAdmin && shopifyWriteReady(shopifyHealth);
  const bound = detail.product.shopifyBinding?.status === "active";
  const title = !isAdmin ? pageT(lang, "inventory.adminOnly")
    : !writeReady ? pageT(lang, "inventory.shopifyWriteNotReady")
      : !bound ? pageT(lang, "inventory.bindingRequired") : pageT(lang, "inventory.writeReady");
  const hint = isAdmin && !writeReady ? pageT(lang, "inventory.shopifyWriteHint") : "";
  return `<section class="inventory-write-status${liveReadOnly ? " is-blocked" : " is-ready"}" data-shopify-binding-ready="${bound}">
    <strong>${escapeHtml(title)}</strong>${hint ? `<span>${escapeHtml(hint)}</span>` : ""}
    ${state.error ? `<span class="inventory-domain-error">${escapeHtml(state.error)}</span>` : ""}
    ${state.feedback ? `<span class="inventory-domain-hint">${escapeHtml(state.feedback)}</span>` : ""}
  </section>`;
}

export function renderInventoryDetail(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  return `<div class="inventory-detail-page" data-node-id="676:99575" data-inventory-detail-page data-live-read-only="${liveReadOnly}" data-detail-id="${escapeHtml(detail.requestedId)}" data-modal-open="${state.modalOpen}" data-status-open="${state.statusOpen}">
    <header class="inventory-detail-head">
      <nav class="inventory-breadcrumb" aria-label="${escapeHtml(pageT(lang, "inventory.detail.product"))}">
        <button type="button" class="inventory-breadcrumb__link" data-detail-back data-spa-back="./inventory.html" title="${escapeHtml(pageT(lang, "inventory.detail.product"))}">${escapeHtml(pageT(lang, "inventory.detail.product"))}</button>
        ${icon("icon-arrow-right", "icon")}
        <span class="inventory-breadcrumb__current" title="${escapeHtml(detail.product.breadcrumbName)}">${escapeHtml(detail.product.breadcrumbName)}</span>
      </nav>
      <button type="button" class="inventory-detail-action" data-detail-save data-inventory-write title="${escapeHtml(pageT(lang, "inventory.detail.save"))}"${writeAttributes}>${escapeHtml(state.busy ? pageT(lang, "inventory.saving") : pageT(lang, "inventory.detail.save"))}</button>
    </header>
    ${renderWriteStatus(helpers)}
    ${renderBasicCard(helpers)}
    ${renderParentStocksCard(helpers)}
    ${renderStatusCard(helpers)}
    ${renderSubitemsCard(helpers)}
    ${renderSeriesCard(helpers)}
    <footer class="inventory-detail-footer">
      <button type="button" class="inventory-detail-danger" data-detail-delete data-inventory-write title="${escapeHtml(pageT(lang, "inventory.delete"))}"${writeAttributes}>${escapeHtml(pageT(lang, "inventory.delete"))}</button>
      <button type="button" class="inventory-detail-confirm" data-detail-save data-inventory-write title="${escapeHtml(pageT(lang, "inventory.confirmModify"))}"${writeAttributes}>${escapeHtml(pageT(lang, "inventory.confirmModify"))}</button>
    </footer>
    ${renderSubitemModal(helpers)}
  </div>`;
}

function rerenderDetailPage() {
  const page = document.querySelector("[data-inventory-detail-page]");
  if (page && currentHelpers) page.outerHTML = renderInventoryDetail(currentHelpers);
}

function closeStatusMenu() {
  state.statusOpen = false;
  const page = document.querySelector("[data-inventory-detail-page]");
  const trigger = document.querySelector("[data-detail-status-trigger]");
  const popover = document.querySelector("[data-detail-status-popover]");
  if (page) page.setAttribute("data-status-open", "false");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  if (popover) popover.classList.remove("menu-popover--open");
}

function closeWarehouseMenus() {
  state.warehouseOpen = null;
  document.querySelectorAll("[data-modal-warehouse-trigger]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  document.querySelectorAll("[data-modal-warehouse-popover]").forEach((popover) => popover.classList.remove("menu-popover--open"));
}

function closeModal() {
  state.modalOpen = false;
  state.modalItem = null;
  state.warehouseOpen = null;
  rerenderDetailPage();
}

function openModal(item) {
  if (liveReadOnly) return;
  state.modalOpen = true;
  state.modalItem = cloneModalItem(item);
  state.warehouseOpen = null;
  state.statusOpen = false;
  rerenderDetailPage();
}

function catalogPayload() {
  const stocks = (rows) => rows.filter((row) => row.id).map((row) => ({
    warehouseId: row.id,
    quantity: Math.max(0, Math.trunc(Number(row.quantity) || 0))
  }));
  return {
    id: detail.product.id,
    name: String(detail.product.name || "").trim(),
    internalCode: String(detail.product.productId || "").trim(),
    category: String(detail.product.category || "").trim(),
    productType: String(detail.product.productType || "").trim(),
    price: Math.max(0, Number(detail.product.price) || 0),
    warrantyMonths: Math.max(0, Math.trunc(Number(detail.product.warrantyMonths) || 0)),
    status: state.status,
    imageUrl: String(detail.product.imageUrl || "").trim(),
    specs: String(detail.product.specs || "").trim(),
    tags: Array.isArray(detail.product.tags) ? detail.product.tags : [],
    collections: detail.series.map((item) => String(item.name || "").trim()).filter(Boolean),
    stocks: stocks(detail.warehouses || []),
    variants: detail.subitems.map((item) => ({
      id: item.id,
      name: String(item.name || "").trim(),
      internalCode: String(item.internalCode || "").trim(),
      price: Math.max(0, Number(item.editPrice ?? item.price) || 0),
      warrantyMonths: Math.max(0, Math.trunc(Number(item.warrantyMonths) || 0)),
      status: item.status || "active",
      imageUrl: item.imageUrl || "",
      specs: item.specs || "",
      stocks: stocks(item.warehouses || [])
    }))
  };
}

async function saveInventoryDetail() {
  if (liveReadOnly || state.busy) return;
  if (!authenticated) {
    detailCommitted = true;
    navigateTo("./inventory.html");
    return;
  }
  const payload = catalogPayload();
  if (!payload.name || !payload.internalCode || payload.variants.some((item) => !item.name || !item.internalCode)) return;
  state.busy = true;
  state.error = "";
  state.feedback = "";
  rerenderDetailPage();
  try {
    let expectedUpdatedAt = detail.product.shopifyBinding?.updatedAt || "";
    let expectedStructureHash = detail.product.shopifyBinding?.structureHash || "";
    while (true) {
      try {
        await updateLiveInventoryProduct(payload, expectedUpdatedAt, expectedStructureHash);
        break;
      } catch (error) {
        const conflict = error?.code === "SHOPIFY_UPDATED_AT_CONFLICT" ? error.detail : null;
        const currentStructureHash = String(conflict?.currentStructureHash || "").trim();
        const currentUpdatedAt = String(conflict?.currentUpdatedAt || "").trim();
        if (!currentStructureHash) throw error;
        const proceed = await confirmInPage(
          pageT(currentHelpers?.lang ?? "zh", "inventory.conflict.message"),
          {
            title: pageT(currentHelpers?.lang ?? "zh", "inventory.conflict.title"),
            cancelLabel: pageT(currentHelpers?.lang ?? "zh", "inventory.cancel"),
            confirmLabel: pageT(currentHelpers?.lang ?? "zh", "inventory.conflict.confirm"),
            danger: true
          }
        );
        if (!proceed) {
          state.error = pageT(currentHelpers?.lang ?? "zh", "inventory.conflict.cancelled");
          state.busy = false;
          rerenderDetailPage();
          return;
        }
        detail.product.shopifyBinding = {
          ...(detail.product.shopifyBinding || {}),
          updatedAt: currentUpdatedAt,
          structureHash: currentStructureHash
        };
        expectedUpdatedAt = currentUpdatedAt;
        expectedStructureHash = currentStructureHash;
      }
    }
    detailCommitted = true;
    state.feedback = pageT(currentHelpers?.lang ?? "zh", "inventory.saved");
    navigateTo("./inventory.html");
  } catch (error) {
    state.error = `${pageT(currentHelpers?.lang ?? "zh", "inventory.saveFailed")}: ${error.message}`;
    state.busy = false;
    rerenderDetailPage();
  }
}

async function onInventoryDetailClick(event) {
  if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
  if (event.target.closest("[data-detail-save]")) {
    await saveInventoryDetail();
    return;
  }
  if (event.target.closest("[data-detail-back]")) {
    navigateTo("./inventory.html");
    return;
  }

  if (event.target.closest("[data-detail-delete]")) {
    if (!authenticated || state.busy) return;
    const first = await confirmInPage(pageT(currentHelpers?.lang ?? "zh", "inventory.deleteConfirm"), { danger: true });
    if (!first) return;
    const final = await confirmInPage(pageT(currentHelpers?.lang ?? "zh", "inventory.deleteFinal"), { danger: true });
    if (!final) return;
    state.busy = true;
    rerenderDetailPage();
    try {
      await deleteLiveInventoryProduct(detail.product.id);
      detailCommitted = true;
      navigateTo("./inventory.html");
    } catch (error) {
      state.error = `${pageT(currentHelpers?.lang ?? "zh", "inventory.deleteFailed")}: ${error.message}`;
      state.busy = false;
      rerenderDetailPage();
    }
    return;
  }

  if (event.target.closest("[data-series-add]")) {
    detail.series.push({
      id: `local-series-${Date.now()}`,
      name: pageT(currentHelpers?.lang ?? "zh", "inventory.series.new").replace("{count}", String(detail.series.length + 1))
    });
    state.basicDirty = true;
    rerenderDetailPage();
    return;
  }

  const seriesRemove = event.target.closest("[data-series-remove]");
  if (seriesRemove) {
    detail.series = detail.series.filter((item) => item.id !== seriesRemove.getAttribute("data-series-remove"));
    state.basicDirty = true;
    rerenderDetailPage();
    return;
  }

  const statusTrigger = event.target.closest("[data-detail-status-trigger]");
  if (statusTrigger) {
    state.statusOpen = !state.statusOpen;
    closeWarehouseMenus();
    rerenderDetailPage();
    return;
  }

  const statusOption = event.target.closest("[data-detail-status-option]");
  if (statusOption) {
    state.status = statusOption.getAttribute("data-status") || state.status;
    state.basicDirty = true;
    state.statusOpen = false;
    rerenderDetailPage();
    return;
  }

  const subitemNew = event.target.closest("[data-subitem-new]");
  if (subitemNew) {
    openModal(null);
    return;
  }

  const subitemRow = event.target.closest("[data-subitem-row]");
  if (subitemRow) {
    const id = subitemRow.getAttribute("data-subitem-id");
    openModal(detail.subitems.find((item) => item.id === id) ?? detail.subitems[0]);
    return;
  }

  const warehouseTrigger = event.target.closest("[data-modal-warehouse-trigger]");
  if (warehouseTrigger) {
    const index = Number(warehouseTrigger.getAttribute("data-warehouse-index"));
    state.warehouseOpen = state.warehouseOpen === index ? null : index;
    rerenderDetailPage();
    return;
  }

  const warehouseOption = event.target.closest("[data-modal-warehouse-option]");
  if (warehouseOption && state.modalItem) {
    const index = Number(warehouseOption.getAttribute("data-warehouse-index"));
    const warehouse = warehouseOptions.find((item) => item.id === warehouseOption.getAttribute("data-warehouse-id"));
    if (state.modalItem.warehouses[index] && warehouse) Object.assign(state.modalItem.warehouses[index], warehouse);
    state.warehouseOpen = null;
    rerenderDetailPage();
    return;
  }

  if (event.target.closest("[data-modal-delete]") && state.modalItem) {
    detail.subitems = detail.subitems.filter((item) => item.id !== state.modalItem.id);
    state.basicDirty = true;
    closeModal();
    return;
  }

  if (event.target.closest("[data-modal-confirm]") && state.modalItem) {
    const item = {
      ...state.modalItem,
      id: state.modalItem.id === "new" ? globalThis.crypto.randomUUID() : state.modalItem.id,
      name: String(state.modalItem.name || "").trim(),
      internalCode: String(state.modalItem.internalCode || "").trim(),
      price: Math.max(0, Number(state.modalItem.editPrice) || 0),
      editPrice: Math.max(0, Number(state.modalItem.editPrice) || 0),
      warrantyMonths: Math.max(0, Math.trunc(Number(state.modalItem.warrantyMonths) || 0)),
      quantity: state.modalItem.warehouses.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0)
    };
    if (!item.name || !item.internalCode) return;
    const index = detail.subitems.findIndex((row) => row.id === state.modalItem.id);
    if (index >= 0) detail.subitems[index] = item;
    else detail.subitems.push(item);
    state.basicDirty = true;
    closeModal();
    return;
  }

  if (event.target.closest("[data-modal-close]") || event.target.matches("[data-inventory-subitem-overlay]")) {
    closeModal();
    return;
  }

  if (!event.target.closest("[data-detail-status-menu]")) closeStatusMenu();
  if (!event.target.closest("[data-modal-warehouse-menu]")) closeWarehouseMenus();
}

function onInventoryDetailInput(event) {
  if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
  const field = event.target.closest("[data-detail-field]");
  if (field && field.dataset.detailField) {
    const key = field.dataset.detailField;
    if (key === "price" || key === "warrantyMonths") detail.product[key] = Number(field.value);
    else if (key === "tags") detail.product.tags = field.value.split(",").map((value) => value.trim()).filter(Boolean);
    else detail.product[key] = field.value;
    state.basicDirty = true;
  }
  const series = event.target.closest("[data-series-name]");
  if (series) {
    const row = detail.series.find((item) => item.id === series.dataset.seriesName);
    if (row) row.name = series.value;
    state.basicDirty = true;
  }
  const parentStock = event.target.closest("[data-parent-warehouse-qty]");
  if (parentStock) {
    const warehouse = detail.warehouses.find((row) => row.id === parentStock.dataset.parentWarehouseQty);
    if (warehouse) warehouse.quantity = parentStock.value;
    state.basicDirty = true;
  }
  if (!state.modalItem) return;
  const name = event.target.closest("[data-modal-name]");
  const code = event.target.closest("[data-modal-code]");
  const price = event.target.closest("[data-modal-price]");
  const warranty = event.target.closest("[data-modal-warranty]");
  const qty = event.target.closest("[data-modal-warehouse-qty]");
  if (name) state.modalItem.name = name.value;
  if (code) state.modalItem.internalCode = code.value;
  if (price) state.modalItem.editPrice = price.value;
  if (warranty) state.modalItem.warrantyMonths = warranty.value;
  if (qty) {
    const index = Number(qty.getAttribute("data-modal-warehouse-qty"));
    if (state.modalItem.warehouses[index]) state.modalItem.warehouses[index].quantity = qty.value;
  }
}

function onInventoryDetailKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.modalOpen) {
    closeModal();
    return;
  }
  closeStatusMenu();
  closeWarehouseMenus();
}

function navigateTo(relative) {
  const url = new URL(relative, window.location.href);
  if (typeof activeNavigation?.navigate === "function") void activeNavigation.navigate(url);
  else if (typeof activeNavigation?.hardNavigate === "function") activeNavigation.hardNavigate(url);
  else window.location.assign(url.href);
}

function hasInventoryDetailUnsavedChanges() {
  if (detailCommitted) return false;
  return state.status !== detail?.product.status
    || state.basicDirty
    || detail?.series.length !== state.seriesCount
    || state.modalItem !== null;
}

export async function mountPage({ scope, signal, url = new URL(window.location.href), navigation = null } = {}) {
  activeNavigation = navigation;
  detailCommitted = false;
  const productId = url.searchParams.get("id");
  const [nextDetail, nextCurrentUser, nextUnread] = await Promise.all([
    getInventoryDetailData(productId), getCurrentUser(), getUnread()
  ]);
  throwIfPageAborted(signal, scope);
  detail = nextDetail;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  authenticated = typeof currentUser?.hasPermission === "function";
  shopifyHealth = currentUser?.isBfAdmin === true
    ? await getShopifyCredentialHealth({ refresh: true })
    : null;
  throwIfPageAborted(signal, scope);
  const bindingReady = detail.product.shopifyBinding?.status === "active";
  liveReadOnly = authenticated && (
    currentUser?.isBfAdmin !== true || !shopifyWriteReady(shopifyHealth) || !bindingReady
  );
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  if (detail.product.status === "enabled") detail.product.status = "active";
  statusOptions = ["draft", "active", "discontinued"];
  warehouseOptions = (detail.availableWarehouses || detail.warehouses || []).map((row) => ({ ...row }));
  state = {
    status: detail.product.status,
    statusOpen: false,
    modalOpen: false,
    modalItem: null,
    warehouseOpen: null,
    basicDirty: false,
    seriesCount: detail.series.length,
    busy: false,
    error: "",
    feedback: ""
  };

  return {
    page: {
      menu: createBizflowMenu("inventory"),
      data: { unread, user: currentUser },
      render: renderInventoryDetail,
      title: `Honnmono · ${detail.product.name}`
    },
    activate() {
      scope.listen(document, "click", onInventoryDetailClick);
      scope.listen(document, "input", onInventoryDetailInput);
      scope.listen(document, "keydown", onInventoryDetailKeydown);
    },
    hasUnsavedChanges: hasInventoryDetailUnsavedChanges,
    async canLeave() {
      if (!hasInventoryDetailUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "inventory.leaveUnsaved"));
    },
    captureState: () => null,
    dispose() {
      detail = null;
      currentUser = null;
      shopifyHealth = null;
      authenticated = false;
      unread = null;
      currentHelpers = null;
      if (activeNavigation === navigation) activeNavigation = null;
      state.modalItem = null;
      warehouseOptions = [];
    }
  };
}
