import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  HonnmonoAdminError,
  assertHonnmonoAdminRequest,
  formatFeedbackTime,
  normalizeFeedbackLogStatus,
  safeHttpUrl,
} from "../root-site/bizflow/app-feedback-api.js";
import { appFeedbackCopy } from "../root-site/bizflow/app-feedback-i18n.js";
import {
  createDeviceUnbindController,
  createDeviceUnbindState,
  deviceExpectedUserId,
  isValidDeviceImei,
  renderDeviceUnbind,
} from "../root-site/bizflow/app-feedback-device.js";
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
  ["bizflow/app-feedback.css"],
);
const loadedPage = await feedbackRoute.load();
assert.equal(typeof loadedPage.mountPage, "function");

const [pageSource, apiSource, deviceSource, pollerSource, htmlSource, cssSource] =
  await Promise.all([
    read("root-site/bizflow/app-feedback.js"),
    read("root-site/bizflow/app-feedback-api.js"),
    read("root-site/bizflow/app-feedback-device.js"),
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
assert.doesNotMatch(deviceSource, /HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.doesNotMatch(deviceSource, /app-api/i);
assert.match(apiSource, /functions\/v1\/\$\{EDGE_FUNCTION\}/);
assert.match(apiSource, /Authorization:\s*`Bearer \$\{context\.accessToken\}`/);
assert.match(apiSource, /apikey:\s*context\.anonKey/);
assert.match(apiSource, /signal,/);
assert.match(apiSource, /"Content-Type":\s*"application\/json"/);
assert.match(apiSource, /body:\s*serializedBody/);
assert.match(apiSource, /backendCode === "imei_ambiguous"/);
assert.match(pageSource, /error\.code === "imei_ambiguous"/);
assert.match(pageSource, /data-app-feedback-tab="feedback"/);
assert.match(pageSource, /data-app-feedback-tab="device"/);
assert.match(pageSource, /activePoller\?\.pause\(\)/);
assert.match(pageSource, /state\.activeTab\s*!==\s*"feedback"/);
assert.match(deviceSource, /expected_userid:\s*expectedUserid/);
assert.match(deviceSource, /pattern="\[0-9\]\{15\}"/);
assert.match(deviceSource, /escapeHtml/);
assert.match(deviceSource, /data-device-confirm-submit/);
assert.match(deviceSource, /noAccountWarning/);
assert.match(deviceSource, /providerUnverifiedWarning/);
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

console.log(
  "Honnmono APP root-site contracts: PASS (feedback + manual device unbind tabs, exact IMEI allowlist, confirmation, escaped fields, checklist, scoped polling, i18n)",
);
