-- 2026-04-23 产品 + 库存重建：老 198 条归档 + 新 33 行（5 平级 + 充電綫 1+4 + 充電樁 1+18 + AC 停售）
-- 跑之前已备份 products 到 F:/Claude_demo/backups/products_backup_2026-04-23.json

-- 1. schema 加列
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_product_id UUID REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_code TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
CREATE INDEX IF NOT EXISTS products_parent_id_idx ON products(parent_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_internal_code_uniq ON products(internal_code) WHERE internal_code IS NOT NULL;

-- 2. 归档老 198 条（category 原本都是 null，覆盖无损失）
UPDATE products SET category = '_archived' WHERE category IS DISTINCT FROM '_archived';

-- 3. 平级 5 条
INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status) VALUES
  (gen_random_uuid(), 'GBT→CCS2 Adaptor',        6588, 0, 24, '轉插',     'ADP-0001', 'active'),
  (gen_random_uuid(), 'GBT→CCS2 Adaptor Pro',    7888, 0, 24, '轉插',     'ADP-0002', 'active'),
  (gen_random_uuid(), 'GBT→TYPE2 Adaptor',        698, 0, 12, '轉插',     'ADP-0003', 'active'),
  (gen_random_uuid(), 'Type2 便携式充電器',      1688, 0, 12, '便攜充電', 'PTC-0001', 'active'),
  (gen_random_uuid(), 'Type2 便携式充電器 Pro',  1688, 0, 12, '便攜充電', 'PTC-0002', 'active');

-- 4. Type2 EV 充電綫 父 + 4 子
WITH p AS (
  INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status)
  VALUES (gen_random_uuid(), 'Type2 EV 充電綫', 0, 0, 12, '充電線', 'CBL-0001', 'active')
  RETURNING id
)
INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status, parent_product_id)
SELECT gen_random_uuid(), n, pr, 0, 12, '充電線', c, 'active', p.id FROM p, (VALUES
  ('Type2 EV 充電綫 3米',  1088, 'CBL-0001-01'),
  ('Type2 EV 充電綫 5米',  1388, 'CBL-0001-02'),
  ('Type2 EV 充電綫 7米',  1688, 'CBL-0001-03'),
  ('Type2 EV 充電綫 10米', 2138, 'CBL-0001-04')
) AS t(n,pr,c);

-- 5. Type2 充電樁 父 + 18 子
WITH p AS (
  INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status)
  VALUES (gen_random_uuid(), 'Type2 充電樁', 0, 0, 24, '充電樁', 'CHG-0001', 'active')
  RETURNING id
)
INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status, parent_product_id)
SELECT gen_random_uuid(), n, pr, 0, 24, '充電樁', c, 'active', p.id FROM p, (VALUES
  ('Type2 充電樁 7kW 單相 5M RFID',  3688, 'CHG-0001-01'),
  ('Type2 充電樁 7kW 單相 5M Wifi',  4688, 'CHG-0001-02'),
  ('Type2 充電樁 7kW 單相 7M RFID',  3888, 'CHG-0001-03'),
  ('Type2 充電樁 7kW 單相 7M Wifi',  4888, 'CHG-0001-04'),
  ('Type2 充電樁 7kW 單相 10M RFID', 4188, 'CHG-0001-05'),
  ('Type2 充電樁 7kW 單相 10M Wifi', 5188, 'CHG-0001-06'),
  ('Type2 充電樁 11kW 三相 5M RFID', 3988, 'CHG-0001-07'),
  ('Type2 充電樁 11kW 三相 5M Wifi', 4988, 'CHG-0001-08'),
  ('Type2 充電樁 11kW 三相 7M RFID', 4188, 'CHG-0001-09'),
  ('Type2 充電樁 11kW 三相 7M Wifi', 5188, 'CHG-0001-10'),
  ('Type2 充電樁 11kW 三相 10M RFID',4488, 'CHG-0001-11'),
  ('Type2 充電樁 11kW 三相 10M Wifi',5488, 'CHG-0001-12'),
  ('Type2 充電樁 22kW 三相 5M RFID', 4288, 'CHG-0001-13'),
  ('Type2 充電樁 22kW 三相 5M Wifi', 5288, 'CHG-0001-14'),
  ('Type2 充電樁 22kW 三相 7M RFID', 4488, 'CHG-0001-15'),
  ('Type2 充電樁 22kW 三相 7M Wifi', 5488, 'CHG-0001-16'),
  ('Type2 充電樁 22kW 三相 10M RFID',4788, 'CHG-0001-17'),
  ('Type2 充電樁 22kW 三相 10M Wifi',5788, 'CHG-0001-18')
) AS t(n,pr,c);

-- 6. AC 停售挂 21 件
INSERT INTO products (id, name, price, stock, warranty_months, category, internal_code, status) VALUES
  (gen_random_uuid(), 'AC Adaptor（停售）', 698, 21, 12, '停售', 'DSC-0001', 'discontinued');
