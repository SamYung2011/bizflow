-- 056_task_title_edit_audit.sql
-- 任務標題由非 creator 修改時留痕。創建人自己改自己任務的標題不留痕。
-- 顯示於 EditTaskModal 底部，避免他人改標題後 assignee 一臉懵。

ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS title_edited_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title_edited_at timestamptz;
