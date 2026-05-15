-- 044: roles 表 + employee_companies.role_id
-- 背景：team subapp 引入 RBAC（職位 → 權限映射）。
-- 公司管理員定義本公司職位 + 給員工分配。
-- 權限點存 permissions JSONB 字段，未明確 true 的 = false（保守原則）。

BEGIN;

-- 1. roles 表
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS roles_company_id_idx ON public.roles(company_id);

-- 2. employee_companies 加 role_id
ALTER TABLE public.employee_companies
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_companies_role_id_idx
  ON public.employee_companies(role_id);

-- 3. RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- 所有 authenticated 可讀（前端 UI 需要顯示職位名）
DROP POLICY IF EXISTS roles_select_all ON public.roles;
CREATE POLICY roles_select_all ON public.roles
  FOR SELECT TO authenticated USING (true);

-- 寫：暫只 super admin（045 加 company admin 範圍）
DROP POLICY IF EXISTS roles_super_admin_write ON public.roles;
CREATE POLICY roles_super_admin_write ON public.roles
  FOR ALL TO authenticated
  USING (public.is_bf_admin())
  WITH CHECK (public.is_bf_admin());

-- 4. realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.roles;

-- 5. Honnmono 預設 3 個常用職位（煊煊上手用，可後續編輯/刪除）
-- 權限點命名約定：can_<action>
--   can_create_task          - 新建任務（自己作為 creator）
--   can_assign_others        - 給別人分配任務（不只是自己）
--   can_edit_others_tasks    - 修改別人創建/分配的任務
--   can_delete_others_tasks  - 刪除別人創建的任務
--   can_validate_task        - 核驗他人完成的任務
--   can_manage_employees     - 管理本公司員工（CRUD + 改職位）
--   can_approve_registration - 審核加入申請（task_pending）
--   can_view_commission      - 看佣金板塊
--   can_manage_roles         - 創建/編輯本公司職位
--   can_post_update_log      - 發更新日誌
DO $$
DECLARE
  honnmono_id uuid;
BEGIN
  SELECT id INTO honnmono_id FROM public.companies WHERE name = 'Honnmono' LIMIT 1;

  IF honnmono_id IS NOT NULL THEN
    -- 普通員工：基礎權限
    INSERT INTO public.roles (company_id, name, permissions) VALUES
      (honnmono_id, '普通員工', '{
        "can_create_task": true,
        "can_assign_others": false,
        "can_edit_others_tasks": false,
        "can_delete_others_tasks": false,
        "can_validate_task": false,
        "can_manage_employees": false,
        "can_approve_registration": false,
        "can_view_commission": false,
        "can_manage_roles": false,
        "can_post_update_log": false
      }'::jsonb)
    ON CONFLICT (company_id, name) DO NOTHING;

    -- 銷售：看佣金
    INSERT INTO public.roles (company_id, name, permissions) VALUES
      (honnmono_id, '銷售', '{
        "can_create_task": true,
        "can_assign_others": false,
        "can_edit_others_tasks": false,
        "can_delete_others_tasks": false,
        "can_validate_task": false,
        "can_manage_employees": false,
        "can_approve_registration": false,
        "can_view_commission": true,
        "can_manage_roles": false,
        "can_post_update_log": false
      }'::jsonb)
    ON CONFLICT (company_id, name) DO NOTHING;

    -- 主管：能分配、改、核驗別人任務
    INSERT INTO public.roles (company_id, name, permissions) VALUES
      (honnmono_id, '主管', '{
        "can_create_task": true,
        "can_assign_others": true,
        "can_edit_others_tasks": true,
        "can_delete_others_tasks": false,
        "can_validate_task": true,
        "can_manage_employees": false,
        "can_approve_registration": false,
        "can_view_commission": false,
        "can_manage_roles": false,
        "can_post_update_log": true
      }'::jsonb)
    ON CONFLICT (company_id, name) DO NOTHING;
  END IF;
END $$;

COMMIT;

-- 驗證
SELECT c.name AS company, r.name AS role, r.permissions
FROM public.roles r
JOIN public.companies c ON c.id = r.company_id
ORDER BY c.name, r.name;
