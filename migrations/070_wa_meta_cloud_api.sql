-- 070_wa_meta_cloud_api.sql
-- WhatsApp 出站接 Meta 官方 Cloud API（替代 Chrome 扩展自己发）
-- 2026-05-22
--
-- 背景：
-- 之前云端架构 = wa-ai-trigger 写 wa_replies 表 → Chrome extension (chrome-extension-cloud) 拉走自己用 WhatsApp Web 发。
-- 现在切到 Meta 官方 Cloud API：wa-ai-trigger 生成回复后**直接 POST 到 Meta Graph API**，脱离 Chrome 扩展依赖。
-- 入站方向另外新建 wa-meta-webhook edge function 接 Meta 推送的客户来信。
--
-- wa_outbound_mode = 'extension' (默认) → 现有行为不变（写 wa_replies 让扩展发）
-- wa_outbound_mode = 'meta-cloud' → 新行为：wa-ai-trigger 直接 POST graph.facebook.com 出站
--
-- 群聊：Meta API 不支持，meta-cloud 模式下群聊永远回退 wa_replies（扩展处理）
-- 24h 客服窗口：客服场景 AI 永远在客户来信窗口内回复 → 不需要 template

ALTER TABLE wa_settings
  ADD COLUMN IF NOT EXISTS wa_outbound_mode       TEXT NOT NULL DEFAULT 'extension',
  ADD COLUMN IF NOT EXISTS meta_graph_version     TEXT DEFAULT 'v25.0',
  ADD COLUMN IF NOT EXISTS meta_phone_number_id   TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id           TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token      TEXT,
  ADD COLUMN IF NOT EXISTS meta_webhook_verify_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret        TEXT;

-- wa_outbound_mode 只允许两个值
ALTER TABLE wa_settings
  DROP CONSTRAINT IF EXISTS wa_settings_outbound_mode_check;
ALTER TABLE wa_settings
  ADD CONSTRAINT wa_settings_outbound_mode_check
  CHECK (wa_outbound_mode IN ('extension', 'meta-cloud'));

-- 注：meta_access_token / meta_app_secret 等敏感字段
-- bizflow UI 显示时要遮罩（参考 wa_settings.openai_api_key 现有处理）
COMMENT ON COLUMN wa_settings.meta_access_token IS 'Meta System User Permanent Token. UI 显示遮罩，提交时检测是否为 placeholder 决定是否更新。';
COMMENT ON COLUMN wa_settings.meta_app_secret IS 'Meta App Secret，用于 webhook X-Hub-Signature-256 校验。UI 显示遮罩。';
COMMENT ON COLUMN wa_settings.meta_webhook_verify_token IS 'Meta webhook GET 验证用的 verify token，bizflow 自己定，跟 Meta Developer 后台 webhook 配置一致。';
