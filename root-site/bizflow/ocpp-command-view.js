import { pileTypeKey } from "./ocpp-model.js";
import {
  canCancelOcppSchedule,
  getOcppCommandAvailability,
  isFutureOcppSchedule,
  mergeOcppCommandRows,
} from "./ocpp-command-model.js";
import { renderTable, statusChip } from "./ocpp-shared.js";

function escapeValue(helpers, value) {
  return helpers.escapeHtml(value ?? "—");
}

export function getOcppCommandRows(data, state) {
  return mergeOcppCommandRows(data.piles, state.commandStatus);
}

function commandTarget(action) {
  return `${action.cpId}${action.connectorId != null ? ` / ${action.connectorId}` : ""}`;
}

function commandTitle(kind, availability, ct) {
  if (!availability.authenticated) return ct("loggedOutReason");
  if (!availability.online) return ct("offlineReason");
  if (availability.busy) return ct("busyReason");
  if (
    ["unlock", "start", "schedule"].includes(kind) &&
    availability.connectorId == null
  ) {
    return ct("missingConnectorReason");
  }
  if (kind === "start" && availability.txId != null) {
    return ct("activeTransactionReason");
  }
  if (kind === "stop" && !availability.stop) {
    return ct("stopStateReason");
  }
  if (kind === "stop" && availability.txId == null) {
    return ct("stopFallbackHint");
  }
  return ct(`${kind}Hint`);
}

function renderCommandButton({
  kind,
  availability,
  rowIndex,
  helpers,
  t,
  ct,
}) {
  const e = (value) => escapeValue(helpers, value);
  const labelKeys = {
    reset: "restart",
    unlock: "unlock",
    start: "start",
    stop: "stop",
    schedule: "reserve",
  };
  return `<button type="button" data-ocpp-command="${kind}" data-ocpp-command-row="${rowIndex}"${availability[kind] ? "" : " disabled"} title="${e(commandTitle(kind, availability, ct))}">${e(t(labelKeys[kind]))}</button>`;
}

function formatCommandTime(value, lang) {
  if (value == null || value === "") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const locale = {
    zh: "zh-HK",
    en: "en-GB",
    fr: "fr-FR",
  }[lang || "zh"];
  return parsed.toLocaleString(locale, { hour12: false });
}

function renderSchedules({ state, helpers, t, ct }) {
  const e = (value) => escapeValue(helpers, value);
  const scheduleError = state.commandScheduleError
    ? `<div class="ocpp-command-alert ocpp-command-alert--error" role="alert">${e(ct("scheduleUnavailable", { detail: state.commandScheduleError }))}</div>`
    : "";
  const rows = state.commandSchedules
    .map((schedule, index) => {
      const cancellable =
        state.commandAuthenticated &&
        !state.actionBusy &&
        canCancelOcppSchedule(schedule);
      const cancelTitle = !state.commandAuthenticated
        ? ct("loggedOutReason")
        : state.actionBusy
          ? ct("busyReason")
          : canCancelOcppSchedule(schedule)
            ? ct("cancelSchedule")
            : ct("pendingOnlyReason");
      return `<tr><td class="ocpp-mono">${e(schedule.scheduleId)}</td><td class="ocpp-mono">${e(schedule.chargePointId)}</td><td>${e(schedule.connectorId)}</td><td class="ocpp-mono">${e(schedule.tagId)}</td><td>${e(formatCommandTime(schedule.scheduledTime, helpers.lang))}</td><td>${e(formatCommandTime(schedule.createdAt, helpers.lang))}</td><td>${e(schedule.status)}</td><td>${e(schedule.result)}</td><td>${e(formatCommandTime(schedule.triggeredAt, helpers.lang))}</td><td>${e(schedule.comment)}</td><td><button type="button" class="ocpp-link" data-ocpp-schedule-cancel="${index}"${cancellable ? "" : " disabled"} title="${e(cancelTitle)}">${e(ct("cancelSchedule"))}</button></td></tr>`;
    })
    .join("");
  return `<section class="ocpp-command-schedules"><h2>${e(ct("schedules"))}</h2>${scheduleError}${renderTable([ct("scheduleId"), t("pileNo"), t("connectorNo"), t("tag"), ct("scheduledAt"), ct("createdAt"), t("status"), ct("result"), ct("triggeredAt"), ct("comment"), t("actions")], rows, { emptyText: ct("noSchedules"), helpers, minWidth: "xwide", attrs: `data-ocpp-schedules="${state.commandSchedules.length}"` })}</section>`;
}

function pendingCommandCopy(action, ct) {
  const target = commandTarget(action);
  if (action.kind === "reset") {
    return {
      title: ct("confirmReset"),
      body: ct("resetConsequence", { target }),
    };
  }
  if (action.kind === "unlock") {
    return {
      title: ct("confirmUnlock"),
      body: ct("unlockConsequence", { target }),
    };
  }
  if (action.kind === "stop") {
    return {
      title: ct("confirmStop"),
      body: ct("stopConsequence", { target, txId: action.txId }),
    };
  }
  if (action.kind === "start") {
    return {
      title: ct("startTitle"),
      body: ct("startConsequence", { target }),
    };
  }
  if (action.kind === "schedule") {
    return {
      title: ct("scheduleTitle"),
      body: ct("scheduleConsequence", { target }),
    };
  }
  return {
    title: ct("cancelScheduleTitle"),
    body: ct("cancelScheduleConsequence", {
      scheduleId: action.schedule?.scheduleId,
    }),
  };
}

function renderPendingCommand({ state, helpers, t, ct }) {
  const action = state.pendingAction;
  if (!action) return "";
  const e = (value) => escapeValue(helpers, value);
  const copy = pendingCommandCopy(action, ct);
  const startFields =
    action.kind === "start"
      ? `<label class="ocpp-command-field"><span>${e(ct("tagLabel"))}</span><input class="ocpp-filter-control" data-ocpp-command-tag value="${e(action.tagId)}" placeholder="${e(ct("tagPlaceholder"))}" autocomplete="off"${state.actionBusy ? " disabled" : ""}></label>`
      : "";
  const scheduleFields =
    action.kind === "schedule"
      ? `<label class="ocpp-command-field"><span>${e(ct("scheduleTime"))}</span><input class="ocpp-filter-control" type="datetime-local" data-ocpp-command-time value="${e(action.scheduledAt)}"${state.actionBusy ? " disabled" : ""}></label><label class="ocpp-command-field"><span>${e(ct("tagLabel"))}</span><input class="ocpp-filter-control" data-ocpp-command-tag value="${e(action.tagId)}" placeholder="${e(ct("tagPlaceholder"))}" autocomplete="off"${state.actionBusy ? " disabled" : ""}></label><p class="ocpp-command-form-hint" data-ocpp-command-time-hint${isFutureOcppSchedule(action.scheduledAt) ? "" : ' data-invalid="true"'}>${isFutureOcppSchedule(action.scheduledAt) ? "" : e(ct("chooseFuture"))}</p>`
      : "";
  const requiresTag = ["start", "schedule"].includes(action.kind);
  const invalidTag = requiresTag && !String(action.tagId || "").trim();
  const invalidTime =
    action.kind === "schedule" &&
    !isFutureOcppSchedule(action.scheduledAt);
  const confirmLabel =
    action.kind === "schedule" ? ct("createSchedule") : ct("confirm");
  return `<div class="ocpp-overlay" data-ocpp-modal-dismiss role="presentation"><section class="ocpp-modal ocpp-command-modal" role="dialog" aria-modal="true" aria-labelledby="ocpp-command-modal-title"><header><div><h2 id="ocpp-command-modal-title">${e(copy.title)}</h2></div><button type="button" data-ocpp-modal-close aria-label="${e(t("close"))}"${state.actionBusy ? " disabled" : ""}>×</button></header><p>${e(copy.body)}</p><div class="ocpp-command-form">${startFields}${scheduleFields}</div><footer class="ocpp-command-modal-actions"><button type="button" class="ocpp-link" data-ocpp-modal-close${state.actionBusy ? " disabled" : ""}>${e(ct("cancel"))}</button><button type="button" class="ocpp-primary" data-ocpp-command-confirm${state.actionBusy || invalidTag || invalidTime ? " disabled" : ""}>${e(state.actionBusy ? ct("processing") : confirmLabel)}</button></footer></section></div>`;
}

function renderCommandToast({ state, helpers, t }) {
  if (!state.commandToast.message) return "";
  const e = (value) => escapeValue(helpers, value);
  return `<div class="ocpp-command-toast ocpp-command-toast--${e(state.commandToast.kind)}" role="status"><span>${e(state.commandToast.message)}</span><button type="button" data-ocpp-toast-close aria-label="${e(t("close"))}">×</button></div>`;
}

export function renderOcppCommandStatus({ data, state, helpers, t, ct }) {
  const e = (value) => escapeValue(helpers, value);
  const mergedRows = getOcppCommandRows(data, state);
  const rows = mergedRows
    .map((entry, rowIndex) => {
      const row = entry.snapshot;
      const availability = getOcppCommandAvailability({
        authenticated: state.commandAuthenticated,
        onlineRow: entry.online,
        busy: state.actionBusy,
      });
      const displayStatus = availability.online
        ? availability.status || row.status
        : row.status;
      const pileType = pileTypeKey(row.pileType);
      const actions = ["reset", "unlock", "start", "stop", "schedule"]
        .map((kind) =>
          renderCommandButton({
            kind,
            availability,
            rowIndex,
            helpers,
            t,
            ct,
          }),
        )
        .join("");
      return `<tr><td class="ocpp-mono">${e(entry.cpId)}</td><td>${e(row.name)}</td><td>${e(pileType === "public" ? t("public") : pileType === "private" ? t("private") : t("unassigned"))}</td><td>${statusChip(displayStatus, { helpers, t })}</td><td>${availability.online ? statusChip("normal", { helpers, t, labelKey: "online" }) : statusChip("hidden", { helpers, t, labelKey: "offline" })}</td><td>${e(availability.connectorId)}</td><td>${e(availability.txId)}</td><td>${e(row.connectorTotal)}</td><td>${e(row.availableConnectorTotal)}</td><td>${e(row.faultConnectorTotal)}</td><td>${e(row.threePhase == null ? "—" : row.threePhase ? t("yes") : t("no"))}</td><td><div class="ocpp-actions">${actions}</div></td></tr>`;
    })
    .join("");
  const onlineCount = mergedRows.filter((row) => row.online).length;
  const statusError = state.commandStatusError
    ? `<div class="ocpp-command-alert ocpp-command-alert--error" role="alert">${e(ct("statusUnavailable", { detail: state.commandStatusError }))}</div>`
    : "";
  return `<div class="ocpp-toolbar"><label class="ocpp-check"><input type="checkbox" data-ocpp-auto${state.autoRefresh ? " checked" : ""}><span>${e(t("autoRefresh"))}</span></label><span>${e(ct("onlineSource"))}</span><strong>${onlineCount} / ${mergedRows.length}</strong></div>${statusError}${renderTable([t("pileNo"), t("name"), t("type"), t("status"), t("onlineStatus"), t("connectorNo"), t("transactionId"), t("connectors"), t("availableConnectors"), t("faultConnectors"), t("phase"), t("actions")], rows, { emptyText: t("empty"), helpers, minWidth: "xwide", attrs: `data-ocpp-command-buttons="${mergedRows.length * 5}" data-ocpp-online-rows="${onlineCount}"` })}${renderSchedules({ state, helpers, t, ct })}${renderPendingCommand({ state, helpers, t, ct })}${renderCommandToast({ state, helpers, t })}`;
}

export function syncOcppCommandForm({
  state,
  ct,
  root = document,
}) {
  const action = state?.pendingAction;
  const confirm = root.querySelector("[data-ocpp-command-confirm]");
  if (!action || !confirm) return;
  const invalidTag =
    ["start", "schedule"].includes(action.kind) &&
    !String(action.tagId || "").trim();
  const invalidTime =
    action.kind === "schedule" &&
    !isFutureOcppSchedule(action.scheduledAt);
  confirm.disabled = state.actionBusy || invalidTag || invalidTime;
  const hint = root.querySelector("[data-ocpp-command-time-hint]");
  if (hint) {
    hint.textContent = invalidTime ? ct("chooseFuture") : "";
    if (invalidTime) hint.setAttribute("data-invalid", "true");
    else hint.removeAttribute("data-invalid");
  }
}
