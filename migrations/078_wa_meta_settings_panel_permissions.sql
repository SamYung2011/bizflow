-- 078_wa_meta_settings_panel_permissions.sql
-- WhatsApp Meta Cloud API settings panel:
-- expose non-secret Meta config columns to the existing wa_settings UI,
-- while keeping token/app-secret fields locked behind wa-unlock service_role.

-- Non-secret fields used by the Meta settings panel.
GRANT SELECT (
  wa_outbound_mode,
  meta_graph_version,
  meta_phone_number_id,
  meta_waba_id,
  meta_webhook_verify_token,
  meta_tts_enabled,
  meta_tts_relay_url,
  meta_tts_voice_id,
  meta_tts_language_boost,
  meta_tts_prompt
) ON wa_settings TO anon, authenticated;

GRANT UPDATE (
  wa_outbound_mode,
  meta_graph_version,
  meta_phone_number_id,
  meta_waba_id,
  meta_webhook_verify_token,
  meta_tts_enabled,
  meta_tts_relay_url,
  meta_tts_voice_id,
  meta_tts_language_boost,
  meta_tts_prompt
) ON wa_settings TO anon, authenticated;

-- Secret fields must not be selected or updated directly from browser clients.
-- They are read/updated only by supabase/functions/wa-unlock via service_role.
REVOKE SELECT (
  meta_access_token,
  meta_app_secret,
  meta_tts_relay_token
) ON wa_settings FROM anon, authenticated;

REVOKE UPDATE (
  meta_access_token,
  meta_app_secret,
  meta_tts_relay_token
) ON wa_settings FROM anon, authenticated;
