-- 103: Treat legacy non-array invoice item payloads as empty item lists.
-- This matches the existing frontend contract: malformed JSONB item values are
-- still valid invoice rows, but they contribute no item-level detail.

BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_jsonb_array(input_value jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(input_value) = 'array' THEN input_value
    ELSE '[]'::jsonb
  END;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_jsonb_array(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_jsonb_array(jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.bizflow_order_list
WITH (security_invoker = true)
AS
WITH ranked AS (
  SELECT i.*,
         row_number() OVER (
           PARTITION BY COALESCE(i.invoice_number::text, i.id::text)
           ORDER BY i.created_at ASC, i.id ASC
         ) AS duplicate_rank
  FROM public.invoices AS i
  WHERE i.items IS NOT NULL AND i.date IS NOT NULL
), deduped AS (
  SELECT * FROM ranked WHERE duplicate_rank = 1
)
SELECT
  i.id,
  i.invoice_number,
  i.customer_id,
  i.salesperson_id,
  i.date AS order_date,
  i.created_at,
  i.total,
  i.status,
  COALESCE(visible_notes.notes, '') AS notes,
  COALESCE(NULLIF(i.shipping_status, ''), 'unshipped') AS shipping_status,
  i.shipped_at,
  i.tracking_number,
  COALESCE(NULLIF(c.name, ''), '—') AS customer_name,
  COALESCE(c.phone, '') AS customer_phone,
  COALESCE(e.name, '') AS salesperson_name,
  CASE
    WHEN COALESCE(i.notes, '') LIKE '%__FORMS_BUY__%' THEN 'Framer'
    WHEN COALESCE(i.notes, '') LIKE '%__BROADWAY__%' THEN 'Broadway'
    WHEN i.invoice_number IS NOT NULL THEN 'Online Store'
    ELSE 'Manual'
  END AS channel,
  first_line.item AS first_item,
  second_line.item AS second_item,
  COALESCE(NULLIF(i.shipping_status, ''), 'unshipped') = 'unshipped'
    AND i.date >= DATE '2026-05-05' AS shipping_pending,
  COALESCE(i.shipping_status, '') IN ('已發貨', '在途', '派送中') AS shipping_in_transit,
  COALESCE(i.shipping_status, '') = '異常'
    OR (
      COALESCE(i.shipping_status, '') IN ('已發貨', '在途', '派送中')
      AND (i.shipped_at AT TIME ZONE 'Asia/Hong_Kong')::date < ((now() AT TIME ZONE 'Asia/Hong_Kong')::date - 14)
    ) AS shipping_exception,
  COALESCE(i.shipping_status, '') LIKE ANY (ARRAY['%簽收%', '%签收%']) AS shipping_delivered,
  lower(regexp_replace(concat_ws(' ',
    i.id::text,
    i.invoice_number::text,
    '#' || COALESCE(i.invoice_number::text, left(i.id::text, 8)),
    'DC' || CASE
      WHEN COALESCE(i.invoice_number::text, i.id::text) ~* '^DC' THEN substring(COALESCE(i.invoice_number::text, i.id::text) FROM 3)
      WHEN COALESCE(i.invoice_number::text, i.id::text) ~ '^\d+$' THEN lpad(COALESCE(i.invoice_number::text, i.id::text), 5, '0')
      ELSE COALESCE(i.invoice_number::text, i.id::text)
    END,
    c.name,
    c.phone,
    c.phone_mainland,
    c.email,
    c.address,
    c.car_make,
    c.car_model,
    e.name,
    visible_notes.notes,
    i.tracking_number,
    i.items::text
  ), '[[:space:]-]+', '', 'g')) AS search_text
FROM deduped AS i
LEFT JOIN public.customers AS c ON c.id = i.customer_id
LEFT JOIN public.employees AS e ON e.id = i.salesperson_id
LEFT JOIN LATERAL (
  SELECT string_agg(btrim(segment.value), ' | ' ORDER BY segment.position) AS notes
  FROM regexp_split_to_table(
    regexp_replace(COALESCE(i.notes, ''), '__[A-Z_]+__(?::[[:alnum:]_-]+)?[[:space:]]*', '', 'g'),
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
  FROM jsonb_array_elements(public.bizflow_jsonb_array(i.items)) WITH ORDINALITY AS line(value, position)
  WHERE COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
  ORDER BY line.position
  LIMIT 1
) AS first_line ON true
LEFT JOIN LATERAL (
  SELECT jsonb_build_object(
    'name', COALESCE(line.value->>'name', ''),
    'qty', COALESCE(NULLIF(line.value->>'qty', '')::numeric, 1)
  ) AS item
  FROM jsonb_array_elements(public.bizflow_jsonb_array(i.items)) WITH ORDINALITY AS line(value, position)
  WHERE COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
  ORDER BY line.position
  OFFSET 1 LIMIT 1
) AS second_line ON true;

REVOKE ALL ON public.bizflow_order_list FROM PUBLIC, anon;
GRANT SELECT ON public.bizflow_order_list TO authenticated;

CREATE OR REPLACE FUNCTION public.bizflow_order_revenue(p_range text DEFAULT '12m')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH
  clock AS (
    SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date AS today,
           date_trunc('month', now() AT TIME ZONE 'Asia/Hong_Kong')::date AS month_start
  ),
  bounds AS (
    SELECT
      CASE p_range
        WHEN 'all' THEN DATE '2000-01-01'
        WHEN 'year' THEN make_date(extract(year FROM today)::integer, 1, 1)
        WHEN 'thisMonth' THEN month_start
        WHEN 'lastMonth' THEN (month_start - interval '1 month')::date
        WHEN '3m' THEN (today - interval '3 months')::date
        ELSE (today - interval '12 months')::date
      END AS date_from,
      CASE p_range
        WHEN 'thisMonth' THEN (month_start + interval '1 month')::date
        WHEN 'lastMonth' THEN month_start
        ELSE today + 1
      END AS date_to
    FROM clock
  ),
  deduped_invoices AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text))
      invoice.id,
      invoice.invoice_number,
      invoice.customer_id,
      invoice.date AS order_date,
      invoice.created_at,
      invoice.total,
      invoice.status,
      invoice.items
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text), invoice.created_at ASC, invoice.id ASC
  ),
  orders AS MATERIALIZED (
    SELECT invoice.*,
           COALESCE(NULLIF(customer.name, ''), '—') AS customer_name
    FROM deduped_invoices AS invoice
    CROSS JOIN bounds
    LEFT JOIN public.customers AS customer ON customer.id = invoice.customer_id
    WHERE invoice.order_date >= bounds.date_from AND invoice.order_date < bounds.date_to
  ),
  totals AS (
    SELECT
      COALESCE(sum(total) FILTER (WHERE status = 'Paid'), 0) AS total_revenue,
      count(*) FILTER (WHERE status = 'Paid') AS paid_count,
      count(*) FILTER (WHERE COALESCE(status, '') <> 'Paid') AS unpaid_count,
      COALESCE(sum(total) FILTER (WHERE COALESCE(status, '') <> 'Paid'), 0) AS unpaid_amount
    FROM orders
  ),
  month_rows AS (
    SELECT to_char(order_date, 'YYYY-MM') AS label, sum(total) AS value
    FROM orders
    WHERE status = 'Paid'
    GROUP BY to_char(order_date, 'YYYY-MM')
  ),
  line_items AS (
    SELECT
      row.id AS order_id,
      line.position,
      COALESCE(line.value->>'name', '') AS name,
      COALESCE(NULLIF(line.value->>'qty', '')::numeric, 1) *
        COALESCE(NULLIF(line.value->>'price', '')::numeric, 0) AS amount
    FROM orders AS row
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(row.items))
      WITH ORDINALITY AS line(value, position)
    WHERE row.status = 'Paid'
      AND COALESCE(line.value->>'name', '') <> ''
      AND COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
  ),
  aliases AS MATERIALIZED (
    SELECT lower(btrim(alias.alias_name)) AS alias_key,
           alias.skip,
           alias.products
    FROM public.line_item_aliases AS alias
  ),
  products_visible AS MATERIALIZED (
    SELECT product.id,
           product.name,
           lower(btrim(regexp_replace(product.name, '\s*-\s*Default Title\s*$', '', 'i'))) AS normalized_name
    FROM public.products AS product
  ),
  product_name_lookup AS MATERIALIZED (
    SELECT DISTINCT ON (product.normalized_name)
      product.normalized_name,
      product.name
    FROM products_visible AS product
    WHERE product.normalized_name <> ''
    ORDER BY product.normalized_name, product.id
  ),
  aliased_lines AS (
    SELECT line.*,
           alias.skip AS alias_skip,
           COALESCE(alias.products, '[]'::jsonb) AS alias_products
    FROM line_items AS line
    LEFT JOIN aliases AS alias
      ON alias.alias_key = lower(btrim(line.name))
  ),
  mapped_sales AS (
    SELECT
      COALESCE(NULLIF(product.name, ''), line.name) AS name,
      line.amount * mapping.quantity /
        NULLIF(sum(mapping.quantity) OVER (PARTITION BY line.order_id, line.position), 0) AS amount
    FROM aliased_lines AS line
    CROSS JOIN LATERAL (
      SELECT mapping.value,
             COALESCE(NULLIF(mapping.value->>'qty', '')::numeric, 1) AS quantity
      FROM jsonb_array_elements(public.bizflow_jsonb_array(line.alias_products)) AS mapping(value)
    ) AS mapping
    LEFT JOIN products_visible AS product ON product.id::text = mapping.value->>'product_id'
    WHERE line.alias_skip IS NOT TRUE
  ),
  direct_sales AS (
    SELECT COALESCE(NULLIF(product.name, ''), regexp_replace(line.name, '\s*-\s*Default Title\s*$', '', 'i')) AS name,
           line.amount
    FROM aliased_lines AS line
    LEFT JOIN product_name_lookup AS product
      ON product.normalized_name = lower(btrim(regexp_replace(line.name, '\s*-\s*Default Title\s*$', '', 'i')))
    WHERE line.alias_skip IS NOT TRUE AND jsonb_array_length(line.alias_products) = 0
  ),
  product_totals AS (
    SELECT name, sum(amount) AS amount
    FROM (SELECT * FROM mapped_sales UNION ALL SELECT * FROM direct_sales) AS sale
    WHERE NULLIF(btrim(name), '') IS NOT NULL
    GROUP BY name
    ORDER BY sum(amount) DESC, name
    LIMIT 100
  ),
  customer_totals AS (
    SELECT COALESCE(row.customer_id::text, 'order:' || lower(btrim(row.customer_name))) AS id,
           COALESCE(NULLIF(row.customer_name, ''), '—') AS name,
           sum(row.total) AS total_amount
    FROM orders AS row
    GROUP BY COALESCE(row.customer_id::text, 'order:' || lower(btrim(row.customer_name))),
             COALESCE(NULLIF(row.customer_name, ''), '—')
    ORDER BY sum(row.total) DESC, name
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'total_revenue', totals.total_revenue,
    'paid_count', totals.paid_count,
    'average', CASE WHEN totals.paid_count > 0 THEN round(totals.total_revenue / totals.paid_count) ELSE 0 END,
    'unpaid_count', totals.unpaid_count,
    'unpaid_amount', totals.unpaid_amount,
    'months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'value', value) ORDER BY label)
      FROM month_rows
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', name, 'amount', amount) ORDER BY amount DESC, name)
      FROM product_totals
    ), '[]'::jsonb),
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'totalAmount', total_amount) ORDER BY total_amount DESC, name)
      FROM customer_totals
    ), '[]'::jsonb),
    'single_month', p_range IN ('thisMonth', 'lastMonth')
  )
  FROM totals;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_order_revenue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_order_revenue(text) TO authenticated;

CREATE OR REPLACE VIEW public.bizflow_warranty_rows
WITH (security_invoker = true)
AS
WITH ranked AS (
  SELECT i.*,
         row_number() OVER (
           PARTITION BY COALESCE(i.invoice_number::text, i.id::text)
           ORDER BY i.created_at ASC, i.id ASC
         ) AS duplicate_rank
  FROM public.invoices AS i
  WHERE i.items IS NOT NULL AND i.date IS NOT NULL
), deduped AS (
  SELECT * FROM ranked WHERE duplicate_rank = 1
), lines AS (
  SELECT i.id AS invoice_id, i.invoice_number, i.customer_id, i.date AS purchase_date,
         line.value AS item, line.position
  FROM deduped AS i
  CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(i.items)) WITH ORDINALITY AS line(value, position)
  WHERE COALESCE(line.value->>'name', '') <> ''
    AND COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費'
), resolved AS (
  SELECT lines.*,
         product.id AS resolved_product_id,
         COALESCE(NULLIF(lines.item->>'warranty_months', '')::integer, product.warranty_months, 0) AS warranty_months
  FROM lines
  LEFT JOIN LATERAL (
    SELECT p.id, p.warranty_months
    FROM public.products AS p
    WHERE p.id::text = COALESCE(lines.item->>'product_id', '')
       OR lower(regexp_replace(p.name, '\s+-\s+Default Title$', '', 'i')) =
          lower(regexp_replace(COALESCE(lines.item->>'name', ''), '\s+-\s+Default Title$', '', 'i'))
    ORDER BY (p.id::text = COALESCE(lines.item->>'product_id', '')) DESC, p.id
    LIMIT 1
  ) AS product ON true
), effective AS (
  SELECT resolved.*,
         renewal.months AS renewal_months,
         renewal.paid_at AS renewal_paid_at,
         renewal.previous_end AS renewal_previous_end,
         renewal.new_end AS renewal_new_end,
         COALESCE(
           renewal.new_end,
           public.bizflow_add_months_clamped(resolved.purchase_date, resolved.warranty_months)
         ) AS expiry
  FROM resolved
  LEFT JOIN LATERAL (
    SELECT r.months, r.paid_at, r.previous_end, r.new_end
    FROM public.warranty_renewals AS r
    WHERE r.invoice_id = resolved.invoice_id
      AND r.product_id = resolved.resolved_product_id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1
  ) AS renewal ON true
  WHERE resolved.warranty_months > 0
)
SELECT effective.invoice_id,
       effective.resolved_product_id AS product_id,
       effective.customer_id,
       CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8) ELSE '#' || effective.invoice_number::text END AS no,
       COALESCE(effective.item->>'name', '—') AS product,
       COALESCE(NULLIF(customer.name, ''), '—') AS customer,
       COALESCE(customer.phone, '') AS phone,
       effective.purchase_date,
       effective.expiry,
       effective.warranty_months,
       effective.renewal_months,
       effective.renewal_paid_at,
       effective.renewal_previous_end,
       effective.renewal_new_end
FROM effective
LEFT JOIN public.customers AS customer ON customer.id = effective.customer_id;

REVOKE ALL ON public.bizflow_warranty_rows FROM PUBLIC, anon;
GRANT SELECT ON public.bizflow_warranty_rows TO authenticated;

CREATE OR REPLACE FUNCTION public.bizflow_home_dashboard(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH
  clock AS (
    SELECT (now() AT TIME ZONE 'Asia/Hong_Kong')::date AS today,
           date_trunc('month', now() AT TIME ZONE 'Asia/Hong_Kong')::date AS month_start,
           (date_trunc('month', now() AT TIME ZONE 'Asia/Hong_Kong') + interval '1 month')::date AS month_end
  ),
  customers_visible AS MATERIALIZED (
    SELECT customer.id, customer.name, customer.phone
    FROM public.customers AS customer
  ),
  invoice_ranks AS MATERIALIZED (
    SELECT invoice.*,
           row_number() OVER (
             PARTITION BY COALESCE(invoice.invoice_number::text, invoice.id::text)
             ORDER BY invoice.created_at ASC, invoice.id ASC
           ) AS duplicate_rank
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
  ),
  deduped_invoices AS MATERIALIZED (
    SELECT * FROM invoice_ranks WHERE duplicate_rank = 1
  ),
  orders AS MATERIALIZED (
    SELECT
      invoice.id,
      invoice.invoice_number,
      invoice.customer_id,
      invoice.date AS order_date,
      invoice.created_at,
      invoice.total,
      invoice.status,
      invoice.items,
      COALESCE(NULLIF(customer.name, ''), '—') AS customer_name,
      COALESCE(customer.phone, '') AS customer_phone,
      first_line.item AS first_item,
      COALESCE(NULLIF(invoice.shipping_status, ''), 'unshipped') = 'unshipped'
        AND invoice.date >= DATE '2026-05-05' AS shipping_pending,
      COALESCE(invoice.shipping_status, '') IN ('已發貨', '在途', '派送中') AS shipping_in_transit,
      COALESCE(invoice.shipping_status, '') = '異常'
        OR (
          COALESCE(invoice.shipping_status, '') IN ('已發貨', '在途', '派送中')
          AND (invoice.shipped_at AT TIME ZONE 'Asia/Hong_Kong')::date < ((now() AT TIME ZONE 'Asia/Hong_Kong')::date - 14)
        ) AS shipping_exception,
      COALESCE(invoice.shipping_status, '') LIKE ANY (ARRAY['%簽收%', '%签收%']) AS shipping_delivered
    FROM deduped_invoices AS invoice
    LEFT JOIN customers_visible AS customer ON customer.id = invoice.customer_id
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
  ),
  revenue AS (
    SELECT
      COALESCE(sum(total) FILTER (WHERE status = 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end), 0) AS total_revenue,
      count(*) FILTER (WHERE status = 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end) AS paid_count,
      count(*) FILTER (WHERE COALESCE(status, '') <> 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end) AS unpaid_count,
      COALESCE(sum(total) FILTER (WHERE COALESCE(status, '') <> 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end), 0) AS unpaid_amount
    FROM orders CROSS JOIN clock
  ),
  all_products AS MATERIALIZED (
    SELECT product.* FROM public.products AS product
  ),
  visible_products AS MATERIALIZED (
    SELECT p.*
    FROM all_products AS p
    WHERE p.is_virtual IS NOT TRUE AND COALESCE(p.category, '') <> '_archived'
  ),
  own_stock AS (
    SELECT p.id, COALESCE(sum(s.qty), 0)::bigint AS stock
    FROM visible_products AS p
    LEFT JOIN public.inventory_stock AS s ON s.product_id = p.id
    GROUP BY p.id
  ),
  product_stock AS (
    SELECT p.id, p.name, p.parent_product_id, p.status, p.image_url,
           p.internal_code, p.code, p.shopify_sku,
           own.stock,
           CASE WHEN p.parent_product_id IS NULL THEN
             own.stock + COALESCE((
               SELECT sum(child_stock.stock)
               FROM visible_products AS child
               JOIN own_stock AS child_stock ON child_stock.id = child.id
               WHERE child.parent_product_id = p.id
             ), 0)
           ELSE own.stock END AS grouped_stock,
           EXISTS (SELECT 1 FROM visible_products AS child WHERE child.parent_product_id = p.id) AS has_children
    FROM visible_products AS p
    JOIN own_stock AS own ON own.id = p.id
  ),
  carriers AS (
    SELECT * FROM product_stock WHERE parent_product_id IS NOT NULL OR NOT has_children
  ),
  inventory_metrics AS (
    SELECT count(*) AS carrier_count,
           count(*) FILTER (WHERE stock > 0) AS active_sku_count,
           COALESCE(sum(stock), 0) AS total_quantity,
           count(*) FILTER (WHERE COALESCE(status, 'active') <> 'discontinued' AND stock < 50) AS low_stock_count
    FROM carriers
  ),
  company_members AS MATERIALIZED (
    SELECT employee.*, binding.role_id, binding.is_company_admin, binding.joined_at,
           role.name AS role_name
    FROM public.employee_companies AS binding
    JOIN public.employees AS employee ON employee.id = binding.employee_id
    LEFT JOIN public.roles AS role ON role.id = binding.role_id
    WHERE p_company_id IS NULL OR binding.company_id = p_company_id
  ),
  product_name_lookup AS MATERIALIZED (
    SELECT DISTINCT ON (normalized_name) id, warranty_months, normalized_name
    FROM (
      SELECT product.id,
             product.warranty_months,
             lower(regexp_replace(product.name, '\s+-\s+Default Title$', '', 'i')) AS normalized_name
      FROM all_products AS product
    ) AS names
    WHERE normalized_name <> ''
    ORDER BY normalized_name, id
  ),
  latest_renewals AS MATERIALIZED (
    SELECT DISTINCT ON (renewal.invoice_id, renewal.product_id)
      renewal.invoice_id,
      renewal.product_id,
      renewal.months,
      renewal.paid_at,
      renewal.previous_end,
      renewal.new_end
    FROM public.warranty_renewals AS renewal
    ORDER BY renewal.invoice_id, renewal.product_id, renewal.created_at DESC, renewal.id DESC
  ),
  warranty_resolved AS MATERIALIZED (
    SELECT
      invoice.id AS invoice_id,
      invoice.invoice_number,
      invoice.customer_id,
      invoice.date AS purchase_date,
      line.value AS item,
      line.position,
      COALESCE(product_by_id.id, product_by_name.id) AS resolved_product_id,
      COALESCE(
        NULLIF(line.value->>'warranty_months', '')::integer,
        product_by_id.warranty_months,
        product_by_name.warranty_months,
        0
      ) AS warranty_months
    FROM deduped_invoices AS invoice
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) WITH ORDINALITY AS line(value, position)
    LEFT JOIN all_products AS product_by_id
      ON product_by_id.id::text = COALESCE(line.value->>'product_id', '')
    LEFT JOIN product_name_lookup AS product_by_name
      ON product_by_name.normalized_name = lower(regexp_replace(COALESCE(line.value->>'name', ''), '\s+-\s+Default Title$', '', 'i'))
    WHERE COALESCE(line.value->>'name', '') <> ''
      AND COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費'
  ),
  warranty_effective AS MATERIALIZED (
    SELECT resolved.*,
           COALESCE(
             renewal.new_end,
             public.bizflow_add_months_clamped(resolved.purchase_date, resolved.warranty_months)
           ) AS expiry
    FROM warranty_resolved AS resolved
    LEFT JOIN latest_renewals AS renewal
      ON renewal.invoice_id = resolved.invoice_id
     AND renewal.product_id = resolved.resolved_product_id
    WHERE resolved.warranty_months > 0
  ),
  warranty AS MATERIALIZED (
    SELECT effective.invoice_id,
           CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8) ELSE '#' || effective.invoice_number::text END AS no,
           COALESCE(effective.item->>'name', '—') AS product,
           COALESCE(NULLIF(customer.name, ''), '—') AS customer,
           COALESCE(customer.phone, '') AS phone,
           effective.expiry
    FROM warranty_effective AS effective
    CROSS JOIN clock
    LEFT JOIN customers_visible AS customer ON customer.id = effective.customer_id
    WHERE effective.expiry >= clock.today - 30 AND effective.expiry <= clock.today + 365
  ),
  my_task_base AS (
    SELECT task.*,
           row_number() OVER (ORDER BY task.created_at DESC, task.id DESC) AS overall_rank,
           row_number() OVER (PARTITION BY task.status ORDER BY task.created_at DESC, task.id DESC) AS status_rank
    FROM public.employee_tasks AS task
    WHERE task.parent_task_id IS NULL
      AND (p_company_id IS NULL OR task.company_id = p_company_id)
      AND EXISTS (
        SELECT 1 FROM public.task_assignees AS assignee
        WHERE assignee.task_id = task.id AND assignee.employee_id = public.current_employee_id()
      )
  ),
  my_tasks AS (
    SELECT * FROM my_task_base WHERE overall_rank <= 4 OR status_rank <= 4
  ),
  recent_feed AS (
    SELECT task.*
    FROM public.employee_tasks AS task
    WHERE p_company_id IS NULL OR task.company_id = p_company_id
    ORDER BY task.created_at DESC, task.id DESC
    LIMIT 3
  ),
  monthly_lines AS (
    SELECT COALESCE(line.value->>'name', '') AS name,
           COALESCE(NULLIF(line.value->>'qty', '')::numeric, 1) AS quantity
    FROM deduped_invoices AS invoice
    CROSS JOIN clock
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(invoice.items)) AS line(value)
    WHERE invoice.date >= clock.month_start AND invoice.date < clock.month_end
      AND COALESCE(line.value->>'name', '') <> ''
      AND COALESCE(line.value->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
  ),
  chart_rows AS (
    SELECT name, sum(quantity) AS quantity
    FROM monthly_lines
    GROUP BY name
    ORDER BY sum(quantity) DESC, name ASC
    LIMIT 11
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'counts', jsonb_build_object(
      'orders', (SELECT count(*) FROM orders),
      'customers', public.bizflow_customer_group_count(),
      'members', (SELECT count(*) FROM company_members),
      'tasks', (SELECT count(*) FROM public.employee_tasks AS task WHERE p_company_id IS NULL OR task.company_id = p_company_id),
      'warranty', (SELECT count(*) FROM warranty)
    ),
    'revenue', (SELECT jsonb_build_object(
      'total_revenue', total_revenue,
      'paid_count', paid_count,
      'average', CASE WHEN paid_count > 0 THEN round(total_revenue / paid_count) ELSE 0 END,
      'unpaid_count', unpaid_count,
      'unpaid_amount', unpaid_amount
    ) FROM revenue),
    'shipping', jsonb_build_object(
      'all', (SELECT count(*) FROM orders),
      'pending', (SELECT count(*) FROM orders WHERE shipping_pending),
      'in_transit', (SELECT count(*) FROM orders WHERE shipping_in_transit),
      'exception', (SELECT count(*) FROM orders WHERE shipping_exception),
      'delivered', (SELECT count(*) FROM orders WHERE shipping_delivered)
    ),
    'inventory', (SELECT jsonb_build_object(
      'carrier_count', carrier_count,
      'active_sku_count', active_sku_count,
      'total_quantity', total_quantity,
      'low_stock_count', low_stock_count
    ) FROM inventory_metrics),
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', task.title,
        'due', COALESCE(to_char(task.due_date, 'YYYY/MM/DD'), ''),
        'count', (SELECT count(*) FROM public.employee_task_feedbacks AS feedback WHERE feedback.task_id = task.id),
        'assignee', COALESCE((
          SELECT string_agg(COALESCE(employee.name, '—'), '、' ORDER BY employee.name)
          FROM public.task_assignees AS assignee
          LEFT JOIN public.employees AS employee ON employee.id = assignee.employee_id
          WHERE assignee.task_id = task.id
        ), '—'),
        'status', CASE task.status WHEN 'done' THEN 'completed' WHEN 'abandoned' THEN 'abandoned' ELSE 'inProgress' END
      ) ORDER BY task.created_at DESC, task.id DESC)
      FROM my_tasks AS task
    ), '[]'::jsonb),
    'feed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', COALESCE(creator.name, '—'),
        'action', 'posted',
        'title', task.title,
        'date', to_char(task.created_at AT TIME ZONE 'Asia/Hong_Kong', 'MM/DD'),
        'time', to_char(task.created_at AT TIME ZONE 'Asia/Hong_Kong', 'HH24:MI'),
        'avatar', 'initial'
      ) ORDER BY task.created_at DESC, task.id DESC)
      FROM recent_feed AS task
      LEFT JOIN public.employees AS creator ON creator.id = COALESCE(task.creator_employee_id, task.employee_id)
    ), '[]'::jsonb),
    'chart', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', name, 'value', quantity) ORDER BY quantity DESC, name) FROM chart_rows), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'no', CASE WHEN row.invoice_number IS NULL THEN '#' || left(row.id::text, 8) ELSE '#' || row.invoice_number::text END,
        'product', COALESCE(row.first_item->>'name', '—'),
        'customer', row.customer_name,
        'phone', row.customer_phone,
        'date', to_char(row.order_date, 'YYYY/MM/DD'),
        'time', to_char(row.created_at AT TIME ZONE 'Asia/Hong_Kong', 'HH24:MI')
      ) ORDER BY row.created_at DESC, row.id DESC)
      FROM (SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 4) AS row
    ), '[]'::jsonb),
    'stock', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'count', row.grouped_stock::text,
        'image', COALESCE(row.image_url, ''),
        'itemsId', 'Items ID:' || COALESCE(NULLIF(row.internal_code, ''), NULLIF(row.code, ''), NULLIF(row.shopify_sku, ''), row.id::text),
        'product', row.name
      ) ORDER BY row.grouped_stock DESC, row.id)
      FROM (SELECT * FROM product_stock WHERE parent_product_id IS NULL ORDER BY grouped_stock DESC, id LIMIT 4) AS row
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', member.name,
        'dept', 'member',
        'departments', COALESCE((
          SELECT jsonb_agg(department.name ORDER BY department.name)
          FROM public.employee_departments AS membership
          JOIN public.departments AS department ON department.id = membership.department_id
          WHERE membership.employee_id = member.id AND (p_company_id IS NULL OR department.company_id = p_company_id)
        ), '[]'::jsonb),
        'role', COALESCE(member.role_name, ''),
        'openTasks', (
          SELECT count(*) FROM public.task_assignees AS assignee
          JOIN public.employee_tasks AS task ON task.id = assignee.task_id
          WHERE assignee.employee_id = member.id AND assignee.abandoned_at IS NULL
            AND task.status = 'open' AND (p_company_id IS NULL OR task.company_id = p_company_id)
        ),
        'joinedAt', to_char(member.created_at, 'YYYY/MM/DD'),
        'bizflowMainAccess', member.bizflow_main_access IS TRUE
      ) ORDER BY member.name)
      FROM (SELECT * FROM company_members ORDER BY name LIMIT 12) AS member
    ), '[]'::jsonb),
    'members_stats', jsonb_build_object(
      'all', (SELECT count(*) FROM company_members),
      'active', (SELECT count(*) FROM company_members WHERE active IS NOT FALSE),
      'pending_review', (SELECT count(*) FROM public.task_pending WHERE reviewed_at IS NULL),
      'left', (SELECT count(*) FROM company_members WHERE active IS FALSE)
    ),
    'warranty_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'no', row.no,
        'product', row.product,
        'customer', row.customer,
        'phone', row.phone,
        'date', to_char(row.expiry, 'YYYY/MM/DD')
      ) ORDER BY row.expiry, row.invoice_id)
      FROM (SELECT * FROM warranty ORDER BY expiry, invoice_id LIMIT 4) AS row
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.bizflow_home_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_home_dashboard(uuid) TO authenticated;

COMMENT ON FUNCTION public.bizflow_jsonb_array(jsonb) IS
  'Returns JSONB arrays unchanged and treats every other JSONB shape as an empty array.';

NOTIFY pgrst, 'reload schema';

COMMIT;
