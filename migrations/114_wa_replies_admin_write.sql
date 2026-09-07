-- 114: 拆 065:114-116 的 wa_replies_bizflow_main_access(FOR ALL) 为 读(全员) + 写(WhatsApp 管理员)。
-- anon 两条(012:93-96)不动；service_role 不受 RLS 影响。可重复执行。
BEGIN;

DROP POLICY IF EXISTS "wa_replies_bizflow_main_access" ON public.wa_replies;

DROP POLICY IF EXISTS "wa_replies_read" ON public.wa_replies;
CREATE POLICY "wa_replies_read" ON public.wa_replies
  FOR SELECT TO authenticated
  USING (public.has_bizflow_main_access());

DROP POLICY IF EXISTS "wa_replies_admin_insert" ON public.wa_replies;
CREATE POLICY "wa_replies_admin_insert" ON public.wa_replies
  FOR INSERT TO authenticated
  WITH CHECK (public.has_bizflow_main_access() AND public.is_wa_admin());

DROP POLICY IF EXISTS "wa_replies_admin_update" ON public.wa_replies;
CREATE POLICY "wa_replies_admin_update" ON public.wa_replies
  FOR UPDATE TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_wa_admin())
  WITH CHECK (public.has_bizflow_main_access() AND public.is_wa_admin());

DROP POLICY IF EXISTS "wa_replies_admin_delete" ON public.wa_replies;
CREATE POLICY "wa_replies_admin_delete" ON public.wa_replies
  FOR DELETE TO authenticated
  USING (public.has_bizflow_main_access() AND public.is_wa_admin());

COMMIT;

-- 回滚（不要执行，留档）：
-- DROP POLICY 上面四条；重建 065:115 原样：
-- CREATE POLICY "wa_replies_bizflow_main_access" ON public.wa_replies FOR ALL TO authenticated
--   USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());
