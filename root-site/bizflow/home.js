// Home 桌面屏内容(Figma 模板帧 512:23927 隐藏内容层 Frame 318 实测复刻)
// 演示数据(人名/日期/单号/型号)照 Figma 原样,UI 标签走三语字典。

const dict = {
  zh: {
    "home.stat.orders": "訂單",
    "home.stat.customers": "客戶",
    "home.stat.members": "團隊成員",
    "home.stat.warranty": "保修到期",
    "home.stat.revenue": "本月營收",
    "home.stat.inventory": "庫存數量",
    "home.inventory.summary": "共 {total} 件",
    "home.inventory.low": "⚠ {count} 件低庫存",
    "home.shipping.pending": "待發貨",
    "home.shipping.pendingSub": "已付款待出庫",
    "home.shipping.transit": "運送中",
    "home.shipping.transitSub": "已發貨待簽收",
    "home.shipping.overdue": "超期未簽",
    "home.shipping.overdueSub": "> 14 天未簽收",
    "home.viewAll": "查看全部 →",
    "home.myTasks": "我的任務",
    "home.filter.inProgress": "正在進行",
    "home.filter.completed": "已完成",
    "home.filter.abandoned": "已放棄",
    "home.filter.all": "全部",
    "home.tasks.empty": "暫無任務",
    "home.teamFeed": "團隊動態",
    "home.feed.posted": "發布了新任務",
    "home.feed.commented": "評論了",
    "home.ordersChart": "訂單(柱狀圖)",
    "home.ordersList": "訂單(列表)",
    "home.inventory": "商品庫存",
    "home.members": "團隊成員",
    "home.add": "新增",
    "home.due": "預計完成:",
    "home.dept.design": "設計部",
    "home.dept.tech": "技術部",
    "home.dept.sales": "銷售部",
    "home.dept.finance": "財務部",
    "home.dept.service": "客服部",
    "home.dept.purchase": "採購部",
    "home.warranty.title": "保修到期時間"
  },
  en: {
    "home.stat.orders": "Orders",
    "home.stat.customers": "Customers",
    "home.stat.members": "Team members",
    "home.stat.warranty": "Warranty due",
    "home.stat.revenue": "Monthly revenue",
    "home.stat.inventory": "Inventory",
    "home.inventory.summary": "{total} items total",
    "home.inventory.low": "⚠ {count} low-stock items",
    "home.shipping.pending": "Pending shipment",
    "home.shipping.pendingSub": "Paid, awaiting dispatch",
    "home.shipping.transit": "In transit",
    "home.shipping.transitSub": "Shipped, awaiting delivery",
    "home.shipping.overdue": "Overdue unsigned",
    "home.shipping.overdueSub": "Unsigned for > 14 days",
    "home.viewAll": "View all →",
    "home.myTasks": "My tasks",
    "home.filter.inProgress": "In progress",
    "home.filter.completed": "Completed",
    "home.filter.abandoned": "Abandoned",
    "home.filter.all": "All",
    "home.tasks.empty": "No tasks",
    "home.teamFeed": "Team activity",
    "home.feed.posted": "posted a new task",
    "home.feed.commented": "commented on",
    "home.ordersChart": "Orders (chart)",
    "home.ordersList": "Orders (list)",
    "home.inventory": "Inventory",
    "home.members": "Team members",
    "home.add": "Add",
    "home.due": "Due:",
    "home.dept.design": "Design",
    "home.dept.tech": "Tech",
    "home.dept.sales": "Sales",
    "home.dept.finance": "Finance",
    "home.dept.service": "Support",
    "home.dept.purchase": "Purchasing",
    "home.warranty.title": "Warranty expiry"
  },
  fr: {
    "home.stat.orders": "Commandes",
    "home.stat.customers": "Clients",
    "home.stat.members": "Membres",
    "home.stat.warranty": "Garanties à échéance",
    "home.stat.revenue": "CA du mois",
    "home.stat.inventory": "Stock",
    "home.inventory.summary": "{total} articles au total",
    "home.inventory.low": "⚠ {count} articles en stock faible",
    "home.shipping.pending": "À expédier",
    "home.shipping.pendingSub": "Payées, en attente d'expédition",
    "home.shipping.transit": "En transit",
    "home.shipping.transitSub": "Expédiées, en attente de livraison",
    "home.shipping.overdue": "Signature en retard",
    "home.shipping.overdueSub": "Sans signature depuis > 14 jours",
    "home.viewAll": "Tout voir →",
    "home.myTasks": "Mes tâches",
    "home.filter.inProgress": "En cours",
    "home.filter.completed": "Terminées",
    "home.filter.abandoned": "Abandonnées",
    "home.filter.all": "Toutes",
    "home.tasks.empty": "Aucune tâche",
    "home.teamFeed": "Activité de l'équipe",
    "home.feed.posted": "a publié une nouvelle tâche",
    "home.feed.commented": "a commenté",
    "home.ordersChart": "Commandes (graphique)",
    "home.ordersList": "Commandes (liste)",
    "home.inventory": "Stock produits",
    "home.members": "Membres de l'équipe",
    "home.add": "Ajouter",
    "home.due": "Échéance :",
    "home.dept.design": "Design",
    "home.dept.tech": "Technique",
    "home.dept.sales": "Ventes",
    "home.dept.finance": "Finance",
    "home.dept.service": "Service client",
    "home.dept.purchase": "Achats",
    "home.warranty.title": "Échéances de garantie"
  }
};

import { getCustomersPageData, getHomeData, getCurrentUser, getHomeOrderMetricRows, getInventoryMetricProducts, getUnread, getUnreadWatermarks, getWarrantyData } from "../data/provider.js";
import { markRead } from "../data/read-state.js";
import { renderBarChart } from "../components/bar-chart.js";
import { aggregateInventoryStock, aggregateRevenue, aggregateShippingCounts } from "../components/order-metrics.js";
import { navigationPresetKeys, setNavigationPreset } from "../components/navigation-presets.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { availableQuickCreateActions } from "../components/quick-create.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

let data = null;
let revenueMetrics = null;
let shippingMetrics = null;
let inventoryMetrics = null;
let showRevenue = true;
let homeCurrentUser = null;
let homeTaskFilter = "inProgress";
let homeTaskFilterOpen = false;
let homeHelpers = null;
let activeScope = null;

const HOME_TASK_FILTERS = ["inProgress", "completed", "abandoned", "all"];

const STAT_TONE_CLASS = { "": "", blue: "board-card--blue", green: "board-card--green", yellow: "board-card--yellow" };

export function renderHome({ icon, escapeHtml, lang }) {
  homeHelpers = { icon, escapeHtml, lang };
  const th = (key) => dict[lang]?.[key] ?? dict.zh[key] ?? key;
  const thOpt = (key) => dict[lang]?.[key] ?? dict.zh[key] ?? null; // 缺词条=不渲染,禁露 key
  const e = escapeHtml;
  const replace = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);
  const money = (value) => `HKD$ ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
  const month = new Intl.DateTimeFormat(lang === "zh" ? "zh-HK" : lang, { year: "numeric", month: "2-digit", timeZone: "Asia/Hong_Kong" }).format(new Date());

  const statCard = ({ mod = "", titleKey, value, withIcon = false, href, preset, sub = "", warning = "" }) => `
    <a class="tp-component board-card home-stat-card${sub || warning ? " home-stat-card--detailed" : ""} ${mod}" href="${e(href)}"${preset ? ` data-home-preset="${e(preset)}"` : ""}>
      <div><span class="tp-title" title="${e(th(titleKey))}">${e(th(titleKey))}</span></div>
      ${withIcon ? icon("icon-task-alert", "icon icon-task") : ""}
      <span class="tp-number">${e(value)}</span>
      ${sub || warning ? `<span class="home-stat-card__sub"><span>${e(sub)}</span>${warning ? `<strong>${e(warning)}</strong>` : ""}</span>` : ""}
    </a>`;

  const logisticsCard = ({ filter, titleKey, value, subKey, tone }) => `<a class="home-logistics-card home-logistics-card--${tone}" href="./orders.html" data-home-shipping="${filter}">
    <span>${e(th(titleKey))}</span><strong>${e(value)}</strong><small>${e(th(subKey))}</small>
  </a>`;

  const taskItem = ({ title, due, count }) => `
    <article class="tp-component task-item">
      <div style="min-width:0;flex:1">
        <span class="tp-title" title="${e(title)}">${e(title)}</span>
        <span class="tp-muted">${e(th("home.due"))} ${e(due)}</span>
      </div>
      ${count > 0 ? `<span class="tp-pill tp-pill--red">${count}</span>` : ""}
    </article>`;

  const filteredTasks = (data.tasks ?? [])
    .filter((task) => homeTaskFilter === "all" || (task.status ?? "inProgress") === homeTaskFilter)
    .slice(0, 4);
  const taskFilterOptions = HOME_TASK_FILTERS.map((key) => `<button type="button" class="dropdown-item${homeTaskFilter === key ? " dropdown-item--selected" : ""}" role="option" aria-selected="${homeTaskFilter === key}" data-home-task-filter-option="${key}">${e(th(`home.filter.${key}`))}</button>`).join("");
  const hasQuickCreate = availableQuickCreateActions(homeCurrentUser).length > 0;

  const feedRow = ({ name, action, title, date, time, avatar }) => `
    <div class="home-feed-row">
      ${avatar === "initial"
        ? `<span class="avatar--initial" style="--component-width:40px;--component-height:40px">V</span>`
        : `<span class="tp-component avatar avatar--image" style="--component-width:40px;--component-height:40px"></span>`}
      <div class="home-feed-row__body">
        <div class="home-feed-row__line">
          <span class="home-feed-name">${e(name)}</span>
          <span class="home-feed-action">${e(th(action === "posted" ? "home.feed.posted" : "home.feed.commented"))}</span>
        </div>
        <span class="home-feed-row__sub" title="${e(title)}">${e(title)}</span>
      </div>
      <span class="home-feed-row__time"><span>${e(date)}</span><span>${e(time)}</span></span>
    </div>`;

  const orderRow = ({ no, product, customer, phone, date, time }) => `
    <div class="home-line-row">
      <div class="home-line-row__body">
        <div class="home-line-row__tag-line">
          <span>${e(no)}</span>
          <span class="home-chip" title="${e(product)}">${e(product)}</span>
        </div>
        <span class="home-line-row__sub"><span>${e(customer)}</span><span>${e(phone)}</span></span>
      </div>
      <span class="home-line-row__meta"><span>${e(date)}</span><span>${e(time)}</span></span>
    </div>`;

  const stockRow = (item) => { const { product, itemsId, count } = item; return `
    <div class="home-line-row">
      <span class="home-thumb" aria-hidden="true">${item.image ? `<img src="${e(item.image)}" alt="" loading="eager" decoding="sync" fetchpriority="high" referrerpolicy="no-referrer">` : ""}</span>
      <div class="home-line-row__body">
        <span class="home-line-row__tag-line"><span class="home-chip" title="${e(product)}">${e(product)}</span></span>
        <span class="home-line-row__sub">${e(itemsId)}</span>
      </div>
      <span class="home-line-row__count">${e(count)}</span>
    </div>`; };

  const memberCell = (m) => `
    <div class="home-member">
      <span class="tp-component avatar avatar--image" style="--component-width:40px;--component-height:40px"></span>
      <div class="home-member__body">
        <span class="home-member__name" title="${e(m.name)}">${e(m.name)}</span>
        ${thOpt(`home.dept.${m.dept}`) ? `<span class="home-chip home-chip--dept home-chip--dept-${e(m.dept)}">${e(thOpt(`home.dept.${m.dept}`))}</span>` : ""}
      </div>
    </div>`;

  return `<div class="home-page" data-home-monthly-revenue="${showRevenue ? (revenueMetrics?.totalRevenue ?? "") : ""}" data-home-inventory-carriers="${inventoryMetrics?.carrierCount ?? ""}" data-home-inventory-active="${inventoryMetrics?.activeSkuCount ?? ""}" data-home-inventory-total="${inventoryMetrics?.totalQuantity ?? ""}" data-home-inventory-low="${inventoryMetrics?.lowStockCount ?? ""}" data-home-shipping-pending="${shippingMetrics?.pending ?? ""}" data-home-shipping-transit="${shippingMetrics?.in_transit ?? ""}" data-home-shipping-overdue="${shippingMetrics?.exception ?? ""}">
    <header class="home-head">
      <h1 class="home-title">HONNMONO</h1>
    </header>

    <section class="home-stats">
      ${showRevenue ? statCard({ titleKey: "home.stat.revenue", value: revenueMetrics ? money(revenueMetrics.totalRevenue) : "—", href: "./orders.html", preset: "orders-revenue", sub: month }) : ""}
      ${statCard({ titleKey: "home.stat.inventory", value: inventoryMetrics ? String(inventoryMetrics.activeSkuCount) : "—", href: "./inventory.html", sub: inventoryMetrics ? replace(th("home.inventory.summary"), { total: inventoryMetrics.totalQuantity }) : "", warning: inventoryMetrics?.lowStockCount ? replace(th("home.inventory.low"), { count: inventoryMetrics.lowStockCount }) : "" })}
      ${data.stats.map((s) => statCard({
        mod: STAT_TONE_CLASS[s.tone] ?? "",
        titleKey: `home.stat.${s.key === "customers" ? "customers" : s.key}`,
        value: String(s.value),
        withIcon: Boolean(s.alert),
        href: s.key === "orders" ? "./orders.html" : s.key === "customers" ? "./customers.html" : s.key === "members" ? "../team/members.html" : "./customers.html",
        preset: s.key === "warranty" ? "customers-warranty" : ""
      })).join("")}
    </section>

    <section class="home-logistics" aria-label="${e(th("home.shipping.pending"))}">
      ${logisticsCard({ filter: "pending", titleKey: "home.shipping.pending", value: shippingMetrics ? String(shippingMetrics.pending) : "—", subKey: "home.shipping.pendingSub", tone: "pending" })}
      ${logisticsCard({ filter: "in_transit", titleKey: "home.shipping.transit", value: shippingMetrics ? String(shippingMetrics.in_transit) : "—", subKey: "home.shipping.transitSub", tone: "transit" })}
      ${logisticsCard({ filter: "exception", titleKey: "home.shipping.overdue", value: shippingMetrics ? String(shippingMetrics.exception) : "—", subKey: "home.shipping.overdueSub", tone: "overdue" })}
    </section>

    <div class="home-grid">
      <section class="home-card">
        <div class="home-card__head">
          <h2 class="home-card__title">${e(th("home.myTasks"))}</h2>
          <span class="menu-anchor home-task-filter" data-home-task-filter>
            <button type="button" class="tp-component select" style="--component-width:130px;--component-height:40px" data-home-task-filter-trigger aria-haspopup="listbox" aria-expanded="${homeTaskFilterOpen}">
              <span class="tp-line">${e(th(`home.filter.${homeTaskFilter}`))}</span>
              ${icon("icon-arrow-down", "icon icon--sm")}
            </button>
            <div class="tp-component menu-popover menu-popover--start home-task-filter__menu${homeTaskFilterOpen ? " menu-popover--open" : ""}" data-home-task-filter-menu role="listbox">${taskFilterOptions}</div>
          </span>
        </div>
        <div class="home-card__list">${filteredTasks.length ? filteredTasks.map(taskItem).join("") : `<div class="tp-muted">${e(th("home.tasks.empty"))}</div>`}</div>
      </section>

      <section class="home-card" id="team-activity" data-home-team-activity>
        <div class="home-card__head">
          <h2 class="home-card__title">${e(th("home.teamFeed"))}</h2>
          ${data.unread.messages > 0 ? `<span class="home-badge">${data.unread.messages}</span>` : ""}
        </div>
        <div class="home-card__list">${data.feed.map(feedRow).join("")}</div>
      </section>

      <section class="home-card">
        <h2 class="home-card__title">${e(th("home.ordersChart"))}</h2>
        <div class="home-chart">${renderBarChart({
          items: data.chart.map((item) => typeof item === "number" ? { label: "", value: item } : item),
          maxHeight: 161,
          escapeHtml: e,
          columnClass: "home-chart__col",
          valueClass: "home-chart__value",
          barClass: "home-chart__bar",
          labelClass: "home-chart__label"
        })}</div>
      </section>

      <section class="home-card">
        <div class="home-card__head"><h2 class="home-card__title">${e(th("home.ordersList"))}</h2><a class="home-card__link" href="./orders.html">${e(th("home.viewAll"))}</a></div>
        <div>${data.orders.map(orderRow).join("")}</div>
      </section>

      <section class="home-card">
        <h2 class="home-card__title">${e(th("home.inventory"))}</h2>
        <div style="margin-top:var(--space-20)">${data.stock.map(stockRow).join("")}</div>
      </section>

      <section class="home-card home-card--members" data-home-members tabindex="0" role="link">
        <div class="home-card__head">
          <h2 class="home-card__title">${e(th("home.members"))}</h2>
          <span class="home-card__count">${data.members.length}</span>
        </div>
        <div class="home-members-grid">${data.members.slice(0, 12).map(memberCell).join("")}</div>
      </section>

      ${(data.warrantyItems ?? []).length ? `<section class="home-card">
        <h2 class="home-card__title home-card__title--warranty">${e(th("home.warranty.title"))}</h2>
        <div style="margin-top:var(--space-20)">${data.warrantyItems.map(({ no, product, customer, phone, date }) => `
          <div class="home-line-row home-line-row--link" data-home-warranty-search="${e(customer)}" tabindex="0" role="link">
            <div class="home-line-row__body">
              <div class="home-line-row__tag-line"><span>${e(no)}</span><span class="home-chip" title="${e(product)}">${e(product)}</span></div>
              <span class="home-line-row__sub"><span>${e(customer)}</span><span>${e(phone)}</span></span>
            </div>
            <span class="home-line-row__meta"><span>${e(date)}</span></span>
          </div>`).join("")}</div>
      </section>` : ""}
      ${hasQuickCreate ? `<button type="button" class="home-card home-add-card" data-quick-create-open aria-haspopup="menu" aria-expanded="false" aria-label="${e(th("home.add"))}">
        ${icon("icon-add-surface-add")}
      </button>` : ""}
    </div>
    ${hasQuickCreate ? `<button type="button" class="tp-component fab home-fab" data-quick-create-open aria-haspopup="menu" aria-expanded="false" style="--component-width:40px;--component-height:40px" aria-label="${e(th("home.add"))}" title="${e(th("home.add"))}">
      ${icon("icon-add-line-add", "icon")}
    </button>` : ""}
  </div>`;
}

function rerenderHome({ focusTaskFilter = false } = {}) {
  const page = document.querySelector(".home-page");
  if (!page || !homeHelpers) return;
  page.outerHTML = renderHome(homeHelpers);
  if (focusTaskFilter) document.querySelector("[data-home-task-filter-trigger]")?.focus();
}

function onHomeClick(event) {
  const taskFilterTrigger = event.target.closest("[data-home-task-filter-trigger]");
  if (taskFilterTrigger) {
    homeTaskFilterOpen = !homeTaskFilterOpen;
    rerenderHome();
    if (homeTaskFilterOpen) activeScope?.animationFrame(() => document.querySelector(`[data-home-task-filter-option="${CSS.escape(homeTaskFilter)}"]`)?.focus());
    return;
  }
  const taskFilterOption = event.target.closest("[data-home-task-filter-option]");
  if (taskFilterOption) {
    const nextFilter = taskFilterOption.getAttribute("data-home-task-filter-option");
    if (HOME_TASK_FILTERS.includes(nextFilter)) homeTaskFilter = nextFilter;
    homeTaskFilterOpen = false;
    rerenderHome({ focusTaskFilter: true });
    return;
  }
  const preset = event.target.closest("[data-home-preset]")?.getAttribute("data-home-preset");
  if (preset === "orders-revenue") setNavigationPreset(navigationPresetKeys.ordersTab, "revenue");
  if (preset === "customers-warranty") setNavigationPreset(navigationPresetKeys.customersTab, "warranty");

  const shipping = event.target.closest("[data-home-shipping]")?.getAttribute("data-home-shipping");
  if (shipping) setNavigationPreset(navigationPresetKeys.ordersShipping, shipping);

  const warranty = event.target.closest("[data-home-warranty-search]");
  if (warranty) {
    setNavigationPreset(navigationPresetKeys.customersTab, "warranty");
    setNavigationPreset(navigationPresetKeys.warrantySearch, warranty.getAttribute("data-home-warranty-search"));
    window.location.href = "./customers.html";
    return;
  }

  if (event.target.closest("[data-home-members]")) window.location.href = "../team/members.html";
  if (homeTaskFilterOpen && !event.target.closest("[data-home-task-filter]")) {
    homeTaskFilterOpen = false;
    rerenderHome();
  }
}

function onHomeKeydown(event) {
  if (event.key === "Escape" && homeTaskFilterOpen) {
    event.preventDefault();
    homeTaskFilterOpen = false;
    rerenderHome({ focusTaskFilter: true });
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-home-members]")) {
    event.preventDefault();
    window.location.href = "../team/members.html";
  }
}

export async function mountPage({ scope, signal, historyState = null }) {
  activeScope = scope;
  // 数据全走接口层(煊煊 2026-07-08:不写死样板,留好数据接口)
  const [homeData, orderMetricRows, inventoryMetricProducts, warrantyData, customerData, currentUser, unread, unreadWatermarks] = await Promise.all([
    getHomeData(),
    getHomeOrderMetricRows(),
    getInventoryMetricProducts(),
    getWarrantyData(),
    getCustomersPageData(),
    getCurrentUser(),
    getUnread(),
    getUnreadWatermarks()
  ]);
  throwIfPageAborted(signal, scope);
  data = {
    ...homeData,
    unread: { ...(homeData.unread ?? {}), ...unread },
    stats: homeData.stats.map((stat) => {
      if (stat.key === "warranty") return { ...stat, value: warrantyData.items.length, alert: warrantyData.items.length > 0 };
      if (stat.key === "customers") return { ...stat, value: customerData.dashboardCustomerCount };
      return stat;
    }),
    warrantyItems: warrantyData.items.slice(0, 4).map((item) => ({
      no: item.no,
      product: item.product,
      customer: item.customer,
      phone: item.phone,
      date: item.expiry
    }))
  };
  revenueMetrics = orderMetricRows
    ? aggregateRevenue(orderMetricRows, { aliases: [], customers: [], products: [] }, "thisMonth")
    : null;
  shippingMetrics = orderMetricRows ? aggregateShippingCounts(orderMetricRows) : null;
  inventoryMetrics = inventoryMetricProducts ? aggregateInventoryStock(inventoryMetricProducts) : null;
  showRevenue = currentUser?.canViewRevenue !== false;
  homeCurrentUser = currentUser;
  homeTaskFilter = HOME_TASK_FILTERS.includes(historyState?.taskFilter) ? historyState.taskFilter : "inProgress";
  homeTaskFilterOpen = false;

  data.stock.map((item) => item.image).filter(Boolean).forEach((src) => {
    const image = new Image();
    image.decoding = "sync";
    image.loading = "eager";
    image.src = src;
  });

  return {
    page: {
      menu: createBizflowMenu("home"),
      data: { unread, user: currentUser },
      render: renderHome,
      title: "任務平台 Home Desktop"
    },
    activate() {
      scope.listen(document, "click", onHomeClick);
      scope.listen(document, "keydown", onHomeKeydown);
      let cardVisible = false;
      let marked = false;
      let observer = null;
      const syncMessageRead = () => {
        if (marked || !cardVisible || document.visibilityState === "hidden" || (data?.unread?.messages ?? 0) <= 0) return;
        marked = true;
        markRead("messages", unreadWatermarks.messages);
        if (data?.unread) data.unread.messages = 0;
        document.querySelector("[data-home-team-activity] .home-badge")?.remove();
        observer?.disconnect();
      };
      scope.animationFrame(() => {
        const card = document.querySelector("[data-home-team-activity]");
        if (!card) return;
        // Router restores its scroll position after activate(); one extra frame
        // keeps the hash target authoritative for this explicit notification jump.
        if (window.location.hash === "#team-activity") {
          scope.animationFrame(() => card.scrollIntoView({ block: "center" }));
        }
        if ((data?.unread?.messages ?? 0) <= 0) return;
        if (typeof IntersectionObserver !== "function") {
          cardVisible = true;
          syncMessageRead();
          return;
        }
        observer = scope.track(new IntersectionObserver((entries) => {
          const entry = entries.find((item) => item.target === card);
          cardVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
          syncMessageRead();
        }, { threshold: [0, 0.5] }));
        observer.observe(card);
      });
      scope.listen(document, "visibilitychange", syncMessageRead);
    },
    captureState: () => ({ taskFilter: homeTaskFilter }),
    dispose() {
      data = null;
      revenueMetrics = null;
      shippingMetrics = null;
      inventoryMetrics = null;
      homeCurrentUser = null;
      homeHelpers = null;
      homeTaskFilterOpen = false;
      if (activeScope === scope) activeScope = null;
    }
  };
}
