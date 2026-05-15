-- 042: 多公司關聯表 employee_companies
-- 背景：team subapp 引入「合作者」概念，1 個 employee 可綁多家 company。
-- 本表存「該員工在哪些公司」+「在每個公司的身份標記（is_company_admin / is_default）」。
-- role_id（職位）由 044 加。
--
-- 遷移策略：把現有 employees.company_id 灌進這張表，每人一行 + is_default=true。
-- 保留舊 employees.company_id 字段（兼容期），等所有代碼遷完再 cleanup migration 刪。

BEGIN;

-- 1. 建表
CREATE TABLE IF NOT EXISTS public.employee_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_company_admin BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, company_id)
);

CREATE INDEX IF NOT EXISTS employee_companies_employee_id_idx ON public.employee_companies(employee_id);
CREATE INDEX IF NOT EXISTS employee_companies_company_id_idx ON public.employee_companies(company_id);

-- 每個 employee 必須有且僅一行 is_default=true（partial unique index）
CREATE UNIQUE INDEX IF NOT EXISTS employee_companies_one_default
  ON public.employee_companies(employee_id) WHERE is_default = true;

-- 2. 回填：所有現有 employees.company_id 灌進來
--    is_default=true（每人一個主公司）
--    is_company_admin=false（暫無公司管理員，等煊煊手動指定）
INSERT INTO public.employee_companies (employee_id, company_id, is_default, is_company_admin)
SELECT id, company_id, true, false
FROM public.employees
WHERE company_id IS NOT NULL AND active = true
ON CONFLICT (employee_id, company_id) DO NOTHING;

-- 3. RLS
ALTER TABLE public.employee_companies ENABLE ROW LEVEL SECURITY;

-- 所有 authenticated 可讀（任務看板 / @ 提醒候選 / 員工列表 需要）
DROP POLICY IF EXISTS employee_companies_select_all ON public.employee_companies;
CREATE POLICY employee_companies_select_all ON public.employee_companies
  FOR SELECT TO authenticated USING (true);

-- 寫：暫只 super admin 全權（045 完整 RLS 時加 company admin 範圍）
DROP POLICY IF EXISTS employee_companies_super_admin_write ON public.employee_companies;
CREATE POLICY employee_companies_super_admin_write ON public.employee_companies
  FOR ALL TO authenticated
  USING (public.is_bf_admin())
  WITH CHECK (public.is_bf_admin());

-- 4. 加進 supabase_realtime publication（前端訂閱用）
ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_companies;

COMMIT;

-- 驗證
SELECT
  e.name,
  c.name AS company,
  ec.is_default,
  ec.is_company_admin
FROM public.employee_companies ec
JOIN public.employees e ON e.id = ec.employee_id
JOIN public.companies c ON c.id = ec.company_id
ORDER BY e.name;
