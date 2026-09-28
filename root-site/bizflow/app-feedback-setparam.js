import { formatFeedbackTime } from "./app-feedback-api.js";

const PARAMS = ["rated_current", "max_voltage", "work_mode"];
const VOLTAGE_PRESETS = [
  { value: "500", label: "setparamPreset500" },
  { value: "1000", label: "setparamPreset1000" },
];
// The only work modes that can be set; mode 4 has no name yet.
export const WORK_MODES = [
  { value: 1, name: "setparamMode1Name", hint: "setparamMode1Hint" },
  { value: 2, name: "setparamMode2Name", hint: "setparamMode2Hint" },
  { value: 3, name: "setparamMode3Name", hint: "setparamMode3Hint" },
  { value: 4, hint: "setparamMode4Hint" },
];
const PROTOCOL_KEYS = {
  rated_current: "ratedCurrent",
  max_voltage: "maxVoltage",
  work_mode: "workMode",
};

export function createFlashSetparamState() {
  return {
    param: "max_voltage",
    valueInput: "",
    certidInput: "",
    passwordInput: "",
    passwordError: "",
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

// A chosen mode wins; otherwise the typed device's current mode, else mode 1.
export function selectedWorkMode(view) {
  const wanted = view.valueInput
    ? Number(view.valueInput)
    : matchFlashCertid(view.devices, view.certidInput).device?.params?.workMode;
  return WORK_MODES.find(({ value }) => value === wanted) || WORK_MODES[0];
}

export function formatSetparamValue(param, value, t) {
  if (value == null) return "—";
  if (param === "work_mode") {
    const mode = WORK_MODES.find((item) => item.value === value);
    if (!mode) return t("setparamModeClosed", { mode: value });
    return mode.name ? t("setparamModeNamed", { mode: value, name: t(mode.name) }) : t("setparamModeNumber", { mode: value });
  }
  return `${Number(value) / 10} ${param === "rated_current" ? "A" : "V"}`;
}

export function setparamConfirmationLines(devices, param, value, t) {
  return devices.filter((row) => row.params != null).map((row) => ({
    certid: row.certid,
    before: formatSetparamValue(param, row.params[PROTOCOL_KEYS[param]], t),
    after: formatSetparamValue(param, value, t),
  }));
}

export function setparamStatusText(record, t) {
  if (record.status === "queued") return t("setparamQueued");
  if (record.status === "waiting") return t("setparamWaiting");
  if (record.status === "no_reply") return t("setparamNoReply");
  if (record.status === "success") {
    const reported = Object.keys(record.params || {}).map((param) =>
      `${t(`setparam.${param}`)} ${formatSetparamValue(param, record.values?.[PROTOCOL_KEYS[param]], t)}`,
    ).join(", ");
    return t("setparamSuccess", { values: reported });
  }
  const reasons = { "-1": "setparamResultMissing", "-2": "setparamResultRange", "-3": "setparamResultCharging", "-5": "setparamResultCondition" };
  const reason = reasons[String(record.result)]
    ? t(reasons[String(record.result)])
    : t("setparamResultOther", { code: record.result });
  return t("setparamFailed", { reason });
}

export function setparamErrorText(error, t) {
  const detail = error?.backendDetail;
  const code = detail?.error;
  if (code === "param_out_of_range") {
    if (detail.param === "rated_current") {
      return t("setparamCurrentOutOfRange", { max: formatSetparamValue(detail.param, detail.max) });
    }
    if (detail.param === "max_voltage") {
      return t("setparamVoltageOutOfRange", {
        min: formatSetparamValue(detail.param, detail.min),
        max: formatSetparamValue(detail.param, detail.max),
      });
    }
    return t("setparamModeOutOfRange", { min: detail.min, max: detail.max });
  }
  if (code === "param_not_integer") {
    return t("setparamNotInteger", { param: t(`setparam.${detail.param}`) });
  }
  if (code === "unknown_param") return t("setparamUnknownParam", { param: detail.param });
  const keys = {
    invalid_params: "setparamInvalidParams",
    invalid_target: "setparamInvalidTarget",
    invalid_certids: "setparamInvalidCertids",
    password_required: "setparamPasswordRequired",
    password_incorrect: "setparamPasswordIncorrect",
    password_check_failed: "setparamPasswordCheckFailed",
  };
  return t(keys[code] || "setparamServiceError");
}

function details(record, t) {
  return Object.entries(record.params || {}).map(([param, value]) =>
    `${t(`setparam.${param}`)} ${formatSetparamValue(param, value, t)}`,
  ).join(", ");
}

export function renderFlashSetparam(view, { t, escape: e, lang }) {
  const disabled = view.loading || view.sending;
  const supported = view.devices.filter((row) => row.params != null);
  const unsupported = view.devices.length - supported.length;
  const mode = view.param === "work_mode" ? selectedWorkMode(view) : null;
  const inputHint = view.param === "rated_current" ? "setparamCurrentHint"
    : view.param === "max_voltage" ? "setparamVoltageHint" : mode.hint;
  const confirm = view.confirm;
  return `<div class="app-feedback-device-panel app-feedback-setparam">
    <section class="app-feedback-card">
      <h2>${e(t("setparamTitle"))}</h2>
      <div class="app-feedback-setparam__choices" role="group" aria-label="${e(t("setparamChoose"))}">
        ${PARAMS.map((param) => `<button type="button" class="app-feedback-button${view.param === param ? " app-feedback-button--primary" : ""}" data-setparam-param="${param}" aria-pressed="${view.param === param}"${disabled ? " disabled" : ""}>${e(t(`setparam.${param}`))}</button>`).join("")}
      </div>
      <div class="app-feedback-setparam__form">
        <label><span>${e(t("setparamValue"))}</span>${mode
          ? `<select class="app-feedback-control" data-setparam-value${disabled ? " disabled" : ""}>${WORK_MODES.map((item) => `<option value="${item.value}"${item === mode ? " selected" : ""}>${e(formatSetparamValue("work_mode", item.value, t))}</option>`).join("")}</select>`
          : `<input class="app-feedback-control" type="number" step="0.1" data-setparam-value value="${e(view.valueInput)}"${disabled ? " disabled" : ""}>`}</label>
        ${view.param === "max_voltage" ? `<div class="app-feedback-setparam__presets" role="group" aria-label="${e(t("setparam.max_voltage"))}">
          ${VOLTAGE_PRESETS.map(({ value, label }) => `<button type="button" class="app-feedback-button" data-setparam-voltage="${value}"${disabled ? " disabled" : ""}>${e(t(label))}</button>`).join("")}
        </div>` : ""}
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
      </tr></thead><tbody>${view.devices.map((row) => `<tr><td title="${e(row.certid)}">${e(String(row.certid).slice(0, 6))}</td><td>${e(t(row.online ? "online" : "offline"))}</td><td>${e(formatSetparamValue("max_voltage", row.params?.maxVoltage))}</td><td>${e(formatSetparamValue("rated_current", row.params?.ratedCurrent))}</td><td>${e(formatSetparamValue("work_mode", row.params?.workMode, t))}</td><td>${e(t(row.params ? "setparamSupported" : "setparamUnsupported"))}</td></tr>`).join("")}</tbody></table></div>`}
      ${!view.loading && !view.devices.length ? `<p>${e(t("noDevices"))}</p>` : ""}
    </section>
    <section class="app-feedback-card">
      <h2>${e(t("setparamHistory"))}</h2>
      ${view.records.length ? `<div class="app-feedback-setparam__table-wrap"><table class="app-feedback-setparam__table"><thead><tr><th>${e(t("createdAt"))}</th><th>${e(t("setparamDeviceId"))}</th><th>${e(t("setparamChange"))}</th><th>${e(t("status"))}</th><th>${e(t("setparamOperator"))}</th></tr></thead><tbody>${view.records.map((record) => `<tr><td>${e(formatFeedbackTime(record.createdAt, lang))}</td><td title="${e(record.certid)}">${e(String(record.certid).slice(0, 6))}</td><td>${e(details(record, t))}</td><td>${e(setparamStatusText(record, t))}</td><td>${e(record.operator || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p>${e(t("setparamNoHistory"))}</p>`}
    </section>
    ${confirm ? `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-setparam-overlay><section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="setparam-confirm-title">
      <h2 id="setparam-confirm-title">${e(t(confirm.kind === "single" ? "setparamPasswordTitle" : "setparamConfirmTitle"))}</h2>
      ${confirm.kind === "single" ? `<p>${e(t("setparamPasswordPrompt"))}</p>` : `<p>${e(t("setparamConfirmIntro", { count: confirm.lines.length }))}</p>
      <ul class="app-feedback-setparam__confirm-list">${confirm.lines.map((line) => `<li title="${e(line.certid)}">${e(line.certid)}: ${e(line.before)} → ${e(line.after)}</li>`).join("")}</ul>
      <p>${e(t("setparamSkippedCount", { count: unsupported }))}</p>`}
      ${confirm.param === "rated_current" ? `<label class="app-feedback-setparam__password"><span>${e(t("setparamPasswordLabel"))}</span><input class="app-feedback-control" type="password" autocomplete="current-password" data-setparam-password value="${e(view.passwordInput)}"${view.sending ? " disabled" : ""}></label>${view.passwordError ? `<div class="app-feedback-alert" role="alert">${e(view.passwordError)}</div>` : ""}` : ""}
      ${view.error ? `<div class="app-feedback-alert" role="alert">${e(view.error)}</div>` : ""}
      <div class="app-feedback-device-confirm__actions"><button type="button" class="app-feedback-button" data-setparam-cancel${view.sending ? " disabled" : ""}>${e(t("cancel"))}</button><button type="button" class="app-feedback-button app-feedback-button--danger" data-setparam-confirm${view.sending ? " disabled" : ""}>${e(t(view.sending ? "refreshing" : "setparamConfirmSend"))}</button></div>
    </section></div>` : ""}
  </div>`;
}

export function createFlashSetparamController({ view, call, signal, isActive, rerender, t, setPolling }) {
  let request = 0;
  const visible = () => isActive() && document.visibilityState === "visible";
  const pending = () => view.records.some((row) => ["queued", "waiting"].includes(row.status));
  function value() {
    const input = view.param === "work_mode" ? selectedWorkMode(view).value : view.valueInput;
    const converted = toSetparamProtocolValue(view.param, input);
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
        view.error = setparamErrorText(error, t);
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
  async function send(all, certid, converted, param) {
    view.sending = true;
    view.error = "";
    view.passwordError = "";
    const password = view.passwordInput;
    view.passwordInput = "";
    rerender();
    try {
      const result = await call("/devices/flash-setparam", {
        method: "POST", signal,
        body: {
          params: { [param]: converted },
          ...(all ? { all: true } : { certids: [certid] }),
          ...(param === "rated_current" ? { password } : {}),
        },
      });
      view.lastBatch = result;
      view.confirm = null;
      if (isActive()) await read({ quiet: true });
    } catch (error) {
      const message = setparamErrorText(error, t);
      if (["password_required", "password_incorrect"].includes(error?.backendDetail?.error)) {
        view.passwordError = message;
      } else {
        view.error = message;
      }
    } finally {
      view.sending = false;
      if (isActive()) {
        rerender();
      }
    }
  }
  function onInput(target) {
    const shownMode = view.param === "work_mode" && selectedWorkMode(view);
    if (target.matches("[data-setparam-value]")) view.valueInput = target.value;
    else if (target.matches("[data-setparam-certid]")) view.certidInput = target.value;
    else if (target.matches("[data-setparam-password]")) {
      view.passwordInput = target.value;
      view.passwordError = "";
    }
    else return false;
    view.error = "";
    if (shownMode && selectedWorkMode(view) !== shownMode) {
      // Redraw the picker and its description, then let typing in the device ID continue.
      rerender();
      if (target.matches("[data-setparam-certid]")) {
        const input = document.querySelector("[data-setparam-certid]");
        input.focus();
        input.setSelectionRange(target.selectionStart, target.selectionEnd);
      }
    }
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
    const preset = target.closest?.("[data-setparam-voltage]");
    if (preset) {
      const selected = preset.dataset.setparamVoltage;
      if (view.param === "max_voltage" && !view.loading && !view.sending && VOLTAGE_PRESETS.some(({ value }) => value === selected)) {
        view.valueInput = selected;
        view.error = "";
        rerender();
      }
      return true;
    }
    if (target.closest?.("[data-setparam-cancel]") || target.matches?.("[data-setparam-overlay]")) {
      if (view.sending) return true;
      view.confirm = null;
      view.passwordInput = "";
      view.passwordError = "";
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
      if (view.param === "rated_current") {
        view.confirm = { kind: "single", certid: match.certid, value: converted, param: view.param };
        view.passwordError = "";
        view.error = "";
        rerender();
      } else {
        void send(false, match.certid, converted, view.param);
      }
      return true;
    }
    if (target.closest?.("[data-setparam-all]")) {
      const converted = value();
      if (converted === null) return true;
      view.confirm = { kind: "all", param: view.param, value: converted, lines: setparamConfirmationLines(view.devices, view.param, converted, t) };
      view.passwordError = "";
      view.error = "";
      rerender();
      return true;
    }
    if (target.closest?.("[data-setparam-confirm]")) {
      if (view.confirm && !view.sending) {
        const confirm = view.confirm;
        void send(confirm.kind === "all", confirm.certid, confirm.value, confirm.param);
      }
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
    cancel() {
      if (view.sending) return;
      view.confirm = null;
      view.passwordInput = "";
      view.passwordError = "";
      rerender();
    },
  };
}
