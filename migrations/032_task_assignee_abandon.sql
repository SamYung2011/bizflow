-- migration 032: task_assignees 加 abandoned_at（個人放棄狀態）
-- 跑：sudo docker exec -i supabase-db psql -U postgres -d postgres < 032_task_assignee_abandon.sql
-- 安全：可重跑（IF NOT EXISTS）

-- 多人任務 / 需核驗任務 場景下，每個 assignee 可以單獨放棄自己那份
-- 單人 + 不需核驗：直接走 employee_tasks.status='abandoned'（不用此欄位）
-- 多人 / 需核驗：B 放棄 → task_assignees.abandoned_at 設值，task.status 不變，creator 視角看到「[B 已放棄]」chip
ALTER TABLE task_assignees ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;

COMMENT ON COLUMN task_assignees.abandoned_at IS '個人放棄時間。單人不需核驗時不用此欄位（走 task.status=abandoned）；多人 / 需核驗時記錄每個 assignee 的放棄狀態。';
