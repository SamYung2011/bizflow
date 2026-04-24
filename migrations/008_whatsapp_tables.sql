-- 2026-04-24 WhatsApp AI 客服數據搬 Supabase
-- 目標：老板在雲端 bizflow 編輯知識庫 / 白名單 / boss_prompt 立即對本地 server.js 生效
--      所有對話 / 未解決 / 日報 由本地 server.js 寫入 Supabase，老板雲端只讀
--
-- 6 張表：wa_settings / wa_whitelist / wa_messages / wa_unresolved / wa_daily_reports
--       （knowledge 與 boss_prompt 合併進 wa_settings 單行）

-- 1. wa_settings 單行配置（前端編輯 / server.js 啟動時讀）
CREATE TABLE IF NOT EXISTS wa_settings (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 強制單行
  claude_mode       TEXT NOT NULL DEFAULT 'cli',               -- 'cli' | 'api'
  openai_base_url   TEXT DEFAULT 'https://api.openai.com/v1',
  openai_api_key    TEXT,
  model             TEXT DEFAULT 'gpt-4o',
  max_history       INT  DEFAULT 20,
  max_replies_per_min INT DEFAULT 3,
  reply_delay_base  INT  DEFAULT 60,
  cooldown_minutes  INT  DEFAULT 30,
  bot_phone         TEXT,
  boss_chat_name    TEXT,
  daily_report_hour INT  DEFAULT 22,
  system_prompt     TEXT,
  boss_prompt       TEXT,
  knowledge         TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO wa_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. wa_whitelist 白名單 / 客服名單
CREATE TABLE IF NOT EXISTS wa_whitelist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL,                                    -- 'phone' | 'group' | 'group_fuzzy' | 'staff'
  value      TEXT NOT NULL,
  note       TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kind, value)
);

CREATE INDEX IF NOT EXISTS wa_whitelist_kind_idx ON wa_whitelist(kind);

-- 3. wa_messages 對話歷史（server.js 寫入）
CREATE TABLE IF NOT EXISTS wa_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL,
  role        TEXT NOT NULL,                                   -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_messages_customer_idx ON wa_messages(customer_id);
CREATE INDEX IF NOT EXISTS wa_messages_created_idx ON wa_messages(created_at DESC);

-- 4. wa_unresolved 未解決問題
CREATE TABLE IF NOT EXISTS wa_unresolved (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL,
  question    TEXT NOT NULL,
  categories  TEXT[] DEFAULT ARRAY[]::TEXT[],
  resolved_at TIMESTAMPTZ,                                     -- 老闆標記已解決時填
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_unresolved_customer_idx ON wa_unresolved(customer_id);
CREATE INDEX IF NOT EXISTS wa_unresolved_created_idx ON wa_unresolved(created_at DESC);

-- 5. wa_daily_reports 日報（server.js 生成日報後寫入存檔）
CREATE TABLE IF NOT EXISTS wa_daily_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date      DATE NOT NULL UNIQUE,
  content          TEXT NOT NULL,                              -- markdown 日報全文
  unresolved_count INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_daily_reports_date_idx ON wa_daily_reports(report_date DESC);

-- 6. RLS（沿用 authenticated_all）
ALTER TABLE wa_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_settings;
CREATE POLICY "authenticated_all" ON wa_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_whitelist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_whitelist;
CREATE POLICY "authenticated_all" ON wa_whitelist FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_messages;
CREATE POLICY "authenticated_all" ON wa_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_unresolved ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_unresolved;
CREATE POLICY "authenticated_all" ON wa_unresolved FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wa_daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_daily_reports;
CREATE POLICY "authenticated_all" ON wa_daily_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. 服務端寫入許可 —— service_role 默認繞過 RLS，這裡給 anon 也 INSERT 對話 / 未解決 / 日報 的權限
--    （本地 server.js 用 anon key + authenticated 不便配，先給 anon 寫入讓它先能跑起來；後續換成 service_role 更嚴格）
DROP POLICY IF EXISTS "anon_insert_messages" ON wa_messages;
CREATE POLICY "anon_insert_messages" ON wa_messages FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon_insert_unresolved" ON wa_unresolved;
CREATE POLICY "anon_insert_unresolved" ON wa_unresolved FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon_insert_reports" ON wa_daily_reports;
CREATE POLICY "anon_insert_reports" ON wa_daily_reports FOR INSERT TO anon WITH CHECK (true);

-- 讓 anon 也能讀 settings / whitelist / knowledge（本地 server.js 啟動時拉配置）
DROP POLICY IF EXISTS "anon_read_settings" ON wa_settings;
CREATE POLICY "anon_read_settings" ON wa_settings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon_read_whitelist" ON wa_whitelist;
CREATE POLICY "anon_read_whitelist" ON wa_whitelist FOR SELECT TO anon USING (true);
