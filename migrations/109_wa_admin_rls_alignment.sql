-- 109: align the WhatsApp RLS helper with the frontend WhatsApp-admin contract.
-- Safe to rerun. Existing wa_settings / wa_whitelist / wa_unresolved policies
-- keep calling public.is_wa_admin(); only the helper predicate is replaced.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_wa_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT lower(COALESCE(auth.jwt() ->> 'email', '')) IN (
    'samyung2011@gmail.com',
    'a1017339632@gmail.com',
    '1017339632@qq.com'
  )
  OR EXISTS (
    SELECT 1
    FROM public.employees AS e
    WHERE e.user_id = auth.uid()
      AND e.is_admin = true
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_wa_admin() TO authenticated, anon;

COMMIT;
