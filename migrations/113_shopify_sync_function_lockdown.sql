BEGIN;

-- Apply only after confirming every live Shopify/Make caller uses service_role.
REVOKE ALL ON FUNCTION public.shopify_sync_order(
  text, text, text, text, text, text, timestamp with time zone, jsonb, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_sync_order(
  text, text, text, text, text, text, timestamp with time zone, jsonb, numeric, text
) TO service_role;

REVOKE ALL ON FUNCTION public.shopify_sync_order_api(
  text, text, text, timestamptz, jsonb, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_sync_order_api(
  text, text, text, timestamptz, jsonb, numeric, text
) TO service_role;

REVOKE ALL ON FUNCTION public.shopify_sync_order_core(
  text, text, text, text, text, text, text, text, text, timestamptz, jsonb, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_sync_order_core(
  text, text, text, text, text, text, text, text, text, timestamptz, jsonb, numeric, text
) TO service_role;

REVOKE ALL ON FUNCTION public.shopify_resolve_customer(
  text, text, text, text, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_resolve_customer(
  text, text, text, text, text, text, boolean
) TO service_role;

REVOKE ALL ON FUNCTION public.shopify_apply_variant_deductions(
  text, integer, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_apply_variant_deductions(
  text, integer, jsonb, text
) TO service_role;

COMMIT;
