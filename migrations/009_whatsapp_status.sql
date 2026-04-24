-- 2026-04-24 WhatsApp 狀態檢測 + 管理員密碼
-- wa_heartbeat：本地 server.js 每 30 秒 UPSERT 心跳 + 狀態
-- wa_settings：加 admin_password（改 API key / boss_prompt / model / base_url 要輸）

-- 1. 心跳表（單行）
CREATE TABLE IF NOT EXISTS wa_heartbeat (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_heartbeat_at  TIMESTAMPTZ,
  status             TEXT,                    -- 'starting' | 'running' | 'cli_error' | 'api_error' | 'no_network'
  error_message      TEXT,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO wa_heartbeat (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE wa_heartbeat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_heartbeat;
CREATE POLICY "authenticated_all" ON wa_heartbeat FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_read_heartbeat" ON wa_heartbeat;
CREATE POLICY "anon_read_heartbeat" ON wa_heartbeat FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon_update_heartbeat" ON wa_heartbeat;
CREATE POLICY "anon_update_heartbeat" ON wa_heartbeat FOR UPDATE TO anon USING (id = 1) WITH CHECK (id = 1);
DROP POLICY IF EXISTS "anon_insert_heartbeat" ON wa_heartbeat;
CREATE POLICY "anon_insert_heartbeat" ON wa_heartbeat FOR INSERT TO anon WITH CHECK (id = 1);

-- 2. wa_settings 加管理員密碼
ALTER TABLE wa_settings ADD COLUMN IF NOT EXISTS admin_password TEXT;
