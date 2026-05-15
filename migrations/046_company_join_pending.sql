-- 046: 跨公司加入申請表 company_join_pending
-- 背景：員工想加入第二/多個公司（成為合作者），需向目標公司的 admin 提申請。
-- admin 通過 → 在 employee_companies 加一行（is_default=false）。
-- 不複用 task_pending（那個是新人註冊，employee 還不存在；本表是 employee 已存在 + 想加新公司）。

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_join_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by uuid,  -- auth.users.id
  approved BOOLEAN,
  reject_reason TEXT,
  UNIQUE (employee_id, company_id)
);

CREATE INDEX IF NOT EXISTS company_join_pending_employee_idx ON public.company_join_pending(employee_id);
CREATE INDEX IF NOT EXISTS company_join_pending_company_idx ON public.company_join_pending(company_id);

-- RLS
ALTER TABLE public.company_join_pending ENABLE ROW LEVEL SECURITY;

-- SELECT：本人能看自己的 / super admin 全開 / 該公司 admin 看本公司的申請
DROP POLICY IF EXISTS company_join_pending_select ON public.company_join_pending;
CREATE POLICY company_join_pending_select ON public.company_join_pending
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = company_join_pending.employee_id AND e.user_id = auth.uid())
    OR public.is_admin_of_company(company_id)
  );

-- INSERT：自己給自己創（employee_id 必須是當前 user 的）
DROP POLICY IF EXISTS company_join_pending_insert_self ON public.company_join_pending;
CREATE POLICY company_join_pending_insert_self ON public.company_join_pending
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.employees e WHERE e.id = company_join_pending.employee_id AND e.user_id = auth.uid())
  );

-- UPDATE：super admin 或 該公司 admin 審批
DROP POLICY IF EXISTS company_join_pending_admin_update ON public.company_join_pending;
CREATE POLICY company_join_pending_admin_update ON public.company_join_pending
  FOR UPDATE TO authenticated
  USING (public.is_bf_admin() OR public.is_admin_of_company(company_id))
  WITH CHECK (public.is_bf_admin() OR public.is_admin_of_company(company_id));

-- DELETE：本人撤回 / super admin / 該公司 admin
DROP POLICY IF EXISTS company_join_pending_delete ON public.company_join_pending;
CREATE POLICY company_join_pending_delete ON public.company_join_pending
  FOR DELETE TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = company_join_pending.employee_id AND e.user_id = auth.uid())
    OR public.is_admin_of_company(company_id)
  );

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_join_pending;

COMMIT;
