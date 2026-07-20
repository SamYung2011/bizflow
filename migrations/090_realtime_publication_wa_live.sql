-- 090: WA-live-1 — WhatsApp 板块接活表,五张展示表加入 realtime publication
-- 2026-07-20 由小屿在生产库执行(变更前 publication 无任何 wa_* 表),事件受既有 RLS(bizflow_main_access)过滤
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.wa_messages,
  public.wa_replies,
  public.wa_unresolved,
  public.wa_logs,
  public.wa_heartbeat;
