-- 115: 标量 jsonb RPC 标 VOLATILE，挡住 PostgREST 包装把函数算两遍。
-- PostgREST v14 对 RETURNS jsonb 的 RPC 生成 LATERAL (SELECT fn() pgrst_scalar) + count(_postgrest_t)
-- + json_agg(_postgrest_t.pgrst_scalar)：子查询被拉平后函数表达式出现两处、STABLE 函数各算一遍
--（生产实测 team_task_page 1.2s → 2.7s，home/customer/warranty/order/unread 同款）。标 VOLATILE 后
-- 规划器不拉平、CTE 不内联，只算一遍。函数体、权限、search_path、客户端全部不动。
-- 代价：PostgREST 对 VOLATILE 走读写事务、不允许 GET 调（本站全 POST）。Safe to rerun。
BEGIN;

-- 第一段：任务页链路（煊煊已拍）
ALTER FUNCTION public.bizflow_team_task_page(uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz) VOLATILE;
ALTER FUNCTION public.bizflow_unread_summary(uuid, timestamptz, timestamptz, timestamptz, text, timestamptz) VOLATILE;

-- 第二段：同款毛病的其它页（灌库前煊煊拍；不批就只灌第一段）
ALTER FUNCTION public.bizflow_home_dashboard(uuid) VOLATILE;
ALTER FUNCTION public.bizflow_customer_page(text, text, text, date, date, text, integer, integer) VOLATILE;
ALTER FUNCTION public.bizflow_warranty_page(text, text, date, date, integer, integer) VOLATILE;
ALTER FUNCTION public.bizflow_order_page(text, text, text, date, date, text, integer, integer) VOLATILE;
ALTER FUNCTION public.bizflow_order_revenue(text) VOLATILE;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 回滚（留档不执行）：同一批 ALTER FUNCTION ... STABLE; NOTIFY pgrst, 'reload schema';
