-- migration 030: 發票銷售佣金 — invoices 加 3 個字段
-- 跑：自托管 Supabase Studio → SQL Editor 貼整段執行
-- 安全：可重跑（IF NOT EXISTS）
--
-- 配置（hardcoded 在 src/App.jsx）：
--   COMMISSION_RULES = { '轉插': 600 }   每件 HKD
--   COMMISSION_CUTOFF = '2026-05-09'      此日期前發票不算佣金
--   百老匯渠道（notes 含 __BROADWAY__）不算佣金
--   無 salesperson_id 不算佣金
--
-- 計算時機：發票標 Paid 時 snapshot 寫入 commission_amount
-- 退款處理：admin 在員工詳情「佣金」tab 勾選 commission_reversed=true，月結扣回

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS salesperson_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_reversed boolean NOT NULL DEFAULT false;

-- 銷售人快速查詢索引（員工詳情頁拉自己的佣金列表用）
CREATE INDEX IF NOT EXISTS idx_invoices_salesperson
  ON invoices(salesperson_id)
  WHERE salesperson_id IS NOT NULL;

COMMENT ON COLUMN invoices.salesperson_id      IS '負責銷售（employees.id）。可空 = 無銷售歸屬，不算佣金';
COMMENT ON COLUMN invoices.commission_amount   IS '佣金 snapshot（HKD）。標 Paid 時按當時規則計算寫入，後續改規則不追溯';
COMMENT ON COLUMN invoices.commission_reversed IS 'admin 勾選扣回佣金（如退款）。月度合計時減去';
