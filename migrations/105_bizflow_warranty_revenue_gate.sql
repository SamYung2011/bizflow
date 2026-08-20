-- 105: close the final warranty-name parity gap and gate revenue RPC output
-- Safe to rerun. This migration only replaces reviewed SECURITY INVOKER functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.bizflow_order_revenue(p_range text DEFAULT '12m')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH
  revenue_access AS MATERIALIZED (
    -- Keep the RPC aligned with the revenue-tab gate. The function stays
    -- SECURITY INVOKER, so this check and every invoice read retain RLS.
    SELECT EXISTS (
      SELECT 1
      FROM public.employees AS employee
      WHERE employee.user_id = auth.uid()
        AND (employee.is_admin = true OR employee.can_view_revenue = true)
    ) AS allowed
  ),
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
    FROM revenue_access AS access
    CROSS JOIN public.invoices AS invoice
    WHERE access.allowed
      AND invoice.items IS NOT NULL AND invoice.date IS NOT NULL
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
  customer_groups AS MATERIALIZED (
    SELECT * FROM public.bizflow_customer_group_map()
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
  warranty_trim_chars AS MATERIALIZED (
    -- Match String.prototype.trim() in the legacy warranty snapshot before
    -- comparing an item name with a product name.
    SELECT concat(
      chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760),
      chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197),
      chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232),
      chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)
    ) AS value
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
      customer_group.primary_id AS customer_id,
      customer_group.primary_name AS customer_name,
      customer_group.primary_phone AS customer_phone,
      invoice.order_date AS purchase_date,
      line.item,
      line.position,
      COALESCE(product_by_id.id, product_by_name.id) AS resolved_product_id,
      CASE
        -- JS Number(''), Number(null), and Number(false) are zero. Missing or
        -- non-numeric values use the one resolved product's month value.
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
           effective.position,
           CASE WHEN effective.invoice_number IS NULL THEN '#' || left(effective.invoice_id::text, 8)
                ELSE '#' || effective.invoice_number::text END AS no,
           COALESCE(effective.item->>'name', '—') AS product,
           COALESCE(NULLIF(effective.customer_name, ''), '—') AS customer,
           COALESCE(effective.customer_phone, '') AS phone,
           effective.expiry
    FROM warranty_effective AS effective
    CROSS JOIN clock
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
      'customers', (SELECT count(DISTINCT primary_id) FROM customer_groups),
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
      ) ORDER BY row.expiry, row.invoice_id, row.position)
      FROM (SELECT * FROM warranty ORDER BY expiry, invoice_id, position LIMIT 4) AS row
    ), '[]'::jsonb)
  )
  FROM shipping;
$function$;

REVOKE ALL ON FUNCTION public.bizflow_home_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_home_dashboard(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback (manual, outside this migration): reapply migration 103, then
-- migration 104, to restore the previous revenue and Home definitions.
