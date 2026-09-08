-- 116: task_assignees / employee_task_feedbacks 的 SELECT 策略改集合式。
-- 此前两条策略逐行调 can_select_employee_task_by_id(task_id)，每行回查 employee_tasks + employees +
-- employee_companies + employee_departments；bizflow_team_task_page 0.88s 里约 0.53s 是这两张表。
-- 本迁移新增 bizflow_visible_task_ids()：每条语句只算一遍当前用户可见任务 id 集合（按 distinct 公司 /
-- 部门各调一次原 helper，布尔式与 can_select_employee_task 逐字等价），两条策略改 IN (SELECT ...)。
-- employee_tasks 自己的 SELECT 策略不动：INSERT…RETURNING 校验时 STABLE 函数看不见本命令刚插的行。
-- 写策略、admin_all 策略、helper 函数一律不动。Safe to rerun.
-- 等价性：is_bf_admin() 为同一调用；is_admin_of_company(NULL)=false，等价于 LEFT JOIN 落空后 COALESCE false。
-- creator = current_employee_id() 任一边 NULL 时原式为 NULL（WHERE 不通过），IS NOT NULL AND = 仍不通过。
-- member/department 支同理：NULL 公司不会命中成员；NULL 部门保留原允许分支，非 NULL 部门由同一 helper 判权。
BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_visible_task_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (
    SELECT public.current_employee_id() AS employee_id,
           public.is_bf_admin()         AS is_bf_admin
  ),
  company_scope AS (
    SELECT c.company_id,
           public.is_admin_of_company(c.company_id)  AS is_admin,
           public.is_member_of_company(c.company_id) AS is_member
    FROM (SELECT DISTINCT t.company_id FROM public.employee_tasks t WHERE t.company_id IS NOT NULL) AS c
  ),
  department_scope AS (
    SELECT d.department_id,
           public.is_member_of_department(d.department_id) AS is_member
    FROM (SELECT DISTINCT t.department_id FROM public.employee_tasks t WHERE t.department_id IS NOT NULL) AS d
  )
  SELECT t.id
  FROM public.employee_tasks AS t
  CROSS JOIN me
  LEFT JOIN company_scope    AS cs ON cs.company_id    = t.company_id
  LEFT JOIN department_scope AS ds ON ds.department_id = t.department_id
  WHERE me.is_bf_admin
     OR COALESCE(cs.is_admin, false)
     OR (t.creator_employee_id IS NOT NULL AND t.creator_employee_id = me.employee_id)
     OR (
       COALESCE(cs.is_member, false)
       AND (t.department_id IS NULL OR COALESCE(ds.is_member, false))
     );
$function$;

REVOKE ALL ON FUNCTION public.bizflow_visible_task_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_visible_task_ids() TO authenticated;

DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT TO authenticated
  USING (task_id IN (SELECT public.bizflow_visible_task_ids()));

DROP POLICY IF EXISTS fb_select_by_task_scope ON public.employee_task_feedbacks;
CREATE POLICY fb_select_by_task_scope ON public.employee_task_feedbacks
  FOR SELECT TO authenticated
  USING (task_id IN (SELECT public.bizflow_visible_task_ids()));

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 回滚（不要执行，留档；策略原文照 pg_policies 逐字）：
-- BEGIN;
-- DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
-- CREATE POLICY task_assignees_select ON public.task_assignees FOR SELECT TO authenticated
--   USING (public.can_select_employee_task_by_id(task_id));
-- DROP POLICY IF EXISTS fb_select_by_task_scope ON public.employee_task_feedbacks;
-- CREATE POLICY fb_select_by_task_scope ON public.employee_task_feedbacks FOR SELECT TO authenticated
--   USING (public.can_select_employee_task_by_id(task_id));
-- DROP FUNCTION IF EXISTS public.bizflow_visible_task_ids();
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
