-- 062_shopify_variant_links.sql
-- bizflow products ↔ Shopify variants 之间从 1:1 改成 M:N
--
-- 背景：
--   migration 060 给 products 加 shopify_variant_id 单字段 → 一个 bizflow product 只能记一个 variant
--   实际场景：ADP-0001（DC 转插）同时出现在多个 Shopify 套餐 variant 里（紙盒 / EVA 收納盒）
--   也即：一个 bizflow product 可对多个 Shopify variant；一个 Shopify variant 可对多个 bizflow product（套餐）
--   单字段做不到，新建 M:N 关联表
--
-- products.shopify_* 字段保留但**不再写入**，作为历史 audit。所有关联走新表。

CREATE TABLE IF NOT EXISTS shopify_variant_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_variant_id    text NOT NULL,
  bizflow_product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_product_id    text,
  shopify_sku           text,
  qty                   integer NOT NULL DEFAULT 1,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- 一个 (variant, product) 对只能存一行（再次 link 走 ON CONFLICT update qty）
CREATE UNIQUE INDEX IF NOT EXISTS shopify_variant_links_pair_uniq
  ON shopify_variant_links (shopify_variant_id, bizflow_product_id);

-- 反查：按 variant 拿所有 components / 按 product 拿所有 linked variants
CREATE INDEX IF NOT EXISTS idx_shopify_variant_links_variant
  ON shopify_variant_links (shopify_variant_id);
CREATE INDEX IF NOT EXISTS idx_shopify_variant_links_product
  ON shopify_variant_links (bizflow_product_id);

-- RLS：仅 authenticated 可读写（admin UI 用）
ALTER TABLE shopify_variant_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopify_variant_links_select" ON shopify_variant_links;
CREATE POLICY "shopify_variant_links_select" ON shopify_variant_links FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shopify_variant_links_modify" ON shopify_variant_links;
CREATE POLICY "shopify_variant_links_modify" ON shopify_variant_links FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 迁数据：把现有 products.shopify_variant_id 关联 INSERT 进新表
INSERT INTO shopify_variant_links (shopify_variant_id, bizflow_product_id, shopify_product_id, shopify_sku, qty)
SELECT shopify_variant_id, id, shopify_product_id, shopify_sku, COALESCE(shopify_qty, 1)
FROM products
WHERE shopify_variant_id IS NOT NULL
ON CONFLICT (shopify_variant_id, bizflow_product_id) DO NOTHING;
