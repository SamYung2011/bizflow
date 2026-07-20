// bizflow 訂單域：既有订单列表 + R11 港車北上、充電樁意向、營收分析子页。
// 各子页按需载入自己的快照，避免列表页和 Home 承担无关数据请求。

import { getOrdersPageData, getUnread, getUnreadWatermarks, getCurrentUser } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { createDateRangeFilter, latestDateInput } from "../components/date-range-filter.js";
import { managementPageSize, renderManagementList, renderManagementPager } from "../components/management-list.js";
import { renderSegment as renderSharedSegment } from "../components/segment.js";
import { aggregateShippingCounts, matchesShippingFilter } from "../components/order-metrics.js";
import { consumeNavigationPreset, navigationPresetKeys } from "../components/navigation-presets.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { confirmInPage } from "../components/confirm-dialog.js";
import { clearPhoneCopyNotice, copyPhoneNumber, phoneCopyLabel } from "../components/phone-copy.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import { attachLiveSnapshotRefresh } from "../data/live-snapshot-listener.js";
import {
  attachNorthboundBehaviors, captureNorthboundState, disposeNorthboundState, ensureNorthboundData,
  hasNorthboundRefreshBlock, hasNorthboundUnsavedChanges, renderNorthbound, restoreNorthboundState
} from "./orders-northbound.js";
import {
  attachChargerLeadBehaviors, captureChargerLeadState, disposeChargerLeadState, ensureChargerLeadsData,
  renderChargerLeads, restoreChargerLeadState
} from "./orders-charger-leads.js";
import {
  attachRevenueBehaviors, captureRevenueState, disposeRevenueState, ensureRevenueData, renderRevenue,
  restoreRevenueState
} from "./orders-revenue.js";
import { createPrintDialog } from "./print/print-dialog.js";
import { toPrintableOrder } from "./print/print-invoice.js";

const dict = {
  zh: {
    "orders.title": "訂單管理",
    "orders.new": "新建訂單",
    "orders.source": "訂單來源",
    "orders.source.all": "全部",
    "orders.source.framer": "Framer 表單",
    "orders.source.shopify": "Shopify",
    "orders.status.completed": "已完成",
    "orders.status.inProgress": "進行中",
    "orders.status.cancelled": "已取消",
    "orders.print": "列印",
    "orders.prevPage": "上一頁",
    "orders.nextPage": "下一頁",
    "orders.empty": "此條件暫無訂單",
    "orders.search": "搜索單號、客戶或產品",
    "orders.shipping.all": "全部",
    "orders.shipping.pending": "待發貨",
    "orders.shipping.in_transit": "運送中",
    "orders.shipping.exception": "異常",
    "orders.shipping.delivered": "已簽收",
    "orders.tab.list": "訂單列表",
    "orders.tab.northbound": "港車北上",
    "orders.tab.chargerLeads": "充電樁意向",
    "orders.tab.revenue": "營收分析",
    "orders.leaveUnsaved": "尚有未保存的港車北上資料，確定離開？"
  },
  en: {
    "orders.title": "Order management",
    "orders.new": "New order",
    "orders.source": "Order source",
    "orders.source.all": "All",
    "orders.source.framer": "Framer form",
    "orders.source.shopify": "Shopify",
    "orders.status.completed": "Completed",
    "orders.status.inProgress": "In progress",
    "orders.status.cancelled": "Cancelled",
    "orders.print": "Print",
    "orders.prevPage": "Previous page",
    "orders.nextPage": "Next page",
    "orders.empty": "No orders match the filters",
    "orders.search": "Search order, customer or product",
    "orders.shipping.all": "All",
    "orders.shipping.pending": "Pending shipment",
    "orders.shipping.in_transit": "In transit",
    "orders.shipping.exception": "Exception",
    "orders.shipping.delivered": "Delivered",
    "orders.tab.list": "Order list",
    "orders.tab.northbound": "Northbound vehicles",
    "orders.tab.chargerLeads": "Charger interest",
    "orders.tab.revenue": "Revenue analysis",
    "orders.leaveUnsaved": "There are unsaved northbound changes. Leave this page?"
  },
  fr: {
    "orders.title": "Gestion des commandes",
    "orders.new": "Nouvelle commande",
    "orders.source": "Source de commande",
    "orders.source.all": "Tous",
    "orders.source.framer": "Formulaire Framer",
    "orders.source.shopify": "Shopify",
    "orders.status.completed": "Terminée",
    "orders.status.inProgress": "En cours",
    "orders.status.cancelled": "Annulée",
    "orders.print": "Imprimer",
    "orders.prevPage": "Page précédente",
    "orders.nextPage": "Page suivante",
    "orders.empty": "Aucune commande ne correspond",
    "orders.search": "Rechercher commande, client ou produit",
    "orders.shipping.all": "Tous",
    "orders.shipping.pending": "À expédier",
    "orders.shipping.in_transit": "En transit",
    "orders.shipping.exception": "Anomalie",
    "orders.shipping.delivered": "Livrée",
    "orders.tab.list": "Liste des commandes",
    "orders.tab.northbound": "Véhicules vers le nord",
    "orders.tab.chargerLeads": "Intérêt bornes",
    "orders.tab.revenue": "Analyse des revenus",
    "orders.leaveUnsaved": "Des modifications de véhicules vers le nord ne sont pas enregistrées. Quitter cette page ?"
  }
};

let data = null;
let unreadWatermarks = null;
let unread = null;
let currentUser = null;
const shippingFilters = ["all", "pending", "in_transit", "exception", "delivered"];
let canViewRevenue = true;
let liveMode = false;
let liveReadOnly = false;
let domainTabs = ["list", "northbound", "chargerLeads", "revenue"];

let state = {
  tab: "list",
  source: "all",
  shipping: "all",
  search: "",
  page: 1
};

let currentHelpers = null;
let printDialog = null;
let dateFilter = null;
let resizeTimer = 0;
let activeScope = null;
let activeNavigation = null;
let ordersLiveRefresh = null;
let northboundLiveRefresh = null;

function isCurrentOrdersScope(scope = activeScope) {
  return Boolean(scope && scope === activeScope && scope.isCurrent());
}

function pageT(lang, key) {
  return dict[lang]?.[key] ?? dict.zh[key] ?? key;
}

function sourceLabel(value, lang) {
  if (value === "all") return pageT(lang, "orders.source.all");
  if (value === "Framer") return pageT(lang, "orders.source.framer");
  if (value === "Online Store" || value === "Shopify") return pageT(lang, "orders.source.shopify");
  return value;
}

function statusMark(status) {
  if (status === "in-progress") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`;
  }
  if (status === "cancelled") {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const STATUS_KEY = {
  "completed": "orders.status.completed",
  "in-progress": "orders.status.inProgress",
  "cancelled": "orders.status.cancelled"
};
const STATUS_CLASS = {
  "completed": "order-status--completed",
  "in-progress": "order-status--progress",
  "cancelled": "order-status--cancelled"
};
function ordersBeforeShipping() {
  const term = state.search.trim().toLocaleLowerCase();
  return data.orders.filter((order) => {
    if (state.source !== "all" && order.channel !== state.source) return false;
    if (!dateFilter.matches(order.date)) return false;
    if (!term) return true;
    return [order.detail?.orderNo, order.customer, order.phone, order.product]
      .some((value) => String(value || "").toLocaleLowerCase().includes(term));
  });
}

function filteredOrders() {
  return ordersBeforeShipping().filter((order) => matchesShippingFilter(order, state.shipping));
}

function currentPageSize() {
  return managementPageSize();
}

function totalPages(orders = filteredOrders(), pageSize = currentPageSize()) {
  return Math.max(1, Math.ceil(orders.length / pageSize));
}

function currentPageOrders(orders = filteredOrders(), pageSize = currentPageSize()) {
  if (orders.length <= pageSize) return orders;
  const start = (state.page - 1) * pageSize;
  return orders.slice(start, start + pageSize);
}

function renderOrderCard(order, helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const e = escapeHtml;
  const cancelled = order.status === "cancelled";
  const phone = String(order.phone || "").trim();
  const statusLabel = pageT(lang, STATUS_KEY[order.status] ?? "orders.status.completed");
  return `<article class="management-list__row order-card" data-order-card data-order-id="${e(order.id)}"${phone ? ` data-order-phone="${e(phone)}"` : ""} tabindex="0" role="link" title="${e(order.customer)}">
    <div class="order-card__lead">
      <span class="order-status ${STATUS_CLASS[order.status] ?? "order-status--completed"}" role="img" aria-label="${e(statusLabel)}" title="${e(statusLabel)}">${statusMark(order.status)}</span>
      <div class="order-card__text">
        <div class="order-card__line1">
          <span class="order-card__name" title="${e(order.customer)}">${e(order.customer)}</span>
          ${phone
            ? `<button type="button" class="order-card__phone" data-order-phone-copy="${e(phone)}" title="${e(phoneCopyLabel(phone, lang))}" aria-label="${e(phoneCopyLabel(phone, lang))}">${e(phone)}</button>`
            : `<span class="order-card__phone"></span>`}
          <span class="order-card__channel" title="${e(sourceLabel(order.channel, lang))}">${e(sourceLabel(order.channel, lang))}</span>
        </div>
        <div class="order-card__line2">
          <span class="order-card__product" title="${e(order.product)}">${e(order.product)}</span>
          <span class="order-card__qty">${e(order.qty)}</span>
        </div>
      </div>
    </div>
    <div class="order-card__tail">
      <span class="order-chip" title="${e(order.date)}">${e(order.date)}</span>
      <span class="order-chip order-chip--amount" title="${e(order.amount)}">${e(order.amount)}</span>
      <button type="button" class="order-print${cancelled ? " order-print--disabled" : ""}" data-order-print aria-label="${e(pageT(lang, "orders.print"))}"${cancelled ? " disabled" : ""}>
        ${icon("icon-nav-print", "icon")}
      </button>
    </div>
  </article>`;
}

function renderSourceFilter(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const e = escapeHtml;
  const options = [{ value: "all", label: pageT(lang, "orders.source.all") }]
    .concat(data.sources.map((s) => ({ value: s, label: sourceLabel(s, lang) })));
  const active = state.source !== "all";
  const triggerLabel = active ? sourceLabel(state.source, lang) : pageT(lang, "orders.source");
  const optionsHtml = options.map((o) => {
    const sel = o.value === state.source;
    return `<button type="button" role="option" aria-selected="${sel}" class="dropdown-item${sel ? " dropdown-item--selected" : ""}" data-source-option data-source-value="${e(o.value)}" title="${e(o.label)}">
      <span class="tp-line">${e(o.label)}</span>
    </button>`;
  }).join("");
  return `<span class="orders-source menu-anchor" data-source-menu>
    <button type="button" class="orders-source__trigger${active ? " orders-source__trigger--active" : ""}" data-source-trigger aria-haspopup="listbox" aria-expanded="false" title="${e(triggerLabel)}">
      <span>${e(triggerLabel)}</span>
      ${icon("icon-arrow-down", "icon")}
    </button>
    <div class="menu-popover orders-source__menu" role="listbox" data-source-popover>${optionsHtml}</div>
  </span>`;
}

function renderDomainSegment(helpers) {
  const { escapeHtml, lang } = helpers;
  return renderSharedSegment({
    items: domainTabs.map((tab) => ({ key: tab, label: pageT(lang, `orders.tab.${tab}`) })),
    active: state.tab,
    ariaLabel: pageT(lang, "orders.title"),
    escapeHtml,
    dataAttribute: "data-orders-domain-tab"
  });
}

function renderShippingFilters(helpers) {
  const { escapeHtml, lang } = helpers;
  const counts = aggregateShippingCounts(ordersBeforeShipping());
  return `<div class="orders-shipping-filters" role="group" aria-label="${escapeHtml(pageT(lang, "orders.tab.list"))}">
    ${shippingFilters.map((filter) => `<button type="button" class="orders-shipping-chip orders-shipping-chip--${filter}${state.shipping === filter ? " is-active" : ""}" data-orders-shipping="${filter}" aria-pressed="${state.shipping === filter}">
      <span>${escapeHtml(pageT(lang, `orders.shipping.${filter}`))}</span><strong>${counts[filter]}</strong>
    </button>`).join("")}
  </div>`;
}

function renderOrderSearch(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const label = pageT(lang, "orders.search");
  return `<label class="orders-search">
    ${icon("icon-nav-search", "icon")}
    <input type="search" data-orders-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
  </label>`;
}

function renderOrderList(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const e = escapeHtml;
  const tt = (key) => pageT(lang, key);
  const filtered = filteredOrders();
  const pageSize = currentPageSize();
  const pages = totalPages(filtered, pageSize);
  const shouldPaginate = filtered.length > pageSize;
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const rows = currentPageOrders(filtered, pageSize);
  const listHtml = rows.length
    ? rows.map((order) => renderOrderCard(order, helpers)).join("")
    : `<p class="management-list__empty orders-empty">${e(tt("orders.empty"))}</p>`;
  const pagerHtml = renderManagementPager({
    page: state.page,
    pages,
    visible: shouldPaginate,
    icon,
    escapeHtml,
    previousLabel: tt("orders.prevPage"),
    nextLabel: tt("orders.nextPage")
  });
  return `<div class="orders-list-panel" data-orders-list-panel>
    <div class="orders-toolbar">${dateFilter.render(helpers)}${renderSourceFilter(helpers)}${renderOrderSearch(helpers)}</div>
    ${renderShippingFilters(helpers)}
    ${renderManagementList({ content: listHtml, pager: pagerHtml, paged: shouldPaginate })}
  </div>`;
}

function renderDomainContent(helpers) {
  if (state.tab === "northbound") return renderNorthbound({ ...helpers, liveMode, liveReadOnly });
  if (state.tab === "chargerLeads") return renderChargerLeads(helpers);
  if (state.tab === "revenue" && canViewRevenue) return renderRevenue(helpers);
  return renderOrderList(helpers);
}

export function renderOrders(helpers) {
  currentHelpers = helpers;
  const { escapeHtml, icon, lang } = helpers;
  const e = escapeHtml;
  const tt = (key) => pageT(lang, key);
  return `<div class="orders-page" data-orders-page data-live-read-only="${liveReadOnly}" data-orders-tab="${state.tab}" data-orders-shipping-value="${state.shipping}" data-orders-search-value="${e(state.search)}" data-date-open="${dateFilter.isOpen()}" data-current-page="${state.page}">
    <header class="orders-head">
      <h1 class="orders-title" title="${e(tt("orders.title"))}">${e(tt("orders.title"))}</h1>
      ${state.tab === "list" ? `<button type="button" class="orders-new" data-orders-create data-orders-write${liveReadOnly ? ' disabled aria-disabled="true"' : ""}>
        ${icon("icon-add-line-add", "icon")}
        <span>${e(tt("orders.new"))}</span>
      </button>` : ""}
    </header>
    ${renderDomainSegment(helpers)}
    ${renderDomainContent(helpers)}
  </div>`;
}

function closeSourceMenu() {
  document.querySelectorAll("[data-source-popover]").forEach((pop) => {
    pop.classList.remove("menu-popover--open");
    const trigger = pop.parentElement.querySelector("[data-source-trigger]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function rerenderOrdersPage() {
  const page = document.querySelector("[data-orders-page]");
  if (page && currentHelpers) page.outerHTML = renderOrders(currentHelpers);
  if (ordersLiveRefresh?.pending || northboundLiveRefresh?.pending) {
    queueMicrotask(() => {
      void ordersLiveRefresh?.flush();
      void northboundLiveRefresh?.flush();
    });
  }
}

async function onOrdersClick(event) {
  const domainTab = event.target.closest("[data-orders-domain-tab]");
  if (domainTab) {
    const scope = activeScope;
    const tab = domainTab.getAttribute("data-orders-domain-tab");
    if (!domainTabs.includes(tab) || state.tab === tab) return;
    if (hasNorthboundUnsavedChanges()) {
      const leave = await confirmInPage(pageT(currentHelpers?.lang ?? "zh", "orders.leaveUnsaved"));
      if (!leave) return;
      if (!isCurrentOrdersScope(scope)) return;
      restoreNorthboundState(captureNorthboundState());
    }
    state.tab = tab;
    if (tab === "list") markRead("orders", unreadWatermarks.orders);
    closeSourceMenu();
    dateFilter.close();
    rerenderOrdersPage();
    if (tab === "northbound") await ensureNorthboundData({ scope });
    if (tab === "chargerLeads") await ensureChargerLeadsData({ scope });
    if (tab === "revenue" && canViewRevenue) await ensureRevenueData(data.orders, { scope });
    if (!isCurrentOrdersScope(scope)) return;
    rerenderOrdersPage();
    return;
  }
  if (event.target.closest("[data-orders-create]")) {
    if (liveReadOnly) return;
    navigateTo("./orders-create.html");
    return;
  }

  if (event.target.closest("[data-date-range-filter]")) {
    closeSourceMenu();
    if (dateFilter.handleClick(event)) return;
  }

  const trigger = event.target.closest("[data-source-trigger]");
  if (trigger) {
    const popover = trigger.parentElement.querySelector("[data-source-popover]");
    if (!popover) return;
    const willOpen = !popover.classList.contains("menu-popover--open");
    closeSourceMenu();
    dateFilter.close();
    popover.classList.toggle("menu-popover--open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
    return;
  }

  const option = event.target.closest("[data-source-option]");
  if (option) {
    const value = option.getAttribute("data-source-value");
    closeSourceMenu();
    if (state.source !== value) {
      state.source = value;
      state.page = 1;
      rerenderOrdersPage();
    }
    return;
  }

  const shipping = event.target.closest("[data-orders-shipping]");
  if (shipping) {
    const value = shipping.getAttribute("data-orders-shipping");
    if (shippingFilters.includes(value) && state.shipping !== value) {
      state.shipping = value;
      state.page = 1;
      rerenderOrdersPage();
    }
    return;
  }

  const pageButton = event.target.closest("[data-management-page]");
  if (pageButton && !pageButton.disabled) {
    const direction = pageButton.getAttribute("data-management-page");
    if (direction === "prev" && state.page > 1) state.page -= 1;
    if (direction === "next" && state.page < totalPages()) state.page += 1;
    dateFilter.close();
    rerenderOrdersPage();
    return;
  }

  const phoneButton = event.target.closest("[data-order-phone-copy]");
  if (phoneButton) {
    event.preventDefault();
    event.stopPropagation();
    await copyPhoneNumber(phoneButton.getAttribute("data-order-phone-copy"), currentHelpers.lang, { scope: activeScope });
    return;
  }

  const printBtn = event.target.closest("[data-order-print]");
  if (printBtn && !printBtn.disabled) {
    event.stopPropagation();
    const orderId = printBtn.closest("[data-order-card]")?.getAttribute("data-order-id");
    const order = data.orders.find((item) => item.id === orderId);
    printDialog.open(order ? toPrintableOrder(order) : null, "both", printBtn);
    return;
  }

  const card = event.target.closest("[data-order-card]");
  if (card) {
    navigateTo(`./orders-detail.html?id=${encodeURIComponent(card.getAttribute("data-order-id"))}`);
    return;
  }

  if (!event.target.closest("[data-source-popover]")) closeSourceMenu();
}

async function onOrdersContextMenu(event) {
  const card = event.target.closest("[data-order-card]");
  const phone = card?.getAttribute("data-order-phone")?.trim();
  if (!phone) return;
  event.preventDefault();
  event.stopPropagation();
  await copyPhoneNumber(phone, currentHelpers.lang, { scope: activeScope });
}

function onOrdersInput(event) {
  const search = event.target.closest("[data-orders-search]");
  if (!search) return;
  state.search = search.value;
  state.page = 1;
  rerenderOrdersPage();
  const next = document.querySelector("[data-orders-search]");
  if (next) {
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  }
}

function onOrdersKeydown(event) {
  if (event.key === "Escape") {
    closeSourceMenu();
    dateFilter.close();
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-order-card]")) {
    event.preventDefault();
    const card = event.target.closest("[data-order-card]");
    navigateTo(`./orders-detail.html?id=${encodeURIComponent(card.getAttribute("data-order-id"))}`);
  }
}

function onOrdersResize() {
  window.clearTimeout(resizeTimer);
  const scope = activeScope;
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;
    if (!isCurrentOrdersScope(scope)) return;
    const pages = totalPages();
    if (state.page > pages) state.page = pages;
    rerenderOrdersPage();
  }, 120);
}

function navigateTo(relative) {
  const url = new URL(relative, window.location.href);
  if (typeof activeNavigation?.navigate === "function") void activeNavigation.navigate(url);
  else if (typeof activeNavigation?.hardNavigate === "function") activeNavigation.hardNavigate(url);
  else window.location.assign(url.href);
}

function restoredState(value, presets) {
  const next = value && typeof value === "object" ? value : {};
  const tab = domainTabs.includes(next.tab) ? next.tab : domainTabs.includes(presets.tab) ? presets.tab : "list";
  return {
    tab,
    source: typeof next.source === "string" ? next.source : "all",
    shipping: shippingFilters.includes(next.shipping) ? next.shipping : shippingFilters.includes(presets.shipping) ? presets.shipping : "all",
    search: typeof next.search === "string" ? next.search : presets.search,
    page: Number.isInteger(next.page) && next.page > 0 ? next.page : 1
  };
}

async function ensureActiveDomainData(signal) {
  const scope = activeScope;
  if (state.tab === "northbound") await ensureNorthboundData({ scope, signal });
  if (state.tab === "chargerLeads") await ensureChargerLeadsData({ scope, signal });
  if (state.tab === "revenue" && canViewRevenue) await ensureRevenueData(data.orders, { scope, signal });
  if (!isCurrentOrdersScope(scope)) throw new DOMException("Orders page superseded", "AbortError");
  throwIfPageAborted(signal);
}

export async function mountPage({ scope, signal, historyState = null, navigation = null } = {}) {
  activeScope = scope;
  activeNavigation = navigation;
  const presets = {
    tab: consumeNavigationPreset(navigationPresetKeys.ordersTab),
    shipping: consumeNavigationPreset(navigationPresetKeys.ordersShipping),
    search: consumeNavigationPreset(navigationPresetKeys.ordersSearch) ?? ""
  };
  const [nextData, nextUnreadWatermarks, nextCurrentUser, nextUnread] = await Promise.all([
    getOrdersPageData(), getUnreadWatermarks(), getCurrentUser(), getUnread()
  ]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  unreadWatermarks = nextUnreadWatermarks;
  currentUser = nextCurrentUser;
  unread = nextUnread;
  canViewRevenue = currentUser?.canViewRevenue !== false;
  liveMode = typeof currentUser?.hasPermission === "function";
  liveReadOnly = liveMode && currentUser?.bizflowMainAccess !== true;
  domainTabs = ["list", "northbound", "chargerLeads", ...(canViewRevenue ? ["revenue"] : [])];
  state = restoredState(historyState, presets);
  restoreNorthboundState(historyState?.northbound);
  restoreChargerLeadState(historyState?.chargerLeads);
  restoreRevenueState(historyState?.revenue);
  dateFilter = createDateRangeFilter({
    id: "orders",
    initialDate: latestDateInput(data.orders.map((order) => order.date)),
    onChange({ filterChanged }) {
      if (filterChanged) state.page = 1;
      rerenderOrdersPage();
    }
  });
  dateFilter.restoreState?.(historyState?.dateFilter);
  printDialog = createPrintDialog({ getLang: () => currentHelpers?.lang ?? "zh", scope });
  await ensureActiveDomainData(signal);

  return {
    page: {
      menu: createBizflowMenu("orders"),
      data: { unread, user: currentUser },
      render: renderOrders,
      title: "Honnmono · Orders"
    },
    activate() {
      if (state.tab === "list") markRead("orders", unreadWatermarks.orders);
      scope.listen(document, "click", onOrdersClick);
      scope.listen(document, "contextmenu", onOrdersContextMenu);
      scope.listen(document, "input", onOrdersInput);
      scope.listen(document, "keydown", onOrdersKeydown);
      scope.listen(window, "resize", onOrdersResize);
      northboundLiveRefresh = attachNorthboundBehaviors({ rerender: rerenderOrdersPage, scope });
      attachChargerLeadBehaviors({ rerender: rerenderOrdersPage, scope });
      attachRevenueBehaviors({ rerender: rerenderOrdersPage, scope });
      ordersLiveRefresh = attachLiveSnapshotRefresh({
        scope,
        snapshots: ["orders.json"],
        tables: ["invoices"],
        isBlocked: hasNorthboundRefreshBlock,
        async refresh({ defer, isCurrent }) {
          const nextData = await getOrdersPageData();
          if (!isCurrent()) return;
          if (hasNorthboundRefreshBlock()) {
            defer();
            return;
          }
          data = nextData;
          state.page = Math.min(state.page, totalPages());
          if (state.tab === "revenue" && canViewRevenue) await ensureRevenueData(data.orders, { scope });
          if (!isCurrent()) return;
          rerenderOrdersPage();
        }
      });
    },
    hasUnsavedChanges: hasNorthboundUnsavedChanges,
    async canLeave() {
      if (!hasNorthboundUnsavedChanges()) return true;
      return confirmInPage(pageT(currentHelpers?.lang ?? "zh", "orders.leaveUnsaved"));
    },
    captureState() {
      return {
        ...state,
        dateFilter: dateFilter.captureState?.() ?? null,
        northbound: captureNorthboundState(),
        chargerLeads: captureChargerLeadState(),
        revenue: captureRevenueState()
      };
    },
    dispose() {
      window.clearTimeout(resizeTimer);
      resizeTimer = 0;
      closeSourceMenu();
      dateFilter?.close();
      printDialog?.dispose();
      clearPhoneCopyNotice();
      disposeNorthboundState();
      disposeChargerLeadState();
      disposeRevenueState();
      data = null;
      unreadWatermarks = null;
      unread = null;
      currentUser = null;
      currentHelpers = null;
      printDialog = null;
      dateFilter = null;
      if (activeScope === scope) activeScope = null;
      if (activeNavigation === navigation) activeNavigation = null;
      ordersLiveRefresh = null;
      northboundLiveRefresh = null;
    }
  };
}
