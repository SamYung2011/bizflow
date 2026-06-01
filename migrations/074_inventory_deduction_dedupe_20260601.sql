-- 074_inventory_deduction_dedupe_20260601.sql
-- Clean duplicate inventory deduction records created during repeated mark-paid clicks.
--
-- Important:
-- - Do not modify inventory_stock.qty here. Stock quantities were already corrected
--   by migration 073_inventory_leak_hotfix_20260601.sql.
-- - This migration only removes duplicate history rows from:
--   1) inventory_movements, type='sale'
--   2) stock_deduction_audit
-- - Idempotent: rerunning leaves no further rows to delete.

BEGIN;

-- inventory_movements:
-- For duplicated sale movements on the same invoice + product + warehouse,
-- keep the earliest row as the canonical "deducted once" record and remove
-- later duplicates. Do not roll the stock number forward/back.
WITH ranked_sale_movements AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY invoice_id, product_id, warehouse_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY invoice_id, product_id, warehouse_id
    ) AS group_count
  FROM inventory_movements
  WHERE type = 'sale'
    AND invoice_id IS NOT NULL
)
DELETE FROM inventory_movements m
USING ranked_sale_movements r
WHERE m.id = r.id
  AND r.group_count > 1
  AND r.rn > 1;

-- stock_deduction_audit:
-- Use the exact mapped shape as the dedupe key, not only item_name.
-- Some line items legitimately map to multiple products; collapsing by
-- invoice_id + item_name + decision would delete valid package-component rows.
--
-- Invoice 296700 is special: its audit rows were false "confirm" rows with no
-- matching sale movement because product/warehouse was missing at deduction time.
-- Delete all its audit rows instead of retaining misleading history. Migration
-- 073 already records the manual stock correction as adjust movements.
WITH invoice_296700 AS (
  SELECT id AS invoice_id
  FROM invoices
  WHERE invoice_number::text = '296700'
  LIMIT 1
),
ranked_audit AS (
  SELECT
    id,
    invoice_id,
    ROW_NUMBER() OVER (
      PARTITION BY invoice_id, item_name, mapped_product_id, warehouse_id, mapped_qty, decision
      ORDER BY audited_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY invoice_id, item_name, mapped_product_id, warehouse_id, mapped_qty, decision
    ) AS group_count
  FROM stock_deduction_audit
  WHERE invoice_id IS NOT NULL
)
DELETE FROM stock_deduction_audit a
USING ranked_audit r
WHERE a.id = r.id
  AND (
    r.invoice_id IN (SELECT invoice_id FROM invoice_296700)
    OR (r.group_count > 1 AND r.rn > 1)
  );

COMMIT;
