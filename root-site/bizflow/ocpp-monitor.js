import {
  getCurrentUser,
  getOcppMonitorData,
  getOcppMonitorLogsData,
  getUnread,
} from "../data/provider.js";
import {
  createDateFilter,
  latestDateInput,
} from "../components/date-filter.js";
import { dateInputFromUnix, formatUnix, pileTypeKey } from "./ocpp-model.js";
import {
  filterInput,
  filterSelect,
  makeOcppContext,
  mountOcppShell,
  requireOcppAccess,
  renderOcppLayout,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";

const currentUser = await getCurrentUser();
await requireOcppAccess(currentUser);
const [initialData, unread] = await Promise.all([getOcppMonitorData(), getUnread()]);
const data = { ...initialData };
const context = makeOcppContext();
const state = {
  tab: "status",
  autoRefresh: false,
  pileQuery: "",
  direction: "all",
  logLimit: 50,
  logsLoading: false,
  logsLoaded: !data.logsDeferred,
  expandedLog: null,
};
const tabs = [
  { key: "status", labelKey: "statusTab" },
  { key: "logs", labelKey: "logsTab" },
  {
    key: "commands",
    labelKey: "commandLogsTab",
    badge: data.commandLogs.length || null,
  },
  { key: "alarms", labelKey: "alarmsTab", badge: data.alarms.length || null },
];
const logDate = createDateFilter({
  id: "ocpp-log-date",
  initialDate: latestDateInput(
    data.logs.map((row) => dateInputFromUnix(row.ts)),
  ),
  onChange: () => {
    state.logLimit = 50;
    rerender();
  },
});
const alarmDate = createDateFilter({
  id: "ocpp-alarm-date",
  initialDate: latestDateInput(
    data.alarms.map((row) => dateInputFromUnix(row.createdAt)),
  ),
  onChange: () => rerender(),
});

function e(value) {
  return context.helpers().escapeHtml(value ?? "—");
}
function t(key, values = {}) {
  return context.t(key, values);
}

function renderStatus() {
  const h = context.helpers();
  const rows = data.piles
    .map(
      (row) =>
        `<tr><td class="ocpp-mono">${e(row.pileNo)}</td><td>${e(row.name)}</td><td>${e(pileTypeKey(row.pileType) === "public" ? t("public") : pileTypeKey(row.pileType) === "private" ? t("private") : t("unassigned"))}</td><td>${statusChip(row.status, { helpers: h, t })}</td><td>${row.onlineStatus ? statusChip("normal", { helpers: h, t, labelKey: "online" }) : statusChip("hidden", { helpers: h, t, labelKey: "offline" })}</td><td>${e(row.connectorTotal)}</td><td>${e(row.availableConnectorTotal)}</td><td>${e(row.faultConnectorTotal)}</td><td>${e(row.threePhase ? t("yes") : t("no"))}</td><td>${e("—")}</td><td>${e("—")}</td><td><div class="ocpp-actions">${["restart", "unlock", "start", "stop", "reserve"].map((key) => `<button type="button" disabled title="${e(t("formalOnly"))}">${e(t(key))}</button>`).join("")}</div></td></tr>`,
    )
    .join("");
  return `<div class="ocpp-toolbar"><label class="ocpp-check"><input type="checkbox" data-ocpp-auto${state.autoRefresh ? " checked" : ""}><span>${e(t("autoRefresh"))}</span></label><span>${e(t(data.isLive ? "liveReadOnly" : "snapshotOnly"))}</span><strong>${data.piles.length}</strong></div>${renderTable([t("pileNo"), t("name"), t("type"), t("status"), t("onlineStatus"), t("connectors"), t("availableConnectors"), t("faultConnectors"), t("phase"), t("power"), t("energy"), t("actions")], rows, { emptyText: t("empty"), helpers: h, minWidth: "xwide", attrs: 'data-ocpp-command-buttons="155"' })}`;
}

function renderLogs() {
  const h = context.helpers();
  if (state.logsLoading) {
    return `<div class="ocpp-empty" role="status" aria-live="polite">${e(t("loadingLogs"))}</div>`;
  }
  const query = state.pileQuery.trim().toLowerCase();
  const filtered = data.logs.filter(
    (row) =>
      (!query || String(row.pileNo).toLowerCase().includes(query)) &&
      (state.direction === "all" || row.dir === state.direction) &&
      logDate.matches(dateInputFromUnix(row.ts)),
  );
  const visible = filtered.slice(0, state.logLimit);
  const controls = `${filterInput({ helpers: h, t, value: state.pileQuery, attribute: "ocpp-pile-query", placeholderKey: "pileNo" })}${filterSelect(
    {
      helpers: h,
      value: state.direction,
      attribute: "ocpp-direction",
      options: [
        ["all", t("all")],
        ["in", t("inbound")],
        ["out", t("outbound")],
      ],
    },
  )}${logDate.render(h)}`;
  const rows = visible
    .map((row) => {
      const open = String(row.id) === String(state.expandedLog);
      return `<tr class="ocpp-click-row" data-ocpp-log="${e(row.id)}"><td>${e(formatUnix(row.ts, h.lang))}</td><td>${statusChip(row.dir === "in" ? "normal" : "unknown", { helpers: h, t, labelKey: row.dir === "in" ? "inbound" : "outbound" })}</td><td class="ocpp-mono">${e(row.pileNo)}</td><td>${e(row.action)}</td><td class="ocpp-mono">${e(row.messageId)}</td><td class="ocpp-preview">${e(row.dataPreview)}</td></tr>${open ? `<tr class="ocpp-expanded"><td colspan="6"><pre>${e(row.dataPreview)}</pre></td></tr>` : ""}`;
    })
    .join("");
  return `<div class="ocpp-toolbar"><div>${controls}</div><span>${e(t("last7days"))}</span><strong>${e(t("visible", { count: visible.length, total: filtered.length }))}</strong></div>${renderTable([t("time"), t("direction"), t("pileNo"), t("action"), t("messageId"), t("payload")], rows, { emptyText: t("noLogs"), helpers: h, minWidth: "xwide", attrs: `data-ocpp-log-total="${filtered.length}" data-ocpp-log-visible="${visible.length}"` })}${visible.length < filtered.length ? `<button type="button" class="ocpp-primary" data-ocpp-log-more>${e(t("loadMore"))}</button>` : ""}`;
}

async function loadLiveLogs() {
  if (state.logsLoaded || state.logsLoading) return;
  state.logsLoading = true;
  rerender();
  try {
    const result = await getOcppMonitorLogsData();
    data.logs = result.logs;
    data.isLive = result.isLive;
    data.logsScope = result.logsScope;
    data.generatedAt = result.generatedAt;
    state.logsLoaded = true;
  } finally {
    state.logsLoading = false;
    rerender();
  }
}

function renderCommands() {
  return `<section class="ocpp-panel"><p>${e(t("commandEmpty"))}</p><div class="ocpp-empty">${e(t("noCommands"))}</div></section>`;
}
function renderAlarms() {
  const h = context.helpers();
  const filtered = data.alarms.filter((row) =>
    alarmDate.matches(dateInputFromUnix(row.createdAt)),
  );
  const rows = filtered
    .map(
      (row) =>
        `<tr><td>${e(row.type)}</td><td class="ocpp-mono">${e(row.pileNo)}</td><td>${e(row.content || "—")}</td><td>${e(formatUnix(row.createdAt, h.lang))}</td></tr>`,
    )
    .join("");
  return `<div class="ocpp-toolbar"><div>${alarmDate.render(h)}</div><strong>${filtered.length}</strong></div>${renderTable([t("alarmType"), t("pileNo"), t("content"), t("time")], rows, { emptyText: t("noAlarms"), helpers: h })}`;
}

function body() {
  if (state.tab === "logs") return renderLogs();
  if (state.tab === "commands") return renderCommands();
  if (state.tab === "alarms") return renderAlarms();
  return renderStatus();
}
function render(helpers) {
  context.setHelpers(helpers);
  return renderOcppLayout({
    helpers,
    t,
    titleKey: "monitorTitle",
    subtitleKey: "monitorSubtitle",
    tabs,
    activeTab: state.tab,
    tabAttribute: "data-ocpp-monitor-tab",
    body: body(),
    attrs: `data-ocpp-piles="${data.piles.length}" data-ocpp-logs="${data.logs.length}"`,
  });
}
function rerender() {
  const page = document.querySelector("[data-ocpp-page]");
  if (page && context.helpers()) page.outerHTML = render(context.helpers());
}
document.addEventListener("click", (event) => {
  const root = event.target.closest?.("[data-date-filter]");
  if (root) {
    const id = root.getAttribute("data-date-filter");
    if (id === "ocpp-log-date") {
      alarmDate.close();
      if (logDate.handleClick(event)) return;
    }
    if (id === "ocpp-alarm-date") {
      logDate.close();
      if (alarmDate.handleClick(event)) return;
    }
  } else {
    logDate.close();
    alarmDate.close();
  }
  const tab = event.target.closest("[data-ocpp-monitor-tab]");
  if (tab) {
    state.tab = tab.getAttribute("data-ocpp-monitor-tab");
    rerender();
    if (state.tab === "logs") void loadLiveLogs();
    return;
  }
  const log = event.target.closest("[data-ocpp-log]");
  if (log) {
    const id = log.getAttribute("data-ocpp-log");
    state.expandedLog = state.expandedLog === id ? null : id;
    rerender();
    return;
  }
  if (event.target.closest("[data-ocpp-log-more]")) {
    state.logLimit += 50;
    rerender();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-ocpp-pile-query]"))
    state.pileQuery = event.target.value;
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-ocpp-auto]"))
    state.autoRefresh = event.target.checked;
  if (event.target.matches("[data-ocpp-pile-query]")) {
    state.logLimit = 50;
    rerender();
  }
  if (event.target.matches("[data-ocpp-direction]")) {
    state.direction = event.target.value;
    state.logLimit = 50;
    rerender();
  }
  logDate.handleChange(event) || alarmDate.handleChange(event);
});
document.addEventListener("focusin", (event) => {
  logDate.handleFocus(event);
  alarmDate.handleFocus(event);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-ocpp-pile-query]")) {
    state.logLimit = 50;
    rerender();
    return;
  }
  if (event.key === "Escape") {
    logDate.close();
    alarmDate.close();
  }
});

await mountOcppShell({
  activeKey: "ocpp-monitor",
  currentUser,
  unread,
  render,
});
