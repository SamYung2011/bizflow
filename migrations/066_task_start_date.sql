-- 2026-05-20: employee_tasks 加 start_date 字段
-- 配合現有 due_date 支持跨天任務在月曆視圖渲染為橫條（start_date → due_date）
-- nullable，與 due_date 任一可單獨存在；都為 NULL 表示「未排期」

ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS start_date date;

COMMENT ON COLUMN employee_tasks.start_date IS '任務開始日。與 due_date 配合，在日曆視圖渲染為跨天條';
