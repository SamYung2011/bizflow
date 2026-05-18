-- 055: task_pending — 公司 admin 也能看 / 審自己公司的註冊申請
-- 背景：之前只 super admin (is_bf_admin) 能 SELECT/UPDATE，公司 admin (is_company_admin=true)
-- 在 team「審核帳號」打開 nav 看到空集，因為 RLS 把他們擋了。
-- task_pending.company_name 是文本（註冊時用戶手填），匹配方式：
--   lower(trim(company_name)) = lower(trim(companies.name))
-- 條件：當前 user 在 companies 表那條 company 是 admin (employee_companies.is_company_admin=true)。
--
-- 一個 helper：is_admin_of_company_by_name(text) — 對應 is_admin_of_company(uuid)。
-- 新增兩條 policy：select / update（INSERT 已有 anon + self；DELETE 不開放給公司 admin）。

BEGIN;

-- ============== helper ==============
CREATE OR REPLACE FUNCTION public.is_admin_of_company_by_name(comp_name text)
  RETURNS boolean
  LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_companies ec
    JOIN public.employees e ON e.id = ec.employee_id
    JOIN public.companies  co ON co.id = ec.company_id
    WHERE e.user_id = auth.uid()
      AND ec.is_company_admin = true
      AND lower(trim(co.name)) = lower(trim(comp_name))
  );
$$;

-- ============== policies ==============
-- SELECT：super admin / 申請人本人 / 該公司 admin（按 company_name 文本匹配）
DROP POLICY IF EXISTS task_pending_company_admin_select ON public.task_pending;
CREATE POLICY task_pending_company_admin_select ON public.task_pending
  FOR SELECT TO authenticated
  USING (public.is_admin_of_company_by_name(company_name));

-- UPDATE：公司 admin 可批准/拒絕自己公司的申請
DROP POLICY IF EXISTS task_pending_company_admin_update ON public.task_pending;
CREATE POLICY task_pending_company_admin_update ON public.task_pending
  FOR UPDATE TO authenticated
  USING (public.is_admin_of_company_by_name(company_name))
  WITH CHECK (public.is_admin_of_company_by_name(company_name));

COMMIT;
