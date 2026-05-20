-- 059_shopify_settings.sql
-- 建 shopify_settings 单行表（id=1）+ column-level lock access_token
--
-- 背景：
-- bizflow ↔ Shopify 全面打通方案阶段 1。先做集成设置页（产品 tab → Shopify API），让 admin 自己粘 access token，
-- 不走 Telegram 传敏感字段。后续阶段 2 才接 GraphQL client 拉商品 / 订单。
--
-- 安全模式照 wa_settings migration 057：
-- A. access_token 不让 anon / authenticated SELECT、改走 Edge Function shopify-settings 用 service_role 读写
-- B. 解锁密码复用 wa_settings.admin_password（同一个 admin 密码、UI 体验一致）
-- C. PostgreSQL 坑：column-level REVOKE 撤不了 table-level GRANT，必须先 REVOKE 整表再 GRANT 显式列

CREATE TABLE IF NOT EXISTS shopify_settings (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_domain     text,
  access_token    text,
  api_version     text DEFAULT '2025-01',
  last_synced_at  timestamptz,
  updated_at      timestamptz DEFAULT now()
);

-- 初始化单行
INSERT INTO shopify_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE shopify_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopify_settings_select" ON shopify_settings;
CREATE POLICY "shopify_settings_select" ON shopify_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shopify_settings_update" ON shopify_settings;
CREATE POLICY "shopify_settings_update" ON shopify_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Column-level lock：撤 table-level、重新 grant 排除 access_token
REVOKE SELECT ON shopify_settings FROM anon, authenticated;
REVOKE UPDATE ON shopify_settings FROM anon, authenticated;

GRANT SELECT (id, shop_domain, api_version, last_synced_at, updated_at)
  ON shopify_settings TO anon, authenticated;

GRANT UPDATE (shop_domain, api_version, last_synced_at, updated_at)
  ON shopify_settings TO anon, authenticated;
