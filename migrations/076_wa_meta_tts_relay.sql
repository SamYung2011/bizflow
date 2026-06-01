-- 076_wa_meta_tts_relay.sql
-- Meta API 通道：AI 文本回复后优先走 MiniMax TTS relay 发 WhatsApp 语音条。
-- relay token 属敏感值，前端不读取；Edge Function 用 service_role 读取。

ALTER TABLE wa_settings
  ADD COLUMN IF NOT EXISTS meta_tts_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS meta_tts_relay_url TEXT,
  ADD COLUMN IF NOT EXISTS meta_tts_relay_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_tts_voice_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_tts_language_boost TEXT;

COMMENT ON COLUMN wa_settings.meta_tts_enabled IS 'Meta channel 是否优先使用 MiniMax TTS relay 发送 WhatsApp 语音条';
COMMENT ON COLUMN wa_settings.meta_tts_relay_url IS '内部 TTS relay URL，例如 http://wa-tts-relay:8091/send-tts';
COMMENT ON COLUMN wa_settings.meta_tts_relay_token IS 'TTS relay shared token，敏感值，仅 Edge Function/service_role 使用';
COMMENT ON COLUMN wa_settings.meta_tts_voice_id IS 'MiniMax voice_id override，可空则 relay 默认值';
COMMENT ON COLUMN wa_settings.meta_tts_language_boost IS 'MiniMax language_boost override，可空则 relay 默认值';
