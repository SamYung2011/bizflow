import { renderSegment } from "../components/segment.js";
import { createBizflowMenu } from "../components/bizflow-menu.js";
import { translateOcpp } from "./ocpp-i18n.js";
import { stateKey } from "./ocpp-model.js";

export function makeOcppContext() {
  let helpers = null;
  return {
    setHelpers(next) {
      helpers = next;
    },
    helpers: () => helpers,
    t(key, values = {}) {
      return translateOcpp(helpers?.lang || "zh", key, values);
    },
  };
}

export function renderOcppLayout({
  helpers,
  t,
  titleKey,
  subtitleKey,
  tabs,
  activeTab,
  tabAttribute,
  body,
  attrs = "",
}) {
  const e = helpers.escapeHtml;
  const segment = renderSegment({
    items: tabs.map((tab) => ({
      key: tab.key,
      label: t(tab.labelKey),
      badge: tab.badge ?? null,
    })),
    active: activeTab,
    ariaLabel: t(titleKey),
    escapeHtml: e,
    dataAttribute: tabAttribute,
  });
  return `<main class="ocpp-page" data-ocpp-page ${attrs}><header class="ocpp-head"><h1>${e(t(titleKey))}</h1><p>${e(t(subtitleKey))}</p></header><div class="ocpp-segment">${segment}</div><div class="ocpp-content">${body}</div></main>`;
}

export function renderTable(
  headers,
  rowsHtml,
  { emptyText, helpers, minWidth = "wide", attrs = "" } = {},
) {
  const e = helpers.escapeHtml;
  if (!rowsHtml) return `<div class="ocpp-empty">${e(emptyText)}</div>`;
  return `<div class="ocpp-table-shell" ${attrs}><table class="ocpp-table ocpp-table--${minWidth}"><thead><tr>${headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}

export function renderPager(result, { helpers, t, attribute }) {
  if (result.pages <= 1) return "";
  const e = helpers.escapeHtml;
  return `<nav class="ocpp-pager" aria-label="${e(t("page", { page: result.page, pages: result.pages }))}"><button type="button" data-${attribute}="${result.page - 1}"${result.page === 1 ? " disabled" : ""}>${e(t("previous"))}</button><span>${e(t("page", { page: result.page, pages: result.pages }))}</span><button type="button" data-${attribute}="${result.page + 1}"${result.page === result.pages ? " disabled" : ""}>${e(t("next"))}</button></nav>`;
}

export function statusChip(value, { helpers, t, labelKey = null } = {}) {
  const e = helpers.escapeHtml;
  const tone = stateKey(value);
  const label = labelKey
    ? t(labelKey)
    : value === "normal"
      ? t("normal")
      : value === "hidden"
        ? t("hidden")
        : String(value ?? t("unknown"));
  return `<span class="ocpp-chip ocpp-chip--${tone}">${e(label)}</span>`;
}

export function detailGrid(items, helpers) {
  const e = helpers.escapeHtml;
  return `<dl class="ocpp-detail-grid">${items.map(([label, value, raw = false]) => `<div><dt>${e(label)}</dt><dd>${raw ? value : e(value ?? "—")}</dd></div>`).join("")}</dl>`;
}

export function filterInput({ helpers, t, value, attribute, placeholderKey }) {
  const e = helpers.escapeHtml;
  return `<input class="ocpp-filter-control" value="${e(value)}" data-${attribute} placeholder="${e(t(placeholderKey))}">`;
}

export function filterSelect({ helpers, value, attribute, options }) {
  const e = helpers.escapeHtml;
  return `<select class="ocpp-filter-control" data-${attribute}>${options.map(([key, label]) => `<option value="${e(key)}"${String(value) === String(key) ? " selected" : ""}>${e(label)}</option>`).join("")}</select>`;
}

export function canAccessOcpp(currentUser) {
  const authenticated = typeof currentUser?.hasPermission === "function";
  return !authenticated || currentUser.isBfAdmin === true;
}

export function requireOcppRouteAccess(currentUser, { url, navigation }) {
  if (canAccessOcpp(currentUser)) return;
  navigation.hardNavigate(new URL("./home.html", url), { replace: true });
  // The router recognizes AbortError and does not retry the denied OCPP URL.
  throw new DOMException("OCPP admin access required", "AbortError");
}

export function createOcppPage({
  activeKey,
  currentUser,
  unread,
  render,
  title,
}) {
  return {
    menu: createBizflowMenu(activeKey),
    data: { unread, user: currentUser },
    render,
    title,
  };
}
