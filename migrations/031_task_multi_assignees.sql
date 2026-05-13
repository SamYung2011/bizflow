-- migration 031: 任務多人分配 + 核驗流程
-- 跑：sudo docker exec -i supabase-db psql -U postgres -d postgres < 031_task_multi_assignees.sql
-- 安全：可重跑（IF NOT EXISTS / WHERE NOT EXISTS 防重）

-- ============================
-- 1. employee_tasks 加列
-- ============================
-- 發布人（與 employee_id 區分；employee_id 保留作「主負責人」/ 舊數據兼容）
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS creator_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
-- 是否需要發布人核驗
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS needs_approval boolean NOT NULL DEFAULT false;
-- 核驗時間 / 核驗人
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES employees(id) ON DELETE SET NULL;

-- ============================
-- 2. 新表 task_assignees（多對多）
-- ============================
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id       uuid NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, employee_id)
);
CREATE INDEX IF NOT EXISTS task_assignees_employee_idx ON task_assignees(employee_id);
CREATE INDEX IF NOT EXISTS task_assignees_task_idx ON task_assignees(task_id);

-- ============================
-- 3. 數據遷移：把舊 employee_tasks.employee_id 同步到 task_assignees
-- ============================
INSERT INTO task_assignees (task_id, employee_id, completed_at, created_at)
SELECT t.id,
       t.employee_id,
       CASE WHEN t.status = 'done' THEN COALESCE(t.completed_at, t.created_at) ELSE NULL END,
       t.created_at
FROM employee_tasks t
WHERE t.employee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_assignees a
    WHERE a.task_id = t.id AND a.employee_id = t.employee_id
  );

-- creator_employee_id 缺省回填：舊任務沒有發布人記錄，用 employee_id 兜底
UPDATE employee_tasks SET creator_employee_id = employee_id
WHERE creator_employee_id IS NULL AND employee_id IS NOT NULL;

-- ============================
-- 4. helper function: 當前用戶是否是某任務的 assignee
-- ============================
CREATE OR REPLACE FUNCTION public.is_task_assignee(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM task_assignees a
    WHERE a.task_id = p_task_id
      AND a.employee_id = public.current_employee_id()
  );
$$;

-- 當前用戶是否是某任務的發布人
CREATE OR REPLACE FUNCTION public.is_task_creator(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employee_tasks t
    WHERE t.id = p_task_id
      AND t.creator_employee_id = public.current_employee_id()
  );
$$;

-- ============================
-- 5. employee_tasks RLS 補充：發布人 + assignee 全權
-- ============================
DROP POLICY IF EXISTS tasks_creator_all  ON employee_tasks;
DROP POLICY IF EXISTS tasks_assignee_rw  ON employee_tasks;

-- 發布人對自己發布的任務全權（改標題/截止/刪除/核驗）
CREATE POLICY tasks_creator_all ON employee_tasks FOR ALL TO authenticated
  USING (creator_employee_id = current_employee_id())
  WITH CHECK (creator_employee_id = current_employee_id());

-- assignee 對自己被分配的任務有 UPDATE 權（改自己的完成狀態走 task_assignees，但任務級字段如備註也允許）
CREATE POLICY tasks_assignee_rw ON employee_tasks FOR UPDATE TO authenticated
  USING (is_task_assignee(id))
  WITH CHECK (is_task_assignee(id));

-- ============================
-- 6. RLS for task_assignees
-- ============================
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ta_select_all      ON task_assignees;
DROP POLICY IF EXISTS ta_admin_all       ON task_assignees;
DROP POLICY IF EXISTS ta_creator_all     ON task_assignees;
DROP POLICY IF EXISTS ta_self_update     ON task_assignees;

-- 全員 SELECT（看協作）
CREATE POLICY ta_select_all ON task_assignees FOR SELECT TO authenticated USING (true);

-- admin 全權
CREATE POLICY ta_admin_all ON task_assignees FOR ALL TO authenticated
  USING (is_bf_admin()) WITH CHECK (is_bf_admin());

-- 任務發布人能增刪改 assignee（重新分配）
CREATE POLICY ta_creator_all ON task_assignees FOR ALL TO authenticated
  USING (is_task_creator(task_id))
  WITH CHECK (is_task_creator(task_id));

-- assignee 自己能改自己的 completed_at（勾完成 / 取消完成）
CREATE POLICY ta_self_update ON task_assignees FOR UPDATE TO authenticated
  USING (employee_id = current_employee_id())
  WITH CHECK (employee_id = current_employee_id());

-- ============================
-- 7. 約束：核驗人必須是發布人或 admin（軟約束，由前端保證；DB 不強制以免重跑卡住）
-- ============================
-- 註：approved_by 由前端在點「核驗通過」時填入 current_employee_id()，
--    通過 tasks_creator_all / admin RLS 控權，不額外加 CHECK 約束。

COMMENT ON COLUMN employee_tasks.creator_employee_id IS '任務發布人。舊數據回填 = employee_id。';
COMMENT ON COLUMN employee_tasks.needs_approval IS '完成後是否需要發布人核驗。false 時所有 assignee 完成即自動 status=done。';
COMMENT ON TABLE task_assignees IS '任務 ↔ 員工多對多分配表。每行記錄一個 assignee 的個人完成狀態。';
