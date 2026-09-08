-- Production helper text from TASK-B appendix (2026-09-08), kept independent of migration 116.
CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT id FROM public.employees WHERE user_id = auth.uid() AND active = true LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_bf_admin() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT is_super_admin FROM public.employees WHERE user_id = auth.uid() AND active = true LIMIT 1), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_of_company(comp_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.employee_companies ec JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid() AND e.active = true AND ec.company_id = comp_id AND ec.is_company_admin = true);
$function$;

CREATE OR REPLACE FUNCTION public.is_member_of_company(comp_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.employee_companies ec JOIN public.employees e ON e.id = ec.employee_id
    WHERE e.user_id = auth.uid() AND e.active = true AND ec.company_id = comp_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_member_of_department(dept_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.employee_departments ed
    WHERE ed.employee_id = public.current_employee_id() AND ed.department_id = dept_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_select_employee_task(task_company_id uuid, task_department_id uuid, task_creator_employee_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.is_bf_admin() OR public.is_admin_of_company(task_company_id)
    OR task_creator_employee_id = public.current_employee_id()
    OR (public.is_member_of_company(task_company_id) AND (task_department_id IS NULL OR public.is_member_of_department(task_department_id)));
$function$;

CREATE OR REPLACE FUNCTION public.can_select_employee_task_by_id(p_task_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.employee_tasks t WHERE t.id = p_task_id
    AND public.can_select_employee_task(t.company_id, t.department_id, t.creator_employee_id));
$function$;
