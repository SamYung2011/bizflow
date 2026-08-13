import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
} from "./app-feedback-api.js";


export const OTA_MAX_FILE_BYTES = 2 * 1024 * 1024;
const OTA_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,64}\.bin$/;

export function createOtaPackageState() {
  return {
    packageInfo: null,
    loaded: false,
    loading: false,
    loadError: null,
    selectedFile: null,
    selectError: null,
    uploadLoading: false,
    uploadError: null,
    uploadResult: null,
    confirmOpen: false,
    requestSequence: 0,
  };
}

export function validateOtaFile(file) {
  if (!file) return new HonnmonoAdminError("otaFileRequired");
  const filename = typeof file.name === "string" ? file.name : "";
  if (
    !OTA_FILENAME_PATTERN.test(filename) ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return new HonnmonoAdminError("otaFileType");
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size < 1) {
    return new HonnmonoAdminError("otaFileEmpty");
  }
  if (size > OTA_MAX_FILE_BYTES) {
    return new HonnmonoAdminError("otaFileTooLarge");
  }
  return null;
}

export async function otaFileToBase64(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new HonnmonoAdminError("otaFileReadError");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return globalThis.btoa(chunks.join(""));
}

function normalizePackageInfo(payload) {
  const current =
    payload?.current && typeof payload.current === "object"
      ? payload.current
      : null;
  const backups = Array.isArray(payload?.backups)
    ? payload.backups.filter((item) => item && typeof item === "object")
    : [];
  return { current, backups };
}

export function createOtaPackageController({
  otaState,
  scope,
  isActive,
  isDeviceTab,
  rerender,
  focus,
  request = callHonnmonoAdmin,
  encodeFile = otaFileToBase64,
}) {
  const isCurrent = (sequence) =>
    isActive() && sequence === otaState.requestSequence;

  async function load() {
    if (otaState.loading || otaState.uploadLoading) return;
    const sequence = ++otaState.requestSequence;
    otaState.loading = true;
    otaState.loadError = null;
    rerender();
    try {
      const payload = await request("/ota/package", { signal: scope.signal });
      if (isCurrent(sequence)) {
        otaState.packageInfo = normalizePackageInfo(payload);
        otaState.loaded = true;
      }
    } catch (error) {
      if (isCurrent(sequence)) otaState.loadError = error;
    } finally {
      if (isCurrent(sequence)) {
        otaState.loading = false;
        if (isDeviceTab()) rerender();
      }
    }
  }

  function selectFile(file) {
    otaState.uploadError = null;
    otaState.uploadResult = null;
    otaState.confirmOpen = false;
    otaState.selectedFile = file || null;
    otaState.selectError = file ? validateOtaFile(file) : null;
    rerender();
  }

  function openConfirm() {
    const error = validateOtaFile(otaState.selectedFile);
    otaState.selectError = error;
    otaState.uploadError = null;
    if (error || otaState.uploadLoading) {
      rerender();
      return;
    }
    otaState.confirmOpen = true;
    rerender();
    focus("[data-ota-confirm-cancel]");
  }

  function closeConfirm() {
    if (otaState.uploadLoading) return;
    otaState.confirmOpen = false;
    rerender();
    focus("[data-ota-replace]");
  }

  async function submit() {
    const file = otaState.selectedFile;
    const validationError = validateOtaFile(file);
    if (validationError || otaState.uploadLoading) {
      otaState.selectError = validationError;
      rerender();
      return;
    }

    const sequence = ++otaState.requestSequence;
    otaState.uploadLoading = true;
    otaState.uploadError = null;
    otaState.loadError = null;
    rerender();
    try {
      let contentBase64;
      try {
        contentBase64 = await encodeFile(file);
      } catch (_) {
        throw new HonnmonoAdminError("otaFileReadError");
      }
      const result = await request("/ota/package", {
        method: "POST",
        signal: scope.signal,
        body: {
          filename: file.name,
          content_base64: contentBase64,
        },
      });
      if (!isCurrent(sequence)) return;
      otaState.uploadResult = result;
      otaState.selectedFile = null;
      otaState.selectError = null;
      otaState.confirmOpen = false;

      try {
        const payload = await request("/ota/package", { signal: scope.signal });
        if (isCurrent(sequence)) {
          otaState.packageInfo = normalizePackageInfo(payload);
          otaState.loaded = true;
        }
      } catch (error) {
        if (isCurrent(sequence)) otaState.loadError = error;
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        otaState.uploadError = error;
        otaState.confirmOpen = false;
      }
    } finally {
      if (isCurrent(sequence)) {
        otaState.uploadLoading = false;
        if (isDeviceTab()) rerender();
      }
    }
  }

  return Object.freeze({
    load,
    selectFile,
    openConfirm,
    closeConfirm,
    submit,
  });
}

function formatSize(size, t) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return t("otaSizeBytes", { size: bytes });
  if (bytes < 1024 * 1024) {
    return t("otaSizeKb", { size: (bytes / 1024).toFixed(1) });
  }
  return t("otaSizeMb", { size: (bytes / (1024 * 1024)).toFixed(2) });
}

export function renderOtaPackage({
  otaState,
  t,
  escapeHtml,
  formatTime,
  errorCopy,
}) {
  const rawE = (value) => escapeHtml(value ?? "");
  const e = (value) => escapeHtml(value == null || value === "" ? "—" : value);
  const current = otaState.packageInfo?.current ?? null;
  const backups = Array.isArray(otaState.packageInfo?.backups)
    ? otaState.packageInfo.backups.slice(0, 5)
    : [];
  const selected = otaState.selectedFile;
  const detailRow = (labelKey, value, { mono = false } = {}) =>
    `<div class="app-feedback-device-detail${mono ? " app-feedback-device-detail--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${e(value)}</dd></div>`;

  const currentPackage = otaState.loading && !otaState.loaded
    ? `<div class="app-feedback-device-empty">${rawE(t("otaLoading"))}</div>`
    : current
      ? `<dl class="app-feedback-device-details app-feedback-ota-current">
          ${detailRow("otaFilename", current.filename, { mono: true })}
          ${detailRow("otaFileSize", formatSize(current.size, t))}
          ${detailRow("otaMd5", current.md5, { mono: true })}
          ${detailRow("otaChangedAt", formatTime(current.mtime))}
        </dl>`
      : `<div class="app-feedback-device-empty">${rawE(t("otaNoCurrentPackage"))}</div>`;

  const backupList = backups.length
    ? `<ul class="app-feedback-ota-backups">${backups
        .map(
          (backup) => `<li><span>${e(backup.filename)}</span><time>${e(formatTime(backup.mtime))}</time></li>`,
        )
        .join("")}</ul>`
    : `<p class="app-feedback-ota-muted">${rawE(t("otaNoBackups"))}</p>`;

  const confirm = otaState.confirmOpen && selected
    ? `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-ota-confirm-overlay>
        <section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="app-feedback-ota-confirm-title">
          <h2 id="app-feedback-ota-confirm-title">${rawE(t("otaConfirmTitle"))}</h2>
          <p>${rawE(t("otaConfirmText"))}</p>
          <dl class="app-feedback-device-confirm__details">
            ${detailRow("otaFilename", selected.name, { mono: true })}
            ${detailRow("otaFileSize", formatSize(selected.size, t))}
          </dl>
          <div class="app-feedback-device-confirm__actions">
            <button type="button" class="app-feedback-button" data-ota-confirm-cancel>${rawE(t("cancel"))}</button>
            <button type="button" class="app-feedback-button app-feedback-button--danger" data-ota-confirm-submit${otaState.uploadLoading ? " disabled" : ""}>${rawE(t(otaState.uploadLoading ? "otaReplacing" : "otaConfirmReplace"))}</button>
          </div>
        </section>
      </div>`
    : "";

  return `<section class="app-feedback-card app-feedback-ota-card" aria-labelledby="app-feedback-ota-title">
    <header class="app-feedback-ota-head">
      <div>
        <h2 id="app-feedback-ota-title">${rawE(t("otaPackageTitle"))}</h2>
        <p>${rawE(t("otaPackageSubtitle"))}</p>
      </div>
      <button type="button" class="app-feedback-button" data-ota-retry${otaState.loading || otaState.uploadLoading ? " disabled" : ""}>${rawE(t(otaState.loading ? "refreshing" : "refresh"))}</button>
    </header>
    ${otaState.loadError ? `<div class="app-feedback-alert">${rawE(t("otaLoadError", { message: errorCopy(otaState.loadError) }))}</div>` : ""}
    <section class="app-feedback-ota-section">
      <h3>${rawE(t("otaCurrentPackage"))}</h3>
      ${currentPackage}
    </section>
    <section class="app-feedback-ota-section">
      <h3>${rawE(t("otaRecentBackups"))}</h3>
      ${backupList}
    </section>
    <section class="app-feedback-ota-section app-feedback-ota-upload">
      <h3>${rawE(t("otaUploadNewPackage"))}</h3>
      <label class="app-feedback-ota-file" for="app-feedback-ota-file">
        <span>${rawE(t("otaChooseFile"))}</span>
        <input id="app-feedback-ota-file" type="file" accept=".bin" data-ota-file${otaState.uploadLoading ? " disabled" : ""}>
      </label>
      <div class="app-feedback-ota-selection">${selected ? `${e(selected.name)} · ${e(formatSize(selected.size, t))}` : rawE(t("otaNoFileSelected"))}</div>
      ${otaState.selectError ? `<div class="app-feedback-alert">${rawE(errorCopy(otaState.selectError))}</div>` : ""}
      ${otaState.uploadError ? `<div class="app-feedback-alert">${rawE(t("otaReplaceError", { message: errorCopy(otaState.uploadError) }))}</div>` : ""}
      <button type="button" class="app-feedback-button app-feedback-button--primary" data-ota-replace${!selected || otaState.selectError || otaState.uploadLoading ? " disabled" : ""}>${rawE(t(otaState.uploadLoading ? "otaReplacing" : "otaReplacePackage"))}</button>
      ${otaState.uploadResult ? `<div class="app-feedback-ota-success" aria-live="polite"><strong>${rawE(t("otaReplaceSuccess"))}</strong><span>${rawE(t("otaServerMd5"))}: <code>${e(otaState.uploadResult.md5)}</code></span><p>${rawE(t("otaMd5Hint"))}</p></div>` : ""}
    </section>
    ${confirm}
  </section>`;
}
