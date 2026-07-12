import { getOrderRevenueSupportData } from "../data/provider.js";
import { renderBarChart } from "../components/bar-chart.js";
import { aggregateRevenue } from "../components/order-metrics.js";

export { aggregateRevenue } from "../components/order-metrics.js";

const ranges = ["thisMonth", "lastMonth", "3m", "12m", "year", "all"];
const pieColors = [
  "var(--revenue-chart-1)", "var(--revenue-chart-2)", "var(--revenue-chart-3)",
  "var(--revenue-chart-4)", "var(--revenue-chart-5)", "var(--revenue-chart-6)", "var(--revenue-chart-7)"
];

const copy = {
  zh: {
    title: "營收分析",
    description: "僅統計已付款發票",
    thisMonth: "本月",
    lastMonth: "上月",
    "3m": "近 3 月",
    "12m": "近 12 月",
    year: "本年度",
    all: "全部",
    totalRevenue: "總營收",
    paidCount: "已付發票數",
    average: "平均單據",
    unpaid: "未付款",
    monthly: "月度營收趨勢",
    share: "產品銷售佔比",
    other: "其他",
    products: "熱銷產品 Top 10",
    customers: "大客戶 Top 10",
    empty: "沒有數據"
  },
  en: {
    title: "Revenue analysis",
    description: "Paid invoices only",
    thisMonth: "This month",
    lastMonth: "Last month",
    "3m": "Last 3 months",
    "12m": "Last 12 months",
    year: "This year",
    all: "All time",
    totalRevenue: "Total revenue",
    paidCount: "Paid invoices",
    average: "Average invoice",
    unpaid: "Unpaid",
    monthly: "Monthly revenue trend",
    share: "Product sales share",
    other: "Other",
    products: "Top 10 products",
    customers: "Top 10 customers",
    empty: "No data"
  },
  fr: {
    title: "Analyse du chiffre d'affaires",
    description: "Factures payées uniquement",
    thisMonth: "Ce mois-ci",
    lastMonth: "Mois dernier",
    "3m": "3 derniers mois",
    "12m": "12 derniers mois",
    year: "Cette année",
    all: "Toutes les dates",
    totalRevenue: "Chiffre d'affaires",
    paidCount: "Factures payées",
    average: "Facture moyenne",
    unpaid: "Impayé",
    monthly: "Tendance mensuelle",
    share: "Répartition des ventes",
    other: "Autres",
    products: "Top 10 produits",
    customers: "Top 10 clients",
    empty: "Aucune donnée"
  }
};

const state = { loaded: false, loading: false, orders: [], support: { aliases: [], customers: [], products: [] }, range: "12m" };
let rerender = () => {};
let attached = false;

function t(lang, key) {
  return copy[lang]?.[key] ?? copy.zh[key] ?? key;
}

function money(value) {
  return `HKD$ ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
}

function compact(value) {
  return value >= 1000000 ? `${(value / 1000000).toFixed(1)}m` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
}

function renderPie(products, helpers) {
  const { escapeHtml, lang } = helpers;
  const top = products.slice(0, 6);
  const other = products.slice(6).reduce((sum, item) => sum + item.amount, 0);
  const items = [...top, ...(other > 0 ? [{ name: t(lang, "other"), amount: other }] : [])];
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (!total) return `<div class="orders-domain-empty">${escapeHtml(t(lang, "empty"))}</div>`;
  let offset = -Math.PI / 2;
  const paths = items.map((item, index) => {
    if (items.length === 1) return `<circle cx="50" cy="50" r="40" fill="${pieColors[index]}"/>`;
    const angle = item.amount / total * Math.PI * 2;
    const x1 = 50 + 40 * Math.cos(offset);
    const y1 = 50 + 40 * Math.sin(offset);
    offset += angle;
    const x2 = 50 + 40 * Math.cos(offset);
    const y2 = 50 + 40 * Math.sin(offset);
    return `<path d="M 50 50 L ${x1} ${y1} A 40 40 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z" fill="${pieColors[index]}" stroke="var(--white)" stroke-width="0.6"/>`;
  }).join("");
  return `<div class="revenue-pie-layout">
    <svg class="revenue-pie" viewBox="0 0 100 100" role="img">${paths}</svg>
    <div class="revenue-pie-legend">${items.map((item, index) => `<div><span class="revenue-pie-swatch" style="background:${pieColors[index]}"></span><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><strong>${Math.round(item.amount / total * 100)}%</strong><small>${escapeHtml(money(item.amount))}</small></div>`).join("")}</div>
  </div>`;
}

function renderRanking(items, helpers, valueKey, tone) {
  const { escapeHtml, lang } = helpers;
  if (!items.length) return `<div class="orders-domain-empty">${escapeHtml(t(lang, "empty"))}</div>`;
  const max = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  return `<div class="revenue-ranking">${items.map((item) => {
    const value = Number(item[valueKey]) || 0;
    return `<div class="revenue-ranking__row"><div><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><strong>${escapeHtml(money(value))}</strong></div><span class="revenue-ranking__track"><span class="revenue-ranking__bar revenue-ranking__bar--${tone}" style="width:${value / max * 100}%"></span></span></div>`;
  }).join("")}</div>`;
}

export async function ensureRevenueData(orders) {
  state.orders = orders;
  if (state.loaded || state.loading) return;
  state.loading = true;
  rerender();
  state.support = await getOrderRevenueSupportData();
  state.loading = false;
  state.loaded = true;
}

export function renderRevenue(helpers) {
  const { escapeHtml, lang } = helpers;
  const data = aggregateRevenue(state.orders, state.support, state.range);
  const productTop = data.products.slice(0, 10);
  // 权限由 orders.js 的 tab 与视图双重门控，该渲染器不单独暴露入口。
  return `<section class="orders-domain-panel revenue-page" data-revenue-page data-range="${state.range}">
    <header class="orders-domain-panel__head"><div><h2>${escapeHtml(t(lang, "title"))}</h2><p>${escapeHtml(t(lang, "description"))}</p></div></header>
    <div class="revenue-range-chips">${ranges.map((range) => `<button type="button" class="revenue-range-chip${state.range === range ? " is-active" : ""}" data-revenue-range="${range}">${escapeHtml(t(lang, range))}</button>`).join("")}</div>
    <div class="revenue-kpis">
      <article><span>${escapeHtml(t(lang, "totalRevenue"))}</span><strong data-revenue-kpi="total">${escapeHtml(money(data.totalRevenue))}</strong></article>
      <article><span>${escapeHtml(t(lang, "paidCount"))}</span><strong data-revenue-kpi="paid">${data.paidCount}</strong></article>
      <article><span>${escapeHtml(t(lang, "average"))}</span><strong data-revenue-kpi="average">${escapeHtml(money(data.average))}</strong></article>
      <article><span>${escapeHtml(t(lang, "unpaid"))}</span><strong data-revenue-kpi="unpaid">${data.unpaidCount}</strong><small>${escapeHtml(money(data.unpaidAmount))}</small></article>
    </div>
    <article class="revenue-card revenue-chart-card">
      <h3>${escapeHtml(t(lang, data.singleMonth ? "share" : "monthly"))}</h3>
      ${data.singleMonth ? renderPie(data.products, helpers) : `<div class="revenue-month-chart">${renderBarChart({
        items: data.months,
        maxHeight: 180,
        escapeHtml,
        columnClass: "revenue-month-chart__col",
        valueClass: "revenue-month-chart__value",
        barClass: "revenue-month-chart__bar",
        labelClass: "revenue-month-chart__label",
        formatValue: compact,
        formatTitle: ({ label, value }) => `${label}: ${money(value)}`
      })}</div>`}
    </article>
    <div class="revenue-rankings">
      <article class="revenue-card"><h3>${escapeHtml(t(lang, "products"))}</h3>${renderRanking(productTop, helpers, "amount", "product")}</article>
      <article class="revenue-card"><h3>${escapeHtml(t(lang, "customers"))}</h3>${renderRanking(data.customers, helpers, "totalAmount", "customer")}</article>
    </div>
  </section>`;
}

export function attachRevenueBehaviors({ rerender: nextRerender }) {
  rerender = nextRerender;
  if (attached) return;
  attached = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-revenue-range]");
    if (!button) return;
    const range = button.getAttribute("data-revenue-range");
    if (!ranges.includes(range)) return;
    state.range = range;
    rerender();
  });
}
