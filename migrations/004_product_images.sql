-- 2026-04-23 产品图片：image_url 字段 + Storage bucket + RLS policy

-- 1. products 加 image_url 列
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Storage bucket: product-images（公开读，authenticated 写）
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policy
DROP POLICY IF EXISTS "Public read product-images" ON storage.objects;
CREATE POLICY "Public read product-images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Auth insert product-images" ON storage.objects;
CREATE POLICY "Auth insert product-images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Auth update product-images" ON storage.objects;
CREATE POLICY "Auth update product-images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Auth delete product-images" ON storage.objects;
CREATE POLICY "Auth delete product-images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');
