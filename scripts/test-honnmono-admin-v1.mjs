import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isAllowedFlashAdminBase,
  isAllowedHonnmonoUpstream,
  isAllowedOtaAdminBase,
  mapHonnmonoAdminPath,
  mapFlashAdminPath,
  mapOtaAdminPath,
} from "../supabase/functions/honnmono-admin/routing.mjs";


const [app, view, helper, i18n, edge, override] = await Promise.all([
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/views/honnmono/AppFeedback.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/honnmonoAdmin.js", import.meta.url), "utf8"),
  readFile(new URL("../src/i18n.jsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/honnmono-admin/index.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../deploy/hk-edge/docker-compose.ocpp-admin-env.yml", import.meta.url),
    "utf8",
  ),
]);

assert.match(
  app,
  /\.\.\.\(isBfAdmin \? \[\{ type: "group", id: "g_honnmono"/,
  "Honnmono nav group must remain admin-only",
);
assert.match(app, /id: "appFeedback", label: t\("用戶反饋"\)/);
assert.match(app, /tab === "appFeedback" && isBfAdmin/);

assert.match(helper, /\/functions\/v1\$\{PROXY_PATH\}\$\{subPath\}/);
assert.doesNotMatch(
  `${helper}\n${view}`,
  /https?:\/\/app-api\.honnmono\.top/,
  "frontend JSON code must never embed the Shenzhen API host",
);
assert.doesNotMatch(
  `${helper}\n${view}`,
  /HONNMONO_ADMIN_INTERNAL_TOKEN/,
  "frontend must never know the bridge token",
);
assert.match(view, /external:\s*\{/);
assert.match(view, /logExternalUrl/);
assert.match(view, /target="_blank"/);
assert.match(view, /rel="noopener noreferrer"/);
assert.doesNotMatch(view, /\bnone:\s*\{/);

const en = i18n.split("const DICT_FR =", 1)[0];
const fr = i18n.split("const DICT_FR =", 2)[1].split("const I18nContext", 1)[0];
const usedKeys = new Set(
  [...view.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]),
);
for (const key of usedKeys) {
  assert.ok(en.includes(`"${key}":`), `missing EN translation: ${key}`);
  assert.ok(fr.includes(`"${key}":`), `missing FR translation: ${key}`);
}

assert.equal(
  mapHonnmonoAdminPath("/feedback/42/log-link", "POST"),
  "/internal/admin/feedback/42/log-link",
);
assert.equal(
  mapHonnmonoAdminPath("/device/binding", "GET"),
  "/internal/admin/device/binding",
);
assert.equal(
  mapHonnmonoAdminPath("/device/unbind", "POST"),
  "/internal/admin/device/unbind",
);
assert.equal(mapHonnmonoAdminPath("/feedback-log/token", "GET"), "");
assert.equal(mapHonnmonoAdminPath("/device/unbind", "GET"), "");
assert.equal(mapOtaAdminPath("/ota/package", "GET"), "/package");
assert.equal(mapOtaAdminPath("/ota/package", "POST"), "/package");
assert.equal(mapOtaAdminPath("/ota/package", "DELETE"), "");
assert.equal(
  mapHonnmonoAdminPath("/devices/dc-pro", "GET"),
  "/internal/admin/adapter-devices/dc-pro",
);
assert.equal(
  mapHonnmonoAdminPath("/devices/dc-pro/CERT_1/sessions", "GET"),
  "/internal/admin/adapter-devices/dc-pro/CERT_1/sessions",
);
assert.equal(
  mapHonnmonoAdminPath("/ota/legacy-packages", "GET"),
  "/internal/admin/ota/legacy-packages",
);
assert.equal(
  mapHonnmonoAdminPath("/ota/legacy-packages/150004", "POST"),
  "/internal/admin/ota/legacy-packages/150004",
);
assert.equal(mapOtaAdminPath("/devices/flash", "GET"), "/devices/flash");
assert.equal(
  mapOtaAdminPath("/devices/flash/CERT_1/sessions", "GET"),
  "/devices/flash/CERT_1/sessions",
);
assert.equal(
  mapOtaAdminPath("/devices/flash/CERT_1/uploads/7", "GET"),
  "/devices/flash/CERT_1/uploads/7",
);
assert.equal(
  mapOtaAdminPath("/devices/flash/CERT_1/actions", "POST"),
  "/devices/flash/CERT_1/actions",
);
assert.equal(
  mapFlashAdminPath("/devices/flash/CERT_1/unbind", "POST"),
  "/internal/admin/devices/flash/CERT_1/unbind",
);
assert.equal(mapFlashAdminPath("/devices/flash/CERT_1/unbind", "GET"), "");
assert.equal(mapFlashAdminPath("/devices/dc-pro/CERT_1/unbind", "POST"), "");
assert.equal(
  mapOtaAdminPath("/ota/legacy-packages/150001", "POST"),
  "/legacy-packages/150001",
);
assert.equal(isAllowedOtaAdminBase("http://172.18.0.1:8086"), true);
assert.equal(isAllowedOtaAdminBase("http://172.18.0.1:8086/base"), false);
assert.equal(isAllowedOtaAdminBase("https://172.18.0.1:8086"), false);
assert.equal(isAllowedOtaAdminBase("http://public.example:8086"), false);
assert.equal(isAllowedFlashAdminBase("http://172.18.0.1:8090"), true);
assert.equal(isAllowedFlashAdminBase("http://127.0.0.1:8090"), false);
assert.equal(isAllowedFlashAdminBase("https://172.18.0.1:8090"), false);
assert.equal(isAllowedFlashAdminBase("http://172.18.0.1:8090/base"), false);
assert.equal(
  isAllowedHonnmonoUpstream(
    new URL("https://app-api.honnmono.top/internal/admin/feedback-log/token"),
  ),
  false,
);
assert.match(edge, /employees\?user_id=eq\./);
assert.match(edge, /"X-Internal-Token": HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.match(edge, /operatorEmail\s*=\s*String\(user\?\.email/);
assert.match(edge, /"X-Operator-Email": guard\.operatorEmail/);
assert.match(edge, /body:\s*upstreamBody\s*\|\|\s*undefined/);
assert.match(edge, /MAX_REQUEST_JSON_BYTES = 16_384/);
assert.match(edge, /DEVICE_UNBIND_TIMEOUT_MS = 90_000/);
assert.match(edge, /upstreamPath === "\/internal\/admin\/device\/unbind"/);
assert.match(edge, /MAX_JSON_BYTES = 2_000_000/);
assert.match(edge, /Deno\.env\.get\("OTA_ADMIN_URL"\)/);
assert.match(edge, /Deno\.env\.get\("OTA_ADMIN_TOKEN"\)/);
assert.match(edge, /"X-Internal-Token": OTA_ADMIN_TOKEN/);
assert.match(edge, /mapOtaAdminPath\(subPath, req\.method\)/);
assert.match(edge, /OTA admin service unavailable/);
assert.match(edge, /Deno\.env\.get\("FLASH_ADMIN_URL"\)/);
assert.match(edge, /Deno\.env\.get\("FLASH_ADMIN_TOKEN"\)/);
assert.match(edge, /mapFlashAdminPath\(subPath, req\.method\)/);
assert.match(edge, /"X-Internal-Token": FLASH_ADMIN_TOKEN/);
assert.match(edge, /"X-Operator-Email": guard\.operatorEmail/);
assert.match(edge, /Flash admin service unavailable/);
assert.match(edge, /MAX_OTA_REQUEST_JSON_BYTES = 2_800_000/);
assert.ok(
  edge.indexOf("const guard: GuardResult = await verifyAdmin(req)") <
    edge.indexOf("if (isOtaRequest)"),
  "OTA routing must remain behind the existing JWT/admin guard",
);
assert.ok(
  edge.indexOf("const guard: GuardResult = await verifyAdmin(req)") <
    edge.indexOf("if (isFlashAdminRequest)"),
  "flash key rotation must remain behind the existing JWT/admin guard",
);
assert.match(
  edge,
  /return json\(\{ error: "OTA admin service unavailable" \}, 503\)/,
);

for (const key of [
  "OCPP_API_KEY",
  "CHARGECMS_READAPI_URL",
  "OCPP_ADMIN_INTERNAL_TOKEN",
  "HONNMONO_ADMIN_API_URL",
  "HONNMONO_ADMIN_INTERNAL_TOKEN",
  "OTA_ADMIN_URL",
  "OTA_ADMIN_TOKEN",
  "FLASH_ADMIN_URL",
  "FLASH_ADMIN_TOKEN",
]) {
  assert.match(override, new RegExp(`\\b${key}:`), `override missing ${key}`);
}

console.log(
  `[honnmono-admin-v1] ${usedKeys.size} i18n keys + nav/auth/route/override contracts passed`,
);
