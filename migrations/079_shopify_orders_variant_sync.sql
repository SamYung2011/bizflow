-- 079_shopify_orders_variant_sync.sql
-- Shopify orders polling path:
-- - Keep the old shopify_sync_order(...) Make entrypoint signature stable.
-- - Add a PII-free API entrypoint that writes Shopify order/customer IDs.
-- - Deduct inventory by shopify_variant_links.shopify_variant_id, not alias text.
-- - Do not fuzzy-match customers in SQL; use deterministic Shopify ID / email / phone only.

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shopify_customer_id text;

CREATE INDEX IF NOT EXISTS idx_invoices_shopify_customer_id
  ON invoices (shopify_customer_id)
  WHERE shopify_customer_id IS NOT NULL;

-- Existing prod data has no duplicate invoice_number. This closes the Make/API race.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_uniq
  ON invoices (invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS shopify_order_sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shopify_order_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopify_order_sync_state_bizflow_main_access" ON shopify_order_sync_state;
CREATE POLICY "shopify_order_sync_state_bizflow_main_access"
  ON shopify_order_sync_state
  FOR SELECT TO authenticated
  USING (has_bizflow_main_access());

CREATE OR REPLACE FUNCTION public.shopify_normalize_invoice_number(p_invoice_number text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_invoice_num integer;
BEGIN
  v_invoice_num := NULLIF(regexp_replace(COALESCE(p_invoice_number, ''), '\D', '', 'g'), '')::integer;
  IF v_invoice_num IS NULL THEN
    RAISE EXCEPTION 'invalid invoice_number: %', p_invoice_number;
  END IF;
  RETURN v_invoice_num;
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_normalize_order_items(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_items_array jsonb;
  v_items_norm jsonb;
BEGIN
  IF p_items IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_items) = 'object' AND p_items ? 'root' THEN
    v_items_array := p_items->'root';
  ELSIF jsonb_typeof(p_items) = 'object' THEN
    v_items_array := jsonb_build_array(p_items);
  ELSIF jsonb_typeof(p_items) = 'array' THEN
    v_items_array := p_items;
  ELSE
    RAISE EXCEPTION 'p_items must be object, array, or {root:[...]}, got %', jsonb_typeof(p_items);
  END IF;

  IF jsonb_typeof(v_items_array) <> 'array' THEN
    RAISE EXCEPTION 'p_items.root must be an array, got %', jsonb_typeof(v_items_array);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', item->>'id',
      'qty', COALESCE(NULLIF(item->>'quantity', '')::integer, NULLIF(item->>'qty', '')::integer, 1),
      'name', COALESCE(
        NULLIF(item->>'name', ''),
        NULLIF(item->>'title', ''),
        NULLIF(item#>>'{variant,displayName}', ''),
        NULLIF(item#>>'{product,displayName}', ''),
        NULLIF(item#>>'{variant,title}', ''),
        NULLIF(item#>>'{product,title}', ''),
        ''
      ),
      'price', COALESCE(
        NULLIF(item->>'discounted_unit_price', '')::numeric,
        NULLIF(item#>>'{discountedUnitPriceSet,shopMoney,amount}', '')::numeric,
        NULLIF(item#>>'{discountedUnitPriceSet,amount}', '')::numeric,
        NULLIF(item->>'original_unit_price', '')::numeric,
        NULLIF(item#>>'{originalUnitPriceSet,shopMoney,amount}', '')::numeric,
        NULLIF(item#>>'{originalUnitPriceSet,amount}', '')::numeric,
        NULLIF(item->>'price', '')::numeric,
        0
      ),
      'sku', COALESCE(NULLIF(item->>'sku', ''), NULLIF(item#>>'{variant,sku}', '')),
      'shopify_variant_id', COALESCE(
        NULLIF(item->>'shopify_variant_id', ''),
        NULLIF(item->>'variant_id', ''),
        NULLIF(item#>>'{variant,id}', '')
      ),
      'shopify_product_id', COALESCE(
        NULLIF(item->>'shopify_product_id', ''),
        NULLIF(item->>'product_id', ''),
        NULLIF(item#>>'{variant,product,id}', ''),
        NULLIF(item#>>'{product,id}', '')
      )
    )
  ), '[]'::jsonb)
  INTO v_items_norm
  FROM jsonb_array_elements(v_items_array) AS item;

  RETURN v_items_norm;
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_resolve_customer(
  p_shopify_customer_id text,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_address text,
  p_create_if_missing boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_shopify_customer_id text := NULLIF(btrim(COALESCE(p_shopify_customer_id, '')), '');
  v_email text := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_safe_name text;
BEGIN
  IF v_shopify_customer_id IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE shopify_customer_id = v_shopify_customer_id
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE email = v_email
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE phone = v_phone
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND p_create_if_missing THEN
    v_safe_name := COALESCE(
      NULLIF(btrim(p_name), ''),
      v_email,
      v_phone,
      '(無名 Shopify 客戶)'
    );

    INSERT INTO customers(name, email, phone, company, address, shopify_customer_id)
    VALUES (
      v_safe_name,
      v_email,
      v_phone,
      NULLIF(btrim(COALESCE(p_company, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      v_shopify_customer_id
    )
    RETURNING id INTO v_customer_id;
  END IF;

  IF v_customer_id IS NOT NULL AND v_shopify_customer_id IS NOT NULL THEN
    UPDATE customers
    SET shopify_customer_id = v_shopify_customer_id
    WHERE id = v_customer_id
      AND shopify_customer_id IS NULL;
  END IF;

  RETURN v_customer_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_apply_variant_deductions(
  p_invoice_id text,
  p_invoice_number integer,
  p_items_norm jsonb,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_default_wh uuid;
  v_item jsonb;
  v_variant_id text;
  v_item_qty integer;
  v_link record;
  v_deduct integer;
  v_movement_count integer := 0;
  v_unit_count integer := 0;
  v_reason text;
BEGIN
  SELECT id INTO v_default_wh FROM warehouses ORDER BY sort_order LIMIT 1;
  IF v_default_wh IS NULL THEN
    RETURN jsonb_build_object('movement_count', 0, 'unit_count', 0, 'reason', 'no_default_warehouse');
  END IF;

  v_reason := CASE WHEN p_source = 'api'
    THEN 'Shopify API 同步：發票 #'
    ELSE 'Shopify Make 同步：發票 #'
  END || p_invoice_number::text;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items_norm, '[]'::jsonb)) LOOP
    v_variant_id := NULLIF(v_item->>'shopify_variant_id', '');
    IF v_variant_id IS NULL THEN
      CONTINUE;
    END IF;

    v_item_qty := COALESCE(NULLIF(v_item->>'qty', '')::integer, 1);
    IF v_item_qty <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_link IN
      SELECT
        l.bizflow_product_id,
        l.qty AS link_qty,
        p.is_virtual,
        p.category,
        EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id) AS has_children
      FROM shopify_variant_links l
      JOIN products p ON p.id = l.bizflow_product_id
      WHERE l.shopify_variant_id = v_variant_id
    LOOP
      IF COALESCE(v_link.is_virtual, false) = true
         OR v_link.category = '_archived'
         OR COALESCE(v_link.has_children, false) = true THEN
        CONTINUE;
      END IF;

      v_deduct := v_item_qty * COALESCE(v_link.link_qty, 1);
      IF v_deduct <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO inventory_stock(product_id, warehouse_id, qty, updated_at)
      VALUES (v_link.bizflow_product_id, v_default_wh, -v_deduct, now())
      ON CONFLICT (product_id, warehouse_id)
      DO UPDATE SET qty = inventory_stock.qty - v_deduct, updated_at = now();

      INSERT INTO inventory_movements(product_id, warehouse_id, delta, type, reason, invoice_id)
      VALUES (v_link.bizflow_product_id, v_default_wh, -v_deduct, 'sale', v_reason, p_invoice_id);

      v_movement_count := v_movement_count + 1;
      v_unit_count := v_unit_count + v_deduct;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('movement_count', v_movement_count, 'unit_count', v_unit_count);
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_sync_order_core(
  p_source text,
  p_shopify_order_id text,
  p_shopify_customer_id text,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_address text,
  p_invoice_number text,
  p_date timestamptz,
  p_items jsonb,
  p_total numeric,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source text := lower(COALESCE(NULLIF(btrim(p_source), ''), 'api'));
  v_shopify_order_id text := NULLIF(btrim(COALESCE(p_shopify_order_id, '')), '');
  v_shopify_customer_id text := NULLIF(btrim(COALESCE(p_shopify_customer_id, '')), '');
  v_invoice_num integer;
  v_items_norm jsonb;
  v_existing invoices%ROWTYPE;
  v_invoice_id text;
  v_customer_id uuid;
  v_deduction jsonb := jsonb_build_object('movement_count', 0, 'unit_count', 0);
  v_created boolean := false;
BEGIN
  IF v_source NOT IN ('api', 'make') THEN
    RAISE EXCEPTION 'invalid shopify sync source: %', p_source;
  END IF;

  v_invoice_num := public.shopify_normalize_invoice_number(p_invoice_number);
  v_items_norm := public.shopify_normalize_order_items(p_items);

  -- Serialize API and Make attempts for the same normalized invoice number.
  PERFORM pg_advisory_xact_lock(hashtext('shopify_sync_order'), v_invoice_num);

  SELECT *
  INTO v_existing
  FROM invoices
  WHERE (v_shopify_order_id IS NOT NULL AND shopify_order_id = v_shopify_order_id)
     OR invoice_number = v_invoice_num
  ORDER BY CASE WHEN v_shopify_order_id IS NOT NULL AND shopify_order_id = v_shopify_order_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    v_invoice_id := v_existing.id;
    v_shopify_customer_id := COALESCE(v_shopify_customer_id, v_existing.shopify_customer_id);
    v_customer_id := v_existing.customer_id;

    IF v_source = 'make' AND v_customer_id IS NULL THEN
      v_customer_id := public.shopify_resolve_customer(
        v_shopify_customer_id, p_name, p_email, p_phone, p_company, p_address, true
      );
    END IF;

    UPDATE invoices
    SET
      shopify_order_id = COALESCE(invoices.shopify_order_id, v_shopify_order_id),
      shopify_customer_id = COALESCE(invoices.shopify_customer_id, v_shopify_customer_id),
      customer_id = COALESCE(invoices.customer_id, v_customer_id)
    WHERE id = v_invoice_id;

    -- Existing invoices are never deducted again.
    -- This intentionally avoids partial/double-deduction ambiguity between the legacy Make alias path
    -- and the new Shopify variant-link path. Missing deductions remain visible through PendingDeduction.

    RETURN jsonb_build_object(
      'invoice_id', v_invoice_id,
      'customer_id', v_customer_id,
      'created', false,
      'deducted', v_deduction,
      'source', v_source
    );
  END IF;

  IF v_source = 'make' THEN
    v_customer_id := public.shopify_resolve_customer(
      v_shopify_customer_id, p_name, p_email, p_phone, p_company, p_address, true
    );
  ELSE
    v_customer_id := NULL;
  END IF;

  INSERT INTO invoices(
    id, customer_id, date, items, total, status, notes,
    invoice_number, legacy_skip_deduct, shopify_order_id, shopify_customer_id
  )
  VALUES (
    gen_random_uuid()::text,
    v_customer_id,
    COALESCE((p_date AT TIME ZONE 'Asia/Hong_Kong')::date, current_date),
    v_items_norm,
    COALESCE(p_total, 0),
    'Paid',
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_invoice_num,
    false,
    v_shopify_order_id,
    v_shopify_customer_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_invoice_id;

  IF v_invoice_id IS NULL THEN
    -- A concurrent writer won despite the lock path or hit another unique index. Re-read and do not duplicate.
    SELECT id, customer_id
    INTO v_invoice_id, v_customer_id
    FROM invoices
    WHERE (v_shopify_order_id IS NOT NULL AND shopify_order_id = v_shopify_order_id)
       OR invoice_number = v_invoice_num
    LIMIT 1;

    RETURN jsonb_build_object(
      'invoice_id', v_invoice_id,
      'customer_id', v_customer_id,
      'created', false,
      'deducted', v_deduction,
      'source', v_source,
      'conflict', true
    );
  END IF;

  v_created := true;
  v_deduction := public.shopify_apply_variant_deductions(v_invoice_id, v_invoice_num, v_items_norm, v_source);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'customer_id', v_customer_id,
    'created', v_created,
    'deducted', v_deduction,
    'source', v_source
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_sync_order_api(
  p_shopify_order_id text,
  p_shopify_customer_id text,
  p_invoice_number text,
  p_date timestamptz,
  p_items jsonb,
  p_total numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.shopify_sync_order_core(
    'api',
    p_shopify_order_id,
    p_shopify_customer_id,
    NULL, NULL, NULL, NULL, NULL,
    p_invoice_number,
    p_date,
    p_items,
    p_total,
    p_notes
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.shopify_sync_order(
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_address text,
  p_invoice_number text,
  p_date timestamp with time zone,
  p_items jsonb,
  p_total numeric,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.shopify_sync_order_core(
    'make',
    NULL,
    NULL,
    p_name,
    p_email,
    p_phone,
    p_company,
    p_address,
    p_invoice_number,
    p_date,
    p_items,
    p_total,
    p_notes
  );

  RETURN NULLIF(v_result->>'customer_id', '')::uuid;
END
$function$;

COMMIT;
