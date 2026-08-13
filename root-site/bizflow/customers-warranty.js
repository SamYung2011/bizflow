import { getWarrantyData } from "../data/provider.js";
import { managementPageSize, renderManagementList, renderManagementPager } from "../components/management-list.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import { clearPhoneCopyNotice, phoneCopyLabel } from "../components/phone-copy.js";
import { matchesSearchValues } from "../components/search-match.js";
import { renewLiveWarranty } from "../data/live-warranty-writes.js";

const copy = {
  zh: {
    title: "保修提醒",
    all: "全部",
    expired: "已過期",
    week: "一週內",
    month: "30 天內",
    quarter: "90 天內",
    year: "一年內",
    count: "共 {count} 件需跟進",
    search: "搜尋客戶、電話、產品或單號",
    purchaseRange: "購買日期",
    dateRange: "購買日期範圍",
    startDate: "開始日期",
    endDate: "結束日期",
    today: "今天",
    previousMonth: "上個月",
    nextMonth: "下個月",
    calendarYear: "年份",
    chooseMonth: "選擇年月",
    clear: "清除",
    cancel: "取消",
    complete: "完成",
    purchase: "購買日期",
    expiry: "到期日",
    remaining: "剩餘 {days} 天",
    overdue: "已過 {days} 天",
    empty: "暫無符合條件的保修記錄",
    loading: "正在載入保修記錄",
    previous: "上一頁",
    next: "下一頁",
    renew: "續保",
    renewed: "已續保",
    renewalBadge: "{months} 個月 · 繳費 {date}",
    renewalTitle: "保修續保",
    renewalTerm: "續保期限",
    oneYear: "一年",
    twoYears: "兩年",
    renewalPaidAt: "保修繳費日期",
    renewalSelectDate: "選擇日期",
    renewalSubmit: "確認續保",
    renewalSaving: "續保中…",
    renewalSuccess: "保修已續期至 {date}",
    renewalFailed: "續保失敗，請稍後再試",
    renewalDateRequired: "請選擇有效的保修繳費日期",
    renewalDateBeforeSale: "保修繳費日期不可早於購買日期",
    close: "關閉"
  },
  en: {
    title: "Warranty reminders",
    all: "All",
    expired: "Expired",
    week: "Within 1 week",
    month: "Within 30 days",
    quarter: "Within 90 days",
    year: "Within 1 year",
    count: "{count} items need follow-up",
    search: "Search customer, phone, product or order",
    purchaseRange: "Purchase date",
    dateRange: "Purchase date range",
    startDate: "Start date",
    endDate: "End date",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    calendarYear: "Year",
    chooseMonth: "Choose year and month",
    clear: "Clear",
    cancel: "Cancel",
    complete: "Done",
    purchase: "Purchased",
    expiry: "Expires",
    remaining: "{days} days remaining",
    overdue: "{days} days overdue",
    empty: "No warranty records match the filters",
    loading: "Loading warranty records",
    previous: "Previous page",
    next: "Next page",
    renew: "Renew",
    renewed: "Renewed",
    renewalBadge: "{months} months · paid {date}",
    renewalTitle: "Renew warranty",
    renewalTerm: "Renewal term",
    oneYear: "One year",
    twoYears: "Two years",
    renewalPaidAt: "Warranty payment date",
    renewalSelectDate: "Choose date",
    renewalSubmit: "Confirm renewal",
    renewalSaving: "Renewing…",
    renewalSuccess: "Warranty renewed through {date}",
    renewalFailed: "Could not renew the warranty. Please try again.",
    renewalDateRequired: "Choose a valid warranty payment date",
    renewalDateBeforeSale: "The warranty payment date cannot be before the purchase date",
    close: "Close"
  },
  fr: {
    title: "Rappels de garantie",
    all: "Tous",
    expired: "Expirées",
    week: "Sous 1 semaine",
    month: "Sous 30 jours",
    quarter: "Sous 90 jours",
    year: "Sous 1 an",
    count: "{count} éléments à suivre",
    search: "Rechercher client, téléphone, produit ou commande",
    purchaseRange: "Date d'achat",
    dateRange: "Plage de dates d'achat",
    startDate: "Date de début",
    endDate: "Date de fin",
    today: "Aujourd'hui",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    calendarYear: "Année",
    chooseMonth: "Choisir l’année et le mois",
    clear: "Effacer",
    cancel: "Annuler",
    complete: "Terminer",
    purchase: "Achat",
    expiry: "Expiration",
    remaining: "{days} jours restants",
    overdue: "Expirée depuis {days} jours",
    empty: "Aucune garantie ne correspond aux filtres",
    loading: "Chargement des garanties",
    previous: "Page précédente",
    next: "Page suivante",
    renew: "Renouveler",
    renewed: "Renouvelée",
    renewalBadge: "{months} mois · payé le {date}",
    renewalTitle: "Renouveler la garantie",
    renewalTerm: "Durée du renouvellement",
    oneYear: "Un an",
    twoYears: "Deux ans",
    renewalPaidAt: "Date de paiement de la garantie",
    renewalSelectDate: "Choisir une date",
    renewalSubmit: "Confirmer le renouvellement",
    renewalSaving: "Renouvellement…",
    renewalSuccess: "Garantie renouvelée jusqu’au {date}",
    renewalFailed: "Impossible de renouveler la garantie. Réessayez.",
    renewalDateRequired: "Choisissez une date de paiement valide",
    renewalDateBeforeSale: "La date de paiement ne peut pas précéder la date d’achat",
    close: "Fermer"
  }
};

export const warrantyDictionaries = copy;

const WARRANTY_BUCKETS = ["all", "expired", "week", "month", "quarter", "year"];

const state = {
  items: null,
  bucket: "all",
  search: "",
  dateFrom: "",
  dateTo: "",
  page: 1,
  renewal: null,
  renewalBusy: false,
  renewalError: "",
  renewalNotice: null
};
let validCustomerIds = new Set();
const dateRangePanel = createDateRangePanel();
const renewalDatePanel = createDateRangePanel();
let dataLoadVersion = 0;

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

function inputDate(value) {
  const timestamp = dateValue(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function displayDate(value) {
  return inputDate(value).replaceAll("-", "/");
}

function hongKongTodayInput() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function warrantyRenewalTarget(item) {
  if (!item?.invoiceId || !item?.productId) return "";
  return `${encodeURIComponent(item.invoiceId)}|${encodeURIComponent(item.productId)}`;
}

function renewalItem() {
  const target = state.renewal?.target;
  return target ? state.items?.find((item) => warrantyRenewalTarget(item) === target) ?? null : null;
}

function renewalErrorKey(error) {
  const message = String(error?.message || "");
  if (message.includes("earlier than sold date")) return "renewalDateBeforeSale";
  if (message.includes("payment date")) return "renewalDateRequired";
  return "renewalFailed";
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

export async function ensureWarrantyData({ scope = null, signal = scope?.signal } = {}) {
  if (state.items !== null) return;
  const version = dataLoadVersion;
  const data = await getWarrantyData();
  if (version !== dataLoadVersion || signal?.aborted || (scope && !scope.isCurrent())) return;
  validCustomerIds = new Set(data.items.map((item) => String(item.customerId)));
  state.items = data.items
    .map((item) => ({
      ...item,
      bucket: warrantyBucket(item.expiry),
      daysLeft: warrantyDaysLeft(item.expiry)
    }))
    .filter((item) => item.bucket !== null && item.daysLeft >= -30 && validCustomerIds.has(String(item.customerId)));
}

export function warrantyBucketCounts(items) {
  const counts = Object.fromEntries(WARRANTY_BUCKETS.map((bucket) => [bucket, 0]));
  for (const item of items ?? []) {
    counts.all += 1;
    if (item.bucket in counts) counts[item.bucket] += 1;
  }
  return counts;
}

// 与客户列表同一口径(components/search-match.js):大小写、空格、横杠都不影响命中。
// item.phones 是 provider 按客户组补齐的整组号码(别名号 + 内地号),只参与搜索;
// 行上展示的仍旧只有主号 item.phone。
export function warrantyMatchesSearch(item, query) {
  return matchesSearchValues([item.customer, item.phone, item.phones, item.product, item.no], query);
}

function filteredItems() {
  const term = state.search.trim();
  const rangeFrom = dateValue(state.dateFrom);
  const rangeTo = dateValue(state.dateTo);
  return (state.items ?? []).filter((item) => {
    if (state.bucket !== "all" && item.bucket !== state.bucket) return false;
    const purchaseDate = dateValue(item.purchaseDate);
    if (Number.isFinite(rangeFrom) && (!Number.isFinite(purchaseDate) || purchaseDate < rangeFrom)) return false;
    if (Number.isFinite(rangeTo) && (!Number.isFinite(purchaseDate) || purchaseDate > rangeTo)) return false;
    if (!term) return true;
    return warrantyMatchesSearch(item, term);
  });
}

function dateRangeLabel(lang) {
  if (!state.dateFrom && !state.dateTo) return t(lang, "purchaseRange");
  return `${state.dateFrom || state.dateTo} - ${state.dateTo || state.dateFrom}`;
}

function renderDateRangeFilter(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  const hasRange = Boolean(state.dateFrom || state.dateTo);
  return `<span class="warranty-date-filter${hasRange ? " warranty-date-filter--active" : ""}">
    <button type="button" class="warranty-date-filter__trigger" data-warranty-date-trigger aria-haspopup="dialog" aria-expanded="${dateRangePanel.isOpen()}" title="${escapeHtml(t(lang, "dateRange"))}">
      ${icon("icon-task-calendar", "icon")}
      <span>${escapeHtml(dateRangeLabel(lang))}</span>
    </button>
    ${hasRange ? `<button type="button" class="warranty-date-filter__clear" data-warranty-date-clear aria-label="${escapeHtml(t(lang, "clear"))}">${escapeHtml(t(lang, "clear"))}</button>` : ""}
  </span>`;
}

function renderWarrantyRow(item, helpers) {
  const { escapeHtml, lang, liveWritable = false, writeBusy = false } = helpers;
  const e = escapeHtml;
  const hasCustomer = Boolean(item.customerId && validCustomerIds.has(String(item.customerId)));
  const renewalTarget = warrantyRenewalTarget(item);
  const canRenew = Boolean(renewalTarget);
  const renewalDisabled = !liveWritable || writeBusy || state.renewalBusy;
  const detailLink = hasCustomer
    ? `<a class="warranty-row__link" href="./customer-detail.html?id=${encodeURIComponent(item.customerId)}" aria-label="${e(item.customer)}"></a>`
    : "";
  const timing = item.daysLeft < 0
    ? t(lang, "overdue", { days: Math.abs(item.daysLeft) })
    : t(lang, "remaining", { days: item.daysLeft });
  const renewed = item.latestRenewal
    ? t(lang, "renewalBadge", { months: item.latestRenewal.months, date: item.latestRenewal.paidAt })
    : "";
  return `<article class="management-list__row warranty-row warranty-row--${item.bucket}${hasCustomer ? "" : " warranty-row--disabled"}"${hasCustomer ? "" : ' aria-disabled="true"'} data-warranty-row${item.customerId ? ` data-customer-id="${e(item.customerId)}"` : ""}${item.invoiceId ? ` data-invoice-id="${e(item.invoiceId)}"` : ""}${item.productId ? ` data-product-id="${e(item.productId)}"` : ""}>
    ${detailLink}
    <span class="warranty-row__bar" aria-hidden="true"></span>
    <span class="warranty-row__customer">
      <strong title="${e(item.customer)}">${e(item.customer)}</strong>
      <button type="button" class="warranty-row__phone" data-warranty-phone="${e(item.phone)}" title="${e(phoneCopyLabel(item.phone, lang))}" aria-label="${e(phoneCopyLabel(item.phone, lang))}">${e(item.phone)}</button>
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
      ${renewed ? `<span class="warranty-row__renewed" title="${e(renewed)}">${e(t(lang, "renewed"))} · ${e(renewed)}</span>` : ""}
      ${canRenew ? `<button type="button" class="warranty-row__renew" data-warranty-renew="${e(renewalTarget)}" data-customers-write${renewalDisabled ? ' disabled aria-disabled="true"' : ""}>${e(t(lang, "renew"))}</button>` : ""}
    </span>
  </article>`;
}

function renderRenewalModal(helpers) {
  const { escapeHtml, lang } = helpers;
  const item = renewalItem();
  if (!state.renewal || !item) return "";
  const e = escapeHtml;
  const disabledAttributes = state.renewalBusy ? ' disabled aria-disabled="true"' : "";
  return `<div class="customers-modal-overlay customers-modal-overlay--open warranty-renewal-overlay" data-warranty-renewal-overlay>
    <section class="tp-component form-new-customer warranty-renewal-modal" role="dialog" aria-modal="true" aria-label="${e(t(lang, "renewalTitle"))}">
      <button type="button" class="form-new-customer__close" data-warranty-renewal-close aria-label="${e(t(lang, "close"))}"${disabledAttributes}></button>
      <h2 class="form-new-customer__title">${e(t(lang, "renewalTitle"))}</h2>
      <div class="warranty-renewal-modal__summary">
        <strong>${e(item.customer)}</strong>
        <span>${e(item.product)} · ${e(item.no)}</span>
        <span>${e(t(lang, "purchase"))} ${e(item.purchaseDate)} · ${e(t(lang, "expiry"))} ${e(item.expiry)}</span>
      </div>
      <div class="warranty-renewal-term">
        <span class="warranty-renewal-modal__label">${e(t(lang, "renewalTerm"))}</span>
        <div class="warranty-renewal-options" role="group" aria-label="${e(t(lang, "renewalTerm"))}">
          ${[12, 24].map((months) => `<button type="button" class="${state.renewal.months === months ? "is-active" : ""}" data-warranty-renewal-months="${months}" data-customers-write aria-pressed="${state.renewal.months === months}"${disabledAttributes}>${e(t(lang, months === 12 ? "oneYear" : "twoYears"))}</button>`).join("")}
        </div>
      </div>
      <div class="warranty-renewal-date">
        <span class="warranty-renewal-modal__label">${e(t(lang, "renewalPaidAt"))}</span>
        <button type="button" class="warranty-renewal-date__trigger${state.renewal.paidAt ? " has-value" : ""}" data-warranty-renewal-date-trigger data-customers-write aria-haspopup="dialog" aria-expanded="${renewalDatePanel.isOpen()}"${disabledAttributes}>${e(displayDate(state.renewal.paidAt) || t(lang, "renewalSelectDate"))}</button>
      </div>
      ${state.renewalError ? `<p class="warranty-renewal-modal__error" role="alert">${e(t(lang, state.renewalError))}</p>` : ""}
      <div class="form-new-customer__footer">
        <button type="button" class="btn--hug btn--hug--gray" data-warranty-renewal-close${disabledAttributes}>${e(t(lang, "cancel"))}</button>
        <button type="button" class="btn--hug btn--hug--blue" data-warranty-renewal-submit data-customers-write${disabledAttributes}>${e(t(lang, state.renewalBusy ? "renewalSaving" : "renewalSubmit"))}</button>
      </div>
    </section>
  </div>`;
}

export function renderWarranty(helpers) {
  const { escapeHtml, icon, lang } = helpers;
  if (state.items === null) {
    return `<div class="management-list__empty warranty-empty" data-warranty-loading>${escapeHtml(t(lang, "loading"))}</div>`;
  }

  const filtered = filteredItems();
  const counts = warrantyBucketCounts(state.items);
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
  return `<section class="warranty-panel" data-warranty-panel data-warranty-total="${state.items.length}" data-warranty-filtered="${filtered.length}">
    ${state.renewalNotice ? `<p class="customer-write-notice customer-write-notice--success" role="status">${escapeHtml(t(lang, state.renewalNotice.key, state.renewalNotice.values))}</p>` : ""}
    <p class="warranty-summary">${escapeHtml(t(lang, "count", { count: state.items.length }))}</p>
    <div class="warranty-toprow">
      <div class="warranty-buckets" role="group" aria-label="${escapeHtml(t(lang, "title"))}">
        ${WARRANTY_BUCKETS.map((bucket) => `<button type="button" class="warranty-bucket${state.bucket === bucket ? " is-active" : ""}" data-warranty-bucket="${bucket}" aria-pressed="${state.bucket === bucket}"><span>${escapeHtml(t(lang, bucket))}</span><strong>${escapeHtml(String(counts[bucket]))}</strong></button>`).join("")}
      </div>
      <div class="warranty-toolbar">
        <div class="warranty-toolbar__filters">
          ${renderDateRangeFilter(helpers)}
          <label class="warranty-search">
            ${icon("icon-nav-search", "icon")}
            <input type="search" data-warranty-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(t(lang, "search"))}" aria-label="${escapeHtml(t(lang, "search"))}">
          </label>
        </div>
      </div>
    </div>
    ${renderManagementList({ content, pager, paged: filtered.length > pageSize })}
  </section>${renderRenewalModal(helpers)}`;
}

export function setWarrantySearch(value) {
  if (state.search === value) return false;
  state.search = value;
  state.page = 1;
  return true;
}

export function setWarrantyBucket(value) {
  if (!WARRANTY_BUCKETS.includes(value) || state.bucket === value) return false;
  state.bucket = value;
  state.page = 1;
  return true;
}

export function openWarrantyDateRange(anchor, helpers, onChange) {
  if (dateRangePanel.isOpen()) return dateRangePanel.close();
  const { lang } = helpers;
  return dateRangePanel.open({
    anchor,
    start: state.dateFrom,
    end: state.dateTo,
    language: lang,
    t: (key) => t(lang, key),
    onCommit(range) {
      const nextFrom = range.start || "";
      const nextTo = range.end || "";
      if (nextFrom === state.dateFrom && nextTo === state.dateTo) return;
      state.dateFrom = nextFrom;
      state.dateTo = nextTo;
      state.page = 1;
      onChange?.();
    }
  });
}

export function clearWarrantyDateRange() {
  dateRangePanel.close({ restoreFocus: false });
  if (!state.dateFrom && !state.dateTo) return false;
  state.dateFrom = "";
  state.dateTo = "";
  state.page = 1;
  return true;
}

export function closeWarrantyDateRange() {
  return dateRangePanel.close({ restoreFocus: false });
}

export function openWarrantyRenewal(target) {
  const item = state.items?.find((row) => warrantyRenewalTarget(row) === String(target));
  if (!item?.invoiceId || !item?.productId || state.renewalBusy) return false;
  renewalDatePanel.close({ restoreFocus: false });
  state.renewal = { target: warrantyRenewalTarget(item), months: 12, paidAt: hongKongTodayInput() };
  state.renewalError = "";
  state.renewalNotice = null;
  return true;
}

export function closeWarrantyRenewal() {
  if (!state.renewal || state.renewalBusy) return "";
  const target = state.renewal.target;
  renewalDatePanel.close({ restoreFocus: false });
  state.renewal = null;
  state.renewalError = "";
  return target;
}

export function isWarrantyRenewalOpen() {
  return Boolean(state.renewal);
}

export function setWarrantyRenewalMonths(value) {
  const months = Number(value);
  if (!state.renewal || state.renewalBusy || ![12, 24].includes(months) || state.renewal.months === months) return false;
  state.renewal.months = months;
  state.renewalError = "";
  return true;
}

export function openWarrantyRenewalDate(anchor, helpers, onChange) {
  if (!state.renewal || state.renewalBusy) return false;
  const { lang } = helpers;
  return renewalDatePanel.open({
    anchor,
    mode: "single",
    date: state.renewal.paidAt,
    language: lang,
    t: (key) => t(lang, key === "year" ? "calendarYear" : key === "date" ? "renewalPaidAt" : key),
    onCommit({ date }) {
      if (!state.renewal) return;
      state.renewal.paidAt = date;
      state.renewalError = "";
      onChange?.();
    }
  });
}

export function closeWarrantyRenewalDate() {
  return renewalDatePanel.close({ restoreFocus: false });
}

export async function submitWarrantyRenewal({ scope = null, onChange = null } = {}) {
  const item = renewalItem();
  if (!state.renewal || !item || state.renewalBusy) return { ok: false };
  const target = warrantyRenewalTarget(item);
  const paidAt = inputDate(state.renewal.paidAt);
  if (!paidAt) {
    state.renewalError = "renewalDateRequired";
    onChange?.();
    return { ok: false };
  }
  if (dateValue(paidAt) < dateValue(item.purchaseDate)) {
    state.renewalError = "renewalDateBeforeSale";
    onChange?.();
    return { ok: false };
  }

  state.renewalBusy = true;
  state.renewalError = "";
  onChange?.();
  try {
    const result = await renewLiveWarranty({
      invoiceId: item.invoiceId,
      productId: item.productId,
      months: state.renewal.months,
      paidAt
    });
    if (scope?.signal?.aborted || (scope?.isCurrent && !scope.isCurrent())) return { ok: false };
    item.expiry = displayDate(result.new_end);
    item.daysLeft = warrantyDaysLeft(item.expiry);
    item.bucket = warrantyBucket(item.expiry) ?? "year";
    item.latestRenewal = {
      months: Number(result.months),
      paidAt: displayDate(result.paid_at),
      previousEnd: displayDate(result.previous_end),
      newEnd: displayDate(result.new_end)
    };
    state.renewalNotice = { key: "renewalSuccess", values: { date: item.expiry } };
    state.renewal = null;
    renewalDatePanel.close({ restoreFocus: false });
    return { ok: true, result, target };
  } catch (error) {
    if (scope?.signal?.aborted || (scope?.isCurrent && !scope.isCurrent())) return { ok: false };
    console.error("[warranty] renewal failed", error);
    state.renewalError = renewalErrorKey(error);
    return { ok: false, error };
  } finally {
    if (!(scope?.signal?.aborted || (scope?.isCurrent && !scope.isCurrent()))) {
      state.renewalBusy = false;
      onChange?.();
    }
  }
}

export function moveWarrantyPage(direction) {
  state.page += direction === "next" ? 1 : -1;
}

export function captureWarrantyState() {
  return {
    bucket: state.bucket,
    search: state.search,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    page: state.page
  };
}

export function restoreWarrantyState(value = null) {
  const next = value && typeof value === "object" ? value : {};
  state.bucket = WARRANTY_BUCKETS.includes(next.bucket) ? next.bucket : "all";
  state.search = typeof next.search === "string" ? next.search : "";
  state.dateFrom = typeof next.dateFrom === "string" ? next.dateFrom : "";
  state.dateTo = typeof next.dateTo === "string" ? next.dateTo : "";
  state.page = Number.isInteger(next.page) && next.page > 0 ? next.page : 1;
  dateRangePanel.close({ restoreFocus: false });
  renewalDatePanel.close({ restoreFocus: false });
  state.renewal = null;
  state.renewalBusy = false;
  state.renewalError = "";
  state.renewalNotice = null;
}

export function disposeWarrantyState() {
  dataLoadVersion += 1;
  dateRangePanel.close({ restoreFocus: false });
  renewalDatePanel.close({ restoreFocus: false });
  clearPhoneCopyNotice();
  state.items = null;
  state.bucket = "all";
  state.renewal = null;
  state.renewalBusy = false;
  state.renewalError = "";
  state.renewalNotice = null;
  validCustomerIds = new Set();
}
