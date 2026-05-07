-- migration 020: 員工更新日誌（員工自己寫長期工作日誌，使用者/同事可評論）
-- 兩張表：employee_update_logs（時間軸條目）+ employee_update_log_comments（評論）
-- 部署：在自托管 Supabase SQL Editor 整段跑

BEGIN;

-- ============================
-- 1. employee_update_logs 主表
-- ============================
CREATE TABLE IF NOT EXISTS employee_update_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  summary     text NOT NULL,                       -- 簡略（時間軸折疊狀態顯示）
  detail      text,                                -- 詳細（展開後顯示，AI 寫，可空）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_update_logs_employee_idx
  ON employee_update_logs(employee_id, created_at DESC);

-- ============================
-- 2. employee_update_log_comments 評論表
-- ============================
CREATE TABLE IF NOT EXISTS employee_update_log_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_log_id     uuid NOT NULL REFERENCES employee_update_logs(id) ON DELETE CASCADE,
  author_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name       text,                          -- 冗余存名字（auth user 删了仍能显示）
  body              text NOT NULL,
  parent_comment_id uuid REFERENCES employee_update_log_comments(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_update_log_comments_log_idx
  ON employee_update_log_comments(update_log_id, created_at);
CREATE INDEX IF NOT EXISTS employee_update_log_comments_parent_idx
  ON employee_update_log_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS employee_update_log_comments_author_idx
  ON employee_update_log_comments(author_user_id);

-- ============================
-- 3. RLS for employee_update_logs
-- ============================
ALTER TABLE employee_update_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upd_log_select_all   ON employee_update_logs;
DROP POLICY IF EXISTS upd_log_admin_all    ON employee_update_logs;
DROP POLICY IF EXISTS upd_log_admin_modify ON employee_update_logs;
DROP POLICY IF EXISTS upd_log_admin_delete ON employee_update_logs;
DROP POLICY IF EXISTS upd_log_emp_own      ON employee_update_logs;

-- 所有 authenticated 都能 SELECT
CREATE POLICY upd_log_select_all ON employee_update_logs FOR SELECT TO authenticated USING (true);

-- INSERT 嚴格限制：只有本人才能新增自己的更新（admin 也不能替別人寫）
-- admin 想寫只能寫自己頁面下的（emp_own policy 自然命中）
-- UPDATE / DELETE：admin 可改可刪任何人
CREATE POLICY upd_log_admin_modify ON employee_update_logs FOR UPDATE TO authenticated
  USING (is_bf_admin()) WITH CHECK (is_bf_admin());
CREATE POLICY upd_log_admin_delete ON employee_update_logs FOR DELETE TO authenticated
  USING (is_bf_admin());

-- 員工對自己 employee_id 的日誌全權（包括 INSERT）
CREATE POLICY upd_log_emp_own ON employee_update_logs FOR ALL TO authenticated
  USING (employee_id = current_employee_id())
  WITH CHECK (employee_id = current_employee_id());

-- ============================
-- 4. RLS for employee_update_log_comments
-- ============================
ALTER TABLE employee_update_log_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upd_log_cmt_select_all    ON employee_update_log_comments;
DROP POLICY IF EXISTS upd_log_cmt_admin_all     ON employee_update_log_comments;
DROP POLICY IF EXISTS upd_log_cmt_author_insert ON employee_update_log_comments;
DROP POLICY IF EXISTS upd_log_cmt_author_modify ON employee_update_log_comments;
DROP POLICY IF EXISTS upd_log_cmt_author_delete ON employee_update_log_comments;

-- 所有 authenticated SELECT
CREATE POLICY upd_log_cmt_select_all ON employee_update_log_comments FOR SELECT TO authenticated USING (true);

-- admin 全權
CREATE POLICY upd_log_cmt_admin_all ON employee_update_log_comments FOR ALL TO authenticated
  USING (is_bf_admin()) WITH CHECK (is_bf_admin());

-- 任意登入用戶可發表評論（author_user_id = auth.uid()）
CREATE POLICY upd_log_cmt_author_insert ON employee_update_log_comments FOR INSERT TO authenticated
  WITH CHECK (author_user_id = auth.uid());

-- 作者能改自己的評論
CREATE POLICY upd_log_cmt_author_modify ON employee_update_log_comments FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());

-- 作者能刪自己的評論
CREATE POLICY upd_log_cmt_author_delete ON employee_update_log_comments FOR DELETE TO authenticated
  USING (author_user_id = auth.uid());

COMMIT;

-- 驗收 SQL（migration 跑完手動跑）：
-- SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('employee_update_logs', 'employee_update_log_comments') ORDER BY table_name, ordinal_position;
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid IN ('employee_update_logs'::regclass, 'employee_update_log_comments'::regclass);
