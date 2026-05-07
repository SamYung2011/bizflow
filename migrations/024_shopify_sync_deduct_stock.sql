-- migration 024: shopify_sync_order RPC 加扣庫存邏輯
-- - 默認倉庫：sort_order=1 的倉（即香港分部）
-- - 走 line_item_aliases：命中 skip → 跳過；命中 products → 扣減 + 流水
-- - 沒命中 alias → 不扣（跳過，等煊煊在 Line Item 映射頁補 alias）
-- - 防重：v_invoice_id 已存在則 RPC 不 INSERT 也不扣（Make 重跑安全）

CREATE OR REPLACE FUNCTION public.shopify_sync_order(
  p_name text, p_email text, p_phone text, p_company text, p_address text,
  p_invoice_number text, p_date timestamp with time zone, p_items jsonb,
  p_total numeric, p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_invoice_id  text;
  v_invoice_num int;
  v_items_array jsonb;
  v_items_norm  jsonb;
  v_default_wh  uuid;
  v_item        jsonb;
  v_alias       record;
  v_alias_p     jsonb;
  v_target_pid  uuid;
  v_item_qty    int;
  v_deduct      int;
BEGIN
  -- 0. invoice_number: 提取数字
  v_invoice_num := NULLIF(regexp_replace(COALESCE(p_invoice_number,''), '\D', '', 'g'), '')::int;
  IF v_invoice_num IS NULL THEN
    RAISE EXCEPTION 'invalid invoice_number: %', p_invoice_number;
  END IF;

  -- 0.5 items normalize：兼容 object/array → bizflow 格式 [{id, qty, name, price}]
  IF p_items IS NULL THEN
    v_items_norm := '[]'::jsonb;
  ELSE
    IF jsonb_typeof(p_items) = 'object' THEN
      v_items_array := jsonb_build_array(p_items);
    ELSE
      v_items_array := p_items;
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

  -- 1-3. customer 處理
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT id INTO v_customer_id FROM customers WHERE email = p_email LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    SELECT id INTO v_customer_id FROM customers WHERE phone = p_phone LIMIT 1;
  END IF;
  IF v_customer_id IS NULL THEN
    INSERT INTO customers(name, email, phone, company, address)
    VALUES (
      NULLIF(btrim(p_name), ''),
      NULLIF(btrim(p_email), ''),
      NULLIF(btrim(p_phone), ''),
      NULLIF(btrim(p_company), ''),
      NULLIF(btrim(p_address), '')
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- 4. 防重：按 invoice_number 找
  SELECT id INTO v_invoice_id FROM invoices WHERE invoice_number = v_invoice_num LIMIT 1;

  -- 5. 不存在才 INSERT + 扣庫存（已存在則跳過 → Make 重跑安全）
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
      false  -- 新發票不 legacy
    )
    RETURNING id INTO v_invoice_id;

    -- 默認倉庫：sort_order 最小的（香港分部）
    SELECT id INTO v_default_wh FROM warehouses ORDER BY sort_order LIMIT 1;

    IF v_default_wh IS NOT NULL THEN
      -- 遍歷 v_items_norm 每個 item，按 alias 扣減
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_norm) LOOP
        v_item_qty := COALESCE((v_item->>'qty')::int, 1);

        -- 查 alias（不分大小寫 + trim）
        SELECT * INTO v_alias FROM line_item_aliases
        WHERE LOWER(TRIM(alias_name)) = LOWER(TRIM(v_item->>'name'))
        LIMIT 1;

        IF v_alias.id IS NULL THEN
          -- 沒映射，跳過（等補 alias）
          CONTINUE;
        END IF;

        IF v_alias.skip = true THEN
          -- alias 標 skip（押金/運費/Final Payment/租務）
          CONTINUE;
        END IF;

        -- alias.products 是 [{product_id, qty}]，套裝會多條
        FOR v_alias_p IN SELECT * FROM jsonb_array_elements(COALESCE(v_alias.products, '[]'::jsonb)) LOOP
          v_target_pid := (v_alias_p->>'product_id')::uuid;
          v_deduct := v_item_qty * COALESCE((v_alias_p->>'qty')::int, 1);

          IF v_target_pid IS NULL OR v_deduct <= 0 THEN CONTINUE; END IF;

          -- UPSERT inventory_stock
          INSERT INTO inventory_stock(product_id, warehouse_id, qty, updated_at)
          VALUES (v_target_pid, v_default_wh, -v_deduct, NOW())
          ON CONFLICT (product_id, warehouse_id)
          DO UPDATE SET qty = inventory_stock.qty - v_deduct, updated_at = NOW();

          -- 流水
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

-- 驗收：
-- 模擬一次 sync 看流水
-- SELECT id, items, legacy_skip_deduct FROM invoices ORDER BY date DESC LIMIT 3;
-- SELECT * FROM inventory_movements WHERE type = 'sale' ORDER BY created_at DESC LIMIT 5;
