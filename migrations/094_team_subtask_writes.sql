-- 094: SU-sub-1 — 子任務新增 / 改標題 / 刪除真寫鏈
-- 新增由 SECURITY INVOKER RPC 原子寫 employee_tasks + task_assignees；
-- 子任務結構只允許父任務創建人、公司管理員或 super admin 管理。

BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_task_subtasks(p_parent_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_tasks parent
    WHERE parent.id = p_parent_task_id
      AND parent.parent_task_id IS NULL
      AND (
        public.is_bf_admin()
        OR public.is_admin_of_company(parent.company_id)
        OR (
          parent.creator_employee_id = public.current_employee_id()
          AND public.is_member_of_company(parent.company_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_insert_task_subtask(
  p_parent_task_id uuid,
  p_company_id uuid,
  p_department_id uuid,
  p_creator_employee_id uuid,
  p_needs_approval boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_tasks parent
    WHERE parent.id = p_parent_task_id
      AND parent.parent_task_id IS NULL
      AND parent.company_id = p_company_id
      AND parent.department_id IS NOT DISTINCT FROM p_department_id
      AND parent.creator_employee_id IS NOT DISTINCT FROM p_creator_employee_id
      AND parent.needs_approval = p_needs_approval
      AND public.can_manage_task_subtasks(parent.id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_task_subtasks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_insert_task_subtask(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_task_subtasks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_task_subtask(uuid, uuid, uuid, uuid, boolean) TO authenticated;

-- 普通頂級任務維持 047 的 creator=self 口徑；子任務另要求所有
-- scope / creator / approval 字段與父任務完全一致。
DROP POLICY IF EXISTS tasks_insert ON public.employee_tasks;
CREATE POLICY tasks_insert ON public.employee_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      parent_task_id IS NULL
      AND (
        public.is_bf_admin()
        OR (
          public.is_member_of_company(company_id)
          AND creator_employee_id = public.current_employee_id()
        )
      )
    )
    OR (
      parent_task_id IS NOT NULL
      AND public.can_insert_task_subtask(
        parent_task_id,
        company_id,
        department_id,
        creator_employee_id,
        needs_approval
      )
    )
  );

-- can_delete_others_tasks 繼續適用頂級任務；子任務結構不開代刪口子。
DROP POLICY IF EXISTS tasks_delete ON public.employee_tasks;
CREATE POLICY tasks_delete ON public.employee_tasks
  FOR DELETE TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_admin_of_company(company_id)
    OR (
      parent_task_id IS NULL
      AND (
        public.has_company_permission(company_id, 'can_delete_others_tasks')
        OR (
          public.is_member_of_company(company_id)
          AND creator_employee_id = public.current_employee_id()
        )
      )
    )
    OR (
      parent_task_id IS NOT NULL
      AND public.can_manage_task_subtasks(parent_task_id)
    )
  );

CREATE OR REPLACE FUNCTION public.create_employee_subtask(
  p_parent_task_id uuid,
  p_title text,
  p_assignee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_parent public.employee_tasks%ROWTYPE;
  v_subtask public.employee_tasks%ROWTYPE;
  v_assignment public.task_assignees%ROWTYPE;
BEGIN
  IF v_title = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Subtask title is required';
  END IF;

  SELECT * INTO v_parent
  FROM public.employee_tasks
  WHERE id = p_parent_task_id
    AND parent_task_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Parent task not found';
  END IF;
  IF NOT public.can_manage_task_subtasks(v_parent.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Subtask management permission required';
  END IF;
  IF NOT public.is_valid_task_assignee(v_parent.id, p_assignee_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Subtask assignee is outside the parent task scope';
  END IF;

  INSERT INTO public.employee_tasks (
    employee_id,
    parent_task_id,
    creator_employee_id,
    needs_approval,
    title,
    priority,
    status,
    company_id,
    department_id
  ) VALUES (
    p_assignee_id,
    v_parent.id,
    v_parent.creator_employee_id,
    v_parent.needs_approval,
    v_title,
    'none',
    'open',
    v_parent.company_id,
    v_parent.department_id
  )
  RETURNING * INTO v_subtask;

  INSERT INTO public.task_assignees (task_id, employee_id)
  VALUES (v_subtask.id, p_assignee_id)
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'task', to_jsonb(v_subtask),
    'assignee', to_jsonb(v_assignment)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_subtask_title(
  p_subtask_id uuid,
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_subtask public.employee_tasks%ROWTYPE;
  v_updated public.employee_tasks%ROWTYPE;
  v_editor uuid := public.current_employee_id();
BEGIN
  IF v_title = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Subtask title is required';
  END IF;

  SELECT * INTO v_subtask
  FROM public.employee_tasks
  WHERE id = p_subtask_id
    AND parent_task_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Subtask not found';
  END IF;
  IF NOT (
    public.is_bf_admin()
    OR public.is_admin_of_company(v_subtask.company_id)
    OR v_subtask.creator_employee_id = v_editor
    OR public.has_company_permission(v_subtask.company_id, 'can_edit_others_tasks')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Subtask title edit permission required';
  END IF;

  UPDATE public.employee_tasks
  SET title = v_title,
      title_edited_by = CASE
        WHEN v_subtask.creator_employee_id = v_editor THEN title_edited_by
        ELSE v_editor
      END,
      title_edited_at = CASE
        WHEN v_subtask.creator_employee_id = v_editor THEN title_edited_at
        ELSE now()
      END
  WHERE id = v_subtask.id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_employee_subtask(p_subtask_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_subtask public.employee_tasks%ROWTYPE;
  v_deleted public.employee_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_subtask
  FROM public.employee_tasks
  WHERE id = p_subtask_id
    AND parent_task_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Subtask not found';
  END IF;
  IF NOT public.can_manage_task_subtasks(v_subtask.parent_task_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Subtask management permission required';
  END IF;

  DELETE FROM public.employee_tasks
  WHERE id = v_subtask.id
  RETURNING * INTO v_deleted;

  RETURN to_jsonb(v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee_subtask(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_subtask_title(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_employee_subtask(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employee_subtask(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_subtask_title(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_subtask(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
