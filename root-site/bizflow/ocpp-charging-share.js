import { renderSegment } from "../components/segment.js";
import { moneyTone } from "../components/money-text.js";
import { clockRange, flowTypeLabel, formatUnix, paginate, textMatch } from "./ocpp-model.js";
import {
  filterInput,
  filterSelect,
  renderPager,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";

export function renderOcppShare({ data, state, helpers, t, money }) {
  const e = (value) => helpers.escapeHtml(value ?? "—");
  const tabs = [
    { key: "shareCharges", labelKey: "shareChargesTab" },
    { key: "shareIncome", labelKey: "shareIncomeTab" },
    { key: "shareBookings", labelKey: "shareBookingsTab" },
  ];
  const toolbar = (controls, result) =>
    `<div class="ocpp-toolbar"><div>${controls}</div><strong>${e(t("visible", { count: result.rows.length, total: result.total }))}</strong></div>`;
  const controls = (result, options = null) =>
    toolbar(
      `${options ? filterSelect({ helpers, value: state.status, attribute: "ocpp-status", options }) : ""}${filterInput({ helpers, t, value: state.query, attribute: "ocpp-query", placeholderKey: "shareSearch" })}`,
      result,
    );

  function charges() {
    const filtered = data.shareCharges.filter(
      (row) =>
        (state.status === "all" || String(row.shareEnabled) === state.status) &&
        textMatch(row, state.query, [
          "pileNo",
          "pileName",
          "ownerEmail",
          "ownerNickname",
          "address",
        ]),
    );
    const result = paginate(filtered, state.sharePage);
    const rows = result.rows
      .map((row) => {
        const open = String(row.shareId) === String(state.expandedShare);
        const prices = data.sharePrices[String(row.shareId)] || [];
        return `<tr><td class="ocpp-mono">${e(row.pileNo)}</td><td>${e(row.ownerNickname || row.ownerUsername || row.ownerEmail)}</td><td>${money(row.price)}</td><td>${money(row.spaceOccupancyFee)}</td><td>${e(clockRange(row.openStartTime, row.openEndTime))}</td><td>${statusChip(row.shareEnabled ? "normal" : "hidden", { helpers, t, labelKey: row.shareEnabled ? "enabled" : "disabled" })}</td><td>${e(row.address || "—")}</td><td><button class="ocpp-link" data-ocpp-share-detail="${e(row.shareId)}">${e(open ? t("collapse") : t("details"))}</button></td></tr>${open ? `<tr class="ocpp-expanded"><td colspan="8">${prices.length ? prices.map((price) => `<div>${e(clockRange(price.startTime, price.endTime))} ${money(price.price)}</div>`).join("") : e(t("empty"))}</td></tr>` : ""}`;
      })
      .join("");
    return `${controls(result, [
      ["all", t("all")],
      ["true", t("enabled")],
      ["false", t("disabled")],
    ])}${renderTable([t("pileNo"), t("owner"), t("price"), t("occupancyFee"), t("openHours"), t("shareStatus"), t("address"), t("details")], rows, { emptyText: t("empty"), helpers, minWidth: "wide" })}${renderPager(result, { helpers, t, attribute: "ocpp-share-page" })}`;
  }

  function income() {
    const filtered = data.shareIncome.filter(
      (row) =>
        (state.status === "all" || row.typeKey === state.status) &&
        textMatch(row, state.query, [
          "email",
          "username",
          "nickname",
          "orderId",
          "memo",
        ]),
    );
    const result = paginate(filtered, state.sharePage);
    const rows = result.rows
      .map(
        (row) =>
          `<tr><td>${e(flowTypeLabel(row.typeKey, t))}</td><td>${e(row.nickname || row.username || row.email)}</td><td>${money(row.money, moneyTone(row.typeKey, row.money))}</td><td>${money(row.afterMoney)}</td><td class="ocpp-mono">${e(row.orderId)}</td><td>${e(row.memo || "—")}</td><td>${e(formatUnix(row.createdAt, helpers.lang))}</td></tr>`,
      )
      .join("");
    const options = [
      ["all", t("all")],
      ...[...new Set(data.shareIncome.map((row) => row.typeKey))].map((key) => [
        key,
        flowTypeLabel(key, t),
      ]),
    ];
    return `${controls(result, options)}${renderTable([t("type"), t("owner"), t("amount"), t("balance"), t("orders"), t("remark"), t("time")], rows, { emptyText: t("empty"), helpers })}${renderPager(result, { helpers, t, attribute: "ocpp-share-page" })}`;
  }

  function bookings() {
    const filtered = data.shareBookings.filter(
      (row) =>
        textMatch(row, state.query, [
          "email",
          "username",
          "nickname",
          "pileNo",
          "pileName",
          "stationName",
        ]),
    );
    const result = paginate(filtered, state.sharePage);
    const rows = result.rows
      .map(
        (row) =>
          `<tr><td>${e(row.nickname || row.username || row.email)}</td><td class="ocpp-mono">${e(row.pileNo)}</td><td>${e(row.date)}</td><td>${e(clockRange(row.startTime, row.endTime))}</td><td>${e(row.bookingTypeName)}</td><td>${statusChip(row.state, { helpers, t })}</td><td>${e(formatUnix(row.createdAt, helpers.lang))}</td></tr>`,
      )
      .join("");
    return `${controls(result)}${renderTable([t("user"), t("pileNo"), t("bookingDate"), t("openHours"), t("bookingType"), t("status"), t("createdAt")], rows, { emptyText: t("empty"), helpers })}${renderPager(result, { helpers, t, attribute: "ocpp-share-page" })}`;
  }

  const segment = renderSegment({
    items: tabs.map((tab) => ({ key: tab.key, label: t(tab.labelKey) })),
    active: state.shareTab,
    ariaLabel: t("shareTab"),
    escapeHtml: helpers.escapeHtml,
    dataAttribute: "data-ocpp-share-tab",
    sliding: false,
  });
  const body =
    state.shareTab === "shareCharges"
      ? charges()
      : state.shareTab === "shareIncome"
        ? income()
        : bookings();
  return `<div class="ocpp-inner-segment">${segment}</div>${body}`;
}
