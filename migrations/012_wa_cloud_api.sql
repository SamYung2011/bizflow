-- 2026-04-27 WhatsApp 雲端 API 模式（api_cloud）
-- 目標：把 server.js 的人機協作 / 抢答 / 限流 / 冷卻邏輯全部搬到 Supabase Edge Functions + pg_cron
-- 老板裝 chrome-extension-cloud 直接 POST Supabase URL，不需要本地 server.js
-- 老板獨立邏輯（Boss Prompt / 日報）雲端**不支持**，bizflow UI 已標註
--
-- 4 張新表：
--   wa_pending_replies — 排队等真人 60s 抢答的消息
--   wa_replies         — AI 生成的回復，等扩展短轮询拉取发送
--   wa_processed_messages — 幂等去重（防扩展重发）
--   wa_cooldowns       — 真人接手后的 chat 冷卻

-- 1. wa_pending_replies
CREATE TABLE IF NOT EXISTS wa_pending_replies (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   TEXT NOT NULL,                                          -- 私聊：手機號 / 群聊：群名 hash 或 chatId
  chat_name     TEXT,                                                   -- WhatsApp 顯示的對話名
  is_group      BOOLEAN NOT NULL DEFAULT FALSE,
  sender        TEXT,                                                   -- 群聊時跟 customer_id 不同（誰在群裡發的）
  content       TEXT NOT NULL,
  visible_context JSONB,                                                -- 收到時可見的最近對話（給群聊 AI 判斷用）
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending',                        -- pending / processing / replied / cancelled
  cancelled_reason TEXT,                                                -- staff_took_over / cooldown / muted / rate_limit / no_reply_decision
  replied_at    TIMESTAMPTZ,
  reply_id      BIGINT,                                                 -- FK wa_replies(id)，AI 回完後關聯
  error         TEXT
);

CREATE INDEX IF NOT EXISTS wa_pending_status_received_idx ON wa_pending_replies(status, received_at);
CREATE INDEX IF NOT EXISTS wa_pending_customer_idx ON wa_pending_replies(customer_id);
CREATE INDEX IF NOT EXISTS wa_pending_chat_name_idx ON wa_pending_replies(chat_name);

-- 2. wa_replies — AI 生成的回復隊列（Chrome 扩展短轮询拉取）
CREATE TABLE IF NOT EXISTS wa_replies (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   TEXT NOT NULL,
  chat_name     TEXT,
  is_group      BOOLEAN NOT NULL DEFAULT FALSE,
  segments      JSONB NOT NULL,                                         -- [{type:'text',content:'...'},{type:'image',filename:'...'}]
  pending_id    BIGINT REFERENCES wa_pending_replies(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ,                                            -- NULL = 扩展還沒拉走 / NOT NULL = 已發送
  delivery_meta JSONB                                                   -- 扩展上報的發送結果（成功 / 失敗原因）
);

CREATE INDEX IF NOT EXISTS wa_replies_undelivered_idx ON wa_replies(customer_id, delivered_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS wa_replies_created_idx ON wa_replies(created_at DESC);

-- 3. wa_processed_messages — 幂等去重
-- Chrome 扩展為每條消息生成 msg_id（建議: customer_id + sha1(content) + Math.floor(timestamp/10000)），重複 POST 直接拒
CREATE TABLE IF NOT EXISTS wa_processed_messages (
  msg_id        TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_processed_at_idx ON wa_processed_messages(processed_at);

-- 4. wa_cooldowns — 真人接手冷卻（chat 級別，不是個人）
CREATE TABLE IF NOT EXISTS wa_cooldowns (
  chat_id       TEXT PRIMARY KEY,                                       -- 私聊 customer_id / 群聊 chat_name
  is_group      BOOLEAN NOT NULL DEFAULT FALSE,
  cooled_until  TIMESTAMPTZ NOT NULL,
  triggered_by  TEXT,                                                   -- 哪個 staff phone 觸發的
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_cooldowns_until_idx ON wa_cooldowns(cooled_until);

-- 5. RLS
ALTER TABLE wa_pending_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_pending_replies;
CREATE POLICY "authenticated_all" ON wa_pending_replies FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_replies;
CREATE POLICY "authenticated_all" ON wa_replies FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_processed_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_processed_messages;
CREATE POLICY "authenticated_all" ON wa_processed_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_cooldowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_cooldowns;
CREATE POLICY "authenticated_all" ON wa_cooldowns FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. anon 權限：Chrome 扩展用 anon key 直接訪問 Edge Function（Function 內部用 service_role 訪問 DB）
-- 但如果想讓 Chrome 扩展直連 PostgREST 取 wa_replies / 報 staff_took_over，也給 anon 開部分權限：
--   Chrome 扩展 GET wa_replies WHERE customer_id=? AND delivered_at IS NULL — anon SELECT
--   Chrome 扩展 PATCH wa_replies SET delivered_at=NOW() — anon UPDATE
-- 暫時只開 SELECT/UPDATE wa_replies（直連模式做 fallback）。其他都走 Edge Function（service_role）

DROP POLICY IF EXISTS "anon_read_replies" ON wa_replies;
CREATE POLICY "anon_read_replies" ON wa_replies FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon_mark_delivered" ON wa_replies;
CREATE POLICY "anon_mark_delivered" ON wa_replies FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 7. 自動清理 wa_processed_messages 超過 24h 的記錄（pg_cron 啟用後另外設）
-- 暫時手動 / 後續加 cron 任務
