import { createBizflowMenu } from "../components/bizflow-menu.js";
import { getSession } from "../data/auth.js";
import { getCurrentUser, getUnread } from "../data/provider.js";
import { throwIfPageAborted } from "../spa/page-lifecycle.js";
import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
  formatFeedbackTime,
  normalizeFeedbackLogStatus,
  safeHttpUrl,
} from "./app-feedback-api.js";
import { translateAppFeedback } from "./app-feedback-i18n.js";

const PAGE_SIZE = 20;
let state = null;
let helpers = null;
let activeScope = null;
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

function detailRow(labelKey, value, { mono = false } = {}) {
  return `<div class="app-feedback-detail-row${mono ? " app-feedback-detail-row--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${e(value)}</dd></div>`;
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

function render(nextHelpers) {
  helpers = nextHelpers;
  const error = state.listError
    ? `<div class="app-feedback-alert">${rawE(t("listError", { message: errorCopy(state.listError) }))}</div>`
    : "";
  return `<section class="app-feedback-page" data-app-feedback-page>
    <header class="app-feedback-head">
      <div><h1>${rawE(t("title"))}</h1><p>${rawE(t("subtitle"))}</p></div>
      <button type="button" class="app-feedback-button app-feedback-button--refresh" data-feedback-refresh${state.loading ? " disabled" : ""}>${rawE(t(state.loading ? "refreshing" : "refresh"))}</button>
    </header>
    <div class="app-feedback-card">
      ${renderToolbar()}
      ${error}
      ${renderTable()}
      ${renderPager()}
    </div>
    ${renderDrawer()}
  </section>`;
}

function rerender() {
  const page = document.querySelector("[data-app-feedback-page]");
  if (page && helpers) page.outerHTML = render(helpers);
}

function normalizedFacets(facets) {
  return {
    clientModels: Array.isArray(facets?.clientModels)
      ? facets.clientModels
      : [],
    appVersions: Array.isArray(facets?.appVersions)
      ? facets.appVersions
      : [],
    statuses: Array.isArray(facets?.statuses) ? facets.statuses : [],
  };
}

function applyListPayload(targetState, payload) {
  targetState.rows = Array.isArray(payload?.items) ? payload.items : [];
  targetState.total = Number(payload?.total) || 0;
  targetState.facets = normalizedFacets(payload?.facets);
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

async function loadList() {
  const instance = activeInstance;
  const scope = activeScope;
  if (!state || !isActive(instance, scope)) return;
  const request = ++state.listRequest;
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
    applyListPayload(state, payload);
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

function onFeedbackClick(event) {
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
  if (event.target.matches("[data-feedback-query]")) {
    state.searchInput = event.target.value;
  }
}

function onFeedbackChange(event) {
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
  if (!event.target.matches("[data-feedback-search]")) return;
  event.preventDefault();
  state.keyword = state.searchInput.trim();
  state.page = 1;
  void loadList();
}

function onFeedbackKeydown(event) {
  if (event.key === "Escape" && state?.selectedId != null) closeDetail();
}

function createState(historyState) {
  const saved =
    historyState && typeof historyState === "object" ? historyState : {};
  return {
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
    listError: null,
    selectedId: null,
    detail: null,
    detailError: null,
    downloadingId: null,
    downloadError: null,
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
  const [initialResult, unread] = await Promise.all([
    callHonnmonoAdmin(listSubPath(nextState), { signal }).then(
      (payload) => ({ payload, error: null }),
      (error) => ({ payload: null, error }),
    ),
    getUnread(),
  ]);
  throwIfPageAborted(signal, scope);
  if (initialResult.payload) {
    applyListPayload(nextState, initialResult.payload);
  } else {
    nextState.listError = initialResult.error;
  }
  const instance = ++instanceSequence;
  activeInstance = instance;
  activeScope = scope;
  state = nextState;
  helpers = null;

  return {
    page: createFeedbackPage({ currentUser, unread }),
    activate() {
      scope.listen(document, "click", onFeedbackClick);
      scope.listen(document, "input", onFeedbackInput);
      scope.listen(document, "change", onFeedbackChange);
      scope.listen(document, "submit", onFeedbackSubmit);
      scope.listen(document, "keydown", onFeedbackKeydown);
    },
    captureState: () => ({
      page: state.page,
      clientModel: state.clientModel,
      appVersion: state.appVersion,
      status: state.status,
      searchInput: state.searchInput,
      keyword: state.keyword,
    }),
    dispose() {
      if (activeInstance === instance) activeInstance = 0;
      if (activeScope === scope) activeScope = null;
      state = null;
      helpers = null;
    },
  };
}
