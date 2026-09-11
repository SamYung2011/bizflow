-- 121: one invoice and its RLS-visible relations in one read-only request.
BEGIN;
CREATE OR REPLACE FUNCTION public.bizflow_order_detail(p_invoice_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  WITH invoice AS MATERIALIZED (
    SELECT id, invoice_number, customer_id, salesperson_id, date, created_at,
      total, status, notes, carrier, tracking_number, shipping_status, shipped_at, delivered_at,
      COALESCE((SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(line.value) = 'object' THEN COALESCE((
          SELECT jsonb_object_agg(field.key, field.value)
          FROM jsonb_each(line.value) AS field
          WHERE field.key = ANY(ARRAY['id','name','qty','price','product_id','warehouse_id','warranty_months','imei_code'])
        ), '{}'::jsonb) ELSE line.value END ORDER BY line.position
      ) FROM jsonb_array_elements(public.bizflow_jsonb_array(source.items)) WITH ORDINALITY AS line(value, position)), '[]'::jsonb) AS items
    FROM public.invoices AS source WHERE source.id::text = p_invoice_id
  )
  SELECT jsonb_build_object(
    'invoice', to_jsonb(invoice),
    'customer', (SELECT to_jsonb(row) FROM (
      SELECT id, name, phone, email, address, car_make, car_model
      FROM public.customers WHERE id = invoice.customer_id
    ) AS row),
    'salesperson', (SELECT to_jsonb(row) FROM (
      SELECT id, name FROM public.employees WHERE id = invoice.salesperson_id
    ) AS row),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.event_at DESC) FROM (
      SELECT event_at, description FROM public.shipment_events
      WHERE invoice_id = invoice.id ORDER BY event_at DESC LIMIT 6
    ) AS row), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at DESC) FROM (
      SELECT id, imei, device_type, created_at FROM public.customer_devices
      WHERE customer_id = invoice.customer_id
    ) AS row), '[]'::jsonb)
  ) FROM invoice;
$function$;
REVOKE ALL ON FUNCTION public.bizflow_order_detail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_order_detail(text) TO authenticated;
COMMENT ON FUNCTION public.bizflow_order_detail(text) IS
  'RLS-scoped invoice detail, complete display item fields and customer devices, latest six shipment events; no edit options.';
NOTIFY pgrst, 'reload schema';
COMMIT;
