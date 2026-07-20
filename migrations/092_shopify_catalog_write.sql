-- 092: inventory Shopify B — separate catalogue ownership, durable jobs, and resource mappings
-- BizFlow owns catalogue/inventory writes; shopify_variant_links remains the M:N order-deduction map.

CREATE TABLE IF NOT EXISTS public.shopify_catalog_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bizflow_parent_product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL UNIQUE,
  shopify_updated_at timestamptz,
  last_payload_hash text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('proposed', 'active', 'conflict', 'deleted')),
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_catalog_bindings_status_idx
  ON public.shopify_catalog_bindings(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.shopify_catalog_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN (
    'create', 'update', 'delete', 'confirm_binding', 'link_component', 'unlink_component'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'shopify_applied_pending_db', 'succeeded', 'failed', 'conflict'
  )),
  bizflow_parent_product_id uuid,
  shopify_product_id text,
  expected_shopify_updated_at timestamptz,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text,
  actor_user_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sanitized_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_catalog_jobs_status_idx
  ON public.shopify_catalog_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS shopify_catalog_jobs_product_idx
  ON public.shopify_catalog_jobs(bizflow_parent_product_id, created_at DESC);

-- One mapping table covers both BizFlow warehouse -> Shopify Location and
-- BizFlow collection name -> Shopify Collection. Never guess either by display name.
CREATE TABLE IF NOT EXISTS public.shopify_resource_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('location', 'collection')),
  bizflow_key text NOT NULL,
  shopify_resource_id text NOT NULL,
  shopify_name text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, bizflow_key),
  UNIQUE(kind, shopify_resource_id)
);

ALTER TABLE public.shopify_catalog_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_catalog_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_resource_mappings ENABLE ROW LEVEL SECURITY;

-- Catalogue/inventory source-of-truth writes are administrator-only. BizFlow
-- members retain read access; Shopify order deduction continues through its
-- existing security-definer RPC rather than direct browser mutations.
DROP POLICY IF EXISTS products_bizflow_main_access ON public.products;
DROP POLICY IF EXISTS products_bizflow_main_access_select ON public.products;
DROP POLICY IF EXISTS products_catalog_admin_modify ON public.products;
CREATE POLICY products_bizflow_main_access_select
  ON public.products FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access());
CREATE POLICY products_catalog_admin_modify
  ON public.products FOR ALL TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_bf_admin())
  WITH CHECK (public.has_bizflow_main_access() AND public.is_bf_admin());

DROP POLICY IF EXISTS inventory_stock_bizflow_main_access ON public.inventory_stock;
DROP POLICY IF EXISTS inventory_stock_bizflow_main_access_select ON public.inventory_stock;
DROP POLICY IF EXISTS inventory_stock_catalog_admin_modify ON public.inventory_stock;
-- Keep stock mutations at the existing BizFlow-main width: invoice/order
-- clients use the signed-in employee JWT for transactional stock movements.
-- Catalogue editing remains admin-gated in the UI and Shopify Edge write path.
CREATE POLICY inventory_stock_bizflow_main_access
  ON public.inventory_stock FOR ALL TO authenticated
  USING (public.has_bizflow_main_access())
  WITH CHECK (public.has_bizflow_main_access());

DROP POLICY IF EXISTS shopify_catalog_bindings_admin_select ON public.shopify_catalog_bindings;
CREATE POLICY shopify_catalog_bindings_admin_select
  ON public.shopify_catalog_bindings FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_bf_admin());

DROP POLICY IF EXISTS shopify_catalog_jobs_admin_select ON public.shopify_catalog_jobs;
CREATE POLICY shopify_catalog_jobs_admin_select
  ON public.shopify_catalog_jobs FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_bf_admin());

DROP POLICY IF EXISTS shopify_resource_mappings_admin_select ON public.shopify_resource_mappings;
CREATE POLICY shopify_resource_mappings_admin_select
  ON public.shopify_resource_mappings FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_bf_admin());

-- Component mapping mutations also become admin-only. Edge Functions use service_role.
DROP POLICY IF EXISTS shopify_variant_links_modify ON public.shopify_variant_links;
CREATE POLICY shopify_variant_links_modify
  ON public.shopify_variant_links FOR ALL TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_bf_admin())
  WITH CHECK (public.has_bizflow_main_access() AND public.is_bf_admin());

-- The transitional DB token is read only by service_role until the Edge-secret
-- cutover. Browser-based unlock/save is permanently retired.
DROP POLICY IF EXISTS shopify_settings_update ON public.shopify_settings;
REVOKE UPDATE ON public.shopify_settings FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.shopify_catalog_bindings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shopify_catalog_jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shopify_resource_mappings FROM anon, authenticated;

-- Apply a Shopify-successful catalogue job to BizFlow in one database transaction.
-- Only the service role can call this; browser clients enqueue through the Edge Function.
CREATE OR REPLACE FUNCTION public.shopify_apply_catalog_job(
  p_job_id uuid,
  p_shopify_result jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.shopify_catalog_jobs%ROWTYPE;
  v_product jsonb;
  v_variant jsonb;
  v_stock jsonb;
  v_shopify_variant jsonb;
  v_parent_id uuid;
  v_variant_ids uuid[] := ARRAY[]::uuid[];
  v_shopify_product_id text;
  v_shopify_updated_at timestamptz;
  v_payload_hash text;
BEGIN
  SELECT * INTO v_job
  FROM public.shopify_catalog_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOPIFY_JOB_NOT_FOUND';
  END IF;
  IF v_job.status = 'succeeded' THEN
    RETURN v_job.result_payload;
  END IF;
  IF v_job.action NOT IN ('create', 'update', 'delete') THEN
    RAISE EXCEPTION 'SHOPIFY_JOB_ACTION_NOT_APPLICABLE';
  END IF;

  v_parent_id := v_job.bizflow_parent_product_id;
  v_shopify_product_id := NULLIF(p_shopify_result->>'shopifyProductId', '');
  v_shopify_updated_at := NULLIF(p_shopify_result->>'shopifyUpdatedAt', '')::timestamptz;
  v_payload_hash := NULLIF(v_job.payload_hash, '');

  IF v_job.action = 'delete' THEN
    DELETE FROM public.products WHERE id = v_parent_id;
    UPDATE public.shopify_catalog_jobs
    SET status = 'succeeded', result_payload = COALESCE(p_shopify_result, '{}'::jsonb),
        sanitized_error = NULL, completed_at = now(), updated_at = now()
    WHERE id = p_job_id;
    RETURN COALESCE(p_shopify_result, '{}'::jsonb);
  END IF;

  v_product := v_job.request_payload->'product';
  IF v_product IS NULL OR v_parent_id IS NULL OR v_shopify_product_id IS NULL THEN
    RAISE EXCEPTION 'SHOPIFY_JOB_RESULT_INCOMPLETE';
  END IF;

  INSERT INTO public.products (
    id, name, price, warranty_months, category, internal_code, status,
    image_url, specs, product_type, collections, tags, parent_product_id, is_virtual
  ) VALUES (
    v_parent_id,
    btrim(COALESCE(v_product->>'name', '')),
    COALESCE((v_product->>'price')::numeric, 0),
    COALESCE((v_product->>'warrantyMonths')::integer, 0),
    NULLIF(btrim(COALESCE(v_product->>'category', '')), ''),
    NULLIF(btrim(COALESCE(v_product->>'internalCode', '')), ''),
    COALESCE(NULLIF(v_product->>'status', ''), 'draft'),
    NULLIF(btrim(COALESCE(v_product->>'imageUrl', '')), ''),
    NULLIF(btrim(COALESCE(v_product->>'specs', '')), ''),
    NULLIF(btrim(COALESCE(v_product->>'productType', '')), ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_product->'collections', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_product->'tags', '[]'::jsonb))),
    NULL,
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    warranty_months = EXCLUDED.warranty_months,
    category = EXCLUDED.category,
    internal_code = EXCLUDED.internal_code,
    status = EXCLUDED.status,
    image_url = EXCLUDED.image_url,
    specs = EXCLUDED.specs,
    product_type = EXCLUDED.product_type,
    collections = EXCLUDED.collections,
    tags = EXCLUDED.tags;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(v_product->'variants', '[]'::jsonb)) LOOP
    v_variant_ids := array_append(v_variant_ids, (v_variant->>'id')::uuid);
    INSERT INTO public.products (
      id, name, price, warranty_months, category, internal_code, status,
      image_url, specs, product_type, collections, tags, parent_product_id, is_virtual
    ) VALUES (
      (v_variant->>'id')::uuid,
      btrim(COALESCE(v_variant->>'name', '')),
      COALESCE((v_variant->>'price')::numeric, 0),
      COALESCE((v_variant->>'warrantyMonths')::integer, 0),
      NULLIF(btrim(COALESCE(v_product->>'category', '')), ''),
      NULLIF(btrim(COALESCE(v_variant->>'internalCode', '')), ''),
      COALESCE(NULLIF(v_variant->>'status', ''), 'active'),
      NULLIF(btrim(COALESCE(v_variant->>'imageUrl', v_product->>'imageUrl', '')), ''),
      NULLIF(btrim(COALESCE(v_variant->>'specs', '')), ''),
      NULLIF(btrim(COALESCE(v_product->>'productType', '')), ''),
      '{}'::text[], '{}'::text[], v_parent_id, false
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      price = EXCLUDED.price,
      warranty_months = EXCLUDED.warranty_months,
      internal_code = EXCLUDED.internal_code,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      image_url = EXCLUDED.image_url,
      specs = EXCLUDED.specs,
      product_type = EXCLUDED.product_type,
      parent_product_id = v_parent_id;

    FOR v_stock IN SELECT * FROM jsonb_array_elements(COALESCE(v_variant->'stocks', '[]'::jsonb)) LOOP
      INSERT INTO public.inventory_stock(product_id, warehouse_id, qty, updated_at)
      VALUES ((v_variant->>'id')::uuid, (v_stock->>'warehouseId')::uuid,
              COALESCE((v_stock->>'quantity')::integer, 0), now())
      ON CONFLICT (product_id, warehouse_id) DO UPDATE
      SET qty = EXCLUDED.qty, updated_at = now();
    END LOOP;
  END LOOP;

  IF COALESCE(array_length(v_variant_ids, 1), 0) = 0 THEN
    DELETE FROM public.products WHERE parent_product_id = v_parent_id;
  ELSE
    DELETE FROM public.products
    WHERE parent_product_id = v_parent_id AND NOT (id = ANY(v_variant_ids));
  END IF;

  FOR v_stock IN SELECT * FROM jsonb_array_elements(COALESCE(v_product->'stocks', '[]'::jsonb)) LOOP
    INSERT INTO public.inventory_stock(product_id, warehouse_id, qty, updated_at)
    VALUES (v_parent_id, (v_stock->>'warehouseId')::uuid,
            COALESCE((v_stock->>'quantity')::integer, 0), now())
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET qty = EXCLUDED.qty, updated_at = now();
  END LOOP;

  INSERT INTO public.shopify_catalog_bindings (
    bizflow_parent_product_id, shopify_product_id, shopify_updated_at,
    last_payload_hash, status, verified_at, created_by, updated_at
  ) VALUES (
    v_parent_id, v_shopify_product_id, v_shopify_updated_at,
    v_payload_hash, 'active', now(), v_job.actor_user_id, now()
  )
  ON CONFLICT (bizflow_parent_product_id) DO UPDATE SET
    shopify_product_id = EXCLUDED.shopify_product_id,
    shopify_updated_at = EXCLUDED.shopify_updated_at,
    last_payload_hash = EXCLUDED.last_payload_hash,
    status = 'active', verified_at = now(), updated_at = now();

  DELETE FROM public.shopify_variant_links l
  WHERE l.shopify_product_id = v_shopify_product_id
    AND l.bizflow_product_id IN (
      SELECT id FROM public.products WHERE id = v_parent_id OR parent_product_id = v_parent_id
    );

  FOR v_shopify_variant IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_shopify_result->'variants', '[]'::jsonb))
  LOOP
    INSERT INTO public.shopify_variant_links (
      shopify_variant_id, bizflow_product_id, shopify_product_id, shopify_sku, qty, updated_at
    ) VALUES (
      v_shopify_variant->>'shopifyVariantId',
      (v_shopify_variant->>'bizflowProductId')::uuid,
      v_shopify_product_id,
      NULLIF(v_shopify_variant->>'shopifySku', ''),
      1, now()
    )
    ON CONFLICT (shopify_variant_id, bizflow_product_id) DO UPDATE SET
      shopify_product_id = EXCLUDED.shopify_product_id,
      shopify_sku = EXCLUDED.shopify_sku,
      qty = 1,
      updated_at = now();
  END LOOP;

  UPDATE public.shopify_catalog_jobs
  SET status = 'succeeded', shopify_product_id = v_shopify_product_id,
      result_payload = COALESCE(p_shopify_result, '{}'::jsonb), sanitized_error = NULL,
      completed_at = now(), updated_at = now()
  WHERE id = p_job_id;

  RETURN COALESCE(p_shopify_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_apply_catalog_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_apply_catalog_job(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
