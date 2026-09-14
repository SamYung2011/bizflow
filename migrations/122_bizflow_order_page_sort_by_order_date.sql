-- 122: sort newest/oldest by order date before import time; retain amount ordering.
BEGIN;
CREATE OR REPLACE FUNCTION public.bizflow_order_page(p_search text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_shipping text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_sort text DEFAULT 'newest'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH
  needle AS (
    SELECT NULLIF(lower(regexp_replace(btrim(p_search), '[[:space:]-]+', '', 'g')), '') AS value
  ),
  invoice_keys AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text))
      invoice.id
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text), invoice.created_at ASC, invoice.id ASC
  ),
  all_base AS MATERIALIZED (
    SELECT
      invoice.id,
      invoice.invoice_number,
      invoice.customer_id,
      invoice.salesperson_id,
      invoice.date AS order_date,
      invoice.created_at,
      invoice.total,
      invoice.status,
      invoice.notes AS raw_notes,
      invoice.tracking_number,
      COALESCE(invoice.bizflow_item_search_text, '') AS item_search_text,
      COALESCE(NULLIF(customer.name, ''), '—') AS customer_name,
      COALESCE(customer.phone, '') AS customer_phone,
      COALESCE(customer.phone_mainland, '') AS customer_phone_mainland,
      COALESCE(customer.email, '') AS customer_email,
      COALESCE(customer.address, '') AS customer_address,
      COALESCE(customer.car_make, '') AS customer_car_make,
      COALESCE(customer.car_model, '') AS customer_car_model,
      COALESCE(employee.name, '') AS salesperson_name,
      CASE
        WHEN COALESCE(invoice.notes, '') LIKE '%__FORMS_BUY__%' THEN 'Framer'
        WHEN COALESCE(invoice.notes, '') LIKE '%__BROADWAY__%' THEN 'Broadway'
        WHEN invoice.invoice_number IS NOT NULL THEN 'Online Store'
        ELSE 'Manual'
      END AS channel,
      COALESCE(NULLIF(invoice.shipping_status, ''), 'unshipped') = 'unshipped'
        AND invoice.date >= DATE '2026-05-05' AS shipping_pending,
      COALESCE(invoice.shipping_status, '') IN ('已發貨', '在途', '派送中') AS shipping_in_transit,
      COALESCE(invoice.shipping_status, '') = '異常'
        OR (
          COALESCE(invoice.shipping_status, '') IN ('已發貨', '在途', '派送中')
          AND (invoice.shipped_at AT TIME ZONE 'Asia/Hong_Kong')::date
            < ((now() AT TIME ZONE 'Asia/Hong_Kong')::date - 14)
        ) AS shipping_exception,
      COALESCE(invoice.shipping_status, '') LIKE ANY (ARRAY['%簽收%', '%签收%']) AS shipping_delivered
    FROM invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    LEFT JOIN public.customers AS customer ON customer.id = invoice.customer_id
    LEFT JOIN public.employees AS employee ON employee.id = invoice.salesperson_id
    WHERE (p_source IS NULL OR (
      CASE
        WHEN COALESCE(invoice.notes, '') LIKE '%__FORMS_BUY__%' THEN 'Framer'
        WHEN COALESCE(invoice.notes, '') LIKE '%__BROADWAY__%' THEN 'Broadway'
        WHEN invoice.invoice_number IS NOT NULL THEN 'Online Store'
        ELSE 'Manual'
      END
    ) = p_source)
      AND (p_date_from IS NULL OR invoice.date >= p_date_from)
      AND (p_date_to IS NULL OR invoice.date <= p_date_to)
  ),
  base AS MATERIALIZED (
    -- UNION ALL makes the no-search branch structurally unable to execute the
    -- visible-note parser. PostgreSQL cannot pull that work back into mounts.
    SELECT row.*
    FROM all_base AS row
    CROSS JOIN needle
    WHERE needle.value IS NULL

    UNION ALL

    SELECT row.*
    FROM all_base AS row
    CROSS JOIN needle
    LEFT JOIN LATERAL (
      SELECT string_agg(btrim(segment.value), ' | ' ORDER BY segment.position) AS notes
      FROM regexp_split_to_table(
        regexp_replace(COALESCE(row.raw_notes, ''), '__[A-Z_]+__(?::[[:alnum:]_-]+)?[[:space:]]*', '', 'g'),
        E'[|\n]'
      ) WITH ORDINALITY AS segment(value, position)
      WHERE NULLIF(btrim(segment.value), '') IS NOT NULL
        AND btrim(segment.value) !~ '^(Framer 表單意向([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]+[0-9]{2}:[0-9]{2})?|Shopify order[[:space:]]+[^[:space:]]+|(financial|fulfillment)=[^[:space:]]*|batch=[^[:space:]]+([[:space:]]+idx=[^[:space:]]+)?([[:space:]]+raw_status=[^[:space:]]+)?)$'
    ) AS visible_notes ON true
    WHERE needle.value IS NOT NULL
      AND lower(regexp_replace(concat_ws(' ',
        row.id::text,
        row.invoice_number::text,
        '#' || COALESCE(row.invoice_number::text, left(row.id::text, 8)),
        'DC' || CASE
          WHEN COALESCE(row.invoice_number::text, row.id::text) ~* '^DC'
            THEN substring(COALESCE(row.invoice_number::text, row.id::text) FROM 3)
          WHEN COALESCE(row.invoice_number::text, row.id::text) ~ '^\d+$'
            THEN lpad(COALESCE(row.invoice_number::text, row.id::text), 5, '0')
          ELSE COALESCE(row.invoice_number::text, row.id::text)
        END,
        row.customer_name,
        row.customer_phone,
        row.customer_phone_mainland,
        row.customer_email,
        row.customer_address,
        row.customer_car_make,
        row.customer_car_model,
        row.salesperson_name,
        visible_notes.notes,
        row.tracking_number,
        row.item_search_text
      ), '[[:space:]-]+', '', 'g')) LIKE '%' || replace(replace(replace(
        needle.value, E'\\', E'\\\\'
      ), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
  ),
  filtered AS MATERIALIZED (
    SELECT row.*
    FROM base AS row
    WHERE p_shipping IS NULL
       OR (p_shipping = 'pending' AND row.shipping_pending)
       OR (p_shipping = 'in_transit' AND row.shipping_in_transit)
       OR (p_shipping = 'exception' AND row.shipping_exception)
       OR (p_shipping = 'delivered' AND row.shipping_delivered)
  ),
  base_summary AS (
    SELECT
      count(*) AS all_count,
      count(*) FILTER (WHERE shipping_pending) AS pending_count,
      count(*) FILTER (WHERE shipping_in_transit) AS in_transit_count,
      count(*) FILTER (WHERE shipping_exception) AS exception_count,
      count(*) FILTER (WHERE shipping_delivered) AS delivered_count,
      min(order_date) AS date_from,
      max(order_date) AS date_to
    FROM base
  ),
  filtered_summary AS (
    SELECT count(*) AS total_count FROM filtered
  ),
  page_keys AS MATERIALIZED (
    SELECT row.*
    FROM filtered AS row
    ORDER BY
      CASE WHEN p_sort = 'oldest' THEN row.order_date END ASC,
      CASE WHEN p_sort = 'oldest' THEN row.created_at END ASC,
      CASE WHEN p_sort = 'amount_desc' THEN row.total END DESC,
      CASE WHEN p_sort = 'amount_asc' THEN row.total END ASC,
      CASE WHEN p_sort NOT IN ('oldest', 'amount_desc', 'amount_asc') THEN row.order_date END DESC,
      CASE WHEN p_sort NOT IN ('oldest', 'amount_desc', 'amount_asc') THEN row.created_at END DESC,
      CASE WHEN p_sort = 'oldest' THEN row.id::text END ASC,
      row.id::text DESC
    OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000)
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50)
  ),
  page_rows AS (
    SELECT
      row.id,
      row.invoice_number,
      row.customer_id,
      row.order_date,
      row.total,
      row.status,
      COALESCE(visible_notes.notes, '') AS notes,
      row.customer_name,
      row.customer_phone,
      row.salesperson_name,
      row.channel,
      first_line.item AS first_item,
      second_line.item AS second_item,
      row.created_at
    FROM page_keys AS row
    JOIN public.invoices AS invoice ON invoice.id = row.id
    LEFT JOIN LATERAL (
      SELECT string_agg(btrim(segment.value), ' | ' ORDER BY segment.position) AS notes
      FROM regexp_split_to_table(
        regexp_replace(COALESCE(row.raw_notes, ''), '__[A-Z_]+__(?::[[:alnum:]_-]+)?[[:space:]]*', '', 'g'),
        E'[|\n]'
      ) WITH ORDINALITY AS segment(value, position)
      WHERE NULLIF(btrim(segment.value), '') IS NOT NULL
        AND btrim(segment.value) !~ '^(Framer 表單意向([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]+[0-9]{2}:[0-9]{2})?|Shopify order[[:space:]]+[^[:space:]]+|(financial|fulfillment)=[^[:space:]]*|batch=[^[:space:]]+([[:space:]]+idx=[^[:space:]]+)?([[:space:]]+raw_status=[^[:space:]]+)?)$'
    ) AS visible_notes ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'name', COALESCE(line.value->>'name', ''),
        'qty', COALESCE(NULLIF(line.value->>'qty', '')::numeric, 1)
      ) AS item
      FROM jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
      WHERE COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
      ORDER BY line.position
      LIMIT 1
    ) AS first_line ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'name', COALESCE(line.value->>'name', ''),
        'qty', COALESCE(NULLIF(line.value->>'qty', '')::numeric, 1)
      ) AS item
      FROM jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
      WHERE COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
      ORDER BY line.position
      OFFSET 1 LIMIT 1
    ) AS second_line ON true
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(page_rows) - 'created_at' ORDER BY
        CASE WHEN p_sort = 'oldest' THEN order_date END ASC,
        CASE WHEN p_sort = 'oldest' THEN created_at END ASC,
        CASE WHEN p_sort = 'amount_desc' THEN total END DESC,
        CASE WHEN p_sort = 'amount_asc' THEN total END ASC,
        CASE WHEN p_sort NOT IN ('oldest', 'amount_desc', 'amount_asc') THEN order_date END DESC,
        CASE WHEN p_sort NOT IN ('oldest', 'amount_desc', 'amount_asc') THEN created_at END DESC,
        CASE WHEN p_sort = 'oldest' THEN id::text END ASC,
        id::text DESC)
      FROM page_rows
    ), '[]'::jsonb),
    'total_count', filtered_summary.total_count,
    'date_from', COALESCE(to_char(base_summary.date_from, 'YYYY/MM/DD'), ''),
    'date_to', COALESCE(to_char(base_summary.date_to, 'YYYY/MM/DD'), ''),
    'shipping_counts', jsonb_build_object(
      'all', base_summary.all_count,
      'pending', base_summary.pending_count,
      'in_transit', base_summary.in_transit_count,
      'exception', base_summary.exception_count,
      'delivered', base_summary.delivered_count
    )
  )
  FROM base_summary CROSS JOIN filtered_summary;
$function$;
REVOKE ALL ON FUNCTION public.bizflow_order_page(text,text,text,date,date,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_order_page(text,text,text,date,date,text,integer,integer) TO authenticated;
COMMIT;
