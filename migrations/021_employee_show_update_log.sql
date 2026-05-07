-- migration 021: employees 加 show_update_log 開關，控制員工詳情頁是否顯示「更新日誌」子 tab
-- 默認 false（其他員工不顯示），目前僅 Helen 開啟
-- 部署：在自托管 Supabase SQL Editor 整段跑

ALTER TABLE employees ADD COLUMN IF NOT EXISTS show_update_log BOOLEAN NOT NULL DEFAULT false;

UPDATE employees SET show_update_log = true WHERE name = 'Helen';

-- 驗收：
-- SELECT name, show_update_log FROM employees ORDER BY show_update_log DESC, name;
