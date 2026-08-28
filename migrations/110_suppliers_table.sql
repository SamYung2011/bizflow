-- 110_suppliers_table.sql
-- Record the suppliers table that is already in production but was absent from
-- migration history. This migration is additive and safe on existing installs.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_url text,
  contact_person text,
  category text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'suppliers'
      AND policyname = 'suppliers_bizflow_main_access'
  ) THEN
    CREATE POLICY "suppliers_bizflow_main_access"
      ON public.suppliers
      FOR ALL
      TO authenticated
      USING (has_bizflow_main_access())
      WITH CHECK (has_bizflow_main_access());
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
