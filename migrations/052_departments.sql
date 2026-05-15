-- 052: 部門系統 — 在公司層級之下再加部門隔離
-- 規則：
--   · super admin → 全見
--   · company admin（employee_companies.is_company_admin）→ 看自己公司所有部門
--   · 普通員工 → 只看自己所在部門的 + 任務 department_id IS NULL（公司內可見）
-- 設計：
--   · employee 可多部門（employee_departments 多對多）
--   · 任務 department_id NULL = 公司內可見；NOT NULL = 部門專屬
--   · 現有任務 department_id 留 NULL（行為不變）
--   · 給每個公司自動建一個「全員」部門，現有員工塞進去（admin 後續按需細分）

BEGIN;

-- 1. departments 表 — 公司下挂部門
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS departments_company_idx ON public.departments(company_id);

-- 2. employee_departments — 員工-部門多對多
CREATE TABLE IF NOT EXISTS public.employee_departments (
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, department_id)
);

CREATE INDEX IF NOT EXISTS emp_depts_dept_idx ON public.employee_departments(department_id);
CREATE INDEX IF NOT EXISTS emp_depts_emp_idx ON public.employee_departments(employee_id);

-- 3. employee_tasks 加 department_id（NULL = 公司內可見，NOT NULL = 部門專屬）
ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_department_idx ON public.employee_tasks(department_id);

-- 4. backfill：每個公司建「全員」部門，現有員工塞進去
DO $$
DECLARE
  co RECORD;
  d_id uuid;
BEGIN
  FOR co IN SELECT id FROM public.companies LOOP
    SELECT id INTO d_id FROM public.departments WHERE company_id = co.id AND name = '全員';
    IF d_id IS NULL THEN
      INSERT INTO public.departments (company_id, name)
      VALUES (co.id, '全員')
      RETURNING id INTO d_id;
    END IF;

    INSERT INTO public.employee_departments (employee_id, department_id)
    SELECT ec.employee_id, d_id
    FROM public.employee_companies ec
    WHERE ec.company_id = co.id
    ON CONFLICT (employee_id, department_id) DO NOTHING;
  END LOOP;
END $$;

-- 5. helper：當前員工是否在某部門
CREATE OR REPLACE FUNCTION public.is_member_of_department(dept_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_departments ed
    WHERE ed.employee_id = public.current_employee_id()
    AND ed.department_id = dept_id
  );
$$;

-- 6. RLS departments — 同公司成員可看，公司 admin 可 CRUD
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dept_select ON public.departments;
CREATE POLICY dept_select ON public.departments
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_member_of_company(company_id)
  );

DROP POLICY IF EXISTS dept_admin_all ON public.departments;
CREATE POLICY dept_admin_all ON public.departments
  FOR ALL TO authenticated
  USING (public.is_bf_admin() OR public.is_admin_of_company(company_id))
  WITH CHECK (public.is_bf_admin() OR public.is_admin_of_company(company_id));

-- 7. RLS employee_departments — 同公司可看綁定，該公司 admin 可改
ALTER TABLE public.employee_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emp_dept_select ON public.employee_departments;
CREATE POLICY emp_dept_select ON public.employee_departments
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id
      AND public.is_member_of_company(d.company_id)
    )
  );

DROP POLICY IF EXISTS emp_dept_admin_all ON public.employee_departments;
CREATE POLICY emp_dept_admin_all ON public.employee_departments
  FOR ALL TO authenticated
  USING (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id
      AND public.is_admin_of_company(d.company_id)
    )
  )
  WITH CHECK (
    public.is_bf_admin()
    OR EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_id
      AND public.is_admin_of_company(d.company_id)
    )
  );

-- 8. 升級 tasks_select_by_company：加部門過濾
-- · super admin → 全見
-- · company admin → 本公司全見（不卡部門）
-- · creator 永遠看得到自己創建的任務（防止「我發了部門外任務後自己看不到」）
-- · 普通員工 → company 成員 AND (department_id IS NULL OR 我在該部門)
DROP POLICY IF EXISTS tasks_select_by_company ON public.employee_tasks;
CREATE POLICY tasks_select_by_company ON public.employee_tasks
  FOR SELECT TO authenticated
  USING (
    public.is_bf_admin()
    OR public.is_admin_of_company(company_id)
    OR creator_employee_id = public.current_employee_id()
    OR (
      public.is_member_of_company(company_id)
      AND (
        department_id IS NULL
        OR public.is_member_of_department(department_id)
      )
    )
  );

-- 9. realtime publication（重跑 migration 時不報錯）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'departments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.departments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'employee_departments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_departments;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
