import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderWhatsappConfig } from "../root-site/bizflow/whatsapp-config.js";
import { whatsappCopy } from "../root-site/bizflow/whatsapp-i18n.js";
import {
  createLiveWhatsappWriter,
  whatsappSettingsPatch
} from "../root-site/data/live-whatsapp-writes.js";

const helpers = {
  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },
  icon(name, className) {
    return `<svg data-icon="${name}" class="${className}"></svg>`;
  }
};
const t = (key, values = {}) => Object.entries(values).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
  whatsappCopy.en[key] ?? key
);
const baseState = {
  liveMode: true,
  liveReadOnly: false,
  writeBlocked: false,
  clients: [],
  savedSection: "",
  secretUnlocked: false,
  unlockedApiKey: "",
  secretMasks: {},
  secretDrafts: {},
  editingSecret: null,
  settings: {
    claudeMode: "api_cloud",
    openaiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    latestExtVersion: "",
    bossPrompt: "Dedicated prompt",
    bossPromptChars: 16
  }
};

const lockedSettings = renderWhatsappConfig("settings", structuredClone(baseState), helpers, t);
const downloadTag = lockedSettings.match(/<a\b[^>]*href="\/whatsapp-extension-cloud\.zip"[^>]*>/)?.[0] ?? "";
assert.ok(downloadTag, "C1 must render the real extension download anchor");
assert.match(downloadTag, /\bdownload\b/);
assert.doesNotMatch(downloadTag, /\bdisabled\b/);
assert.match(lockedSettings, /Download Chrome extension v1\.3\.3/,
  "C1 must use the reviewed v1.3.3 fallback when the setting is empty");
assert.match(lockedSettings, /data-wa-unlock/);
assert.match(lockedSettings, /data-wa-api-save[^>]*disabled/);

const unlockedState = structuredClone(baseState);
unlockedState.secretUnlocked = true;
unlockedState.unlockedApiKey = "fixture-api-key";
const unlockedSettings = renderWhatsappConfig("settings", unlockedState, helpers, t);
assert.match(unlockedSettings, /data-wa-setting="openaiBaseUrl" data-wa-write/);
assert.match(unlockedSettings, /data-wa-api-key data-wa-write/);
assert.match(unlockedSettings, /data-wa-setting="model" data-wa-write/);
assert.match(unlockedSettings, /data-wa-api-test data-wa-write/);
assert.doesNotMatch(unlockedSettings, /fixture-api-key[^>]*localStorage/);

assert.deepEqual(whatsappSettingsPatch({
  openaiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  bossPrompt: "Dedicated prompt",
  apiKey: "must-never-enter-settings"
}), {
  openai_base_url: "https://api.openai.com/v1",
  model: "gpt-4o",
  boss_prompt: "Dedicated prompt"
}, "C2/C4 may write only the two open API columns and boss_prompt; apiKey stays outside the settings whitelist");

const metaState = structuredClone(baseState);
metaState.secretMasks = {
  meta_access_token: "abcd••••wxyz",
  meta_app_secret: "app1••••app2",
  meta_tts_relay_token: "tts1••••tts2"
};
metaState.editingSecret = "meta_access_token";
metaState.secretDrafts = { meta_access_token: "fixture-new-meta-key" };
const metaPanel = renderWhatsappConfig("meta", metaState, helpers, t);
for (const field of ["meta_access_token", "meta_app_secret", "meta_tts_relay_token"]) {
  assert.match(metaPanel, new RegExp(`data-wa-secret="${field}"`), `C3 missing ${field} control`);
}
assert.match(metaPanel, /abcd••••wxyz/);
assert.match(metaPanel, /data-wa-secret-draft="meta_access_token"/);
assert.match(metaPanel, /data-wa-secret-save="meta_access_token"/);

const lockedPrompt = renderWhatsappConfig("bossPrompt", structuredClone(baseState), helpers, t);
assert.match(lockedPrompt, /Encrypted · 16 chars/);
assert.match(lockedPrompt, /data-wa-boss-unlock/);
const unlockedPromptState = structuredClone(baseState);
unlockedPromptState.secretUnlocked = true;
const unlockedPrompt = renderWhatsappConfig("bossPrompt", unlockedPromptState, helpers, t);
assert.match(unlockedPrompt, /data-wa-setting="bossPrompt" data-wa-write/);
assert.match(unlockedPrompt, />Dedicated prompt<\/textarea>/);
assert.match(unlockedPrompt, /local server\.js/);

function fakeClient() {
  const operations = [];
  const edgeBodies = [];
  return {
    operations,
    edgeBodies,
    client: {
      supabaseUrl: "https://supabase.example.test",
      supabaseKey: "fixture-anon-key",
      functions: { async invoke() { return { data: { ok: true }, error: null }; } },
      from(table) {
        const operation = { table };
        operations.push(operation);
        const chain = {
          update(value) { operation.action = "update"; operation.value = value; return chain; },
          insert(value) { operation.action = "insert"; operation.value = value; return chain; },
          delete() { operation.action = "delete"; return chain; },
          eq(column, value) { operation.eq = [column, value]; return chain; },
          select(value) { operation.select = value; return chain; },
          async single() {
            if (table === "wa_replies") return { data: { id: operation.eq[1], ...operation.value }, error: null };
            if (table === "wa_unresolved") return { data: { id: operation.eq[1], ...operation.value }, error: null };
            return { data: { id: operation.eq?.[1] ?? "new", ...operation.value }, error: null };
          }
        };
        return chain;
      }
    },
    async fetchImpl(_url, options) {
      const body = JSON.parse(options.body);
      edgeBodies.push(body);
      const metaSecrets = {
        meta_access_token: "meta••••mask",
        meta_app_secret: "app••••mask",
        meta_tts_relay_token: "tts••••mask"
      };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            openai_api_key: body.action === "unlock" ? "fixture-unlocked-key" : undefined,
            meta_secrets: metaSecrets
          };
        }
      };
    }
  };
}

const fake = fakeClient();
const invalidations = [];
const writer = createLiveWhatsappWriter({
  loadClient: async () => fake.client,
  loadSession: async () => ({ user: { id: "wa-admin" }, access_token: "fixture-user-jwt" }),
  loadCurrentUser: async () => ({ isWaAdmin: true, bizflowMainAccess: true }),
  invalidateTables: async (...tables) => invalidations.push(tables),
  now: () => "2026-08-28T03:30:00.000Z",
  fetchImpl: fake.fetchImpl
});

assert.equal((await writer.unlockSecrets(" password ")).openai_api_key, "fixture-unlocked-key");
await writer.loadSecretMasks("password");
await writer.saveSecrets({ password: "password", newApiKey: "fixture-replacement-key" });
await writer.saveSecrets({ password: "password", metaSecrets: { meta_access_token: " fixture-meta-key " } });
assert.deepEqual(fake.edgeBodies, [
  { action: "unlock", pwd: "password" },
  { action: "meta-masks", pwd: "password" },
  { action: "save-secrets", pwd: "password", newApiKey: "fixture-replacement-key" },
  { action: "save-secrets", pwd: "password", metaSecrets: { meta_access_token: "fixture-meta-key" } }
]);

await writer.skipReply("reply-7");
await writer.resolveUnresolved("unresolved-9");
assert.deepEqual(fake.operations.map(({ table, action, value, eq }) => ({ table, action, value, eq })), [
  {
    table: "wa_replies",
    action: "update",
    value: { delivered_at: "2026-08-28T03:30:00.000Z", delivery_meta: { reason: "manual_skip" } },
    eq: ["id", "reply-7"]
  },
  {
    table: "wa_unresolved",
    action: "update",
    value: { resolved_at: "2026-08-28T03:30:00.000Z" },
    eq: ["id", "unresolved-9"]
  }
]);
assert.deepEqual(invalidations, [["wa_replies"], ["wa_unresolved"]]);

const unauthorized = createLiveWhatsappWriter({
  loadClient: async () => fake.client,
  loadSession: async () => ({ user: { id: "member" }, access_token: "fixture-member-jwt" }),
  loadCurrentUser: async () => ({ isWaAdmin: false, bizflowMainAccess: true }),
  invalidateTables: async () => assert.fail("unauthorized writes must not invalidate"),
  fetchImpl: async () => assert.fail("unauthorized secret actions must not reach wa-unlock")
});
await assert.rejects(() => unauthorized.skipReply("blocked"), /WhatsApp admin context required/);
await assert.rejects(() => unauthorized.resolveUnresolved("blocked"), /WhatsApp admin context required/);
await assert.rejects(() => unauthorized.unlockSecrets("blocked"), /WhatsApp admin context required/);

const [pageSource, configSource, writerSource, snapshotSource, providerSource, migrationSource] = await Promise.all([
  readFile(new URL("../root-site/bizflow/whatsapp.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/whatsapp-config.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-whatsapp-writes.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-admin-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/109_wa_admin_rls_alignment.sql", import.meta.url), "utf8")
]);
assert.match(pageSource, /activityReadOnly:\s*liveMode && currentUser\?\.isWaAdmin !== true/);
assert.match(pageSource, /skipLiveWhatsappReply\(id\)/);
assert.match(pageSource, /resolveLiveWhatsappUnresolved\(id\)/);
assert.match(pageSource, /savedSettings\.bossPromptChars = promptChars/,
  "C4 autosave must keep the saved character count in sync so the page is not left permanently dirty");
assert.doesNotMatch(pageSource, /\.from\(["']wa_(?:replies|unresolved|settings)["']\)/,
  "the page must keep every database write in live-whatsapp-writes.js");
assert.doesNotMatch(pageSource, /localStorage/,
  "API and Meta plaintext state must not enter browser persistence");
assert.match(configSource, /href="\/whatsapp-extension-cloud\.zip" download/);
assert.match(writerSource, /openaiBaseUrl:\s*"openai_base_url"/);
assert.match(writerSource, /model:\s*"model"/);
assert.match(writerSource, /bossPrompt:\s*"boss_prompt"/);
assert.doesNotMatch(writerSource, /apiKey:\s*"openai_api_key"/);
assert.match(snapshotSource, /"boss_prompt"/);
assert.match(snapshotSource, /bossPrompt:\s*asText\(settings\.boss_prompt\)/);
assert.match(snapshotSource, /bossPromptChars:\s*asText\(settings\.boss_prompt\)\.length/);
assert.match(providerSource, /"bossPrompt",\s*"bossPromptChars"/);
for (const email of ["samyung2011@gmail.com", "a1017339632@gmail.com", "1017339632@qq.com"]) {
  assert.match(migrationSource, new RegExp(email.replace(".", "\\.")));
}
assert.match(migrationSource, /FROM public\.employees AS employee/);
assert.match(migrationSource, /employee\.is_admin = true/);
assert.match(migrationSource, /SECURITY DEFINER/);
assert.match(migrationSource, /SET search_path = ''/);

const newCopyKeys = [
  "locked", "unlocked", "baseUrlHint", "apiKeyMemoryHint", "saveApiConfig", "testConnection",
  "waAdminRequired", "adminPasswordPrompt", "setInitialPasswordConfirm", "setInitialPasswordPrompt",
  "wrongPassword", "secretNetworkError", "secretConfigError", "unlockFailed", "setPasswordFailed",
  "confirmApiKeyPassword", "apiPlainSavedOnly", "apiKeySaveFailed", "apiConfigSaved", "invalidBaseUrl",
  "httpsBaseUrlRequired", "customHostWarning", "connectionSucceeded", "emptyApiResponse", "connectionFailed",
  "connectionNetworkError", "secretNotViewed", "cancel", "pasteNewSecret", "saveNewSecret",
  "viewMasksPasswordPrompt", "secretMasksFailed", "secretCannotBeEmpty", "replaceSecretConfirm",
  "confirmSecretPassword", "secretSaveFailed", "secretUpdated", "specialPrompt", "autoSaveOnBlur",
  "cloudSpecialPromptHint"
];
for (const key of newCopyKeys) {
  for (const lang of ["zh", "en", "fr"]) {
    assert.equal(typeof whatsappCopy[lang][key], "string", `${lang}.${key} missing`);
    assert.doesNotMatch(whatsappCopy[lang][key], /老板|老闆|Boss/,
      `${lang}.${key} must use neutral special-chat wording`);
  }
}

console.log("WA fake-buttons 0827 contracts: PASS (C1-C6 real wiring, in-memory secrets, admin gates, i18n, migration 109)");
