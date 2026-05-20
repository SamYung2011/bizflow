-- 063_invoices_customers_shopify_link.sql
-- 发票/客户 ↔ Shopify 直拉路径预备
--
-- 背景：
--   新方向 = bizflow edge function 直接调 Shopify Admin API 拉订单 + 客户，绕开 Make。
--   Make scenario 保留兜底（5/18 已挂过一次，单点不可靠）。
--   两边并行写 invoices 表，靠 shopify_order_id UNIQUE 防重。

-- invoices: shopify_order_id 防重 + 关联回 Shopify
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shopify_order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_shopify_order_id_uniq
  ON invoices (shopify_order_id) WHERE shopify_order_id IS NOT NULL;

-- customers: shopify_customer_id 关联（按 Shopify customer GID）
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS shopify_customer_id text;

CREATE INDEX IF NOT EXISTS idx_customers_shopify_customer_id
  ON customers (shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;
