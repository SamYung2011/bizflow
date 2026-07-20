import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { whatsappCopy } from "../root-site/bizflow/whatsapp-i18n.js";
import {
  WHATSAPP_REALTIME_TABLES,
  WHATSAPP_SNAPSHOT_TABLES
} from "../root-site/data/live-whatsapp-contract.js";
import {
  createLiveWhatsappWriter,
  whatsappSettingsPatch
} from "../root-site/data/live-whatsapp-writes.js";

assert.deepEqual(WHATSAPP_REALTIME_TABLES, [
  "wa_messages",
  "wa_replies",
  "wa_unresolved",
  "wa_logs",
  "wa_heartbeat"
]);
assert.deepEqual(WHATSAPP_SNAPSHOT_TABLES, [
  "wa_settings",
  "wa_whitelist",
  "wa_clients",
  "wa_heartbeat",
  "wa_messages",
  "wa_replies",
  "wa_unresolved",
  "wa_daily_reports",
  "wa_logs"
]);

assert.deepEqual(whatsappSettingsPatch({
  claudeMode: "api",
  replyDelayBase: "5",
  metaTtsEnabled: false,
  metaTtsPrompt: "voice",
  unsupported: "ignored"
}), {
  claude_mode: "api",
  reply_delay_base: 5,
  meta_tts_enabled: false,
  meta_tts_prompt: "voice"
});
assert.throws(() => whatsappSettingsPatch({ claudeMode: "broken" }), /Invalid WhatsApp AI mode/);
assert.throws(() => whatsappSettingsPatch({ replyDelayBase: "NaN" }), /Invalid numeric WhatsApp setting/);

function fakeClient() {
  const operations = [];
  const functions = [];
  return {
    operations,
    functions,
    client: {
      functions: {
        async invoke(name) {
          functions.push(name);
          return { data: { ok: true }, error: null };
        }
      },
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
            if (table === "wa_settings") return { data: { id: 1 }, error: null };
            if (operation.action === "insert") return { data: { id: "allow-new", ...operation.value }, error: null };
            return { data: { id: operation.eq?.[1], active: operation.value?.active }, error: null };
          }
        };
        return chain;
      }
    }
  };
}

const fake = fakeClient();
const invalidations = [];
const writer = createLiveWhatsappWriter({
  loadClient: async () => fake.client,
  loadSession: async () => ({ user: { id: "admin-user" } }),
  loadCurrentUser: async () => ({ isWaAdmin: true, bizflowMainAccess: true }),
  invalidateTables: async (...tables) => invalidations.push(tables),
  now: () => "2026-07-20T12:34:56.000Z"
});

await writer.updateSettings({ botName: "Support", dailyReportHour: "8" });
assert.deepEqual(fake.operations[0].eq, ["id", 1], "wa_settings must only update the protected singleton row");
assert.equal(fake.operations[0].action, "update");
assert.deepEqual(fake.operations[0].value, {
  bot_name: "Support",
  daily_report_hour: 8,
  updated_at: "2026-07-20T12:34:56.000Z"
});
assert.equal(Object.keys(fake.operations[0].value).some((key) => /token|secret|api_key|password/i.test(key)), false);
await Promise.resolve();
assert.deepEqual(fake.functions, ["wa-ai-trigger"]);

await writer.addWhitelist({ kind: "phone", value: " 85200000000 ", note: " test " });
await writer.setWhitelistActive("allow-new", false);
await writer.removeWhitelist("allow-new");
assert.deepEqual(fake.operations.slice(1).map(({ table, action }) => [table, action]), [
  ["wa_whitelist", "insert"],
  ["wa_whitelist", "update"],
  ["wa_whitelist", "delete"]
]);
assert.deepEqual(invalidations, [
  ["wa_settings"],
  ["wa_whitelist"],
  ["wa_whitelist"],
  ["wa_whitelist"]
]);

const unauthorized = createLiveWhatsappWriter({
  loadClient: async () => fake.client,
  loadSession: async () => ({ user: { id: "member-user" } }),
  loadCurrentUser: async () => ({ isWaAdmin: false, bizflowMainAccess: true }),
  invalidateTables: async () => assert.fail("unauthorized writes must not invalidate")
});
await assert.rejects(() => unauthorized.updateSettings({ botName: "blocked" }), /WhatsApp admin context required/);

const [providerSource, liveBuilderSource, pageSource, migrationSource] = await Promise.all([
  readFile(new URL("../root-site/data/provider.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/data/live-admin-snapshots.js", import.meta.url), "utf8"),
  readFile(new URL("../root-site/bizflow/whatsapp.js", import.meta.url), "utf8"),
  readFile(new URL("../migrations/090_realtime_publication_wa_live.sql", import.meta.url), "utf8")
]);
const fetchSnapshotSource = providerSource.slice(providerSource.indexOf("async function fetchSnapshot"), providerSource.indexOf("const mock"));
const whatsappProvider = providerSource.slice(providerSource.indexOf("export async function getWhatsappData"), providerSource.indexOf("function cloneOcppValue"));
assert.match(fetchSnapshotSource, /getLiveSnapshot\(snapshot\)/, "the established generic loader must still prefer live snapshots");
assert.match(whatsappProvider, /loadR11Snapshot\(WHATSAPP_SNAPSHOT_URL, "whatsapp"\)/, "keep the established R11 fallback path");
assert.match(liveBuilderSource, /export async function buildWhatsappSnapshot/);
WHATSAPP_SNAPSHOT_TABLES.filter((table) => table !== "wa_settings").forEach((table) => {
  assert.match(liveBuilderSource, new RegExp(`allRows\\("${table}"`));
});
assert.match(pageSource, /attachLiveSnapshotRefresh/);
assert.match(pageSource, /currentUser\?\.isWaAdmin !== true/);
assert.match(pageSource, /updateLiveWhatsappSettings/);
assert.match(pageSource, /addLiveWhatsappWhitelist/);
assert.match(pageSource, /t\("robotStatus"\)/);
assert.match(pageSource, /t\("lastHeartbeat"\)/);
assert.match(pageSource, /state\.heartbeat\.lastHeartbeatAt/);
assert.doesNotMatch(pageSource, /snapshotStatus|snapshotAt|lastSyncedAt/);
assert.doesNotMatch(pageSource, /from\(["']wa_settings["']\)/, "the view must keep DB writes in the focused writer module");
WHATSAPP_REALTIME_TABLES.forEach((table) => assert.match(migrationSource, new RegExp(`public\\.${table}`)));
assert.doesNotMatch(migrationSource, /wa_settings|wa_whitelist|wa_clients|wa_daily_reports/);

const liveCopyKeys = ["robotStatus", "lastHeartbeat", "liveChange", "saveLive", "savedLive", "savingLive", "writeFailed", "removeLiveConfirm"];
liveCopyKeys.forEach((key) => {
  ["zh", "en", "fr"].forEach((lang) => assert.equal(typeof whatsappCopy[lang][key], "string", `${lang}.${key} missing`));
});

console.log("WA live contracts: PASS (existing live flow, five-table realtime, admin writes, heartbeat copy, i18n)");
