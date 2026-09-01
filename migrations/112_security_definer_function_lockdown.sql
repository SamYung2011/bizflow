BEGIN;

-- Shopify order sync is service-role only. All five functions are SECURITY
-- DEFINER and therefore must not inherit PostgreSQL's default PUBLIC EXECUTE.
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

-- Keep the 048 cleanup body byte-for-byte apart from the same super-admin
-- guard already used by permanent_delete_employee in that migration.
CREATE OR REPLACE FUNCTION public.cleanup_inactive_employees() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  victim_user_ids uuid[];
  victim_count integer;
BEGIN
  IF NOT public.is_bf_admin() THEN
    RAISE EXCEPTION 'Only super admin can permanently delete employees';
  END IF;

  -- 收集 auth user_id（之後一起刪 auth.users）
  SELECT array_agg(user_id) INTO victim_user_ids
  FROM public.employees
  WHERE active = false
    AND deactivated_at IS NOT NULL
    AND deactivated_at < now() - INTERVAL '6 days'
    AND user_id IS NOT NULL;

  -- 刪 employees（FK cascade 清 employee_companies / task_assignees / 部分 employee_tasks）
  WITH deleted AS (
    DELETE FROM public.employees
    WHERE active = false
      AND deactivated_at IS NOT NULL
      AND deactivated_at < now() - INTERVAL '6 days'
    RETURNING id
  )
  SELECT count(*) INTO victim_count FROM deleted;

  -- 連 auth user 一起刪
  IF victim_user_ids IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY(victim_user_ids);
  END IF;

  RETURN victim_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_inactive_employees()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_employees() TO postgres;

COMMIT;
