-- 119: one RLS-scoped customer group with all historical orders and warranty derivation.
-- Membership and warranty rules are from 104/108. Customer detail retains the
-- legacy page money visibility and date-descending order display; table RLS is unchanged.
-- No page limit applies to the selected group's historical orders or warranties.
BEGIN;
CREATE OR REPLACE FUNCTION public.bizflow_customer_detail(p_customer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  WITH
  trim_chars AS MATERIALIZED (
    -- Match String.prototype.trim() in customer-groups.js.
    SELECT concat(
      chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760),
      chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197),
      chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232),
      chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)
    ) AS value
  ),
  all_groups AS MATERIALIZED (SELECT * FROM public.bizflow_customer_group_map()),
  requested AS MATERIALIZED (
    SELECT primary_id FROM all_groups WHERE member_id = p_customer_id LIMIT 1
  ),
  customer_groups AS MATERIALIZED (
    SELECT mapping.* FROM all_groups AS mapping JOIN requested ON requested.primary_id = mapping.primary_id
  ),
  ordered_members AS MATERIALIZED (
    SELECT
      mapping.primary_id,
      customer.id AS member_id,
      customer.parent_id,
      customer.name,
      customer.phone,
      customer.phone_mainland,
      customer.email,
      customer.address,
      customer.car_make,
      customer.car_model,
      customer.created_at,
      row_number() OVER (
        PARTITION BY mapping.primary_id
        ORDER BY
          COALESCE(parent.name, customer.name) ASC NULLS LAST,
          COALESCE(parent.id, customer.id),
          CASE WHEN customer.parent_id IS NULL THEN 0 ELSE 1 END,
          customer.name ASC NULLS LAST,
          customer.id
      ) AS member_sequence
    FROM customer_groups AS mapping
    JOIN public.customers AS customer ON customer.id = mapping.member_id
    LEFT JOIN public.customers AS parent ON parent.id = customer.parent_id
  ),
  group_ids AS MATERIALIZED (
    SELECT
      member.primary_id,
      jsonb_agg(member.member_id::text ORDER BY
        CASE WHEN member.parent_id IS NULL THEN 0 ELSE 1 END,
        member.member_sequence
      ) AS group_cids,
      min(member.created_at) FILTER (WHERE member.parent_id IS NULL) AS joined_at
    FROM ordered_members AS member
    GROUP BY member.primary_id
  ),
  field_values AS MATERIALIZED (
    SELECT member.primary_id, 'name'::text AS field_name,
           btrim(COALESCE(member.name, ''), trim_chars.value) AS value,
           member.member_sequence, 0::bigint AS line_position
    FROM ordered_members AS member CROSS JOIN trim_chars
    UNION ALL
    SELECT member.primary_id, 'phone', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'phone_mainland', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone_mainland, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'email', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.email, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'address', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.address, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'car_make', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.car_make, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'car_model', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.car_model, ''), E'\n+') WITH ORDINALITY AS line(value, position)
  ),
  distinct_field_values AS MATERIALIZED (
    SELECT DISTINCT ON (value.primary_id, value.field_name, value.value)
      value.primary_id, value.field_name, value.value, value.member_sequence, value.line_position
    FROM field_values AS value
    WHERE value.value <> ''
    ORDER BY value.primary_id, value.field_name, value.value, value.member_sequence, value.line_position
  ),
  group_values AS MATERIALIZED (
    SELECT
      value.primary_id,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'name'), '[]'::jsonb) AS all_names,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'phone'), '[]'::jsonb) AS all_phones,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'phone_mainland'), '[]'::jsonb) AS all_phone_mainlands,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'email'), '[]'::jsonb) AS all_emails,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'address'), '[]'::jsonb) AS all_addresses,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'car_make'), '[]'::jsonb) AS all_car_makes,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'car_model'), '[]'::jsonb) AS all_car_models
    FROM distinct_field_values AS value
    GROUP BY value.primary_id
  ),
  invoice_keys AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text)) invoice.id
    FROM public.invoices AS invoice
    WHERE jsonb_typeof(invoice.items) = 'array' AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text),
             invoice.created_at ASC, invoice.date DESC, invoice.id ASC
  ),
  orders AS MATERIALIZED (
    SELECT
      customer_group.primary_id,
      invoice.id,
      invoice.invoice_number,
      invoice.date AS order_date,
      invoice.created_at,
      invoice.total,
      invoice.status,
      COALESCE(NULLIF(invoice.shipping_status, ''), 'unshipped') AS shipping_status,
      CASE
        WHEN COALESCE(invoice.notes, '') LIKE '%__FORMS_BUY__%' THEN 'Framer'
        WHEN COALESCE(invoice.notes, '') LIKE '%__BROADWAY__%' THEN 'Broadway'
        WHEN invoice.invoice_number IS NOT NULL THEN 'Online Store'
        ELSE 'Manual'
      END AS channel,
      first_line.item AS first_item,
      CASE
        WHEN first_line.item IS NULL THEN '—'
        ELSE COALESCE(first_line.item->>'name', '')
      END AS product_name,
      CASE
        WHEN first_line.item IS NULL OR NOT (first_line.item ? 'qty') THEN 1
        WHEN jsonb_typeof(first_line.item->'qty') = 'null' THEN 0
        WHEN jsonb_typeof(first_line.item->'qty') = 'boolean'
          THEN CASE WHEN (first_line.item->>'qty')::boolean THEN 1 ELSE 0 END
        WHEN jsonb_typeof(first_line.item->'qty') = 'number' THEN (first_line.item->>'qty')::numeric
        WHEN jsonb_typeof(first_line.item->'qty') = 'string'
          AND btrim(first_line.item->>'qty') = '' THEN 0
        WHEN COALESCE(first_line.item->>'qty', '') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          THEN (first_line.item->>'qty')::numeric
        ELSE 1
      END AS quantity
    FROM invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    JOIN customer_groups AS customer_group ON customer_group.member_id = invoice.customer_id
    LEFT JOIN LATERAL (
      SELECT line.value AS item
      FROM jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
      ORDER BY line.position
      LIMIT 1
    ) AS first_line ON true
  ),
  order_stats AS MATERIALIZED (
    SELECT
      row.primary_id,
      count(*) AS order_count,
      COALESCE(sum(row.total), 0) AS total_amount,
      min(row.created_at) AS first_created_at,
      max(row.created_at) AS last_created_at,
      max(row.order_date) AS last_order_date
    FROM orders AS row
    GROUP BY row.primary_id
  ),
  first_orders AS MATERIALIZED (
    SELECT DISTINCT ON (row.primary_id) row.primary_id, row.order_date
    FROM orders AS row
    ORDER BY row.primary_id, row.order_date ASC, row.created_at ASC, row.id DESC
  ),
  source_orders AS MATERIALIZED (
    SELECT DISTINCT ON (row.primary_id)
      row.primary_id,
      CASE WHEN row.channel = 'Framer' THEN 'framer'
           WHEN row.channel = 'Online Store' THEN 'shopify' ELSE 'other' END AS source
    FROM orders AS row
    ORDER BY row.primary_id, row.order_date ASC, row.created_at DESC, row.id ASC
  ),
  device_rows AS MATERIALIZED (
    SELECT customer_group.primary_id, device.id, device.imei, device.created_at
    FROM public.customer_devices AS device
    JOIN customer_groups AS customer_group ON customer_group.member_id = device.customer_id
    WHERE NULLIF(btrim(COALESCE(device.imei, '')), '') IS NOT NULL
  ),
  device_stats AS MATERIALIZED (
    SELECT
      device.primary_id,
      count(*) AS device_count,
      (array_agg(device.imei ORDER BY device.created_at DESC, device.id ASC))[1] AS imei,
      jsonb_agg(device.imei ORDER BY device.created_at DESC, device.id ASC) AS imei_codes
    FROM device_rows AS device
    GROUP BY device.primary_id
  ),
  grouped AS MATERIALIZED (
    SELECT
      ids.primary_id,
      ids.group_cids,
      ids.joined_at,
      (ids.joined_at AT TIME ZONE 'Asia/Hong_Kong')::date AS joined_date,
      COALESCE(NULLIF(primary_customer.name, ''), values.all_names->>0, '') AS display_name,
      COALESCE(NULLIF(primary_customer.phone, ''), values.all_phones->>0, '') AS display_phone,
      COALESCE(NULLIF(primary_customer.email, ''), values.all_emails->>0, '') AS display_email,
      COALESCE(NULLIF(primary_customer.address, ''), values.all_addresses->>0, '') AS display_address,
      COALESCE((SELECT string_agg(entry.value, E'\n' ORDER BY entry.position)
        FROM jsonb_array_elements_text(values.all_phone_mainlands) WITH ORDINALITY AS entry(value, position)),
        COALESCE(primary_customer.phone_mainland, '')) AS display_phone_mainland,
      COALESCE((SELECT string_agg(entry.value, E'\n' ORDER BY entry.position)
        FROM jsonb_array_elements_text(values.all_car_makes) WITH ORDINALITY AS entry(value, position)),
        COALESCE(primary_customer.car_make, '')) AS display_car_make,
      COALESCE((SELECT string_agg(entry.value, E'\n' ORDER BY entry.position)
        FROM jsonb_array_elements_text(values.all_car_models) WITH ORDINALITY AS entry(value, position)),
        COALESCE(primary_customer.car_model, '')) AS display_car_model,
      COALESCE(NULLIF(primary_customer.type, ''), 'Regular') AS customer_type,
      values.all_names,
      values.all_phones,
      values.all_phone_mainlands,
      values.all_emails,
      values.all_addresses,
      values.all_car_makes,
      values.all_car_models,
      COALESCE(source.source, 'other') AS source,
      COALESCE(stats.order_count, 0) AS order_count,
      COALESCE(stats.total_amount, 0) AS total_amount,
      stats.last_created_at,
      stats.last_order_date,
      first_order.order_date AS first_order_date,
      COALESCE(device.device_count, 0) AS device_count,
      COALESCE(device.imei, '') AS imei,
      COALESCE(device.imei_codes, '[]'::jsonb) AS imei_codes
    FROM group_ids AS ids
    JOIN public.customers AS primary_customer ON primary_customer.id = ids.primary_id
    JOIN group_values AS values ON values.primary_id = ids.primary_id
    CROSS JOIN trim_chars
    LEFT JOIN order_stats AS stats ON stats.primary_id = ids.primary_id
    LEFT JOIN first_orders AS first_order ON first_order.primary_id = ids.primary_id
    LEFT JOIN source_orders AS source ON source.primary_id = ids.primary_id
    LEFT JOIN device_stats AS device ON device.primary_id = ids.primary_id
  ),
  page_rows AS MATERIALIZED (
    SELECT
      row.*,
      latest_order.order_json,
      COALESCE(order_list.orders_json, '[]'::jsonb) AS orders_json
    FROM grouped AS row
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'no', CASE WHEN invoice.invoice_number IS NULL THEN '#' || left(invoice.id::text, 8)
                   ELSE '#' || invoice.invoice_number::text END,
        'status', CASE WHEN invoice.status = 'Paid' THEN 'paid' ELSE 'unpaid' END,
        'shippingStatus', invoice.shipping_status,
        'source', invoice.channel,
        'productName', invoice.product_name,
        'quantity', invoice.quantity,
        'price', COALESCE(invoice.total, 0),
        'date', to_char(invoice.order_date, 'YYYY/MM/DD')
      ) AS order_json
      FROM orders AS invoice
      WHERE invoice.primary_id = row.primary_id
      ORDER BY invoice.order_date DESC, invoice.created_at DESC, invoice.id ASC
      LIMIT 1
    ) AS latest_order ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'no', CASE WHEN invoice.invoice_number IS NULL THEN '#' || left(invoice.id::text, 8)
                   ELSE '#' || invoice.invoice_number::text END,
        'status', CASE WHEN invoice.status = 'Paid' THEN 'paid' ELSE 'unpaid' END,
        'shippingStatus', invoice.shipping_status,
        'source', invoice.channel,
        'productName', invoice.product_name,
        'quantity', invoice.quantity,
        'price', COALESCE(invoice.total, 0),
        'date', to_char(invoice.order_date, 'YYYY/MM/DD')
      ) ORDER BY invoice.order_date DESC, invoice.created_at DESC, invoice.id ASC) AS orders_json
      FROM orders AS invoice
      WHERE invoice.primary_id = row.primary_id
    ) AS order_list ON true
  ),
  w_clock AS (
    SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date AS today
  ),
  w_warranty_trim_chars AS MATERIALIZED (
    -- Keep product-name normalization byte-aligned with migration 105.
    SELECT concat(
      chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760),
      chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197),
      chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232),
      chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)
    ) AS value
  ),
  w_customer_groups AS MATERIALIZED (
    SELECT * FROM customer_groups
  ),
  w_ordered_customer_phones AS MATERIALIZED (
    SELECT
      mapping.primary_id,
      mapping.primary_phone,
      customer.id,
      customer.parent_id,
      customer.name,
      customer.phone,
      customer.phone_mainland,
      row_number() OVER (
        PARTITION BY mapping.primary_id
        ORDER BY
          COALESCE(parent.name, customer.name) ASC NULLS LAST,
          COALESCE(parent.id, customer.id),
          CASE WHEN customer.parent_id IS NULL THEN 0 ELSE 1 END,
          customer.name ASC NULLS LAST,
          customer.id
      ) AS member_sequence
    FROM w_customer_groups AS mapping
    JOIN public.customers AS customer ON customer.id = mapping.member_id
    LEFT JOIN public.customers AS parent ON parent.id = customer.parent_id
  ),
  w_customer_phone_values AS MATERIALIZED (
    SELECT member.primary_id, btrim(line.value, trim_chars.value) AS value,
           member.member_sequence, 0::integer AS field_rank, line.position
    FROM w_ordered_customer_phones AS member
    CROSS JOIN w_warranty_trim_chars AS trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, btrim(line.value, trim_chars.value),
           member.member_sequence, 1, line.position
    FROM w_ordered_customer_phones AS member
    CROSS JOIN w_warranty_trim_chars AS trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone_mainland, ''), E'\n+') WITH ORDINALITY AS line(value, position)
  ),
  w_distinct_customer_phones AS MATERIALIZED (
    SELECT DISTINCT ON (phone.primary_id, phone.value)
      phone.primary_id, phone.value, phone.member_sequence, phone.field_rank, phone.position
    FROM w_customer_phone_values AS phone
    WHERE phone.value <> ''
    ORDER BY phone.primary_id, phone.value, phone.field_rank, phone.member_sequence, phone.position
  ),
  w_customer_search AS MATERIALIZED (
    SELECT
      primary_row.primary_id,
      primary_row.primary_name,
      primary_row.primary_phone,
      COALESCE(jsonb_agg(phone.value ORDER BY phone.field_rank, phone.member_sequence, phone.position)
        FILTER (WHERE phone.value IS NOT NULL), '[]'::jsonb) AS phones
    FROM (
      SELECT DISTINCT primary_id, primary_name, primary_phone FROM w_customer_groups
    ) AS primary_row
    LEFT JOIN w_distinct_customer_phones AS phone ON phone.primary_id = primary_row.primary_id
    GROUP BY primary_row.primary_id, primary_row.primary_name, primary_row.primary_phone
  ),
  w_invoice_keys AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text)) invoice.id
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text), invoice.created_at ASC, invoice.id ASC
  ),
  w_orders AS MATERIALIZED (
    SELECT invoice.id, invoice.invoice_number, invoice.customer_id,
           invoice.date AS order_date, invoice.created_at
    FROM w_invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    JOIN customer_groups AS scope ON scope.member_id = invoice.customer_id
  ),
  w_invoice_lines AS MATERIALIZED (
    SELECT invoice.id AS invoice_id, line.value AS item, line.position
    FROM w_orders AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(invoice.items))
      WITH ORDINALITY AS line(value, position)
  ),
  w_all_products AS MATERIALIZED (
    SELECT product.* FROM public.products AS product
  ),
  w_product_name_lookup AS MATERIALIZED (
    SELECT DISTINCT ON (normalized_name) id, warranty_months, normalized_name
    FROM (
      SELECT product.id,
             product.warranty_months,
             lower(btrim(
               regexp_replace(product.name, '\s+-\s+Default Title$', '', 'i'),
               trim_chars.value
             )) AS normalized_name
      FROM w_all_products AS product
      CROSS JOIN w_warranty_trim_chars AS trim_chars
    ) AS names
    WHERE normalized_name <> ''
    ORDER BY normalized_name, id
  ),
  w_latest_renewals AS MATERIALIZED (
    SELECT DISTINCT ON (renewal.invoice_id, renewal.product_id)
      renewal.invoice_id, renewal.product_id, renewal.months, renewal.paid_at,
      renewal.previous_end, renewal.new_end
    FROM public.warranty_renewals AS renewal
    WHERE renewal.invoice_id IN (SELECT id FROM w_orders)
    ORDER BY renewal.invoice_id, renewal.product_id, renewal.created_at DESC, renewal.id DESC
  ),
  w_warranty_resolved AS MATERIALIZED (
    SELECT
      invoice.id AS invoice_id,
      invoice.invoice_number,
      customer_group.primary_id AS customer_id,
      customer_group.primary_name AS customer_name,
      customer_group.primary_phone AS customer_phone,
      invoice.order_date AS purchase_date,
      line.item,
      line.position,
      COALESCE(product_by_id.id, product_by_name.id) AS resolved_product_id,
      CASE
        WHEN line.item ? 'warranty_months'
          AND jsonb_typeof(line.item->'warranty_months') IN ('null', 'boolean')
          THEN CASE WHEN line.item->>'warranty_months' = 'true' THEN 1 ELSE 0 END
        WHEN line.item ? 'warranty_months'
          AND btrim(COALESCE(line.item->>'warranty_months', '')) = ''
          THEN 0
        WHEN line.item ? 'warranty_months'
          AND btrim(line.item->>'warranty_months') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          THEN trunc((line.item->>'warranty_months')::numeric)::integer
        ELSE CASE
          WHEN product_by_id.id IS NOT NULL THEN COALESCE(product_by_id.warranty_months, 0)
          ELSE COALESCE(product_by_name.warranty_months, 0)
        END
      END AS warranty_months
    FROM w_orders AS invoice
    CROSS JOIN w_warranty_trim_chars AS trim_chars
    JOIN w_customer_groups AS customer_group ON customer_group.member_id = invoice.customer_id
    JOIN w_invoice_lines AS line ON line.invoice_id = invoice.id
    LEFT JOIN w_all_products AS product_by_id
      ON product_by_id.id::text = COALESCE(line.item->>'product_id', '')
    LEFT JOIN w_product_name_lookup AS product_by_name
      ON product_by_id.id IS NULL
     AND product_by_name.normalized_name = lower(btrim(
       regexp_replace(COALESCE(line.item->>'name', ''), '\s+-\s+Default Title$', '', 'i'),
       trim_chars.value
     ))
    WHERE COALESCE(line.item->>'name', '') <> ''
      AND COALESCE(line.item->>'name', '') !~* '運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費'
  ),
  w_warranty_effective AS MATERIALIZED (
    SELECT
      resolved.*,
      COALESCE(renewal.new_end,
        public.bizflow_add_months_clamped(resolved.purchase_date, resolved.warranty_months)) AS expiry,
      renewal.months AS renewal_months,
      renewal.paid_at AS renewal_paid_at,
      renewal.previous_end AS renewal_previous_end,
      renewal.new_end AS renewal_new_end
    FROM w_warranty_resolved AS resolved
    LEFT JOIN w_latest_renewals AS renewal
      ON renewal.invoice_id = resolved.invoice_id
     AND renewal.product_id = resolved.resolved_product_id
    WHERE resolved.warranty_months > 0
  ),
  w_warranty_base AS MATERIALIZED (
    SELECT
      effective.*,
      customer.phones,
      w_clock.today,
      effective.expiry - w_clock.today AS days_left,
      CASE
        WHEN effective.expiry < w_clock.today THEN 'expired'
        WHEN effective.expiry <= w_clock.today + 7 THEN 'week'
        WHEN effective.expiry <= w_clock.today + 30 THEN 'month'
        WHEN effective.expiry <= w_clock.today + 90 THEN 'quarter'
        ELSE 'year'
      END AS bucket,
      CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8)
           ELSE '#' || effective.invoice_number::text END AS no
    FROM w_warranty_effective AS effective
    JOIN w_customer_search AS customer ON customer.primary_id = effective.customer_id
    CROSS JOIN w_clock
    WHERE effective.expiry >= w_clock.today - 30
      AND effective.expiry <= w_clock.today + 365
  )
  SELECT jsonb_build_object(
    'customer', (SELECT jsonb_build_object(
        'id', row.primary_id::text,
        'groupCids', row.group_cids,
        'name', row.display_name,
        'phone', row.display_phone,
        'source', row.source,
        'joinedAt', CASE WHEN row.joined_date IS NULL THEN '' ELSE concat(
          extract(year FROM row.joined_date)::integer, '/',
          extract(month FROM row.joined_date)::integer, '/',
          extract(day FROM row.joined_date)::integer
        ) END,
        'imei', row.imei,
        'imeiCodes', row.imei_codes,
        'allNames', row.all_names,
        'allEmails', row.all_emails,
        'allPhones', row.all_phones,
        'allPhoneMainlands', row.all_phone_mainlands,
        'allCarMakes', row.all_car_makes,
        'allCarModels', row.all_car_models,
        'type', row.customer_type,
        'hasEmail', jsonb_array_length(row.all_emails) > 0,
        'hasPhone', jsonb_array_length(row.all_phones) > 0,
        'hasImei', jsonb_array_length(row.imei_codes) > 0,
        'deviceCount', row.device_count,
        'orderCount', row.order_count,
        'detail', jsonb_build_object(
          'totalAmount', row.total_amount,
          'firstOrderDate', COALESCE(to_char(row.first_order_date, 'YYYY/MM/DD'), ''),
          'email', row.display_email,
          'carMake', row.display_car_make,
          'carModelValue', row.display_car_model,
          'carModel', NULLIF(btrim(concat_ws(' ', NULLIF(row.display_car_make, ''), NULLIF(row.display_car_model, ''))), ''),
          'shippingAddress', row.display_address,
          'order', row.order_json,
          'orders', row.orders_json
        )
      ) FROM page_rows AS row),
    'members', COALESCE((SELECT jsonb_agg(to_jsonb(member) ORDER BY member.member_sequence) FROM ordered_members AS member), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(to_jsonb(device) ORDER BY device.created_at DESC, device.id)
      FROM (SELECT device.id, device.customer_id, device.imei, device.device_type, device.created_at
        FROM public.customer_devices AS device JOIN customer_groups AS mapping ON mapping.member_id = device.customer_id) AS device), '[]'::jsonb),
    'warranties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'invoiceId', row.invoice_id::text,
        'productId', row.resolved_product_id::text,
        'no', row.no,
        'product', COALESCE(NULLIF(row.item->>'name', ''), '—'),
        'customer', COALESCE(NULLIF(row.customer_name, ''), '—'),
        'customerId', row.customer_id::text,
        'phone', COALESCE(row.customer_phone, ''),
        'phones', row.phones,
        'purchaseDate', to_char(row.purchase_date, 'YYYY/MM/DD'),
        'expiry', to_char(row.expiry, 'YYYY/MM/DD'),
        'warrantyMonths', row.warranty_months,
        'bucket', row.bucket,
        'daysLeft', row.days_left,
        'latestRenewal', CASE WHEN row.renewal_new_end IS NULL THEN NULL ELSE jsonb_build_object(
          'months', row.renewal_months,
          'paidAt', to_char(row.renewal_paid_at, 'YYYY/MM/DD'),
          'previousEnd', to_char(row.renewal_previous_end, 'YYYY/MM/DD'),
          'newEnd', to_char(row.renewal_new_end, 'YYYY/MM/DD')
        ) END
      ) ORDER BY row.expiry, row.invoice_id, row.position)
      FROM w_warranty_base AS row), '[]'::jsonb)
  ) WHERE EXISTS (SELECT 1 FROM requested);
$function$;
REVOKE ALL ON FUNCTION public.bizflow_customer_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_customer_detail(uuid) TO authenticated;
COMMENT ON FUNCTION public.bizflow_customer_detail(uuid) IS
  'RLS-scoped customer group detail using 104/108 membership, all historical orders and invoice-line warranties; monetary fields and date-descending display retain the legacy detail contract.';
NOTIFY pgrst, 'reload schema';
COMMIT;
