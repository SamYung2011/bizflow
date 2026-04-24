-- 2026-04-24 修正 005 里充電樁 5M 档的 RFID/Wifi 拆分
-- 005 把 xlsx 5M 档两个 9 整个挂 RFID，实际 xlsx 备註里：
--   - 「Apps掛充」= Wifi 款
--   - 「歐錶掛充」= 欧标产品本身的冗余标签，没标 Apps 默认算 RFID 基础款
--   - 「RFID掛充」= RFID 款（已明确）
-- 重拆：
--   7kW 單相 5M：RFID 2（歐錶）/ Wifi 7（Apps）
--   22kW 三相 5M：RFID 3（xlsx 明确 RFID）/ Wifi 6（Apps）

WITH wh AS (
  SELECT code, id FROM warehouses WHERE code = 'HK'
),
prod AS (
  SELECT internal_code, id FROM products WHERE internal_code IN (
    'CHG-0001-01','CHG-0001-02','CHG-0001-13','CHG-0001-14'
  )
),
target(internal_code, qty) AS (VALUES
  ('CHG-0001-01', 2),  -- 7kW 單相 5M RFID  (歐錶 2)
  ('CHG-0001-02', 7),  -- 7kW 單相 5M Wifi  (Apps 7)
  ('CHG-0001-13', 3),  -- 22kW 三相 5M RFID (xlsx 明确 RFID 3)
  ('CHG-0001-14', 6)   -- 22kW 三相 5M Wifi (Apps 6)
),
before_qty AS (
  SELECT t.internal_code, prod.id AS product_id, wh.id AS warehouse_id, t.qty AS new_qty,
         COALESCE(s.qty, 0) AS old_qty
  FROM target t
  JOIN prod ON prod.internal_code = t.internal_code
  CROSS JOIN wh
  LEFT JOIN inventory_stock s ON s.product_id = prod.id AND s.warehouse_id = wh.id
),
upserted AS (
  INSERT INTO inventory_stock (product_id, warehouse_id, qty, updated_at)
  SELECT product_id, warehouse_id, new_qty, NOW()
  FROM before_qty
  ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET qty = EXCLUDED.qty, updated_at = NOW()
  RETURNING product_id, warehouse_id
)
INSERT INTO inventory_movements (product_id, warehouse_id, delta, type, reason)
SELECT product_id, warehouse_id, (new_qty - old_qty), 'adjustment',
       '2026-04-24 修正 005：Apps=Wifi / 歐錶=RFID 重拆 5M 档'
FROM before_qty
WHERE new_qty <> old_qty;
