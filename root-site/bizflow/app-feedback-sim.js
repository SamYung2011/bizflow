import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
} from "./app-feedback-api.js";


export const SIM_CARDS_PAGE_SIZE = 50;
export const SIM_IMPORT_MAX_LINES = 500;

const ICCID_PATTERN = /^[0-9A-Za-z]{19,20}$/;
const MSISDN_PATTERN = /^\d{1,13}$/;
const SIM_IMEI_PATTERN = /^\d{15}$/;
const KB_PER_MB = 1024;
const KB_PER_GB = 1024 * 1024;

const SIM_SOURCE_KEYS = Object.freeze({
  device_report: "simSourceDeviceReport",
  manual: "simSourceManual",
});

// A 20 (or 19) character alphanumeric string is an ICCID; anything up to 13
// digits is the card number (msisdn). The two shapes never overlap, so the
// operator types one box and the page picks the right query parameter.
export function detectSimQueryKind(value) {
  const normalized = String(value ?? "").trim();
  if (ICCID_PATTERN.test(normalized)) return "iccid";
  if (MSISDN_PATTERN.test(normalized)) return "msisdn";
  return null;
}

export function normalizeSimQuery(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").slice(0, 32);
}

export function simLookupSubPath(value, { refresh = false } = {}) {
  const normalized = normalizeSimQuery(value);
  const kind = detectSimQueryKind(normalized);
  if (!kind) return "";
  const params = new URLSearchParams({ [kind]: normalized });
  return `/sim/lookup?${params}${refresh ? "&refresh=1" : ""}`;
}

export function simCardsSubPath({ page = 1, query = "" } = {}) {
  const safePage = Number.isSafeInteger(Number(page)) && Number(page) > 0
    ? Number(page)
    : 1;
  const params = new URLSearchParams({
    page: String(safePage),
    size: String(SIM_CARDS_PAGE_SIZE),
  });
  const keyword = String(query ?? "").trim();
  if (keyword) params.set("q", keyword);
  return `/sim/cards?${params}`;
}

// OneLink reports every data figure in KB. Anything above 1 MB reads better
// rescaled, and the operator compares plans, so keep two decimals there.
export function formatSimData(kb) {
  const numeric = Number(kb);
  if (kb == null || kb === "" || !Number.isFinite(numeric)) return null;
  const magnitude = Math.abs(numeric);
  if (magnitude >= KB_PER_GB) {
    return { key: "simSizeGb", size: (numeric / KB_PER_GB).toFixed(2) };
  }
  if (magnitude >= KB_PER_MB) {
    return { key: "simSizeMb", size: (numeric / KB_PER_MB).toFixed(2) };
  }
  return {
    key: "simSizeKb",
    size: Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2),
  };
}

export function simUsagePercent(usage) {
  const total = Number(usage?.totalKb);
  const used = Number(usage?.usedKb);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;
  return Math.min(100, Math.round((used / total) * 100));
}

// Renewal urgency bands: overdue reads red, one week red, one month amber.
export function simDaysLeftLevel(daysLeft) {
  const numeric = Number(daysLeft);
  if (daysLeft == null || daysLeft === "" || !Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 0) return "expired";
  if (numeric <= 7) return "danger";
  if (numeric <= 30) return "warning";
  return "normal";
}

export function simCardsPageCount(total) {
  const numeric = Number(total);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric / SIM_CARDS_PAGE_SIZE));
}

export function simImportLineCount(lines) {
  return String(lines ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

export function createSimCardState(saved = {}) {
  return {
    queryInput:
      typeof saved.simQueryInput === "string"
        ? normalizeSimQuery(saved.simQueryInput)
        : "",
    queriedValue: "",
    lookup: null,
    lookupLoading: false,
    refetchLoading: false,
    lookupError: null,
    cards: {
      rows: [],
      total: 0,
      page:
        Number.isInteger(saved.simCardsPage) && saved.simCardsPage > 0
          ? saved.simCardsPage
          : 1,
      queryInput:
        typeof saved.simCardsQuery === "string" ? saved.simCardsQuery : "",
      query: typeof saved.simCardsQuery === "string" ? saved.simCardsQuery : "",
      loading: false,
      loaded: false,
      error: null,
      refreshingIccid: "",
      refreshError: null,
    },
    manual: {
      valueInput: "",
      imeiInput: "",
      remarkInput: "",
      submitting: false,
      error: null,
      result: null,
    },
    importer: {
      linesInput: "",
      submitting: false,
      error: null,
      result: null,
    },
    requestSequence: 0,
    cardsSequence: 0,
  };
}

export function simManualRequestBody({ value, imei, remark }) {
  const normalized = normalizeSimQuery(value);
  const kind = detectSimQueryKind(normalized);
  if (!kind) throw new HonnmonoAdminError("simQueryValidation");
  const trimmedImei = String(imei ?? "").trim();
  if (trimmedImei && !SIM_IMEI_PATTERN.test(trimmedImei)) {
    throw new HonnmonoAdminError("simManualImeiValidation");
  }
  const trimmedRemark = String(remark ?? "").trim();
  return {
    [kind]: normalized,
    ...(trimmedImei ? { imei: trimmedImei } : {}),
    ...(trimmedRemark ? { remark: trimmedRemark.slice(0, 200) } : {}),
  };
}

export function createSimCardController({
  simState,
  scope,
  isActive,
  isSimTab,
  rerender,
  focus,
  request = callHonnmonoAdmin,
}) {
  const isCurrent = (sequence) =>
    isActive() && sequence === simState.requestSequence;
  const isCurrentCards = (sequence) =>
    isActive() && sequence === simState.cardsSequence;

  function setQueryInput(rawValue) {
    const value = normalizeSimQuery(rawValue);
    simState.queryInput = value;
    simState.lookupError = null;
    return value;
  }

  function setCardsQueryInput(rawValue) {
    simState.cards.queryInput = String(rawValue ?? "").slice(0, 64);
    return simState.cards.queryInput;
  }

  function setManualField(field, rawValue) {
    if (!["valueInput", "imeiInput", "remarkInput"].includes(field)) return "";
    const value =
      field === "remarkInput"
        ? String(rawValue ?? "").slice(0, 200)
        : normalizeSimQuery(rawValue);
    simState.manual[field] = value;
    simState.manual.error = null;
    return value;
  }

  function setImportInput(rawValue) {
    simState.importer.linesInput = String(rawValue ?? "");
    simState.importer.error = null;
    return simState.importer.linesInput;
  }

  async function lookup({ refresh = false } = {}) {
    const value = normalizeSimQuery(simState.queryInput);
    const subPath = simLookupSubPath(value, { refresh });
    if (!subPath) {
      simState.lookupError = new HonnmonoAdminError("simQueryValidation");
      simState.lookup = null;
      rerender();
      return;
    }

    const sequence = ++simState.requestSequence;
    if (refresh) simState.refetchLoading = true;
    else simState.lookupLoading = true;
    simState.lookupError = null;
    rerender();
    try {
      const payload = await request(subPath, { signal: scope.signal });
      if (isCurrent(sequence) && isSimTab()) {
        simState.queriedValue = value;
        simState.lookup = payload;
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        simState.lookup = null;
        simState.lookupError = error;
      }
    } finally {
      if (isCurrent(sequence)) {
        simState.lookupLoading = false;
        simState.refetchLoading = false;
        rerender();
      }
    }
  }

  function refetch() {
    if (!simState.queriedValue) return lookup();
    simState.queryInput = simState.queriedValue;
    return lookup({ refresh: true });
  }

  async function loadCards() {
    const sequence = ++simState.cardsSequence;
    simState.cards.loading = true;
    simState.cards.error = null;
    rerender();
    try {
      const payload = await request(
        simCardsSubPath({
          page: simState.cards.page,
          query: simState.cards.query,
        }),
        { signal: scope.signal },
      );
      if (isCurrentCards(sequence) && isSimTab()) {
        simState.cards.rows = Array.isArray(payload?.items) ? payload.items : [];
        simState.cards.total = Number.isFinite(Number(payload?.total))
          ? Number(payload.total)
          : simState.cards.rows.length;
        simState.cards.loaded = true;
      }
    } catch (error) {
      if (isCurrentCards(sequence)) {
        simState.cards.rows = [];
        simState.cards.total = 0;
        simState.cards.error = error;
        simState.cards.loaded = true;
      }
    } finally {
      if (isCurrentCards(sequence)) {
        simState.cards.loading = false;
        rerender();
      }
    }
  }

  function searchCards() {
    simState.cards.query = String(simState.cards.queryInput ?? "").trim();
    simState.cards.page = 1;
    return loadCards();
  }

  function goToCardsPage(nextPage) {
    const page = Number(nextPage);
    if (!Number.isSafeInteger(page) || page < 1) return Promise.resolve();
    if (page === simState.cards.page) return Promise.resolve();
    simState.cards.page = page;
    return loadCards();
  }

  function viewCard(value) {
    const normalized = normalizeSimQuery(value);
    if (!detectSimQueryKind(normalized)) return Promise.resolve();
    simState.queryInput = normalized;
    simState.lookupError = null;
    return lookup();
  }

  async function refreshCard(iccid) {
    const normalized = normalizeSimQuery(iccid);
    if (
      detectSimQueryKind(normalized) !== "iccid" ||
      simState.cards.refreshingIccid
    ) {
      return;
    }

    const sequence = ++simState.requestSequence;
    simState.cards.refreshingIccid = normalized;
    simState.cards.refreshError = null;
    rerender();
    try {
      const payload = await request("/sim/refresh", {
        method: "POST",
        signal: scope.signal,
        body: { iccid: normalized },
      });
      if (isCurrent(sequence) && isSimTab()) {
        simState.queryInput = normalized;
        simState.queriedValue = normalized;
        simState.lookup = payload;
        simState.lookupError = null;
      }
    } catch (error) {
      if (isCurrent(sequence)) simState.cards.refreshError = error;
    } finally {
      if (isCurrent(sequence)) {
        simState.cards.refreshingIccid = "";
        rerender();
      }
    }
    if (isCurrent(sequence) && isSimTab()) await loadCards();
  }

  async function submitManual() {
    if (simState.manual.submitting) return;
    let body;
    try {
      body = simManualRequestBody({
        value: simState.manual.valueInput,
        imei: simState.manual.imeiInput,
        remark: simState.manual.remarkInput,
      });
    } catch (error) {
      simState.manual.error = error;
      simState.manual.result = null;
      rerender();
      return;
    }

    const sequence = ++simState.requestSequence;
    simState.manual.submitting = true;
    simState.manual.error = null;
    simState.manual.result = null;
    rerender();
    try {
      const row = await request("/sim/cards", {
        method: "POST",
        signal: scope.signal,
        body,
      });
      if (isCurrent(sequence) && isSimTab()) {
        simState.manual.result = row;
        simState.manual.valueInput = "";
        simState.manual.imeiInput = "";
        simState.manual.remarkInput = "";
      }
    } catch (error) {
      if (isCurrent(sequence)) simState.manual.error = error;
    } finally {
      if (isCurrent(sequence)) {
        simState.manual.submitting = false;
        rerender();
      }
    }
    if (isCurrent(sequence) && isSimTab() && simState.manual.result) {
      await loadCards();
    }
  }

  async function submitImport() {
    if (simState.importer.submitting) return;
    const lines = String(simState.importer.linesInput ?? "");
    const lineCount = simImportLineCount(lines);
    if (lineCount === 0) {
      simState.importer.error = new HonnmonoAdminError("simImportRequired");
      simState.importer.result = null;
      rerender();
      return;
    }
    if (lineCount > SIM_IMPORT_MAX_LINES) {
      simState.importer.error = new HonnmonoAdminError("simImportTooManyLines");
      simState.importer.result = null;
      rerender();
      return;
    }

    const sequence = ++simState.requestSequence;
    simState.importer.submitting = true;
    simState.importer.error = null;
    simState.importer.result = null;
    rerender();
    try {
      const result = await request("/sim/cards/import", {
        method: "POST",
        signal: scope.signal,
        body: { lines },
      });
      if (isCurrent(sequence) && isSimTab()) {
        simState.importer.result = result;
        simState.importer.linesInput = "";
      }
    } catch (error) {
      if (isCurrent(sequence)) simState.importer.error = error;
    } finally {
      if (isCurrent(sequence)) {
        simState.importer.submitting = false;
        rerender();
      }
    }
    if (isCurrent(sequence) && isSimTab() && simState.importer.result) {
      await loadCards();
    }
  }

  return Object.freeze({
    setQueryInput,
    setCardsQueryInput,
    setManualField,
    setImportInput,
    lookup,
    refetch,
    loadCards,
    searchCards,
    goToCardsPage,
    viewCard,
    refreshCard,
    submitManual,
    submitImport,
    focusQuery: () => focus("[data-sim-query]"),
  });
}

export function renderSimCards({
  simState,
  t,
  escapeHtml,
  formatTime,
  errorCopy,
}) {
  const rawE = (value) => escapeHtml(value ?? "");
  const e = (value) => escapeHtml(value == null || value === "" ? "—" : value);
  const lookup = simState.lookup;
  const busy = simState.lookupLoading || simState.refetchLoading;

  const detailRow = (labelKey, value, { mono = false } = {}) =>
    `<div class="app-feedback-device-detail${mono ? " app-feedback-device-detail--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${e(value)}</dd></div>`;

  const dataText = (kb) => {
    const size = formatSimData(kb);
    return size ? t(size.key, { size: size.size }) : "";
  };

  const missing = (sectionKey) => {
    const message = lookup?.errors?.[sectionKey];
    return `<p class="app-feedback-sim-missing">${rawE(
      message
        ? t("simSectionUnavailable", { message })
        : t("simSectionUnknownError"),
    )}</p>`;
  };

  const section = (titleKey, body) =>
    `<section class="app-feedback-device-binding app-feedback-sim-section">
      <h2>${rawE(t(titleKey))}</h2>
      ${body}
    </section>`;

  const renderBasic = () => {
    if (!lookup?.card) return section("basicInfo", missing("card"));
    const card = lookup.card;
    const device = lookup.device;
    return section(
      "basicInfo",
      `<dl class="app-feedback-device-details">
        ${detailRow("simIccid", card.iccid, { mono: true })}
        ${detailRow("simMsisdn", card.msisdn, { mono: true })}
        ${detailRow("simImsi", card.imsi, { mono: true })}
        ${detailRow("simOpenDate", card.openDate)}
        ${detailRow("simActiveDate", card.activeDate)}
        ${detailRow("simRemark", card.remark)}
        ${detailRow("simDeviceImei", device?.imei, { mono: true })}
        ${detailRow("simDeviceCertid", device?.certid, { mono: true })}
        ${detailRow("bindingUser", device?.username)}
      </dl>
      ${device ? "" : `<p class="app-feedback-sim-missing">${rawE(t("simNoDevice"))}</p>`}`,
    );
  };

  const renderStatus = () => {
    if (!lookup?.status) return section("simStatusSection", missing("status"));
    return section(
      "simStatusSection",
      `<dl class="app-feedback-device-details">
        ${detailRow("status", lookup.status.label)}
        ${detailRow("simStatusCode", lookup.status.code, { mono: true })}
        ${detailRow("simStatusChangedAt", lookup.status.changedAt)}
      </dl>`,
    );
  };

  const renderOfferings = () => {
    if (!Array.isArray(lookup?.offerings)) {
      return section("simOfferings", missing("offerings"));
    }
    if (lookup.offerings.length === 0) {
      return section(
        "simOfferings",
        `<p class="app-feedback-sim-missing">${rawE(t("simNoOfferings"))}</p>`,
      );
    }
    return section(
      "simOfferings",
      `<div class="app-feedback-table-shell">
        <table class="app-feedback-table app-feedback-sim-table">
          <thead><tr>
            <th scope="col">${rawE(t("simOfferingName"))}</th>
            <th scope="col">${rawE(t("simOfferingEffective"))}</th>
            <th scope="col">${rawE(t("simExpiresAt"))}</th>
            <th scope="col">${rawE(t("simOfferingApn"))}</th>
          </tr></thead>
          <tbody>
            ${lookup.offerings
              .map(
                (offering) => `<tr>
                  <td>${e(offering?.offeringName)}</td>
                  <td>${e(offering?.effectiveDate)}</td>
                  <td>${e(offering?.expiriedDate)}</td>
                  <td>${e(offering?.apnName)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`,
    );
  };

  const renderRenewal = () => {
    if (!lookup?.renewal) return section("simRenewal", missing("renewal"));
    const renewal = lookup.renewal;
    const level = simDaysLeftLevel(renewal.daysLeft);
    const days = Number(renewal.daysLeft);
    const daysText =
      level === "expired"
        ? t("simExpiredDays", { days: Math.abs(days) })
        : level
          ? t("simDaysValue", { days })
          : "";
    return section(
      "simRenewal",
      `<dl class="app-feedback-device-details">
        ${detailRow("simExpiresAt", renewal.expiresAt)}
        <div class="app-feedback-device-detail">
          <dt>${rawE(t("simDaysLeft"))}</dt>
          <dd><span class="app-feedback-sim-days app-feedback-sim-days--${rawE(level || "unknown")}">${e(daysText)}</span>${level === "expired" ? `<span class="app-feedback-sim-expired">${rawE(t("simExpired"))}</span>` : ""}</dd>
        </div>
        ${detailRow("simDueAt", renewal.dueAt)}
      </dl>`,
    );
  };

  const renderUsage = () => {
    if (!lookup?.usage) return section("simUsage", missing("usage"));
    const usage = lookup.usage;
    const percent = simUsagePercent(usage);
    const items = Array.isArray(usage.items) ? usage.items : [];
    return section(
      "simUsage",
      `<dl class="app-feedback-device-details">
        ${detailRow("simUsageMonth", usage.month)}
        ${detailRow("simUsageTotal", dataText(usage.totalKb))}
        ${detailRow("simUsageUsed", dataText(usage.usedKb))}
        ${detailRow("simUsageRemain", dataText(usage.remainKb))}
      </dl>
      ${
        percent == null
          ? ""
          : `<div class="app-feedback-sim-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="${rawE(t("simUsageProgressAria", { percent }))}"><span style="--sim-usage-percent:${percent}%"></span></div>`
      }
      ${
        items.length === 0
          ? ""
          : `<div class="app-feedback-table-shell">
            <table class="app-feedback-table app-feedback-sim-table">
              <thead><tr>
                <th scope="col">${rawE(t("simOfferingName"))}</th>
                <th scope="col">${rawE(t("simUsageTotal"))}</th>
                <th scope="col">${rawE(t("simUsageUsed"))}</th>
                <th scope="col">${rawE(t("simUsageRemain"))}</th>
              </tr></thead>
              <tbody>
                ${items
                  .map(
                    (item) => `<tr>
                      <td>${e(item?.offeringName)}</td>
                      <td>${e(dataText(item?.totalKb))}</td>
                      <td>${e(dataText(item?.usedKb))}</td>
                      <td>${e(dataText(item?.remainKb))}</td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
      }`,
    );
  };

  const renderBalance = () => {
    if (!lookup?.balance) return section("simBalance", missing("balance"));
    const balance = lookup.balance;
    return section(
      "simBalance",
      `<dl class="app-feedback-device-details">
        ${detailRow("simBalanceAccount", balance.accountName)}
        ${detailRow("simBalanceAmount", balance.amount)}
        ${detailRow("simBalanceOverdue", balance.overDue)}
        ${detailRow("simBalanceLateFee", balance.lateFee)}
        ${detailRow("simBalanceConsume", balance.conSume)}
      </dl>
      <p class="app-feedback-sim-hint">${rawE(t("simBalanceHint"))}</p>`,
    );
  };

  const renderMeta = () => {
    if (!lookup) return "";
    return `<p class="app-feedback-sim-meta">
      <span>${rawE(t("simFetchedAt"))}: ${e(formatTime(lookup.fetchedAt))}</span>
      <span class="app-feedback-badge app-feedback-badge--${lookup.cached === true ? "expired" : "available"}">${rawE(t(lookup.cached === true ? "simCached" : "simLive"))}</span>
    </p>`;
  };

  const renderResult = () => {
    if (!lookup) {
      return `<div class="app-feedback-device-empty">${rawE(t("simQueryPrompt"))}</div>`;
    }
    return `${renderMeta()}
      ${renderBasic()}
      ${renderStatus()}
      ${renderOfferings()}
      ${renderRenewal()}
      ${renderUsage()}
      ${renderBalance()}`;
  };

  const detectedKind = detectSimQueryKind(simState.queryInput);
  const lookupCard = `<div class="app-feedback-card app-feedback-sim-card">
    <form class="app-feedback-device-search" data-sim-search novalidate>
      <label for="app-feedback-sim-query">${rawE(t("simQueryLabel"))}</label>
      <div>
        <input id="app-feedback-sim-query" class="app-feedback-control" data-sim-query autocomplete="off" maxlength="32" pattern="[0-9A-Za-z]{1,20}" value="${rawE(simState.queryInput)}" placeholder="${rawE(t("simQueryPlaceholder"))}" aria-label="${rawE(t("simQueryAria"))}"${busy ? " disabled" : ""}>
        <button type="submit" class="app-feedback-button app-feedback-button--primary"${busy ? " disabled" : ""}>${rawE(t(simState.lookupLoading ? "simQuerying" : "simQuery"))}</button>
        <button type="button" class="app-feedback-button" data-sim-refetch${busy || !simState.queriedValue ? " disabled" : ""}>${rawE(t(simState.refetchLoading ? "simRefetching" : "simRefetch"))}</button>
      </div>
    </form>
    ${detectedKind ? `<p class="app-feedback-sim-hint">${rawE(t(detectedKind === "iccid" ? "simDetectedIccid" : "simDetectedMsisdn"))}</p>` : ""}
    ${simState.lookupError ? `<div class="app-feedback-alert">${rawE(t("simLookupError", { message: errorCopy(simState.lookupError) }))}</div>` : ""}
    ${simState.cards.refreshError ? `<div class="app-feedback-alert">${rawE(t("simRefreshError", { message: errorCopy(simState.cards.refreshError) }))}</div>` : ""}
    ${renderResult()}
    <div class="app-feedback-sim-recharge">
      <button type="button" class="app-feedback-button" disabled>${rawE(t("simRecharge"))}</button>
      <p class="app-feedback-sim-hint">${rawE(t("simRechargeHint"))}</p>
    </div>
  </div>`;

  const cards = simState.cards;
  const pages = simCardsPageCount(cards.total);
  const cardRows = () => {
    if (cards.loading && cards.rows.length === 0) {
      return `<div class="app-feedback-device-empty">${rawE(t("simCardsLoading"))}</div>`;
    }
    if (cards.rows.length === 0) {
      return `<div class="app-feedback-device-empty">${rawE(t("simNoCards"))}</div>`;
    }
    return `<div class="app-feedback-table-shell">
      <table class="app-feedback-table app-feedback-sim-table">
        <thead><tr>
          <th scope="col">${rawE(t("simDeviceImei"))}</th>
          <th scope="col">${rawE(t("simIccid"))}</th>
          <th scope="col">${rawE(t("simMsisdn"))}</th>
          <th scope="col">${rawE(t("simSource"))}</th>
          <th scope="col">${rawE(t("status"))}</th>
          <th scope="col">${rawE(t("simExpiresAt"))}</th>
          <th scope="col">${rawE(t("simDaysLeft"))}</th>
          <th scope="col">${rawE(t("simRemainThisMonth"))}</th>
          <th scope="col">${rawE(t("simSnapshotAt"))}</th>
          <th scope="col">${rawE(t("actions"))}</th>
        </tr></thead>
        <tbody>
          ${cards.rows
            .map((row) => {
              const level = simDaysLeftLevel(row?.daysLeft);
              const days = Number(row?.daysLeft);
              const daysText =
                level === "expired"
                  ? t("simExpiredDays", { days: Math.abs(days) })
                  : level
                    ? t("simDaysValue", { days })
                    : "";
              const iccid = String(row?.iccid ?? "");
              const refreshing = cards.refreshingIccid === iccid;
              const lookupValue = iccid || String(row?.msisdn ?? "");
              return `<tr>
                <td>${e(row?.imei)}</td>
                <td>${e(iccid)}</td>
                <td>${e(row?.msisdn)}</td>
                <td>${e(SIM_SOURCE_KEYS[row?.source] ? t(SIM_SOURCE_KEYS[row.source]) : row?.source)}</td>
                <td>${e(row?.statusLabel)}</td>
                <td>${e(row?.expiresAt)}</td>
                <td><span class="app-feedback-sim-days app-feedback-sim-days--${rawE(level || "unknown")}">${e(daysText)}</span></td>
                <td>${e(dataText(row?.remainKb))}</td>
                <td>${e(formatTime(row?.snapshotAt))}${row?.snapshotError ? `<span class="app-feedback-sim-row-error">${rawE(t("simSnapshotErrorLabel", { message: row.snapshotError }))}</span>` : ""}</td>
                <td class="app-feedback-sim-row-actions">
                  <button type="button" class="app-feedback-button" data-sim-view="${rawE(lookupValue)}"${lookupValue ? "" : " disabled"}>${rawE(t("simView"))}</button>
                  <button type="button" class="app-feedback-button" data-sim-refresh-card="${rawE(iccid)}"${iccid && !cards.refreshingIccid ? "" : " disabled"}>${rawE(t(refreshing ? "simRefreshingCard" : "simRefreshCard"))}</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
  };

  const listCard = `<div class="app-feedback-card app-feedback-sim-list-card">
    <h2 class="app-feedback-sim-card-title">${rawE(t("simCardList"))}</h2>
    <div class="app-feedback-toolbar">
      <form class="app-feedback-search" data-sim-cards-search novalidate>
        <input class="app-feedback-control" data-sim-cards-query value="${rawE(cards.queryInput)}" placeholder="${rawE(t("simCardSearchPlaceholder"))}" aria-label="${rawE(t("simCardSearchAria"))}">
        <button type="submit" class="app-feedback-button app-feedback-button--primary"${cards.loading ? " disabled" : ""}>${rawE(t("search"))}</button>
      </form>
      <span class="app-feedback-total">${rawE(t("simTotalCards", { count: cards.total }))}</span>
      <button type="button" class="app-feedback-button" data-sim-cards-refresh${cards.loading ? " disabled" : ""}>${rawE(t(cards.loading ? "refreshing" : "refresh"))}</button>
    </div>
    ${cards.error ? `<div class="app-feedback-alert">${rawE(t("simCardListError", { message: errorCopy(cards.error) }))}</div>` : ""}
    ${cardRows()}
    <nav class="app-feedback-pager" aria-label="${rawE(t("page", { page: cards.page, pages }))}">
      <span>${rawE(t("page", { page: cards.page, pages }))}</span>
      <button type="button" class="app-feedback-button" data-sim-page="${cards.page - 1}"${cards.page <= 1 || cards.loading ? " disabled" : ""}>${rawE(t("previous"))}</button>
      <button type="button" class="app-feedback-button" data-sim-page="${cards.page + 1}"${cards.page >= pages || cards.loading ? " disabled" : ""}>${rawE(t("next"))}</button>
    </nav>
  </div>`;

  const manual = simState.manual;
  const importer = simState.importer;
  const failedLines = Array.isArray(importer.result?.failed)
    ? importer.result.failed
    : [];
  const entryCard = `<div class="app-feedback-card app-feedback-sim-entry-card">
    <h2 class="app-feedback-sim-card-title">${rawE(t("simManualTitle"))}</h2>
    <p class="app-feedback-sim-hint">${rawE(t("simManualSubtitle"))}</p>
    <form class="app-feedback-sim-manual" data-sim-manual novalidate>
      <label class="app-feedback-sim-field">
        <span>${rawE(t("simManualValueLabel"))}</span>
        <input class="app-feedback-control" data-sim-manual-value autocomplete="off" maxlength="32" value="${rawE(manual.valueInput)}" placeholder="${rawE(t("simQueryPlaceholder"))}"${manual.submitting ? " disabled" : ""}>
      </label>
      <label class="app-feedback-sim-field">
        <span>${rawE(t("simManualImeiLabel"))}</span>
        <input class="app-feedback-control" data-sim-manual-imei inputmode="numeric" autocomplete="off" maxlength="15" pattern="[0-9]{15}" value="${rawE(manual.imeiInput)}"${manual.submitting ? " disabled" : ""}>
      </label>
      <label class="app-feedback-sim-field">
        <span>${rawE(t("simManualRemarkLabel"))}</span>
        <input class="app-feedback-control" data-sim-manual-remark autocomplete="off" maxlength="200" value="${rawE(manual.remarkInput)}"${manual.submitting ? " disabled" : ""}>
      </label>
      <button type="submit" class="app-feedback-button app-feedback-button--primary"${manual.submitting ? " disabled" : ""}>${rawE(t(manual.submitting ? "simManualSubmitting" : "simManualSubmit"))}</button>
    </form>
    ${manual.error ? `<div class="app-feedback-alert">${rawE(t("simManualError", { message: errorCopy(manual.error) }))}</div>` : ""}
    ${manual.result ? `<div class="app-feedback-ota-success"><strong>${rawE(t("simManualSuccess", { iccid: manual.result?.iccid ?? manual.result?.msisdn ?? "" }))}</strong></div>` : ""}
    <h2 class="app-feedback-sim-card-title">${rawE(t("simImportTitle"))}</h2>
    <p class="app-feedback-sim-hint">${rawE(t("simImportHint"))}</p>
    <form class="app-feedback-sim-import" data-sim-import novalidate>
      <textarea class="app-feedback-control app-feedback-sim-textarea" data-sim-import-lines rows="6" placeholder="${rawE(t("simImportPlaceholder"))}" aria-label="${rawE(t("simImportAria"))}"${importer.submitting ? " disabled" : ""}>${rawE(importer.linesInput)}</textarea>
      <button type="submit" class="app-feedback-button app-feedback-button--primary"${importer.submitting ? " disabled" : ""}>${rawE(t(importer.submitting ? "simImportSubmitting" : "simImportSubmit"))}</button>
    </form>
    ${importer.error ? `<div class="app-feedback-alert">${rawE(t("simImportError", { message: errorCopy(importer.error) }))}</div>` : ""}
    ${
      importer.result
        ? `<div class="app-feedback-ota-success">
          <strong>${rawE(
            t("simImportResult", {
              added: Number(importer.result.added ?? 0),
              updated: Number(importer.result.updated ?? 0),
              failed: failedLines.length,
            }),
          )}</strong>
          ${
            failedLines.length === 0
              ? ""
              : `<ul class="app-feedback-sim-failed">${failedLines
                  .map(
                    (row) => `<li>${rawE(
                      t("simImportFailedLine", {
                        line: Number(row?.line ?? 0),
                        reason: String(row?.reason ?? ""),
                      }),
                    )}</li>`,
                  )
                  .join("")}</ul>`
          }
        </div>`
        : ""
    }
  </div>`;

  return `${lookupCard}${listCard}${entryCard}`;
}
