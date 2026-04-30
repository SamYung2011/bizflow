-- migration 016: 任務反饋附件 — 圖片/文檔挂在 comment 上
-- 1. employee_task_feedbacks 加 attachments jsonb（[{url, name, size, type}]）
-- 2. 创建 storage bucket task-attachments + 公共 RLS

ALTER TABLE employee_task_feedbacks ADD COLUMN IF NOT EXISTS attachments jsonb;

-- Storage bucket（public，跟 product-images 一样模式）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-attachments', 'task-attachments', true, 10485760, NULL)  -- 10MB 单文件限制，不限制 mime
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

-- Storage RLS：任何 authenticated 都能 upload，public 都能 read
DROP POLICY IF EXISTS "task-attachments-public-read"   ON storage.objects;
DROP POLICY IF EXISTS "task-attachments-auth-upload"   ON storage.objects;
DROP POLICY IF EXISTS "task-attachments-auth-delete"   ON storage.objects;

CREATE POLICY "task-attachments-public-read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'task-attachments');

CREATE POLICY "task-attachments-auth-upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-attachments');

CREATE POLICY "task-attachments-auth-delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'task-attachments');
