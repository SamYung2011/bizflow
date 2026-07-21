-- 096: WAR-renew-1 — 發票商品行保修續保檔案與原子寫鏈

BEGIN;

CREATE TABLE IF NOT EXISTS public.warranty_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL REFERENCES public.invoices(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  months smallint NOT NULL CHECK (months IN (12, 24)),
  paid_at date NOT NULL,
  previous_end date NOT NULL,
  new_end date NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 刻意不設 UNIQUE(invoice_id, product_id)：同一發票商品可多次續保，created_at 最新一筆生效。
CREATE INDEX IF NOT EXISTS warranty_renewals_invoice_product_created_idx
  ON public.warranty_renewals(invoice_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warranty_renewals_customer_idx
  ON public.warranty_renewals(customer_id);

ALTER TABLE public.warranty_renewals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warranty_renewals_select ON public.warranty_renewals;
DROP POLICY IF EXISTS warranty_renewals_insert ON public.warranty_renewals;

CREATE POLICY warranty_renewals_select ON public.warranty_renewals
  FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access());

CREATE POLICY warranty_renewals_insert ON public.warranty_renewals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_bizflow_main_access()
    AND created_by = auth.uid()
  );

REVOKE ALL ON public.warranty_renewals FROM anon;
REVOKE UPDATE, DELETE ON public.warranty_renewals FROM authenticated;
GRANT SELECT, INSERT ON public.warranty_renewals TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_warranty_renewal()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_items jsonb;
  v_item jsonb;
  v_line_months integer;
  v_previous_end date;
BEGIN
  IF NOT public.has_bizflow_main_access() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Warranty renewal permission required';
  END IF;
  IF NEW.months IS NULL OR NEW.months NOT IN (12, 24) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty renewal months must be 12 or 24';
  END IF;
  IF NEW.paid_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty renewal payment date is required';
  END IF;
  IF NEW.invoice_id IS NULL OR NEW.product_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty renewal invoice and product are required';
  END IF;

  -- 鎖發票可讓同一張單的並發續保串行化；後到者會看見先到者的 new_end。
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Warranty invoice not found';
  END IF;
  IF v_invoice.customer_id IS NULL OR v_invoice.date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty invoice is incomplete';
  END IF;
  IF NEW.paid_at < v_invoice.date::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty renewal payment date cannot be earlier than invoice date';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Warranty product not found';
  END IF;

  v_items := COALESCE(to_jsonb(v_invoice.items), '[]'::jsonb);
  IF jsonb_typeof(v_items) = 'object' AND v_items ? 'root' THEN
    v_items := v_items->'root';
  ELSIF jsonb_typeof(v_items) = 'object' THEN
    v_items := jsonb_build_array(v_items);
  END IF;
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty invoice items are invalid';
  END IF;

  SELECT line.item INTO v_item
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS line(item, position)
  WHERE NULLIF(btrim(line.item->>'product_id'), '') = NEW.product_id::text
     OR lower(btrim(regexp_replace(COALESCE(line.item->>'name', ''), '[[:space:]]+-[[:space:]]+Default Title$', '', 'i')))
        = lower(btrim(regexp_replace(COALESCE(v_product.name, ''), '[[:space:]]+-[[:space:]]+Default Title$', '', 'i')))
  ORDER BY CASE WHEN NULLIF(btrim(line.item->>'product_id'), '') = NEW.product_id::text THEN 0 ELSE 1 END,
           line.position
  LIMIT 1;

  IF v_item IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty product is not present on the invoice';
  END IF;

  v_line_months := CASE
    WHEN COALESCE(v_item->>'warranty_months', '') ~ '^[0-9]+$' THEN (v_item->>'warranty_months')::integer
    ELSE COALESCE(v_product.warranty_months, 0)::integer
  END;
  IF v_line_months <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Warranty product has no warranty term';
  END IF;

  SELECT renewal.new_end INTO v_previous_end
  FROM public.warranty_renewals AS renewal
  WHERE renewal.invoice_id = NEW.invoice_id
    AND renewal.product_id = NEW.product_id
  ORDER BY renewal.created_at DESC, renewal.id DESC
  LIMIT 1;

  NEW.customer_id := v_invoice.customer_id;
  NEW.previous_end := COALESCE(
    v_previous_end,
    (v_invoice.date::date + make_interval(months => v_line_months))::date
  );
  NEW.new_end := (NEW.paid_at + make_interval(months => NEW.months))::date;
  NEW.created_by := auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_warranty_renewal ON public.warranty_renewals;
CREATE TRIGGER trg_apply_warranty_renewal
  BEFORE INSERT ON public.warranty_renewals
  FOR EACH ROW EXECUTE FUNCTION public.apply_warranty_renewal();

NOTIFY pgrst, 'reload schema';

COMMIT;
