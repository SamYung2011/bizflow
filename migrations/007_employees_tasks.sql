-- 2026-04-24 員工管理 + 員工任務
-- employees：員工主檔
-- employee_tasks：任務（含子任務 parent_task_id 自引用 + 反饋）

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES employee_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT,                          -- 描述 / deadline 自行寫進來
  priority TEXT NOT NULL DEFAULT 'none',   -- 'high' | 'none'
  status TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'done' | 'abandoned'
  feedback TEXT,                      -- 員工反饋（"A 派任務 B 太忙寫反饋"）
  sort_order INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_tasks_employee_idx ON employee_tasks(employee_id);
CREATE INDEX IF NOT EXISTS employee_tasks_parent_idx ON employee_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS employee_tasks_status_idx ON employee_tasks(status);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON employees;
CREATE POLICY "authenticated_all" ON employees FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON employee_tasks;
CREATE POLICY "authenticated_all" ON employee_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
