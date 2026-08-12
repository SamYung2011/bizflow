import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
} from "./app-feedback-api.js";


const IMEI_PATTERN = /^\d{15}$/;

const STEP_LABEL_KEYS = Object.freeze({
  dev_cloud: "stepDevCloud",
  sr_iot_device: "stepDevice",
  sr_iot_config_value: "stepConfig",
  dev_infos: "stepDevInfos",
  lufengzhe: "stepLufengzhe",
});

const STEP_STATUS_KEYS = Object.freeze({
  ok: "stepOk",
  skip: "stepSkip",
  fail: "stepFail",
  unverified: "stepUnverified",
});

export function isValidDeviceImei(value) {
  return IMEI_PATTERN.test(String(value || ""));
}

export function createDeviceUnbindState(saved = {}) {
  return {
    imeiInput:
      typeof saved.deviceImeiInput === "string"
        ? saved.deviceImeiInput.replace(/\D/g, "").slice(0, 15)
        : "",
    queriedImei: "",
    binding: null,
    lookupLoading: false,
    lookupError: null,
    unbindLoading: false,
    unbindError: null,
    result: null,
    confirmOpen: false,
    requestSequence: 0,
  };
}

export function deviceExpectedUserId(binding) {
  const value = Number(binding?.dev_cloud?.userid);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createDeviceUnbindController({
  deviceState,
  scope,
  isActive,
  isDeviceTab,
  rerender,
  focus,
  request = callHonnmonoAdmin,
}) {
  const isCurrent = (sequence) =>
    isActive() && sequence === deviceState.requestSequence;

  function setImeiInput(rawValue) {
    const value = String(rawValue || "").replace(/\D/g, "").slice(0, 15);
    deviceState.imeiInput = value;
    deviceState.lookupError = null;
    deviceState.unbindError = null;
    if (value !== deviceState.queriedImei) {
      deviceState.binding = null;
      deviceState.result = null;
      deviceState.confirmOpen = false;
    }
    return value;
  }

  async function lookup() {
    const imei = deviceState.imeiInput.trim();
    if (!isValidDeviceImei(imei)) {
      deviceState.lookupError = new HonnmonoAdminError("imeiValidation");
      deviceState.binding = null;
      deviceState.result = null;
      rerender();
      return;
    }

    const sequence = ++deviceState.requestSequence;
    deviceState.lookupLoading = true;
    deviceState.lookupError = null;
    deviceState.unbindError = null;
    deviceState.result = null;
    deviceState.confirmOpen = false;
    rerender();
    try {
      const binding = await request(
        `/device/binding?imei=${encodeURIComponent(imei)}`,
        { signal: scope.signal },
      );
      if (isCurrent(sequence) && isDeviceTab()) {
        deviceState.queriedImei = imei;
        deviceState.binding = binding;
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        deviceState.binding = null;
        deviceState.lookupError = error;
      }
    } finally {
      if (isCurrent(sequence)) {
        deviceState.lookupLoading = false;
        rerender();
      }
    }
  }

  function openConfirm() {
    if (
      !deviceState.binding ||
      deviceState.binding.unbound === true ||
      deviceExpectedUserId(deviceState.binding) == null
    ) {
      return;
    }
    deviceState.unbindError = null;
    deviceState.confirmOpen = true;
    rerender();
    focus("[data-device-confirm-cancel]");
  }

  function closeConfirm() {
    if (deviceState.unbindLoading) return;
    deviceState.confirmOpen = false;
    rerender();
    focus("[data-device-unbind]");
  }

  async function submitUnbind() {
    const expectedUserid = deviceExpectedUserId(deviceState.binding);
    const imei = deviceState.queriedImei;
    if (
      !isValidDeviceImei(imei) ||
      expectedUserid == null ||
      deviceState.unbindLoading
    ) {
      return;
    }

    const sequence = ++deviceState.requestSequence;
    deviceState.unbindLoading = true;
    deviceState.unbindError = null;
    rerender();
    try {
      const result = await request("/device/unbind", {
        method: "POST",
        signal: scope.signal,
        body: { imei, expected_userid: expectedUserid },
      });
      if (isCurrent(sequence) && isDeviceTab()) {
        deviceState.result = result;
        if (result?.binding && typeof result.binding === "object") {
          deviceState.binding = result.binding;
        }
        deviceState.confirmOpen = false;
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        deviceState.unbindError = error;
        deviceState.confirmOpen = false;
        if (error instanceof HonnmonoAdminError && error.status === 409) {
          deviceState.binding = null;
        }
      }
    } finally {
      if (isCurrent(sequence)) {
        deviceState.unbindLoading = false;
        rerender();
      }
    }
  }

  return Object.freeze({
    setImeiInput,
    lookup,
    openConfirm,
    closeConfirm,
    submitUnbind,
  });
}

function bindingVin(binding) {
  return binding?.sr_iot_config_value?.mapping?.vin ?? "";
}

function bindingOwner(binding, t) {
  return {
    username:
      binding?.binding_user?.username ||
      binding?.sr_iot_device?.binder ||
      t("unknownUser"),
    contact: binding?.binding_user?.contact || "",
  };
}

export function renderDeviceUnbind({
  deviceState,
  t,
  escapeHtml,
  formatTime,
  errorCopy,
}) {
  const rawE = (value) => escapeHtml(value ?? "");
  const e = (value) =>
    escapeHtml(value == null || value === "" ? "—" : value);
  const detailRow = (labelKey, value, { mono = false } = {}) =>
    `<div class="app-feedback-device-detail${mono ? " app-feedback-device-detail--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${e(value)}</dd></div>`;

  const renderBinding = () => {
    const binding = deviceState.binding;
    if (!binding) {
      return `<div class="app-feedback-device-empty">${rawE(t("deviceQueryPrompt"))}</div>`;
    }
    const owner = bindingOwner(binding, t);
    const isUnbound = binding.unbound === true;
    return `<section class="app-feedback-device-binding" aria-labelledby="app-feedback-device-binding-title">
      <div class="app-feedback-device-binding__head">
        <div>
          <h2 id="app-feedback-device-binding-title">${rawE(t("deviceBindingDetails"))}</h2>
          <span class="app-feedback-device-status app-feedback-device-status--${isUnbound ? "unbound" : "bound"}">${rawE(t(isUnbound ? "deviceUnbound" : "deviceBound"))}</span>
        </div>
        <button type="button" class="app-feedback-button app-feedback-button--danger" data-device-unbind${isUnbound || deviceState.unbindLoading ? " disabled" : ""}>${rawE(t(deviceState.unbindLoading ? "unbinding" : "unbindDevice"))}</button>
      </div>
      <dl class="app-feedback-device-details">
        ${detailRow("uuid", binding?.dev_cloud?.uuid, { mono: true })}
        ${detailRow("imei", binding?.imei, { mono: true })}
        ${detailRow("bindingUser", owner.username)}
        ${detailRow("contact", owner.contact)}
        ${detailRow("bindingTime", formatTime(binding?.dev_cloud?.bindtime))}
        ${detailRow("vin", bindingVin(binding), { mono: true })}
        ${detailRow("managedAccount", t(binding?.lufengzhe_account?.exists ? "yes" : "no"))}
      </dl>
    </section>`;
  };

  const renderResult = () => {
    const result = deviceState.result;
    if (!result) return "";
    const steps = Array.isArray(result.steps) ? result.steps : [];
    const noAccount = result.lufengzhe === "no_account";
    const providerUnverified = steps.some(
      (step) => step?.key === "lufengzhe" && step?.status === "unverified",
    );
    return `<section class="app-feedback-device-result" aria-live="polite">
      <h2>${rawE(t("unbindResult"))}</h2>
      <p class="app-feedback-device-result__summary">${rawE(t(result.status === "already_unbound" ? "alreadyUnbound" : "unbindSuccess"))}</p>
      <ul class="app-feedback-device-checklist">
        ${steps
          .map((step) => {
            const status = ["ok", "skip", "fail", "unverified"].includes(step?.status)
              ? step.status
              : "fail";
            const labelKey = STEP_LABEL_KEYS[step?.key];
            const label = labelKey ? t(labelKey) : step?.key;
            return `<li class="app-feedback-device-check app-feedback-device-check--${status}"><span>${e(label)}</span><strong>${rawE(t(STEP_STATUS_KEYS[status]))}</strong></li>`;
          })
          .join("")}
      </ul>
      ${noAccount ? `<div class="app-feedback-device-warning">${rawE(t("noAccountWarning"))}</div>` : ""}
      ${providerUnverified ? `<div class="app-feedback-device-warning">${rawE(t("providerUnverifiedWarning"))}</div>` : ""}
    </section>`;
  };

  const renderConfirm = () => {
    if (!deviceState.confirmOpen || !deviceState.binding) return "";
    const owner = bindingOwner(deviceState.binding, t);
    return `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-device-confirm-overlay>
      <section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="app-feedback-device-confirm-title">
        <h2 id="app-feedback-device-confirm-title">${rawE(t("unbindConfirmTitle"))}</h2>
        <p>${rawE(t("unbindConfirmText"))}</p>
        <dl class="app-feedback-device-confirm__details">
          ${detailRow("bindingUser", owner.username)}
          ${detailRow("contact", owner.contact)}
          ${detailRow("imei", deviceState.binding.imei, { mono: true })}
        </dl>
        <div class="app-feedback-device-confirm__actions">
          <button type="button" class="app-feedback-button" data-device-confirm-cancel>${rawE(t("cancel"))}</button>
          <button type="button" class="app-feedback-button app-feedback-button--danger" data-device-confirm-submit${deviceState.unbindLoading ? " disabled" : ""}>${rawE(t(deviceState.unbindLoading ? "unbinding" : "confirmUnbind"))}</button>
        </div>
      </section>
    </div>`;
  };

  return `<div class="app-feedback-card app-feedback-device-card">
    <form class="app-feedback-device-search" data-device-search novalidate>
      <label for="app-feedback-device-imei">${rawE(t("imei"))}</label>
      <div>
        <input id="app-feedback-device-imei" class="app-feedback-control" data-device-imei inputmode="numeric" autocomplete="off" maxlength="15" pattern="[0-9]{15}" value="${rawE(deviceState.imeiInput)}" placeholder="${rawE(t("imeiPlaceholder"))}" aria-label="${rawE(t("imeiSearchAria"))}"${deviceState.lookupLoading || deviceState.unbindLoading ? " disabled" : ""}>
        <button type="submit" class="app-feedback-button app-feedback-button--primary"${deviceState.lookupLoading || deviceState.unbindLoading ? " disabled" : ""}>${rawE(t(deviceState.lookupLoading ? "queryingDevice" : "queryDevice"))}</button>
      </div>
    </form>
    ${deviceState.lookupError ? `<div class="app-feedback-alert">${rawE(t("deviceLookupError", { message: errorCopy(deviceState.lookupError) }))}</div>` : ""}
    ${deviceState.unbindError ? `<div class="app-feedback-alert">${rawE(t("deviceUnbindError", { message: errorCopy(deviceState.unbindError) }))}</div>` : ""}
    ${renderBinding()}
    ${renderResult()}
    ${renderConfirm()}
  </div>`;
}
