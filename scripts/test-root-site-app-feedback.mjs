import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  HonnmonoAdminError,
  assertHonnmonoAdminRequest,
  formatFeedbackTime,
  normalizeFeedbackLogStatus,
  safeHttpUrl,
} from "../root-site/bizflow/app-feedback-api.js";
import {
  appFeedbackCopy,
  translateAppFeedback,
} from "../root-site/bizflow/app-feedback-i18n.js";
import {
  ADAPTER_SESSION_HISTORY_DAYS,
  adapterActionsForKind,
  adapterLiveMetrics,
  adapterOtaPackages,
  adapterSessionMinDate,
  adapterSessionSubPath,
  flashUnbindDisabled,
  flashUnbindRequest,
} from "../root-site/bizflow/app-feedback.js";
import {
  createDeviceUnbindController,
  createDeviceUnbindState,
  deviceExpectedUserId,
  isValidDeviceImei,
  renderDeviceUnbind,
} from "../root-site/bizflow/app-feedback-device.js";
import {
  OTA_MAX_FILE_BYTES,
  createOtaPackageController,
  createOtaPackageState,
  otaFileToBase64,
  parseOtaVersion,
  renderOtaPackage,
  validateLegacyOtaFile,
  validateOtaFile,
  validateOtaVersion,
} from "../root-site/bizflow/app-feedback-ota.js";
import {
  SIM_CARDS_PAGE_SIZE,
  SIM_IMPORT_MAX_LINES,
  createSimCardController,
  createSimCardState,
  detectSimQueryKind,
  formatSimData,
  normalizeSimQuery,
  renderSimCards,
  simCardsPageCount,
  simCardsSubPath,
  simDaysLeftLevel,
  simImportLineCount,
  simLookupSubPath,
  simManualRequestBody,
  simUsagePercent,
} from "../root-site/bizflow/app-feedback-sim.js";
import {
  MAX_REQUEST_JSON_BYTES,
  SIM_IMPORT_MAX_REQUEST_BYTES,
  SIM_LOOKUP_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
  isAllowedHonnmonoUpstream,
  mapHonnmonoAdminPath,
  maxRequestBytesFor,
  upstreamTimeoutFor,
} from "../supabase/functions/honnmono-admin/routing.mjs";
import {
  FEEDBACK_POLL_INTERVAL_MS,
  FEEDBACK_POLL_MAX_INTERVAL_MS,
  applyFeedbackListPayload,
  createFeedbackPoller,
  feedbackListSignature,
  feedbackPollDelay,
} from "../root-site/bizflow/app-feedback-poller.js";
import { SECTION_MENU_ITEMS } from "../root-site/components/navigation-registry.js";
import { dictionaries } from "../root-site/shell/shell-i18n.js";
import { createRouteFrame } from "../root-site/spa/route-menu.js";
import { routeManifest, spaRouteAllowlist } from "../root-site/spa/route-manifest.js";

const read = (relative) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

function createFakeDocument(initialVisibility = "visible") {
  const listeners = new Map();
  return {
    visibilityState: initialVisibility,
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    async setVisibility(nextVisibility) {
      this.visibilityState = nextVisibility;
      for (const handler of listeners.get("visibilitychange") ?? []) {
        await handler({ type: "visibilitychange" });
      }
    },
  };
}

function createFakeScope() {
  const cleanups = [];
  const timers = new Map();
  const abortController = new AbortController();
  let nextTimerId = 1;
  let current = true;
  return {
    timers,
    signal: abortController.signal,
    isCurrent: () => current,
    onCleanup(cleanup) {
      cleanups.push(cleanup);
      return cleanup;
    },
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      this.onCleanup(() => target.removeEventListener(type, handler));
    },
    timeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      this.onCleanup(() => timers.delete(id));
      return id;
    },
    nextDelay() {
      return timers.values().next().value?.delay ?? null;
    },
    async runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "a polling timer must be scheduled");
      const [id, timer] = entry;
      timers.delete(id);
      await timer.callback();
    },
    dispose() {
      current = false;
      abortController.abort();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

for (const subPath of [
  "/feedback",
  "/feedback?page=2&pageSize=20&clientModel=Android",
  "/feedback/1",
  "/feedback/999",
]) {
  assert.doesNotThrow(() => assertHonnmonoAdminRequest(subPath, "GET"));
}
assert.doesNotThrow(() =>
  assertHonnmonoAdminRequest("/feedback/9/log-link", "POST"),
);
assert.doesNotThrow(() =>
  assertHonnmonoAdminRequest(
    "/device/binding?imei=862635066123456",
    "GET",
  ),
);
assert.doesNotThrow(() =>
  assertHonnmonoAdminRequest("/device/unbind", "POST"),
);
assert.doesNotThrow(() =>
  assertHonnmonoAdminRequest("/ota/package", "GET"),
);
assert.doesNotThrow(() =>
  assertHonnmonoAdminRequest("/ota/package", "POST"),
);
for (const [method, subPath] of [
  ["GET", "/ota/legacy-packages"],
  ["POST", "/ota/legacy-packages/150001"],
  ["GET", "/devices/flash?page=1&pageSize=20&query=flash"],
  ["GET", "/devices/dc-pro?page=2&pageSize=20"],
  ["GET", "/devices/flash/CERT_1/sessions?date=2026-08-17&page=1&pageSize=20"],
  ["GET", "/devices/dc-pro/CERT_2/sessions?date=2026-08-17&page=1&pageSize=20"],
  ["GET", "/devices/flash/CERT_1/uploads/9"],
  ["POST", "/devices/flash/CERT_1/actions"],
  ["POST", "/devices/flash/CERT_1/unbind"],
]) {
  assert.doesNotThrow(() => assertHonnmonoAdminRequest(subPath, method));
}
for (const [method, subPath] of [
  ["GET", "/feedback/0"],
  ["GET", "/feedback/-1"],
  ["GET", "/feedback/1/log-link"],
  ["POST", "/feedback"],
  ["POST", "/feedback/1"],
  ["DELETE", "/feedback/1"],
  ["GET", "//evil.example/feedback"],
  ["GET", "/feedback#https://evil.example"],
  ["GET", "/device/binding"],
  ["GET", "/device/binding?imei=123"],
  ["GET", "/device/binding?imei=862635066123456&extra=1"],
  ["POST", "/device/binding?imei=862635066123456"],
  ["GET", "/device/unbind"],
  ["POST", "/device/unbind/extra"],
  ["DELETE", "/ota/package"],
  ["GET", "/ota/package?extra=1"],
  ["POST", "/ota/backups"],
  ["POST", "/ota/legacy-packages/150005"],
  ["GET", "/devices/flash/CERT_1/uploads/0"],
  ["POST", "/devices/dc-pro/CERT_2/actions"],
  ["POST", "/devices/dc-pro/CERT_2/unbind"],
]) {
  assert.throws(
    () => assertHonnmonoAdminRequest(subPath, method),
    (error) =>
      error instanceof HonnmonoAdminError && error.code === "requestError",
    `${method} ${subPath} must remain outside the browser allowlist`,
  );
}

assert.equal(safeHttpUrl("https://logs.example/x.zip"), "https://logs.example/x.zip");
assert.equal(safeHttpUrl("http://logs.example/x.zip"), "http://logs.example/x.zip");
assert.equal(safeHttpUrl("https://user:pass@logs.example/x.zip"), "");
assert.equal(safeHttpUrl("javascript:alert(1)"), "");
assert.equal(safeHttpUrl("//logs.example/x.zip"), "");
assert.equal(normalizeFeedbackLogStatus({ logStatus: "available" }), "available");
assert.equal(
  normalizeFeedbackLogStatus({
    logStatus: "external",
    logExternalUrl: "https://logs.example/x.zip",
  }),
  "external",
);
assert.equal(
  normalizeFeedbackLogStatus({
    logStatus: "external",
    logExternalUrl: "https://user:pass@logs.example/x.zip",
  }),
  "expired",
);
assert.equal(normalizeFeedbackLogStatus({ logStatus: "expired" }), "expired");
assert.equal(normalizeFeedbackLogStatus({ logStatus: "mystery" }), "expired");
assert.match(formatFeedbackTime(1_700_000_000, "zh"), /\d/);
assert.equal(formatFeedbackTime("not-a-timestamp", "en"), "not-a-timestamp");

assert.deepEqual(adapterActionsForKind("flash"), [
  "unbind",
  "force_ota",
  "lock",
  "unlock",
]);
assert.deepEqual(adapterActionsForKind("dc-pro"), ["unbind"]);
assert.deepEqual(adapterActionsForKind("unknown"), []);
const boundIdleFlash = {
  certid: "0D99170909940000102020D3",
  charging: false,
  binding: { userId: "owner-42" },
};
assert.equal(flashUnbindDisabled(boundIdleFlash), false);
assert.deepEqual(flashUnbindRequest(boundIdleFlash), {
  path: "/devices/flash/0D99170909940000102020D3/unbind",
  body: { expectedUserId: "owner-42" },
});
assert.equal(
  flashUnbindDisabled({ ...boundIdleFlash, charging: true }),
  true,
);
assert.throws(
  () => flashUnbindRequest({ ...boundIdleFlash, charging: true }),
  (error) =>
    error instanceof HonnmonoAdminError &&
    error.code === "device_charging" &&
    error.status === 409,
);
assert.equal(
  flashUnbindDisabled({ ...boundIdleFlash, binding: { userId: "" } }),
  true,
);
assert.equal(
  adapterSessionSubPath({
    kind: "dc-pro",
    certid: "CERT_2",
    date: "2026-08-17",
    page: 3,
  }),
  "/devices/dc-pro/CERT_2/sessions?page=3&pageSize=20&date=2026-08-17",
);
assert.equal(
  adapterSessionSubPath({
    kind: "dc-pro",
    certid: "CERT_2",
    date: "",
    page: 1,
  }),
  "/devices/dc-pro/CERT_2/sessions?page=1&pageSize=20",
);
const otaPackageSource = {
  current: { filename: "current.bin" },
  backups: [{ filename: "backup.bin" }],
};
const otaPackageSnapshot = adapterOtaPackages(otaPackageSource);
otaPackageSource.current.filename = "changed-after-dialog-open.bin";
assert.deepEqual(
  otaPackageSnapshot.map((item) => item.filename),
  ["current.bin", "backup.bin"],
);

const feedbackLanguages = Object.keys(appFeedbackCopy);
assert.deepEqual(feedbackLanguages, ["zh", "en", "fr"]);
const feedbackKeys = Object.keys(appFeedbackCopy.zh).sort();
for (const language of feedbackLanguages) {
  assert.deepEqual(
    Object.keys(appFeedbackCopy[language]).sort(),
    feedbackKeys,
    `${language} feedback copy must match the Traditional Chinese key set`,
  );
  assert.equal(typeof appFeedbackCopy[language].external, "string");
  assert.equal(typeof appFeedbackCopy[language].expired, "string");
  assert.equal(typeof appFeedbackCopy[language].available, "string");
  assert.equal(typeof appFeedbackCopy[language].stepUnverified, "string");
  assert.equal(
    typeof appFeedbackCopy[language].providerUnverifiedWarning,
    "string",
  );
  assert.equal(typeof appFeedbackCopy[language].imeiAmbiguousError, "string");
  assert.equal(typeof appFeedbackCopy[language].otaPackageTitle, "string");
  assert.equal(typeof appFeedbackCopy[language].otaVersionPlaceholder, "string");
  assert.equal(typeof appFeedbackCopy[language].otaVersionNotRecorded, "string");
  assert.equal(typeof appFeedbackCopy[language].otaVersionFormat, "string");
  assert.equal(typeof appFeedbackCopy[language].otaMd5Hint, "string");
  assert.equal(typeof appFeedbackCopy[language].otaPermissionError, "string");
  assert.equal(typeof appFeedbackCopy[language].flashUnbindDevice, "string");
  assert.equal(typeof appFeedbackCopy[language].flashUnbindConfirmText, "string");
  assert.equal(typeof appFeedbackCopy[language].flashUnbindSuccess, "string");
  assert.equal(typeof appFeedbackCopy[language].flashUnbindChargingBlocked, "string");
  assert.match(appFeedbackCopy[language].chargeCount, /90/);
}

for (const language of ["zh", "en", "fr"]) {
  assert.equal(
    dictionaries[language]["nav.honnmonoApp"],
    "Honnmono APP",
    `${language} shell navigation must use the approved brand label`,
  );
  assert.equal(
    typeof dictionaries[language]["nav.appFeedback"],
    "string",
    `${language} feedback title copy must remain available`,
  );
  for (const key of [
    "quickCreate.title",
    "quickCreate.task",
    "quickCreate.order",
    "quickCreate.customer",
    "quickCreate.close",
    "nav.updates",
  ]) {
    assert.equal(
      typeof dictionaries[language][key],
      "string",
      `${language} shell additions must survive the incremental dictionary edit: ${key}`,
    );
  }
}

const registryItems = SECTION_MENU_ITEMS.bizflow;
const financeIndex = registryItems.findIndex((item) => item.id === "ocpp-finance");
assert.deepEqual(registryItems[financeIndex + 1], {
  id: "app-feedback",
  labelKey: "nav.honnmonoApp",
  icon: "icon-nav-messenger",
  canonicalHref: "/bizflow/app-feedback.html",
  adminOnly: true,
});

const feedbackRoute = routeManifest["/bizflow/app-feedback.html"];
assert.ok(feedbackRoute, "the live SPA manifest must include app feedback");
assert.equal(spaRouteAllowlist.includes(feedbackRoute.path), true);
assert.equal(feedbackRoute.menuKey, "app-feedback");
assert.equal(feedbackRoute.section, "bizflow");
assert.equal(feedbackRoute.frame.access, "bf-admin");
assert.deepEqual(feedbackRoute.frame, createRouteFrame(feedbackRoute.path));
assert.equal(feedbackRoute.frame.title, "Honnmono APP · 用戶反饋");
assert.equal(feedbackRoute.entry.endsWith("/bizflow/app-feedback.js"), true);
assert.deepEqual(
  feedbackRoute.styles.map((url) => new URL(url).pathname.split("/root-site/").at(-1)),
  ["components/date-range-panel.css", "bizflow/app-feedback.css"],
  "the session date picker reuses the live date panel stylesheet",
);
const loadedPage = await feedbackRoute.load();
assert.equal(typeof loadedPage.mountPage, "function");

const [pageSource, apiSource, deviceSource, otaSource, pollerSource, htmlSource, cssSource] =
  await Promise.all([
    read("root-site/bizflow/app-feedback.js"),
    read("root-site/bizflow/app-feedback-api.js"),
    read("root-site/bizflow/app-feedback-device.js"),
    read("root-site/bizflow/app-feedback-ota.js"),
    read("root-site/bizflow/app-feedback-poller.js"),
    read("root-site/bizflow/app-feedback.html"),
    read("root-site/bizflow/app-feedback.css"),
  ]);

assert.match(pageSource, /export\s+async\s+function\s+mountPage\s*\(/);
assert.match(pageSource, /throwIfPageAborted\(signal,\s*scope\)/);
assert.match(pageSource, /createBizflowMenu\("app-feedback"\)/);
for (const eventName of ["click", "input", "change", "submit", "keydown"]) {
  assert.match(
    pageSource,
    new RegExp(`scope\\.listen\\(document,\\s*"${eventName}"`),
    `${eventName} listener must be owned by the page lifecycle scope`,
  );
}
assert.doesNotMatch(
  pageSource,
  /document\.addEventListener\(/,
  "the SPA page must not leak document listeners across navigation",
);
assert.match(pageSource, /target="_blank"\s+rel="noopener noreferrer"/);
assert.match(pageSource, /data-feedback-download=/);
assert.match(pageSource, /busy\s*=\s*state\.downloadingId\s*===\s*detail\.id/);
assert.match(pageSource, /\$\{busy\s*\?\s*" disabled"\s*:\s*""\}/);
assert.match(pageSource, /class="app-feedback-button" disabled/);
assert.match(pageSource, /normalizeFeedbackLogStatus\(state\.detail\)\s*!==\s*"available"/);
assert.match(pageSource, /helpers\.escapeHtml/);
assert.doesNotMatch(pageSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(pageSource, /app-api/i);
assert.doesNotMatch(apiSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(apiSource, /app-api/i);
assert.doesNotMatch(`${pageSource}\n${apiSource}`, /FLASH_ADMIN_(?:URL|TOKEN)/);
assert.doesNotMatch(deviceSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(deviceSource, /app-api/i);
assert.doesNotMatch(otaSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(otaSource, /app-api/i);
assert.match(apiSource, /functions\/v1\/\$\{EDGE_FUNCTION\}/);
assert.match(apiSource, /Authorization:\s*`Bearer \$\{context\.accessToken\}`/);
assert.match(apiSource, /apikey:\s*context\.anonKey/);
assert.match(apiSource, /signal,/);
assert.match(apiSource, /"Content-Type":\s*"application\/json"/);
assert.match(apiSource, /body:\s*serializedBody/);
assert.match(apiSource, /allowedBackendCodes\.has\(backendCode\)/);
assert.match(pageSource, /error\.code === "imei_ambiguous"/);
assert.match(pageSource, /error\.code === "device_charging"/);
assert.match(pageSource, /data-app-feedback-tab="feedback"/);
assert.match(pageSource, /data-app-feedback-tab="device"/);
assert.match(pageSource, /data-app-feedback-tab="devices"/);
assert.match(pageSource, /data-adapter-kind="flash"/);
assert.match(pageSource, /data-adapter-kind="dc-pro"/);
assert.match(pageSource, /data-adapter-action="force_ota"/);
assert.match(pageSource, /data-adapter-action="lock"/);
assert.match(pageSource, /data-adapter-action="unlock"/);
assert.match(pageSource, /data-adapter-action="unbind"/);
assert.match(pageSource, /flashUnbindConfirmText/);
assert.match(pageSource, /data-adapter-report=/);
assert.match(pageSource, /pageSize:\s*String\(PAGE_SIZE\)/);
assert.match(pageSource, /activeOtaController\?\.load\(\)/);
assert.match(pageSource, /data-ota-file/);
assert.match(pageSource, /data-ota-version/);
assert.match(pageSource, /activePoller\?\.pause\(\)/);
assert.match(pageSource, /state\.activeTab\s*!==\s*"feedback"/);
assert.match(deviceSource, /expected_userid:\s*expectedUserid/);
assert.match(deviceSource, /pattern="\[0-9\]\{15\}"/);
assert.match(deviceSource, /escapeHtml/);
assert.match(deviceSource, /data-device-confirm-submit/);
assert.match(deviceSource, /noAccountWarning/);
assert.match(deviceSource, /providerUnverifiedWarning/);
assert.match(otaSource, /accept="\.bin"/);
assert.match(otaSource, /pattern="\[0-9\]\+\[\.\]\[0-9\]\+"/);
assert.match(otaSource, /data-ota-confirm-submit/);
assert.match(otaSource, /content_base64:/);
assert.match(otaSource, /OTA_MAX_FILE_BYTES = 2 \* 1024 \* 1024/);
assert.match(otaSource, /accept="\.UPG,\.upg"/);
assert.match(otaSource, /data-legacy-ota-confirm-submit/);
assert.doesNotMatch(otaSource, /window\.confirm/);
assert.match(pageSource, /document\.visibilityState\s*!==\s*"visible"/);
assert.match(pageSource, /pendingListPayload/);
assert.match(pageSource, /data-feedback-new/);
assert.match(pageSource, /rerender\(\{\s*preserveScroll:\s*true\s*\}\)/);
assert.doesNotMatch(pageSource, /\bsetInterval\s*\(/);
assert.doesNotMatch(pageSource, /\bsetTimeout\s*\(/);
assert.match(pollerSource, /scope\.timeout\(/);
assert.match(
  pollerSource,
  /scope\.listen\(documentRef,\s*"visibilitychange"/,
);
assert.match(pollerSource, /scope\.onCleanup\(/);
assert.doesNotMatch(pollerSource, /\bsetInterval\s*\(/);

assert.equal(isValidDeviceImei("862635066123456"), true);
assert.equal(isValidDeviceImei("86263506612345"), false);
assert.equal(isValidDeviceImei("86263506612345x"), false);
assert.equal(deviceExpectedUserId({ dev_cloud: { userid: 0 } }), 0);
assert.equal(deviceExpectedUserId({ dev_cloud: { userid: 101 } }), 101);
assert.equal(deviceExpectedUserId({ dev_cloud: { userid: "bad" } }), null);
assert.equal(ADAPTER_SESSION_HISTORY_DAYS, 90);
assert.equal(adapterSessionMinDate("2026-08-17"), "2026-05-19");

const [expenseSource, taskSubmitSource, datePanelSource] = await Promise.all([
  read("root-site/bizflow/expense.js"),
  read("root-site/team/tasks-submit.js"),
  read("root-site/components/date-range-panel.js"),
]);
const sharedDateTrigger =
  /class="date-panel-trigger"[^>]*aria-haspopup="dialog"[^>]*>\$\{(?:helpers\.)?icon\("icon-task-calendar", "icon"\)\}<span class="date-panel-trigger__value">/;
for (const [page, source] of [
  ["expense", expenseSource],
  ["team tasks-submit", taskSubmitSource],
  ["app feedback sessions", pageSource],
]) {
  assert.match(
    source,
    sharedDateTrigger,
    `${page} must render the shared .date-panel-trigger markup`,
  );
}
assert.doesNotMatch(
  pageSource,
  /type="date"/,
  "the session filter must reuse the live date panel instead of a hand-rolled native date input",
);
assert.match(pageSource, /createDateRangePanel\(\)/);
assert.match(
  pageSource,
  /adapterSessionDatePanel\.open\(\{[\s\S]*?mode: "single",[\s\S]*?minDate: adapterSessionMinDate\(\),/,
  "the drawer must open the shared panel in single-date mode with the 90 day floor",
);
for (const hook of [
  /function closeAdapterSessions\(\) \{\n  adapterSessionDatePanel\.close\(\);/,
  /function rerender\(\{[^}]*\} = \{\}\) \{[\s\S]*?adapterSessionDatePanel\.close\(\);/,
  /dispose\(\) \{\n      adapterSessionDatePanel\.close\(\);/,
]) {
  assert.match(pageSource, hook, "the shared panel must be torn down with the page");
}
assert.match(datePanelSource, /function blockedDay\(value\) \{\n    return Boolean\(minDate\)/);
assert.match(
  datePanelSource,
  /if \(!normalized \|\| blockedDay\(normalized\)\) return;/,
  "the shared panel must refuse days before minDate rather than let each page re-implement it",
);
assert.match(datePanelSource, /blocked \? " disabled" : ""/);
for (const key of ["today", "previousMonth", "nextMonth", "year", "chooseMonth", "clear"]) {
  for (const language of feedbackLanguages) {
    assert.equal(
      typeof appFeedbackCopy[language][key],
      "string",
      `${language}.${key} must exist so the shared date panel reads in all three languages`,
    );
  }
}

assert.deepEqual(
  adapterLiveMetrics({
    charging: true,
    charger: { watts: 2880, volts: 360, amps: 8, kwh: 12.5 },
  }),
  { watts: 2880, volts: 360, amps: 8, kwh: 12.5 },
  "a charging adapter shows its live heartbeat values",
);
assert.deepEqual(
  adapterLiveMetrics({
    charging: false,
    charger: { watts: 2880, volts: 360, amps: 8, kwh: 12.5 },
  }),
  { watts: 0, volts: 0, amps: 0, kwh: 0 },
  "an idle adapter must read 0 instead of the previous session's leftover heartbeat",
);
assert.deepEqual(adapterLiveMetrics({ charger: { watts: 2880 } }), {
  watts: 0,
  volts: 0,
  amps: 0,
  kwh: 0,
});
assert.deepEqual(adapterLiveMetrics(undefined), {
  watts: 0,
  volts: 0,
  amps: 0,
  kwh: 0,
});
assert.match(pageSource, /const live = adapterLiveMetrics\(device\);/);
for (const [field, unit] of [
  ["watts", " W"],
  ["volts", " V"],
  ["amps", " A"],
  ["kwh", " kWh"],
]) {
  assert.match(
    pageSource,
    new RegExp(`metric\\(live\\.${field}, "${unit}"\\)`),
    `card ${field} must render through the charging gate on both adapter tabs`,
  );
}
assert.doesNotMatch(
  pageSource,
  /metric\(charger\./,
  "no card metric may read the raw heartbeat directly",
);
assert.match(
  pageSource,
  /detailRow\("chargedKwh", metric\(session\.kwh, " kWh"\)\)/,
  "historical session energy in the drawer stays untouched by the live zeroing rule",
);
const deviceState = createDeviceUnbindState({
  deviceImeiInput: "86x2635066123456overflow",
});
assert.equal(deviceState.imeiInput, "862635066123456");
deviceState.queriedImei = "862635066123456";
deviceState.binding = {
  imei: "862635066123456",
  unbound: false,
  dev_cloud: {
    uuid: "<img src=x onerror=alert(1)>",
    userid: 101,
    bindtime: 1_700_000_000_000,
  },
  binding_user: {
    username: "<script>alert(1)</script>",
    contact: "+852<unsafe>",
  },
  sr_iot_device: { binder: "owner@example.com" },
  sr_iot_config_value: { mapping: { vin: "VIN<unsafe>" } },
  lufengzhe_account: { exists: false, id: null },
};
deviceState.confirmOpen = true;
deviceState.result = {
  status: "unbound",
  lufengzhe: "no_account",
  steps: [
    { key: "dev_cloud", status: "ok" },
    { key: "lufengzhe", status: "skip" },
  ],
};
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const deviceHtml = renderDeviceUnbind({
  deviceState,
  t: (key) => key,
  escapeHtml,
  formatTime: () => "2026-08-12 12:00:00",
  errorCopy: () => "error",
});
assert.doesNotMatch(deviceHtml, /<script>alert\(1\)<\/script>/);
assert.doesNotMatch(deviceHtml, /<img src=x/);
assert.match(deviceHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(deviceHtml, /VIN&lt;unsafe&gt;/);
assert.match(deviceHtml, /noAccountWarning/);
assert.match(deviceHtml, /2026-08-12 12:00:00/);

deviceState.result = {
  status: "unbound",
  lufengzhe: { status: "unverified" },
  steps: [{ key: "lufengzhe", status: "unverified" }],
};
const unverifiedHtml = renderDeviceUnbind({
  deviceState,
  t: (key) => key,
  escapeHtml,
  formatTime: () => "2026-08-12 12:00:00",
  errorCopy: () => "error",
});
assert.match(unverifiedHtml, /app-feedback-device-check--unverified/);
assert.match(unverifiedHtml, />stepUnverified</);
assert.match(unverifiedHtml, /providerUnverifiedWarning/);

deviceState.result = {
  status: "unbound",
  lufengzhe: { status: "already_unbound" },
  steps: [{ key: "lufengzhe_inner", status: "already_unbound" }],
};
const alreadyUnboundHtml = renderDeviceUnbind({
  deviceState,
  t: (key) => key,
  escapeHtml,
  formatTime: () => "2026-08-12 12:00:00",
  errorCopy: () => "error",
});
assert.match(alreadyUnboundHtml, /app-feedback-device-check--ok/);
assert.match(alreadyUnboundHtml, />stepOk</);
assert.doesNotMatch(alreadyUnboundHtml, /app-feedback-device-check--fail/);

const controllerState = createDeviceUnbindState();
const controllerCalls = [];
let controllerRenders = 0;
const controller = createDeviceUnbindController({
  deviceState: controllerState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender: () => {
    controllerRenders += 1;
  },
  focus: () => {},
  request: async (path, options = {}) => {
    controllerCalls.push([path, options]);
    if (path.startsWith("/device/binding")) {
      return {
        imei: "862635066123456",
        unbound: false,
        dev_cloud: { userid: 101 },
      };
    }
    return {
      status: "unbound",
      lufengzhe: "no_account",
      binding: {
        imei: "862635066123456",
        unbound: true,
        dev_cloud: { userid: 0 },
      },
      steps: [],
    };
  },
});
assert.equal(
  controller.setImeiInput("862-635-066-123-456"),
  "862635066123456",
);
await controller.lookup();
assert.equal(
  controllerCalls[0][0],
  "/device/binding?imei=862635066123456",
);
assert.equal(controllerState.binding.dev_cloud.userid, 101);
controller.openConfirm();
assert.equal(controllerState.confirmOpen, true);
await controller.submitUnbind();
assert.deepEqual(controllerCalls[1][1].body, {
  imei: "862635066123456",
  expected_userid: 101,
});
assert.equal(controllerState.binding.unbound, true);
assert.equal(controllerState.confirmOpen, false);
assert.equal(controllerState.result.lufengzhe, "no_account");
assert.ok(controllerRenders >= 5);

const conflictState = createDeviceUnbindState({
  deviceImeiInput: "862635066123456",
});
conflictState.queriedImei = "862635066123456";
conflictState.binding = {
  imei: "862635066123456",
  unbound: false,
  dev_cloud: { userid: 101 },
};
const conflictController = createDeviceUnbindController({
  deviceState: conflictState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender: () => {},
  focus: () => {},
  request: async () => {
    throw new HonnmonoAdminError("upstreamError", 409);
  },
});
await conflictController.submitUnbind();
assert.equal(conflictState.binding, null);
assert.equal(conflictState.unbindError.status, 409);

assert.equal(validateOtaFile({ name: "gbccs25.bin", size: 1024 }), null);
assert.equal(parseOtaVersion(""), null);
assert.deepEqual(parseOtaVersion("1.20"), { mainver: 1, subver: 20 });
assert.deepEqual(parseOtaVersion(" 0.0 "), { mainver: 0, subver: 0 });
assert.equal(validateOtaVersion("1").code, "otaVersionFormat");
assert.equal(validateOtaVersion("-1.20").code, "otaVersionFormat");
assert.equal(validateOtaFile({ name: `${"a".repeat(60)}.bin`, size: 1 }), null);
assert.equal(
  validateOtaFile({ name: `${"a".repeat(61)}.bin`, size: 1 }).code,
  "otaFileType",
);
assert.equal(
  validateOtaFile({ name: "../gbccs25.bin", size: 1024 }).code,
  "otaFileType",
);
assert.equal(
  validateOtaFile({ name: "gbccs25.bin", size: OTA_MAX_FILE_BYTES + 1 }).code,
  "otaFileTooLarge",
);
assert.equal(
  await otaFileToBase64({
    arrayBuffer: async () => Uint8Array.from([0, 1, 2, 255]).buffer,
  }),
  "AAEC/w==",
);

const otaState = createOtaPackageState();
const otaCalls = [];
let otaRenders = 0;
const otaFile = {
  name: "gbccs25.bin",
  size: 4,
  arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
};
const legacyOtaFile = {
  name: "general.UPG",
  size: 3,
  arrayBuffer: async () => Uint8Array.from([5, 6, 7]).buffer,
};
assert.equal(validateLegacyOtaFile(legacyOtaFile), null);
assert.equal(validateLegacyOtaFile({ ...legacyOtaFile, name: "bad.bin" }).code, "legacyOtaFileType");
let otaGetCount = 0;
const otaController = createOtaPackageController({
  otaState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender: () => {
    otaRenders += 1;
  },
  focus: () => {},
  encodeFile: async () => "AQIDBA==",
  request: async (path, options = {}) => {
    otaCalls.push([path, options]);
    if (path === "/ota/legacy-packages") {
      return {
        items: [
          {
            id: 150001,
            name: "General",
            carModel: "general",
            filename: "general.UPG",
            url: "http://ota.example/legacy/general.UPG",
            md5: "legacy-md5",
            updatedAt: 1_700_000_000,
          },
        ],
      };
    }
    if (path === "/ota/legacy-packages/150001") {
      return {
        storage: { filename: "general.UPG", md5: "new-legacy-md5" },
        metadata: { id: 150001 },
      };
    }
    if (options.method === "POST" && path === "/ota/package") {
      return { filename: "gbccs25.bin", size: 4, md5: "server-md5" };
    }
    otaGetCount += 1;
    return otaGetCount === 1
      ? {
          current: {
            filename: "gbccs24.bin",
            size: 3,
            md5: "old-md5",
            mtime: 1_700_000_000,
            version: null,
          },
          backups: [],
        }
      : {
          current: {
            filename: "gbccs25.bin",
            size: 4,
            md5: "server-md5",
            mtime: 1_700_000_100,
            version: { mainver: 1, subver: 20 },
          },
          backups: [
            {
              filename: "gbccs24.bin.bak-20260813-120000",
              size: 3,
              mtime: 1_700_000_000,
            },
          ],
        };
  },
});
await otaController.load();
assert.equal(otaState.packageInfo.current.filename, "gbccs24.bin");
otaController.selectFile(otaFile);
otaController.setVersionInput("1");
otaController.openConfirm();
assert.equal(otaState.confirmOpen, false);
assert.equal(otaState.versionError.code, "otaVersionFormat");
assert.equal(otaCalls.length, 2);
otaController.setVersionInput("1.20");
otaController.openConfirm();
assert.equal(otaState.confirmOpen, true);
await otaController.submit();
assert.deepEqual(otaCalls.map(([path, options]) => [path, options.method || "GET"]), [
  ["/ota/package", "GET"],
  ["/ota/legacy-packages", "GET"],
  ["/ota/package", "POST"],
  ["/ota/package", "GET"],
]);
assert.deepEqual(otaCalls[2][1].body, {
  filename: "gbccs25.bin",
  content_base64: "AQIDBA==",
  mainver: 1,
  subver: 20,
});
assert.equal(otaState.packageInfo.current.filename, "gbccs25.bin");
assert.equal(otaState.uploadResult.md5, "server-md5");
assert.equal(otaState.selectedFile, null);
assert.equal(otaState.versionInput, "");
otaController.selectLegacyFile(150001, legacyOtaFile);
otaController.openLegacyConfirm(150001);
assert.equal(otaState.legacyConfirmSlot, 150001);
await otaController.submitLegacy();
assert.deepEqual(otaCalls.at(-2).slice(0, 1), ["/ota/legacy-packages/150001"]);
assert.equal(otaCalls.at(-2)[1].method, "POST");
assert.equal(otaCalls.at(-2)[1].body.previousFilename, "general.UPG");
assert.equal(otaCalls.at(-1)[0], "/ota/legacy-packages");
assert.equal(otaState.legacyUploadResults["150001"].metadata.id, 150001);
assert.ok(otaRenders >= 6);

const legacyRetryState = createOtaPackageState();
legacyRetryState.legacyPackages = [
  { id: 150001, filename: "old-general.UPG" },
];
let legacyRetryAttempts = 0;
const legacyRetryBodies = [];
const legacyRetryController = createOtaPackageController({
  otaState: legacyRetryState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender: () => {},
  focus: () => {},
  encodeFile: async () => "BQYH",
  request: async (path, options = {}) => {
    if (path === "/ota/legacy-packages/150001") {
      legacyRetryAttempts += 1;
      legacyRetryBodies.push(options.body);
      if (legacyRetryAttempts === 1) {
        throw new HonnmonoAdminError("upstreamError", 504);
      }
      return {
        storage: {
          filename: "new-general.UPG",
          md5: "retry-md5",
          idempotent: true,
        },
        metadata: { id: 150001 },
      };
    }
    if (path === "/ota/legacy-packages") {
      return { items: [{ id: 150001, filename: "new-general.UPG" }] };
    }
    throw new Error(`unexpected retry path: ${path}`);
  },
});
const retriedLegacyFile = { ...legacyOtaFile, name: "new-general.UPG" };
legacyRetryController.selectLegacyFile(150001, retriedLegacyFile);
legacyRetryController.openLegacyConfirm(150001);
await legacyRetryController.submitLegacy();
assert.equal(legacyRetryState.legacyUploadErrors["150001"].status, 504);
assert.equal(legacyRetryState.legacySelectedFiles["150001"], retriedLegacyFile);
legacyRetryController.openLegacyConfirm(150001);
await legacyRetryController.submitLegacy();
assert.equal(legacyRetryAttempts, 2);
assert.deepEqual(legacyRetryBodies[0], legacyRetryBodies[1]);
assert.equal(
  legacyRetryState.legacyUploadResults["150001"].storage.idempotent,
  true,
);
assert.equal(legacyRetryState.legacySelectedFiles["150001"], null);

let resolveRacingLoad;
let resolveRacingPost;
let racingGetCount = 0;
const racingState = createOtaPackageState();
const racingController = createOtaPackageController({
  otaState: racingState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isDeviceTab: () => true,
  rerender: () => {},
  focus: () => {},
  encodeFile: async () => "AQIDBA==",
  request: async (path, options = {}) => {
    if (path === "/ota/legacy-packages") return { items: [] };
    if (options.method === "POST") {
      assert.equal("mainver" in options.body, false);
      assert.equal("subver" in options.body, false);
      return new Promise((resolve) => {
        resolveRacingPost = resolve;
      });
    }
    racingGetCount += 1;
    if (racingGetCount === 1) {
      return new Promise((resolve) => {
        resolveRacingLoad = resolve;
      });
    }
    return { current: null, backups: [] };
  },
});
const racingLoad = racingController.load();
racingController.selectFile(otaFile);
racingController.openConfirm();
const racingSubmit = racingController.submit();
await Promise.resolve();
resolveRacingLoad({ current: null, backups: [] });
await racingLoad;
assert.equal(racingState.loading, false);
assert.equal(racingState.uploadLoading, true);
resolveRacingPost({ filename: "gbccs25.bin", size: 4, md5: "server-md5" });
await racingSubmit;
assert.equal(racingState.uploadLoading, false);

otaState.packageInfo.backups.push({
  filename: '<img src=x onerror="alert(1)">.bak-unsafe',
  size: 1,
  mtime: 1_700_000_000,
});
const otaHtml = renderOtaPackage({
  otaState,
  t: (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      key,
    ),
  escapeHtml,
  formatTime: () => "2026-08-13 12:00:00",
  errorCopy: (error) => error?.code || "error",
});
assert.doesNotMatch(otaHtml, /<img src=x/);
assert.match(otaHtml, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
assert.match(otaHtml, /server-md5/);
assert.match(otaHtml, /1\.20/);
assert.match(otaHtml, /otaMd5Hint/);

const unversionedOtaHtml = renderOtaPackage({
  otaState: {
    ...createOtaPackageState(),
    loaded: true,
    packageInfo: {
      current: {
        filename: "legacy.bin",
        size: 1,
        md5: "legacy-md5",
        mtime: 1_700_000_000,
        version: null,
      },
      backups: [],
    },
  },
  t: (key) => key,
  escapeHtml,
  formatTime: () => "2026-08-14 12:00:00",
  errorCopy: (error) => error?.code || "error",
});
assert.match(unversionedOtaHtml, /otaVersionNotRecorded/);

assert.match(htmlSource, /<script src="\.\.\/shell\/shell-skeleton\.js"><\/script>/);
assert.match(htmlSource, /<script type="module" src="\.\.\/spa\/entry\.js"><\/script>/);
assert.match(htmlSource, /<title>Honnmono APP · 用戶反饋<\/title>/);
assert.doesNotMatch(htmlSource, /app-feedback\.js"><\/script>/);
assert.deepEqual(
  [...htmlSource.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(
    (match) => match[1],
  ),
  [
    "../spa/entry.js",
    "./app-feedback.js",
    "../vendor/supabase-js.esm.js",
  ],
);
assert.match(cssSource, /@media\s+\(max-width:/);
assert.match(cssSource, /\.app-feedback-device-check--unverified/);
assert.match(cssSource, /\.app-feedback-ota-card/);
assert.match(cssSource, /\.app-feedback-adapter-grid/);
assert.match(cssSource, /\.app-feedback-legacy-ota-grid/);
assert.doesNotMatch(cssSource, /(?:^|[;:{\s])#[0-9a-f]{3,8}\b/i);

assert.equal(feedbackPollDelay(0), FEEDBACK_POLL_INTERVAL_MS);
assert.equal(feedbackPollDelay(1), 60_000);
assert.equal(feedbackPollDelay(2), FEEDBACK_POLL_MAX_INTERVAL_MS);
assert.equal(feedbackPollDelay(99), FEEDBACK_POLL_MAX_INTERVAL_MS);

const preservedState = {
  rows: [{ id: 1 }],
  total: 1,
  facets: {},
  page: 3,
  clientModel: "Android",
  appVersion: "1.0.31",
  status: "0",
  searchInput: "contact@example.com",
  keyword: "contact@example.com",
  selectedId: 7,
  detail: { id: 7 },
};
applyFeedbackListPayload(preservedState, {
  items: [{ id: 2, createTime: 200 }],
  total: 22,
  facets: {
    clientModels: ["Android"],
    appVersions: ["1.0.31"],
    statuses: [0],
  },
});
assert.deepEqual(
  {
    page: preservedState.page,
    clientModel: preservedState.clientModel,
    appVersion: preservedState.appVersion,
    status: preservedState.status,
    searchInput: preservedState.searchInput,
    keyword: preservedState.keyword,
    selectedId: preservedState.selectedId,
    detail: preservedState.detail,
  },
  {
    page: 3,
    clientModel: "Android",
    appVersion: "1.0.31",
    status: "0",
    searchInput: "contact@example.com",
    keyword: "contact@example.com",
    selectedId: 7,
    detail: { id: 7 },
  },
  "poll payload application must not reset filters, pagination or the open drawer",
);
assert.equal(
  feedbackListSignature({
    items: [{ id: 2, createTime: 200 }],
    total: 22,
    facets: preservedState.facets,
  }),
  feedbackListSignature({
    items: [{ id: 2, createTime: 200 }],
    total: 22,
    facets: preservedState.facets,
  }),
);
assert.notEqual(
  feedbackListSignature({
    items: [{ id: 2, createTime: 200 }],
    total: 22,
    facets: preservedState.facets,
  }),
  feedbackListSignature({
    items: [{ id: 3, createTime: 300 }],
    total: 23,
    facets: preservedState.facets,
  }),
);

const fakeDocument = createFakeDocument();
const fakeScope = createFakeScope();
const pollOutcomes = [true, false, false, true, true];
let pollCalls = 0;
const poller = createFeedbackPoller({
  scope: fakeScope,
  documentRef: fakeDocument,
  poll: async () => {
    const outcome = pollOutcomes[pollCalls] ?? true;
    pollCalls += 1;
    return outcome;
  },
  clearTimeoutFn: (id) => fakeScope.timers.delete(id),
});
poller.start();
assert.equal(fakeScope.nextDelay(), 30_000);
await fakeScope.runNextTimer();
assert.equal(pollCalls, 1);
assert.equal(fakeScope.nextDelay(), 30_000);
await fakeScope.runNextTimer();
assert.equal(fakeScope.nextDelay(), 60_000);
await fakeScope.runNextTimer();
assert.equal(fakeScope.nextDelay(), 120_000);
await fakeScope.runNextTimer();
assert.equal(fakeScope.nextDelay(), 30_000);

await fakeDocument.setVisibility("hidden");
assert.equal(fakeScope.timers.size, 0, "hidden pages must cancel polling");
const callsBeforeResume = pollCalls;
await fakeDocument.setVisibility("visible");
assert.equal(
  pollCalls,
  callsBeforeResume + 1,
  "returning to a visible page must poll immediately",
);
assert.equal(fakeScope.nextDelay(), 30_000);
assert.equal(fakeDocument.listenerCount("visibilitychange"), 1);
fakeScope.dispose();
assert.equal(fakeScope.timers.size, 0, "page-scope disposal must clear timers");
assert.equal(
  fakeDocument.listenerCount("visibilitychange"),
  0,
  "page-scope disposal must remove the visibility listener",
);

const pausedDocument = createFakeDocument();
const pausedScope = createFakeScope();
let pausedPollCalls = 0;
const pausablePoller = createFeedbackPoller({
  scope: pausedScope,
  documentRef: pausedDocument,
  poll: async () => {
    pausedPollCalls += 1;
    return true;
  },
  clearTimeoutFn: (id) => pausedScope.timers.delete(id),
});
pausablePoller.start();
assert.equal(pausedScope.timers.size, 1);
pausablePoller.pause();
assert.equal(pausedScope.timers.size, 0);
await pausedDocument.setVisibility("hidden");
await pausedDocument.setVisibility("visible");
assert.equal(pausedPollCalls, 0, "paused device tab must not poll");
pausablePoller.resume();
assert.equal(pausedScope.timers.size, 1);
pausedScope.dispose();
await fakeDocument.setVisibility("hidden");
await fakeDocument.setVisibility("visible");
assert.equal(
  pollCalls,
  callsBeforeResume + 1,
  "disposed routes must never resume polling",
);

const abortDocument = createFakeDocument();
const abortScope = createFakeScope();
let inFlightSignal = null;
const abortPoller = createFeedbackPoller({
  scope: abortScope,
  documentRef: abortDocument,
  poll: ({ signal }) =>
    new Promise((resolve) => {
      inFlightSignal = signal;
      signal.addEventListener("abort", () => resolve(false), { once: true });
    }),
  clearTimeoutFn: (id) => abortScope.timers.delete(id),
});
const inFlightPoll = abortPoller.refreshNow();
await Promise.resolve();
assert.equal(inFlightSignal?.aborted, false);
await abortDocument.setVisibility("hidden");
await inFlightPoll;
assert.equal(
  inFlightSignal?.aborted,
  true,
  "hiding an active page must abort its in-flight poll request",
);
abortScope.dispose();

for (let cycle = 0; cycle < 30; cycle += 1) {
  const cycleDocument = createFakeDocument();
  const cycleScope = createFakeScope();
  const cyclePoller = createFeedbackPoller({
    scope: cycleScope,
    documentRef: cycleDocument,
    poll: async () => true,
    clearTimeoutFn: (id) => cycleScope.timers.delete(id),
  });
  cyclePoller.start();
  assert.equal(cycleScope.timers.size, 1);
  cycleScope.dispose();
  assert.equal(
    cycleScope.timers.size,
    0,
    `cycle ${cycle + 1} must release its polling timer`,
  );
  assert.equal(
    cycleDocument.listenerCount("visibilitychange"),
    0,
    `cycle ${cycle + 1} must release its visibility listener`,
  );
}

// The adapter list is live data (online / charging), so the devices tab has to
// keep polling; only the single-device unbind tab stops. One poller serves both
// lists and dispatches on the active tab.
const tabDocument = createFakeDocument();
const tabScope = createFakeScope();
const tabState = { activeTab: "feedback" };
const polledLists = [];
const tabPoller = createFeedbackPoller({
  scope: tabScope,
  documentRef: tabDocument,
  poll: async () => {
    polledLists.push(tabState.activeTab === "devices" ? "adapters" : "feedback");
    return true;
  },
  clearTimeoutFn: (id) => tabScope.timers.delete(id),
});
function switchPolledTab(nextTab) {
  tabState.activeTab = nextTab;
  if (nextTab === "device") tabPoller.pause();
  else tabPoller.resume();
}

if (tabState.activeTab !== "device") tabPoller.start();
await tabScope.runNextTimer();
assert.deepEqual(polledLists, ["feedback"]);

switchPolledTab("devices");
assert.equal(tabScope.timers.size, 1, "devices tab must stay on the poller");
await tabScope.runNextTimer();
assert.deepEqual(
  polledLists,
  ["feedback", "adapters"],
  "devices tab must poll the adapter list, not the feedback list",
);

switchPolledTab("device");
assert.equal(tabScope.timers.size, 0, "device unbind tab must stop polling");
await tabDocument.setVisibility("hidden");
await tabDocument.setVisibility("visible");
assert.deepEqual(
  polledLists,
  ["feedback", "adapters"],
  "device unbind tab must stay silent across visibility changes",
);

switchPolledTab("feedback");
assert.equal(tabScope.timers.size, 1, "feedback tab must re-arm the poller");
await tabScope.runNextTimer();
assert.deepEqual(polledLists, ["feedback", "adapters", "feedback"]);

switchPolledTab("devices");
await tabDocument.setVisibility("hidden");
assert.equal(tabScope.timers.size, 0);
await tabDocument.setVisibility("visible");
assert.deepEqual(
  polledLists,
  ["feedback", "adapters", "feedback", "adapters"],
  "returning to a visible devices tab must refresh the adapter list at once",
);
tabScope.dispose();

// Source contracts for the tab-dispatched, silent adapter refresh.
assert.match(pageSource, /poll:\s*pollActiveTab/);
assert.match(
  pageSource,
  /if \(!\["device", "sim"\]\.includes\(state\.activeTab\)\) poller\.start\(\)/,
  "the SIM tab is a one-shot lookup form, so it must not start the poller",
);
assert.match(pageSource, /return pollAdapterList\(\{ signal \}\)/);
assert.match(pageSource, /loadAdapters\(\{ silent: true, signal \}\)/);
// A poll must not flash the spinner, blank the table on a failed request, or
// repaint over an open dialog / a field the operator is typing in.
assert.match(pageSource, /if \(!silent\) \{\s*state\.adapters\.loading = true;/);
assert.match(pageSource, /if \(silent\) return false;/);
assert.match(pageSource, /adapterRefreshWouldInterrupt\(\)/);
assert.match(pageSource, /state\.adapters\.loading\s*\)\s*\{\s*return true;/);

// ---------------------------------------------------------------------------
// SIM cards (OneLink) tab
// ---------------------------------------------------------------------------

// Browser allowlist: the lookup route pins the ICCID / card-number shapes so a
// hand-built sub-path cannot smuggle extra query parameters past the bridge.
for (const [method, subPath] of [
  ["GET", "/sim/lookup?iccid=89860480192090995900"],
  ["GET", "/sim/lookup?iccid=8986048019209099590"],
  ["GET", "/sim/lookup?iccid=8986048019209099590A"],
  ["GET", "/sim/lookup?msisdn=14765004176"],
  ["GET", "/sim/lookup?msisdn=1"],
  ["GET", "/sim/lookup?iccid=89860480192090995900&refresh=1"],
  ["GET", "/sim/lookup?msisdn=14765004176&refresh=1"],
  ["GET", "/sim/cards"],
  ["GET", "/sim/cards?page=1&size=50"],
  ["GET", "/sim/cards?page=2&size=50&q=8986"],
  ["POST", "/sim/cards"],
  ["POST", "/sim/cards/import"],
  ["POST", "/sim/refresh"],
]) {
  assert.doesNotThrow(() => assertHonnmonoAdminRequest(subPath, method));
}
for (const [method, subPath] of [
  ["GET", "/sim/lookup"],
  ["GET", "/sim/lookup?iccid=898604801920909959001"],
  ["GET", "/sim/lookup?iccid=898604801920909959"],
  ["GET", "/sim/lookup?iccid=8986048019209099590_"],
  ["GET", "/sim/lookup?msisdn=14765004176543"],
  ["GET", "/sim/lookup?msisdn=1476500417a"],
  ["GET", "/sim/lookup?iccid=89860480192090995900&msisdn=14765004176"],
  ["GET", "/sim/lookup?iccid=89860480192090995900&refresh=2"],
  ["GET", "/sim/lookup?iccid=89860480192090995900#https://evil.example"],
  ["POST", "/sim/lookup?iccid=89860480192090995900"],
  ["GET", "/sim/refresh"],
  ["POST", "/sim/lookup"],
  ["POST", "/sim/cards/import/extra"],
  ["POST", "/sim/cards/89860480192090995900"],
  ["DELETE", "/sim/cards"],
  ["GET", "/sim/cards#https://evil.example"],
  ["GET", "//evil.example/sim/cards"],
]) {
  assert.throws(
    () => assertHonnmonoAdminRequest(subPath, method),
    (error) =>
      error instanceof HonnmonoAdminError && error.code === "requestError",
    `${method} ${subPath} must remain outside the browser allowlist`,
  );
}

// HK bridge: the same five routes, and nothing else, reach /internal/admin/sim.
assert.equal(
  mapHonnmonoAdminPath("/sim/lookup", "GET"),
  "/internal/admin/sim/lookup",
);
assert.equal(
  mapHonnmonoAdminPath("/sim/cards", "GET"),
  "/internal/admin/sim/cards",
);
assert.equal(
  mapHonnmonoAdminPath("/sim/cards", "POST"),
  "/internal/admin/sim/cards",
);
assert.equal(
  mapHonnmonoAdminPath("/sim/cards/", "POST"),
  "/internal/admin/sim/cards",
);
assert.equal(
  mapHonnmonoAdminPath("/sim/cards/import", "POST"),
  "/internal/admin/sim/cards/import",
);
assert.equal(
  mapHonnmonoAdminPath("/sim/refresh", "POST"),
  "/internal/admin/sim/refresh",
);
for (const [pathname, method] of [
  ["/sim/lookup", "POST"],
  ["/sim/lookup", "DELETE"],
  ["/sim/refresh", "GET"],
  ["/sim/cards/import", "GET"],
  ["/sim/cards/89860480192090995900", "GET"],
  ["/sim", "GET"],
  ["/sim/anything", "GET"],
]) {
  assert.equal(
    mapHonnmonoAdminPath(pathname, method),
    "",
    `${method} ${pathname} must not map to a Shenzhen admin route`,
  );
}
for (const pathname of [
  "/internal/admin/sim/lookup",
  "/internal/admin/sim/cards",
  "/internal/admin/sim/cards/import",
  "/internal/admin/sim/refresh",
]) {
  assert.equal(
    isAllowedHonnmonoUpstream(
      new URL(`https://app-api.honnmono.top${pathname}`),
    ),
    true,
    `${pathname} must be reachable upstream`,
  );
}
assert.equal(
  isAllowedHonnmonoUpstream(
    new URL("https://app-api.honnmono.top/internal/admin/sim/cards/extra"),
  ),
  false,
);
assert.equal(
  isAllowedHonnmonoUpstream(new URL("https://evil.example/internal/admin/sim/lookup")),
  false,
);

const edgeFunctionSource = await read(
  "supabase/functions/honnmono-admin/index.ts",
);
for (const route of [
  "GET  /honnmono-admin/sim/lookup",
  "GET  /honnmono-admin/sim/cards",
  "POST /honnmono-admin/sim/cards",
  "POST /honnmono-admin/sim/cards/import",
  "POST /honnmono-admin/sim/refresh",
]) {
  assert.ok(
    edgeFunctionSource.includes(route),
    `the bridge header must list ${route}`,
  );
}

// Per-route budgets: a lookup chains five or six OneLink calls behind
// Shenzhen, and the bulk paste is far bigger than a normal admin body.
assert.equal(upstreamTimeoutFor("/internal/admin/sim/lookup"), 60_000);
assert.equal(upstreamTimeoutFor("/internal/admin/sim/refresh"), 60_000);
assert.equal(SIM_LOOKUP_TIMEOUT_MS, 60_000);
assert.equal(maxRequestBytesFor("/internal/admin/sim/cards/import"), 65_536);
assert.equal(SIM_IMPORT_MAX_REQUEST_BYTES, 65_536);
for (const upstreamPath of [
  "/internal/admin/sim/cards",
  "/internal/admin/feedback",
  "/internal/admin/device/binding",
]) {
  assert.equal(
    upstreamTimeoutFor(upstreamPath),
    UPSTREAM_TIMEOUT_MS,
    `${upstreamPath} must keep the 10s default`,
  );
  assert.equal(
    maxRequestBytesFor(upstreamPath),
    MAX_REQUEST_JSON_BYTES,
    `${upstreamPath} must keep the 16 KB default`,
  );
}
assert.equal(maxRequestBytesFor("/internal/admin/sim/lookup"), MAX_REQUEST_JSON_BYTES);
assert.equal(upstreamTimeoutFor("/internal/admin/sim/cards/import"), UPSTREAM_TIMEOUT_MS);
// The Deno entrypoint cannot be imported from Node, so pin that it actually
// asks routing.mjs for the budget instead of hard-coding one.
assert.match(
  edgeFunctionSource,
  /const upstreamTimeoutMs = upstreamTimeoutFor\(upstreamPath\);/,
);
assert.match(
  edgeFunctionSource,
  /const maxRequestBytes = maxRequestBytesFor\(upstreamPath\);/,
);
assert.doesNotMatch(
  edgeFunctionSource,
  /requestLength > MAX_REQUEST_JSON_BYTES[\s\S]{0,400}upstreamBody = await req\.text\(\)/,
  "the Shenzhen branch must size its body cap per route, not by the shared default",
);
// A 500-line paste at the page's own limit must fit inside the raised cap.
const worstCaseImportBody = JSON.stringify({
  lines: Array.from(
    { length: SIM_IMPORT_MAX_LINES },
    (_, index) =>
      `8986048019209099${String(index).padStart(4, "0")},86263506612${String(
        index,
      ).padStart(4, "0")},備註`,
  ).join("\n"),
});
assert.ok(
  new TextEncoder().encode(worstCaseImportBody).byteLength >
    MAX_REQUEST_JSON_BYTES,
  "a full paste would have been rejected by the old 16 KB cap",
);
assert.ok(
  new TextEncoder().encode(worstCaseImportBody).byteLength <=
    maxRequestBytesFor("/internal/admin/sim/cards/import"),
  "a full 500-line paste must fit inside the SIM import cap",
);

// ICCID vs card number is decided by shape alone: 19-20 alphanumerics is an
// ICCID, up to 13 digits is the card number (msisdn). Nothing else is queried.
for (const [value, kind] of [
  ["89860480192090995900", "iccid"],
  ["8986048019209099590", "iccid"],
  ["8986048019209099590A", "iccid"],
  ["14765004176", "msisdn"],
  ["1234567890123", "msisdn"],
  ["1", "msisdn"],
]) {
  assert.equal(detectSimQueryKind(value), kind, `${value} must read as ${kind}`);
}
for (const value of [
  "",
  "   ",
  "12345678901234",
  "898604801920909959",
  "898604801920909959001",
  "8986048019209099590!",
  "iccid=89860480192090995900",
]) {
  assert.equal(detectSimQueryKind(value), null, `${value} must not be queried`);
}
assert.equal(
  normalizeSimQuery(" 8986 0480 1920 9099 5900 "),
  "89860480192090995900",
);

assert.equal(
  simLookupSubPath("89860480192090995900"),
  "/sim/lookup?iccid=89860480192090995900",
);
assert.equal(
  simLookupSubPath(" 14765004176 ", { refresh: true }),
  "/sim/lookup?msisdn=14765004176&refresh=1",
);
assert.equal(simLookupSubPath("nope"), "");
assert.equal(SIM_CARDS_PAGE_SIZE, 50);
assert.equal(SIM_IMPORT_MAX_LINES, 500);
assert.equal(simCardsSubPath(), "/sim/cards?page=1&size=50");
assert.equal(
  simCardsSubPath({ page: 3, query: " 8986 " }),
  "/sim/cards?page=3&size=50&q=8986",
);
assert.equal(simCardsSubPath({ page: 0 }), "/sim/cards?page=1&size=50");
for (const subPath of [
  simLookupSubPath("89860480192090995900"),
  simLookupSubPath("89860480192090995900", { refresh: true }),
  simLookupSubPath("14765004176"),
  simCardsSubPath({ page: 2, query: "8986" }),
  simCardsSubPath({ page: 1, query: "a&b=c" }),
]) {
  assert.doesNotThrow(
    () => assertHonnmonoAdminRequest(subPath, "GET"),
    `${subPath} is built by the page, so it must satisfy the allowlist`,
  );
}

// OneLink reports KB; the page rescales to MB / GB with two decimals.
assert.deepEqual(formatSimData(87214), { key: "simSizeMb", size: "85.17" });
assert.deepEqual(formatSimData(102400), { key: "simSizeMb", size: "100.00" });
assert.deepEqual(formatSimData(1024), { key: "simSizeMb", size: "1.00" });
assert.deepEqual(formatSimData(1024 * 1024), { key: "simSizeGb", size: "1.00" });
assert.deepEqual(formatSimData(2_621_440), { key: "simSizeGb", size: "2.50" });
assert.deepEqual(formatSimData(1023), { key: "simSizeKb", size: "1023" });
assert.deepEqual(formatSimData(0), { key: "simSizeKb", size: "0" });
assert.deepEqual(formatSimData(1.5), { key: "simSizeKb", size: "1.50" });
assert.equal(formatSimData(null), null);
assert.equal(formatSimData(""), null);
assert.equal(formatSimData("abc"), null);

for (const [days, level] of [
  [119, "normal"],
  [31, "normal"],
  [30, "warning"],
  [8, "warning"],
  [7, "danger"],
  [1, "danger"],
  [0, "danger"],
  [-1, "expired"],
  [-33, "expired"],
]) {
  assert.equal(
    simDaysLeftLevel(days),
    level,
    `${days} days left must colour as ${level}`,
  );
}
assert.equal(simDaysLeftLevel(null), null);
assert.equal(simDaysLeftLevel(undefined), null);
assert.equal(simDaysLeftLevel("soon"), null);

assert.equal(simUsagePercent({ totalKb: 102400, usedKb: 15186 }), 15);
assert.equal(simUsagePercent({ totalKb: 102400, usedKb: 204800 }), 100);
assert.equal(simUsagePercent({ totalKb: 0, usedKb: 10 }), null);
assert.equal(simUsagePercent(null), null);
assert.equal(simCardsPageCount(0), 1);
assert.equal(simCardsPageCount(50), 1);
assert.equal(simCardsPageCount(51), 2);
assert.equal(simCardsPageCount(null), 1);
assert.equal(simImportLineCount("a\n\n  b  \n"), 2);
assert.equal(simImportLineCount(""), 0);

assert.deepEqual(
  simManualRequestBody({
    value: " 89860480192090995900 ",
    imei: "862635066123456",
    remark: " 測試機 ",
  }),
  {
    iccid: "89860480192090995900",
    imei: "862635066123456",
    remark: "測試機",
  },
);
assert.deepEqual(simManualRequestBody({ value: "14765004176" }), {
  msisdn: "14765004176",
});
assert.throws(
  () => simManualRequestBody({ value: "12345678901234" }),
  (error) => error.code === "simQueryValidation",
);
assert.throws(
  () => simManualRequestBody({ value: "14765004176", imei: "12345" }),
  (error) => error.code === "simManualImeiValidation",
);

// Fixtures are the sample payloads from the task contract (sections 3.1 / 3.2);
// nothing here touches a real OneLink endpoint.
const simLookupFixture = {
  query: { iccid: "89860480192090995900", msisdn: "14765004176" },
  card: {
    iccid: "89860480192090995900",
    msisdn: "14765004176",
    imsi: "460041234567890",
    openDate: "2018-04-21 08:00:00",
    activeDate: "2018-04-22 08:00:00",
    remark: "",
  },
  status: { code: "1", label: "正常", changedAt: "2026-08-01 10:00:00" },
  offerings: [
    {
      offeringId: "21000032",
      offeringName: "全國通用流量 8 元套餐",
      effectiveDate: "2026-01-01 00:00:00",
      expiriedDate: "2026-12-31 23:59:59",
      apnName: "CMIOT",
    },
  ],
  renewal: { expiresAt: "2026-12-31 23:59:59", daysLeft: 119, dueAt: "2026-12-31" },
  usage: {
    month: "2026-09",
    totalKb: 102400,
    usedKb: 15186,
    remainKb: 87214,
    items: [
      {
        offeringName: "全國通用流量 8 元套餐",
        totalKb: 102400,
        usedKb: 15186,
        remainKb: 87214,
      },
    ],
  },
  balance: {
    accountName: "Honnmono",
    amount: "0.62",
    overDue: "5",
    lateFee: "0",
    conSume: "10",
  },
  device: {
    certid: "0DB897034096400000EC7547",
    imei: "862635066123456",
    uuid: "uuid-1",
    userid: 123,
    username: "xx@qq.com",
  },
  fetchedAt: 1788345671734,
  cached: false,
  errors: {},
};
const simCardsFixture = {
  total: 8,
  page: 1,
  size: 50,
  items: [
    {
      iccid: "89860480192090995900",
      msisdn: "14765004176",
      imsi: "460041234567890",
      certid: "0DB897034096400000EC7547",
      imei: "862635066123456",
      source: "device_report",
      remark: "",
      statusLabel: "正常",
      expiresAt: "2026-12-31 23:59:59",
      daysLeft: 119,
      remainKb: 87214,
      snapshotAt: 1788345671734,
      snapshotError: null,
    },
  ],
};

const simState = createSimCardState({
  simQueryInput: " 8986 0480 1920 9099 5900 ",
});
assert.equal(simState.queryInput, "89860480192090995900");
assert.equal(simState.cards.page, 1);
const simCalls = [];
let simRenders = 0;
const simController = createSimCardController({
  simState,
  scope: { signal: new AbortController().signal },
  isActive: () => true,
  isSimTab: () => true,
  rerender: () => {
    simRenders += 1;
  },
  focus: () => {},
  request: async (path, options = {}) => {
    simCalls.push([path, options]);
    assert.doesNotThrow(
      () => assertHonnmonoAdminRequest(path, options.method ?? "GET"),
      `the SIM controller must only issue allowlisted requests (${path})`,
    );
    if (path.startsWith("/sim/lookup")) return simLookupFixture;
    if (path === "/sim/refresh") return { ...simLookupFixture, cached: false };
    if (path === "/sim/cards/import") {
      return {
        added: 1,
        updated: 1,
        failed: [{ line: 3, reason: "iccid 不合法" }],
      };
    }
    if (path === "/sim/cards") return simCardsFixture.items[0];
    if (path.startsWith("/sim/cards?")) return simCardsFixture;
    throw new Error(`unexpected sub-path ${path}`);
  },
});

await simController.lookup();
assert.equal(simCalls[0][0], "/sim/lookup?iccid=89860480192090995900");
assert.equal(simState.lookup.renewal.daysLeft, 119);
assert.equal(simState.queriedValue, "89860480192090995900");
await simController.refetch();
assert.equal(
  simCalls[1][0],
  "/sim/lookup?iccid=89860480192090995900&refresh=1",
  "『重新拉取』must bypass the backend cache",
);
simController.setQueryInput("14765004176");
await simController.lookup();
assert.equal(
  simCalls[2][0],
  "/sim/lookup?msisdn=14765004176",
  "a card number must be sent as msisdn, not iccid",
);
simController.setQueryInput("12345678901234");
await simController.lookup();
assert.equal(simCalls.length, 3, "an unparseable query must not hit the bridge");
assert.equal(simState.lookupError.code, "simQueryValidation");

simController.setCardsQueryInput("8986");
await simController.searchCards();
assert.equal(simCalls[3][0], "/sim/cards?page=1&size=50&q=8986");
assert.equal(simState.cards.total, 8);
assert.equal(simState.cards.rows.length, 1);
assert.equal(simState.cards.loaded, true);
await simController.goToCardsPage(2);
assert.equal(simCalls[4][0], "/sim/cards?page=2&size=50&q=8986");

simController.setManualField("valueInput", "89860480192090995901");
simController.setManualField("imeiInput", "862635066123456");
simController.setManualField("remarkInput", " 測試機 ");
await simController.submitManual();
const manualCall = simCalls.find(
  ([path, options]) => path === "/sim/cards" && options.method === "POST",
);
assert.deepEqual(manualCall[1].body, {
  iccid: "89860480192090995901",
  imei: "862635066123456",
  remark: "測試機",
});
assert.equal(simState.manual.valueInput, "");
assert.ok(simState.manual.result);

simController.setManualField("valueInput", "14765004176");
simController.setManualField("imeiInput", "12345");
const manualCallCount = simCalls.length;
await simController.submitManual();
assert.equal(simCalls.length, manualCallCount, "a bad IMEI must not be posted");
assert.equal(simState.manual.error.code, "simManualImeiValidation");

simController.setImportInput("   ");
const importCallCount = simCalls.length;
await simController.submitImport();
assert.equal(simCalls.length, importCallCount);
assert.equal(simState.importer.error.code, "simImportRequired");
simController.setImportInput(
  Array.from({ length: SIM_IMPORT_MAX_LINES + 1 }, (_, index) =>
    String(14765004176 + index),
  ).join("\n"),
);
await simController.submitImport();
assert.equal(simCalls.length, importCallCount);
assert.equal(simState.importer.error.code, "simImportTooManyLines");
const importLines = "89860480192090995900,862635066123456,測試機\n14765004176";
simController.setImportInput(importLines);
await simController.submitImport();
const importCall = simCalls.find(([path]) => path === "/sim/cards/import");
assert.deepEqual(importCall[1].body, { lines: importLines });
assert.equal(simState.importer.result.added, 1);
assert.equal(simState.importer.result.failed[0].line, 3);
assert.equal(simState.importer.linesInput, "");

await simController.refreshCard("89860480192090995900");
const refreshCall = simCalls.find(([path]) => path === "/sim/refresh");
assert.deepEqual(refreshCall[1].body, { iccid: "89860480192090995900" });
assert.equal(simState.queriedValue, "89860480192090995900");
assert.equal(simState.cards.refreshingIccid, "");
assert.ok(simRenders >= 10);

const simT = (key, values = {}) => translateAppFeedback("zh", key, values);
const simRenderState = createSimCardState();
simRenderState.queryInput = "89860480192090995900";
simRenderState.queriedValue = "89860480192090995900";
simRenderState.lookup = {
  ...simLookupFixture,
  card: { ...simLookupFixture.card, remark: "<script>alert(1)</script>" },
  status: null,
  renewal: { expiresAt: "2026-09-05 23:59:59", daysLeft: 4, dueAt: "2026-09-05" },
  cached: true,
  errors: { status: "<img src=x onerror=alert(1)> 12010 查不到" },
};
simRenderState.cards.rows = simCardsFixture.items;
simRenderState.cards.total = simCardsFixture.total;
simRenderState.cards.loaded = true;
const simHtml = renderSimCards({
  simState: simRenderState,
  t: simT,
  escapeHtml,
  formatTime: () => "2026-09-03 12:00:00",
  errorCopy: () => "error",
});
assert.doesNotMatch(simHtml, /<script>alert\(1\)<\/script>/);
assert.doesNotMatch(simHtml, /<img src=x/);
assert.match(simHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(simHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.ok(
  simHtml.includes(appFeedbackCopy.zh.simSectionUnavailable.split("{")[0]),
  "a null section must show its errors[] copy instead of a blank block",
);
assert.match(simHtml, /app-feedback-sim-days--danger/);
assert.match(
  simHtml,
  /--sim-usage-percent:15%/,
  "the monthly data bar must reflect used / total",
);
assert.ok(simHtml.includes("85.17"), "87214 KB must render as 85.17 MB");
assert.match(simHtml, /data-sim-query/);
assert.match(simHtml, /data-sim-refetch/);
assert.match(simHtml, /data-sim-cards-search/);
assert.match(simHtml, /data-sim-view="89860480192090995900"/);
assert.match(simHtml, /data-sim-refresh-card="89860480192090995900"/);
assert.match(simHtml, /data-sim-manual/);
assert.match(simHtml, /data-sim-import-lines/);
assert.ok(
  simHtml.includes(`>${appFeedbackCopy.zh.simRecharge}<`),
  "the top-up slot must be present",
);
assert.match(
  simHtml,
  /class="app-feedback-button" disabled>充值/,
  "the top-up button ships disabled this round",
);
assert.ok(simHtml.includes(appFeedbackCopy.zh.simCached));
assert.ok(simHtml.includes(appFeedbackCopy.zh.simSourceDeviceReport));

simRenderState.lookup = {
  ...simLookupFixture,
  renewal: { expiresAt: "2026-08-01 00:00:00", daysLeft: -33, dueAt: "2026-08-01" },
  usage: null,
  balance: null,
  offerings: null,
  errors: {},
};
const simExpiredHtml = renderSimCards({
  simState: simRenderState,
  t: simT,
  escapeHtml,
  formatTime: () => "2026-09-03 12:00:00",
  errorCopy: () => "error",
});
assert.match(simExpiredHtml, /app-feedback-sim-days--expired/);
assert.match(simExpiredHtml, /app-feedback-sim-expired/);
assert.ok(
  simExpiredHtml.includes(
    appFeedbackCopy.zh.simExpiredDays.replaceAll("{days}", "33"),
  ),
);
assert.ok(
  simExpiredHtml.includes(appFeedbackCopy.zh.simSectionUnknownError),
  "a null section without an errors[] entry still gets readable copy",
);

simRenderState.lookup = null;
simRenderState.cards.rows = [];
simRenderState.cards.total = 0;
const simEmptyHtml = renderSimCards({
  simState: simRenderState,
  t: simT,
  escapeHtml,
  formatTime: () => "2026-09-03 12:00:00",
  errorCopy: () => "error",
});
assert.ok(simEmptyHtml.includes(appFeedbackCopy.zh.simQueryPrompt));
assert.ok(simEmptyHtml.includes(appFeedbackCopy.zh.simNoCards));

const simSource = await read("root-site/bizflow/app-feedback-sim.js");
assert.doesNotMatch(simSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(simSource, /app-api/i);
assert.doesNotMatch(simSource, /\bsetInterval\s*\(/);
assert.doesNotMatch(simSource, /\bsetTimeout\s*\(/);
assert.doesNotMatch(simSource, /window\.confirm/);
assert.match(simSource, /escapeHtml/);
assert.match(pageSource, /data-app-feedback-tab="sim"/);
assert.match(pageSource, /if \(nextTab === "sim"\)/);
assert.match(pageSource, /isSimTab: \(\) => state\?\.activeTab === "sim"/);
// 413 is what the bridge answers when a paste outruns the import cap.
assert.match(
  pageSource,
  /if \(error\.status === 413\) return t\("simImportTooLarge"\);/,
);
for (const language of feedbackLanguages) {
  assert.equal(typeof appFeedbackCopy[language].simImportTooLarge, "string");
  assert.notEqual(appFeedbackCopy[language].simImportTooLarge.trim(), "");
}
assert.match(pageSource, /simState: state\.sim/);
for (const [label, source] of [
  ["the SIM module", simSource],
  ["the SIM copy", JSON.stringify(appFeedbackCopy)],
]) {
  assert.doesNotMatch(source, /老板|老闆/, `${label} must not say 老板`);
}

// Every literal copy key the SIM module reaches for must exist in all three
// languages -- a missing key would silently render as the raw key name.
const simCopyKeys = [
  ...new Set(
    [...simSource.matchAll(/"(sim[A-Za-z0-9]+)"/g)].map((match) => match[1]),
  ),
];
assert.ok(simCopyKeys.length >= 25, "the SIM module must be fully translated");
const simDictionaryKeys = Object.keys(appFeedbackCopy.zh).filter((key) =>
  key.startsWith("sim"),
);
assert.ok(simDictionaryKeys.length >= 90);
for (const language of feedbackLanguages) {
  for (const key of [
    ...simCopyKeys,
    ...simDictionaryKeys,
    "basicInfo",
    "bindingUser",
    "status",
    "actions",
    "search",
    "refresh",
    "refreshing",
    "page",
    "previous",
    "next",
  ]) {
    assert.equal(
      typeof appFeedbackCopy[language][key],
      "string",
      `${language}.${key} must exist for the SIM card tab`,
    );
    assert.notEqual(appFeedbackCopy[language][key].trim(), "");
  }
}
assert.equal(appFeedbackCopy.zh.simCardTab, "流量卡");
assert.equal(appFeedbackCopy.en.simCardTab, "SIM cards");
assert.equal(appFeedbackCopy.fr.simCardTab, "Cartes SIM");

assert.match(cssSource, /\.app-feedback-sim-days--expired/);
assert.match(cssSource, /\.app-feedback-sim-days--warning/);
assert.match(cssSource, /\.app-feedback-sim-progress/);
assert.doesNotMatch(
  cssSource,
  /border-radius:\s*var\(--radius-40\)/,
  "the feedback page keeps its 20px corner ceiling",
);

console.log(
  "Honnmono APP root-site contracts: PASS (feedback + device unbind + OTA package card + SIM card lookup, allowlists, confirmations, escaped fields, tab-dispatched polling, i18n)",
);
