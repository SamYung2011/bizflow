-- 083: 修 082 后澄川 review 找到的 4 条越权副作用
-- Safe to rerun.
--
-- Findings 回顾：
--  P1  trigger 用 NEW.company_id 判 authorized，多公司用户能把 task company_id 改到自己有权
--      的公司、顺带改字段。修：trigger 全部用 OLD.company_id 判；额外锁 company_id 和
--      creator_employee_id 不可改（super admin 除外）。
--  P2  can_validate_task 角色在前端能看到「核驗通過」按钮，但 tasks_update policy 没放行该角
--      色 + trigger 也没给字段级 allow → approve 落不了库。修：policy 加 has_company_permission
--      can_validate_task 分支；trigger 加 validator 字段级 allow（status/completed_at/
--      approved_at/approved_by）。

BEGIN;

-- ============================================================
-- 1. prevent_task_field_hijack rewrite
--    · 锁 company_id / creator_employee_id 不可被 UPDATE 改（super admin 除外）
--    · 所有 authorized 判定用 OLD.company_id（不能信 NEW）
--    · 新增 validator 字段级 allow
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_task_field_hijack() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_can_edit boolean;
  caller_can_validate boolean;
BEGIN
  -- A. 不可改字段：company_id / creator_employee_id（super admin 除外）。
  --    避免「转公司绕权限」攻击链。
  IF (NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.creator_employee_id IS DISTINCT FROM OLD.creator_employee_id)
     AND NOT public.is_bf_admin() THEN
    RAISE EXCEPTION 'task company_id and creator_employee_id are immutable after creation';
  END IF;

  -- B. 全权 caller：admin / 公司 admin / creator / has_can_edit_others_tasks。
  --    一律用 OLD.company_id 判，绝不信 NEW。
  caller_can_edit := public.is_bf_admin()
    OR public.is_admin_of_company(OLD.company_id)
    OR OLD.creator_employee_id = public.current_employee_id()
    OR public.has_company_permission(OLD.company_id, 'can_edit_others_tasks');
  IF caller_can_edit THEN
    RETURN NEW;
  END IF;

  -- C. Validators (has can_validate_task)：只允改 status / completed_at /
  --    approved_at / approved_by。
  caller_can_validate := public.has_company_permission(OLD.company_id, 'can_validate_task');
  IF caller_can_validate THEN
    IF (to_jsonb(NEW) - 'status' - 'completed_at' - 'approved_at' - 'approved_by')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'completed_at' - 'approved_at' - 'approved_by') THEN
      RAISE EXCEPTION 'task validators can only update status/completed_at/approved_at/approved_by';
    END IF;
    RETURN NEW;
  END IF;

  -- D. Assignees: 只允改 status / completed_at。
  IF (to_jsonb(NEW) - 'status' - 'completed_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'completed_at') THEN
    RAISE EXCEPTION 'task assignees can only update status/completed_at on employee_tasks';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. tasks_update policy 加 can_validate_task 分支
--    不加这条 → validator 整行 UPDATE 进不来；trigger 字段级 allow 也跑不到。
-- ============================================================
DROP POLICY IF EXISTS tasks_update ON public.employee_tasks;
CREATE POLICY tasks_update ON public.employee_tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_admin_of_company(company_id)
    OR public.has_company_permission(company_id, 'can_edit_others_tasks')
    OR public.has_company_permission(company_id, 'can_validate_task')
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
    OR public.is_admin_of_company(company_id)
    OR public.has_company_permission(company_id, 'can_edit_others_tasks')
    OR public.has_company_permission(company_id, 'can_validate_task')
    OR (
      public.is_member_of_company(company_id)
      AND (
        creator_employee_id = public.current_employee_id()
        OR public.is_task_assignee(id)
        OR employee_id = public.current_employee_id()
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
