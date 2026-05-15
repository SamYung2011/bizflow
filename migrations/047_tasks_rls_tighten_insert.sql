-- 047: 收緊 employee_tasks RLS — 修跨公司偽造任務漏洞
-- 背景：agent 端到端測試發現 Bug #1（CRITICAL）：
--   原 tasks_creator_all / tasks_emp_own 是 FOR ALL，只檢 creator_employee_id / employee_id，
--   沒檢 company_id。員工 X（只屬於公司 C）能 INSERT 一個 company_id = 公司 A 的任務並設自己當 creator，
--   然後 A 的成員就能看到。這破壞了合作者隔離。
--
-- 修：drop 寬鬆的 FOR ALL policy，分別建 INSERT/UPDATE/DELETE policy，每個都 AND is_member_of_company(company_id)。
-- SELECT 仍走 tasks_select_by_company（045 建的）。

BEGIN;

-- 1. drop 寬鬆的 FOR ALL policies
DROP POLICY IF EXISTS tasks_creator_all ON public.employee_tasks;
DROP POLICY IF EXISTS tasks_emp_own ON public.employee_tasks;
-- 也 drop 老 assignee_rw（沒 company 檢查），稍後重建
DROP POLICY IF EXISTS tasks_assignee_rw ON public.employee_tasks;

-- 2. INSERT：必須是任務所屬公司成員 + 自己當 creator（或 admin 兜底）
DROP POLICY IF EXISTS tasks_insert ON public.employee_tasks;
CREATE POLICY tasks_insert ON public.employee_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_bf_admin()
    OR (
      public.is_member_of_company(company_id)
      AND creator_employee_id = public.current_employee_id()
    )
  );

-- 3. UPDATE：creator 或 assignee 或舊單 assignee 字段（限本公司）
DROP POLICY IF EXISTS tasks_update ON public.employee_tasks;
CREATE POLICY tasks_update ON public.employee_tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_bf_admin()
    OR (
      public.is_member_of_company(company_id)
      AND (
        creator_employee_id = public.current_employee_id()
        OR public.is_task_assignee(id)
        OR employee_id = public.current_employee_id()
      )
    )
  )
  WITH CHECK (
    public.is_bf_admin()
    OR (
      public.is_member_of_company(company_id)
      AND (
        creator_employee_id = public.current_employee_id()
        OR public.is_task_assignee(id)
        OR employee_id = public.current_employee_id()
      )
    )
  );

-- 4. DELETE：creator only（限本公司）
DROP POLICY IF EXISTS tasks_delete ON public.employee_tasks;
CREATE POLICY tasks_delete ON public.employee_tasks
  FOR DELETE TO authenticated
  USING (
    public.is_bf_admin()
    OR (
      public.is_member_of_company(company_id)
      AND creator_employee_id = public.current_employee_id()
    )
  );

-- 同樣收緊 task_assignees 表，不然員工可以給跨公司任務塞自己當 assignee → 反向暴露任務
-- 先看下 task_assignees 現有 policies
-- （已知：task_assignees 沿用前代寬鬆 RLS，可能也有漏洞）
-- 收緊：寫操作必須是任務的同公司成員 + 任務 creator 或 admin

DROP POLICY IF EXISTS task_assignees_admin_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_select_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_creator_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_assignee_rw ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_emp_rw ON public.task_assignees;
-- 老 ta_* 前綴的 policies 也清掉（早期遺留命名）
DROP POLICY IF EXISTS ta_creator_all ON public.task_assignees;
DROP POLICY IF EXISTS ta_select_all ON public.task_assignees;
DROP POLICY IF EXISTS ta_self_update ON public.task_assignees;

-- SELECT：能看見的條件 = 對應任務你能看（is_member_of_company(task.company_id) OR admin）
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.employee_tasks t
      WHERE t.id = task_assignees.task_id
        AND public.is_member_of_company(t.company_id)
    )
  );

-- INSERT/UPDATE/DELETE：admin OR (任務 creator + 同公司) OR (是自己被分配且操作自己那行)
CREATE POLICY task_assignees_write ON public.task_assignees
  FOR ALL TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.employee_tasks t
      WHERE t.id = task_assignees.task_id
        AND public.is_member_of_company(t.company_id)
        AND (
          t.creator_employee_id = public.current_employee_id()
          OR task_assignees.employee_id = public.current_employee_id()
        )
    )
  )
  WITH CHECK (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.employee_tasks t
      WHERE t.id = task_assignees.task_id
        AND public.is_member_of_company(t.company_id)
        AND (
          t.creator_employee_id = public.current_employee_id()
          OR task_assignees.employee_id = public.current_employee_id()
        )
    )
  );

COMMIT;

-- 驗證
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('employee_tasks', 'task_assignees')
ORDER BY tablename, cmd, policyname;
