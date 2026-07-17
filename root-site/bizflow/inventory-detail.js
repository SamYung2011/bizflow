// bizflow 商品庫存详情桌面屏(Figma 676:99575 / 676:99691)。
// 详情页读取 URL id,演示表单和子类弹窗走 provider 样稿轮;保存/确认修改回列表。

import { getInventoryDetailData, getUnread, getCurrentUser } from "../data/provider.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

const dict = {
  zh: {
    "inventory.detail.product": "商品",
    "inventory.detail.save": "保存修改",
    "inventory.field.name": "商品名稱",
    "inventory.field.productId": "商品ID",
    "inventory.field.category": "原始類別",
    "inventory.field.stock": "庫存",
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
    "inventory.empty.subitems": "暫無子類",
    "inventory.empty.series": "暫無商品系列",
    "inventory.empty.warehouses": "暫無倉存資料",
    "inventory.cancel": "取消",
    "inventory.confirm": "確認",
    "inventory.close": "關閉",
    "inventory.leaveUnsaved": "商品修改尚未保存，確定離開？"
  },
  en: {
    "inventory.detail.product": "Product",
    "inventory.detail.save": "Save changes",
    "inventory.field.name": "Product name",
    "inventory.field.productId": "Product ID",
    "inventory.field.category": "Source category",
    "inventory.field.stock": "Stock",
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
    "inventory.empty.subitems": "No subitems",
    "inventory.empty.series": "No product series",
    "inventory.empty.warehouses": "No warehouse stock",
    "inventory.cancel": "Cancel",
    "inventory.confirm": "Confirm",
    "inventory.close": "Close",
    "inventory.leaveUnsaved": "Product changes have not been saved. Leave this page?"
  },
  fr: {
    "inventory.detail.product": "Produit",
    "inventory.detail.save": "Enregistrer",
    "inventory.field.name": "Nom du produit",
    "inventory.field.productId": "ID produit",
    "inventory.field.category": "Catégorie source",
    "inventory.field.stock": "Stock",
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
    "inventory.empty.subitems": "Aucune sous-catégorie",
    "inventory.empty.series": "Aucune série produit",
    "inventory.empty.warehouses": "Aucun stock d'entrepôt",
    "inventory.cancel": "Annuler",
    "inventory.confirm": "Confirmer",
    "inventory.close": "Fermer",
    "inventory.leaveUnsaved": "Les modifications du produit ne sont pas enregistrées. Quitter cette page ?"
  }
};

let detail = null;
let currentUser = null;
let unread = null;
let liveReadOnly = false;
let writeAttributes = "";
let statusOptions = [];
const warehouseOptions = ["hk", "zh"];

let state = {
  status: "",
  statusOpen: false,
  modalOpen: false,
  modalItem: null,
  warehouseOpen: null,
  basicDirty: false,
  seriesCount: 0
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
      warrantyYears: "",
      warehouses: detail.warehouses.map((row) => ({ ...row }))
    };
  }
  return {
    ...item,
    warehouses: item.warehouses.map((row) => ({ ...row }))
  };
}

function renderField({ labelKey, value, wide = false }, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<label class="inventory-field${wide ? " inventory-field--wide" : ""}">
    <span class="inventory-field__label" title="${escapeHtml(pageT(lang, labelKey))}">${escapeHtml(pageT(lang, labelKey))}</span>
    <input class="inventory-input" data-inventory-write value="${escapeHtml(value)}"${writeAttributes}>
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
        ${renderField({ labelKey: "inventory.field.name", value: detail.product.name, wide: true }, helpers)}
        ${renderField({ labelKey: "inventory.field.productId", value: detail.product.productId }, helpers)}
        ${renderField({ labelKey: "inventory.field.stock", value: detail.product.stock }, helpers)}
        ${renderField({ labelKey: "inventory.field.category", value: detail.product.category, wide: true }, helpers)}
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

function renderSubitemRow(item, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const name = item.name ?? pageT(lang, item.nameKey);
  return `<div class="inventory-subitem-row" role="button" tabindex="${liveReadOnly ? "-1" : "0"}" data-subitem-row data-inventory-write data-subitem-id="${escapeHtml(item.id)}" aria-disabled="${liveReadOnly}" title="${escapeHtml(name)}">
    <span class="inventory-subitem-image" aria-hidden="true"></span>
    <span class="inventory-subitem-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    <input class="inventory-quantity-input" data-inventory-write value="${escapeHtml(item.quantity)}" aria-label="${escapeHtml(pageT(lang, "inventory.field.stock"))}"${writeAttributes}>
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
          <span class="inventory-series-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="inventory-series-icon">${icon("icon-add-surface-add", "icon")}</span>
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
  const label = pageT(lang, `inventory.warehouse.${row.key}`);
  const open = state.warehouseOpen === index;
  const options = warehouseOptions.map((key) => {
    const selected = row.key === key;
    const optionLabel = pageT(lang, `inventory.warehouse.${key}`);
    return `<button type="button" role="option" aria-selected="${selected}" class="dropdown-item${selected ? " dropdown-item--selected" : ""}" data-modal-warehouse-option data-inventory-write data-warehouse-index="${index}" data-warehouse="${escapeHtml(key)}" title="${escapeHtml(optionLabel)}"${writeAttributes}>
      <span class="tp-line">${escapeHtml(optionLabel)}</span>
    </button>`;
  }).join("");
  return `<span class="inventory-select-anchor" data-modal-warehouse-menu>
    <button type="button" class="inventory-select-trigger" data-modal-warehouse-trigger data-inventory-write data-warehouse-index="${index}" aria-haspopup="listbox" aria-expanded="${open}" title="${escapeHtml(label)}"${writeAttributes}>
      <span>${escapeHtml(label)}</span>
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
            <span class="inventory-modal-label" title="${escapeHtml(pageT(lang, "inventory.modal.price"))}">${escapeHtml(pageT(lang, "inventory.modal.price"))}</span>
            <input class="inventory-modal-input" data-modal-price data-inventory-write value="${escapeHtml(item.editPrice)}"${writeAttributes}>
          </label>
          <label class="inventory-modal-field">
            <span class="inventory-modal-label" title="${escapeHtml(pageT(lang, "inventory.modal.warranty"))}">${escapeHtml(pageT(lang, "inventory.modal.warranty"))}</span>
            <input class="inventory-modal-input" data-modal-warranty data-inventory-write value="${escapeHtml(item.warrantyYears)}"${writeAttributes}>
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
        <button type="button" class="inventory-modal-cancel" data-modal-close>${escapeHtml(pageT(lang, "inventory.cancel"))}</button>
        <button type="button" class="inventory-modal-confirm" data-modal-confirm data-inventory-write${writeAttributes}>${escapeHtml(pageT(lang, "inventory.confirm"))}</button>
      </div>
    </section>
  </div>`;
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
      <button type="button" class="inventory-detail-action" data-detail-back data-inventory-write title="${escapeHtml(pageT(lang, "inventory.detail.save"))}"${writeAttributes}>${escapeHtml(pageT(lang, "inventory.detail.save"))}</button>
    </header>
    ${renderBasicCard(helpers)}
    ${renderStatusCard(helpers)}
    ${renderSubitemsCard(helpers)}
    ${renderSeriesCard(helpers)}
    <footer class="inventory-detail-footer">
      <button type="button" class="inventory-detail-danger" data-detail-delete data-inventory-write title="${escapeHtml(pageT(lang, "inventory.delete"))}"${writeAttributes}>${escapeHtml(pageT(lang, "inventory.delete"))}</button>
      <button type="button" class="inventory-detail-confirm" data-detail-back data-inventory-write title="${escapeHtml(pageT(lang, "inventory.confirmModify"))}"${writeAttributes}>${escapeHtml(pageT(lang, "inventory.confirmModify"))}</button>
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

function onInventoryDetailClick(event) {
  if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
  if (event.target.closest("[data-detail-back]")) {
    if (event.target.closest("[data-inventory-write]")) detailCommitted = true;
    navigateTo("./inventory.html");
    return;
  }

  if (event.target.closest("[data-detail-delete]")) return;

  if (event.target.closest("[data-series-add]")) {
    detail.series.push({
      id: `local-series-${Date.now()}`,
      nameKey: "inventory.series.new",
      localIndex: detail.series.length + 1
    });
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
    const key = warehouseOption.getAttribute("data-warehouse");
    if (state.modalItem.warehouses[index] && warehouseOptions.includes(key)) state.modalItem.warehouses[index].key = key;
    state.warehouseOpen = null;
    rerenderDetailPage();
    return;
  }

  if (event.target.closest("[data-modal-close]") || event.target.closest("[data-modal-confirm]") || event.target.matches("[data-inventory-subitem-overlay]")) {
    closeModal();
    return;
  }

  if (!event.target.closest("[data-detail-status-menu]")) closeStatusMenu();
  if (!event.target.closest("[data-modal-warehouse-menu]")) closeWarehouseMenus();
}

function onInventoryDetailInput(event) {
  if (liveReadOnly && event.target.closest("[data-inventory-write]")) return;
  if (event.target.closest(".inventory-input, .inventory-subitem-row > .inventory-quantity-input")) state.basicDirty = true;
  if (!state.modalItem) return;
  const price = event.target.closest("[data-modal-price]");
  const warranty = event.target.closest("[data-modal-warranty]");
  const qty = event.target.closest("[data-modal-warehouse-qty]");
  if (price) state.modalItem.editPrice = price.value;
  if (warranty) state.modalItem.warrantyYears = warranty.value;
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
  liveReadOnly = typeof currentUser?.hasPermission === "function";
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  statusOptions = ["active", "discontinued"].includes(detail.product.status)
    ? ["active", "discontinued"]
    : ["enabled", "draft"];
  state = {
    status: detail.product.status,
    statusOpen: false,
    modalOpen: false,
    modalItem: null,
    warehouseOpen: null,
    basicDirty: false,
    seriesCount: detail.series.length
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
      unread = null;
      currentHelpers = null;
      if (activeNavigation === navigation) activeNavigation = null;
      state.modalItem = null;
    }
  };
}
