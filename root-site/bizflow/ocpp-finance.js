import {
  getCurrentUser,
  getOcppFinanceData,
  getUnread,
} from "../data/provider.js";
import { moneyTone, renderMoneyText } from "../components/money-text.js";
import { flowTypeLabel, formatUnix, OCPP_PAGE_SIZE, paginateWithTotal, textMatch } from "./ocpp-model.js";
import { getLiveOcppFinancePage, OCPP_CACHE_SNAPSHOTS } from "../data/live-ocpp.js";
import { LIVE_SNAPSHOT_UPDATED_EVENT } from "../data/live-snapshot-dependencies.js";
import {
  detailGrid,
  filterInput,
  filterSelect,
  makeOcppContext,
  createOcppPage,
  requireOcppRouteAccess,
  renderOcppLayout,
  renderPager,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

let data = null;
let context = null;
let state = null;
let tabs = [];
const defaultFilterForTab = (tab) => tab === "recharges" ? "1" : "all";
function h() {
  return context.helpers();
}
function e(v) {
  return h().escapeHtml(v ?? "—");
}
function t(k, v = {}) {
  return context.t(k, v);
}
function money(v, tone = "neutral", currency = "HK$") {
  return renderMoneyText(v, { escapeHtml: h().escapeHtml, tone, currency });
}

const financeStatusLabels = {
  zh: {
    failed: "退款失敗", not_refunded: "未退款", pending_refund: "退款等待中",
    apply: "申請中", reviewed: "已審核", transferred: "已轉賬", reject: "已駁回",
  },
  en: {
    failed: "Refund failed", not_refunded: "Not refunded", pending_refund: "Refund pending",
    apply: "Applied", reviewed: "Reviewed", transferred: "Transferred", reject: "Rejected",
  },
  fr: {
    failed: "Échec du remboursement", not_refunded: "Non remboursé", pending_refund: "Remboursement en attente",
    apply: "Demandé", reviewed: "Vérifié", transferred: "Transféré", reject: "Rejeté",
  },
};

function financeStatus(value) {
  const key = String(value || "");
  const label = financeStatusLabels[h().lang]?.[key] || financeStatusLabels.zh[key] || key || t("unknown");
  const tone = key === "transferred" ? "normal" : ["failed", "reject"].includes(key) ? "hidden" : "unknown";
  return { label, tone };
}

function financeStatusChip(value) {
  const status = financeStatus(value);
  return `<span class="ocpp-chip ocpp-chip--${status.tone}">${h().escapeHtml(status.label)}</span>`;
}

function statusOptions(rows, key) {
  const label = (value) => {
    if (key === "typeKey") return flowTypeLabel(value, t);
    if (key === "status")
      return value === "1"
        ? t("success")
        : value === "0"
          ? t("pendingPayment")
          : value;
    return financeStatus(value).label;
  };
  return [
    ["all", t("all")],
    ...[...new Set(rows.map((r) => String(r[key] ?? "")))].map((value) => [
      value,
      label(value),
    ]),
  ];
}
function config() {
  if (state.tab === "refunds")
    return {
      key: "refunds",
      rows: data.refunds,
      id: "orderId",
      filterKey: "stateKey",
      search: ["orderId", "userId", "email", "paymentOrderNo"],
      headers: [
        "orderNo",
        "user",
        "amount",
        "netAmount",
        "payment",
        "refundState",
        "time",
      ],
      cells: (r) => [
        r.orderId,
        r.nickname || r.username || r.email,
        money(r.amount),
        money(r.netAmount),
        r.paymentName,
        financeStatusChip(r.stateKey),
        formatUnix(r.createdAt, h().lang),
      ],
      details: (r) => [
        [t("userId"), r.userId],
        [t("email"), r.email],
        [t("paymentNo"), r.paymentNo],
        [t("transactionId"), r.transactionId || "—"],
        [t("localDate"), r.localDate],
      ],
    };
  if (state.tab === "userMoney")
    return {
      key: "userMoneyLogs",
      rows: data.userMoneyLogs,
      id: "logId",
      filterKey: "typeKey",
      search: ["userId", "email", "username", "orderId", "memo"],
      headers: [
        "flowType",
        "user",
        "amount",
        "beforeMoney",
        "afterMoney",
        "remark",
        "time",
      ],
      cells: (r) => [
        flowTypeLabel(r.typeKey, t),
        r.nickname || r.username || r.email,
        money(r.money, moneyTone(r.typeKey, r.money)),
        money(r.beforeMoney),
        money(r.afterMoney),
        r.memo,
        formatUnix(r.createdAt, h().lang),
      ],
      details: (r) => [
        [t("userId"), r.userId],
        [t("email"), r.email],
        [t("orderNo"), r.orderId || "—"],
        [t("tag"), r.userTag || "—"],
      ],
    };
  if (state.tab === "operatorMoney")
    return {
      key: "operatorMoneyLogs",
      rows: data.operatorMoneyLogs,
      id: "logId",
      filterKey: "typeKey",
      search: ["operatorName", "orderId", "memo"],
      headers: [
        "flowType",
        "operatorName",
        "amount",
        "beforeMoney",
        "afterMoney",
        "orderNo",
        "time",
      ],
      cells: (r) => [
        flowTypeLabel(r.typeKey, t),
        r.operatorName,
        money(r.money, moneyTone(r.typeKey, r.money)),
        money(r.beforeMoney),
        money(r.afterMoney),
        r.orderId,
        formatUnix(r.createdAt, h().lang),
      ],
      details: (r) => [[t("remark"), r.memo || "—"]],
    };
  if (state.tab === "platformMoney")
    return {
      key: "platformMoneyLogs",
      rows: data.platformMoneyLogs,
      id: "logId",
      filterKey: null,
      search: ["operatorName", "orderId", "memo"],
      headers: ["operatorName", "orderNo", "amount", "remark", "time"],
      cells: (r) => [
        r.operatorName,
        r.orderId,
        money(r.money),
        r.memo,
        formatUnix(r.createdAt, h().lang),
      ],
      details: () => [],
    };
  if (state.tab === "withdrawals")
    return {
      key: "withdrawals",
      rows: data.withdrawals,
      id: "withdrawalId",
      filterKey: "statusKey",
      search: ["operatorName", "bankName", "bankAccount", "remark"],
      headers: [
        "operatorName",
        "amount",
        "bank",
        "bankAccount",
        "withdrawStatus",
        "time",
      ],
      cells: (r) => [
        r.operatorName,
        money(r.amount, moneyTone("withdrawal", r.amount)),
        r.bankName,
        r.bankAccount,
        financeStatusChip(r.statusKey),
        formatUnix(r.createdAt, h().lang),
      ],
      details: (r) => [
        [t("address"), r.bankAddress],
        [t("remark"), r.remark || "—"],
        [t("updatedAt"), formatUnix(r.updatedAt, h().lang)],
      ],
    };
  return {
    key: "recharges",
    rows: data.recharges,
    id: "rechargeId",
    filterKey: "status",
    search: ["userId", "email", "orderNo", "username", "nickname"],
    headers: [
      "orderNo",
      "user",
      "amount",
      "giveAmount",
      "currency",
      "payment",
      "status",
      "time",
    ],
    cells: (r) => [
      r.orderNo,
      r.nickname || r.username || r.email,
      money(r.amount, "neutral", r.currency === "HKD" ? "HK$" : r.currency),
      money(r.giveAmount, "neutral", r.currency === "HKD" ? "HK$" : r.currency),
      r.currency,
      r.paymentName,
      statusChip(r.status === 1 ? "normal" : r.status === 0 ? "unknown" : String(r.status ?? ""), {
        helpers: h(),
        t,
        labelKey: r.status === 1 ? "success" : r.status === 0 ? "pendingPayment" : null,
      }),
      formatUnix(r.createdAt, h().lang),
    ],
    details: (r) => [
      [t("userId"), r.userId],
      [t("username"), r.username],
      [t("email"), r.email],
      [t("goods"), r.goodsName],
      [t("paymentNo"), r.paymentNo],
      [t("remark"), r.remark || "—"],
      [t("updatedAt"), formatUnix(r.updatedAt, h().lang)],
    ],
  };
}
function renderFinance() {
  const cfg = config();
  const filtered = filteredFinanceRows(cfg);
  const result = paginateWithTotal(filtered, state.page, data.financeTotals?.[cfg.key]);
  const controls = `${cfg.filterKey ? filterSelect({ helpers: h(), value: state.filter, attribute: "ocpp-finance-filter", options: statusOptions(cfg.rows, cfg.filterKey) }) : ""}${filterInput({ helpers: h(), t, value: state.query, attribute: "ocpp-finance-query", placeholderKey: "financeSearch" })}`;
  const rows = result.rows
    .map((r) => {
      const id = String(r[cfg.id]);
      const open = id === state.expanded;
      const cells = cfg.cells(r);
      return `<tr>${cells.map((value, index) => `<td${index === 0 ? ` class="ocpp-mono"` : ""}>${typeof value === "string" && (value.startsWith('<span class="money-text') || value.startsWith('<span class="ocpp-chip')) ? value : e(value)}</td>`).join("")}<td><button class="ocpp-link" data-ocpp-finance-detail="${e(id)}">${e(open ? t("collapse") : t("details"))}</button></td></tr>${open ? `<tr class="ocpp-expanded"><td colspan="${cells.length + 1}">${detailGrid(cfg.details(r), h())}</td></tr>` : ""}`;
    })
    .join("");
  return `<div class="ocpp-toolbar"><div>${controls}</div><strong>${e(t("visible", { count: result.rows.length, total: result.total }))}</strong></div>${renderTable([...cfg.headers.map((key) => t(key)), t("details")], rows, { emptyText: t("empty"), helpers: h(), minWidth: "wide", attrs: `data-ocpp-finance-total="${result.total}" data-ocpp-finance-page-size="${result.rows.length}"` })}${renderPager(result, { helpers: h(), t, attribute: "ocpp-finance-page" })}`;
}

function filteredFinanceRows(cfg = config()) {
  return cfg.rows.filter(
    (r) =>
      (!cfg.filterKey || state.filter === "all" || String(r[cfg.filterKey]) === state.filter) &&
      textMatch(r, state.query, cfg.search),
  );
}

async function ensureFinanceForPage(targetPage) {
  const cfg = config();
  const total = Number(data.financeTotals?.[cfg.key]) || cfg.rows.length;
  const needed = targetPage * OCPP_PAGE_SIZE;
  for (let guard = 0; filteredFinanceRows(cfg).length < needed && cfg.rows.length < total && guard < 10; guard += 1) {
    const page = await getLiveOcppFinancePage(cfg.key, { offset: cfg.rows.length });
    if (!Array.isArray(page?.rows) || !page.rows.length) break;
    cfg.rows.push(...page.rows);
    data.financePages[cfg.key] = page.page;
    data.financeTotals[cfg.key] = Number(page.page?.total) || total;
    if (!page.page?.hasMore) break;
  }
}
function render(helpers) {
  context.setHelpers(helpers);
  return renderOcppLayout({
    helpers,
    t,
    titleKey: "financeTitle",
    subtitleKey: "financeSubtitle",
    tabs,
    activeTab: state.tab,
    tabAttribute: "data-ocpp-finance-tab",
    body: renderFinance(),
    attrs: `data-ocpp-route="finance" data-ocpp-recharges="${data.recharges.length}"`,
  });
}
function rerender() {
  const page = document.querySelector('[data-ocpp-route="finance"]');
  if (page && h()) page.outerHTML = render(h());
}
async function onFinanceClick(event) {
  const tab = event.target.closest("[data-ocpp-finance-tab]");
  if (tab) {
    state.tab = tab.getAttribute("data-ocpp-finance-tab");
    state.query = "";
    state.filter = defaultFilterForTab(state.tab);
    state.page = 1;
    state.expanded = null;
    rerender();
    return;
  }
  const pager = event.target.closest("button[data-ocpp-finance-page]");
  if (pager) {
    const targetPage = Number(pager.getAttribute("data-ocpp-finance-page")) || 1;
    await ensureFinanceForPage(targetPage);
    state.page = targetPage;
    rerender();
    return;
  }
  const detail = event.target.closest("[data-ocpp-finance-detail]");
  if (detail) {
    const id = detail.getAttribute("data-ocpp-finance-detail");
    state.expanded = state.expanded === id ? null : id;
    rerender();
  }
}
function onFinanceInput(event) {
  if (event.target.matches("[data-ocpp-finance-query]"))
    state.query = event.target.value;
}
function onFinanceChange(event) {
  if (event.target.matches("[data-ocpp-finance-query]")) {
    state.page = 1;
    rerender();
  }
  if (event.target.matches("[data-ocpp-finance-filter]")) {
    state.filter = event.target.value;
    state.page = 1;
    rerender();
  }
}
function onFinanceKeydown(event) {
  if (
    event.key === "Enter" &&
    event.target.matches("[data-ocpp-finance-query]")
  ) {
    state.page = 1;
    rerender();
  }
}

const financeTabs = ["recharges", "refunds", "userMoney", "operatorMoney", "platformMoney", "withdrawals"];

function createState(historyState) {
  const saved = historyState && typeof historyState === "object" ? historyState : {};
  const tab = financeTabs.includes(saved.tab) ? saved.tab : "recharges";
  return {
    tab,
    query: typeof saved.query === "string" ? saved.query : "",
    // Mirrors bizflow_samyung/src/views/ocpp/finance/Recharges.jsx:75.
    filter: typeof saved.filter === "string" ? saved.filter : defaultFilterForTab(tab),
    page: Number.isInteger(saved.page) && saved.page > 0 ? saved.page : 1,
    expanded: saved.expanded == null ? null : String(saved.expanded),
  };
}

export async function mountPage({ scope, signal, url, navigation, historyState }) {
  const currentUser = await getCurrentUser();
  throwIfPageAborted(signal, scope);
  requireOcppRouteAccess(currentUser, { url, navigation });
  const [nextData, unread] = await Promise.all([getOcppFinanceData(), getUnread()]);
  throwIfPageAborted(signal, scope);
  data = nextData;
  context = makeOcppContext();
  state = createState(historyState);
  tabs = [
    { key: "recharges", labelKey: "rechargesTab", badge: data.financeTotals.recharges },
    { key: "refunds", labelKey: "refundsTab", badge: data.financeTotals.refunds || null },
    { key: "userMoney", labelKey: "userMoneyTab" },
    { key: "operatorMoney", labelKey: "operatorMoneyTab" },
    { key: "platformMoney", labelKey: "platformMoneyTab" },
    { key: "withdrawals", labelKey: "withdrawalsTab", badge: data.financeTotals.withdrawals || null },
  ];
  return {
    page: createOcppPage({ activeKey: "ocpp-finance", currentUser, unread, render, title: "OCPP 財務" }),
    activate() {
      scope.listen(document, "click", onFinanceClick);
      scope.listen(document, "input", onFinanceInput);
      scope.listen(document, "change", onFinanceChange);
      scope.listen(document, "keydown", onFinanceKeydown);
      scope.listen(window, LIVE_SNAPSHOT_UPDATED_EVENT, (event) => {
        if (event.detail?.snapshot !== OCPP_CACHE_SNAPSHOTS.finance || !event.detail?.value) return;
        data = event.detail.value;
        tabs.find((tab) => tab.key === "recharges").badge = data.financeTotals.recharges;
        tabs.find((tab) => tab.key === "refunds").badge = data.financeTotals.refunds || null;
        tabs.find((tab) => tab.key === "withdrawals").badge = data.financeTotals.withdrawals || null;
        rerender();
      });
    },
    captureState: () => ({ ...state }),
    dispose() {
      data = null;
      context = null;
      state = null;
      tabs = [];
    },
  };
}
