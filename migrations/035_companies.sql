-- 035_companies.sql
-- 新增 companies 表 — admin 维护合作公司列表，task 用户按公司分圈
-- 配合 team.honnmono.top 子应用项目（2026-05-14 立项）

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  note text,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- 所有 authenticated 用户可读（task 用户也要看自己公司名）
CREATE POLICY companies_read_all ON companies
  FOR SELECT
  TO authenticated
  USING (true);

-- 只 admin 能写（INSERT/UPDATE/DELETE）
CREATE POLICY companies_admin_write ON companies
  FOR ALL
  TO authenticated
  USING (is_bf_admin())
  WITH CHECK (is_bf_admin());

-- 预填 Honnmono — 现有员工默认归属
INSERT INTO companies (name, note)
VALUES ('Honnmono', 'Honnmono Intl Ltd（内部员工默认归属）')
ON CONFLICT (name) DO NOTHING;
