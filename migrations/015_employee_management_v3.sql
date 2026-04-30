-- migration 015: 員工管理 v3 — 賬號分權 + 反饋線程（comments）+ 截止日期
-- 跑：sudo docker exec -i supabase-db psql -U postgres -d postgres < 015_employee_management_v3.sql
-- 安全：可重跑（IF NOT EXISTS / WHERE NOT EXISTS 防重）

-- ============================
-- 1. employees 加列
-- ============================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS employees_user_id_idx ON employees(user_id);

-- ============================
-- 2. employee_tasks 加 due_date
-- ============================
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS due_date date;

-- ============================
-- 3. 新表 employee_task_feedbacks（comments thread）
-- ============================
CREATE TABLE IF NOT EXISTS employee_task_feedbacks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
  author_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name     text,                                   -- 冗余存名字（auth user 删了仍能显示）
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_task_feedbacks_task_id_idx ON employee_task_feedbacks(task_id);
CREATE INDEX IF NOT EXISTS employee_task_feedbacks_author_idx ON employee_task_feedbacks(author_user_id);

-- ============================
-- 4. helper functions
-- ============================
-- 当前登录用户是否是 admin（按 employees.is_admin 反查）
CREATE OR REPLACE FUNCTION public.is_bf_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE((
    SELECT is_admin FROM employees
     WHERE user_id = auth.uid() AND active = true
     LIMIT 1
  ), false);
$$;

-- 当前登录用户对应的 employee.id
CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() AND active = true LIMIT 1;
$$;

-- 老 is_wa_admin 改成调 is_bf_admin（保持兼容，wa_* 表 RLS 不变）
CREATE OR REPLACE FUNCTION public.is_wa_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT public.is_bf_admin();
$$;

-- ============================
-- 5. 绑定 employees.user_id（hardcoded uuid 按 name match，可重跑）
-- ============================
UPDATE employees SET user_id = 'e98fa9f4-77e4-472b-a044-7a4b9698354c'::uuid, must_change_password = true WHERE name = 'azitour'       AND user_id IS DISTINCT FROM 'e98fa9f4-77e4-472b-a044-7a4b9698354c'::uuid;
UPDATE employees SET user_id = 'ffbdfca2-a7d1-4af9-a8c9-10796f40c5d1'::uuid, must_change_password = true WHERE name = 'KC'            AND user_id IS DISTINCT FROM 'ffbdfca2-a7d1-4af9-a8c9-10796f40c5d1'::uuid;
UPDATE employees SET user_id = '775368fe-79c3-45f2-a239-a88e5a67c5ba'::uuid, must_change_password = true WHERE name = 'vincent'       AND user_id IS DISTINCT FROM '775368fe-79c3-45f2-a239-a88e5a67c5ba'::uuid;
UPDATE employees SET user_id = '1727c7d2-0d49-4a4b-8bf7-5cdcbeee1bb0'::uuid, must_change_password = true WHERE name = 'hoey'          AND user_id IS DISTINCT FROM '1727c7d2-0d49-4a4b-8bf7-5cdcbeee1bb0'::uuid;
UPDATE employees SET user_id = 'e0f37d4e-deb2-4cf7-bcab-570ad3170c54'::uuid, must_change_password = true WHERE name = '朝哥'          AND user_id IS DISTINCT FROM 'e0f37d4e-deb2-4cf7-bcab-570ad3170c54'::uuid;

-- Helen (煊煊) → admin a1017339632@gmail.com
UPDATE employees SET user_id = '2f88a573-c4db-4b93-aadc-2a56106c5f9c'::uuid, is_admin = true WHERE name = 'Helen';

-- Shu Wang Yung (CEO) → samyung2011@gmail.com（已存在的 auth user）
UPDATE employees SET user_id = '2eec1a4a-a51e-40d9-a949-9b4bf4aa46a9'::uuid, is_admin = true WHERE name = 'Shu Wang Yung';

-- ============================
-- 6. 老 feedback 数据迁移（一次性，防重跑用 NOT EXISTS）
-- ============================
-- 4 条真实数据：author 标 admin (samyung uuid)
INSERT INTO employee_task_feedbacks (task_id, author_user_id, author_name, body, created_at)
SELECT t.id,
       '2eec1a4a-a51e-40d9-a949-9b4bf4aa46a9'::uuid,
       'admin',
       t.feedback,
       t.created_at
FROM employee_tasks t
WHERE t.feedback IS NOT NULL
  AND btrim(t.feedback) <> ''
  AND t.title NOT IN ('洗車 APP', '庫存預警', '库存预警')   -- 跳过测试垃圾 + 库存预警单独处理
  AND NOT EXISTS (SELECT 1 FROM employee_task_feedbacks fb WHERE fb.task_id = t.id);

-- 库存预警：手动写过 "Helen : ... / Amine : ..." 双人对话格式，拆 Helen 那条
INSERT INTO employee_task_feedbacks (task_id, author_user_id, author_name, body, created_at)
SELECT t.id,
       '2f88a573-c4db-4b93-aadc-2a56106c5f9c'::uuid,    -- Helen
       'Helen',
       '需要提供预警阀值',
       t.created_at
FROM employee_tasks t
WHERE t.title IN ('庫存預警', '库存预警')
  AND NOT EXISTS (SELECT 1 FROM employee_task_feedbacks fb WHERE fb.task_id = t.id);

-- 老 feedback text 字段保留作 backup（不删）
COMMENT ON COLUMN employee_tasks.feedback IS 'DEPRECATED 2026-04-30 (migration 015): 已迁移到 employee_task_feedbacks 表。保留作 backup，前端不再使用。';

-- ============================
-- 7. RLS for employee_tasks
-- ============================
DROP POLICY IF EXISTS authenticated_all ON employee_tasks;
DROP POLICY IF EXISTS tasks_select_all  ON employee_tasks;
DROP POLICY IF EXISTS tasks_admin_all   ON employee_tasks;
DROP POLICY IF EXISTS tasks_emp_own     ON employee_tasks;

ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;

-- 所有 authenticated 都能 SELECT 全部 task（员工能看协作）
CREATE POLICY tasks_select_all ON employee_tasks FOR SELECT TO authenticated USING (true);

-- admin 全权 INSERT/UPDATE/DELETE
CREATE POLICY tasks_admin_all ON employee_tasks FOR ALL TO authenticated
  USING (is_bf_admin())
  WITH CHECK (is_bf_admin());

-- 员工对自己 employee_id 的 task 全权
CREATE POLICY tasks_emp_own ON employee_tasks FOR ALL TO authenticated
  USING (employee_id = current_employee_id())
  WITH CHECK (employee_id = current_employee_id());

-- ============================
-- 8. RLS for employee_task_feedbacks
-- ============================
ALTER TABLE employee_task_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fb_select_all    ON employee_task_feedbacks;
DROP POLICY IF EXISTS fb_admin_all     ON employee_task_feedbacks;
DROP POLICY IF EXISTS fb_author_insert ON employee_task_feedbacks;
DROP POLICY IF EXISTS fb_author_modify ON employee_task_feedbacks;
DROP POLICY IF EXISTS fb_author_delete ON employee_task_feedbacks;

-- 所有 authenticated SELECT 全部
CREATE POLICY fb_select_all ON employee_task_feedbacks FOR SELECT TO authenticated USING (true);

-- admin 全权
CREATE POLICY fb_admin_all ON employee_task_feedbacks FOR ALL TO authenticated
  USING (is_bf_admin()) WITH CHECK (is_bf_admin());

-- 作者只能 INSERT 自己作者身份的 comment（author_user_id = auth.uid()）
CREATE POLICY fb_author_insert ON employee_task_feedbacks FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid());

-- 作者能改自己的 comment（编辑功能可选）
CREATE POLICY fb_author_modify ON employee_task_feedbacks FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());

-- 作者能删自己的 comment
CREATE POLICY fb_author_delete ON employee_task_feedbacks FOR DELETE TO authenticated
  USING (author_user_id = auth.uid());
