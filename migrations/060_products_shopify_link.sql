-- 060_products_shopify_link.sql
-- 给 products 表加 Shopify 关联字段。下一步同步脚本会用：
-- shopify_product_id / shopify_variant_id 走 GID 全量字符串（gid://shopify/Product/xxx）唯一标识
-- shopify_sku 冗余存 Shopify variant sku 字段（方便用 SKU 做兜底匹配）
-- needs_review 标记自动建出来 / 字段冲突需要人工审

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shopify_product_id  text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id  text,
  ADD COLUMN IF NOT EXISTS shopify_sku         text,
  ADD COLUMN IF NOT EXISTS needs_review        boolean DEFAULT false;

-- 走 shopify_variant_id 反查 bizflow product（订单同步 RPC 升级时会用）
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_variant_id
  ON products (shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;

-- product_id 不强制唯一（一个 Shopify product 可对多个 variant、bizflow 拆 SKU 后多行都指同一个 product_id 是合理的）
CREATE INDEX IF NOT EXISTS idx_products_shopify_product_id
  ON products (shopify_product_id) WHERE shopify_product_id IS NOT NULL;

-- needs_review 过滤索引（dashboard 查待审商品）
CREATE INDEX IF NOT EXISTS idx_products_needs_review
  ON products (needs_review) WHERE needs_review = true;
