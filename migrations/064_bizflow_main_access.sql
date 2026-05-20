-- 064_bizflow_main_access.sql
-- bizflow 主站访问白名单：只让 5 个人能进，其他员工只能用 team 子应用
--
-- 配套：migration 065 改 bizflow 主站独有表 RLS、前端登入加 gate 跳 team.honnmono.top

-- 1. employees 加字段
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bizflow_main_access boolean DEFAULT false;

-- 2. 设白名单（按 name 匹配；admin 自动兜底）
UPDATE employees SET bizflow_main_access = true
WHERE is_admin = true
   OR name IN ('Helen', 'Shu Wang Yung', '朝哥', 'Amine', 'KC');

-- 3. helper：当前 auth user 是不是有 bizflow 主站权限
-- SECURITY DEFINER + search_path 固定（防 search_path 注入）
CREATE OR REPLACE FUNCTION has_bizflow_main_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS(
    SELECT 1 FROM employees
    WHERE user_id = auth.uid()
      AND (bizflow_main_access = true OR is_admin = true)
  );
$$;

GRANT EXECUTE ON FUNCTION has_bizflow_main_access() TO anon, authenticated;

-- 验证
SELECT name, role, is_admin, bizflow_main_access FROM employees ORDER BY bizflow_main_access DESC, is_admin DESC, name;
