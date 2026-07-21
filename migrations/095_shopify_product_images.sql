-- 095: INV-img-1 — Shopify 商品主图使用独立公开读 bucket；写入只经 catalog Edge 签名入口。
-- 旧 product-images bucket 仍供老 React 端使用，本迁移不改变其既有策略。

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'shopify-product-images',
  'shopify-product-images',
  true,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "shopify-product-images-public-read" ON storage.objects;
DROP POLICY IF EXISTS "shopify-product-images-auth-upload" ON storage.objects;
DROP POLICY IF EXISTS "shopify-product-images-auth-update" ON storage.objects;
DROP POLICY IF EXISTS "shopify-product-images-auth-delete" ON storage.objects;

CREATE POLICY "shopify-product-images-public-read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'shopify-product-images');

-- 刻意不授予 anon/authenticated INSERT/UPDATE/DELETE：管理员浏览器先经
-- shopify-catalog-write 双门取得单路径签名，清理也由 service_role 代办。
