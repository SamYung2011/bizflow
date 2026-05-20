-- 065_rls_bizflow_main_access.sql
-- bizflow 主站独有表 RLS 加白名单卡：只有 has_bizflow_main_access() = true 的 user 能读写
--
-- 范围：
--   ✓ 卡：bizflow 主端业务表（customers / invoices / products / inventory_* / shopify_* / wa_* 等）
--   ✗ 不动：team 子应用共用表（employees / companies / departments / roles / employee_* / task_* / team_*）
--
-- 对每张表统一做法：
--   DROP authenticated_all 类 policy，CREATE 新 policy USING (has_bizflow_main_access())
--   anon_* policy（WA server / Chrome 扩展用）保持不动
--   admin 通过 helper 内置 OR is_admin 自动兜底

-- ── customers / invoices / products / inventory ──────────────────────────
DROP POLICY IF EXISTS "authenticated_all" ON customers;
CREATE POLICY "customers_bizflow_main_access" ON customers FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON invoices;
CREATE POLICY "invoices_bizflow_main_access" ON invoices FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON products;
CREATE POLICY "products_bizflow_main_access" ON products FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON inventory;
CREATE POLICY "inventory_bizflow_main_access" ON inventory FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON inventory_stock;
CREATE POLICY "inventory_stock_bizflow_main_access" ON inventory_stock FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON inventory_movements;
CREATE POLICY "inventory_movements_bizflow_main_access" ON inventory_movements FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON warehouses;
CREATE POLICY "warehouses_bizflow_main_access" ON warehouses FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- ── line_item_aliases / suppliers / shipment_events ─────────────────────
DROP POLICY IF EXISTS "lia_authenticated_all" ON line_item_aliases;
CREATE POLICY "line_item_aliases_bizflow_main_access" ON line_item_aliases FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "suppliers_authenticated_all" ON suppliers;
CREATE POLICY "suppliers_bizflow_main_access" ON suppliers FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "shipment_events_authenticated_all" ON shipment_events;
CREATE POLICY "shipment_events_bizflow_main_access" ON shipment_events FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- ── shopify_* ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "shopify_settings_select" ON shopify_settings;
DROP POLICY IF EXISTS "shopify_settings_update" ON shopify_settings;
CREATE POLICY "shopify_settings_select" ON shopify_settings FOR SELECT TO authenticated
  USING (has_bizflow_main_access());
CREATE POLICY "shopify_settings_update" ON shopify_settings FOR UPDATE TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "shopify_variant_links_select" ON shopify_variant_links;
DROP POLICY IF EXISTS "shopify_variant_links_modify" ON shopify_variant_links;
CREATE POLICY "shopify_variant_links_select" ON shopify_variant_links FOR SELECT TO authenticated
  USING (has_bizflow_main_access());
CREATE POLICY "shopify_variant_links_modify" ON shopify_variant_links FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- ── expenses（报销）────────────────────────────────────────────────────────
-- 原本是员工自己提交、admin 审批。改成 bizflow 主站独有；非白名单员工以后想报销得换路径
DROP POLICY IF EXISTS "exp_reimb_admin_all" ON expense_reimbursements;
DROP POLICY IF EXISTS "exp_reimb_insert" ON expense_reimbursements;
DROP POLICY IF EXISTS "exp_reimb_select" ON expense_reimbursements;
DROP POLICY IF EXISTS "exp_reimb_delete_self" ON expense_reimbursements;
DROP POLICY IF EXISTS "exp_reimb_update_self" ON expense_reimbursements;
CREATE POLICY "expense_reimbursements_bizflow_main_access" ON expense_reimbursements FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- ── wa_* —— authenticated_all 改成 bizflow_main_access ────────────────────
-- anon_* policies（WA server / 扩展用）保持不动
DROP POLICY IF EXISTS "authenticated_all" ON wa_clients;
CREATE POLICY "wa_clients_bizflow_main_access" ON wa_clients FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_cooldowns;
CREATE POLICY "wa_cooldowns_bizflow_main_access" ON wa_cooldowns FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_daily_reports;
CREATE POLICY "wa_daily_reports_bizflow_main_access" ON wa_daily_reports FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_heartbeat;
CREATE POLICY "wa_heartbeat_bizflow_main_access" ON wa_heartbeat FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_logs;
CREATE POLICY "wa_logs_bizflow_main_access" ON wa_logs FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_messages;
CREATE POLICY "wa_messages_bizflow_main_access" ON wa_messages FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_pending_replies;
CREATE POLICY "wa_pending_replies_bizflow_main_access" ON wa_pending_replies FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_processed_messages;
CREATE POLICY "wa_processed_messages_bizflow_main_access" ON wa_processed_messages FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

DROP POLICY IF EXISTS "authenticated_all" ON wa_replies;
CREATE POLICY "wa_replies_bizflow_main_access" ON wa_replies FOR ALL TO authenticated
  USING (has_bizflow_main_access()) WITH CHECK (has_bizflow_main_access());

-- wa_settings / wa_whitelist / wa_unresolved 已经有自定义 policies（admin_write + read）
-- 但 wa_settings_read / wa_whitelist_read / wa_unresolved_read 给 authenticated 全开 → 改成卡
DROP POLICY IF EXISTS "wa_settings_read" ON wa_settings;
CREATE POLICY "wa_settings_read" ON wa_settings FOR SELECT TO authenticated
  USING (has_bizflow_main_access());

DROP POLICY IF EXISTS "wa_whitelist_read" ON wa_whitelist;
CREATE POLICY "wa_whitelist_read" ON wa_whitelist FOR SELECT TO authenticated
  USING (has_bizflow_main_access());

DROP POLICY IF EXISTS "wa_unresolved_read" ON wa_unresolved;
CREATE POLICY "wa_unresolved_read" ON wa_unresolved FOR SELECT TO authenticated
  USING (has_bizflow_main_access());

-- 重新加载 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
