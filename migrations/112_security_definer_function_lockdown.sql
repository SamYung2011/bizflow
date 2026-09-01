BEGIN;

REVOKE ALL ON FUNCTION public.cleanup_inactive_employees()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_employees() TO postgres;

COMMIT;
