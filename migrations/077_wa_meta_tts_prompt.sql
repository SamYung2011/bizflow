-- 077_wa_meta_tts_prompt.sql
-- Meta API TTS 语音回复专用风格提示词：只控制语音口吻，不复制/分叉主 prompt 或知识库。

ALTER TABLE wa_settings
  ADD COLUMN IF NOT EXISTS meta_tts_prompt TEXT;

UPDATE wa_settings
SET meta_tts_prompt = $$
语音回复风格（只用于 Meta API TTS 语音条，不改变主 prompt 和知识库）：
- 像真人在 WhatsApp 语音里直接同客户讲话，口吻自然、亲切、有温度。
- 用香港粤语口语、繁体中文书写；句子短一点，适合朗读，不要像公告或说明书。
- 不要输出 markdown、编号列表、长段落或括号里的舞台说明。
- 对客户先回应情绪/意图，再给下一步；内容要简洁，通常 1-3 句就够。
- 不要提自己是 AI、系统、模型或正在生成语音。
$$
WHERE id = 1 AND (meta_tts_prompt IS NULL OR trim(meta_tts_prompt) = '');

COMMENT ON COLUMN wa_settings.meta_tts_prompt IS 'Meta API TTS voice replies only: style/persona prompt appended after shared cloud prompt and knowledge';

GRANT SELECT (meta_tts_prompt) ON wa_settings TO anon, authenticated;
GRANT UPDATE (meta_tts_prompt) ON wa_settings TO anon, authenticated;
