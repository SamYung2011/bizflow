-- 2026-04-23 Step 4 分仓库存 schema
-- 新建 warehouses / inventory_stock / inventory_movements 3 表 + RLS + 初始化数据

-- 1. warehouses（仓库主表）
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO warehouses (name, code, sort_order) VALUES
  ('香港分部', 'HK', 1),
  ('珠海分部', 'ZH', 2)
ON CONFLICT (code) DO NOTHING;

-- 2. inventory_stock（当前存量，每产品 × 每仓库唯一一行）
CREATE TABLE IF NOT EXISTS inventory_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS inventory_stock_product_idx ON inventory_stock(product_id);
CREATE INDEX IF NOT EXISTS inventory_stock_warehouse_idx ON inventory_stock(warehouse_id);

-- 3. inventory_movements（变动流水）
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  type TEXT,
  reason TEXT,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_idx ON inventory_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS inventory_movements_created_idx ON inventory_movements(created_at DESC);

-- 4. RLS (沿用现有 authenticated_all 模式)
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON warehouses;
CREATE POLICY "authenticated_all" ON warehouses FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON inventory_stock;
CREATE POLICY "authenticated_all" ON inventory_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON inventory_movements;
CREATE POLICY "authenticated_all" ON inventory_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. 初始化：AC 停售 21 件挂到香港（其他新品库存 = 0，等煊煊用 xlsx 数据导入）
INSERT INTO inventory_stock (product_id, warehouse_id, qty)
SELECT p.id, w.id, 21
FROM products p, warehouses w
WHERE p.internal_code = 'DSC-0001' AND w.code = 'HK'
ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = EXCLUDED.qty;
