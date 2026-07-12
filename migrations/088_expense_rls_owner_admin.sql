-- 088: Restore owner/admin boundaries after 065 broadened expenses to every
-- bizflow_main_access user. Safe to rerun.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_admin_expenses() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT e.is_super_admin = true
      OR e.is_admin = true
      OR lower(COALESCE(e.email, auth.jwt() ->> 'email', '')) = 'samyung2011@gmail.com'
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.active = true
    LIMIT 1
  ), false);
$$;

ALTER TABLE public.expense_reimbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_reimbursements_bizflow_main_access ON public.expense_reimbursements;
DROP POLICY IF EXISTS exp_reimb_select ON public.expense_reimbursements;
DROP POLICY IF EXISTS exp_reimb_insert ON public.expense_reimbursements;
DROP POLICY IF EXISTS exp_reimb_update_self ON public.expense_reimbursements;
DROP POLICY IF EXISTS exp_reimb_delete_self ON public.expense_reimbursements;
DROP POLICY IF EXISTS exp_reimb_admin_all ON public.expense_reimbursements;

CREATE POLICY exp_reimb_select ON public.expense_reimbursements
  FOR SELECT TO authenticated
  USING (
    public.has_bizflow_main_access()
    AND (employee_id = public.current_employee_id() OR public.can_admin_expenses())
  );

CREATE POLICY exp_reimb_insert ON public.expense_reimbursements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_bizflow_main_access()
    AND employee_id = public.current_employee_id()
  );

CREATE POLICY exp_reimb_update_self ON public.expense_reimbursements
  FOR UPDATE TO authenticated
  USING (
    public.has_bizflow_main_access()
    AND employee_id = public.current_employee_id()
    AND status = 'pending'
  )
  WITH CHECK (
    public.has_bizflow_main_access()
    AND employee_id = public.current_employee_id()
    AND status = 'pending'
  );

CREATE POLICY exp_reimb_delete_self ON public.expense_reimbursements
  FOR DELETE TO authenticated
  USING (
    public.has_bizflow_main_access()
    AND employee_id = public.current_employee_id()
    AND status = 'pending'
  );

CREATE POLICY exp_reimb_admin_all ON public.expense_reimbursements
  FOR ALL TO authenticated
  USING (public.has_bizflow_main_access() AND public.can_admin_expenses())
  WITH CHECK (public.has_bizflow_main_access() AND public.can_admin_expenses());

-- Receipt writes are also owner-scoped. Public read remains the accepted
-- Expense contract; browser writes cannot target another employee directory.
DROP POLICY IF EXISTS expense_receipts_auth_upload ON storage.objects;
DROP POLICY IF EXISTS expense_receipts_auth_update ON storage.objects;
DROP POLICY IF EXISTS expense_receipts_auth_delete ON storage.objects;

CREATE POLICY expense_receipts_auth_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.current_employee_id()::text
  );

CREATE POLICY expense_receipts_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.current_employee_id()::text
  )
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.current_employee_id()::text
  );

CREATE POLICY expense_receipts_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.current_employee_id()::text
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
