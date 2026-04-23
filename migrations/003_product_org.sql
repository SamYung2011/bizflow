-- 2026-04-23 Step 5 产品详情页：商品組織分類 3 字段
-- 加 product_type / collections (text[]) / tags (text[]) 3 列

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS collections TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- 初始化：按 category 填默认 product_type + collections + tags（只改新产品，_archived 老货不动）
UPDATE products SET
  product_type = 'EV',
  collections = ARRAY['所有產品', '轉插'],
  tags = ARRAY['Adaptor']
WHERE category = '轉插';

UPDATE products SET
  product_type = 'EV',
  collections = ARRAY['所有產品', '充電線'],
  tags = ARRAY['Cable']
WHERE category = '充電線';

UPDATE products SET
  product_type = 'EV',
  collections = ARRAY['所有產品', '便攜充電'],
  tags = ARRAY['Portable Charger']
WHERE category = '便攜充電';

UPDATE products SET
  product_type = 'EV',
  collections = ARRAY['所有產品', '充電樁'],
  tags = ARRAY['Wall Charger']
WHERE category = '充電樁';
