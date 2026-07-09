-- 087_northbound_legacy_imports.sql
-- 港車北上：保存 Notion/舊表單全量原始欄位，避免只導入核心欄位後遺失客戶資料。

CREATE TABLE IF NOT EXISTS northbound_legacy_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_row_no integer NOT NULL,
  source_key text NOT NULL,
  source_hash text NOT NULL,
  record_id uuid REFERENCES northbound_records(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key)
);

CREATE INDEX IF NOT EXISTS northbound_legacy_imports_record_id_idx
  ON northbound_legacy_imports(record_id);

CREATE INDEX IF NOT EXISTS northbound_legacy_imports_source_idx
  ON northbound_legacy_imports(source);

CREATE OR REPLACE FUNCTION public.touch_northbound_legacy_imports_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_northbound_legacy_imports_updated_at ON northbound_legacy_imports;
CREATE TRIGGER trg_northbound_legacy_imports_updated_at
  BEFORE UPDATE ON northbound_legacy_imports
  FOR EACH ROW EXECUTE FUNCTION public.touch_northbound_legacy_imports_updated_at();

ALTER TABLE northbound_legacy_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS northbound_legacy_imports_bizflow_main_access
  ON northbound_legacy_imports;
CREATE POLICY northbound_legacy_imports_bizflow_main_access
  ON northbound_legacy_imports FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());
