-- 2026-05-20: task-attachments bucket 上傳上限 10MB → 30MB
-- 原 10MB 對手機原圖（3-15MB）動不動就 fail，「The object exceeded the maximum allowed size」
-- 30MB 足夠手機原圖 + 中型 PDF，不至於放開到讓人傳超大視頻塞滿 storage

UPDATE storage.buckets
SET file_size_limit = 31457280  -- 30 MB
WHERE name = 'task-attachments';
