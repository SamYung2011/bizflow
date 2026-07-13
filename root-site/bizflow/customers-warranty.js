import { getWarrantyData } from "../data/provider.js";
import { managementPageSize, renderManagementList, renderManagementPager } from "../components/management-list.js";

const copy = {
  zh: {
    title: "保修提醒",
    all: "全部",
    expired: "已過期",
    week: "一週內",
    month: "30 天內",
    quarter: "90 天內",
    year: "一年內",
    search: "搜尋客戶、電話、產品或單號",
    purchase: "購買日期",
    expiry: "到期日",
    remaining: "剩餘 {days} 天",
    overdue: "已過 {days} 天",
    empty: "暫無符合條件的保修記錄",
    loading: "正在載入保修記錄",
    previous: "上一頁",
    next: "下一頁"
  },
  en: {
    title: "Warranty reminders",
    all: "All",
    expired: "Expired",
    week: "Within 1 week",
    month: "Within 30 days",
    quarter: "Within 90 days",
    year: "Within 1 year",
    search: "Search customer, phone, product or order",
    purchase: "Purchased",
    expiry: "Expires",
    remaining: "{days} days remaining",
    overdue: "{days} days overdue",
    empty: "No warranty records match the filters",
    loading: "Loading warranty records",
    previous: "Previous page",
    next: "Next page"
  },
  fr: {
    title: "Rappels de garantie",
    all: "Tous",
    expired: "Expirées",
    week: "Sous 1 semaine",
    month: "Sous 30 jours",
    quarter: "Sous 90 jours",
    year: "Sous 1 an",
    search: "Rechercher client, téléphone, produit ou commande",
    purchase: "Achat",
    expiry: "Expiration",
    remaining: "{days} jours restants",
    overdue: "Expirée depuis {days} jours",
    empty: "Aucune garantie ne correspond aux filtres",
    loading: "Chargement des garanties",
    previous: "Page précédente",
    next: "Page suivante"
  }
};

const bucketKeys = ["expired", "week", "month", "quarter", "year"];
const state = {
  items: null,
  bucket: "all",
  search: "",
  page: 1
};
let validCustomerIds = new Set();

function t(lang, key, values = {}) {
  const template = copy[lang]?.[key] ?? copy.zh[key] ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
}

function dateValue(value) {
  const [year, month, day] = String(value).split(/[/-]/).map(Number);
  if (![year, month, day].every(Number.isFinite)) return NaN;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : NaN;
}

export function warrantyDaysLeft(expiry, today = new Date()) {
  const target = dateValue(expiry);
  const current = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Number.isFinite(target) ? Math.ceil((target - current) / 86400000) : Number.NaN;
}

export function warrantyBucket(expiry, today = new Date()) {
  const days = warrantyDaysLeft(expiry, today);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return "expired";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  if (days <= 90) return "quarter";
  if (days <= 365) return "year";
  return null;
}

export async function ensureWarrantyData() {
  if (state.items !== null) return;
  const data = await getWarrantyData();
  validCustomerIds = new Set(data.items.map((item) => String(item.customerId)));
  state.items = data.items
    .map((item) => ({
      ...item,
      bucket: warrantyBucket(item.expiry),
      daysLeft: warrantyDaysLeft(item.expiry)
    }))
    .filter((item) => item.bucket !== null && item.daysLeft >= -30 && validCustomerIds.has(String(item.customerId)));
}

function bucketCounts() {
  const counts = Object.fromEntries(bucketKeys.map((key) => [key, 0]));
  for (const item of state.items ?? []) counts[item.bucket] += 1;
  return { all: state.items?.length ?? 0, ...counts };
}

function filteredItems() {
  const term = state.search.trim().toLocaleLowerCase();
  return (state.items ?? []).filter((item) => {
    if (state.bucket !== "all" && item.bucket !== state.bucket) return false;
    if (!term) return true;
    return [item.customer, item.phone, item.product, item.no]
      .some((value) => String(value).toLocaleLowerCase().includes(term));
  });
}

function renderBucketChips(helpers) {
  const { escapeHtml, lang } = helpers;
  const counts = bucketCounts();
  return `<div class="warranty-buckets" role="group" aria-label="${escapeHtml(t(lang, "title"))}">
    ${["all", ...bucketKeys].map((key) => `<button type="button" class="warranty-bucket warranty-bucket--${key}${state.bucket === key ? " is-active" : ""}" data-warranty-bucket="${key}" aria-pressed="${state.bucket === key}">
      <span>${escapeHtml(t(lang, key))}</span><strong>${escapeHtml(String(counts[key]))}</strong>
    </button>`).join("")}
  </div>`;
}

function renderWarrantyRow(item, helpers) {
  const { escapeHtml, lang } = helpers;
  const e = escapeHtml;
  const hasCustomer = Boolean(item.customerId && validCustomerIds.has(String(item.customerId)));
  const tag = hasCustomer ? "a" : "article";
  const link = hasCustomer ? ` href="./customer-detail.html?id=${encodeURIComponent(item.customerId)}"` : ' aria-disabled="true"';
  const timing = item.daysLeft < 0
    ? t(lang, "overdue", { days: Math.abs(item.daysLeft) })
    : t(lang, "remaining", { days: item.daysLeft });
  return `<${tag} class="management-list__row warranty-row warranty-row--${item.bucket}${hasCustomer ? "" : " warranty-row--disabled"}"${link} data-warranty-row data-warranty-bucket-value="${item.bucket}"${item.customerId ? ` data-customer-id="${e(item.customerId)}"` : ""}>
    <span class="warranty-row__bar" aria-hidden="true"></span>
    <span class="warranty-row__customer">
      <strong title="${e(item.customer)}">${e(item.customer)}</strong>
      <span title="${e(item.phone)}">${e(item.phone)}</span>
      <span class="warranty-row__badge">${e(t(lang, item.bucket))}</span>
    </span>
    <span class="warranty-row__product">
      <strong title="${e(item.product)}">${e(item.product)}</strong>
      <span title="${e(item.no)}">${e(item.no)}</span>
      <span>${e(t(lang, "purchase"))} ${e(item.purchaseDate)}</span>
    </span>
    <span class="warranty-row__expiry">
      <span>${e(t(lang, "expiry"))} ${e(item.expiry)}</span>
      <strong>${e(timing)}</strong>
    </span>
  </${tag}>`;
}

export function renderWarranty(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  if (state.items === null) {
    return `<div class="management-list__empty warranty-empty" data-warranty-loading>${escapeHtml(t(lang, "loading"))}</div>`;
  }

  const filtered = filteredItems();
  const pageSize = managementPageSize();
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.page = Math.min(Math.max(state.page, 1), pages);
  const pageItems = filtered.slice((state.page - 1) * pageSize, state.page * pageSize);
  const content = pageItems.length
    ? pageItems.map((item) => renderWarrantyRow(item, helpers)).join("")
    : `<div class="management-list__empty warranty-empty">${escapeHtml(t(lang, "empty"))}</div>`;
  const pager = renderManagementPager({
    page: state.page,
    pages,
    visible: filtered.length > pageSize,
    icon,
    escapeHtml,
    previousLabel: t(lang, "previous"),
    nextLabel: t(lang, "next")
  });
  const counts = bucketCounts();

  return `<section class="warranty-panel" data-warranty-panel data-warranty-total="${counts.all}" data-warranty-filtered="${filtered.length}" ${bucketKeys.map((key) => `data-warranty-count-${key}="${counts[key]}"`).join(" ")}>
    <div class="warranty-toolbar">
      ${renderBucketChips(helpers)}
      <label class="warranty-search">
        ${icon("icon-nav-search", "icon")}
        <input type="search" data-warranty-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}" aria-label="${escapeHtml(t(lang, "search"))}">
      </label>
    </div>
    ${renderManagementList({ content, pager, paged: filtered.length > pageSize })}
  </section>`;
}

export function selectWarrantyBucket(bucket) {
  if (!["all", ...bucketKeys].includes(bucket) || state.bucket === bucket) return false;
  state.bucket = bucket;
  state.page = 1;
  return true;
}

export function setWarrantySearch(value) {
  if (state.search === value) return false;
  state.search = value;
  state.page = 1;
  return true;
}

export function moveWarrantyPage(direction) {
  state.page += direction === "next" ? 1 : -1;
}
