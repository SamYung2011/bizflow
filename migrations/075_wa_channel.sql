-- 075_wa_channel.sql
-- WhatsApp 消息按 channel 分流：extension（Chrome 扩展通道）/ meta（Meta Cloud API 通道）
-- 2026-06-01
--
-- 背景：之前用 wa_outbound_mode 做全局开关（一刀切 extension 或 meta-cloud），但实际客户来源已经决定了 channel
-- （+86 Meta 官方号客户 = meta 通道、客服公共号客户 = extension 通道），全局开关粒度不对。
--
-- 新方案：每条消息上带 channel 字段，根据 channel 决定后续路径：
-- channel='meta'：跳过 7s 合并窗口、跳过 60s 真人抢答延迟、不分段、整段 POST Meta API、log 前缀 [Meta API]
-- channel='extension'：保持现有行为（合并 7s / 等 60s / 200 字分段 / 写 wa_replies 给扩展拉）
--
-- 旧数据 channel=NULL 视为 'extension'（兼容性，不强制 backfill）
-- wa_outbound_mode 字段保留但代码不再读取，标记 deprecated

ALTER TABLE wa_messages         ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE wa_replies          ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE wa_logs             ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE wa_pending_replies  ADD COLUMN IF NOT EXISTS channel TEXT;

-- channel 只允许两个值（NULL 兼容旧数据）
ALTER TABLE wa_messages         DROP CONSTRAINT IF EXISTS wa_messages_channel_check;
ALTER TABLE wa_messages         ADD  CONSTRAINT wa_messages_channel_check CHECK (channel IS NULL OR channel IN ('extension', 'meta'));
ALTER TABLE wa_replies          DROP CONSTRAINT IF EXISTS wa_replies_channel_check;
ALTER TABLE wa_replies          ADD  CONSTRAINT wa_replies_channel_check  CHECK (channel IS NULL OR channel IN ('extension', 'meta'));
ALTER TABLE wa_logs             DROP CONSTRAINT IF EXISTS wa_logs_channel_check;
ALTER TABLE wa_logs             ADD  CONSTRAINT wa_logs_channel_check     CHECK (channel IS NULL OR channel IN ('extension', 'meta'));
ALTER TABLE wa_pending_replies  DROP CONSTRAINT IF EXISTS wa_pending_replies_channel_check;
ALTER TABLE wa_pending_replies  ADD  CONSTRAINT wa_pending_replies_channel_check CHECK (channel IS NULL OR channel IN ('extension', 'meta'));

-- dashboard 按 channel 过滤查询
CREATE INDEX IF NOT EXISTS wa_messages_channel_idx        ON wa_messages(channel);
CREATE INDEX IF NOT EXISTS wa_replies_channel_idx         ON wa_replies(channel);
CREATE INDEX IF NOT EXISTS wa_logs_channel_idx            ON wa_logs(channel);
CREATE INDEX IF NOT EXISTS wa_pending_replies_channel_idx ON wa_pending_replies(channel);

-- hot paths after channel split
CREATE INDEX IF NOT EXISTS wa_messages_channel_customer_created_idx
  ON wa_messages(channel, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wa_replies_channel_undelivered_idx
  ON wa_replies(channel, created_at ASC)
  WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS wa_logs_channel_created_idx
  ON wa_logs(channel, created_at DESC);

COMMENT ON COLUMN wa_messages.channel        IS 'extension（Chrome 扩展）/ meta（Meta Cloud API）。NULL 视为 extension（兼容旧数据）';
COMMENT ON COLUMN wa_replies.channel         IS 'extension / meta';
COMMENT ON COLUMN wa_logs.channel            IS 'extension / meta';
COMMENT ON COLUMN wa_pending_replies.channel IS 'extension / meta';

-- 标记 wa_outbound_mode 字段为 deprecated（保留不 drop，避免 edge function 部署不同步时报错）
COMMENT ON COLUMN wa_settings.wa_outbound_mode IS 'DEPRECATED 2026-06-01：不再使用全局开关。每条消息按 channel 字段决定出站路径。代码不再读取此字段。';
