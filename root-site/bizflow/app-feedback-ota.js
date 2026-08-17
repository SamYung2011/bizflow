import {
  HonnmonoAdminError,
  callHonnmonoAdmin,
} from "./app-feedback-api.js";


export const OTA_MAX_FILE_BYTES = 2 * 1024 * 1024;
const OTA_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,60}\.bin$/;
const LEGACY_OTA_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,60}\.UPG$/i;
const OTA_VERSION_PATTERN = /^(\d+)\.(\d+)$/;

export function createOtaPackageState() {
  return {
    packageInfo: null,
    loaded: false,
    loading: false,
    loadError: null,
    selectedFile: null,
    selectError: null,
    versionInput: "",
    versionError: null,
    uploadLoading: false,
    uploadError: null,
    uploadResult: null,
    confirmOpen: false,
    legacyPackages: [],
    legacyLoaded: false,
    legacyLoadError: null,
    legacySelectedFiles: {},
    legacySelectErrors: {},
    legacyUploadErrors: {},
    legacyUploadResults: {},
    legacyUploadingSlot: null,
    legacyConfirmSlot: null,
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

export function validateLegacyOtaFile(file) {
  if (!file) return new HonnmonoAdminError("legacyOtaFileRequired");
  const filename = typeof file.name === "string" ? file.name : "";
  if (
    !LEGACY_OTA_FILENAME_PATTERN.test(filename) ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return new HonnmonoAdminError("legacyOtaFileType");
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

export function parseOtaVersion(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const match = text.match(OTA_VERSION_PATTERN);
  if (!match) throw new HonnmonoAdminError("otaVersionFormat");
  const mainver = Number(match[1]);
  const subver = Number(match[2]);
  if (!Number.isSafeInteger(mainver) || !Number.isSafeInteger(subver)) {
    throw new HonnmonoAdminError("otaVersionFormat");
  }
  return { mainver, subver };
}

export function validateOtaVersion(value) {
  try {
    parseOtaVersion(value);
    return null;
  } catch (error) {
    return error instanceof HonnmonoAdminError
      ? error
      : new HonnmonoAdminError("otaVersionFormat");
  }
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

function normalizeLegacyPackages(payload) {
  return Array.isArray(payload?.items)
    ? payload.items.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          [150001, 150002, 150003, 150004].includes(Number(item.id)),
      )
    : [];
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
    otaState.legacyLoadError = null;
    rerender();
    const [packageResult, legacyResult] = await Promise.allSettled([
      request("/ota/package", { signal: scope.signal }),
      request("/ota/legacy-packages", { signal: scope.signal }),
    ]);
    if (isCurrent(sequence)) {
      if (packageResult.status === "fulfilled") {
        const payload = packageResult.value;
        otaState.packageInfo = normalizePackageInfo(payload);
        otaState.loaded = true;
      } else {
        otaState.loadError = packageResult.reason;
      }
      if (legacyResult.status === "fulfilled") {
        otaState.legacyPackages = normalizeLegacyPackages(legacyResult.value);
        otaState.legacyLoaded = true;
      } else {
        otaState.legacyLoadError = legacyResult.reason;
      }
    }
    otaState.loading = false;
    if (isActive() && isDeviceTab()) rerender();
  }

  function selectFile(file) {
    otaState.uploadError = null;
    otaState.uploadResult = null;
    otaState.confirmOpen = false;
    otaState.selectedFile = file || null;
    otaState.selectError = file ? validateOtaFile(file) : null;
    rerender();
  }

  function setVersionInput(value) {
    otaState.versionInput = typeof value === "string" ? value : "";
    otaState.versionError = validateOtaVersion(otaState.versionInput);
    otaState.uploadError = null;
    otaState.uploadResult = null;
    return otaState.versionError;
  }

  function openConfirm() {
    const fileError = validateOtaFile(otaState.selectedFile);
    const versionError = validateOtaVersion(otaState.versionInput);
    otaState.selectError = fileError;
    otaState.versionError = versionError;
    otaState.uploadError = null;
    if (fileError || versionError || otaState.uploadLoading) {
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

  function selectLegacyFile(slotId, file) {
    const key = String(slotId);
    otaState.legacySelectedFiles[key] = file || null;
    otaState.legacySelectErrors[key] = file
      ? validateLegacyOtaFile(file)
      : null;
    otaState.legacyUploadErrors[key] = null;
    otaState.legacyUploadResults[key] = null;
    otaState.legacyConfirmSlot = null;
    rerender();
  }

  function openLegacyConfirm(slotId) {
    const key = String(slotId);
    const error = validateLegacyOtaFile(otaState.legacySelectedFiles[key]);
    otaState.legacySelectErrors[key] = error;
    if (error || otaState.legacyUploadingSlot != null) {
      rerender();
      return;
    }
    otaState.legacyConfirmSlot = Number(slotId);
    rerender();
    focus("[data-legacy-ota-confirm-cancel]");
  }

  function closeLegacyConfirm() {
    if (otaState.legacyUploadingSlot != null) return;
    const slotId = otaState.legacyConfirmSlot;
    otaState.legacyConfirmSlot = null;
    rerender();
    focus(`[data-legacy-ota-replace="${slotId}"]`);
  }

  async function submit() {
    const file = otaState.selectedFile;
    const fileError = validateOtaFile(file);
    const versionError = validateOtaVersion(otaState.versionInput);
    if (fileError || versionError || otaState.uploadLoading) {
      otaState.selectError = fileError;
      otaState.versionError = versionError;
      rerender();
      return;
    }
    const version = parseOtaVersion(otaState.versionInput);

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
          ...(version || {}),
        },
      });
      if (!isCurrent(sequence)) return;
      otaState.uploadResult = result;
      otaState.selectedFile = null;
      otaState.selectError = null;
      otaState.versionInput = "";
      otaState.versionError = null;
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

  async function submitLegacy() {
    const slotId = Number(otaState.legacyConfirmSlot);
    const key = String(slotId);
    const file = otaState.legacySelectedFiles[key];
    const fileError = validateLegacyOtaFile(file);
    if (
      ![150001, 150002, 150003, 150004].includes(slotId) ||
      fileError ||
      otaState.legacyUploadingSlot != null
    ) {
      otaState.legacySelectErrors[key] = fileError;
      rerender();
      return;
    }
    const slot = otaState.legacyPackages.find(
      (item) => Number(item.id) === slotId,
    );
    const sequence = ++otaState.requestSequence;
    otaState.legacyUploadingSlot = slotId;
    otaState.legacyUploadErrors[key] = null;
    rerender();
    try {
      const contentBase64 = await encodeFile(file);
      const result = await request(`/ota/legacy-packages/${slotId}`, {
        method: "POST",
        signal: scope.signal,
        body: {
          filename: file.name,
          content_base64: contentBase64,
          previousFilename: slot?.filename || "",
        },
      });
      if (!isCurrent(sequence)) return;
      otaState.legacyUploadResults[key] = result;
      otaState.legacySelectedFiles[key] = null;
      otaState.legacySelectErrors[key] = null;
      otaState.legacyConfirmSlot = null;
      const legacyPayload = await request("/ota/legacy-packages", {
        signal: scope.signal,
      });
      if (isCurrent(sequence)) {
        otaState.legacyPackages = normalizeLegacyPackages(legacyPayload);
        otaState.legacyLoaded = true;
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        otaState.legacyUploadErrors[key] = error;
        otaState.legacyConfirmSlot = null;
      }
    } finally {
      if (isCurrent(sequence)) {
        otaState.legacyUploadingSlot = null;
        if (isDeviceTab()) rerender();
      }
    }
  }

  return Object.freeze({
    load,
    selectFile,
    setVersionInput,
    openConfirm,
    closeConfirm,
    submit,
    selectLegacyFile,
    openLegacyConfirm,
    closeLegacyConfirm,
    submitLegacy,
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

function formatVersion(version, t) {
  const mainver = version?.mainver;
  const subver = version?.subver;
  if (
    typeof mainver !== "number" ||
    !Number.isSafeInteger(mainver) ||
    mainver < 0 ||
    typeof subver !== "number" ||
    !Number.isSafeInteger(subver) ||
    subver < 0
  ) {
    return t("otaVersionNotRecorded");
  }
  return `${mainver}.${subver}`;
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
  const legacyPackages = Array.isArray(otaState.legacyPackages)
    ? otaState.legacyPackages
    : [];
  const selected = otaState.selectedFile;
  const detailRow = (labelKey, value, { mono = false } = {}) =>
    `<div class="app-feedback-device-detail${mono ? " app-feedback-device-detail--mono" : ""}"><dt>${rawE(t(labelKey))}</dt><dd>${e(value)}</dd></div>`;

  const currentPackage = otaState.loading && !otaState.loaded
    ? `<div class="app-feedback-device-empty">${rawE(t("otaLoading"))}</div>`
    : current
      ? `<dl class="app-feedback-device-details app-feedback-ota-current">
          ${detailRow("otaFilename", current.filename, { mono: true })}
          ${detailRow("otaVersion", formatVersion(current.version, t), { mono: true })}
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
            ${detailRow("otaVersion", formatVersion(parseOtaVersion(otaState.versionInput), t), { mono: true })}
            ${detailRow("otaFileSize", formatSize(selected.size, t))}
          </dl>
          <div class="app-feedback-device-confirm__actions">
            <button type="button" class="app-feedback-button" data-ota-confirm-cancel>${rawE(t("cancel"))}</button>
            <button type="button" class="app-feedback-button app-feedback-button--danger" data-ota-confirm-submit${otaState.uploadLoading ? " disabled" : ""}>${rawE(t(otaState.uploadLoading ? "otaReplacing" : "otaConfirmReplace"))}</button>
          </div>
        </section>
      </div>`
    : "";

  const legacyCards = otaState.loading && !otaState.legacyLoaded
    ? `<div class="app-feedback-device-empty">${rawE(t("otaLoading"))}</div>`
    : legacyPackages.length
      ? `<div class="app-feedback-legacy-ota-grid">${legacyPackages
          .map((slot) => {
            const key = String(slot.id);
            const file = otaState.legacySelectedFiles[key];
            const busy = otaState.legacyUploadingSlot === Number(slot.id);
            return `<article class="app-feedback-device-binding app-feedback-legacy-ota-slot">
              <header class="app-feedback-device-binding__head">
                <div><h2>${e(slot.name || t("legacyOtaSlot", { id: slot.id }))}</h2><span class="app-feedback-device-status app-feedback-device-status--bound">${e(slot.carModel || slot.code)}</span></div>
              </header>
              <dl class="app-feedback-device-details">
                ${detailRow("otaFilename", slot.filename, { mono: true })}
                ${detailRow("otaMd5", slot.md5, { mono: true })}
                ${detailRow("otaUrl", slot.url, { mono: true })}
                ${detailRow("otaChangedAt", formatTime(slot.updatedAt))}
              </dl>
              <div class="app-feedback-ota-upload">
                <label class="app-feedback-ota-file" for="app-feedback-legacy-ota-${rawE(slot.id)}">
                  <span>${rawE(t("legacyOtaChooseFile"))}</span>
                  <input id="app-feedback-legacy-ota-${rawE(slot.id)}" type="file" accept=".UPG,.upg" data-legacy-ota-file="${rawE(slot.id)}"${busy ? " disabled" : ""}>
                </label>
                <div class="app-feedback-ota-selection">${file ? `${e(file.name)} · ${e(formatSize(file.size, t))}` : rawE(t("otaNoFileSelected"))}</div>
                ${otaState.legacySelectErrors[key] ? `<div class="app-feedback-alert">${rawE(errorCopy(otaState.legacySelectErrors[key]))}</div>` : ""}
                ${otaState.legacyUploadErrors[key] ? `<div class="app-feedback-alert">${rawE(t("legacyOtaReplaceError", { message: errorCopy(otaState.legacyUploadErrors[key]) }))}</div>` : ""}
                <button type="button" class="app-feedback-button app-feedback-button--primary" data-legacy-ota-replace="${rawE(slot.id)}"${!file || otaState.legacySelectErrors[key] || busy ? " disabled" : ""}>${rawE(t(busy ? "legacyOtaReplacing" : "legacyOtaReplace"))}</button>
                ${otaState.legacyUploadResults[key] ? `<div class="app-feedback-ota-success"><strong>${rawE(t("legacyOtaReplaceSuccess"))}</strong></div>` : ""}
              </div>
            </article>`;
          })
          .join("")}</div>`
      : `<div class="app-feedback-device-empty">${rawE(t("legacyOtaNoPackages"))}</div>`;

  const legacyConfirmSlot = legacyPackages.find(
    (slot) => Number(slot.id) === Number(otaState.legacyConfirmSlot),
  );
  const legacyConfirmFile = legacyConfirmSlot
    ? otaState.legacySelectedFiles[String(legacyConfirmSlot.id)]
    : null;
  const legacyConfirm = legacyConfirmSlot && legacyConfirmFile
    ? `<div class="app-feedback-overlay app-feedback-device-confirm-overlay" data-legacy-ota-confirm-overlay>
        <section class="app-feedback-device-confirm" role="alertdialog" aria-modal="true" aria-labelledby="app-feedback-legacy-ota-confirm-title">
          <h2 id="app-feedback-legacy-ota-confirm-title">${rawE(t("legacyOtaConfirmTitle"))}</h2>
          <p>${rawE(t("legacyOtaConfirmText"))}</p>
          <dl class="app-feedback-device-confirm__details">
            ${detailRow("legacyOtaSlotLabel", legacyConfirmSlot.name || legacyConfirmSlot.id)}
            ${detailRow("otaFilename", legacyConfirmFile.name, { mono: true })}
            ${detailRow("otaFileSize", formatSize(legacyConfirmFile.size, t))}
          </dl>
          <div class="app-feedback-device-confirm__actions">
            <button type="button" class="app-feedback-button" data-legacy-ota-confirm-cancel>${rawE(t("cancel"))}</button>
            <button type="button" class="app-feedback-button app-feedback-button--danger" data-legacy-ota-confirm-submit>${rawE(t("legacyOtaConfirmReplace"))}</button>
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
      <h3>${rawE(t("otaFlashPackageSection"))}</h3>
      <p class="app-feedback-ota-muted">${rawE(t("otaPackageSubtitle"))}</p>
    </section>
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
      <label class="app-feedback-ota-version" for="app-feedback-ota-version">
        <span>${rawE(t("otaVersion"))}</span>
        <input id="app-feedback-ota-version" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]+[.][0-9]+" value="${rawE(otaState.versionInput)}" placeholder="${rawE(t("otaVersionPlaceholder"))}" data-ota-version${otaState.uploadLoading ? " disabled" : ""}>
      </label>
      ${otaState.selectError ? `<div class="app-feedback-alert">${rawE(errorCopy(otaState.selectError))}</div>` : ""}
      ${otaState.versionError ? `<div class="app-feedback-alert">${rawE(errorCopy(otaState.versionError))}</div>` : ""}
      ${otaState.uploadError ? `<div class="app-feedback-alert">${rawE(t("otaReplaceError", { message: errorCopy(otaState.uploadError) }))}</div>` : ""}
      <button type="button" class="app-feedback-button app-feedback-button--primary" data-ota-replace${!selected || otaState.selectError || otaState.uploadLoading ? " disabled" : ""}>${rawE(t(otaState.uploadLoading ? "otaReplacing" : "otaReplacePackage"))}</button>
      ${otaState.uploadResult ? `<div class="app-feedback-ota-success" aria-live="polite"><strong>${rawE(t("otaReplaceSuccess"))}</strong><span>${rawE(t("otaServerMd5"))}: <code>${e(otaState.uploadResult.md5)}</code></span><p>${rawE(t("otaMd5Hint"))}</p></div>` : ""}
    </section>
    <section class="app-feedback-ota-section">
      <h3>${rawE(t("legacyOtaPackages"))}</h3>
      <p class="app-feedback-ota-muted">${rawE(t("legacyOtaSubtitle"))}</p>
      ${otaState.legacyLoadError ? `<div class="app-feedback-alert">${rawE(t("legacyOtaLoadError", { message: errorCopy(otaState.legacyLoadError) }))}</div>` : ""}
      ${legacyCards}
    </section>
    ${confirm}
    ${legacyConfirm}
  </section>`;
}
