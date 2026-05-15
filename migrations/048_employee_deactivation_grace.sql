-- 048: 員工解綁 / 銷號 6 天延遲清除
-- 場景：
--   A. 公司 admin 移除一個合作者 → 只刪 A x 該公司 binding（A 在其他公司繼續用）
--   B. 公司 admin 移除一個單公司員工（A 沒別的公司）= 銷號 → 立即停用 + 6 天後 cron 真刪
--   C. super admin 永久刪除員工 → 立即 DELETE（繞過 6 天 grace）
-- 本 migration 只負責 schema + cron 任務。具體解綁邏輯在前端 admin.jsx。

BEGIN;

-- 1. employees 加 deactivated_at（停用時間戳，銷號流程用）
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS employees_deactivated_at_idx
  ON public.employees(deactivated_at) WHERE deactivated_at IS NOT NULL;

-- 2. 自動清理 function — 超過 6 天的停用員工 + 對應 auth user 一起刪
--    SECURITY DEFINER 讓 pg_cron 跑時有權刪 auth.users
CREATE OR REPLACE FUNCTION public.cleanup_inactive_employees() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  victim_user_ids uuid[];
  victim_count integer;
BEGIN
  -- 收集 auth user_id（之後一起刪 auth.users）
  SELECT array_agg(user_id) INTO victim_user_ids
  FROM public.employees
  WHERE active = false
    AND deactivated_at IS NOT NULL
    AND deactivated_at < now() - INTERVAL '6 days'
    AND user_id IS NOT NULL;

  -- 刪 employees（FK cascade 清 employee_companies / task_assignees / 部分 employee_tasks）
  WITH deleted AS (
    DELETE FROM public.employees
    WHERE active = false
      AND deactivated_at IS NOT NULL
      AND deactivated_at < now() - INTERVAL '6 days'
    RETURNING id
  )
  SELECT count(*) INTO victim_count FROM deleted;

  -- 連 auth user 一起刪
  IF victim_user_ids IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY(victim_user_ids);
  END IF;

  RETURN victim_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_inactive_employees() TO postgres;

-- 2a. super admin 用的「永久刪除員工」RPC（繞過 6 天 grace）
--     前端直接 DELETE auth.users 沒權限（service_role only），所以走 SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.permanent_delete_employee(emp_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  victim_user_id uuid;
BEGIN
  -- 只 super admin 能調
  IF NOT public.is_bf_admin() THEN
    RAISE EXCEPTION 'Only super admin can permanently delete employees';
  END IF;

  SELECT user_id INTO victim_user_id FROM public.employees WHERE id = emp_id;

  -- 刪 employees（FK cascade）
  DELETE FROM public.employees WHERE id = emp_id;

  -- 連 auth user 一起刪
  IF victim_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = victim_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.permanent_delete_employee(uuid) TO authenticated;

-- 3. pg_cron 任務 — 每天 03:00 UTC（香港 11:00）跑一次
--    先 unschedule 同名 job 防重複註冊
SELECT cron.unschedule('cleanup-inactive-employees')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-inactive-employees');

SELECT cron.schedule(
  'cleanup-inactive-employees',
  '0 3 * * *',
  $cron$SELECT public.cleanup_inactive_employees();$cron$
);

COMMIT;

-- 驗證
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'cleanup-inactive-employees';
