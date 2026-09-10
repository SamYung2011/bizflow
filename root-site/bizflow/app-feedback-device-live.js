import { wgs84ToGcj02 } from "./geo-coords.js";

const OTA_STATES = new Set(["none", "armed", "delivered", "downloading", "downloaded", "installed", "expired", "untasked"]);

export function renderAdapterLocation(location, { t, escapeHtml: e }) {
  const lat = location?.latitude;
  const lng = location?.longitude;
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!valid) return `<div class="app-feedback-device-detail app-feedback-location-detail"><dt>${e(t("location"))}</dt><dd>${e(t("noLocation"))}</dd></div>`;
  const [mapLat, mapLng] = wgs84ToGcj02(lat, lng);
  const url = `https://uri.amap.com/marker?position=${mapLng},${mapLat}`;
  return `<div class="app-feedback-device-detail app-feedback-location-detail"><dt>${e(t("location"))}</dt><dd>${e(location.address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`)}
    ${location.starnum === 0 ? `<small class="app-feedback-location-note">${e(t("notSatelliteFix"))}</small>` : ""}
    <a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(t("viewMap"))}</a></dd></div>`;
}

export function renderAdapterOta(device, details, { t, escapeHtml: e, formatTime, actionBusy = false, error = false }) {
  const stillPending = device?.ota?.pending === true || details?.stillPending === true;
  const canUntask = stillPending;
  const untaskButton = canUntask ? `<button type="button" class="app-feedback-button app-feedback-button--danger" data-adapter-action="untask" data-adapter-id="${e(device.certid)}"${actionBusy ? " disabled" : ""}>${e(t("otaUntask"))}</button>` : "";
  const summaryState = device?.ota?.state;
  if (summaryState === "none" || (summaryState === "armed" && device.ota.updatedAt > details?.task?.armedAt)) details = undefined;
  const state = OTA_STATES.has(details?.state) ? details.state : OTA_STATES.has(summaryState) ? summaryState : "none";
  if (state === "none") return `<section class="app-feedback-adapter-ota" data-ota-state="none"><strong>${e(t("ota"))}</strong> ${e(t("otaNoTask"))}${untaskButton}</section>`;
  const task = details?.task;
  const historical = ["installed", "expired", "untasked"].includes(state);
  const updatedAt = device?.ota?.updatedAt || details?.updatedAt || details?.versionChangedAt;
  const downloads = Array.isArray(details?.downloads) ? details.downloads : [];
  const bytes = downloads.reduce((total, row) => total + (Number(row.bytes) || 0), 0);
  const version = details?.versionNow?.software || device?.firmware?.software || "—";
  const target = task?.mainver != null && task?.subver != null ? `${task.mainver}.${task.subver}` : "—";
  const steps = [
    ["otaReceived", Boolean(details?.deliveredAt), details?.deliveredAt ? formatTime(details.deliveredAt) : "—"],
    ["otaDownload", downloads.length > 0, t("otaDownloads", { count: downloads.length, bytes })],
    ["otaInstalled", Boolean(details?.versionChangedAt), details?.versionChangedAt ? formatTime(details.versionChangedAt) : "—"],
    ["softwareVersion", Boolean(details?.versionChangedAt), version],
  ];
  return `<section class="app-feedback-adapter-ota" data-ota-state="${state}">
    <header><strong>${e(t("ota"))}</strong><span>${e(t(`otaState.${state}`))}${historical ? ` · ${e(formatTime(updatedAt))}` : ""}</span></header>
    ${task ? `<dl class="app-feedback-device-details">
      <div><dt>${e(t("otaPackage"))}</dt><dd>${e(task.package || "—")}</dd></div>
      <div><dt>${e(t("otaTargetVersion"))}</dt><dd>${e(target)} · ${e(t(task.force ? "otaForced" : "otaNormal"))}</dd></div>
      <div><dt>${e(t("otaArmedAt"))}</dt><dd>${e(formatTime(task.armedAt))}</dd></div>
      <div><dt>${e(t("otaExpiresAt"))}</dt><dd>${e(formatTime(task.expiresAt))}</dd></div>
    </dl>` : ""}
    ${error ? `<p>${e(t("otaDetailsUnavailable"))}</p>` : details === undefined ? `<p>${e(t("otaDetailsPending"))}</p>` : ""}
    <ol class="app-feedback-ota-timeline">${steps.map(([key, done, value]) => `<li class="${done ? "is-complete" : ""}"><strong>${e(t(key))}</strong><span>${e(value)}</span></li>`).join("")}</ol>
    ${stillPending && ["installed", "expired"].includes(state) ? `<p>${e(t(state === "installed" ? "otaStillPending" : "otaExpiredStillPending"))}</p>` : ""}
    ${untaskButton}
  </section>`;
}

// Serialize refresh rounds as well as bounding each round to three requests.
// A newer page/filter wins even if the old requests finish out of order.
export function createAdapterOtaLoader(request) {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    cancel() { generation++; },
    load(rows, { signal, isCurrent = () => true } = {}) {
      const round = ++generation;
      const valid = () => round === generation && !signal?.aborted && isCurrent();
      const devices = rows.filter((row) => row?.certid && row?.ota?.state && row.ota.state !== "none");
      const run = async () => {
        let cursor = 0;
        const items = {};
        const failed = [];
        await Promise.all(Array.from({ length: Math.min(3, devices.length) }, async () => {
          while (valid() && cursor < devices.length) {
            const id = devices[cursor++].certid;
            try {
              const payload = await request(`/devices/flash/${encodeURIComponent(id)}/ota`, { signal });
              if (valid()) items[id] = payload;
            } catch {
              if (valid()) failed.push(id);
            }
          }
        }));
        return valid() ? { items, failed } : null;
      };
      const result = tail.then(run);
      tail = result.catch(() => {});
      return result;
    },
  };
}
