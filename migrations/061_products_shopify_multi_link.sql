-- 061_products_shopify_multi_link.sql
-- 让一个 Shopify variant 可以关联多个 bizflow product（套餐场景）
-- 例：Shopify variant "DC国标快充 / EVA 收纳盒" → bizflow [ADP-0001 + 防水盒-product] 两行同时关联
--
-- 改动：
--   1. DROP UNIQUE 索引 idx_products_shopify_variant_id（migration 060 建的）
--   2. 加 shopify_qty 字段（这个 product 在 Shopify variant 中算几件，默认 1）
--   3. 加非 UNIQUE 普通索引（仍然需要按 variant_id 查 multiple products）
--
-- 后续：shopify_sync_order RPC 会改成查 products.shopify_variant_id 替代 line_item_aliases.alias_name
-- 但 RPC 改造单独 commit、需要 review 后再上 prod。这条 migration 先建好 schema 兼容路径

DROP INDEX IF EXISTS idx_products_shopify_variant_id;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shopify_qty integer DEFAULT 1;

-- 非 UNIQUE 普通索引，按 variant_id 查全部关联的 bizflow products
CREATE INDEX IF NOT EXISTS idx_products_shopify_variant_id_multi
  ON products (shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;
