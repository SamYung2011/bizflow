-- 2026-04-24 初始化库存
-- 源：F:/HONNMONO設計/Helen文件/网站设计/香港库存登记表修.xlsx
--   - 香港 row 695 = 2026-04-22
--   - 珠海 row 686 = 2026-04-21
--
-- 煊煊决定：
--   - 充電樁 9+9 件全算 RFID（方案 A）→ CHG-0001-01=9, CHG-0001-13=9 挂香港
--   - 配件（DC大扣/車cam/Magcar3/租槍/evo 等）不算库存，xlsx 这列全忽略，不入 DB

-- UPSERT inventory_stock + INSERT inventory_movements 流水（type='initial'）
WITH wh AS (
  SELECT code, id FROM warehouses WHERE code IN ('HK','ZH')
),
prod AS (
  SELECT internal_code, id FROM products WHERE internal_code IN (
    'ADP-0002','ADP-0003','DSC-0001','PTC-0001',
    'CBL-0001-01','CBL-0001-02','CBL-0001-03','CBL-0001-04',
    'CHG-0001-01','CHG-0001-13'
  )
),
target(internal_code, wh_code, qty) AS (VALUES
  -- ADP-0002 = GBT→CCS2 Adaptor Pro (xlsx "DC PRO(250A)")
  ('ADP-0002',    'HK', 46),
  ('ADP-0002',    'ZH',  5),
  -- ADP-0003 = GBT→TYPE2 Adaptor (xlsx "AC 2ND")
  ('ADP-0003',    'HK', 31),
  ('ADP-0003',    'ZH',  5),
  -- DSC-0001 = AC 停售（HK 21 已由 002 初始化，此处覆盖确认 + 补珠海 9）
  ('DSC-0001',    'HK', 21),
  ('DSC-0001',    'ZH',  9),
  -- PTC-0001 = Type2 便携式充電器（xlsx 備註「13A 單相魚雷款歐標便攜式隨車充」7 套）
  ('PTC-0001',    'HK',  7),
  ('PTC-0001',    'ZH',  0),
  -- CBL-0001-01..04 = Type2 充電綫 3/5/7/10 米（xlsx 備註「32A 線 3米/5米/7米/10米」1/3/3/1 套）
  ('CBL-0001-01', 'HK',  1),
  ('CBL-0001-01', 'ZH',  0),
  ('CBL-0001-02', 'HK',  3),
  ('CBL-0001-02', 'ZH',  0),
  ('CBL-0001-03', 'HK',  3),
  ('CBL-0001-03', 'ZH',  0),
  ('CBL-0001-04', 'HK',  1),
  ('CBL-0001-04', 'ZH',  0),
  -- CHG-0001-01 = Type2 充電樁 7kW 單相 5M RFID（xlsx「7kW 單相 5M = 7+2 = 9 件」全归 RFID）
  ('CHG-0001-01', 'HK',  9),
  ('CHG-0001-01', 'ZH',  0),
  -- CHG-0001-13 = Type2 充電樁 22kW 三相 5M RFID（xlsx「22kW 三相 5M = 3+6 = 9 件」全归 RFID）
  ('CHG-0001-13', 'HK',  9),
  ('CHG-0001-13', 'ZH',  0)
),
upserted AS (
  INSERT INTO inventory_stock (product_id, warehouse_id, qty, updated_at)
  SELECT prod.id, wh.id, t.qty, NOW()
  FROM target t
  JOIN prod ON prod.internal_code = t.internal_code
  JOIN wh   ON wh.code           = t.wh_code
  ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET qty = EXCLUDED.qty, updated_at = NOW()
  RETURNING product_id, warehouse_id, qty
)
INSERT INTO inventory_movements (product_id, warehouse_id, delta, type, reason)
SELECT product_id, warehouse_id, qty, 'initial', '2026-04-24 xlsx 初始化盘点'
FROM upserted
WHERE qty > 0;
