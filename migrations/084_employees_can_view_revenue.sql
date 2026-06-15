-- 084: employees 加 can_view_revenue boolean
-- 模式照 can_ship：admin 永遠通行 + 字段為 true 的非 admin 也通行。
-- 用途：營收分析 tab + 首頁本月營收 StatCard 只給特定人看。
-- Safe to rerun.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS can_view_revenue boolean NOT NULL DEFAULT false;

-- Sam Yung 已是 admin（通過 is_admin / email 兜底），字段獨立鎖定避免日後 admin 變更
-- KC 不是 admin，靠這個字段授權
UPDATE public.employees SET can_view_revenue = true
WHERE name IN ('Sam Yung', 'KC') AND can_view_revenue IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 驗證
SELECT name, is_admin, can_view_revenue FROM public.employees
WHERE can_view_revenue = true OR is_admin = true
ORDER BY name;
