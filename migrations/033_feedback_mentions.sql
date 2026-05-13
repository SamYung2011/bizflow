-- migration 033: employee_task_feedbacks 加 @ 提醒機制
-- 跑：sudo docker exec -i supabase-db psql -U postgres -d postgres < 033_feedback_mentions.sql
-- 安全：可重跑

-- mentioned_user_ids：被 @ 的 auth.users.id 數組
ALTER TABLE employee_task_feedbacks ADD COLUMN IF NOT EXISTS mentioned_user_ids jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN employee_task_feedbacks.mentioned_user_ids IS '被 @ 的 auth.users.id 數組（JSON）。彈窗提醒邏輯：被 @ 且未看過 → 在 bizflow 入口右下角彈 toast';
