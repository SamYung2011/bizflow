-- 086_northbound.sql
-- 港車北上：獨立訂單銷售板塊，先建表與 RLS，不直接改生產 DB。

CREATE TABLE IF NOT EXISTS northbound_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS northbound_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remarks text,
  submitted_at date,
  submitted_end_at date,
  name text NOT NULL,
  plate_no text,
  hkid text,
  phone_hk text,
  phone_mainland text,
  address text,
  hrp_no text,
  status_id uuid REFERENCES northbound_statuses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS northbound_records_status_id_idx ON northbound_records(status_id);
CREATE INDEX IF NOT EXISTS northbound_records_name_idx ON northbound_records(name);
CREATE INDEX IF NOT EXISTS northbound_records_plate_no_idx ON northbound_records(plate_no);
CREATE INDEX IF NOT EXISTS northbound_records_created_at_idx ON northbound_records(created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_northbound_records_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_northbound_records_updated_at ON northbound_records;
CREATE TRIGGER trg_northbound_records_updated_at
  BEFORE UPDATE ON northbound_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_northbound_records_updated_at();

INSERT INTO northbound_statuses (label, color, sort_order)
VALUES ('已付款', '#f43f5e', 10)
ON CONFLICT (label) DO NOTHING;

-- RLS：照 085_charger_leads，BizFlow 主站白名單使用者可讀寫。
ALTER TABLE northbound_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY northbound_statuses_bizflow_main_access ON northbound_statuses FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

ALTER TABLE northbound_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY northbound_records_bizflow_main_access ON northbound_records FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());
