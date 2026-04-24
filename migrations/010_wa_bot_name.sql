-- 2026-04-24 wa_settings 加 bot_name（AI 客服自稱的名字，注入進 SYSTEM_PROMPT）
ALTER TABLE wa_settings ADD COLUMN IF NOT EXISTS bot_name TEXT;
UPDATE wa_settings SET bot_name = 'Allen' WHERE id = 1 AND (bot_name IS NULL OR bot_name = '');
