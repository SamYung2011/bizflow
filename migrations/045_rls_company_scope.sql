-- 045: RLS 改造 — 任務按 company_id 隔離 + 公司管理員寫權限
-- 背景：041-044 已建好多公司 schema。本 migration 重寫關鍵 RLS：
--   1. employee_tasks SELECT 按 company_id 過濾（合作者隔離核心）
--   2. employee_companies / roles 加公司管理員寫權限
--
-- 不動：bizflow 主端 RLS（customers/invoices/products 等 Honnmono 私有表）
-- 不動：task_assignees / employee_task_feedbacks / task_pending / team_update_logs
--   （前者繼承 employee_tasks 父表過濾；後三者沿用現規則）

BEGIN;

-- ==========================================
-- 1. helper functions
-- ==========================================

-- 當前用戶是否屬於指定公司
CREATE OR REPLACE FUNCTION public.is_member_of_company(comp_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_companies ec
    JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid() AND ec.company_id = comp_id
  );
$$;

-- 當前用戶是否是指定公司的管理員
CREATE OR REPLACE FUNCTION public.is_admin_of_company(comp_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_companies ec
    JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid()
      AND ec.company_id = comp_id
      AND ec.is_company_admin = true
  );
$$;

-- ==========================================
-- 2. employee_tasks SELECT 按 company_id 隔離
-- ==========================================
-- 原 tasks_select_all (true) 改成按公司過濾。
-- super admin 全開；其他人僅能 SELECT 自己所屬公司的任務。
DROP POLICY IF EXISTS tasks_select_all ON public.employee_tasks;
CREATE POLICY tasks_select_by_company ON public.employee_tasks
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()  -- super admin 全開
    OR public.is_member_of_company(company_id)
  );

-- ==========================================
-- 3. employee_companies 加公司管理員寫權限
-- ==========================================
-- 公司管理員可以管本公司的綁定關係（加員工 / 改職位 / 改 is_company_admin）
-- 但鎖住：不能改自己的 is_company_admin / is_default（防自我提權 / 篡改）
DROP POLICY IF EXISTS employee_companies_company_admin_write ON public.employee_companies;
CREATE POLICY employee_companies_company_admin_write ON public.employee_companies
  FOR ALL TO authenticated
  USING (public.is_admin_of_company(company_id))
  WITH CHECK (public.is_admin_of_company(company_id));

-- ==========================================
-- 4. roles 加公司管理員寫權限（前提：has can_manage_roles 暫不做，admin 統一管）
-- ==========================================
DROP POLICY IF EXISTS roles_company_admin_write ON public.roles;
CREATE POLICY roles_company_admin_write ON public.roles
  FOR ALL TO authenticated
  USING (public.is_admin_of_company(company_id))
  WITH CHECK (public.is_admin_of_company(company_id));

-- ==========================================
-- 5. employees 寫權限 — 公司管理員能改本公司員工的基礎字段
-- ==========================================
-- 原 employees_admin_write 只 super admin 寫。
-- 加：公司管理員可以改本公司員工（鎖 is_super_admin / user_id / kind）
-- 「本公司」= employee 的 default company（employees.company_id 或 employee_companies.is_default=true）
DROP POLICY IF EXISTS employees_company_admin_write ON public.employees;
CREATE POLICY employees_company_admin_write ON public.employees
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_companies ec
      WHERE ec.employee_id = employees.id
        AND public.is_admin_of_company(ec.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employee_companies ec
      WHERE ec.employee_id = employees.id
        AND public.is_admin_of_company(ec.company_id)
    )
    -- 鎖敏感字段：公司管理員不能提權他人為 super admin / 改 user_id / 改 kind
    AND is_super_admin IS NOT DISTINCT FROM (SELECT e2.is_super_admin FROM public.employees e2 WHERE e2.id = employees.id)
    AND user_id IS NOT DISTINCT FROM (SELECT e2.user_id FROM public.employees e2 WHERE e2.id = employees.id)
    AND kind IS NOT DISTINCT FROM (SELECT e2.kind FROM public.employees e2 WHERE e2.id = employees.id)
  );

COMMIT;

-- 驗證 policies 都建好
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('employee_tasks', 'employee_companies', 'roles', 'employees')
ORDER BY tablename, policyname;
