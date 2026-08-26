import {
  getCurrentUser,
  getOcppMonitorData,
  getOcppMonitorLogsData,
} from "../data/provider.js";
import { cachedPageUnread, loadPageUnread } from "../data/page-unread.js";
import { ocppCommandClient } from "../data/live-ocpp-commands.js";
import {
  createDateRangeFilter,
  latestDateInput,
} from "../components/date-range-filter.js";
import { dateInputFromUnix, formatUnix } from "./ocpp-model.js";
import {
  canCancelOcppSchedule,
  defaultOcppScheduleLocalValue,
  getOcppCommandAvailability,
  isFutureOcppSchedule,
  normalizeOcppSchedules,
} from "./ocpp-command-model.js";
import { translateOcppCommand } from "./ocpp-command-copy.js";
import {
  getOcppCommandRows,
  renderOcppCommandStatus,
  syncOcppCommandForm,
} from "./ocpp-command-view.js";
import {
  filterInput,
  filterSelect,
  makeOcppContext,
  createOcppPage,
  requireOcppRouteAccess,
  renderOcppLayout,
  renderTable,
  statusChip,
} from "./ocpp-shared.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";

let data = null;
let context = null;
let state = null;
let tabs = [];
let logDate = null;
let alarmDate = null;
let instanceSequence = 0;
let activeInstance = 0;
let activeScope = null;
let autoRefreshTimer = null;
let monitorRefreshBusy = false;

const OCPP_AUTO_REFRESH_INTERVAL_MS = 30_000;

function e(value) {
  return context.helpers().escapeHtml(value ?? "—");
}
function t(key, values = {}) {
  return context.t(key, values);
}
function ct(key, values = {}) {
  return translateOcppCommand(context.helpers()?.lang || "zh", key, values);
}

function commandRows() {
  return getOcppCommandRows(data, state);
}

function renderStatus() {
  return renderOcppCommandStatus({
    data,
    state,
    helpers: context.helpers(),
    t,
    ct,
  });
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
  return `<div class="ocpp-toolbar"><div>${controls}</div><strong>${e(t("visible", { count: visible.length, total: filtered.length }))}</strong></div>${renderTable([t("time"), t("direction"), t("pileNo"), t("action"), t("messageId"), t("payload")], rows, { emptyText: t("noLogs"), helpers: h, minWidth: "xwide", attrs: `data-ocpp-log-total="${filtered.length}" data-ocpp-log-visible="${visible.length}"` })}${visible.length < filtered.length ? `<button type="button" class="ocpp-primary" data-ocpp-log-more>${e(t("loadMore"))}</button>` : ""}`;
}

async function loadLiveLogs() {
  if (state.logsLoaded || state.logsLoading) return;
  const instance = activeInstance;
  const scope = activeScope;
  state.logsLoading = true;
  rerender();
  try {
    const result = await getOcppMonitorLogsData();
    if (instance !== activeInstance || !scope?.isCurrent()) return;
    data.logs = result.logs;
    data.isLive = result.isLive;
    data.logsScope = result.logsScope;
    data.generatedAt = result.generatedAt;
    state.logsLoaded = true;
  } finally {
    if (instance !== activeInstance || !scope?.isCurrent()) return;
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
    attrs: `data-ocpp-route="monitor" data-ocpp-piles="${data.piles.length}" data-ocpp-logs="${data.logs.length}"`,
  });
}
function rerender() {
  const page = document.querySelector('[data-ocpp-route="monitor"]');
  if (page && context.helpers()) page.outerHTML = render(context.helpers());
}

function syncTabs() {
  tabs = [
    { key: "status", labelKey: "statusTab" },
    { key: "logs", labelKey: "logsTab" },
    { key: "commands", labelKey: "commandLogsTab", badge: data.commandLogs.length || null },
    { key: "alarms", labelKey: "alarmsTab", badge: data.alarms.length || null },
  ];
}

async function loadCommandOverview(fallbackAuthenticated = false) {
  try {
    return await ocppCommandClient.readOverview();
  } catch (error) {
    return {
      authenticated: fallbackAuthenticated,
      status: [],
      schedules: [],
      statusError: String(error?.message || error),
      scheduleError: String(error?.message || error),
    };
  }
}

function applyCommandOverview(overview) {
  state.commandAuthenticated = overview.authenticated === true;
  state.commandStatus = overview.status;
  state.commandSchedules = normalizeOcppSchedules(overview.schedules);
  state.commandStatusError = overview.statusError || "";
  state.commandScheduleError = overview.scheduleError || "";
}

function cancelAutoRefresh() {
  if (autoRefreshTimer !== null) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = null;
}

async function refreshMonitorData() {
  if (monitorRefreshBusy || !state) return;
  const instance = activeInstance;
  const scope = activeScope;
  monitorRefreshBusy = true;
  try {
    const [result, commandOverview] = await Promise.all([
      getOcppMonitorData(),
      loadCommandOverview(state.commandAuthenticated),
    ]);
    if (instance !== activeInstance || !scope?.isCurrent() || !state) return;
    const preserveDeferredLogs = result.logsDeferred === true;
    data = {
      ...data,
      ...result,
      logs: preserveDeferredLogs ? data.logs : result.logs,
    };
    if (!preserveDeferredLogs) state.logsLoaded = true;
    applyCommandOverview(commandOverview);
    syncTabs();
    rerender();
  } catch (error) {
    if (instance === activeInstance && scope?.isCurrent()) {
      console.warn("OCPP auto refresh failed", error);
    }
  } finally {
    if (instance === activeInstance) monitorRefreshBusy = false;
  }
}

async function runPendingCommand() {
  if (!state?.pendingAction || state.actionBusy) return;
  const action = { ...state.pendingAction };
  if (
    ["start", "schedule"].includes(action.kind) &&
    !String(action.tagId || "").trim()
  ) {
    return;
  }
  if (
    action.kind === "schedule" &&
    !isFutureOcppSchedule(action.scheduledAt)
  ) {
    state.commandToast = { message: ct("chooseFuture"), kind: "error" };
    rerender();
    return;
  }
  const instance = activeInstance;
  const scope = activeScope;
  state.actionBusy = true;
  rerender();
  let successMessage = "";
  let successKey = "";
  try {
    if (action.kind === "reset") {
      await ocppCommandClient.runCommand({
        cpId: action.cpId,
        connectorId: action.connectorId,
        command: "Reset",
        params: { Type: "Soft" },
      });
      successKey = "sent";
    } else if (action.kind === "unlock") {
      await ocppCommandClient.runCommand({
        cpId: action.cpId,
        connectorId: action.connectorId,
        command: "UnlockConnector",
        params: {},
      });
      successKey = "sent";
    } else if (action.kind === "start") {
      await ocppCommandClient.runCommand({
        cpId: action.cpId,
        connectorId: action.connectorId,
        command: "startcharge",
        params: { TagId: String(action.tagId).trim() },
      });
      successKey = "sent";
    } else if (action.kind === "stop") {
      await ocppCommandClient.runCommand({
        cpId: action.cpId,
        connectorId: action.connectorId,
        command: "stopcharge",
        params: { TransactionId: action.txId },
      });
      successKey = "sent";
    } else if (action.kind === "schedule") {
      await ocppCommandClient.createSchedule({
        cpId: action.cpId,
        connectorId: action.connectorId,
        tagId: String(action.tagId).trim(),
        scheduledTime: action.scheduledAt,
      });
      successKey = "scheduleCreated";
    } else if (action.kind === "cancelSchedule") {
      await ocppCommandClient.cancelSchedule(action.schedule?.scheduleId);
      successKey = "scheduleCancelled";
    }
    if (instance !== activeInstance || !scope?.isCurrent() || !state) return;
    successMessage = ct(successKey);
    state.pendingAction = null;
    state.commandToast = { message: successMessage, kind: "ok" };
  } catch (error) {
    if (instance !== activeInstance || !scope?.isCurrent() || !state) return;
    state.commandToast = {
      message: ct("failed", { detail: error?.message || error }),
      kind: "error",
    };
  } finally {
    if (instance === activeInstance && scope?.isCurrent() && state) {
      state.actionBusy = false;
      rerender();
    }
  }
  if (!successMessage || instance !== activeInstance || !scope?.isCurrent()) {
    return;
  }
  const overview = await loadCommandOverview(true);
  if (instance !== activeInstance || !scope?.isCurrent() || !state) return;
  applyCommandOverview(overview);
  rerender();
}

function openCommand(kind, rowIndex) {
  const entry = commandRows()[rowIndex];
  if (!entry) return;
  const availability = getOcppCommandAvailability({
    authenticated: state.commandAuthenticated,
    onlineRow: entry.online,
    busy: state.actionBusy,
  });
  if (!availability[kind]) return;
  state.pendingAction = {
    kind,
    cpId: availability.cpId,
    connectorId: availability.connectorId,
    txId: availability.stopTxId,
    tagId: "",
    scheduledAt:
      kind === "schedule" ? defaultOcppScheduleLocalValue() : "",
  };
  state.commandToast = { message: "", kind: "info" };
  rerender();
}

function openScheduleCancellation(index) {
  const schedule = state.commandSchedules[index];
  if (
    !schedule ||
    !state.commandAuthenticated ||
    state.actionBusy ||
    !canCancelOcppSchedule(schedule)
  ) {
    return;
  }
  state.pendingAction = { kind: "cancelSchedule", schedule: { ...schedule } };
  state.commandToast = { message: "", kind: "info" };
  rerender();
}

function closePendingCommand() {
  if (!state?.pendingAction || state.actionBusy) return;
  state.pendingAction = null;
  rerender();
}

function scheduleAutoRefresh() {
  cancelAutoRefresh();
  if (!state?.autoRefresh || !activeScope?.isCurrent()) return;
  autoRefreshTimer = activeScope.timeout(async () => {
    autoRefreshTimer = null;
    await refreshMonitorData();
    scheduleAutoRefresh();
  }, OCPP_AUTO_REFRESH_INTERVAL_MS);
}
function onMonitorClick(event) {
  if (event.target.closest("[data-ocpp-toast-close]")) {
    state.commandToast = { message: "", kind: "info" };
    rerender();
    return;
  }
  if (event.target.closest("[data-ocpp-modal-close]")) {
    closePendingCommand();
    return;
  }
  if (event.target.matches("[data-ocpp-modal-dismiss]")) {
    closePendingCommand();
    return;
  }
  if (event.target.closest("[data-ocpp-command-confirm]")) {
    void runPendingCommand();
    return;
  }
  const command = event.target.closest("[data-ocpp-command]");
  if (command) {
    openCommand(
      command.getAttribute("data-ocpp-command"),
      Number(command.getAttribute("data-ocpp-command-row")),
    );
    return;
  }
  const scheduleCancel = event.target.closest("[data-ocpp-schedule-cancel]");
  if (scheduleCancel) {
    openScheduleCancellation(
      Number(scheduleCancel.getAttribute("data-ocpp-schedule-cancel")),
    );
    return;
  }
  const root = event.target.closest?.("[data-date-range-filter]");
  if (root) {
    const id = root.getAttribute("data-date-range-filter");
    if (id === "ocpp-log-date") {
      alarmDate.close();
      if (logDate.handleClick(event)) return;
    }
    if (id === "ocpp-alarm-date") {
      logDate.close();
      if (alarmDate.handleClick(event)) return;
    }
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
}
function onMonitorInput(event) {
  if (event.target.matches("[data-ocpp-command-tag]")) {
    if (state.pendingAction) state.pendingAction.tagId = event.target.value;
    syncOcppCommandForm({ state, ct });
    return;
  }
  if (event.target.matches("[data-ocpp-command-time]")) {
    if (state.pendingAction) state.pendingAction.scheduledAt = event.target.value;
    syncOcppCommandForm({ state, ct });
    return;
  }
  if (event.target.matches("[data-ocpp-pile-query]"))
    state.pileQuery = event.target.value;
}

function onMonitorChange(event) {
  if (event.target.matches("[data-ocpp-auto]")) {
    state.autoRefresh = event.target.checked;
    if (state.autoRefresh) void refreshMonitorData();
    scheduleAutoRefresh();
  }
  if (event.target.matches("[data-ocpp-pile-query]")) {
    state.logLimit = 50;
    rerender();
  }
  if (event.target.matches("[data-ocpp-direction]")) {
    state.direction = event.target.value;
    state.logLimit = 50;
    rerender();
  }
}
function onMonitorKeydown(event) {
  if (event.key === "Enter" && event.target.matches("[data-ocpp-pile-query]")) {
    state.logLimit = 50;
    rerender();
    return;
  }
  if (event.key === "Escape") {
    closePendingCommand();
    logDate.close();
    alarmDate.close();
  }
}

function createState(historyState, logsDeferred, commandOverview) {
  const saved = historyState && typeof historyState === "object" ? historyState : {};
  return {
    tab: ["status", "logs", "commands", "alarms"].includes(saved.tab) ? saved.tab : "status",
    autoRefresh: typeof saved.autoRefresh === "boolean" ? saved.autoRefresh : true,
    pileQuery: typeof saved.pileQuery === "string" ? saved.pileQuery : "",
    direction: ["all", "in", "out"].includes(saved.direction) ? saved.direction : "all",
    logLimit: Number.isInteger(saved.logLimit) && saved.logLimit > 0 ? saved.logLimit : 50,
    logsLoading: false,
    logsLoaded: !logsDeferred,
    expandedLog: saved.expandedLog == null ? null : String(saved.expandedLog),
    commandAuthenticated: commandOverview.authenticated === true,
    commandStatus: commandOverview.status,
    commandSchedules: normalizeOcppSchedules(commandOverview.schedules),
    commandStatusError: commandOverview.statusError || "",
    commandScheduleError: commandOverview.scheduleError || "",
    actionBusy: false,
    pendingAction: null,
    commandToast: { message: "", kind: "info" },
  };
}

export async function mountPage({ scope, signal, url, navigation, historyState }) {
  const currentUser = await getCurrentUser();
  throwIfPageAborted(signal, scope);
  requireOcppRouteAccess(currentUser, { url, navigation });
  const [initialData, commandOverview] = await Promise.all([
    getOcppMonitorData(),
    loadCommandOverview(false),
  ]);
  throwIfPageAborted(signal, scope);
  const { unread } = cachedPageUnread(currentUser);
  const instance = ++instanceSequence;
  activeInstance = instance;
  activeScope = scope;
  data = { ...initialData };
  context = makeOcppContext();
  state = createState(historyState, data.logsDeferred, commandOverview);
  syncTabs();
  logDate = createDateRangeFilter({
    id: "ocpp-log-date",
    initialDate: latestDateInput(data.logs.map((row) => dateInputFromUnix(row.ts))),
    presets: ["all", "last7"],
    onChange: () => {
      state.logLimit = 50;
      rerender();
    },
  });
  alarmDate = createDateRangeFilter({
    id: "ocpp-alarm-date",
    initialDate: latestDateInput(data.alarms.map((row) => dateInputFromUnix(row.createdAt))),
    onChange: () => rerender(),
  });
  logDate.restoreState(historyState?.logDate);
  alarmDate.restoreState(historyState?.alarmDate);

  return {
    page: createOcppPage({ activeKey: "ocpp-monitor", currentUser, unread, render, title: "OCPP 監控" }),
    activate() {
      void loadPageUnread({ scope, currentUser });
      scope.listen(document, "click", onMonitorClick);
      scope.listen(document, "input", onMonitorInput);
      scope.listen(document, "change", onMonitorChange);
      scope.listen(document, "keydown", onMonitorKeydown);
      if (state.tab === "logs") void loadLiveLogs();
      scheduleAutoRefresh();
    },
    captureState: () => ({
      tab: state.tab,
      autoRefresh: state.autoRefresh,
      pileQuery: state.pileQuery,
      direction: state.direction,
      logLimit: state.logLimit,
      expandedLog: state.expandedLog,
      logDate: logDate.captureState(),
      alarmDate: alarmDate.captureState(),
    }),
    dispose() {
      cancelAutoRefresh();
      if (activeInstance === instance) activeInstance = 0;
      if (activeScope === scope) activeScope = null;
      monitorRefreshBusy = false;
      logDate?.close();
      alarmDate?.close();
      data = null;
      context = null;
      state = null;
      tabs = [];
      logDate = null;
      alarmDate = null;
    },
  };
}
