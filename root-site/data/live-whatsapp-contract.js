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

// Settings/allowlist writes invalidate their own cache and daily reports stay
// on the lower-churn IDB/SWR path. WA-live-2 adds client heartbeats so the
// current cloud bot state updates while the page remains open.
export const WHATSAPP_REALTIME_TABLES = Object.freeze([
  "wa_messages",
  "wa_replies",
  "wa_unresolved",
  "wa_logs",
  "wa_heartbeat",
  "wa_clients"
]);
