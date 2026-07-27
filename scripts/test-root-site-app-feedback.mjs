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
import { SECTION_MENU_ITEMS } from "../root-site/components/navigation-registry.js";
import { dictionaries } from "../root-site/shell/shell-i18n.js";
import { createRouteFrame } from "../root-site/spa/route-menu.js";
import { routeManifest, spaRouteAllowlist } from "../root-site/spa/route-manifest.js";

const read = (relative) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

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
for (const [method, subPath] of [
  ["GET", "/feedback/0"],
  ["GET", "/feedback/-1"],
  ["GET", "/feedback/1/log-link"],
  ["POST", "/feedback"],
  ["POST", "/feedback/1"],
  ["DELETE", "/feedback/1"],
  ["GET", "//evil.example/feedback"],
  ["GET", "/feedback#https://evil.example"],
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
}

for (const language of ["zh", "en", "fr"]) {
  assert.equal(
    typeof dictionaries[language]["nav.appFeedback"],
    "string",
    `${language} shell navigation must translate app feedback`,
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
  labelKey: "nav.appFeedback",
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
assert.equal(feedbackRoute.entry.endsWith("/bizflow/app-feedback.js"), true);
assert.deepEqual(
  feedbackRoute.styles.map((url) => new URL(url).pathname.split("/root-site/").at(-1)),
  ["bizflow/app-feedback.css"],
);
const loadedPage = await feedbackRoute.load();
assert.equal(typeof loadedPage.mountPage, "function");

const [pageSource, apiSource, htmlSource, cssSource] = await Promise.all([
  read("root-site/bizflow/app-feedback.js"),
  read("root-site/bizflow/app-feedback-api.js"),
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
assert.match(apiSource, /functions\/v1\/\$\{EDGE_FUNCTION\}/);
assert.match(apiSource, /Authorization:\s*`Bearer \$\{context\.accessToken\}`/);
assert.match(apiSource, /apikey:\s*context\.anonKey/);
assert.match(apiSource, /signal,/);

assert.match(htmlSource, /<script src="\.\.\/shell\/shell-skeleton\.js"><\/script>/);
assert.match(htmlSource, /<script type="module" src="\.\.\/spa\/entry\.js"><\/script>/);
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
assert.doesNotMatch(cssSource, /(?:^|[;:{\s])#[0-9a-f]{3,8}\b/i);

console.log(
  "Honnmono APP feedback root-site contracts: PASS (SPA lifecycle, route, admin menu, edge-only channel, log tri-state, i18n)",
);
