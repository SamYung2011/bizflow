-- 036_employees_kind_and_pending.sql
-- 给 employees 加 kind 角色字段 + company_id 关联
-- 新建 task_pending 表收注册申请（admin 审核后迁到 employees）
-- 配合 team.honnmono.top 子应用项目（2026-05-14 立项）

-- 1. kind enum：employee（默认，主 bizflow 员工）/ task（仅子应用，注册申请来的）
DO $$ BEGIN
  CREATE TYPE employee_kind AS ENUM ('employee', 'task');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS kind employee_kind DEFAULT 'employee' NOT NULL;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_kind ON employees (kind);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees (company_id) WHERE company_id IS NOT NULL;

-- 现有 14+ 员工 kind='employee'（DEFAULT 兜底）+ company_id 回填到 Honnmono
UPDATE employees
SET company_id = (SELECT id FROM companies WHERE name = 'Honnmono')
WHERE company_id IS NULL;

-- 2. task_pending 表 — 注册申请池
CREATE TABLE IF NOT EXISTS task_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  company_name text NOT NULL,  -- 注册时填的原始字符串（admin 审核时再绑定到 companies）
  note text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- 已建 auth 用户的 id（注册时一并创建）
  requested_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved boolean,  -- null=待审 / true=已批准 / false=已拒绝
  reject_reason text
);

CREATE INDEX IF NOT EXISTS idx_task_pending_approved ON task_pending (approved);
CREATE INDEX IF NOT EXISTS idx_task_pending_requested_at ON task_pending (requested_at DESC);

ALTER TABLE task_pending ENABLE ROW LEVEL SECURITY;

-- admin 看全部 + 改全部
CREATE POLICY task_pending_admin_all ON task_pending
  FOR ALL
  TO authenticated
  USING (is_bf_admin())
  WITH CHECK (is_bf_admin());

-- 注册流程：anon 可 INSERT 自己的申请（子应用的注册页用 anon key）
CREATE POLICY task_pending_anon_insert ON task_pending
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 用户登录后可看自己的（用 email 匹配）
CREATE POLICY task_pending_self_read ON task_pending
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
