-- 069_shopify_sync_order_skip_virtual.sql
-- Hotfix RPC shopify_sync_order：扣庫存時跳過虛擬產品 / 已歸檔 / 父 SKU
-- 2026-05-21
--
-- 背景：
-- bizflow 應用層 buildDeductionPlan 有 is_virtual / category='_archived' / 父 SKU 三道過濾，
-- 但 shopify_sync_order RPC 內部扣庫存只查 product_id IS NULL / qty <= 0，**漏這三道**。
-- 結果：Shopify 同步發票 #1540（2026-05-19）扣了防水盒（is_virtual=true）-1。
-- 跟同一天 commit b3ae4d6 修的 buildDeductionPlan alias 路徑 is_virtual 漏檢查同款 bug，
-- 一個在應用層一個在 DB 層，這個 migration 修 DB 層。
--
-- 修法：CREATE OR REPLACE 整個替換（從 migration 058 base 拿來、只在扣庫存 LOOP 內加跳過判斷）

CREATE OR REPLACE FUNCTION public.shopify_sync_order(
  p_name text, p_email text, p_phone text, p_company text, p_address text,
  p_invoice_number text, p_date timestamp with time zone, p_items jsonb, p_total numeric, p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id   uuid;
  v_invoice_id    text;
  v_invoice_num   int;
  v_items_array   jsonb;
  v_items_norm    jsonb;
  v_default_wh    uuid;
  v_item          jsonb;
  v_alias         record;
  v_alias_p       jsonb;
  v_target_pid    uuid;
  v_item_qty      int;
  v_deduct        int;
  v_safe_name     text;
  v_skip_product  boolean;
BEGIN
  v_invoice_num := NULLIF(regexp_replace(COALESCE(p_invoice_number,''), '\D', '', 'g'), '')::int;
  IF v_invoice_num IS NULL THEN
    RAISE EXCEPTION 'invalid invoice_number: %', p_invoice_number;
  END IF;

  IF p_items IS NULL THEN
    v_items_norm := '[]'::jsonb;
  ELSE
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
        'id',   item->>'id',
        'qty',  COALESCE((item->>'quantity')::int, (item->>'qty')::int, 1),
        'name', COALESCE(
                  item#>>'{variant,displayName}',
                  item#>>'{product,displayName}',
                  item->>'title',
                  item->>'name'
                ),
        'price', COALESCE(
                  (item#>>'{originalUnitPriceSet,amount}')::numeric,
                  (item#>>'{discountedUnitPriceSet,amount}')::numeric,
                  (item->>'price')::numeric,
                  0
                )
      )
    ), '[]'::jsonb)
    INTO v_items_norm
    FROM jsonb_array_elements(v_items_array) AS item;
  END IF;

  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT id INTO v_customer_id FROM customers WHERE email = p_email LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    SELECT id INTO v_customer_id FROM customers WHERE phone = p_phone LIMIT 1;
  END IF;
  IF v_customer_id IS NULL THEN
    -- name fallback email/phone/兜底字串，避免 Shopify 客戶 first_name+last_name 都空時 NULL 寫進 NOT NULL 欄位（migration 058）
    v_safe_name := COALESCE(
      NULLIF(btrim(p_name), ''),
      NULLIF(btrim(p_email), ''),
      NULLIF(btrim(p_phone), ''),
      '(無名 Shopify 客戶)'
    );
    INSERT INTO customers(name, email, phone, company, address)
    VALUES (
      v_safe_name,
      NULLIF(btrim(p_email), ''),
      NULLIF(btrim(p_phone), ''),
      NULLIF(btrim(p_company), ''),
      NULLIF(btrim(p_address), '')
    )
    RETURNING id INTO v_customer_id;
  END IF;

  SELECT id INTO v_invoice_id FROM invoices WHERE invoice_number = v_invoice_num LIMIT 1;

  IF v_invoice_id IS NULL THEN
    INSERT INTO invoices(id, customer_id, date, items, total, status, notes, invoice_number, legacy_skip_deduct)
    VALUES (
      gen_random_uuid()::text,
      v_customer_id,
      (p_date AT TIME ZONE 'Asia/Hong_Kong')::date,
      v_items_norm,
      COALESCE(p_total, 0),
      'Paid',
      NULLIF(btrim(p_notes), ''),
      v_invoice_num,
      false
    )
    RETURNING id INTO v_invoice_id;

    SELECT id INTO v_default_wh FROM warehouses ORDER BY sort_order LIMIT 1;

    IF v_default_wh IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_norm) LOOP
        v_item_qty := COALESCE((v_item->>'qty')::int, 1);

        SELECT * INTO v_alias FROM line_item_aliases
        WHERE LOWER(TRIM(alias_name)) = LOWER(TRIM(v_item->>'name'))
        LIMIT 1;

        IF v_alias.id IS NULL THEN
          CONTINUE;
        END IF;

        IF v_alias.skip = true THEN
          CONTINUE;
        END IF;

        FOR v_alias_p IN SELECT * FROM jsonb_array_elements(COALESCE(v_alias.products, '[]'::jsonb)) LOOP
          v_target_pid := (v_alias_p->>'product_id')::uuid;
          v_deduct := v_item_qty * COALESCE((v_alias_p->>'qty')::int, 1);

          IF v_target_pid IS NULL OR v_deduct <= 0 THEN CONTINUE; END IF;

          -- 069 新加：跳過虛擬產品 / 已歸檔 / 父 SKU（跟 App 層 buildDeductionPlan 對齊）
          SELECT (p.is_virtual = true OR p.category = '_archived'
                  OR EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id))
          INTO v_skip_product
          FROM products p WHERE p.id = v_target_pid;
          IF COALESCE(v_skip_product, false) = true THEN
            CONTINUE;
          END IF;

          INSERT INTO inventory_stock(product_id, warehouse_id, qty, updated_at)
          VALUES (v_target_pid, v_default_wh, -v_deduct, NOW())
          ON CONFLICT (product_id, warehouse_id)
          DO UPDATE SET qty = inventory_stock.qty - v_deduct, updated_at = NOW();

          INSERT INTO inventory_movements(product_id, warehouse_id, delta, type, reason, invoice_id)
          VALUES (v_target_pid, v_default_wh, -v_deduct, 'sale',
                  'Shopify 同步：發票 #' || v_invoice_num::text, v_invoice_id);
        END LOOP;
      END LOOP;
    END IF;
  END IF;

  RETURN v_customer_id;
END
$function$;
