import {
  getCurrentUser,
  getOcppChargingData,
  getUnread,
} from "../data/provider.js";
import {
  createDateFilter,
  latestDateInput,
} from "../components/date-filter.js";
import { renderMoneyText } from "../components/money-text.js";
import {
  dateInputFromUnix,
  formatUnix,
  paginate,
  pileTypeKey,
  textMatch,
} from "./ocpp-model.js";
import {
  detailGrid,
  filterInput,
  filterSelect,
  makeOcppContext,
  mountOcppShell,
  requireOcppAccess,
  renderOcppLayout,
  renderPager,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";
import { renderOcppShare } from "./ocpp-charging-share.js";

const currentUser = await getCurrentUser();
await requireOcppAccess(currentUser);
const [data, unread] = await Promise.all([getOcppChargingData(), getUnread()]);
const context = makeOcppContext();
const state = {
  tab: "piles",
  shareTab: "shareCharges",
  query: "",
  type: "all",
  operator: "all",
  status: "all",
  page: 1,
  sharePage: 1,
  orderPage: 1,
  reportPage: 1,
  reportPeriod: "day",
  expandedShare: null,
  expandedOrder: null,
  stationModal: null,
};
const tabs = [
  { key: "piles", labelKey: "pilesTab" },
  { key: "stations", labelKey: "stationsTab" },
  { key: "share", labelKey: "shareTab" },
  { key: "orders", labelKey: "ordersTab", badge: data.orders.length },
  { key: "reports", labelKey: "reportsTab" },
  { key: "operators", labelKey: "operatorsTab" },
];
const orderDate = createDateFilter({
  id: "ocpp-order-date",
  initialDate: latestDateInput(
    data.orders.map((row) => dateInputFromUnix(row.createdAt)),
  ),
  onChange: () => {
    state.orderPage = 1;
    rerender();
  },
});
function h() {
  return context.helpers();
}
function e(v) {
  return h().escapeHtml(v ?? "—");
}
function t(k, v = {}) {
  return context.t(k, v);
}
function money(v, tone = "neutral") {
  return renderMoneyText(v, { escapeHtml: h().escapeHtml, tone });
}
function options(rows, idKey, nameKey) {
  return [
    ["all", t("all")],
    ...rows.map((row) => [
      String(row[idKey]),
      row[nameKey] || `#${row[idKey]}`,
    ]),
  ];
}
function toolbar(controls, count, total = count, note = "") {
  return `<div class="ocpp-toolbar"><div>${controls}</div>${note ? `<span>${e(note)}</span>` : ""}<strong>${e(t("visible", { count, total }))}</strong></div>`;
}

function renderPiles() {
  const filtered = data.piles.filter(
    (row) =>
      (state.type === "all" || pileTypeKey(row.pileType) === state.type) &&
      textMatch(row, state.query, ["pileNo", "name", "vendor", "serial"]),
  );
  const result = paginate(filtered, state.page);
  const controls = `${filterSelect({
    helpers: h(),
    value: state.type,
    attribute: "ocpp-type",
    options: [
      ["all", t("all")],
      ["public", t("public")],
      ["private", t("private")],
      ["unassigned", t("unassigned")],
    ],
  })}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-query", placeholderKey: "pileSearch" })}`;
  const rows = result.rows
    .map(
      (r) =>
        `<tr><td class="ocpp-mono">${e(r.pileNo)}</td><td>${e(pileTypeKey(r.pileType) === "public" ? t("public") : pileTypeKey(r.pileType) === "private" ? t("private") : t("unassigned"))}</td><td>${e(r.name)}</td><td>${e(r.vendor)}</td><td>${e(r.model)}</td><td>${e(r.firmwareVersion || "—")}</td><td class="ocpp-mono">${e(r.serial || "—")}</td><td>${e(r.stationName || "—")}</td><td>${e(r.operatorName || "—")}</td><td>${statusChip(r.status, { helpers: h(), t })}</td><td>${e(r.connectorTotal)}</td></tr>`,
    )
    .join("");
  return `${toolbar(controls, result.rows.length, result.total)}${renderTable([t("pileNo"), t("type"), t("name"), t("vendor"), t("model"), t("firmware"), t("serial"), t("stationName"), t("operatorName"), t("status"), t("connectors")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "xwide", attrs: `data-ocpp-total="${result.total}" data-ocpp-page-size="${result.rows.length}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-page" })}`;
}

function renderStations() {
  const filtered = data.stations.filter(
    (r) =>
      (state.operator === "all" || String(r.operatorId) === state.operator) &&
      (state.status === "all" || r.status === state.status) &&
      textMatch(r, state.query, ["name", "address", "operatorName"]),
  );
  const controls = `${filterSelect({ helpers: h(), value: state.operator, attribute: "ocpp-operator", options: options(data.operators, "operatorId", "name") })}${filterSelect(
    {
      helpers: h(),
      value: state.status,
      attribute: "ocpp-status",
      options: [
        ["all", t("all")],
        ["normal", t("normal")],
        ["hidden", t("hidden")],
      ],
    },
  )}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-query", placeholderKey: "stationSearch" })}`;
  const rows = filtered
    .map(
      (r) =>
        `<tr><td>${e(r.name)}</td><td>${e(r.operatorName)}</td><td>${e(r.address)}</td><td>${e(r.pileTotal)}</td><td>${e(r.connectorTotal)}</td><td>${e(`${r.onlinePileTotal}/${r.availableConnectorTotal}/${r.faultConnectorTotal}`)}</td><td>${statusChip(r.status, { helpers: h(), t })}</td><td><button class="ocpp-link" data-ocpp-station-detail="${e(r.stationId)}">${e(t("details"))}</button></td></tr>`,
    )
    .join("");
  return `${toolbar(controls, filtered.length)}${renderTable([t("name"), t("operatorName"), t("address"), t("pileCount"), t("connectors"), t("statusSummary"), t("status"), t("details")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "wide" })}${renderStationModal()}`;
}

function renderStationModal() {
  if (state.stationModal == null) return "";
  const d = data.stationDetails[String(state.stationModal)];
  if (!d) return "";
  const station = d.station || {};
  const prices = (d.prices || [])
    .map(
      (r) =>
        `<tr><td>${e(`${r.startTime} - ${r.endTime}`)}</td><td>${money(r.price)}</td><td>${money(r.kwhCost)}</td><td>${statusChip(r.status, { helpers: h(), t })}</td></tr>`,
    )
    .join("");
  const piles = (d.piles || [])
    .map(
      (r) =>
        `<tr><td class="ocpp-mono">${e(r.pileNo)}</td><td>${e(r.name)}</td><td>${e(r.vendor)}</td><td>${e(r.model)}</td><td>${e((r.connectors || []).length)}</td><td>${statusChip(r.status, { helpers: h(), t })}</td></tr>`,
    )
    .join("");
  return `<div class="ocpp-overlay" data-ocpp-modal-overlay><section class="ocpp-modal" role="dialog" aria-modal="true"><header><h2>${e(station.name)}</h2><button data-ocpp-modal-close>×</button></header>${detailGrid(
    [
      [t("operatorName"), station.operatorName],
      [t("address"), station.address],
      [t("phone"), station.phone || "—"],
      [t("openHours"), station.openHours],
      [t("status"), station.status],
    ],
    h(),
  )}<h3>${e(t("prices"))}</h3>${renderTable([t("openHours"), t("price"), t("kwhCost"), t("status")], prices, { emptyText: t("empty"), helpers: h(), minWidth: "compact" })}<h3>${e(t("pilesTab"))}</h3>${renderTable([t("pileNo"), t("name"), t("vendor"), t("model"), t("connectors"), t("status")], piles, { emptyText: t("empty"), helpers: h(), minWidth: "wide" })}</section></div>`;
}

function renderShare() {
  return renderOcppShare({ data, state, helpers: h(), t, money });
}

function renderOrders() {
  const filtered = data.orders.filter(
    (r) =>
      (state.operator === "all" || String(r.operatorId) === state.operator) &&
      (state.status === "all" || String(r.stationId) === state.status) &&
      textMatch(r, state.query, ["orderId", "userId", "pileNo", "pileName"]) &&
      orderDate.matches(dateInputFromUnix(r.createdAt)),
  );
  const result = paginate(filtered, state.orderPage);
  const controls = `${filterSelect({ helpers: h(), value: state.operator, attribute: "ocpp-operator", options: options(data.operators, "operatorId", "name") })}${filterSelect({ helpers: h(), value: state.status, attribute: "ocpp-status", options: options(data.stations, "stationId", "name") })}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-query", placeholderKey: "orderSearch" })}${orderDate.render(h())}`;
  const rows = result.rows
    .map((r) => {
      const open = String(r.orderId) === String(state.expandedOrder);
      return `<tr><td class="ocpp-mono">${e(r.orderId)}</td><td class="ocpp-mono">${e(r.userId)}</td><td class="ocpp-mono">${e(r.pileNo)}</td><td>${e(r.connectorNo)}</td><td class="ocpp-mono">${e(r.transactionId)}</td><td>${e(r.chargingCapacity)}</td><td>${money(r.amount)}</td><td>${e(formatUnix(r.createdAt, h().lang))}</td><td><button class="ocpp-link" data-ocpp-order-detail="${e(r.orderId)}">${e(open ? t("collapse") : t("details"))}</button></td></tr>${
        open
          ? `<tr class="ocpp-expanded"><td colspan="9">${detailGrid(
              [
                [t("operatorName"), r.operatorName],
                [t("stationName"), r.stationName || "—"],
                [t("name"), r.pileName],
                [t("kwhCost"), money(r.kwhCost), true],
              ],
              h(),
            )}</td></tr>`
          : ""
      }`;
    })
    .join("");
  return `${toolbar(controls, result.rows.length, result.total)}${renderTable([t("orderNo"), t("userId"), t("pileNo"), t("connectorNo"), t("transactionId"), t("capacity"), t("amount"), t("time"), t("details")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "wide", attrs: `data-ocpp-orders-total="${result.total}" data-ocpp-orders-page-size="${result.rows.length}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-order-page" })}`;
}
function renderReports() {
  const rows = data.reports[state.reportPeriod] || [];
  const filtered = rows.filter(
    (r) =>
      (state.operator === "all" || String(r.operatorId) === state.operator) &&
      (state.status === "all" || String(r.stationId) === state.status),
  );
  const result = paginate(filtered, state.reportPage);
  const controls = `${filterSelect({
    helpers: h(),
    value: state.reportPeriod,
    attribute: "ocpp-period",
    options: [
      ["day", t("day")],
      ["month", t("month")],
      ["year", t("year")],
    ],
  })}${filterSelect({ helpers: h(), value: state.operator, attribute: "ocpp-operator", options: options(data.operators, "operatorId", "name") })}${filterSelect({ helpers: h(), value: state.status, attribute: "ocpp-status", options: options(data.stations, "stationId", "name") })}`;
  const body = result.rows
    .map(
      (r) =>
        `<tr><td>${e(r.periodKey)}</td><td>${e(r.operatorName || "—")}</td><td>${e(r.stationName || "—")}</td><td>${e(r.chargeCount)}</td><td>${e(r.chargingCapacityKwh)}</td><td>${money(r.amount)}</td></tr>`,
    )
    .join("");
  return `${toolbar(controls, result.rows.length, result.total)}${renderTable([t("period"), t("operatorName"), t("stationName"), t("chargeCount"), t("kwh"), t("amount")], body, { emptyText: t("noReports"), helpers: h(), attrs: `data-ocpp-report-total="${result.total}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-report-page" })}`;
}
function renderOperators() {
  const filtered = data.operators.filter((r) =>
    textMatch(r, state.query, [
      "name",
      "companyName",
      "contactName",
      "email",
      "phone",
    ]),
  );
  const rows = filtered
    .map(
      (r) =>
        `<tr><td>${e(r.name)}</td><td>${e(r.companyName)}</td><td>${e(r.contactName)}</td><td>${e(r.phone)}</td><td>${e(r.email || "—")}</td><td>${money(r.money)}</td><td>${e(r.profitPercent)}</td><td>${e(r.stationTotal)}</td><td>${e(r.pileTotal)}</td><td>${statusChip(r.status, { helpers: h(), t })}</td></tr>`,
    )
    .join("");
  return `${toolbar(filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-query", placeholderKey: "search" }), filtered.length)}${renderTable(
    [
      t("operatorName"),
      t("company"),
      t("contact"),
      t("phone"),
      t("email"),
      t("balance"),
      t("profit"),
      t("station"),
      t("pileCount"),
      t("status"),
    ],
    rows,
    { emptyText: t("empty"), helpers: h(), minWidth: "wide" },
  )}`;
}
function body() {
  if (state.tab === "stations") return renderStations();
  if (state.tab === "share") return renderShare();
  if (state.tab === "orders") return renderOrders();
  if (state.tab === "reports") return renderReports();
  if (state.tab === "operators") return renderOperators();
  return renderPiles();
}
function render(helpers) {
  context.setHelpers(helpers);
  return renderOcppLayout({
    helpers,
    t,
    titleKey: "chargingTitle",
    subtitleKey: "chargingSubtitle",
    tabs,
    activeTab: state.tab,
    tabAttribute: "data-ocpp-charging-tab",
    body: body(),
    attrs: `data-ocpp-orders="${data.orders.length}" data-ocpp-stations="${data.stations.length}"`,
  });
}
function rerender() {
  const page = document.querySelector("[data-ocpp-page]");
  if (page && h()) page.outerHTML = render(h());
}
function reset() {
  state.query = "";
  state.type = "all";
  state.operator = "all";
  state.status = "all";
  state.expandedOrder = null;
  state.expandedShare = null;
  state.page = state.sharePage = state.orderPage = state.reportPage = 1;
}
document.addEventListener("click", (event) => {
  const dateRoot = event.target.closest?.("[data-date-filter]");
  if (dateRoot) {
    if (orderDate.handleClick(event)) return;
  } else orderDate.close();
  const tab = event.target.closest("[data-ocpp-charging-tab]");
  if (tab) {
    state.tab = tab.getAttribute("data-ocpp-charging-tab");
    reset();
    rerender();
    return;
  }
  const shareTab = event.target.closest("[data-ocpp-share-tab]");
  if (shareTab) {
    state.shareTab = shareTab.getAttribute("data-ocpp-share-tab");
    state.query = "";
    state.status = "all";
    state.sharePage = 1;
    rerender();
    return;
  }
  for (const [selector, key] of [
    ["[data-ocpp-page]", "page"],
    ["[data-ocpp-share-page]", "sharePage"],
    ["[data-ocpp-order-page]", "orderPage"],
    ["[data-ocpp-report-page]", "reportPage"],
  ]) {
    const button = event.target.closest(selector);
    if (button && button.tagName === "BUTTON") {
      state[key] =
        Number(button.getAttribute(selector.slice(1, -1).split("=")[0])) || 1;
      rerender();
      return;
    }
  }
  const station = event.target.closest("[data-ocpp-station-detail]");
  if (station) {
    state.stationModal = station.getAttribute("data-ocpp-station-detail");
    rerender();
    return;
  }
  if (
    event.target.closest("[data-ocpp-modal-close]") ||
    event.target.matches("[data-ocpp-modal-overlay]")
  ) {
    state.stationModal = null;
    rerender();
    return;
  }
  const share = event.target.closest("[data-ocpp-share-detail]");
  if (share) {
    const id = share.getAttribute("data-ocpp-share-detail");
    state.expandedShare = state.expandedShare === id ? null : id;
    rerender();
    return;
  }
  const order = event.target.closest("[data-ocpp-order-detail]");
  if (order) {
    const id = order.getAttribute("data-ocpp-order-detail");
    state.expandedOrder = state.expandedOrder === id ? null : id;
    rerender();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-ocpp-query]"))
    state.query = event.target.value;
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-ocpp-query]")) {
    state.page = state.sharePage = state.orderPage = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-type]")) {
    state.type = event.target.value;
    state.page = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-operator]")) {
    state.operator = event.target.value;
    state.page = state.orderPage = state.reportPage = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-status]")) {
    state.status = event.target.value;
    state.page = state.sharePage = state.orderPage = state.reportPage = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-period]")) {
    state.reportPeriod = event.target.value;
    state.reportPage = 1;
    rerender();
  }
  orderDate.handleChange(event);
});
document.addEventListener("focusin", (event) => orderDate.handleFocus(event));
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-ocpp-query]")) {
    state.page = state.sharePage = state.orderPage = 1;
    rerender();
    return;
  }
  if (event.key === "Escape") {
    if (state.stationModal) {
      state.stationModal = null;
      rerender();
    }
    orderDate.close();
  }
});
await mountOcppShell({
  activeKey: "ocpp-charging",
  currentUser,
  unread,
  render,
});
