-- 041: employees.is_admin → is_super_admin（rename + 加 generated column alias 過渡）
-- 背景：team subapp 4 層權限模型，super admin = 平台全權（Helen + 老板）。
-- 公司管理員（在 employee_companies.is_company_admin）和合作者由 042 處理。
-- 本 migration 改名 + 保留 is_admin 為只讀 alias，避免前端代碼一时未迁完導致自鎖。
-- 確認過：bizflow 主端 / team subapp 沒有對 employees.is_admin 的 INSERT/UPDATE 寫操作。
-- 等所有前端代碼遷到 is_super_admin 後再做 cleanup migration 刪 alias。

BEGIN;

-- 1. drop policy 引用了 is_admin（038 那條）
DROP POLICY IF EXISTS employees_self_update ON public.employees;

-- 2. rename column
ALTER TABLE public.employees RENAME COLUMN is_admin TO is_super_admin;

-- 3. 加只讀 alias：is_admin generated always as is_super_admin
--    前端舊代碼 read `is_admin` 仍然有值；寫入會報錯（grep 確認過無寫操作）
ALTER TABLE public.employees
  ADD COLUMN is_admin BOOLEAN GENERATED ALWAYS AS (is_super_admin) STORED;

-- 4. 重建 is_bf_admin() helper（body 用新列名）
--    bizflow 主端 RLS 依然透過此函數判定。語義從「bizflow admin」過渡為「super admin」。
CREATE OR REPLACE FUNCTION public.is_bf_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE((
    SELECT is_super_admin FROM employees
     WHERE user_id = auth.uid() AND active = true
     LIMIT 1
  ), false);
$$;

-- 5. 重建 employees_self_update policy（鎖 is_super_admin / company_id / kind / active）
CREATE POLICY employees_self_update ON public.employees
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND is_super_admin IS NOT DISTINCT FROM (SELECT e2.is_super_admin FROM public.employees e2 WHERE e2.id = employees.id)
    AND company_id IS NOT DISTINCT FROM (SELECT e2.company_id FROM public.employees e2 WHERE e2.id = employees.id)
    AND kind IS NOT DISTINCT FROM (SELECT e2.kind FROM public.employees e2 WHERE e2.id = employees.id)
    AND active IS NOT DISTINCT FROM (SELECT e2.active FROM public.employees e2 WHERE e2.id = employees.id)
  );

COMMIT;
