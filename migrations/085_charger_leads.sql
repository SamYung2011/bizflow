-- 085_charger_leads.sql
-- 充電樁購買意向表單 — 訂單銷售組下新子板塊（2026-06-25 立項）
-- 數據流：Framer 官網表單 → charger-intent edge function → 寫入本表
-- 狀態機（煊煊定：先做到「測量中」為止）：
--   interested(意向登記) → pending_visit(待安排上門) → visit_scheduled(已安排上門) → measuring(測量中)
-- 刻意獨立建表，不塞 invoices（發票=已成交單據，意向=線索，混一起會污染營收/庫存統計）

CREATE TABLE IF NOT EXISTS charger_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- 表單原始信息（冗餘存，列表不點進客戶也能看）
  name text,
  phone text,
  phone_mainland text,
  email text,
  charger_model text,              -- products 下拉（主充電樁，值如 Type2 EV Smart Charger）
  selected_products jsonb NOT NULL DEFAULT '[]'::jsonb, -- 7 個產品複選勾選的（DC Adaptor / AC Adaptor / Type2 V2L / Every Charge 4 in 1 / Type2 Charging Cord / Type2 Wall Charger / Type2 Portable）
  install_service text,            -- products 2 下拉（安裝服務：不加購 / 更換充電樁 / EHSS標準 / 全新拉線）
  car_make text,
  car_model text,
  address text,                    -- 地址（表單填「最近順豐站/派送地址」≈ 客戶地址，非必為安裝位置）
  referral text,                   -- 推薦人（表單字段名實為 Promo Code）
  -- 狀態機
  status text NOT NULL DEFAULT 'interested'
    CHECK (status IN ('interested', 'pending_visit', 'visit_scheduled', 'measuring', 'measured')),
  -- 上門估價階段填
  visit_scheduled_at timestamptz,  -- 安排的上門時間
  electrician_note text,           -- 電工 / 上門安排備註
  quoted_fee numeric,              -- 測量完成時填的安裝費報價（HK$）
  -- 雜項
  source_channel text NOT NULL DEFAULT 'framer',
  pending_merge_cid uuid,          -- 撞庫有歧義時標記待人工合併的老客戶 id（同 forms-buy 思路）
  admin_note text,                 -- 後台備註
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS charger_leads_status_idx ON charger_leads(status);
CREATE INDEX IF NOT EXISTS charger_leads_customer_id_idx ON charger_leads(customer_id);
CREATE INDEX IF NOT EXISTS charger_leads_created_at_idx ON charger_leads(created_at DESC);

-- updated_at 自動維護（同 customer_devices 模式）
CREATE OR REPLACE FUNCTION public.touch_charger_leads_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charger_leads_updated_at ON charger_leads;
CREATE TRIGGER trg_charger_leads_updated_at
  BEFORE UPDATE ON charger_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_charger_leads_updated_at();

-- RLS：bizflow 主站業務表統一白名單模式（同 invoices/customers，見 065）
ALTER TABLE charger_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY charger_leads_bizflow_main_access ON charger_leads FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());
