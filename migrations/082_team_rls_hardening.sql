-- 082: team RLS hardening for multi-company isolation + assignee write split
-- Safe to rerun. This migration closes the 2026-06-15 team review findings:
-- 1. team cross-company SELECT exposure on employees / employee_companies / roles / feedbacks
-- 2. task_assignees self-insert escalation into employee_tasks UPDATE rights
-- 3. company admin UI permissions not matching task UPDATE / DELETE RLS

BEGIN;

-- Core helpers must be SECURITY DEFINER before tightening SELECT policies;
-- otherwise functions that inspect employees / employee_companies can recurse
-- through the policies they are used by.
CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.employees
  WHERE user_id = auth.uid()
    AND active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_bf_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT is_super_admin
    FROM public.employees
    WHERE user_id = auth.uid()
      AND active = true
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_member_of_company(comp_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_companies ec
    JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid()
      AND e.active = true
      AND ec.company_id = comp_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_company(comp_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_companies ec
    JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid()
      AND e.active = true
      AND ec.company_id = comp_id
      AND ec.is_company_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_permission(comp_id uuid, permission_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_bf_admin()
    OR public.is_admin_of_company(comp_id)
    OR EXISTS (
      SELECT 1
      FROM public.employee_companies ec
      JOIN public.employees e ON e.id = ec.employee_id
      JOIN public.roles r ON r.id = ec.role_id
      WHERE e.user_id = auth.uid()
        AND e.active = true
        AND ec.company_id = comp_id
        AND r.company_id = comp_id
        AND r.permissions ->> permission_key = 'true'
    );
$$;

CREATE OR REPLACE FUNCTION public.can_select_employee(emp_id uuid, emp_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_bf_admin()
    OR emp_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.employee_companies target
      JOIN public.employee_companies mine ON mine.company_id = target.company_id
      JOIN public.employees me ON me.id = mine.employee_id
      WHERE target.employee_id = emp_id
        AND me.user_id = auth.uid()
        AND me.active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.can_select_employee_task(
  task_company_id uuid,
  task_department_id uuid,
  task_creator_employee_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_bf_admin()
    OR public.is_admin_of_company(task_company_id)
    OR task_creator_employee_id = public.current_employee_id()
    OR (
      public.is_member_of_company(task_company_id)
      AND (
        task_department_id IS NULL
        OR public.is_member_of_department(task_department_id)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_select_employee_task_by_id(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_tasks t
    WHERE t.id = p_task_id
      AND public.can_select_employee_task(t.company_id, t.department_id, t.creator_employee_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_task_assignees(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_tasks t
    WHERE t.id = p_task_id
      AND (
        public.is_bf_admin()
        OR public.is_admin_of_company(t.company_id)
        OR t.creator_employee_id = public.current_employee_id()
        OR public.has_company_permission(t.company_id, 'can_assign_others')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_valid_task_assignee(p_task_id uuid, p_employee_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_tasks t
    JOIN public.employee_companies ec
      ON ec.company_id = t.company_id
     AND ec.employee_id = p_employee_id
    JOIN public.employees e
      ON e.id = ec.employee_id
     AND e.active = true
    WHERE t.id = p_task_id
      AND (
        t.department_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.employee_departments ed
          WHERE ed.department_id = t.department_id
            AND ed.employee_id = p_employee_id
        )
      )
  );
$$;

-- Keep task_assignees status-only on UPDATE; reassignment should be DELETE + INSERT.
CREATE OR REPLACE FUNCTION public.prevent_task_assignee_identity_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'completed_at' - 'abandoned_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'completed_at' - 'abandoned_at') THEN
    RAISE EXCEPTION 'task_assignees only completed_at/abandoned_at can be updated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_task_assignee_identity_update ON public.task_assignees;
CREATE TRIGGER trg_prevent_task_assignee_identity_update
  BEFORE UPDATE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.prevent_task_assignee_identity_update();

-- employee_tasks: assignees can only flip status / completed_at on UPDATE.
-- Without this, anyone who self-inserts into task_assignees can hijack title /
-- note / due_date because the row-level RLS only checks "is_task_assignee".
-- Admin / creator / can_edit_others_tasks holders bypass this trigger.
CREATE OR REPLACE FUNCTION public.prevent_task_field_hijack() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_authorized boolean;
BEGIN
  caller_authorized := public.is_bf_admin()
    OR public.is_admin_of_company(NEW.company_id)
    OR OLD.creator_employee_id = public.current_employee_id()
    OR public.has_company_permission(NEW.company_id, 'can_edit_others_tasks');
  IF caller_authorized THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'completed_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'completed_at') THEN
    RAISE EXCEPTION 'task assignees can only update status/completed_at on employee_tasks';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_task_field_hijack ON public.employee_tasks;
CREATE TRIGGER trg_prevent_task_field_hijack
  BEFORE UPDATE ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_task_field_hijack();

-- employees: same-company members can see each other; super admin sees all; self sees self.
DROP POLICY IF EXISTS employees_select_all ON public.employees;
DROP POLICY IF EXISTS employees_select_by_company ON public.employees;
CREATE POLICY employees_select_by_company ON public.employees
  FOR SELECT TO authenticated
  USING (public.can_select_employee(id, user_id));

-- employee_companies: expose only bindings in companies the caller belongs to,
-- plus the caller's own bindings and super admin.
DROP POLICY IF EXISTS employee_companies_select_all ON public.employee_companies;
DROP POLICY IF EXISTS employee_companies_select_by_company ON public.employee_companies;
CREATE POLICY employee_companies_select_by_company ON public.employee_companies
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR employee_id = public.current_employee_id()
    OR public.is_member_of_company(company_id)
  );

-- roles: permissions JSON is sensitive; scope it to the caller's companies.
DROP POLICY IF EXISTS roles_select_all ON public.roles;
DROP POLICY IF EXISTS roles_select_by_company ON public.roles;
CREATE POLICY roles_select_by_company ON public.roles
  FOR SELECT TO authenticated
  USING (public.is_bf_admin() OR public.is_member_of_company(company_id));

-- employee_tasks SELECT: keep the department-aware 052 behavior, via helper.
DROP POLICY IF EXISTS tasks_select_by_company ON public.employee_tasks;
CREATE POLICY tasks_select_by_company ON public.employee_tasks
  FOR SELECT TO authenticated
  USING (public.can_select_employee_task(company_id, department_id, creator_employee_id));

-- employee_tasks UPDATE / DELETE: add company admin and matching RBAC permissions.
DROP POLICY IF EXISTS tasks_update ON public.employee_tasks;
CREATE POLICY tasks_update ON public.employee_tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_admin_of_company(company_id)
    OR public.has_company_permission(company_id, 'can_edit_others_tasks')
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
    OR (
      public.is_member_of_company(company_id)
      AND (
        creator_employee_id = public.current_employee_id()
        OR public.is_task_assignee(id)
        OR employee_id = public.current_employee_id()
      )
    )
  );

DROP POLICY IF EXISTS tasks_delete ON public.employee_tasks;
CREATE POLICY tasks_delete ON public.employee_tasks
  FOR DELETE TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_admin_of_company(company_id)
    OR public.has_company_permission(company_id, 'can_delete_others_tasks')
    OR (
      public.is_member_of_company(company_id)
      AND creator_employee_id = public.current_employee_id()
    )
  );

-- task_assignees: no more self-insert. Managers assign/delete; assignees only
-- update their existing own row for completion/abandonment state.
DROP POLICY IF EXISTS task_assignees_select ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_write ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_admin_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_select_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_creator_all ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_assignee_rw ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_emp_rw ON public.task_assignees;
DROP POLICY IF EXISTS ta_admin_all ON public.task_assignees;
DROP POLICY IF EXISTS ta_creator_all ON public.task_assignees;
DROP POLICY IF EXISTS ta_select_all ON public.task_assignees;
DROP POLICY IF EXISTS ta_self_update ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_insert_manage ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_update_manage ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_update_self ON public.task_assignees;
DROP POLICY IF EXISTS task_assignees_delete_manage ON public.task_assignees;

CREATE POLICY task_assignees_select ON public.task_assignees
  FOR SELECT TO authenticated
  USING (public.can_select_employee_task_by_id(task_id));

CREATE POLICY task_assignees_insert_manage ON public.task_assignees
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_task_assignees(task_id)
    AND public.is_valid_task_assignee(task_id, employee_id)
  );

CREATE POLICY task_assignees_update_manage ON public.task_assignees
  FOR UPDATE TO authenticated
  USING (public.can_manage_task_assignees(task_id))
  WITH CHECK (public.can_manage_task_assignees(task_id));

CREATE POLICY task_assignees_update_self ON public.task_assignees
  FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_employee_id()
    AND public.can_select_employee_task_by_id(task_id)
  )
  WITH CHECK (
    employee_id = public.current_employee_id()
    AND public.can_select_employee_task_by_id(task_id)
  );

CREATE POLICY task_assignees_delete_manage ON public.task_assignees
  FOR DELETE TO authenticated
  USING (public.can_manage_task_assignees(task_id));

-- Feedback follows task visibility; authors can still insert/update/delete own
-- comments, but only against tasks they are allowed to see.
DROP POLICY IF EXISTS fb_select_all ON public.employee_task_feedbacks;
DROP POLICY IF EXISTS fb_select_by_task_scope ON public.employee_task_feedbacks;
CREATE POLICY fb_select_by_task_scope ON public.employee_task_feedbacks
  FOR SELECT TO authenticated
  USING (public.can_select_employee_task_by_id(task_id));

DROP POLICY IF EXISTS fb_author_insert ON public.employee_task_feedbacks;
CREATE POLICY fb_author_insert ON public.employee_task_feedbacks
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_select_employee_task_by_id(task_id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
