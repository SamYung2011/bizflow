-- 2026-04-27 WhatsApp 雲端版扩展心跳：bizflow 端顯示有多少個雲端客戶端在線 + 版本檢查
-- 諮詢用，不阻塞重複啟動。老板登 bizflow 看「目前在線 N 個雲端客戶端」就知道有沒有人在跑

CREATE TABLE IF NOT EXISTS wa_clients (
  client_id   TEXT PRIMARY KEY,                                      -- 扩展啟動時生成的隨機 ID（localStorage 持久化）
  mode        TEXT NOT NULL DEFAULT 'cloud',                         -- cloud / local（預留，目前只雲端版上報）
  version     TEXT,                                                  -- 扩展 manifest version，比較落後版本提示更新
  ua          TEXT,                                                  -- user agent 簡寫（哪台電腦/瀏覽器，方便辨認）
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_clients_last_seen_idx ON wa_clients(last_seen DESC);

ALTER TABLE wa_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_clients;
CREATE POLICY "authenticated_all" ON wa_clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- anon 心跳寫入 + 讀取（bizflow 也用 anon 讀，但 bizflow 用戶是 authenticated 走上面 policy）
DROP POLICY IF EXISTS "anon_select_clients" ON wa_clients;
CREATE POLICY "anon_select_clients" ON wa_clients FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon_insert_clients" ON wa_clients;
CREATE POLICY "anon_insert_clients" ON wa_clients FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_clients" ON wa_clients;
CREATE POLICY "anon_update_clients" ON wa_clients FOR UPDATE TO anon USING (true) WITH CHECK (true);
