export const WHATSAPP_SNAPSHOT = "whatsapp.json";

export const WHATSAPP_SNAPSHOT_TABLES = Object.freeze([
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

// WA-live-1 intentionally subscribes only to the operational rows that need
// immediate UI feedback. Settings/allowlist writes invalidate their own cache;
// clients and daily reports stay on the lower-churn IDB/SWR path.
export const WHATSAPP_REALTIME_TABLES = Object.freeze([
  "wa_messages",
  "wa_replies",
  "wa_unresolved",
  "wa_logs",
  "wa_heartbeat"
]);
