-- migration 017: employee_tasks 也加 attachments jsonb（任务级附件）
-- 跟 employee_task_feedbacks.attachments 共用 task-attachments storage bucket

ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS attachments jsonb;
