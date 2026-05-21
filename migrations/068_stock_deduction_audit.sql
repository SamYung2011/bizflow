-- 068: 庫存扣減人工審核 audit 表 + 補標 26 張漏標 legacy 的 2024 老發票
-- 2026-05-21
--
-- 背景：
-- bizflow 扣庫存只在「Unpaid → 手動 Mark Paid 按鈕」時觸發；任何路徑直接以 Paid 進 DB 的發票
-- （Shopify 同步 / 手動補錄歷史單 / 直接以 Paid 新建）永遠不扣庫存。截至發現時，58 張非 legacy
-- 中 35 張漏扣。
--
-- Phase 1（這個月）：撕掉「已 Paid 跳過」邏輯，改為任何 Paid 但未扣的單彈審核 modal，記錄人工
-- 的最終映射決定到 stock_deduction_audit。
--
-- Phase 2（一個月後）：根據 audit 數據統計 item_name → mapped_product_id 的高頻映射，切全自動。

-- ── 1. stock_deduction_audit 表 ───────────────────────────────────────
-- 每次人工審核扣減時，每個 line item 一行（不是一張單一行）
CREATE TABLE IF NOT EXISTS stock_deduction_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  item_name       TEXT NOT NULL,                  -- 審核時看到的原始 item.name
  mapped_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  mapped_qty      INTEGER,
  warehouse_id    UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  decision        TEXT NOT NULL,                  -- 'confirm' / 'skip' / 'manual_override'
  audited_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  audited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sda_invoice_idx     ON stock_deduction_audit(invoice_id);
CREATE INDEX IF NOT EXISTS sda_item_name_idx   ON stock_deduction_audit(item_name);
CREATE INDEX IF NOT EXISTS sda_audited_at_idx  ON stock_deduction_audit(audited_at DESC);

-- RLS：bizflow 主站獨有表，走 has_bizflow_main_access() 白名單（同 migration 065 模式）
ALTER TABLE stock_deduction_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all"               ON stock_deduction_audit;
DROP POLICY IF EXISTS "sda_bizflow_main_access"         ON stock_deduction_audit;
CREATE POLICY "sda_bizflow_main_access" ON stock_deduction_audit FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- ── 2. 補標 26 張漏標 legacy 的 2024 老發票 ──────────────────────────
-- 庫存改造日期 2026-04-23（migration 002 跑當天），那之前的發票本來應該全標 legacy_skip_deduct=true
-- 但有 26 張漏網（最早 2024-02-02，最晚 2024-05-11）
UPDATE invoices
SET    legacy_skip_deduct = true
WHERE  legacy_skip_deduct IS NOT TRUE
  AND  date < '2026-04-23';

-- ── 3. 刷新 PostgREST schema cache（新表才能被前端 select）──────────
NOTIFY pgrst, 'reload schema';
