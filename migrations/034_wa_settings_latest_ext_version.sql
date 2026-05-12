-- 2026-05-12 雲端扩展版本自檢：wa_settings 加 latest_ext_version 字段
-- 扩展啟動 + 每 30 分鐘拉一次跟自己 chrome.runtime.getManifest().version 比對
-- 發版只需要 UPDATE 這一行 SQL（或 bizflow UI 改），不用 redeploy 前端

ALTER TABLE wa_settings ADD COLUMN IF NOT EXISTS latest_ext_version TEXT;
UPDATE wa_settings SET latest_ext_version = '1.3.1' WHERE id = 1 AND latest_ext_version IS NULL;
