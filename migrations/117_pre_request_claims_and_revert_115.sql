-- 117: (1) 回退 115：115 认为 PostgREST 包装把标量 RPC 算两遍、把 7 个函数标 VOLATILE，
--     那是按旧版 PostgREST 写法复现出来的误判——v14.8 的真实语句（pg_stat_statements 原文）
--     page_total 是常量、没有 count(_postgrest_t)，不算两遍。灌了没快。这里改回 STABLE，注释留档。
-- (2) 真凶：PostgREST v14 只设 request.jwt.claims，auth.uid() 的短路支 request.jwt.claim.sub
--     永远落空，每次判权都 ::jsonb 解析整包 JWT（一趟任务页 RPC 几千次 ≈ 1s；同会话对照
--     1.9s vs 0.9s）。新建 bizflow_pre_request()，由 PostgREST db-pre-request 每请求调一次，
--     把 sub/role/email 解析一次写成事务级 GUC。请求结束自动清；没 claims（anon）就写空串，
--     auth.* 的 nullif('') 会照旧退回 claims 支得到 NULL。配置 PGRST_DB_PRE_REQUEST 另行处理。
-- Safe to rerun.
BEGIN;

ALTER FUNCTION public.bizflow_team_task_page(uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz) STABLE;
ALTER FUNCTION public.bizflow_unread_summary(uuid, timestamptz, timestamptz, timestamptz, text, timestamptz) STABLE;
ALTER FUNCTION public.bizflow_home_dashboard(uuid) STABLE;
ALTER FUNCTION public.bizflow_customer_page(text, text, text, date, date, text, integer, integer) STABLE;
ALTER FUNCTION public.bizflow_warranty_page(text, text, date, date, integer, integer) STABLE;
ALTER FUNCTION public.bizflow_order_page(text, text, text, date, date, text, integer, integer) STABLE;
ALTER FUNCTION public.bizflow_order_revenue(text) STABLE;

CREATE OR REPLACE FUNCTION public.bizflow_pre_request()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  claims jsonb;
BEGIN
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    claims := NULL;   -- 坏 JSON 也不能让请求炸；退回 auth.* 原路
  END;
  PERFORM set_config('request.jwt.claim.sub',   coalesce(claims ->> 'sub',   ''), true);
  PERFORM set_config('request.jwt.claim.role',  coalesce(claims ->> 'role',  ''), true);
  PERFORM set_config('request.jwt.claim.email', coalesce(claims ->> 'email', ''), true);
END;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bizflow_pre_request() TO anon, authenticated, service_role, authenticator;

COMMENT ON FUNCTION public.bizflow_pre_request() IS
  'PostgREST db-pre-request hook: copies sub/role/email out of request.jwt.claims into the transaction-local request.jwt.claim.* GUCs so auth.uid()/role()/email() take their short-circuit branch instead of re-parsing the JWT on every call.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 回滚（留档不执行）：DROP FUNCTION public.bizflow_pre_request(); 同时把 docker 配置的 PGRST_DB_PRE_REQUEST 去掉再重建 rest 容器。
-- 7 个函数不用回滚成 VOLATILE（那本来就是误判）。
