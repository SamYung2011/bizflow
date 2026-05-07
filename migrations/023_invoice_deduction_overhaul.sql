-- migration 023: 發票扣庫存大改造
-- 1. invoices 加 legacy_skip_deduct，所有現存發票標 true（歷史一律不扣）
-- 2. 新表 line_item_aliases：發票 line item name → bizflow products 映射
--    支持 1:1（單品）/ 1:N（套裝）/ skip（押金/運費/分期尾款/租務）
-- 部署：在自托管 Supabase SQL Editor 整段跑

BEGIN;

-- ============================
-- 1. invoices.legacy_skip_deduct
-- ============================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS legacy_skip_deduct BOOLEAN NOT NULL DEFAULT false;

-- 把當前所有已存在發票標 legacy（修好邏輯前的單子全部不扣）
UPDATE invoices SET legacy_skip_deduct = true WHERE legacy_skip_deduct = false;

CREATE INDEX IF NOT EXISTS invoices_legacy_idx ON invoices(legacy_skip_deduct) WHERE legacy_skip_deduct = false;

-- ============================
-- 2. line_item_aliases 表
-- ============================
-- alias_name: 發票 items 裡出現的 name（例如 "GBT->CCS2 Adaptor"）
-- skip: true 則此 alias 不扣庫存（押金/運費/Final Payment/租務）
-- products: JSONB 數組，[{product_id, qty}, ...]
--   單品  → 一條 {product_id, qty: 1}
--   套裝  → 多條 {product_id, qty: N}
--   skip  → 通常 [] 即可
CREATE TABLE IF NOT EXISTS line_item_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_name  text NOT NULL UNIQUE,
  skip        boolean NOT NULL DEFAULT false,
  products    jsonb NOT NULL DEFAULT '[]'::jsonb,
  note        text,                          -- 可選備註，例如 "DC Adaptor 2nd 首付"
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 不區分大小寫 / trim 查詢用
CREATE INDEX IF NOT EXISTS line_item_aliases_normalized_idx
  ON line_item_aliases(LOWER(TRIM(alias_name)));

-- ============================
-- 3. RLS
-- ============================
ALTER TABLE line_item_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lia_authenticated_all ON line_item_aliases;
CREATE POLICY lia_authenticated_all ON line_item_aliases FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;

-- 驗收：
-- SELECT COUNT(*) AS legacy_count, COUNT(*) FILTER (WHERE legacy_skip_deduct = false) AS new_count FROM invoices;
--   期望：legacy_count = 全量, new_count = 0
-- SELECT * FROM line_item_aliases LIMIT 5;
--   期望：空表（後續通過前端管理頁填）
