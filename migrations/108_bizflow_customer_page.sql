-- 108: server-packed customer and warranty pages.
--
-- The reviewed customer union-find remains public.bizflow_customer_group_map()
-- (migration 104). These two bounded RPCs reuse that exact membership/primary
-- map, then aggregate only the fields needed by the customer and warranty tabs.
-- They stay SECURITY INVOKER so every table read and the revenue gate retain RLS.

BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_customer_page(
  p_search text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_imei text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_sort text DEFAULT 'createdDesc',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 18
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
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
  revenue_access AS MATERIALIZED (
    SELECT EXISTS (
      SELECT 1
      FROM public.employees AS employee
      WHERE employee.user_id = auth.uid()
        AND (employee.is_admin = true OR employee.can_view_revenue = true)
    ) AS allowed
  ),
  needle AS (
    SELECT
      NULLIF(lower(btrim(COALESCE(p_search, ''), trim_chars.value)), '') AS raw_value,
      NULLIF(lower(regexp_replace(
        translate(btrim(COALESCE(p_search, ''), trim_chars.value), trim_chars.value, ''),
        '-+', '', 'g'
      )), '') AS compact_value
    FROM trim_chars
  ),
  customer_groups AS MATERIALIZED (
    SELECT * FROM public.bizflow_customer_group_map()
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
      CASE
        WHEN COALESCE(invoice.notes, '') LIKE '%__FORMS_BUY__%' THEN 'framer'
        WHEN COALESCE(invoice.notes, '') LIKE '%__BROADWAY__%' THEN 'other'
        WHEN invoice.invoice_number::text ~ '^[0-9]+$' THEN 'shopify'
        ELSE 'other'
      END AS customer_source,
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
    ORDER BY row.primary_id, row.created_at ASC, row.order_date ASC, row.id DESC
  ),
  source_orders AS MATERIALIZED (
    SELECT DISTINCT ON (row.primary_id)
      row.primary_id,
      row.customer_source AS source
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
      CASE WHEN access.allowed THEN COALESCE(stats.total_amount, 0) ELSE 0 END AS total_amount,
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
    CROSS JOIN revenue_access AS access
    LEFT JOIN order_stats AS stats ON stats.primary_id = ids.primary_id
    LEFT JOIN first_orders AS first_order ON first_order.primary_id = ids.primary_id
    LEFT JOIN source_orders AS source ON source.primary_id = ids.primary_id
    LEFT JOIN device_stats AS device ON device.primary_id = ids.primary_id
  ),
  list_base AS MATERIALIZED (
    SELECT row.*
    FROM grouped AS row
    WHERE jsonb_array_length(row.all_emails) > 0
       OR jsonb_array_length(row.all_phones) > 0
       OR jsonb_array_length(row.imei_codes) > 0
  ),
  base_summary AS (
    SELECT
      (SELECT count(*) FROM grouped) AS customer_count,
      count(*) AS list_count,
      min(joined_date) AS date_from,
      max(joined_date) AS date_to,
      count(*) FILTER (WHERE source = 'shopify') AS shopify_count,
      count(*) FILTER (WHERE source = 'framer') AS framer_count,
      count(*) FILTER (WHERE source = 'other') AS other_count,
      count(*) FILTER (WHERE jsonb_array_length(imei_codes) > 0) AS imei_count,
      count(*) FILTER (WHERE jsonb_array_length(imei_codes) = 0) AS no_imei_count
    FROM list_base
  ),
  filtered AS MATERIALIZED (
    SELECT row.*
    FROM list_base AS row
    CROSS JOIN needle
    CROSS JOIN trim_chars
    WHERE (p_source IS NULL OR p_source = 'all' OR row.source = p_source)
      AND (p_imei IS NULL OR p_imei = 'all'
        OR (p_imei = 'has' AND jsonb_array_length(row.imei_codes) > 0)
        OR (p_imei = 'none' AND jsonb_array_length(row.imei_codes) = 0))
      AND (p_date_from IS NULL OR row.joined_date >= p_date_from)
      AND (p_date_to IS NULL OR row.joined_date <= p_date_to)
      AND (needle.raw_value IS NULL OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          jsonb_build_array(
            row.display_name, row.display_phone, row.display_email,
            row.display_phone_mainland, row.display_car_make, row.display_car_model,
            btrim(concat_ws(' ', NULLIF(row.display_car_make, ''), NULLIF(row.display_car_model, ''))),
            row.imei
          ) || row.all_names || row.all_phones || row.all_phone_mainlands ||
          row.all_emails || row.all_car_makes || row.all_car_models || row.imei_codes
        ) AS search_value(value)
        WHERE lower(search_value.value)
            LIKE '%' || replace(replace(replace(needle.raw_value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
           OR lower(regexp_replace(translate(search_value.value, trim_chars.value, ''), '-+', '', 'g'))
            LIKE '%' || replace(replace(replace(needle.compact_value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
      ))
  ),
  filtered_summary AS (
    SELECT count(*) AS total_count FROM filtered
  ),
  page_keys AS MATERIALIZED (
    SELECT row.*
    FROM filtered AS row
    ORDER BY
      CASE WHEN p_sort = 'createdAsc' THEN row.joined_date END ASC NULLS LAST,
      CASE WHEN p_sort = 'lastPurchaseDesc' THEN row.last_order_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'lastPurchaseAsc' THEN row.last_order_date END ASC NULLS LAST,
      CASE WHEN p_sort NOT IN ('createdAsc', 'lastPurchaseDesc', 'lastPurchaseAsc') THEN row.joined_date END DESC NULLS LAST,
      row.last_created_at DESC NULLS LAST,
      row.joined_at DESC NULLS LAST,
      row.primary_id
    OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000)
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 18), 1), 50)
  ),
  page_rows AS MATERIALIZED (
    SELECT
      row.*,
      latest_order.order_json,
      COALESCE(order_list.orders_json, '[]'::jsonb) AS orders_json
    FROM page_keys AS row
    CROSS JOIN revenue_access AS access
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'no', CASE WHEN invoice.invoice_number IS NULL THEN '#' || left(invoice.id::text, 8)
                   ELSE '#' || invoice.invoice_number::text END,
        'status', CASE WHEN invoice.status = 'Paid' THEN 'paid' ELSE 'unpaid' END,
        'shippingStatus', invoice.shipping_status,
        'source', invoice.channel,
        'productName', invoice.product_name,
        'quantity', invoice.quantity,
        'price', CASE WHEN access.allowed THEN COALESCE(invoice.total, 0) ELSE 0 END,
        'date', to_char(invoice.order_date, 'YYYY/MM/DD')
      ) AS order_json
      FROM orders AS invoice
      WHERE invoice.primary_id = row.primary_id
      ORDER BY invoice.created_at DESC, invoice.order_date DESC, invoice.id ASC
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
        'price', CASE WHEN access.allowed THEN COALESCE(invoice.total, 0) ELSE 0 END,
        'date', to_char(invoice.order_date, 'YYYY/MM/DD')
      ) ORDER BY invoice.created_at DESC, invoice.order_date DESC, invoice.id ASC) AS orders_json
      FROM orders AS invoice
      WHERE invoice.primary_id = row.primary_id
    ) AS order_list ON true
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
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
      ) ORDER BY
        CASE WHEN p_sort = 'createdAsc' THEN row.joined_date END ASC NULLS LAST,
        CASE WHEN p_sort = 'lastPurchaseDesc' THEN row.last_order_date END DESC NULLS LAST,
        CASE WHEN p_sort = 'lastPurchaseAsc' THEN row.last_order_date END ASC NULLS LAST,
        CASE WHEN p_sort NOT IN ('createdAsc', 'lastPurchaseDesc', 'lastPurchaseAsc') THEN row.joined_date END DESC NULLS LAST,
        row.last_created_at DESC NULLS LAST,
        row.joined_at DESC NULLS LAST,
        row.primary_id)
      FROM page_rows AS row
    ), '[]'::jsonb),
    'total_count', filtered_summary.total_count,
    'customer_count', base_summary.customer_count,
    'date_from', COALESCE(to_char(base_summary.date_from, 'YYYY/MM/DD'), ''),
    'date_to', COALESCE(to_char(base_summary.date_to, 'YYYY/MM/DD'), ''),
    'source_counts', jsonb_build_object(
      'all', base_summary.list_count,
      'shopify', base_summary.shopify_count,
      'framer', base_summary.framer_count,
      'other', base_summary.other_count
    ),
    'imei_counts', jsonb_build_object(
      'all', base_summary.list_count,
      'has', base_summary.imei_count,
      'none', base_summary.no_imei_count
    )
  )
  FROM base_summary CROSS JOIN filtered_summary;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_customer_page(text, text, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_customer_page(text, text, text, date, date, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.bizflow_warranty_page(
  p_search text DEFAULT NULL,
  p_bucket text DEFAULT NULL,
  p_purchase_from date DEFAULT NULL,
  p_purchase_to date DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 18
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH
  clock AS (
    SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date AS today
  ),
  warranty_trim_chars AS MATERIALIZED (
    -- Keep product-name normalization byte-aligned with migration 105.
    SELECT concat(
      chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760),
      chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197),
      chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232),
      chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)
    ) AS value
  ),
  needle AS (
    SELECT
      NULLIF(lower(btrim(COALESCE(p_search, ''), trim_chars.value)), '') AS raw_value,
      NULLIF(lower(regexp_replace(
        translate(btrim(COALESCE(p_search, ''), trim_chars.value), trim_chars.value, ''),
        '-+', '', 'g'
      )), '') AS compact_value
    FROM warranty_trim_chars AS trim_chars
  ),
  customer_groups AS MATERIALIZED (
    SELECT * FROM public.bizflow_customer_group_map()
  ),
  ordered_customer_phones AS MATERIALIZED (
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
    FROM customer_groups AS mapping
    JOIN public.customers AS customer ON customer.id = mapping.member_id
    LEFT JOIN public.customers AS parent ON parent.id = customer.parent_id
  ),
  customer_phone_values AS MATERIALIZED (
    SELECT member.primary_id, btrim(line.value, trim_chars.value) AS value,
           member.member_sequence, 0::integer AS field_rank, line.position
    FROM ordered_customer_phones AS member
    CROSS JOIN warranty_trim_chars AS trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, btrim(line.value, trim_chars.value),
           member.member_sequence, 1, line.position
    FROM ordered_customer_phones AS member
    CROSS JOIN warranty_trim_chars AS trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone_mainland, ''), E'\n+') WITH ORDINALITY AS line(value, position)
  ),
  distinct_customer_phones AS MATERIALIZED (
    SELECT DISTINCT ON (phone.primary_id, phone.value)
      phone.primary_id, phone.value, phone.member_sequence, phone.field_rank, phone.position
    FROM customer_phone_values AS phone
    WHERE phone.value <> ''
    ORDER BY phone.primary_id, phone.value, phone.field_rank, phone.member_sequence, phone.position
  ),
  customer_search AS MATERIALIZED (
    SELECT
      primary_row.primary_id,
      primary_row.primary_name,
      primary_row.primary_phone,
      COALESCE(jsonb_agg(phone.value ORDER BY phone.field_rank, phone.member_sequence, phone.position)
        FILTER (WHERE phone.value IS NOT NULL), '[]'::jsonb) AS phones
    FROM (
      SELECT DISTINCT primary_id, primary_name, primary_phone FROM customer_groups
    ) AS primary_row
    LEFT JOIN distinct_customer_phones AS phone ON phone.primary_id = primary_row.primary_id
    GROUP BY primary_row.primary_id, primary_row.primary_name, primary_row.primary_phone
  ),
  invoice_keys AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text)) invoice.id
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text), invoice.created_at ASC, invoice.id ASC
  ),
  orders AS MATERIALIZED (
    SELECT invoice.id, invoice.invoice_number, invoice.customer_id,
           invoice.date AS order_date, invoice.created_at
    FROM invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
  ),
  invoice_lines AS MATERIALIZED (
    SELECT invoice.id AS invoice_id, line.value AS item, line.position
    FROM invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(invoice.items))
      WITH ORDINALITY AS line(value, position)
  ),
  all_products AS MATERIALIZED (
    SELECT product.* FROM public.products AS product
  ),
  product_name_lookup AS MATERIALIZED (
    SELECT DISTINCT ON (normalized_name) id, warranty_months, normalized_name
    FROM (
      SELECT product.id,
             product.warranty_months,
             lower(btrim(
               regexp_replace(product.name, '\s+-\s+Default Title$', '', 'i'),
               trim_chars.value
             )) AS normalized_name
      FROM all_products AS product
      CROSS JOIN warranty_trim_chars AS trim_chars
    ) AS names
    WHERE normalized_name <> ''
    ORDER BY normalized_name, id
  ),
  latest_renewals AS MATERIALIZED (
    SELECT DISTINCT ON (renewal.invoice_id, renewal.product_id)
      renewal.invoice_id, renewal.product_id, renewal.months, renewal.paid_at,
      renewal.previous_end, renewal.new_end
    FROM public.warranty_renewals AS renewal
    ORDER BY renewal.invoice_id, renewal.product_id, renewal.created_at DESC, renewal.id DESC
  ),
  warranty_resolved AS MATERIALIZED (
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
    FROM orders AS invoice
    CROSS JOIN warranty_trim_chars AS trim_chars
    JOIN customer_groups AS customer_group ON customer_group.member_id = invoice.customer_id
    JOIN invoice_lines AS line ON line.invoice_id = invoice.id
    LEFT JOIN all_products AS product_by_id
      ON product_by_id.id::text = COALESCE(line.item->>'product_id', '')
    LEFT JOIN product_name_lookup AS product_by_name
      ON product_by_id.id IS NULL
     AND product_by_name.normalized_name = lower(btrim(
       regexp_replace(COALESCE(line.item->>'name', ''), '\s+-\s+Default Title$', '', 'i'),
       trim_chars.value
     ))
    WHERE COALESCE(line.item->>'name', '') <> ''
      AND COALESCE(line.item->>'name', '') !~* '運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費'
  ),
  warranty_effective AS MATERIALIZED (
    SELECT
      resolved.*,
      COALESCE(renewal.new_end,
        public.bizflow_add_months_clamped(resolved.purchase_date, resolved.warranty_months)) AS expiry,
      renewal.months AS renewal_months,
      renewal.paid_at AS renewal_paid_at,
      renewal.previous_end AS renewal_previous_end,
      renewal.new_end AS renewal_new_end
    FROM warranty_resolved AS resolved
    LEFT JOIN latest_renewals AS renewal
      ON renewal.invoice_id = resolved.invoice_id
     AND renewal.product_id = resolved.resolved_product_id
    WHERE resolved.warranty_months > 0
  ),
  warranty_base AS MATERIALIZED (
    SELECT
      effective.*,
      customer.phones,
      clock.today,
      effective.expiry - clock.today AS days_left,
      CASE
        WHEN effective.expiry < clock.today THEN 'expired'
        WHEN effective.expiry <= clock.today + 7 THEN 'week'
        WHEN effective.expiry <= clock.today + 30 THEN 'month'
        WHEN effective.expiry <= clock.today + 90 THEN 'quarter'
        ELSE 'year'
      END AS bucket,
      CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8)
           ELSE '#' || effective.invoice_number::text END AS no
    FROM warranty_effective AS effective
    JOIN customer_search AS customer ON customer.primary_id = effective.customer_id
    CROSS JOIN clock
    WHERE effective.expiry >= clock.today - 30
      AND effective.expiry <= clock.today + 365
  ),
  base_summary AS (
    SELECT
      count(*) AS all_count,
      count(*) FILTER (WHERE bucket = 'expired') AS expired_count,
      count(*) FILTER (WHERE bucket = 'week') AS week_count,
      count(*) FILTER (WHERE bucket = 'month') AS month_count,
      count(*) FILTER (WHERE bucket = 'quarter') AS quarter_count,
      count(*) FILTER (WHERE bucket = 'year') AS year_count
    FROM warranty_base
  ),
  filtered AS MATERIALIZED (
    SELECT row.*
    FROM warranty_base AS row
    CROSS JOIN needle
    CROSS JOIN warranty_trim_chars AS trim_chars
    WHERE (p_bucket IS NULL OR p_bucket = 'all' OR row.bucket = p_bucket)
      AND (p_purchase_from IS NULL OR row.purchase_date >= p_purchase_from)
      AND (p_purchase_to IS NULL OR row.purchase_date <= p_purchase_to)
      AND (needle.raw_value IS NULL OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          jsonb_build_array(row.customer_name, row.customer_phone, COALESCE(row.item->>'name', ''), row.no) || row.phones
        ) AS search_value(value)
        WHERE lower(search_value.value)
            LIKE '%' || replace(replace(replace(needle.raw_value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
           OR lower(regexp_replace(translate(search_value.value, trim_chars.value, ''), '-+', '', 'g'))
            LIKE '%' || replace(replace(replace(needle.compact_value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
      ))
  ),
  filtered_summary AS (
    SELECT count(*) AS total_count FROM filtered
  ),
  page_rows AS MATERIALIZED (
    SELECT row.*
    FROM filtered AS row
    ORDER BY row.expiry, row.invoice_id, row.position
    OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000)
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 18), 1), 50)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
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
      FROM page_rows AS row
    ), '[]'::jsonb),
    'total_count', filtered_summary.total_count,
    'bucket_counts', jsonb_build_object(
      'all', base_summary.all_count,
      'expired', base_summary.expired_count,
      'week', base_summary.week_count,
      'month', base_summary.month_count,
      'quarter', base_summary.quarter_count,
      'year', base_summary.year_count
    )
  )
  FROM base_summary CROSS JOIN filtered_summary;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_warranty_page(text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_warranty_page(text, text, date, date, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.bizflow_customer_page(text, text, text, date, date, text, integer, integer) IS
  'RLS-scoped, server-grouped customer list page with revenue-gated monetary fields.';
COMMENT ON FUNCTION public.bizflow_warranty_page(text, text, date, date, integer, integer) IS
  'RLS-scoped warranty reminder page using the migration-105 matching contract.';

COMMIT;

-- Rollback reference (manual only):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.bizflow_customer_page(text, text, text, date, date, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.bizflow_warranty_page(text, text, date, date, integer, integer);
-- COMMIT;
