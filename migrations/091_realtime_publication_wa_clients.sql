-- 091: WA-live-2 — 機器人在線態改由 wa_clients 心跳驱动,加入 realtime publication
-- 2026-07-20 由小屿在生产库执行,事件受既有 RLS 过滤
ALTER PUBLICATION supabase_realtime
ADD TABLE public.wa_clients;
