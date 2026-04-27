-- 2026-04-27 WhatsApp server.js 啟動/重要日誌雲端同步
-- 目標：bizflow WhatsApp tab 加「日誌」子 tab，看 server.js 啟動 / 配置 / Supabase 同步 / 重啟 / 錯誤 等狀態
-- 推送策略（server.js 端白名單 + 內容過濾）：
--   推：啟動 / 配置 / Supabase / 恢復 / 模式 / 知識庫 / 重啟 / 清掃 / 錯誤
--   不推：老板 / 老板會話 / 老板工具（隱私）+ 高頻客戶處理日誌（歷史/收到/跳過/退避/生成/回復入隊/等待/限流/未解決/圖片/日報/操作）
--   額外：tag=錯誤 但 message 含「老板」也跳過
-- 保留 24 小時，server.js 端每小時 DELETE 一次 created_at < NOW - 24h

CREATE TABLE IF NOT EXISTS wa_logs (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  category    TEXT NOT NULL,                         -- 對應 server.js log() 的 tag
  message     TEXT NOT NULL                          -- 整行內容（不含時間戳，UI 用 created_at）
);

CREATE INDEX IF NOT EXISTS wa_logs_created_idx ON wa_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS wa_logs_category_idx ON wa_logs(category);

ALTER TABLE wa_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON wa_logs;
CREATE POLICY "authenticated_all" ON wa_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- anon SELECT（給未登入訪問或 server.js 自己讀，可選）
DROP POLICY IF EXISTS "anon_read_logs" ON wa_logs;
CREATE POLICY "anon_read_logs" ON wa_logs FOR SELECT TO anon USING (true);

-- anon INSERT（server.js 用 anon key 寫日誌）
DROP POLICY IF EXISTS "anon_insert_logs" ON wa_logs;
CREATE POLICY "anon_insert_logs" ON wa_logs FOR INSERT TO anon WITH CHECK (true);

-- anon DELETE（server.js 每小時清理 24h 前舊日誌；DELETE 不允許 .eq * 或無條件，用 created_at filter）
DROP POLICY IF EXISTS "anon_delete_logs" ON wa_logs;
CREATE POLICY "anon_delete_logs" ON wa_logs FOR DELETE TO anon USING (true);
