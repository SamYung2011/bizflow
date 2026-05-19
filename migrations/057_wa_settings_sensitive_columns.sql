-- 057_wa_settings_sensitive_columns.sql
-- 鎖 wa_settings 內 admin_password / openai_api_key 兩個敏感欄位的 column-level 權限
--
-- 背景（漏洞）：
-- 1. 前端 AppContext.jsx 用 select('*') 整行拉 wa_settings、admin_password + openai_api_key 進 localStorage 明文存
-- 2. anon 角色的 RLS policy 也允許整行 SELECT、攻擊者拿 anon key 直接 query 即可拿到明文
-- 3. 「解鎖密碼」UI 流程只是 client 端 if 判斷的視覺把戲（密碼明文已在 localStorage）
--
-- 修法：
-- A. 此 migration：撤 table-level SELECT/UPDATE、改 column-level GRANT 排除敏感欄位（PostgreSQL 坑：column-level REVOKE 撤不了 table-level GRANT、必須先撤整表再 grant 顯式列）
-- B. AppContext 改 explicit 列、不拉這兩個敏感欄位（前端 cache 不再含明文）
-- C. Edge Function wa-unlock：用 service_role 在 server 端比對 admin_password + 返回 / 修改 openai_api_key

-- 撤掉 table-level SELECT / UPDATE（service_role 不動、仍 superuser-like）
REVOKE SELECT ON wa_settings FROM anon, authenticated;
REVOKE UPDATE ON wa_settings FROM anon, authenticated;

-- 重新給予 column-level 權限（除 admin_password / openai_api_key 外的所有列）
GRANT SELECT (
  id, claude_mode, openai_base_url, model, max_history, max_replies_per_min,
  reply_delay_base, cooldown_minutes, bot_phone, boss_chat_name, daily_report_hour,
  system_prompt, boss_prompt, knowledge, updated_at, bot_name, chargers_prompt,
  location_hint_prompt, latest_ext_version
) ON wa_settings TO anon, authenticated;

GRANT UPDATE (
  claude_mode, openai_base_url, model, max_history, max_replies_per_min,
  reply_delay_base, cooldown_minutes, bot_phone, boss_chat_name, daily_report_hour,
  system_prompt, boss_prompt, knowledge, updated_at, bot_name, chargers_prompt,
  location_hint_prompt, latest_ext_version
) ON wa_settings TO anon, authenticated;
