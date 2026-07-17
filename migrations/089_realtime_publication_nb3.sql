-- 089: NB3 实时推送 — 将发票与北上三表加入 realtime publication
-- 2026-07-17 由小屿在生产库执行(变更前 publication 含 11 张 team/org 表),事件仍受 RLS 过滤
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.invoices,
  public.northbound_records,
  public.northbound_statuses;
