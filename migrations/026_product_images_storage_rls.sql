-- migration 026: product-images bucket 加 storage RLS（之前漏配，前端上傳報 row-level security violation）
-- 沿用 task-attachments 的策略：public read + authenticated upload/update/delete

DROP POLICY IF EXISTS "product-images-public-read" ON storage.objects;
DROP POLICY IF EXISTS "product-images-auth-upload" ON storage.objects;
DROP POLICY IF EXISTS "product-images-auth-update" ON storage.objects;
DROP POLICY IF EXISTS "product-images-auth-delete" ON storage.objects;

CREATE POLICY "product-images-public-read" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "product-images-auth-upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images-auth-update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images-auth-delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

-- 驗收：
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'product-images%';
