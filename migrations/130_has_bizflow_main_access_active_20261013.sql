-- 离职但主站标记仍开的员工不能再读写主站；管理员也必须在职。
-- 任务 RPC 仅排除可确认已离职的负责人，隐藏全离职负责的任务；不删除任何记录。
-- members 和员工关联表保留 116 原样，用于历史署名；选人名单由任务页映射一处过滤。
-- 单人旧任务回退 employee_id；无负责人任务仍显示。保留 116 的 RLS 和受控子表读取。
-- 回滚：恢复 064 的 helper 定义和 116 的 bizflow_team_task_page 定义（只执行定义，勿重跑 064 数据更新）。
BEGIN;
CREATE OR REPLACE FUNCTION has_bizflow_main_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS(
    SELECT 1 FROM employees
    WHERE user_id = auth.uid()
      AND active = true
      AND (bizflow_main_access = true OR is_admin = true)
  );
$$;

GRANT EXECUTE ON FUNCTION has_bizflow_main_access() TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.bizflow_team_task_page(
  p_company_id uuid DEFAULT NULL,
  p_completed_limit integer DEFAULT NULL,
  p_include_detail boolean DEFAULT false,
  p_tasks_read timestamptz DEFAULT NULL,
  p_orders_read timestamptz DEFAULT NULL,
  p_messages_read timestamptz DEFAULT NULL,
  p_inventory_read text DEFAULT NULL,
  p_updates_read timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH
  me AS MATERIALIZED (
    SELECT employee.id AS employee_id, employee.name AS employee_name
    FROM public.employees AS employee
    WHERE employee.user_id = auth.uid() AND employee.active = true
    ORDER BY employee.created_at ASC, employee.id ASC
    LIMIT 1
  ),
  scope AS MATERIALIZED (
    SELECT COALESCE(
      p_company_id,
      (
        SELECT link.company_id
        FROM public.employee_companies AS link
        JOIN me ON me.employee_id = link.employee_id
        ORDER BY link.joined_at ASC, link.id ASC
        LIMIT 1
      )
    ) AS company_id
  ),
  task_access AS MATERIALIZED (
    SELECT
      public.is_bf_admin() AS is_admin,
      public.has_company_permission(
        (SELECT company_id FROM scope),
        'can_delete_others_tasks'
      ) AS can_delete_others
  ),
  selected_company AS MATERIALIZED (
    SELECT company.id, company.feature_ai_batch
    FROM public.companies AS company
    WHERE company.id = (SELECT company_id FROM scope)
    LIMIT 1
  ),
  inactive AS MATERIALIZED (
    SELECT id FROM public.employees WHERE active = false
  ),
  scoped_assignees AS MATERIALIZED (
    SELECT assignee.* FROM public.bizflow_scoped_task_assignees() AS assignee
  ),
  task_owners AS MATERIALIZED (
    SELECT assignee.task_id, bool_or(inactive.id IS NULL) AS has_active
    FROM scoped_assignees AS assignee
    LEFT JOIN inactive ON inactive.id = assignee.employee_id
    GROUP BY assignee.task_id
  ),
  visible_task_rows AS MATERIALIZED (
    SELECT task.*
    FROM public.employee_tasks AS task
    LEFT JOIN task_owners AS owners ON owners.task_id = task.id
    LEFT JOIN inactive AS legacy_owner ON legacy_owner.id = task.employee_id
    WHERE task.company_id = (SELECT company_id FROM scope)
      AND (owners.has_active OR (owners.task_id IS NULL
        AND (legacy_owner.id IS NULL)))
  ),
  task_stats AS MATERIALIZED (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE task.status = 'done') AS completed,
      count(*) FILTER (WHERE COALESCE(task.status, 'open') NOT IN ('done', 'abandoned')) AS open,
      count(*) FILTER (WHERE task.status = 'abandoned') AS abandoned
    FROM visible_task_rows AS task
  ),
  completed_task_ids AS MATERIALIZED (
    SELECT task.id
    FROM visible_task_rows AS task
    WHERE task.status = 'done'
    ORDER BY task.completed_at DESC NULLS LAST, task.id ASC
    LIMIT CASE
      WHEN p_completed_limit IS NULL THEN NULL
      ELSE GREATEST(p_completed_limit, 0)
    END
  ),
  task_rows AS MATERIALIZED (
    SELECT task.*
    FROM visible_task_rows AS task
    WHERE (
        COALESCE(task.status, 'open') <> 'done'
        OR task.id IN (SELECT completed.id FROM completed_task_ids AS completed)
      )
  ),
  assignee_rows AS MATERIALIZED (
    SELECT assignee.*
    FROM scoped_assignees AS assignee
    LEFT JOIN inactive ON inactive.id = assignee.employee_id
    JOIN task_rows AS task ON task.id = assignee.task_id
    WHERE inactive.id IS NULL
  ),
  feedback_rows AS MATERIALIZED (
    SELECT feedback.*
    FROM public.bizflow_scoped_task_feedbacks() AS feedback
    JOIN task_rows AS task ON task.id = feedback.task_id
  )
  SELECT jsonb_build_object(
    'taskStats', jsonb_build_object(
      'total', COALESCE((SELECT total FROM task_stats), 0),
      'completed', COALESCE((SELECT completed FROM task_stats), 0),
      'open', COALESCE((SELECT open FROM task_stats), 0),
      'abandoned', COALESCE((SELECT abandoned FROM task_stats), 0)
    ),
    'tasks', COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN p_include_detail THEN to_jsonb(task)
          ELSE (to_jsonb(task) - 'note' - 'attachments') || jsonb_build_object(
            'has_note', COALESCE(task.note, '') <> '',
            'attachment_count', jsonb_array_length(public.bizflow_jsonb_array(task.attachments))
          )
        END
        ORDER BY task.created_at DESC, task.id ASC
      )
      FROM task_rows AS task
    ), '[]'::jsonb),
    'assignees', COALESCE((
      SELECT jsonb_agg(to_jsonb(assignee) ORDER BY assignee.created_at ASC)
      FROM assignee_rows AS assignee
    ), '[]'::jsonb),
    'feedbacks', COALESCE((
      SELECT jsonb_agg(to_jsonb(feedback) ORDER BY feedback.created_at ASC, feedback.id ASC)
      FROM feedback_rows AS feedback
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(to_jsonb(employee) ORDER BY employee.created_at ASC, employee.id ASC)
      FROM public.employees AS employee
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(to_jsonb(department) ORDER BY department.name ASC, department.id ASC)
      FROM public.departments AS department
    ), '[]'::jsonb),
    'employeeDepartments', COALESCE((
      SELECT jsonb_agg(to_jsonb(link) ORDER BY link.created_at ASC)
      FROM public.employee_departments AS link
    ), '[]'::jsonb),
    'employeeCompanies', COALESCE((
      SELECT jsonb_agg(to_jsonb(link) ORDER BY link.joined_at ASC, link.id ASC)
      FROM public.employee_companies AS link
    ), '[]'::jsonb),
    'roles', COALESCE((
      SELECT jsonb_agg(to_jsonb(role) ORDER BY role.name ASC, role.id ASC)
      FROM public.roles AS role
    ), '[]'::jsonb),
    'companies', COALESCE((
      SELECT jsonb_agg(to_jsonb(company) ORDER BY company.created_at ASC, company.id ASC)
      FROM public.companies AS company
    ), '[]'::jsonb),
    'taskPending', COALESCE((
      SELECT jsonb_agg(to_jsonb(pending) ORDER BY pending.requested_at DESC, pending.id ASC)
      FROM public.task_pending AS pending
    ), '[]'::jsonb),
    'companyJoinPending', COALESCE((
      SELECT jsonb_agg(to_jsonb(pending) ORDER BY pending.requested_at DESC, pending.id ASC)
      FROM public.company_join_pending AS pending
    ), '[]'::jsonb),
    'updateLogs', COALESCE((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at DESC, log.id ASC)
      FROM public.team_update_logs AS log
    ), '[]'::jsonb),
    'updateLogComments', COALESCE((
      SELECT jsonb_agg(to_jsonb(comment) ORDER BY comment.created_at ASC, comment.id ASC)
      FROM public.team_update_log_comments AS comment
    ), '[]'::jsonb),
    'currentUser', jsonb_build_object(
      'employeeId', COALESCE((SELECT employee_id::text FROM me), ''),
      'name', COALESCE((SELECT employee_name FROM me), ''),
      'activeCompanyId', COALESCE((SELECT company_id::text FROM scope), '')
    ),
    'permissions', jsonb_build_object(
      'isBfAdmin', COALESCE((SELECT is_admin FROM task_access), false),
      'canDeleteOthersTasks', COALESCE((SELECT can_delete_others FROM task_access), false),
      'featureAiBatch', COALESCE((SELECT feature_ai_batch FROM selected_company), false)
    ),
    'unread', COALESCE(public.bizflow_unread_summary(
      (SELECT company_id FROM scope),
      p_tasks_read,
      p_orders_read,
      p_messages_read,
      p_inventory_read,
      p_updates_read
    ), jsonb_build_object('unread', '{}'::jsonb, 'watermarks', '{}'::jsonb)),
    'generatedAt', to_char(now() AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
$function$;

REVOKE ALL ON FUNCTION public.bizflow_team_task_page(
  uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_team_task_page(
  uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz
) TO authenticated;

COMMENT ON FUNCTION public.bizflow_team_task_page(
  uuid, integer, boolean, timestamptz, timestamptz, timestamptz, text, timestamptz
) IS
  'RLS-scoped one-trip raw-row payload for the team task page and task overview.';

NOTIFY pgrst, 'reload schema';

COMMIT;
