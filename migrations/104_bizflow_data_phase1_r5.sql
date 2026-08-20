-- 104: R5 production-shape repair for phase-one order paging and Home.
--
-- The invoice JSON can contain multi-kilobyte Shopify payloads.  Keep the
-- deduplication/sort/aggregate legs narrow, and only detoast/expand items when
-- a search needs them, for the 50 selected order rows, or once for the Home
-- item-derived widgets.  Everything remains SECURITY INVOKER so table RLS is
-- still evaluated for the authenticated caller.

BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_order_page(
  p_search text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_shipping text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_sort text DEFAULT 'newest',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
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
  base AS MATERIALIZED (
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
      COALESCE(NULLIF(customer.name, ''), '—') AS customer_name,
      COALESCE(customer.phone, '') AS customer_phone,
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
    CROSS JOIN needle
    LEFT JOIN public.customers AS customer ON customer.id = invoice.customer_id
    LEFT JOIN public.employees AS employee ON employee.id = invoice.salesperson_id
    LEFT JOIN LATERAL (
      SELECT string_agg(btrim(segment.value), ' | ' ORDER BY segment.position) AS notes
      FROM regexp_split_to_table(
        regexp_replace(COALESCE(invoice.notes, ''), '__[A-Z_]+__(?::[[:alnum:]_-]+)?[[:space:]]*', '', 'g'),
        E'[|\n]'
      ) WITH ORDINALITY AS segment(value, position)
      WHERE NULLIF(btrim(segment.value), '') IS NOT NULL
        AND btrim(segment.value) !~ '^(Framer 表單意向([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]+[0-9]{2}:[0-9]{2})?|Shopify order[[:space:]]+[^[:space:]]+|(financial|fulfillment)=[^[:space:]]*|batch=[^[:space:]]+([[:space:]]+idx=[^[:space:]]+)?([[:space:]]+raw_status=[^[:space:]]+)?)$'
    ) AS visible_notes ON needle.value IS NOT NULL
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
      AND (
        needle.value IS NULL
        OR lower(regexp_replace(concat_ws(' ',
          invoice.id::text,
          invoice.invoice_number::text,
          '#' || COALESCE(invoice.invoice_number::text, left(invoice.id::text, 8)),
          'DC' || CASE
            WHEN COALESCE(invoice.invoice_number::text, invoice.id::text) ~* '^DC'
              THEN substring(COALESCE(invoice.invoice_number::text, invoice.id::text) FROM 3)
            WHEN COALESCE(invoice.invoice_number::text, invoice.id::text) ~ '^\d+$'
              THEN lpad(COALESCE(invoice.invoice_number::text, invoice.id::text), 5, '0')
            ELSE COALESCE(invoice.invoice_number::text, invoice.id::text)
          END,
          customer.name,
          customer.phone,
          customer.phone_mainland,
          customer.email,
          customer.address,
          customer.car_make,
          customer.car_model,
          employee.name,
          visible_notes.notes,
          invoice.tracking_number,
          invoice.items::text
        ), '[[:space:]-]+', '', 'g')) LIKE '%' || replace(replace(replace(
          needle.value, E'\\', E'\\\\'
        ), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
      )
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
    SELECT row.id
    FROM filtered AS row
    ORDER BY
      CASE WHEN p_sort = 'oldest' THEN row.created_at END ASC,
      CASE WHEN p_sort = 'amount_desc' THEN row.total END DESC,
      CASE WHEN p_sort = 'amount_asc' THEN row.total END ASC,
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
    FROM page_keys AS page
    JOIN filtered AS row ON row.id = page.id
    JOIN public.invoices AS invoice ON invoice.id = page.id
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
        CASE WHEN p_sort = 'oldest' THEN created_at END ASC,
        CASE WHEN p_sort = 'amount_desc' THEN total END DESC,
        CASE WHEN p_sort = 'amount_asc' THEN total END ASC,
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

REVOKE ALL ON FUNCTION public.bizflow_order_page(text, text, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_order_page(text, text, text, date, date, text, integer, integer) TO authenticated;

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
  invoice_keys AS MATERIALIZED (
    SELECT DISTINCT ON (COALESCE(invoice.invoice_number::text, invoice.id::text))
      invoice.id
    FROM public.invoices AS invoice
    WHERE invoice.items IS NOT NULL AND invoice.date IS NOT NULL
    ORDER BY COALESCE(invoice.invoice_number::text, invoice.id::text), invoice.created_at ASC, invoice.id ASC
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
  ),
  invoice_lines AS MATERIALIZED (
    SELECT invoice.id AS invoice_id, line.value AS item, line.position
    FROM invoice_keys AS selected
    JOIN public.invoices AS invoice ON invoice.id = selected.id
    CROSS JOIN LATERAL jsonb_array_elements(public.bizflow_jsonb_array(invoice.items))
      WITH ORDINALITY AS line(value, position)
  ),
  revenue AS (
    SELECT
      COALESCE(sum(total) FILTER (WHERE status = 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end), 0) AS total_revenue,
      count(*) FILTER (WHERE status = 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end) AS paid_count,
      count(*) FILTER (WHERE COALESCE(status, '') <> 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end) AS unpaid_count,
      COALESCE(sum(total) FILTER (WHERE COALESCE(status, '') <> 'Paid' AND order_date >= clock.month_start AND order_date < clock.month_end), 0) AS unpaid_amount
    FROM orders CROSS JOIN clock
  ),
  shipping AS (
    SELECT count(*) AS all_count,
           count(*) FILTER (WHERE shipping_pending) AS pending_count,
           count(*) FILTER (WHERE shipping_in_transit) AS in_transit_count,
           count(*) FILTER (WHERE shipping_exception) AS exception_count,
           count(*) FILTER (WHERE shipping_delivered) AS delivered_count
    FROM orders
  ),
  all_products AS MATERIALIZED (
    SELECT product.* FROM public.products AS product
  ),
  visible_products AS MATERIALIZED (
    SELECT product.*
    FROM all_products AS product
    WHERE product.is_virtual IS NOT TRUE AND COALESCE(product.category, '') <> '_archived'
  ),
  own_stock AS (
    SELECT product.id, COALESCE(sum(stock.qty), 0)::bigint AS stock
    FROM visible_products AS product
    LEFT JOIN public.inventory_stock AS stock ON stock.product_id = product.id
    GROUP BY product.id
  ),
  product_stock AS (
    SELECT product.id, product.name, product.parent_product_id, product.status, product.image_url,
           product.internal_code, product.code, product.shopify_sku,
           own.stock,
           CASE WHEN product.parent_product_id IS NULL THEN
             own.stock + COALESCE((
               SELECT sum(child_stock.stock)
               FROM visible_products AS child
               JOIN own_stock AS child_stock ON child_stock.id = child.id
               WHERE child.parent_product_id = product.id
             ), 0)
           ELSE own.stock END AS grouped_stock,
           EXISTS (SELECT 1 FROM visible_products AS child WHERE child.parent_product_id = product.id) AS has_children
    FROM visible_products AS product
    JOIN own_stock AS own ON own.id = product.id
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
      invoice.order_date AS purchase_date,
      line.item,
      line.position,
      COALESCE(product_by_id.id, product_by_name.id) AS resolved_product_id,
      COALESCE(
        NULLIF(line.item->>'warranty_months', '')::integer,
        product_by_id.warranty_months,
        product_by_name.warranty_months,
        0
      ) AS warranty_months
    FROM orders AS invoice
    JOIN customers_visible AS known_customer ON known_customer.id = invoice.customer_id
    JOIN invoice_lines AS line ON line.invoice_id = invoice.id
    LEFT JOIN all_products AS product_by_id
      ON product_by_id.id::text = COALESCE(line.item->>'product_id', '')
    LEFT JOIN product_name_lookup AS product_by_name
      ON product_by_name.normalized_name = lower(regexp_replace(COALESCE(line.item->>'name', ''), '\s+-\s+Default Title$', '', 'i'))
    WHERE COALESCE(line.item->>'name', '') <> ''
      AND COALESCE(line.item->>'name', '') !~* '運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費'
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
           CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8)
                ELSE '#' || effective.invoice_number::text END AS no,
           COALESCE(effective.item->>'name', '—') AS product,
           COALESCE(NULLIF(customer.name, ''), '—') AS customer,
           COALESCE(customer.phone, '') AS phone,
           effective.expiry
    FROM warranty_effective AS effective
    CROSS JOIN clock
    JOIN customers_visible AS customer ON customer.id = effective.customer_id
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
    SELECT COALESCE(line.item->>'name', '') AS name,
           COALESCE(NULLIF(line.item->>'qty', '')::numeric, 1) AS quantity
    FROM orders AS invoice
    JOIN invoice_lines AS line ON line.invoice_id = invoice.id
    CROSS JOIN clock
    WHERE invoice.order_date >= clock.month_start AND invoice.order_date < clock.month_end
      AND COALESCE(line.item->>'name', '') <> ''
      AND COALESCE(line.item->>'name', '') !~* '運費|郵費|shipping|freight|押金|deposit|優惠|折扣|discount|手續費|service'
  ),
  chart_rows AS (
    SELECT name, sum(quantity) AS quantity
    FROM monthly_lines
    GROUP BY name
    ORDER BY sum(quantity) DESC, name ASC
    LIMIT 11
  ),
  recent_orders AS MATERIALIZED (
    SELECT invoice.*
    FROM orders AS invoice
    ORDER BY invoice.created_at DESC, invoice.id DESC
    LIMIT 4
  ),
  recent_order_rows AS (
    SELECT row.*,
           COALESCE(NULLIF(customer.name, ''), '—') AS customer_name,
           COALESCE(customer.phone, '') AS customer_phone,
           first_line.item AS first_item
    FROM recent_orders AS row
    LEFT JOIN customers_visible AS customer ON customer.id = row.customer_id
    JOIN public.invoices AS invoice ON invoice.id = row.id
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
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'counts', jsonb_build_object(
      'orders', shipping.all_count,
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
      'all', shipping.all_count,
      'pending', shipping.pending_count,
      'in_transit', shipping.in_transit_count,
      'exception', shipping.exception_count,
      'delivered', shipping.delivered_count
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
    'chart', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', name, 'value', quantity) ORDER BY quantity DESC, name)
      FROM chart_rows
    ), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'no', CASE WHEN row.invoice_number IS NULL THEN '#' || left(row.id::text, 8) ELSE '#' || row.invoice_number::text END,
        'product', COALESCE(row.first_item->>'name', '—'),
        'customer', row.customer_name,
        'phone', row.customer_phone,
        'date', to_char(row.order_date, 'YYYY/MM/DD'),
        'time', to_char(row.created_at AT TIME ZONE 'Asia/Hong_Kong', 'HH24:MI')
      ) ORDER BY row.created_at DESC, row.id DESC)
      FROM recent_order_rows AS row
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
  )
  FROM shipping;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_home_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_home_dashboard(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback (manual, outside this migration): reapply migration 103 to restore
-- the reviewed phase-one definitions.  Migration 103 remains intentionally in
-- the chain because it creates bizflow_jsonb_array() and guards every legacy
-- JSON expansion before these R5 replacements are installed.
