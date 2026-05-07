-- migration 022: products 加 is_virtual 標記，押金/手續費等虛擬條目不進庫存預警
-- 部署：在自托管 Supabase SQL Editor 整段跑

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT false;

-- 驗收：
-- SELECT name, status, is_virtual FROM products WHERE is_virtual = true;
