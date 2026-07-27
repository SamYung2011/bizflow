import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isAllowedHonnmonoUpstream,
  mapHonnmonoAdminPath,
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
assert.equal(mapHonnmonoAdminPath("/feedback-log/token", "GET"), "");
assert.equal(
  isAllowedHonnmonoUpstream(
    new URL("https://app-api.honnmono.top/internal/admin/feedback-log/token"),
  ),
  false,
);
assert.match(edge, /employees\?user_id=eq\./);
assert.match(edge, /"X-Internal-Token": HONNMONO_ADMIN_INTERNAL_TOKEN/);
assert.match(edge, /MAX_JSON_BYTES = 2_000_000/);

for (const key of [
  "OCPP_API_KEY",
  "CHARGECMS_READAPI_URL",
  "OCPP_ADMIN_INTERNAL_TOKEN",
  "HONNMONO_ADMIN_API_URL",
  "HONNMONO_ADMIN_INTERNAL_TOKEN",
]) {
  assert.match(override, new RegExp(`\\b${key}:`), `override missing ${key}`);
}

console.log(
  `[honnmono-admin-v1] ${usedKeys.size} i18n keys + nav/auth/route/override contracts passed`,
);
