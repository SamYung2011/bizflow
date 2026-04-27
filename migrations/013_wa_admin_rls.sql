-- 2026-04-27 WhatsApp tab 只讀帳戶權限：admin 才能改 wa_settings / wa_whitelist / wa_unresolved
-- 涉及 3 張 bizflow 會寫的表（其他表由 server.js / Edge Function 用 anon/service_role 寫，不影響）
-- bizflow 端額外做前端 disable，這層是後端 RLS 兜底（防有人繞前端直接 fetch supabase）

CREATE OR REPLACE FUNCTION is_wa_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT (auth.jwt()->>'email') IN (
    'samyung2011@gmail.com'
  );
$$;

GRANT EXECUTE ON FUNCTION is_wa_admin() TO authenticated, anon;

-- wa_settings：所有 authenticated 可讀，僅 admin 可寫
DROP POLICY IF EXISTS "authenticated_all" ON wa_settings;
DROP POLICY IF EXISTS "wa_settings_read" ON wa_settings;
DROP POLICY IF EXISTS "wa_settings_admin_write" ON wa_settings;
CREATE POLICY "wa_settings_read" ON wa_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "wa_settings_admin_write" ON wa_settings FOR ALL TO authenticated USING (is_wa_admin()) WITH CHECK (is_wa_admin());

-- wa_whitelist
DROP POLICY IF EXISTS "authenticated_all" ON wa_whitelist;
DROP POLICY IF EXISTS "wa_whitelist_read" ON wa_whitelist;
DROP POLICY IF EXISTS "wa_whitelist_admin_write" ON wa_whitelist;
CREATE POLICY "wa_whitelist_read" ON wa_whitelist FOR SELECT TO authenticated USING (true);
CREATE POLICY "wa_whitelist_admin_write" ON wa_whitelist FOR ALL TO authenticated USING (is_wa_admin()) WITH CHECK (is_wa_admin());

-- wa_unresolved（標記已解決也算寫）
DROP POLICY IF EXISTS "authenticated_all" ON wa_unresolved;
DROP POLICY IF EXISTS "wa_unresolved_read" ON wa_unresolved;
DROP POLICY IF EXISTS "wa_unresolved_admin_write" ON wa_unresolved;
CREATE POLICY "wa_unresolved_read" ON wa_unresolved FOR SELECT TO authenticated USING (true);
CREATE POLICY "wa_unresolved_admin_write" ON wa_unresolved FOR ALL TO authenticated USING (is_wa_admin()) WITH CHECK (is_wa_admin());
