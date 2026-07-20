// bizflow 站客戶管理桌面屏(Figma 619:60662「客户管理」)。
// 结构/交互实测来源:get_design_context 逐区拉值 + use_figma 只读 reactions(见 commit 说明)。
//   - 新增客户按钮(637:61301)ON_CLICK → NAVIGATE 637:61638(客户管理-新增客户弹窗,内嵌 509:21612 表单)
//     → 本屏做成真弹层;弹窗内 取消/提交/关闭X 三键的 reaction 都是 NAVIGATE 回列表页(=纯关闭,不接真提交)。
//   - 客户行(637:61315 等)ON_CLICK → NAVIGATE 637:62961(客户管理-客户详情,独立屏),
//     当前已接 `customer-detail.html?id=...`。
//   - 客户来源/IMEI码 两个筛选下拉本身未挂 reaction,按 docs/00-设计规范 §10.2.3 全站下拉规约
//     (Frame784 浮层 + 弹窗按钮选项行)实装为真联动,写法参考 team/tasks.js 的 data-filter 委托模式(未 import)。
//   - 日期区间与订单管理共用蓝色 date-range-panel,按 joinedAt 真筛选。

import { getCustomersPageData, getCurrentUser, getUnread } from "../data/provider.js";
import { createDateRangeFilter, latestDateInput } from "../components/date-range-filter.js";
import { managementPageSize, renderManagementList, renderManagementPager } from "../components/management-list.js";
import { renderSegment } from "../components/segment.js";
import { consumeNavigationPreset, navigationPresetKeys } from "../components/navigation-presets.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { renderNewCustomerFields } from "../components/new-customer-fields.js";
import { copyPhoneNumber } from "../components/phone-copy.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { createCustomerSorter, customerSortKeys } from "./customers-sort.js";
import {
  captureWarrantyState,
  clearWarrantyDateRange,
  closeWarrantyDateRange,
  disposeWarrantyState,
  ensureWarrantyData,
  moveWarrantyPage,
  openWarrantyDateRange,
  renderWarranty,
  restoreWarrantyState,
  setWarrantySearch
} from "./customers-warranty.js";

const dict = {
  zh: {
    "customers.title": "客戶管理",
    "customers.tab.list": "客戶列表",
    "customers.tab.warranty": "保修提醒",
    "customers.add": "新增客戶",
    "customers.filter.source": "客戶來源",
    "customers.filter.imei": "IMEI碼",
    "customers.filter.all": "全部",
    "customers.filter.imeiAll": "全部",
    "customers.filter.imeiHas": "有 IMEI",
    "customers.filter.imeiNone": "無 IMEI",
    "customers.search": "搜尋客戶 / 電話 / IMEI...",
    "customers.sort.label": "排序",
    "customers.sort.createdDesc": "建立時間·新→舊",
    "customers.sort.createdAsc": "建立時間·舊→新",
    "customers.sort.lastPurchaseDesc": "最近購買·新→舊",
    "customers.sort.lastPurchaseAsc": "最近購買·舊→新",
    "customers.source.shopify": "Shopify",
    "customers.source.framer": "Framer",
    "customers.source.other": "其他",
    "customers.orderCount": "訂單數",
    "customers.pager.prev": "上一頁",
    "customers.pager.next": "下一頁",
    "customers.empty": "暫無符合條件的客戶",
    "customers.modal.title": "新增顧客",
    "customers.field.name": "姓名",
    "customers.field.phone": "聯絡電話",
    "customers.field.email": "Email",
    "customers.field.carModel": "車型",
    "customers.field.imei": "產品IMEI碼",
    "customers.field.address": "收貨地址",
    "customers.action.cancel": "取消",
    "customers.action.submit": "提交",
    "customers.action.close": "關閉"
  },
  en: {
    "customers.title": "Customer management",
    "customers.tab.list": "Customer list",
    "customers.tab.warranty": "Warranty reminders",
    "customers.add": "Add customer",
    "customers.filter.source": "Customer source",
    "customers.filter.imei": "IMEI code",
    "customers.filter.all": "All",
    "customers.filter.imeiAll": "All",
    "customers.filter.imeiHas": "Has IMEI",
    "customers.filter.imeiNone": "No IMEI",
    "customers.search": "Search customer / phone / IMEI...",
    "customers.sort.label": "Sort",
    "customers.sort.createdDesc": "Created · newest first",
    "customers.sort.createdAsc": "Created · oldest first",
    "customers.sort.lastPurchaseDesc": "Last purchase · newest first",
    "customers.sort.lastPurchaseAsc": "Last purchase · oldest first",
    "customers.source.shopify": "Shopify",
    "customers.source.framer": "Framer",
    "customers.source.other": "Other",
    "customers.orderCount": "Orders",
    "customers.pager.prev": "Previous page",
    "customers.pager.next": "Next page",
    "customers.empty": "No customers match the filters",
    "customers.modal.title": "Add customer",
    "customers.field.name": "Name",
    "customers.field.phone": "Phone",
    "customers.field.email": "Email",
    "customers.field.carModel": "Vehicle model",
    "customers.field.imei": "Product IMEI",
    "customers.field.address": "Shipping address",
    "customers.action.cancel": "Cancel",
    "customers.action.submit": "Submit",
    "customers.action.close": "Close"
  },
  fr: {
    "customers.title": "Gestion des clients",
    "customers.tab.list": "Liste des clients",
    "customers.tab.warranty": "Rappels de garantie",
    "customers.add": "Ajouter un client",
    "customers.filter.source": "Source client",
    "customers.filter.imei": "Code IMEI",
    "customers.filter.all": "Tous",
    "customers.filter.imeiAll": "Tous",
    "customers.filter.imeiHas": "Avec IMEI",
    "customers.filter.imeiNone": "Sans IMEI",
    "customers.search": "Rechercher client / téléphone / IMEI...",
    "customers.sort.label": "Tri",
    "customers.sort.createdDesc": "Création · récent → ancien",
    "customers.sort.createdAsc": "Création · ancien → récent",
    "customers.sort.lastPurchaseDesc": "Dernier achat · récent → ancien",
    "customers.sort.lastPurchaseAsc": "Dernier achat · ancien → récent",
    "customers.source.shopify": "Shopify",
    "customers.source.framer": "Framer",
    "customers.source.other": "Autre",
    "customers.orderCount": "Commandes",
    "customers.pager.prev": "Page précédente",
    "customers.pager.next": "Page suivante",
    "customers.empty": "Aucun client ne correspond aux filtres",
    "customers.modal.title": "Ajouter un client",
    "customers.field.name": "Nom",
    "customers.field.phone": "Téléphone",
    "customers.field.email": "Email",
    "customers.field.carModel": "Modèle de véhicule",
    "customers.field.imei": "IMEI du produit",
    "customers.field.address": "Adresse de livraison",
    "customers.action.cancel": "Annuler",
    "customers.action.submit": "Soumettre",
    "customers.action.close": "Fermer"
  }
};

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

let data = null;
let currentUser = null;
let unread = null;
let liveReadOnly = false;
let writeAttributes = "";

// 筛选 + 分页 + 弹窗状态(模块级,重渲后延续)
let state = {
  tab: "list",
  sort: "createdDesc",
  source: "all",
  imei: "all",
  search: "",
  page: 1,
  modalOpen: false
};

let currentHelpers = null;
const customerTabs = ["list", "warranty"];
let customerSorter = null;
let dateFilter = null;
let resizeTimer = 0;
let activeScope = null;

function isCurrentCustomersScope(scope = activeScope) {
  return Boolean(scope && scope === activeScope && scope.isCurrent());
}

function filteredCustomers() {
  const query = state.search.trim().toLocaleLowerCase();
  return data.customers.filter((c) => {
    if (query && ![c.name, c.phone, c.imei]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(query))) return false;
    if (state.source !== "all" && c.source !== state.source) return false;
    const hasImei = Boolean(String(c.imei ?? "").trim());
    if (state.imei === "has" && !hasImei) return false;
    if (state.imei === "none" && hasImei) return false;
    return dateFilter.matches(c.joinedAt);
  }).sort((left, right) => customerSorter.compare(left, right, state.sort));
}

function initials(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

export function renderCustomerRow(customer, helpers) {
  const { escapeHtml, lang } = helpers;
  const sourceLabel = pageT(lang, `customers.source.${customer.source}`);
  const countTitle = `${pageT(lang, "customers.orderCount")}：${customer.orderCount}`;
  const carModel = String(customer.detail?.carModel ?? "").trim();
  return `<a class="tp-component management-list__row management-list__row--customer customer-row" style="--component-height:60px" href="./customer-detail.html?id=${encodeURIComponent(customer.id)}" data-customer-row data-customer-id="${escapeHtml(customer.id)}">
    <span class="avatar--initial" style="--component-width:40px;--component-height:40px">${escapeHtml(initials(customer.name))}</span>
    <div class="customer-row__body">
      <div class="customer-row__name-line">
        <span class="customer-row__name" title="${escapeHtml(customer.name)}">${escapeHtml(customer.name)}</span>
        <span class="customer-row__source" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</span>
      </div>
      <div class="customer-row__meta-line">
        <span class="customer-row__phone">${escapeHtml(customer.phone)}</span>
        <span class="customer-row__date">${escapeHtml(customer.joinedAt)}</span>
        ${carModel ? `<span class="customer-row__car" title="${escapeHtml(carModel)}">${escapeHtml(carModel)}</span>` : ""}
      </div>
    </div>
    <span class="customer-row__count" title="${escapeHtml(countTitle)}">${escapeHtml(String(customer.orderCount))}</span>
  </a>`;
}

// 单个筛选下拉:触发器(文本&下拉选项 267:324)+ 浮层(Frame784)+ 选项行(弹窗按钮 506:14878)
// 页面只保留客户特有的来源/IMEI 选项;日期和列表外壳由 components/ 统一维护。
// 637:61302 实测:未筛选时触发器显示字段名本身(如「客户来源」),不是「全部」——
// 「全部」只作为可选项之一,选它=清空筛选,触发器回落回字段名占位态。
function renderFilterDropdown(group, placeholderLabel, options, helpers) {
  const { escapeHtml, icon } = helpers;
  const selected = state[group] === "all" ? null : options.find((o) => o.value === state[group]);
  const triggerLabel = selected ? selected.label : placeholderLabel;
  const options_html = options
    .map((o) => {
      const sel = o.value === state[group];
      return `<button type="button" role="option" aria-selected="${sel}" class="dropdown-item${sel ? " dropdown-item--selected" : ""}" data-customers-filter-option data-filter-group="${group}" data-filter-value="${escapeHtml(o.value)}" title="${escapeHtml(o.label)}">
        <span class="tp-line">${escapeHtml(o.label)}</span>
      </button>`;
    })
    .join("");
  return `<span class="customers-filter-anchor customers-filter-anchor--${group}" data-customers-filter-menu>
    <button type="button" class="customers-filter" data-customers-filter-trigger data-filter-group="${group}" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(placeholderLabel)}" title="${escapeHtml(triggerLabel)}">
      <span>${escapeHtml(triggerLabel)}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="menu-popover customers-filter-menu" role="listbox" data-customers-filter-popover>${options_html}</div>
  </span>`;
}

function renderToolbar(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const sourceOptions = [
    { value: "all", label: pageT(lang, "customers.filter.all") },
    ...["shopify", "framer", "other"].map((key) => ({ value: key, label: pageT(lang, `customers.source.${key}`) }))
  ];
  const imeiOptions = [
    { value: "all", label: pageT(lang, "customers.filter.imeiAll") },
    { value: "has", label: pageT(lang, "customers.filter.imeiHas") },
    { value: "none", label: pageT(lang, "customers.filter.imeiNone") }
  ];
  const sortOptions = customerSortKeys.map((key) => ({
    value: key,
    label: pageT(lang, `customers.sort.${key}`)
  }));
  return `<div class="customers-toolbar">
    <label class="tp-component search-input customers-search" style="--component-width:232px;--component-height:36px">
      ${icon("icon-nav-search", "icon")}
      <input type="search" data-customers-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(pageT(lang, "customers.search"))}" aria-label="${escapeHtml(pageT(lang, "customers.search"))}" autocomplete="off">
    </label>
    ${dateFilter.render(helpers)}
    ${renderFilterDropdown("sort", pageT(lang, "customers.sort.label"), sortOptions, helpers)}
    ${renderFilterDropdown("source", pageT(lang, "customers.filter.source"), sourceOptions, helpers)}
    ${renderFilterDropdown("imei", pageT(lang, "customers.filter.imei"), imeiOptions, helpers)}
  </div>`;
}

// 新增顾客弹窗(509:21612):表单为本地草稿,取消/提交/关闭 三键在 Figma 里都是
// NAVIGATE 回列表页的 reaction,故本屏统一处理成"关闭弹层",不接真提交逻辑。
function renderAddCustomerModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => pageT(lang, key);

  return `<div class="customers-modal-overlay${state.modalOpen ? " customers-modal-overlay--open" : ""}" data-customers-modal-overlay ${state.modalOpen ? "" : 'aria-hidden="true"'}>
    <section class="tp-component form-new-customer" role="dialog" aria-modal="true" aria-label="${escapeHtml(tt("customers.modal.title"))}">
      <button type="button" class="form-new-customer__close" data-customers-modal-close aria-label="${escapeHtml(tt("customers.action.close"))}"></button>
      <h2 class="form-new-customer__title">${escapeHtml(tt("customers.modal.title"))}</h2>
      <div class="form-new-customer__fields">
        ${renderNewCustomerFields({
          lang,
          escapeHtml,
          label: (key) => tt(`customers.field.${key}`),
          idPrefix: "customers-new",
          disabled: liveReadOnly
        })}
      </div>
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-customers-modal-close>${escapeHtml(tt("customers.action.cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-customers-modal-close data-customers-write${writeAttributes}>${escapeHtml(tt("customers.action.submit"))}</button>
      </div>
    </section>
  </div>`;
}

function renderCustomerList(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => pageT(lang, key);
  const filtered = filteredCustomers();
  const pageSize = managementPageSize();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.page = Math.min(state.page, totalPages);
  const pageItems = filtered.slice((state.page - 1) * pageSize, state.page * pageSize);
  const listHtml = pageItems.length
    ? pageItems.map((c) => renderCustomerRow(c, helpers)).join("")
    : `<div class="management-list__empty customers-empty">${escapeHtml(tt("customers.empty"))}</div>`;
  const pagerHtml = renderManagementPager({
    page: state.page,
    pages: totalPages,
    visible: filtered.length > pageSize,
    icon,
    escapeHtml,
    previousLabel: tt("customers.pager.prev"),
    nextLabel: tt("customers.pager.next")
  });

  return `${renderToolbar(helpers)}
    ${renderManagementList({ content: listHtml, pager: pagerHtml, paged: filtered.length > pageSize })}
    ${renderAddCustomerModal(helpers)}`;
}

export function renderCustomers(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  const tt = (key) => pageT(lang, key);
  const segment = renderSegment({
    items: customerTabs.map((tab) => ({ key: tab, label: tt(`customers.tab.${tab}`) })),
    active: state.tab,
    ariaLabel: tt("customers.title"),
    escapeHtml,
    dataAttribute: "data-customers-tab"
  });

  return `<div class="customers-page" data-customers-page data-live-read-only="${liveReadOnly}" data-customers-tab-value="${state.tab}" data-customers-search-value="${escapeHtml(state.search)}" data-date-open="${dateFilter.isOpen()}" data-current-page="${state.page}">
    <header class="customers-head">
      <h1 class="customers-title" title="${escapeHtml(tt("customers.title"))}">${escapeHtml(tt("customers.title"))}</h1>
      ${state.tab === "list" ? `<button type="button" class="customers-add-btn" data-customers-modal-open data-customers-write${writeAttributes}>
        ${icon("icon-add-line-add", "icon")}
        <span>${escapeHtml(tt("customers.add"))}</span>
      </button>` : ""}
    </header>
    ${segment}
    ${state.tab === "warranty" ? renderWarranty(helpers) : renderCustomerList(helpers)}
  </div>`;
}

// ---------- 交互:筛选下拉(开合/点外关/Esc/选中即关+联动)+ 分页 + 新增顾客弹层 ----------
function closeAllFilterMenus(except) {
  document.querySelectorAll("[data-customers-filter-popover]").forEach((pop) => {
    if (pop === except) return;
    pop.classList.remove("menu-popover--open");
    const trigger = pop.parentElement.querySelector("[data-customers-filter-trigger]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function rerenderCustomersPage() {
  const page = document.querySelector(".customers-page");
  if (page && currentHelpers) page.outerHTML = renderCustomers(currentHelpers);
}

async function onCustomersClick(event) {
  if (liveReadOnly && event.target.closest("[data-customers-write]")) return;
  const customerTab = event.target.closest("[data-customers-tab]");
  if (customerTab) {
    const scope = activeScope;
    const tab = customerTab.getAttribute("data-customers-tab");
    if (!customerTabs.includes(tab) || state.tab === tab) return;
    state.tab = tab;
    state.modalOpen = false;
    closeAllFilterMenus(null);
    dateFilter.close();
    closeWarrantyDateRange();
    rerenderCustomersPage();
    if (tab === "warranty") {
      await ensureWarrantyData({ scope });
      if (!isCurrentCustomersScope(scope)) return;
      rerenderCustomersPage();
    }
    return;
  }

  const warrantyPhone = event.target.closest("[data-warranty-phone]");
  if (warrantyPhone && state.tab === "warranty") {
    event.preventDefault();
    event.stopPropagation();
    const scope = activeScope;
    await copyPhoneNumber(warrantyPhone.getAttribute("data-warranty-phone"), currentHelpers.lang, { scope });
    return;
  }

  const warrantyDateTrigger = event.target.closest("[data-warranty-date-trigger]");
  if (warrantyDateTrigger && state.tab === "warranty") {
    closeAllFilterMenus(null);
    dateFilter.close();
    openWarrantyDateRange(warrantyDateTrigger, currentHelpers, rerenderCustomersPage);
    return;
  }

  if (event.target.closest("[data-warranty-date-clear]") && state.tab === "warranty") {
    if (clearWarrantyDateRange()) rerenderCustomersPage();
    return;
  }

  if (event.target.closest("[data-date-range-filter]")) {
    closeAllFilterMenus(null);
    if (dateFilter.handleClick(event)) return;
  }

  const filterTrigger = event.target.closest("[data-customers-filter-trigger]");
  if (filterTrigger) {
    const anchor = filterTrigger.closest("[data-customers-filter-menu]");
    const popover = anchor && anchor.querySelector("[data-customers-filter-popover]");
    if (!popover) return;
    const willOpen = !popover.classList.contains("menu-popover--open");
    closeAllFilterMenus(willOpen ? popover : null);
    dateFilter.close();
    popover.classList.toggle("menu-popover--open", willOpen);
    filterTrigger.setAttribute("aria-expanded", String(willOpen));
    return;
  }

  const filterOption = event.target.closest("[data-customers-filter-option]");
  if (filterOption) {
    const group = filterOption.getAttribute("data-filter-group");
    const value = filterOption.getAttribute("data-filter-value");
    closeAllFilterMenus(null);
    if (state[group] !== value) {
      state[group] = value;
      state.page = 1; // 换筛选条件回第一页
      rerenderCustomersPage();
    }
    return;
  }

  const pageBtn = event.target.closest("[data-management-page]");
  if (pageBtn && !pageBtn.disabled) {
    if (state.tab === "warranty") {
      moveWarrantyPage(pageBtn.getAttribute("data-management-page"));
    } else {
      state.page += pageBtn.getAttribute("data-management-page") === "next" ? 1 : -1;
      dateFilter.close();
    }
    rerenderCustomersPage();
    return;
  }

  if (event.target.closest("[data-customers-modal-open]")) {
    closeAllFilterMenus(null);
    dateFilter.close();
    state.modalOpen = true;
    rerenderCustomersPage();
    return;
  }

  // 关闭弹窗:X / 取消 / 提交(Figma 三键 reaction 都是 NAVIGATE 回列表页 = 纯关闭)/ 点遮罩本身
  if (event.target.closest("[data-customers-modal-close]") || event.target.matches("[data-customers-modal-overlay]")) {
    state.modalOpen = false;
    rerenderCustomersPage();
    return;
  }

  // 点浮层外部:关闭所有筛选下拉(不影响弹窗)
  if (!event.target.closest("[data-customers-filter-popover]")) {
    closeAllFilterMenus(null);
  }
}

async function onCustomersContextMenu(event) {
  if (state.tab !== "warranty") return;
  const row = event.target.closest("[data-warranty-row]");
  if (!row || row.getAttribute("aria-disabled") === "true" || !row.getAttribute("data-customer-id")) return;
  const phone = row.querySelector("[data-warranty-phone]")?.getAttribute("data-warranty-phone")?.trim();
  if (!phone) return;
  event.preventDefault();
  event.stopPropagation();
  const scope = activeScope;
  await copyPhoneNumber(phone, currentHelpers.lang, { scope });
}

function onCustomersInput(event) {
  const customerSearch = event.target.closest("[data-customers-search]");
  if (customerSearch && state.tab === "list") {
    state.search = customerSearch.value;
    state.page = 1;
    rerenderCustomersPage();
    const nextSearch = document.querySelector("[data-customers-search]");
    if (nextSearch) {
      nextSearch.focus();
      nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
    }
    return;
  }
  const search = event.target.closest("[data-warranty-search]");
  if (!search || state.tab !== "warranty" || !setWarrantySearch(search.value)) return;
  rerenderCustomersPage();
  const nextSearch = document.querySelector("[data-warranty-search]");
  if (nextSearch) {
    nextSearch.focus();
    nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
  }
}

function onCustomersKeydown(event) {
  if (event.key !== "Escape") return;
  closeAllFilterMenus(null);
  dateFilter.close();
  if (state.modalOpen) {
    state.modalOpen = false;
    rerenderCustomersPage();
  }
}

function onCustomersResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;
    if (!isCurrentCustomersScope()) return;
    closeWarrantyDateRange();
    rerenderCustomersPage();
  }, 120);
}

function restoredState(value = null, presetTab = null) {
  const next = value && typeof value === "object" ? value : {};
  return {
    tab: customerTabs.includes(next.tab) ? next.tab : presetTab === "warranty" ? "warranty" : "list",
    sort: customerSortKeys.includes(next.sort) ? next.sort : "createdDesc",
    source: ["all", "shopify", "framer", "other"].includes(next.source) ? next.source : "all",
    imei: ["all", "has", "none"].includes(next.imei) ? next.imei : "all",
    search: typeof next.search === "string" ? next.search : "",
    page: Number.isInteger(next.page) && next.page > 0 ? next.page : 1,
    modalOpen: false
  };
}

export async function mountPage({ scope, signal, historyState = null } = {}) {
  activeScope = scope;
  scope.onCleanup(() => {
    if (activeScope === scope) disposeWarrantyState();
  });
  const presetTab = consumeNavigationPreset(navigationPresetKeys.customersTab);
  const presetWarrantySearch = consumeNavigationPreset(navigationPresetKeys.warrantySearch) ?? "";
  const [nextData, nextCurrentUser, nextUnread] = await Promise.all([getCustomersPageData(), getCurrentUser(), getUnread()]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  liveReadOnly = typeof currentUser?.hasPermission === "function";
  writeAttributes = liveReadOnly ? ' disabled aria-disabled="true"' : "";
  state = restoredState(historyState, presetTab);
  customerSorter = createCustomerSorter();
  restoreWarrantyState(historyState?.warranty);
  if (!historyState && presetWarrantySearch) setWarrantySearch(presetWarrantySearch);
  dateFilter = createDateRangeFilter({
    id: "customers",
    initialDate: latestDateInput(data.customers.map((customer) => customer.joinedAt)),
    onChange({ filterChanged }) {
      if (filterChanged) state.page = 1;
      rerenderCustomersPage();
    }
  });
  dateFilter.restoreState?.(historyState?.dateFilter);
  if (state.tab === "warranty") {
    await ensureWarrantyData({ scope, signal });
    throwIfPageAborted(signal, scope);
  }

  return {
    page: {
      menu: createBizflowMenu("customers"),
      data: { unread, user: currentUser },
      render: renderCustomers,
      title: "Honnmono · Customers"
    },
    activate() {
      scope.listen(document, "click", onCustomersClick);
      scope.listen(document, "contextmenu", onCustomersContextMenu);
      scope.listen(document, "input", onCustomersInput);
      scope.listen(document, "keydown", onCustomersKeydown);
      scope.listen(window, "resize", onCustomersResize);
    },
    captureState() {
      return {
        tab: state.tab,
        sort: state.sort,
        source: state.source,
        imei: state.imei,
        search: state.search,
        page: state.page,
        dateFilter: dateFilter.captureState?.() ?? null,
        warranty: captureWarrantyState()
      };
    },
    dispose() {
      window.clearTimeout(resizeTimer);
      resizeTimer = 0;
      closeAllFilterMenus(null);
      dateFilter?.close();
      disposeWarrantyState();
      data = null;
      currentUser = null;
      unread = null;
      currentHelpers = null;
      customerSorter = null;
      dateFilter = null;
      if (activeScope === scope) activeScope = null;
    }
  };
}
