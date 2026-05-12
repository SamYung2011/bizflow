-- 2026-05-12 wa_messages 加 anon SELECT policy
-- 跟 wa_logs / wa_replies 的 policy 對齊（這倆都已有 anon SELECT）
-- bizflow 前端登錄走 authenticated 本來能讀，但對齊更穩；也讓未登入工具腳本能 GET
-- 注意：本 policy 已於 2026-05-12 直接 psql 加到生產 DB，此 migration 為補檔（DROP IF EXISTS 保證冪等）

DROP POLICY IF EXISTS "anon_read_messages" ON wa_messages;
CREATE POLICY "anon_read_messages" ON wa_messages FOR SELECT TO anon USING (true);
