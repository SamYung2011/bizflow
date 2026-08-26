import { createBizflowMenu } from "../components/bizflow-menu.js";
import { createDateRangePanel } from "../components/date-range-panel.js";
import { displayDateInput } from "../components/date-value.js";
import { getSession } from "../data/auth.js";
import { getCurrentUser } from "../data/provider.js";
import { cachedPageUnread, loadPageUnread } from "../data/page-unread.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
  formatFeedbackTime,
  normalizeFeedbackLogStatus,
  safeHttpUrl,
} from "./app-feedback-api.js";
import {
  createDeviceUnbindController,
  createDeviceUnbindState,
  renderDeviceUnbind,
} from "./app-feedback-device.js";
import {
  createOtaPackageController,
  createOtaPackageState,
  renderOtaPackage,
} from "./app-feedback-ota.js";
import { translateAppFeedback } from "./app-feedback-i18n.js";
import {
  applyFeedbackListPayload,
  createFeedbackPoller,
  feedbackListSignature,
  feedbackStateSignature,
} from "./app-feedback-poller.js";

const PAGE_SIZE = 20;
export const ADAPTER_SESSION_HISTORY_DAYS = 90;
const adapterSessionDatePanel = createDateRangePanel();
let state = null;
let helpers = null;
let activeScope = null;
let activePoller = null;
let activeDeviceController = null;
let activeOtaController = null;
let instanceSequence = 0;
let activeInstance = 0;

function t(key, values = {}) {
  return translateAppFeedback(helpers?.lang || "zh", key, values);
}

function e(value) {
  return helpers.escapeHtml(value == null || value === "" ? "—" : value);
}

function rawE(value) {
  return helpers.escapeHtml(value ?? "");
}

function pageCount(targetState = state) {
  return Math.max(1, Math.ceil(targetState.total / PAGE_SIZE));
}

function currentHongKongDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function adapterSessionMinDate(today = currentHongKongDate()) {
  const match = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() - ADAPTER_SESSION_HISTORY_DAYS);
  return date.toISOString().slice(0, 10);
}

function createAdapterDeviceState(saved = {}) {
  const kind = saved.adapterKind === "dc-pro" ? "dc-pro" : "flash";
  return {
    kind,
    rows: [],
    total: 0,
    page:
      Number.isInteger(saved.adapterPage) && saved.adapterPage > 0
        ? saved.adapterPage
        : 1,
    queryInput:
      typeof saved.adapterQuery === "string" ? saved.adapterQuery : "",
    query: typeof saved.adapterQuery === "string" ? saved.adapterQuery : "",
    loading: false,
    error: null,
    request: 0,
    detailDevice: null,
    detailDate: kind === "flash" ? currentHongKongDate() : "",
    sessions: [],
    sessionTotal: 0,
    sessionPage: 1,
    sessionLoading: false,
    sessionError: null,
    sessionRequest: 0,
    downloadingUploadId: null,
    downloadError: null,
    actionConfirm: null,
    actionLoading: false,
    actionError: null,
    actionResult: null,
    actionLookupId: null,
  };
}

function adapterPageCount() {
  return Math.max(1, Math.ceil((state?.adapters?.total || 0) / PAGE_SIZE));
}

export function adapterActionsForKind(kind) {
  return kind === "flash"
    ? ["unbind", "force_ota", "lock", "unlock"]
    : kind === "dc-pro"
      ? ["unbind"]
      : [];
}

export function flashUnbindDisabled(device) {
  const certid = String(device?.certid ?? "").trim();
  const expectedUserId = String(device?.binding?.userId ?? "").trim();
  return (
    !certid ||
    !expectedUserId ||
    expectedUserId === "0" ||
    device?.charging === true
  );
}

export function flashUnbindRequest(device) {
  if (device?.charging === true) {
    throw new HonnmonoAdminError("device_charging", 409);
  }
  const certid = String(device?.certid ?? "").trim();
  const expectedUserId = String(device?.binding?.userId ?? "").trim();
  if (!certid || !expectedUserId || expectedUserId === "0") {
    throw new HonnmonoAdminError("requestError");
  }
  return {
    path: `/devices/flash/${encodeURIComponent(certid)}/unbind`,
    body: { expectedUserId },
  };
}

export function adapterSessionSubPath({ kind, certid, date, page = 1 }) {
  if (!["flash", "dc-pro"].includes(kind) || !certid) return "";
  const params = new URLSearchParams({
    page: String(Math.max(1, Number(page) || 1)),
    pageSize: String(PAGE_SIZE),
  });
  if (date) params.set("date", String(date));
  return `/devices/${kind}/${encodeURIComponent(String(certid))}/sessions?${params}`;
}

export function adapterOtaPackages(packageInfo) {
  return [packageInfo?.current, ...(packageInfo?.backups || [])]
    .filter((item) => item?.filename)
    .map((item) => ({ ...item }));
}

function canAccessFeedback(currentUser, session) {
  return Boolean(
    session?.user &&
      typeof currentUser?.hasPermission === "function" &&
      currentUser.isBfAdmin === true,
  );
}

function requireFeedbackRouteAccess(
  currentUser,
  session,
  { url, navigation },
) {
  if (canAccessFeedback(currentUser, session)) return;
  navigation.hardNavigate(new URL("./home.html", url), { replace: true });
  throw new DOMException("Honnmono APP admin access required", "AbortError");
}

function errorCopy(error) {
  const code =
    error instanceof HonnmonoAdminError ? error.code : "networkError";
  if (code === "upstreamError") {
    return t(code, { status: error?.status || "—" });
  }
  return t(code);
}

function deviceErrorCopy(error) {
  if (error instanceof HonnmonoAdminError) {
    if (error.code === "imeiValidation") return t("imeiValidation");
    if (error.code === "imei_ambiguous") return t("imeiAmbiguousError");
    if (error.code === "device_charging") return t("flashUnbindChargingBlocked");
    if (error.status === 404) return t("deviceNotFoundError");
    if (error.status === 409) return t("bindingChangedError");
  }
  return errorCopy(error);
}

function otaErrorCopy(error) {
  if (error instanceof HonnmonoAdminError) {
    if (error.status === 403) return t("otaPermissionError");
    if (
      [
        "otaFileRequired",
        "otaFileType",
        "otaFileEmpty",
        "otaFileTooLarge",
        "otaFileReadError",
        "otaVersionFormat",
      ].includes(error.code)
    ) {
      return t(error.code);
    }
  }
  return errorCopy(error);
}

function selectOptions(values, selected) {
  return values
    .map(
      (value) =>
        `<option value="${rawE(value)}"${String(value) === String(selected) ? " selected" : ""}>${e(value)}</option>`,
    )
    .join("");
}

function renderLogBadge(row, { linkExternal = false } = {}) {
  const status = normalizeFeedbackLogStatus(row);
  const badge = `<span class="app-feedback-badge app-feedback-badge--${status}">${rawE(t(status))}</span>`;
  const externalUrl =
    status === "external" ? safeHttpUrl(row?.logExternalUrl) : "";
  if (!linkExternal || !externalUrl) return badge;
  return `<a class="app-feedback-external" href="${rawE(externalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${rawE(t("openExternal"))}">${badge}</a>`;
}

function renderRows() {
  if (state.loading && state.rows.length === 0) {
    return `<tr><td class="app-feedback-empty" colspan="8">${rawE(t("loading"))}</td></tr>`;
  }
  if (state.rows.length === 0) {
    return `<tr><td class="app-feedback-empty" colspan="8">${rawE(t("noRecords"))}</td></tr>`;
  }
  return state.rows
    .map(
      (row) => `<tr>
        <td class="app-feedback-table__time">${e(formatFeedbackTime(row.createTime, helpers.lang))}</td>
        <td>${e(row.clientModel)}</td>
        <td class="app-feedback-table__version">${e(row.appVersion)}</td>
        <td class="app-feedback-table__contact">${e(row.contact)}</td>
        <td class="app-feedback-table__content"><div class="app-feedback-clamp" title="${rawE(row.content)}">${e(row.content)}</div></td>
        <td class="app-feedback-table__status">${rawE(t("statusValue", { value: row.status ?? "—" }))}</td>
        <td>${renderLogBadge(row, { linkExternal: true })}</td>
        <td><button type="button" class="app-feedback-button" data-feedback-detail="${rawE(row.id)}">${rawE(t("details"))}</button></td>
      </tr>`,
    )
    .join("");
}

function renderToolbar() {
  return `<div class="app-feedback-toolbar">
    <select class="app-feedback-control" data-feedback-client aria-label="${rawE(t("clientModel"))}"${state.loading ? " disabled" : ""}>
      <option value="">${rawE(t("allClients"))}</option>
      ${selectOptions(state.facets.clientModels, state.clientModel)}
    </select>
    <select class="app-feedback-control" data-feedback-version aria-label="${rawE(t("appVersion"))}"${state.loading ? " disabled" : ""}>
      <option value="">${rawE(t("allVersions"))}</option>
      ${selectOptions(state.facets.appVersions, state.appVersion)}
    </select>
    <select class="app-feedback-control" data-feedback-status aria-label="${rawE(t("status"))}"${state.loading ? " disabled" : ""}>
      <option value="">${rawE(t("allStatuses"))}</option>
      ${state.facets.statuses
        .map(
          (value) =>
            `<option value="${rawE(value)}"${String(value) === state.status ? " selected" : ""}>${rawE(t("statusValue", { value }))}</option>`,
        )
        .join("")}
    </select>
    <form class="app-feedback-search" data-feedback-search>
      <input class="app-feedback-control" data-feedback-query value="${rawE(state.searchInput)}" placeholder="${rawE(t("searchPlaceholder"))}" aria-label="${rawE(t("searchAria"))}"${state.loading ? " disabled" : ""}>
      <button type="submit" class="app-feedback-button app-feedback-button--primary"${state.loading ? " disabled" : ""}>${rawE(t("search"))}</button>
    </form>
    <span class="app-feedback-total">${rawE(t("total", { count: state.total }))}</span>
  </div>`;
}

function renderTable() {
  const headers = [
    "createdAt",
    "clientModel",
    "appVersion",
    "contact",
    "content",
    "status",
    "log",
    "actions",
  ];
  return `<div class="app-feedback-table-shell">
    <table class="app-feedback-table">
      <thead><tr>${headers.map((key) => `<th>${rawE(t(key))}</th>`).join("")}</tr></thead>
      <tbody>${renderRows()}</tbody>
    </table>
  </div>`;
}

function renderPager() {
  const pages = pageCount();
  return `<nav class="app-feedback-pager" aria-label="${rawE(t("page", { page: state.page, pages }))}">
    <span>${rawE(t("page", { page: state.page, pages }))}</span>
    <button type="button" class="app-feedback-button" data-feedback-page="${state.page - 1}"${state.page <= 1 || state.loading ? " disabled" : ""}>${rawE(t("previous"))}</button>
    <button type="button" class="app-feedback-button" data-feedback-page="${state.page + 1}"${state.page >= pages || state.loading ? " disabled" : ""}>${rawE(t("next"))}</button>
  </nav>`;
}

function renderNewFeedbackNotice() {
  const count = state.newFeedbackCount;
  return `<button type="button" class="app-feedback-new" data-feedback-new aria-live="polite"${count > 0 ? "" : " hidden"}>${count > 0 ? rawE(t("newFeedback", { count })) : ""}</button>`;
}

function detailRow(labelKey, value, { mono = false, html = false } = {}) {
  return `<div class="app-feedback-detail-row${mono ? " app-feedback-detail-row--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${html ? value : e(value)}</dd></div>`;
}

function detailSection(titleKey, content) {
  return `<section class="app-feedback-detail-section"><h3>${rawE(t(titleKey))}</h3>${content}</section>`;
}

function renderDetailLog(detail) {
  const status = normalizeFeedbackLogStatus(detail);
  const externalUrl =
    status === "external" ? safeHttpUrl(detail.logExternalUrl) : "";
  let action = `<button type="button" class="app-feedback-button" disabled>${rawE(t("expired"))}</button>`;
  if (status === "available") {
    const busy = state.downloadingId === detail.id;
    action = `<button type="button" class="app-feedback-button" data-feedback-download="${rawE(detail.id)}"${busy ? " disabled" : ""}>${rawE(t(busy ? "preparingDownload" : "downloadLog"))}</button>`;
  } else if (externalUrl) {
    action = `<a class="app-feedback-button app-feedback-external" href="${rawE(externalUrl)}" target="_blank" rel="noopener noreferrer">${rawE(t("openExternal"))}</a>`;
  }
  return detailSection(
    "logSection",
    `<div class="app-feedback-log-row">${renderLogBadge(detail)}${detail.logFilename ? `<span class="app-feedback-log-name">${e(detail.logFilename)}</span>` : ""}${action}</div>`,
  );
}

function renderDetail(detail) {
  return [
    detailSection(
      "basicInfo",
      `<dl>
        ${detailRow("createdAt", formatFeedbackTime(detail.createTime, helpers.lang))}
        ${detailRow("status", t("statusValue", { value: detail.status ?? "—" }))}
        ${detailRow("username", detail.username)}
        ${detailRow("contact", detail.contact)}
        ${detailRow("contactType", detail.contactType)}
        ${detailRow("clientModel", detail.clientModel)}
        ${detailRow("appVersion", detail.appVersion)}
        ${detailRow("appModel", detail.appModel)}
        ${detailRow("country", detail.country)}
      </dl>`,
    ),
    detailSection(
      "feedbackContent",
      `<div class="app-feedback-detail-content">${e(detail.content)}</div>`,
    ),
    detailSection(
      "deviceInfo",
      `<dl>
        ${detailRow("deviceModel", detail.deviceModel)}
        ${detailRow("deviceBrand", detail.deviceBrand)}
        ${detailRow("deviceName", detail.deviceName)}
        ${detailRow("systemVersion", detail.deviceVersion)}
        ${detailRow("firmwareVersion", detail.fwversion)}
        ${detailRow("uuid", detail.uuid, { mono: true })}
        ${detailRow("imei", detail.imei, { mono: true })}
        ${detailRow("carrier", detail.deviceSp)}
      </dl>`,
    ),
    detailSection(
      "handlingInfo",
      `<dl>
        ${detailRow("answer", detail.answer)}
        ${detailRow("remark", detail.remark)}
        ${detailRow("faqLink", detail.faqLink)}
        ${detailRow("tenant", detail.tenant)}
        ${detailRow("dispatched", detail.isDispatched)}
        ${detailRow("newMessage", detail.hasNewMsg)}
      </dl>`,
    ),
    renderDetailLog(detail),
  ].join("");
}

function renderDrawer() {
  if (state.selectedId == null) return "";
  let body = `<div class="app-feedback-empty">${rawE(t("loading"))}</div>`;
  if (state.detailError) {
    body = `<div class="app-feedback-alert">${rawE(t("detailError", { message: errorCopy(state.detailError) }))}</div>`;
  } else if (state.detail) {
    body = `${state.downloadError ? `<div class="app-feedback-alert">${rawE(t("downloadError", { message: errorCopy(state.downloadError) }))}</div>` : ""}${renderDetail(state.detail)}`;
  }
  return `<div class="app-feedback-overlay" data-feedback-drawer>
    <aside class="app-feedback-drawer" role="dialog" aria-modal="true" aria-labelledby="app-feedback-detail-title">
      <header class="app-feedback-drawer__head">
        <div>
          <h2 id="app-feedback-detail-title">${rawE(t("feedbackDetails"))} #${rawE(state.selectedId)}</h2>
          <p>${rawE(t("detailSubtitle"))}</p>
        </div>
        <button type="button" class="app-feedback-button" data-feedback-close>${rawE(t("close"))}</button>
      </header>
      <div class="app-feedback-drawer__body">${body}</div>
    </aside>
  </div>`;
}

function renderFeedbackPanel() {
  const error = state.listError
    ? `<div class="app-feedback-alert">${rawE(t("listError", { message: errorCopy(state.listError) }))}</div>`
    : "";
  return `<div class="app-feedback-card">
    ${renderToolbar()}
    ${error}
    ${renderNewFeedbackNotice()}
    ${renderTable()}
    ${renderPager()}
  </div>
  ${renderDrawer()}`;
}

function adapterDeviceId(device) {
  return String(device?.certid || device?.devid || device?.uuid || "");
}

function adapterDeviceName(device) {
  return String(
    device?.name ||
      device?.devid ||
      device?.imei ||
      device?.certid ||
      device?.uuid ||
      "",
  );
}

function adapterOwner(device) {
  return String(
    device?.binding?.username ||
      device?.binding?.contact ||
      device?.binding?.userId ||
      "",
  );
}

function metric(value, unit = "") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}${unit}` : "—";
}

export function adapterLiveMetrics(device) {
  if (!device?.charging) return { watts: 0, volts: 0, amps: 0, kwh: 0 };
  const charger = device.charger || {};
  return {
    watts: charger.watts,
    volts: charger.volts,
    amps: charger.amps,
    kwh: charger.kwh,
  };
}

function durationText(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 3600) {
    return t("durationMinutes", { minutes: Math.max(1, Math.round(seconds / 60)) });
  }
  return t("durationHours", { hours: (seconds / 3600).toFixed(1) });
}

function renderAdapterCards() {
  const adapters = state.adapters;
  if (adapters.loading && adapters.rows.length === 0) {
    return `<div class="app-feedback-device-empty">${rawE(t("devicesLoading"))}</div>`;
  }
  if (adapters.rows.length === 0) {
    return `<div class="app-feedback-device-empty">${rawE(t("noDevices"))}</div>`;
  }
  return `<div class="app-feedback-adapter-grid">${adapters.rows
    .map((device) => {
      const kind = adapters.kind;
      const id = adapterDeviceId(device);
      const imei = String(device?.imei || "");
      const owner = adapterOwner(device);
      const live = adapterLiveMetrics(device);
      const firmware =
        typeof device?.firmware === "object"
          ? device.firmware
          : { software: device?.firmware };
      const bindingUserId = String(device?.binding?.userId ?? "").trim();
      const unbindDisabled =
        kind === "flash"
          ? flashUnbindDisabled(device)
          : !/^\d{15}$/.test(imei) || !bindingUserId || bindingUserId === "0";
      const unbindLabelKey =
        kind === "flash" ? "flashUnbindDevice" : "unbindDevice";
      const availableActions = adapterActionsForKind(kind);
      const actionBusy =
        state.adapters.actionLoading || state.adapters.actionLookupId === id;
      return `<article class="app-feedback-device-binding app-feedback-adapter-card">
        <header class="app-feedback-device-binding__head">
          <div>
            <h2>${e(adapterDeviceName(device))}</h2>
            <span class="app-feedback-device-status app-feedback-device-status--${device.online ? "bound" : "unbound"}">${rawE(t(device.online ? "online" : "offline"))}</span>
            <span class="app-feedback-device-status app-feedback-device-status--${device.charging ? "bound" : "unbound"}">${rawE(t(device.charging ? "charging" : "idle"))}</span>
            ${kind === "flash" ? `<span class="app-feedback-device-status app-feedback-device-status--${device.locked ? "bound" : "unbound"}">${rawE(t(device.locked ? "locked" : "unlocked"))}</span>` : ""}
          </div>
        </header>
        <dl class="app-feedback-device-details">
          ${detailRow("imei", imei, { mono: true })}
          ${detailRow("uuid", id, { mono: true })}
          ${detailRow("deviceModel", device.model)}
          ${detailRow("boundAccount", owner || t("unboundAccount"))}
          ${detailRow("softwareVersion", firmware.software || device.firmware)}
          ${detailRow("hardwareVersion", firmware.hardware)}
          ${detailRow("lastHeartbeat", formatFeedbackTime(device.lastHeartbeatAt || device.lastStatusTime, helpers.lang))}
          ${detailRow("chargeCount", t("chargeCount", { count: Number(device.chargeCount) || 0 }))}
        </dl>
        <section class="app-feedback-adapter-live" aria-label="${rawE(t("realtimeData"))}">
          <div><strong>${e(metric(live.watts, " W"))}</strong><span>${rawE(t("power"))}</span></div>
          <div><strong>${e(metric(live.volts, " V"))}</strong><span>${rawE(t("voltage"))}</span></div>
          <div><strong>${e(metric(live.amps, " A"))}</strong><span>${rawE(t("current"))}</span></div>
          <div><strong>${e(metric(live.kwh, " kWh"))}</strong><span>${rawE(t("chargedKwh"))}</span></div>
        </section>
        <div class="app-feedback-adapter-actions">
          <button type="button" class="app-feedback-button" data-adapter-detail="${rawE(id)}"${!device.certid || actionBusy ? " disabled" : ""}>${rawE(t("viewSessions"))}</button>
          ${availableActions.includes("unbind") ? `<button type="button" class="app-feedback-button app-feedback-button--danger" data-adapter-action="unbind" data-adapter-id="${rawE(id)}"${kind === "flash" && device.charging ? ` title="${rawE(t("flashUnbindChargingBlocked"))}"` : ""}${unbindDisabled || actionBusy ? " disabled" : ""}>${rawE(t(unbindLabelKey))}</button>` : ""}
          ${availableActions.includes("force_ota") ? `<button type="button" class="app-feedback-button" data-adapter-action="force_ota" data-adapter-id="${rawE(id)}"${actionBusy ? " disabled" : ""}>${rawE(t("forceOta"))}</button>
          <button type="button" class="app-feedback-button" data-adapter-action="lock" data-adapter-id="${rawE(id)}"${actionBusy ? " disabled" : ""}>${rawE(t("lockDevice"))}</button>
          <button type="button" class="app-feedback-button" data-adapter-action="unlock" data-adapter-id="${rawE(id)}"${actionBusy ? " disabled" : ""}>${rawE(t("unlockDevice"))}</button>` : ""}
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderAdapterActionConfirm() {
  const confirm = state.adapters.actionConfirm;
  if (!confirm) return "";
  const device = confirm.device;
  const packages = Array.isArray(confirm.packages) ? confirm.packages : [];
  const actionKey = {
    unbind: state.adapters.kind === "flash" ? "flashUnbindDevice" : "unbindDevice",
    force_ota: "forceOta",
    lock: "lockDevice",
    unlock: "unlockDevice",
  }[confirm.action];
  return `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-adapter-confirm-overlay>
    <section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="app-feedback-adapter-confirm-title">
      <h2 id="app-feedback-adapter-confirm-title">${rawE(t("actionConfirmTitle"))}</h2>
      <p>${rawE(t(confirm.action === "unbind" && state.adapters.kind === "flash" ? "flashUnbindConfirmText" : "actionConfirmText"))}</p>
      <dl class="app-feedback-device-confirm__details">
        ${detailRow("actions", t(actionKey))}
        ${detailRow("uuid", adapterDeviceId(device), { mono: true })}
        ${detailRow("imei", device.imei, { mono: true })}
        ${detailRow("boundAccount", adapterOwner(device) || t("unboundAccount"))}
      </dl>
      ${confirm.action === "force_ota" ? `<label class="app-feedback-ota-file">
        <span>${rawE(t("chooseOtaPackage"))}</span>
        <select class="app-feedback-control" data-adapter-action-package>
          ${packages.map((item) => `<option value="${rawE(item.filename)}"${item.filename === confirm.package ? " selected" : ""}>${e(item.filename)}</option>`).join("")}
        </select>
      </label>
      <label class="app-feedback-ota-version">
        <span>${rawE(t("otaVersionOverride"))}</span>
        <input type="text" class="app-feedback-control" value="${rawE(confirm.versionInput || "")}" placeholder="${rawE(t("otaVersionPlaceholder"))}" data-adapter-action-version>
      </label>` : ""}
      ${state.adapters.actionError ? `<div class="app-feedback-alert">${rawE(t("deviceActionError", { message: deviceErrorCopy(state.adapters.actionError) }))}</div>` : ""}
      <div class="app-feedback-device-confirm__actions">
        <button type="button" class="app-feedback-button" data-adapter-confirm-cancel${state.adapters.actionLoading ? " disabled" : ""}>${rawE(t("cancel"))}</button>
        <button type="button" class="app-feedback-button app-feedback-button--danger" data-adapter-confirm-submit${state.adapters.actionLoading || (confirm.action === "force_ota" && !confirm.package) ? " disabled" : ""}>${rawE(t(state.adapters.actionLoading ? "refreshing" : "confirmAction"))}</button>
      </div>
    </section>
  </div>`;
}

function renderAdapterSessions() {
  const adapters = state.adapters;
  const device = adapters.detailDevice;
  if (!device) return "";
  const sessionPages = Math.max(1, Math.ceil(adapters.sessionTotal / PAGE_SIZE));
  let body = `<div class="app-feedback-device-empty">${rawE(t("devicesLoading"))}</div>`;
  if (adapters.sessionError) {
    body = `<div class="app-feedback-alert">${rawE(t("sessionLoadError", { message: errorCopy(adapters.sessionError) }))}</div>`;
  } else if (!adapters.sessionLoading && adapters.sessions.length === 0) {
    body = `<div class="app-feedback-device-empty">${rawE(t("noSessions"))}</div>`;
  } else if (adapters.sessions.length) {
    body = `<div class="app-feedback-session-list">${adapters.sessions
      .map((session) => {
        const amapUrl = safeHttpUrl(session?.location?.amapUrl);
        const upload = session?.upload;
        return `<article class="app-feedback-device-binding app-feedback-session-card">
          <dl class="app-feedback-device-details">
            ${detailRow("chargeStart", formatFeedbackTime(session.startTime, helpers.lang))}
            ${detailRow("chargeEnd", formatFeedbackTime(session.endTime, helpers.lang))}
            ${detailRow("chargeDuration", durationText(session.durationSeconds))}
            ${detailRow("chargedKwh", metric(session.kwh, " kWh"))}
            ${detailRow("soc", metric(session.soc, "%"))}
            ${detailRow("location", amapUrl ? `<a href="${rawE(amapUrl)}" target="_blank" rel="noopener noreferrer">${rawE(t("openAmap"))}</a>` : t("no"), { html: true })}
          </dl>
          <div class="app-feedback-log-row">
            <span class="app-feedback-log-name">${upload ? e(upload.filename) : rawE(t("noReport"))}</span>
            ${upload ? `<button type="button" class="app-feedback-button" data-adapter-report="${rawE(upload.id)}"${adapters.downloadingUploadId === Number(upload.id) ? " disabled" : ""}>${rawE(t(adapters.downloadingUploadId === Number(upload.id) ? "downloadingReport" : "downloadReport"))}</button>` : ""}
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }
  return `<div class="app-feedback-overlay" data-adapter-drawer>
    <aside class="app-feedback-drawer" role="dialog" aria-modal="true" aria-labelledby="app-feedback-session-title">
      <header class="app-feedback-drawer__head">
        <div><h2 id="app-feedback-session-title">${rawE(t("sessionTitle"))}</h2><p>${e(adapterDeviceName(device))} · ${rawE(t("sessionSubtitle"))}</p></div>
        <button type="button" class="app-feedback-button" data-adapter-drawer-close>${rawE(t("close"))}</button>
      </header>
      <div class="app-feedback-drawer__body">
        <div class="app-feedback-ota-version"><span>${rawE(t("sessionDate"))}</span><button type="button" class="date-panel-trigger" data-adapter-session-date aria-haspopup="dialog" aria-expanded="${adapterSessionDatePanel.isOpen()}">${helpers.icon("icon-task-calendar", "icon")}<span class="date-panel-trigger__value">${rawE(displayDateInput(adapters.detailDate) || t("sessionDate"))}</span></button></div>
        ${adapters.downloadError ? `<div class="app-feedback-alert">${rawE(t("reportDownloadError", { message: errorCopy(adapters.downloadError) }))}</div>` : ""}
        ${body}
        <nav class="app-feedback-pager" aria-label="${rawE(t("page", { page: adapters.sessionPage, pages: sessionPages }))}">
          <span>${rawE(t("page", { page: adapters.sessionPage, pages: sessionPages }))}</span>
          <button type="button" class="app-feedback-button" data-adapter-session-page="${adapters.sessionPage - 1}"${adapters.sessionPage <= 1 || adapters.sessionLoading ? " disabled" : ""}>${rawE(t("previous"))}</button>
          <button type="button" class="app-feedback-button" data-adapter-session-page="${adapters.sessionPage + 1}"${adapters.sessionPage >= sessionPages || adapters.sessionLoading ? " disabled" : ""}>${rawE(t("next"))}</button>
        </nav>
      </div>
    </aside>
  </div>`;
}

function renderAdapterPanel() {
  const adapters = state.adapters;
  const pages = adapterPageCount();
  return `<div class="app-feedback-device-panel">
    <div class="app-feedback-card">
      <nav class="app-feedback-tabs app-feedback-adapter-tabs" aria-label="${rawE(t("deviceListTab"))}">
        <button type="button" class="app-feedback-tab${adapters.kind === "flash" ? " is-active" : ""}" data-adapter-kind="flash">${rawE(t("flashAdapterTab"))}</button>
        <button type="button" class="app-feedback-tab${adapters.kind === "dc-pro" ? " is-active" : ""}" data-adapter-kind="dc-pro">${rawE(t("dcProAdapterTab"))}</button>
      </nav>
      <div class="app-feedback-toolbar app-feedback-adapter-toolbar">
        <form class="app-feedback-search" data-adapter-search>
          <input class="app-feedback-control" data-adapter-query value="${rawE(adapters.queryInput)}" placeholder="${rawE(t("deviceSearchPlaceholder"))}" aria-label="${rawE(t("deviceSearchAria"))}">
          <button type="submit" class="app-feedback-button app-feedback-button--primary"${adapters.loading ? " disabled" : ""}>${rawE(t("search"))}</button>
        </form>
        <span class="app-feedback-total">${rawE(t("totalDevices", { count: adapters.total }))}</span>
        <button type="button" class="app-feedback-button" data-adapter-refresh${adapters.loading ? " disabled" : ""}>${rawE(t(adapters.loading ? "refreshing" : "refresh"))}</button>
      </div>
      ${adapters.error ? `<div class="app-feedback-alert">${rawE(t("deviceListError", { message: errorCopy(adapters.error) }))}</div>` : ""}
      ${adapters.actionError && !adapters.actionConfirm ? `<div class="app-feedback-alert">${rawE(t("deviceActionError", { message: deviceErrorCopy(adapters.actionError) }))}</div>` : ""}
      ${adapters.actionResult ? `<div class="app-feedback-ota-success"><strong>${rawE(t(adapters.actionResult?.status === "unbound" ? "flashUnbindSuccess" : "deviceActionSuccess"))}</strong></div>` : ""}
      ${renderAdapterCards()}
      <nav class="app-feedback-pager" aria-label="${rawE(t("page", { page: adapters.page, pages }))}">
        <span>${rawE(t("page", { page: adapters.page, pages }))}</span>
        <button type="button" class="app-feedback-button" data-adapter-page="${adapters.page - 1}"${adapters.page <= 1 || adapters.loading ? " disabled" : ""}>${rawE(t("previous"))}</button>
        <button type="button" class="app-feedback-button" data-adapter-page="${adapters.page + 1}"${adapters.page >= pages || adapters.loading ? " disabled" : ""}>${rawE(t("next"))}</button>
      </nav>
    </div>
    ${renderAdapterActionConfirm()}
    ${renderAdapterSessions()}
  </div>`;
}

function renderTabs() {
  return `<nav class="app-feedback-tabs" aria-label="${rawE(t("honnmonoAppTitle"))}">
    <button type="button" class="app-feedback-tab${state.activeTab === "feedback" ? " is-active" : ""}" data-app-feedback-tab="feedback" aria-selected="${state.activeTab === "feedback"}">${rawE(t("feedbackTab"))}</button>
    <button type="button" class="app-feedback-tab${state.activeTab === "device" ? " is-active" : ""}" data-app-feedback-tab="device" aria-selected="${state.activeTab === "device"}">${rawE(t("deviceUnbindTab"))}</button>
    <button type="button" class="app-feedback-tab${state.activeTab === "devices" ? " is-active" : ""}" data-app-feedback-tab="devices" aria-selected="${state.activeTab === "devices"}">${rawE(t("deviceListTab"))}</button>
  </nav>`;
}

function render(nextHelpers) {
  helpers = nextHelpers;
  const isFeedback = state.activeTab === "feedback";
  const subtitleKey = isFeedback
    ? "subtitle"
    : state.activeTab === "devices"
      ? "deviceListSubtitle"
      : "deviceUnbindSubtitle";
  return `<section class="app-feedback-page" data-app-feedback-page>
    <header class="app-feedback-head">
      <div><h1>${rawE(t("honnmonoAppTitle"))}</h1><p>${rawE(t(subtitleKey))}</p></div>
      ${isFeedback ? `<button type="button" class="app-feedback-button app-feedback-button--refresh" data-feedback-refresh${state.loading ? " disabled" : ""}>${rawE(t(state.loading ? "refreshing" : "refresh"))}</button>` : ""}
    </header>
    ${renderTabs()}
    ${
      isFeedback
        ? renderFeedbackPanel()
        : state.activeTab === "devices"
          ? renderAdapterPanel()
          : `<div class="app-feedback-device-panel">
            ${renderDeviceUnbind({
              deviceState: state.device,
              t,
              escapeHtml: helpers.escapeHtml,
              formatTime: (value) => formatFeedbackTime(value, helpers.lang),
              errorCopy: deviceErrorCopy,
            })}
            ${renderOtaPackage({
              otaState: state.ota,
              t,
              escapeHtml: helpers.escapeHtml,
              formatTime: (value) => formatFeedbackTime(value, helpers.lang),
              errorCopy: otaErrorCopy,
            })}
          </div>`
    }
  </section>`;
}

function captureScrollState() {
  return {
    x: window.scrollX,
    y: window.scrollY,
    tableLeft:
      document.querySelector(".app-feedback-table-shell")?.scrollLeft || 0,
    drawerTop:
      document.querySelector(".app-feedback-drawer")?.scrollTop || 0,
  };
}

function restoreScrollState(scrollState) {
  window.scrollTo(scrollState.x, scrollState.y);
  const table = document.querySelector(".app-feedback-table-shell");
  if (table) table.scrollLeft = scrollState.tableLeft;
  const drawer = document.querySelector(".app-feedback-drawer");
  if (drawer) drawer.scrollTop = scrollState.drawerTop;
}

function rerender({ preserveScroll = false } = {}) {
  const page = document.querySelector("[data-app-feedback-page]");
  if (!page || !helpers) return;
  adapterSessionDatePanel.close();
  const scrollState = preserveScroll ? captureScrollState() : null;
  page.outerHTML = render(helpers);
  if (scrollState) restoreScrollState(scrollState);
}

function listSubPath(targetState) {
  const params = new URLSearchParams({
    page: String(targetState.page),
    pageSize: String(PAGE_SIZE),
  });
  if (targetState.clientModel) {
    params.set("clientModel", targetState.clientModel);
  }
  if (targetState.appVersion) {
    params.set("appVersion", targetState.appVersion);
  }
  if (targetState.status !== "") params.set("status", targetState.status);
  if (targetState.keyword) params.set("q", targetState.keyword);
  return `/feedback?${params}`;
}

function isActive(instance = activeInstance, scope = activeScope) {
  return instance === activeInstance && scope?.isCurrent() === true;
}

function updateNewFeedbackNotice() {
  const notice = document.querySelector("[data-feedback-new]");
  if (!notice || !state) return;
  const count = state.newFeedbackCount;
  notice.hidden = count <= 0;
  notice.textContent = count > 0 ? t("newFeedback", { count }) : "";
}

function clearPendingFeedback({ updateNotice = true } = {}) {
  if (!state) return;
  state.pendingListPayload = null;
  state.pendingListSignature = "";
  state.newFeedbackCount = 0;
  if (updateNotice) updateNewFeedbackNotice();
}

function acceptPendingFeedback() {
  if (!state?.pendingListPayload) return;
  const payload = state.pendingListPayload;
  clearPendingFeedback({ updateNotice: false });
  applyFeedbackListPayload(state, payload);
  rerender();
  activeScope?.animationFrame(() =>
    document
      .querySelector(".app-feedback-table-shell")
      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}

async function pollFeedbackList({ signal } = {}) {
  const instance = activeInstance;
  const scope = activeScope;
  if (
    !state ||
    !isActive(instance, scope) ||
    state.activeTab !== "feedback" ||
    document.visibilityState !== "visible" ||
    state.loading
  ) {
    return true;
  }

  const subPath = listSubPath(state);
  const listRequest = state.listRequest;
  let payload;
  try {
    payload = await callHonnmonoAdmin(subPath, { signal });
  } catch {
    return false;
  }

  if (
    !state ||
    !isActive(instance, scope) ||
    document.visibilityState !== "visible" ||
    listRequest !== state.listRequest ||
    subPath !== listSubPath(state)
  ) {
    return true;
  }

  const nextSignature = feedbackListSignature(payload);
  const currentSignature = feedbackStateSignature(state);
  if (!state.hasLoadedList || state.listError) {
    clearPendingFeedback({ updateNotice: false });
    applyFeedbackListPayload(state, payload);
    state.hasLoadedList = true;
    state.listError = null;
    rerender({ preserveScroll: true });
    return true;
  }
  if (nextSignature === currentSignature) {
    if (state.pendingListPayload) clearPendingFeedback();
    return true;
  }
  if (nextSignature === state.pendingListSignature) return true;

  const newFeedbackCount = Math.max(
    0,
    (Number(payload?.total) || 0) - state.total,
  );
  if (newFeedbackCount > 0) {
    state.pendingListPayload = payload;
    state.pendingListSignature = nextSignature;
    state.newFeedbackCount = newFeedbackCount;
    updateNewFeedbackNotice();
    return true;
  }

  clearPendingFeedback({ updateNotice: false });
  applyFeedbackListPayload(state, payload);
  rerender({ preserveScroll: true });
  return true;
}

async function loadList() {
  const instance = activeInstance;
  const scope = activeScope;
  if (
    !state ||
    state.activeTab !== "feedback" ||
    !isActive(instance, scope)
  ) {
    return;
  }
  const request = ++state.listRequest;
  clearPendingFeedback({ updateNotice: false });
  state.loading = true;
  state.listError = null;
  rerender();
  try {
    const payload = await callHonnmonoAdmin(listSubPath(state), {
      signal: scope.signal,
    });
    if (
      !isActive(instance, scope) ||
      request !== state.listRequest
    ) {
      return;
    }
    applyFeedbackListPayload(state, payload);
    state.hasLoadedList = true;
    if (state.page > pageCount()) {
      state.page = pageCount();
      void loadList();
      return;
    }
  } catch (error) {
    if (
      isActive(instance, scope) &&
      request === state.listRequest
    ) {
      state.rows = [];
      state.total = 0;
      state.listError = error;
    }
  } finally {
    if (
      isActive(instance, scope) &&
      request === state.listRequest
    ) {
      state.loading = false;
      rerender();
      activePoller?.restart();
    }
  }
}

function adapterListSubPath() {
  const params = new URLSearchParams({
    page: String(state.adapters.page),
    pageSize: String(PAGE_SIZE),
  });
  if (state.adapters.query) params.set("query", state.adapters.query);
  return `/devices/${state.adapters.kind}?${params}`;
}

function adapterListSignature(rows, total) {
  return JSON.stringify([
    Number(total) || 0,
    (Array.isArray(rows) ? rows : []).map((row) => [
      row?.certid ?? null,
      row?.devid ?? null,
      row?.imei ?? null,
      row?.online ?? null,
      row?.charging ?? null,
      row?.locked ?? null,
      row?.chargeCount ?? null,
      row?.lastHeartbeatAt ?? null,
      row?.binding?.userId ?? null,
      row?.charger?.status ?? null,
      row?.charger?.watts ?? null,
      row?.charger?.durationSeconds ?? null,
      row?.charger?.remainingSeconds ?? null,
      row?.charger?.progressPercent ?? null,
      row?.charger?.kwh ?? null,
      row?.firmware?.software ?? null,
    ]),
  ]);
}

// A background refresh must never repaint over something the operator is in
// the middle of: rerender() swaps the whole page via outerHTML, which would
// drop focus/caret out of the search box or the action dialog.
function adapterRefreshWouldInterrupt() {
  if (state.adapters.actionConfirm || state.adapters.actionLoading) return true;
  if (state.adapters.actionLookupId != null) return true;
  // rerender() closes the date popover, so do not repaint while it is open.
  if (adapterSessionDatePanel.isOpen()) return true;
  const focused = document.activeElement;
  return Boolean(
    focused?.closest?.("[data-app-feedback-page]") &&
      focused.matches?.("input, textarea, select"),
  );
}

async function loadAdapters({ silent = false, signal } = {}) {
  const instance = activeInstance;
  const scope = activeScope;
  if (!state || state.activeTab !== "devices" || !isActive(instance, scope)) {
    return true;
  }
  // A silent (poll-driven) refresh must not claim the request slot: a manual
  // load started afterwards has to win, and this one has to notice it lost.
  const request = silent ? state.adapters.request : ++state.adapters.request;
  if (!silent) {
    state.adapters.loading = true;
    state.adapters.error = null;
    rerender();
  }
  try {
    const payload = await callHonnmonoAdmin(adapterListSubPath(), {
      signal: signal || scope.signal,
    });
    if (!isActive(instance, scope) || request !== state.adapters.request) {
      return true;
    }
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    const total = Number(payload?.total) || 0;
    if (silent) {
      if (state.activeTab !== "devices") return true;
      const unchanged =
        adapterListSignature(rows, total) ===
        adapterListSignature(state.adapters.rows, state.adapters.total);
      if (unchanged || adapterRefreshWouldInterrupt()) return true;
      const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (state.adapters.page > lastPage) {
        // Rows vanished under this page: land on the new last page instead of
        // painting an empty table. Bounded — the page only ever shrinks.
        state.adapters.page = lastPage;
        return loadAdapters({ silent: true, signal });
      }
      state.adapters.rows = rows;
      state.adapters.total = total;
      state.adapters.error = null;
      rerender({ preserveScroll: true });
      return true;
    }
    state.adapters.rows = rows;
    state.adapters.total = total;
    if (state.adapters.page > adapterPageCount()) {
      state.adapters.page = adapterPageCount();
      void loadAdapters();
      return true;
    }
  } catch (error) {
    // A failed poll leaves the last good list on screen; only an explicit
    // load is allowed to blank the table and surface the error.
    if (silent) return false;
    if (isActive(instance, scope) && request === state.adapters.request) {
      state.adapters.rows = [];
      state.adapters.total = 0;
      state.adapters.error = error;
    }
  } finally {
    if (
      !silent &&
      isActive(instance, scope) &&
      request === state.adapters.request
    ) {
      state.adapters.loading = false;
      rerender();
    }
  }
  return true;
}

async function pollAdapterList({ signal } = {}) {
  const instance = activeInstance;
  const scope = activeScope;
  if (
    !state ||
    !isActive(instance, scope) ||
    state.activeTab !== "devices" ||
    document.visibilityState !== "visible" ||
    state.adapters.loading
  ) {
    return true;
  }
  return loadAdapters({ silent: true, signal });
}

// One poller, dispatched by tab: the feedback list and the adapter list both
// need a 30s refresh, and only one of them is on screen at a time.
async function pollActiveTab({ signal } = {}) {
  if (!state) return true;
  if (state.activeTab === "devices") return pollAdapterList({ signal });
  return pollFeedbackList({ signal });
}

async function loadAdapterSessions() {
  const device = state?.adapters?.detailDevice;
  if (!device) return;
  const instance = activeInstance;
  const scope = activeScope;
  const subPath = adapterSessionSubPath({
    kind: state.adapters.kind,
    certid: device.certid,
    date: state.adapters.detailDate,
    page: state.adapters.sessionPage,
  });
  if (!subPath) return;
  const request = ++state.adapters.sessionRequest;
  state.adapters.sessionLoading = true;
  state.adapters.sessionError = null;
  state.adapters.downloadError = null;
  rerender();
  try {
    const payload = await callHonnmonoAdmin(subPath, { signal: scope.signal });
    if (!isActive(instance, scope) || request !== state.adapters.sessionRequest) return;
    state.adapters.sessions = Array.isArray(payload?.items) ? payload.items : [];
    state.adapters.sessionTotal = Number(payload?.total) || 0;
    const sessionPages = Math.max(
      1,
      Math.ceil(state.adapters.sessionTotal / PAGE_SIZE),
    );
    if (state.adapters.sessionPage > sessionPages) {
      state.adapters.sessionPage = sessionPages;
      void loadAdapterSessions();
      return;
    }
  } catch (error) {
    if (isActive(instance, scope) && request === state.adapters.sessionRequest) {
      state.adapters.sessions = [];
      state.adapters.sessionTotal = 0;
      state.adapters.sessionError = error;
    }
  } finally {
    if (isActive(instance, scope) && request === state.adapters.sessionRequest) {
      state.adapters.sessionLoading = false;
      rerender();
    }
  }
}

function openAdapterSessions(id) {
  const device = state.adapters.rows.find(
    (item) => adapterDeviceId(item) === String(id),
  );
  if (!device?.certid) return;
  state.adapters.detailDevice = device;
  state.adapters.sessions = [];
  state.adapters.sessionPage = 1;
  state.adapters.sessionError = null;
  state.adapters.downloadError = null;
  void loadAdapterSessions();
}

function openAdapterSessionDatePanel(anchor) {
  adapterSessionDatePanel.open({
    anchor,
    mode: "single",
    date: state.adapters.detailDate,
    minDate: adapterSessionMinDate(),
    language: helpers?.lang || "zh",
    t: (key) => t(key === "date" ? "sessionDate" : key),
    onCommit: ({ date }) => {
      if (!isActive() || !state?.adapters?.detailDevice) return;
      state.adapters.detailDate =
        date || (state.adapters.kind === "flash" ? currentHongKongDate() : "");
      state.adapters.sessionPage = 1;
      void loadAdapterSessions();
    },
  });
}

function closeAdapterSessions() {
  adapterSessionDatePanel.close();
  state.adapters.sessionRequest += 1;
  state.adapters.detailDevice = null;
  state.adapters.sessions = [];
  state.adapters.sessionPage = 1;
  state.adapters.sessionError = null;
  state.adapters.downloadError = null;
  rerender();
}

async function beginAdapterAction(action, id) {
  const device = state.adapters.rows.find(
    (item) => adapterDeviceId(item) === String(id),
  );
  if (!device || !["unbind", "force_ota", "lock", "unlock"].includes(action)) {
    return;
  }
  if (!adapterActionsForKind(state.adapters.kind).includes(action)) return;
  state.adapters.actionError = null;
  state.adapters.actionResult = null;
  if (action === "unbind") {
    if (state.adapters.kind === "flash") {
      if (device.charging === true) {
        state.adapters.actionError = new HonnmonoAdminError(
          "device_charging",
          409,
        );
        rerender();
        return;
      }
      state.adapters.actionConfirm = { action, device };
      rerender();
      return;
    }
    state.adapters.actionLookupId = adapterDeviceId(device);
    rerender();
    try {
      const binding = await callHonnmonoAdmin(
        `/device/binding?imei=${encodeURIComponent(device.imei)}`,
        { signal: activeScope.signal },
      );
      if (!isActive() || state.activeTab !== "devices") return;
      state.adapters.actionConfirm = { action, device, binding };
    } catch (error) {
      if (isActive()) state.adapters.actionError = error;
    } finally {
      if (isActive()) {
        state.adapters.actionLookupId = null;
        rerender();
      }
    }
    return;
  }
  const packages = adapterOtaPackages(state.ota.packageInfo);
  state.adapters.actionConfirm = {
    action,
    device,
    packages,
    package: action === "force_ota" ? packages[0]?.filename || "" : "",
    versionInput: "",
  };
  rerender();
}

function closeAdapterAction() {
  if (state.adapters.actionLoading) return;
  state.adapters.actionConfirm = null;
  state.adapters.actionError = null;
  rerender();
}

async function submitAdapterAction() {
  const confirm = state.adapters.actionConfirm;
  if (!confirm || state.adapters.actionLoading) return;
  const instance = activeInstance;
  const scope = activeScope;
  let path;
  let body;
  if (confirm.action === "unbind") {
    if (state.adapters.kind === "dc-pro") {
      const expectedUserId = Number(confirm.binding?.dev_cloud?.userid);
      if (!Number.isSafeInteger(expectedUserId) || expectedUserId <= 0) return;
      path = "/device/unbind";
      body = { imei: confirm.device.imei, expected_userid: expectedUserId };
    } else if (state.adapters.kind === "flash") {
      let request;
      try {
        request = flashUnbindRequest(confirm.device);
      } catch (error) {
        state.adapters.actionError = error;
        rerender();
        return;
      }
      ({ path, body } = request);
    } else {
      return;
    }
  } else {
    path = `/devices/flash/${encodeURIComponent(confirm.device.certid)}/actions`;
    body = { action: confirm.action };
    if (confirm.action === "force_ota") {
      if (!confirm.packages?.some((item) => item.filename === confirm.package)) {
        return;
      }
      body.package = confirm.package;
      const version = String(confirm.versionInput || "").trim();
      if (version) {
        const match = version.match(/^(\d+)\.(\d+)$/);
        if (!match) {
          state.adapters.actionError = new HonnmonoAdminError("otaVersionFormat");
          rerender();
          return;
        }
        body.mainver = Number(match[1]);
        body.subver = Number(match[2]);
      }
    }
  }
  state.adapters.actionLoading = true;
  state.adapters.actionError = null;
  rerender();
  try {
    const result = await callHonnmonoAdmin(path, {
      method: "POST",
      signal: scope.signal,
      body,
    });
    if (!isActive(instance, scope)) return;
    state.adapters.actionResult = result;
    state.adapters.actionConfirm = null;
    void loadAdapters();
  } catch (error) {
    if (isActive(instance, scope)) state.adapters.actionError = error;
  } finally {
    if (isActive(instance, scope)) {
      state.adapters.actionLoading = false;
      rerender();
    }
  }
}

async function downloadAdapterReport(uploadId) {
  const device = state.adapters.detailDevice;
  const numericId = Number(uploadId);
  if (!device?.certid || !Number.isSafeInteger(numericId) || numericId <= 0) return;
  state.adapters.downloadingUploadId = numericId;
  state.adapters.downloadError = null;
  rerender();
  try {
    const payload = await callHonnmonoAdmin(
      `/devices/flash/${encodeURIComponent(device.certid)}/uploads/${numericId}`,
      { signal: activeScope.signal },
    );
    if (!isActive()) return;
    const binary = globalThis.atob(String(payload.contentBase64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    link.download = String(payload.filename || "charge-report.BIN");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    if (isActive()) state.adapters.downloadError = error;
  } finally {
    if (isActive()) {
      state.adapters.downloadingUploadId = null;
      rerender();
    }
  }
}

async function openDetail(id) {
  const numericId = Number(id);
  if (
    !Number.isSafeInteger(numericId) ||
    numericId <= 0 ||
    !state
  ) {
    return;
  }
  const instance = activeInstance;
  const scope = activeScope;
  const request = ++state.detailRequest;
  state.selectedId = numericId;
  state.detail = null;
  state.detailError = null;
  state.downloadError = null;
  rerender();
  scope.animationFrame(() =>
    document.querySelector("[data-feedback-close]")?.focus(),
  );
  try {
    const detail = await callHonnmonoAdmin(`/feedback/${numericId}`, {
      signal: scope.signal,
    });
    if (
      isActive(instance, scope) &&
      request === state.detailRequest
    ) {
      state.detail = detail;
    }
  } catch (error) {
    if (
      isActive(instance, scope) &&
      request === state.detailRequest
    ) {
      state.detailError = error;
    }
  } finally {
    if (
      isActive(instance, scope) &&
      request === state.detailRequest
    ) {
      rerender();
    }
  }
}

function closeDetail() {
  if (!state) return;
  const id = state.selectedId;
  state.detailRequest += 1;
  state.selectedId = null;
  state.detail = null;
  state.detailError = null;
  state.downloadError = null;
  rerender();
  activeScope?.animationFrame(() =>
    document.querySelector(`[data-feedback-detail="${id}"]`)?.focus(),
  );
}

async function downloadLog(id) {
  const numericId = Number(id);
  if (
    !Number.isSafeInteger(numericId) ||
    state?.detail?.id !== numericId ||
    normalizeFeedbackLogStatus(state.detail) !== "available"
  ) {
    return;
  }
  const instance = activeInstance;
  const scope = activeScope;
  state.downloadingId = numericId;
  state.downloadError = null;
  rerender();
  try {
    const payload = await callHonnmonoAdmin(
      `/feedback/${numericId}/log-link`,
      { method: "POST", signal: scope.signal },
    );
    if (!isActive(instance, scope)) return;
    const downloadUrl = safeHttpUrl(payload.downloadUrl);
    if (!downloadUrl) throw new HonnmonoAdminError("missingDownloadUrl");
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.rel = "noopener";
    link.download = payload.filename || "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    if (isActive(instance, scope)) state.downloadError = error;
  } finally {
    if (isActive(instance, scope)) {
      state.downloadingId = null;
      rerender();
    }
  }
}

function switchAppTab(nextTab) {
  if (!state || !["feedback", "device", "devices"].includes(nextTab)) return;
  if (state.activeTab === nextTab) return;
  state.activeTab = nextTab;
  state.detailRequest += 1;
  state.selectedId = null;
  state.detail = null;
  state.detailError = null;
  state.downloadError = null;
  if (nextTab === "device") {
    // Single-device unbind is a one-shot lookup form, nothing to poll.
    activePoller?.pause();
    rerender();
    if (!state.ota.loaded) void activeOtaController?.load();
    activeScope?.animationFrame(() =>
      document.querySelector("[data-device-imei]")?.focus(),
    );
    return;
  }
  if (nextTab === "devices") {
    // The adapter list is live data (online/charging), so it keeps polling.
    activePoller?.resume();
    rerender();
    if (!state.ota.loaded) void activeOtaController?.load();
    void loadAdapters();
    activeScope?.animationFrame(() =>
      document.querySelector("[data-adapter-query]")?.focus(),
    );
    return;
  }
  activePoller?.resume();
  rerender();
  if (!state.hasLoadedList) void loadList();
}

function onFeedbackClick(event) {
  const tab = event.target.closest?.("[data-app-feedback-tab]");
  if (tab) {
    switchAppTab(tab.getAttribute("data-app-feedback-tab"));
    return;
  }
  const adapterKind = event.target.closest?.("[data-adapter-kind]");
  if (adapterKind) {
    const kind = adapterKind.getAttribute("data-adapter-kind");
    if (["flash", "dc-pro"].includes(kind) && kind !== state.adapters.kind) {
      state.adapters.kind = kind;
      state.adapters.detailDate =
        kind === "flash" ? currentHongKongDate() : "";
      state.adapters.page = 1;
      state.adapters.rows = [];
      state.adapters.total = 0;
      state.adapters.actionResult = null;
      closeAdapterSessions();
      void loadAdapters();
    }
    return;
  }
  const adapterDetail = event.target.closest?.("[data-adapter-detail]");
  if (adapterDetail) {
    openAdapterSessions(adapterDetail.getAttribute("data-adapter-detail"));
    return;
  }
  const adapterAction = event.target.closest?.("[data-adapter-action]");
  if (adapterAction) {
    void beginAdapterAction(
      adapterAction.getAttribute("data-adapter-action"),
      adapterAction.getAttribute("data-adapter-id"),
    );
    return;
  }
  if (
    event.target.matches?.("[data-adapter-confirm-overlay]") ||
    event.target.closest?.("[data-adapter-confirm-cancel]")
  ) {
    closeAdapterAction();
    return;
  }
  if (event.target.closest?.("[data-adapter-confirm-submit]")) {
    void submitAdapterAction();
    return;
  }
  if (
    event.target.matches?.("[data-adapter-drawer]") ||
    event.target.closest?.("[data-adapter-drawer-close]")
  ) {
    closeAdapterSessions();
    return;
  }
  const adapterSessionDate = event.target.closest?.(
    "[data-adapter-session-date]",
  );
  if (adapterSessionDate) {
    openAdapterSessionDatePanel(adapterSessionDate);
    return;
  }
  const adapterReport = event.target.closest?.("[data-adapter-report]");
  if (adapterReport) {
    void downloadAdapterReport(adapterReport.getAttribute("data-adapter-report"));
    return;
  }
  const adapterSessionPage = event.target.closest?.(
    "[data-adapter-session-page]",
  );
  if (adapterSessionPage && !adapterSessionPage.disabled) {
    state.adapters.sessionPage = Number(
      adapterSessionPage.getAttribute("data-adapter-session-page"),
    );
    void loadAdapterSessions();
    return;
  }
  const adapterPage = event.target.closest?.("[data-adapter-page]");
  if (adapterPage && !adapterPage.disabled) {
    state.adapters.page = Number(adapterPage.getAttribute("data-adapter-page"));
    void loadAdapters();
    return;
  }
  if (event.target.closest?.("[data-adapter-refresh]")) {
    void loadAdapters();
    return;
  }
  if (event.target.closest?.("[data-device-unbind]")) {
    activeDeviceController?.openConfirm();
    return;
  }
  if (
    event.target.matches?.("[data-device-confirm-overlay]") ||
    event.target.closest?.("[data-device-confirm-cancel]")
  ) {
    activeDeviceController?.closeConfirm();
    return;
  }
  if (event.target.closest?.("[data-device-confirm-submit]")) {
    void activeDeviceController?.submitUnbind();
    return;
  }
  if (event.target.closest?.("[data-ota-retry]")) {
    void activeOtaController?.load();
    return;
  }
  if (event.target.closest?.("[data-ota-replace]")) {
    activeOtaController?.openConfirm();
    return;
  }
  if (
    event.target.matches?.("[data-ota-confirm-overlay]") ||
    event.target.closest?.("[data-ota-confirm-cancel]")
  ) {
    activeOtaController?.closeConfirm();
    return;
  }
  if (event.target.closest?.("[data-ota-confirm-submit]")) {
    void activeOtaController?.submit();
    return;
  }
  const legacyReplace = event.target.closest?.("[data-legacy-ota-replace]");
  if (legacyReplace) {
    activeOtaController?.openLegacyConfirm(
      legacyReplace.getAttribute("data-legacy-ota-replace"),
    );
    return;
  }
  if (
    event.target.matches?.("[data-legacy-ota-confirm-overlay]") ||
    event.target.closest?.("[data-legacy-ota-confirm-cancel]")
  ) {
    activeOtaController?.closeLegacyConfirm();
    return;
  }
  if (event.target.closest?.("[data-legacy-ota-confirm-submit]")) {
    void activeOtaController?.submitLegacy();
    return;
  }
  if (event.target.closest?.("[data-feedback-new]")) {
    acceptPendingFeedback();
    return;
  }
  const detail = event.target.closest?.("[data-feedback-detail]");
  if (detail) {
    void openDetail(detail.getAttribute("data-feedback-detail"));
    return;
  }
  if (
    event.target.matches?.("[data-feedback-drawer]") ||
    event.target.closest?.("[data-feedback-close]")
  ) {
    closeDetail();
    return;
  }
  const page = event.target.closest?.("[data-feedback-page]");
  if (page && !page.disabled) {
    state.page = Number(page.getAttribute("data-feedback-page"));
    void loadList();
    return;
  }
  if (event.target.closest?.("[data-feedback-refresh]")) {
    void loadList();
    return;
  }
  const download = event.target.closest?.("[data-feedback-download]");
  if (download) {
    void downloadLog(download.getAttribute("data-feedback-download"));
  }
}

function onFeedbackInput(event) {
  if (event.target.matches("[data-adapter-query]")) {
    state.adapters.queryInput = event.target.value;
    return;
  }
  if (event.target.matches("[data-adapter-action-version]")) {
    if (state.adapters.actionConfirm) {
      state.adapters.actionConfirm.versionInput = event.target.value;
      state.adapters.actionError = null;
    }
    return;
  }
  if (event.target.matches("[data-ota-version]")) {
    activeOtaController?.setVersionInput(event.target.value);
    return;
  }
  if (event.target.matches("[data-device-imei]")) {
    const value = activeDeviceController?.setImeiInput(event.target.value) ?? "";
    event.target.value = value;
    return;
  }
  if (event.target.matches("[data-feedback-query]")) {
    state.searchInput = event.target.value;
  }
}

function onFeedbackChange(event) {
  if (event.target.matches("[data-legacy-ota-file]")) {
    activeOtaController?.selectLegacyFile(
      event.target.getAttribute("data-legacy-ota-file"),
      event.target.files?.[0] ?? null,
    );
    return;
  }
  if (event.target.matches("[data-adapter-action-package]")) {
    if (state.adapters.actionConfirm) {
      state.adapters.actionConfirm.package = event.target.value;
    }
    return;
  }
  if (event.target.matches("[data-ota-file]")) {
    activeOtaController?.selectFile(event.target.files?.[0] ?? null);
    return;
  }
  if (event.target.matches("[data-feedback-client]")) {
    state.clientModel = event.target.value;
  } else if (event.target.matches("[data-feedback-version]")) {
    state.appVersion = event.target.value;
  } else if (event.target.matches("[data-feedback-status]")) {
    state.status = event.target.value;
  } else {
    return;
  }
  state.page = 1;
  void loadList();
}

function onFeedbackSubmit(event) {
  if (event.target.matches("[data-adapter-search]")) {
    event.preventDefault();
    state.adapters.query = state.adapters.queryInput.trim();
    state.adapters.page = 1;
    void loadAdapters();
    return;
  }
  if (event.target.matches("[data-device-search]")) {
    event.preventDefault();
    void activeDeviceController?.lookup();
    return;
  }
  if (!event.target.matches("[data-feedback-search]")) return;
  event.preventDefault();
  state.keyword = state.searchInput.trim();
  state.page = 1;
  void loadList();
}

function onFeedbackKeydown(event) {
  if (event.key === "Escape" && state?.adapters?.actionConfirm) {
    closeAdapterAction();
    return;
  }
  if (event.key === "Escape" && state?.adapters?.detailDevice) {
    closeAdapterSessions();
    return;
  }
  if (event.key === "Escape" && state?.ota?.legacyConfirmSlot != null) {
    activeOtaController?.closeLegacyConfirm();
    return;
  }
  if (event.key === "Escape" && state?.ota?.confirmOpen) {
    activeOtaController?.closeConfirm();
    return;
  }
  if (event.key === "Escape" && state?.device?.confirmOpen) {
    activeDeviceController?.closeConfirm();
    return;
  }
  if (event.key === "Escape" && state?.selectedId != null) closeDetail();
}

function createState(historyState) {
  const saved =
    historyState && typeof historyState === "object" ? historyState : {};
  return {
    activeTab: ["device", "devices"].includes(saved.activeTab)
      ? saved.activeTab
      : "feedback",
    device: createDeviceUnbindState(saved),
    ota: createOtaPackageState(),
    adapters: createAdapterDeviceState(saved),
    rows: [],
    total: 0,
    facets: {
      clientModels: [],
      appVersions: [],
      statuses: [],
    },
    page:
      Number.isInteger(saved.page) && saved.page > 0 ? saved.page : 1,
    clientModel:
      typeof saved.clientModel === "string" ? saved.clientModel : "",
    appVersion:
      typeof saved.appVersion === "string" ? saved.appVersion : "",
    status: typeof saved.status === "string" ? saved.status : "",
    searchInput:
      typeof saved.searchInput === "string" ? saved.searchInput : "",
    keyword: typeof saved.keyword === "string" ? saved.keyword : "",
    loading: false,
    hasLoadedList: false,
    listError: null,
    selectedId: null,
    detail: null,
    detailError: null,
    downloadingId: null,
    downloadError: null,
    pendingListPayload: null,
    pendingListSignature: "",
    newFeedbackCount: 0,
    listRequest: 0,
    detailRequest: 0,
  };
}

function createFeedbackPage({ currentUser, unread }) {
  return {
    menu: createBizflowMenu("app-feedback"),
    data: { unread, user: currentUser },
    render,
    title: "Honnmono APP · 用戶反饋",
  };
}

export async function mountPage({
  scope,
  signal,
  url,
  navigation,
  historyState,
}) {
  const [currentUser, session] = await Promise.all([
    getCurrentUser(),
    getSession(),
  ]);
  throwIfPageAborted(signal, scope);
  requireFeedbackRouteAccess(currentUser, session, { url, navigation });
  const nextState = createState(historyState);
  const initialList =
    nextState.activeTab === "feedback"
      ? callHonnmonoAdmin(listSubPath(nextState), { signal }).then(
          (payload) => ({ payload, error: null }),
          (error) => ({ payload: null, error }),
        )
      : Promise.resolve({ payload: null, error: null });
  const initialResult = await initialList;
  throwIfPageAborted(signal, scope);
  const { unread } = cachedPageUnread(currentUser);
  if (initialResult.payload) {
    applyFeedbackListPayload(nextState, initialResult.payload);
    nextState.hasLoadedList = true;
  } else if (initialResult.error) {
    nextState.listError = initialResult.error;
  }
  const instance = ++instanceSequence;
  activeInstance = instance;
  activeScope = scope;
  state = nextState;
  helpers = null;
  const deviceController = createDeviceUnbindController({
    deviceState: nextState.device,
    scope,
    isActive: () => isActive(instance, scope),
    isDeviceTab: () => state?.activeTab === "device",
    rerender,
    focus: (selector) =>
      scope.animationFrame(() => document.querySelector(selector)?.focus()),
  });
  activeDeviceController = deviceController;
  const otaController = createOtaPackageController({
    otaState: nextState.ota,
    scope,
    isActive: () => isActive(instance, scope),
    isDeviceTab: () => ["device", "devices"].includes(state?.activeTab),
    rerender,
    focus: (selector) =>
      scope.animationFrame(() => document.querySelector(selector)?.focus()),
  });
  activeOtaController = otaController;
  let poller = null;

  return {
    page: createFeedbackPage({ currentUser, unread }),
    activate() {
      void loadPageUnread({ scope, currentUser });
      scope.listen(document, "click", onFeedbackClick);
      scope.listen(document, "input", onFeedbackInput);
      scope.listen(document, "change", onFeedbackChange);
      scope.listen(document, "submit", onFeedbackSubmit);
      scope.listen(document, "keydown", onFeedbackKeydown);
      poller = createFeedbackPoller({
        scope,
        documentRef: document,
        poll: pollActiveTab,
      });
      activePoller = poller;
      if (state.activeTab !== "device") poller.start();
      if (["device", "devices"].includes(state.activeTab)) void otaController.load();
      if (state.activeTab === "devices") void loadAdapters();
    },
    captureState: () => ({
      activeTab: state.activeTab,
      deviceImeiInput: state.device.imeiInput,
      adapterKind: state.adapters.kind,
      adapterPage: state.adapters.page,
      adapterQuery: state.adapters.query,
      page: state.page,
      clientModel: state.clientModel,
      appVersion: state.appVersion,
      status: state.status,
      searchInput: state.searchInput,
      keyword: state.keyword,
    }),
    dispose() {
      adapterSessionDatePanel.close();
      poller?.dispose();
      if (activePoller === poller) activePoller = null;
      if (activeDeviceController === deviceController) {
        activeDeviceController = null;
      }
      if (activeOtaController === otaController) activeOtaController = null;
      if (activeInstance === instance) activeInstance = 0;
      if (activeScope === scope) activeScope = null;
      state = null;
      helpers = null;
    },
  };
}
