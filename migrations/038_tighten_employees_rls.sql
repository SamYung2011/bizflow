-- 038: 收緊 employees 表 RLS
-- 背景：team 子應用立項後，task kind 用戶（外部公司員工）能登入。
-- 原 authenticated_all (true/true) 對所有已登入帳號開放 INSERT/UPDATE/DELETE，
-- task 用戶能自我提權成 is_admin、改別人 company_id、刪 admin。
-- 收緊：admin 全權；其他人僅能 UPDATE 自己一行的非敏感字段。

DROP POLICY IF EXISTS authenticated_all ON public.employees;

-- 所有 authenticated 可讀（任務看板 / 員工列表 / @mention 候選需要）
DROP POLICY IF EXISTS employees_select_all ON public.employees;
CREATE POLICY employees_select_all ON public.employees
  FOR SELECT TO authenticated USING (true);

-- admin 全權
DROP POLICY IF EXISTS employees_admin_write ON public.employees;
CREATE POLICY employees_admin_write ON public.employees
  FOR ALL TO authenticated
  USING (is_bf_admin())
  WITH CHECK (is_bf_admin());

-- 本人可改自己一行，但鎖住敏感字段：
--   is_admin / company_id / kind / active / user_id 不可被自己改（防自我提權 / 越界 / 篡帳號）
--   可改：name / role / phone / email / note / must_change_password / show_update_log
-- 用 IS NOT DISTINCT FROM 處理 NULL 等價
DROP POLICY IF EXISTS employees_self_update ON public.employees;
CREATE POLICY employees_self_update ON public.employees
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND is_admin IS NOT DISTINCT FROM (SELECT e2.is_admin FROM public.employees e2 WHERE e2.id = employees.id)
    AND company_id IS NOT DISTINCT FROM (SELECT e2.company_id FROM public.employees e2 WHERE e2.id = employees.id)
    AND kind IS NOT DISTINCT FROM (SELECT e2.kind FROM public.employees e2 WHERE e2.id = employees.id)
    AND active IS NOT DISTINCT FROM (SELECT e2.active FROM public.employees e2 WHERE e2.id = employees.id)
  );
