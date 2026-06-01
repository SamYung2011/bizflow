-- 072_customer_devices_and_charge_log.sql
-- Adapter Pro customer-device mapping + background charging logs.
-- Replaces the temporary customers.imei_code column with a normalized mapping table.

CREATE TABLE IF NOT EXISTS customer_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  imei text NOT NULL UNIQUE,
  device_type text NOT NULL DEFAULT 'adapter_pro',
  lufengzhe_userid text,
  lufengzhe_certid text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_devices_device_type_check
    CHECK (device_type IN ('adapter_pro', 'ac_charger', 'dash_cam')),
  CONSTRAINT customer_devices_imei_not_blank
    CHECK (length(trim(imei)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_customer_devices_customer_id
  ON customer_devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_devices_lufengzhe_userid
  ON customer_devices(lufengzhe_userid);
CREATE INDEX IF NOT EXISTS idx_customer_devices_lufengzhe_certid
  ON customer_devices(lufengzhe_certid);

CREATE OR REPLACE FUNCTION public.touch_customer_devices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_devices_updated_at ON customer_devices;
CREATE TRIGGER trg_customer_devices_updated_at
  BEFORE UPDATE ON customer_devices
  FOR EACH ROW EXECUTE FUNCTION public.touch_customer_devices_updated_at();

CREATE TABLE IF NOT EXISTS adapter_charge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_device_id uuid REFERENCES customer_devices(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  imei text NOT NULL,
  lufengzhe_userid text,
  lufengzhe_certid text,
  source text NOT NULL DEFAULT 'auto_polling',
  charge_start_at timestamptz NOT NULL,
  charge_end_at timestamptz,
  first_sample_at timestamptz NOT NULL DEFAULT now(),
  second_sample_at timestamptz,
  last_sample_at timestamptz NOT NULL DEFAULT now(),
  last_status_time timestamptz,
  first_charger_status integer,
  last_charger_status integer,
  first_watt numeric(14,3),
  second_watt numeric(14,3),
  last_watt numeric(14,3),
  total_kwh numeric(14,3),
  charger_raw text,
  duration_seconds integer,
  voltage numeric(14,3),
  amp numeric(14,3),
  progress_percent numeric(6,2),
  gps_wgs84_lat numeric(12,8),
  gps_wgs84_lng numeric(12,8),
  gps_gcj02_lat numeric(12,8),
  gps_gcj02_lng numeric(12,8),
  place_name text,
  place_address text,
  amap_link text,
  raw_status jsonb,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adapter_charge_log_source_check
    CHECK (source IN ('auto_polling', 'app_map_click')),
  CONSTRAINT adapter_charge_log_time_check
    CHECK (charge_end_at IS NULL OR charge_end_at >= charge_start_at)
);

CREATE INDEX IF NOT EXISTS idx_adapter_charge_log_open
  ON adapter_charge_log(customer_device_id)
  WHERE charge_end_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_adapter_charge_log_user_place
  ON adapter_charge_log(lufengzhe_userid, place_name);
CREATE INDEX IF NOT EXISTS idx_adapter_charge_log_started_at
  ON adapter_charge_log(charge_start_at DESC);
CREATE INDEX IF NOT EXISTS idx_adapter_charge_log_customer_id
  ON adapter_charge_log(customer_id);

CREATE OR REPLACE FUNCTION public.touch_adapter_charge_log_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_adapter_charge_log_updated_at ON adapter_charge_log;
CREATE TRIGGER trg_adapter_charge_log_updated_at
  BEFORE UPDATE ON adapter_charge_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_adapter_charge_log_updated_at();

CREATE OR REPLACE VIEW adapter_user_place_pref
WITH (security_invoker = true) AS
SELECT
  lufengzhe_userid,
  COALESCE(NULLIF(place_name, ''), NULLIF(place_address, ''), '未知位置') AS place,
  COUNT(*)::integer AS visit_count,
  MAX(COALESCE(charge_end_at, last_sample_at, charge_start_at)) AS last_visit_at,
  COALESCE(SUM(total_kwh), 0)::numeric(14,3) AS total_kwh
FROM adapter_charge_log
WHERE lufengzhe_userid IS NOT NULL
  AND COALESCE(NULLIF(place_name, ''), NULLIF(place_address, '')) IS NOT NULL
GROUP BY lufengzhe_userid, COALESCE(NULLIF(place_name, ''), NULLIF(place_address, ''), '未知位置');

ALTER TABLE customer_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE adapter_charge_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_devices_bizflow_main_access" ON customer_devices;
CREATE POLICY "customer_devices_bizflow_main_access" ON customer_devices FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "adapter_charge_log_bizflow_main_access" ON adapter_charge_log;
CREATE POLICY "adapter_charge_log_bizflow_main_access" ON adapter_charge_log FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

ALTER TABLE customers
  DROP COLUMN IF EXISTS imei_code;

NOTIFY pgrst, 'reload schema';
