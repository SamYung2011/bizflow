-- 080_companies_feature_ai_batch.sql
-- 2026-06-05 team 子應用「AI 整理文案 → 批量建任務」功能 feature flag
--
-- 背景：
-- 煊煊立項要 team 任務板塊加 AI 整理功能。明確「公司名字别写死」「权限先只给 Honnmono 的人用」。
-- 用 boolean flag 替代代碼 hardcode「Honnmono」，super admin 在 CompaniesView 勾選哪些公司開通。
-- 未來加新公司只需 UI 點開關，不改代碼。
--
-- 變更：
-- 1. companies 表加 feature_ai_batch boolean，默認 false
-- 2. Honnmono backfill = true（v1 開通的唯一公司）
-- 3. column-level GRANT：anon/authenticated 可 SELECT（前端按鈕需要查 flag 決定是否顯示）
--    UPDATE 權限只給 service_role（super admin 改 flag 走 service role？不，super admin 用自己的 authenticated token UPDATE。companies 表整體 RLS 已 admin-only 控制，這裡放開 UPDATE 給 authenticated）

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS feature_ai_batch boolean DEFAULT false NOT NULL;

UPDATE companies SET feature_ai_batch = true WHERE name = 'Honnmono';

-- companies 表 RLS 已在 migration 035 設好（只有 super admin 能 INSERT/UPDATE/DELETE）
-- 新欄位繼承同樣的 policy，無需單獨設定
