-- migration 018: 反饋線程支持 reply（針對某一條反饋回復）
-- parent_feedback_id 自關聯，CASCADE 刪除：父刪了子也刪

ALTER TABLE employee_task_feedbacks
  ADD COLUMN IF NOT EXISTS parent_feedback_id uuid REFERENCES employee_task_feedbacks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS employee_task_feedbacks_parent_idx ON employee_task_feedbacks(parent_feedback_id);
