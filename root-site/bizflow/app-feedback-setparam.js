import { formatFeedbackTime } from "./app-feedback-api.js";

const PARAMS = ["rated_current", "max_voltage", "work_mode"];
const PROTOCOL_KEYS = {
  rated_current: "ratedCurrent",
  max_voltage: "maxVoltage",
  work_mode: "workMode",
};

export function createFlashSetparamState() {
  return {
    param: "rated_current",
    valueInput: "",
    certidInput: "",
    devices: [],
    records: [],
    loading: false,
    sending: false,
    error: "",
    confirm: null,
    lastBatch: null,
  };
}

export function toSetparamProtocolValue(param, input) {
  const value = Number(String(input).trim());
  if (!String(input).trim() || !Number.isFinite(value)) return null;
  return param === "work_mode" ? value : Math.round((value + Number.EPSILON) * 10);
}

export function matchFlashCertid(devices, input) {
  const prefix = String(input).trim().toUpperCase();
  if (prefix.length < 6) return { error: "setparamIdShort" };
  const matches = devices.filter((row) => String(row.certid).toUpperCase().startsWith(prefix));
  if (matches.length === 0) return { error: "setparamIdMissing" };
  if (matches.length > 1) return { error: "setparamIdAmbiguous" };
  return { certid: matches[0].certid, device: matches[0] };
}

export function formatSetparamValue(param, value) {
  if (value == null) return "—";
  if (param === "work_mode") return String(value);
  return `${Number(value) / 10} ${param === "rated_current" ? "A" : "V"}`;
}

export function setparamConfirmationLines(devices, param, value) {
  return devices.filter((row) => row.params != null).map((row) => ({
    certid: row.certid,
    before: formatSetparamValue(param, row.params[PROTOCOL_KEYS[param]]),
    after: formatSetparamValue(param, value),
  }));
}

export function setparamStatusText(record, t) {
  if (record.status === "queued") return t("setparamQueued");
  if (record.status === "waiting") return t("setparamWaiting");
  if (record.status === "no_reply") return t("setparamNoReply");
  if (record.status === "success") {
    const reported = Object.keys(record.params || {}).map((param) =>
      `${t(`setparam.${param}`)} ${formatSetparamValue(param, record.values?.[PROTOCOL_KEYS[param]])}`,
    ).join(", ");
    return t("setparamSuccess", { values: reported });
  }
  const reasons = { "-1": "setparamResultMissing", "-2": "setparamResultRange", "-3": "setparamResultCharging", "-5": "setparamResultCondition" };
  const reason = reasons[String(record.result)]
    ? t(reasons[String(record.result)])
    : t("setparamResultOther", { code: record.result });
  return t("setparamFailed", { reason });
}

function errorText(error, t) {
  return error?.backendMessage || t("setparamRequestFailed", { message: t(error?.code || "networkError") });
}

function details(record, t) {
  return Object.entries(record.params || {}).map(([param, value]) =>
    `${t(`setparam.${param}`)} ${formatSetparamValue(param, value)}`,
  ).join(", ");
}

export function renderFlashSetparam(view, { t, escape: e, lang }) {
  const disabled = view.loading || view.sending;
  const supported = view.devices.filter((row) => row.params != null);
  const unsupported = view.devices.length - supported.length;
  const inputHint = view.param === "rated_current" ? "setparamCurrentHint"
    : view.param === "max_voltage" ? "setparamVoltageHint" : "setparamModeHint";
  const confirm = view.confirm;
  return `<div class="app-feedback-device-panel app-feedback-setparam">
    <section class="app-feedback-card">
      <h2>${e(t("setparamTitle"))}</h2>
      <div class="app-feedback-setparam__choices" role="group" aria-label="${e(t("setparamChoose"))}">
        ${PARAMS.map((param) => `<button type="button" class="app-feedback-button${view.param === param ? " app-feedback-button--primary" : ""}" data-setparam-param="${param}" aria-pressed="${view.param === param}"${disabled ? " disabled" : ""}>${e(t(`setparam.${param}`))}</button>`).join("")}
      </div>
      <div class="app-feedback-setparam__form">
        <label><span>${e(t("setparamValue"))}</span><input class="app-feedback-control" type="number" step="${view.param === "work_mode" ? "1" : "0.1"}" data-setparam-value value="${e(view.valueInput)}"${disabled ? " disabled" : ""}></label>
        <p class="app-feedback-ota-muted">${e(t(inputHint))}</p>
        <label><span>${e(t("setparamDeviceId"))}</span><input class="app-feedback-control" type="text" data-setparam-certid value="${e(view.certidInput)}" placeholder="${e(t("setparamDevicePlaceholder"))}"${disabled ? " disabled" : ""}></label>
        <div class="app-feedback-setparam__actions">
          <button type="button" class="app-feedback-button app-feedback-button--primary" data-setparam-send${disabled ? " disabled" : ""}>${e(t(view.sending ? "refreshing" : "setparamSend"))}</button>
          <button type="button" class="app-feedback-button" data-setparam-all${disabled || !supported.length ? " disabled" : ""}>${e(t("setparamAll"))}</button>
        </div>
      </div>
      ${view.error ? `<div class="app-feedback-alert" role="alert">${e(view.error)}</div>` : ""}
      ${view.lastBatch ? `<div class="app-feedback-ota-success" aria-live="polite">${e(t("setparamQueuedCount", { count: view.lastBatch.items?.length || 0 }))}</div>` : ""}
      ${view.lastBatch?.skipped?.length ? `<ul>${view.lastBatch.skipped.map((item) => `<li>${e(item.certid)}: ${e(t(item.reason === "not_supported" ? "setparamUnsupported" : "deviceNotFoundError"))}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="app-feedback-card">
      <h2>${e(t("setparamCurrentValues"))}</h2>
      ${view.loading ? `<p>${e(t("devicesLoading"))}</p>` : `<div class="app-feedback-setparam__table-wrap"><table class="app-feedback-setparam__table"><thead><tr>
        <th>${e(t("setparamDeviceId"))}</th><th>${e(t("status"))}</th><th>${e(t("setparam.max_voltage"))}</th><th>${e(t("setparam.rated_current"))}</th><th>${e(t("setparam.work_mode"))}</th><th>${e(t("setparamCanSet"))}</th>
      </tr></thead><tbody>${view.devices.map((row) => `<tr><td title="${e(row.certid)}">${e(String(row.certid).slice(0, 6))}</td><td>${e(t(row.online ? "online" : "offline"))}</td><td>${e(formatSetparamValue("max_voltage", row.params?.maxVoltage))}</td><td>${e(formatSetparamValue("rated_current", row.params?.ratedCurrent))}</td><td>${e(formatSetparamValue("work_mode", row.params?.workMode))}</td><td>${e(t(row.params ? "setparamSupported" : "setparamUnsupported"))}</td></tr>`).join("")}</tbody></table></div>`}
      ${!view.loading && !view.devices.length ? `<p>${e(t("noDevices"))}</p>` : ""}
    </section>
    <section class="app-feedback-card">
      <h2>${e(t("setparamHistory"))}</h2>
      ${view.records.length ? `<div class="app-feedback-setparam__table-wrap"><table class="app-feedback-setparam__table"><thead><tr><th>${e(t("createdAt"))}</th><th>${e(t("setparamDeviceId"))}</th><th>${e(t("setparamChange"))}</th><th>${e(t("status"))}</th><th>${e(t("setparamOperator"))}</th></tr></thead><tbody>${view.records.map((record) => `<tr><td>${e(formatFeedbackTime(record.createdAt, lang))}</td><td title="${e(record.certid)}">${e(String(record.certid).slice(0, 6))}</td><td>${e(details(record, t))}</td><td>${e(setparamStatusText(record, t))}</td><td>${e(record.operator || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p>${e(t("setparamNoHistory"))}</p>`}
    </section>
    ${confirm ? `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-setparam-overlay><section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="setparam-confirm-title">
      <h2 id="setparam-confirm-title">${e(t("setparamConfirmTitle"))}</h2>
      <p>${e(t("setparamConfirmIntro", { count: confirm.lines.length }))}</p>
      <ul class="app-feedback-setparam__confirm-list">${confirm.lines.map((line) => `<li title="${e(line.certid)}">${e(line.certid)}: ${e(line.before)} → ${e(line.after)}</li>`).join("")}</ul>
      <p>${e(t("setparamSkippedCount", { count: unsupported }))}</p>
      <div class="app-feedback-device-confirm__actions"><button type="button" class="app-feedback-button" data-setparam-cancel>${e(t("cancel"))}</button><button type="button" class="app-feedback-button app-feedback-button--danger" data-setparam-confirm${view.sending ? " disabled" : ""}>${e(t("setparamConfirmSend"))}</button></div>
    </section></div>` : ""}
  </div>`;
}

export function createFlashSetparamController({ view, call, signal, isActive, rerender, t, setPolling }) {
  let request = 0;
  const visible = () => isActive() && document.visibilityState === "visible";
  const pending = () => view.records.some((row) => ["queued", "waiting"].includes(row.status));
  function value() {
    const converted = toSetparamProtocolValue(view.param, view.valueInput);
    if (converted === null) {
      view.error = t("setparamInvalidValue");
      rerender();
      return null;
    }
    return converted;
  }
  async function read({ quiet = false, pollSignal = signal } = {}) {
    if (!visible()) return true;
    const current = ++request;
    if (!quiet) {
      view.loading = true;
      view.error = "";
      rerender();
    }
    try {
      const first = await call("/devices/flash?page=1&pageSize=20", { signal: pollSignal });
      const rows = [...(first.items || [])];
      const pages = Math.ceil((Number(first.total) || 0) / 20);
      for (let page = 2; page <= pages; page += 1) {
        const next = await call(`/devices/flash?page=${page}&pageSize=20`, { signal: pollSignal });
        rows.push(...(next.items || []));
      }
      const history = await call("/devices/flash-setparam/recent?limit=50", { signal: pollSignal });
      if (!visible() || current !== request) return true;
      view.devices = rows;
      view.records = history.items || [];
      view.error = "";
      setPolling(pending());
      rerender();
      return true;
    } catch (error) {
      if (visible() && current === request) {
        view.error = errorText(error, t);
        rerender();
      }
      return false;
    } finally {
      if (isActive() && current === request) {
        view.loading = false;
        if (!quiet) rerender();
      }
    }
  }
  async function send(all, certid, converted) {
    view.sending = true;
    view.error = "";
    rerender();
    try {
      const result = await call("/devices/flash-setparam", {
        method: "POST", signal,
        body: { params: { [view.param]: converted }, ...(all ? { all: true } : { certids: [certid] }) },
      });
      if (!isActive()) return;
      view.lastBatch = result;
      view.confirm = null;
      await read({ quiet: true });
    } catch (error) {
      if (isActive()) view.error = errorText(error, t);
    } finally {
      if (isActive()) {
        view.sending = false;
        rerender();
      }
    }
  }
  function onInput(target) {
    if (target.matches("[data-setparam-value]")) view.valueInput = target.value;
    else if (target.matches("[data-setparam-certid]")) view.certidInput = target.value;
    else return false;
    view.error = "";
    return true;
  }
  function onClick(target) {
    const param = target.closest?.("[data-setparam-param]");
    if (param) {
      view.param = param.dataset.setparamParam;
      view.valueInput = "";
      view.error = "";
      rerender();
      return true;
    }
    if (target.closest?.("[data-setparam-cancel]") || target.matches?.("[data-setparam-overlay]")) {
      view.confirm = null;
      rerender();
      return true;
    }
    if (target.closest?.("[data-setparam-send]")) {
      const converted = value();
      if (converted === null) return true;
      const match = matchFlashCertid(view.devices, view.certidInput);
      if (match.error || match.device?.params == null) {
        view.error = t(match.error || "setparamUnsupported");
        rerender();
        return true;
      }
      void send(false, match.certid, converted);
      return true;
    }
    if (target.closest?.("[data-setparam-all]")) {
      const converted = value();
      if (converted === null) return true;
      view.confirm = { value: converted, lines: setparamConfirmationLines(view.devices, view.param, converted) };
      rerender();
      return true;
    }
    if (target.closest?.("[data-setparam-confirm]")) {
      if (view.confirm && !view.sending) void send(true, null, view.confirm.value);
      return true;
    }
    return false;
  }
  return {
    read,
    poll: ({ signal: pollSignal }) => read({ quiet: true, pollSignal }),
    onInput,
    onClick,
    hasPending: pending,
    cancel() { view.confirm = null; rerender(); },
  };
}
