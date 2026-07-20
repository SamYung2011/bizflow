import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

const SAFE_WHATSAPP_SETTINGS = Object.freeze([
  "claude_mode", "openai_base_url", "model", "max_replies_per_min", "reply_delay_base",
  "cooldown_minutes", "bot_phone", "bot_name", "boss_chat_name", "daily_report_hour",
  "knowledge", "chargers_prompt", "location_hint_prompt", "latest_ext_version", "wa_outbound_mode",
  "meta_graph_version", "meta_phone_number_id", "meta_waba_id", "meta_tts_enabled", "meta_tts_relay_url",
  "meta_tts_voice_id", "meta_tts_language_boost", "meta_tts_prompt", "updated_at"
]);

const SETTINGS_FIELDS = Object.freeze({
  claudeMode: "claude_mode",
  maxRepliesPerMin: "max_replies_per_min",
  replyDelayBase: "reply_delay_base",
  cooldownMinutes: "cooldown_minutes",
  botPhone: "bot_phone",
  botName: "bot_name",
  bossChatName: "boss_chat_name",
  dailyReportHour: "daily_report_hour",
  knowledge: "knowledge",
  chargersPrompt: "chargers_prompt",
  locationHintPrompt: "location_hint_prompt",
  metaGraphVersion: "meta_graph_version",
  metaPhoneNumberId: "meta_phone_number_id",
  metaWabaId: "meta_waba_id",
  metaTtsEnabled: "meta_tts_enabled",
  metaTtsRelayUrl: "meta_tts_relay_url",
  metaTtsVoiceId: "meta_tts_voice_id",
  metaTtsLanguageBoost: "meta_tts_language_boost",
  metaTtsPrompt: "meta_tts_prompt"
});

const NUMERIC_SETTINGS = new Set([
  "maxRepliesPerMin",
  "replyDelayBase",
  "cooldownMinutes",
  "dailyReportHour"
]);

export function whatsappSettingsPatch(values) {
  const patch = {};
  Object.entries(values ?? {}).forEach(([key, value]) => {
    const column = SETTINGS_FIELDS[key];
    if (!column) return;
    if (NUMERIC_SETTINGS.has(key)) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Invalid numeric WhatsApp setting: ${key}`);
      patch[column] = number;
      return;
    }
    if (key === "metaTtsEnabled") {
      patch[column] = value === true;
      return;
    }
    patch[column] = value == null ? "" : String(value);
  });
  if (!Object.keys(patch).length) throw new Error("WhatsApp settings update requires a supported field");
  if (Object.hasOwn(values ?? {}, "claudeMode") && !["cli", "api", "api_cloud"].includes(patch.claude_mode)) {
    throw new Error("Invalid WhatsApp AI mode");
  }
  return patch;
}

function throwIfError(error) {
  if (error) throw error;
}

export function createLiveWhatsappWriter({
  loadClient = getSupabaseClient,
  loadSession = getSession,
  loadCurrentUser = getCurrentUser,
  invalidateTables = invalidateLiveTables,
  now = () => new Date().toISOString(),
  warn = (...args) => console.warn(...args)
} = {}) {
  async function writeContext() {
    const [client, session, currentUser] = await Promise.all([
      loadClient(),
      loadSession(),
      loadCurrentUser()
    ]);
    const hasBizflowAccess = currentUser?.isBfAdmin === true || currentUser?.bizflowMainAccess === true;
    if (!client || !session?.user || currentUser?.isWaAdmin !== true || !hasBizflowAccess) {
      throw new Error("Authenticated WhatsApp admin context required");
    }
    return { client };
  }

  async function updateSettings(values) {
    const { client } = await writeContext();
    const result = await client.from("wa_settings")
      .update({ ...whatsappSettingsPatch(values), updated_at: now() })
      .eq("id", 1)
      .select(SAFE_WHATSAPP_SETTINGS.join(","))
      .single();
    throwIfError(result.error);
    await invalidateTables("wa_settings");
    Promise.resolve()
      .then(() => client.functions?.invoke?.("wa-ai-trigger", { body: {} }))
      .catch((error) => warn("[live-whatsapp] wa-ai-trigger after settings save failed", error));
    return result.data;
  }

  async function addWhitelist({ kind, value, note }) {
    const { client } = await writeContext();
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) throw new Error("WhatsApp allowlist value is required");
    const result = await client.from("wa_whitelist").insert({
      kind,
      value: normalizedValue,
      note: String(note || "").trim() || null,
      active: true
    }).select("*").single();
    throwIfError(result.error);
    await invalidateTables("wa_whitelist");
    return result.data;
  }

  async function removeWhitelist(id) {
    const { client } = await writeContext();
    const result = await client.from("wa_whitelist").delete().eq("id", id).select("id").single();
    throwIfError(result.error);
    await invalidateTables("wa_whitelist");
    return result.data;
  }

  async function setWhitelistActive(id, active) {
    const { client } = await writeContext();
    const result = await client.from("wa_whitelist")
      .update({ active: active === true })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(result.error);
    await invalidateTables("wa_whitelist");
    return result.data;
  }

  return Object.freeze({ updateSettings, addWhitelist, removeWhitelist, setWhitelistActive });
}

const liveWhatsappWriter = createLiveWhatsappWriter();

export const updateLiveWhatsappSettings = liveWhatsappWriter.updateSettings;
export const addLiveWhatsappWhitelist = liveWhatsappWriter.addWhitelist;
export const removeLiveWhatsappWhitelist = liveWhatsappWriter.removeWhitelist;
export const setLiveWhatsappWhitelistActive = liveWhatsappWriter.setWhitelistActive;
