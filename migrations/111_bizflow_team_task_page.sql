-- 111: server-packed team task page.
--
-- The task page keeps the reviewed client reducers but replaces thirteen
-- separately paged table reads plus unread with one RLS-scoped response.
-- Safe to rerun. This migration only adds one SECURITY INVOKER read function;
-- it does not change tables, policies, write paths, or realtime publication.

BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_team_task_page(
  p_company_id uuid DEFAULT NULL,
  p_completed_limit integer DEFAULT 10,
  p_include_detail boolean DEFAULT false
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
    WHERE employee.user_id = auth.uid()
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
  completed_task_ids AS MATERIALIZED (
    SELECT task.id
    FROM public.employee_tasks AS task
    WHERE task.company_id = (SELECT company_id FROM scope)
      AND task.status = 'done'
    ORDER BY task.completed_at DESC NULLS LAST, task.id ASC
    LIMIT GREATEST(COALESCE(p_completed_limit, 10), 0)
  ),
  task_rows AS MATERIALIZED (
    SELECT task.*
    FROM public.employee_tasks AS task
    WHERE task.company_id = (SELECT company_id FROM scope)
      AND (
        COALESCE(task.status, 'open') <> 'done'
        OR task.id IN (SELECT completed.id FROM completed_task_ids AS completed)
      )
  ),
  assignee_rows AS MATERIALIZED (
    SELECT assignee.*
    FROM public.task_assignees AS assignee
    JOIN task_rows AS task ON task.id = assignee.task_id
  ),
  feedback_rows AS MATERIALIZED (
    SELECT feedback.*
    FROM public.employee_task_feedbacks AS feedback
    JOIN task_rows AS task ON task.id = feedback.task_id
  )
  SELECT jsonb_build_object(
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
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::text,
      NULL::timestamptz
    ), jsonb_build_object('unread', '{}'::jsonb, 'watermarks', '{}'::jsonb)),
    'generatedAt', to_char(now() AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
$function$;

REVOKE ALL ON FUNCTION public.bizflow_team_task_page(uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_team_task_page(uuid, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.bizflow_team_task_page(uuid, integer, boolean) IS
  'RLS-scoped one-trip raw-row payload for the team task page and task overview.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback reference (manual only):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.bizflow_team_task_page(uuid, integer, boolean);
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
