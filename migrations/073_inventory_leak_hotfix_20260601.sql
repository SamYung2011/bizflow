-- 073_inventory_leak_hotfix_20260601.sql
-- Production stock correction for missed / duplicated deductions.
--
-- Idempotent by movement reason: if a correction movement with the same
-- product, warehouse, delta, type, and reason already exists, it will not be
-- inserted again, and inventory_stock will not be changed again.

BEGIN;

WITH target_warehouse AS (
  SELECT id AS warehouse_id
  FROM warehouses
  WHERE code = 'HK'
  LIMIT 1
),
fixes(internal_code, delta, reason) AS (
  VALUES
    ('9638845939995',  26, '2026-06-01 修正：5/22 ReferenceError 多扣 26'),
    ('10060549456155',  3, '2026-06-01 修正：清掉負庫存 -3 → 0'),
    ('10060549456155', -1, '2026-06-01 補扣：發票 296700 漏扣'),
    ('50464942719259', -1, '2026-06-01 補扣：發票 296700 漏扣')
),
resolved AS (
  SELECT p.id AS product_id, w.warehouse_id, f.delta, f.reason
  FROM fixes f
  JOIN products p ON p.internal_code = f.internal_code
  CROSS JOIN target_warehouse w
),
inserted AS (
  INSERT INTO inventory_movements(product_id, warehouse_id, delta, type, reason)
  SELECT r.product_id, r.warehouse_id, r.delta, 'adjust', r.reason
  FROM resolved r
  WHERE NOT EXISTS (
    SELECT 1
    FROM inventory_movements m
    WHERE m.product_id = r.product_id
      AND m.warehouse_id = r.warehouse_id
      AND m.delta = r.delta
      AND m.type = 'adjust'
      AND m.reason = r.reason
  )
  RETURNING product_id, warehouse_id, delta
),
stock_delta AS (
  SELECT product_id, warehouse_id, SUM(delta)::integer AS delta
  FROM inserted
  GROUP BY product_id, warehouse_id
)
INSERT INTO inventory_stock(product_id, warehouse_id, qty, updated_at)
SELECT product_id, warehouse_id, delta, now()
FROM stock_delta
ON CONFLICT (product_id, warehouse_id)
DO UPDATE SET
  qty = inventory_stock.qty + EXCLUDED.qty,
  updated_at = now();

UPDATE line_item_aliases
SET
  skip = false,
  note = '2026-06-01 修正：5/27 誤標 skip 已撤銷',
  updated_at = now()
WHERE lower(alias_name) = lower('GBT->CCS2 Adaptor Pro');

COMMIT;
