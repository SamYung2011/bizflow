-- 037_team_update_logs.sql
-- team.honnmono.top 子应用的「更新日志」板块用表
-- 跟 employee_update_logs 同 schema，但数据独立存
-- 写权限仅 Helen（per-user opt-in），其他人 SELECT + 评论
-- 配合 team.honnmono.top 子应用项目（2026-05-14 立项）

BEGIN;

-- ============================
-- 1. team_update_logs 主表
-- ============================
CREATE TABLE IF NOT EXISTS team_update_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary     text NOT NULL,                       -- 簡略（時間軸折疊狀態顯示）
  detail      text,                                -- 詳細（展開後顯示）
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_update_logs_created_idx
  ON team_update_logs(created_at DESC);

-- ============================
-- 2. team_update_log_comments 評論表
-- ============================
CREATE TABLE IF NOT EXISTS team_update_log_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_log_id     uuid NOT NULL REFERENCES team_update_logs(id) ON DELETE CASCADE,
  author_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name       text,
  body              text NOT NULL,
  parent_comment_id uuid REFERENCES team_update_log_comments(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_update_log_comments_log_idx
  ON team_update_log_comments(update_log_id, created_at);
CREATE INDEX IF NOT EXISTS team_update_log_comments_parent_idx
  ON team_update_log_comments(parent_comment_id);

-- ============================
-- 3. RLS for team_update_logs
-- ============================
ALTER TABLE team_update_logs ENABLE ROW LEVEL SECURITY;

-- 所有 authenticated 都能 SELECT（包括 task 用户）
CREATE POLICY team_log_select_all ON team_update_logs
  FOR SELECT TO authenticated USING (true);

-- 寫權限：只 Helen（per-user opt-in），通过 email 检查
-- 同时 admin 也能改（兜底维护用，理论上不会动）
CREATE POLICY team_log_helen_insert ON team_update_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.email() = 'a1017339632@gmail.com' OR is_bf_admin());

CREATE POLICY team_log_helen_update ON team_update_logs
  FOR UPDATE TO authenticated
  USING (auth.email() = 'a1017339632@gmail.com' OR is_bf_admin())
  WITH CHECK (auth.email() = 'a1017339632@gmail.com' OR is_bf_admin());

CREATE POLICY team_log_helen_delete ON team_update_logs
  FOR DELETE TO authenticated
  USING (auth.email() = 'a1017339632@gmail.com' OR is_bf_admin());

-- ============================
-- 4. RLS for team_update_log_comments
-- ============================
ALTER TABLE team_update_log_comments ENABLE ROW LEVEL SECURITY;

-- SELECT all
CREATE POLICY team_log_comment_select_all ON team_update_log_comments
  FOR SELECT TO authenticated USING (true);

-- INSERT：任何 authenticated 用户可评论（包括 task）
CREATE POLICY team_log_comment_insert ON team_update_log_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_user_id);

-- UPDATE：作者本人或 admin
CREATE POLICY team_log_comment_update ON team_update_log_comments
  FOR UPDATE TO authenticated
  USING (auth.uid() = author_user_id OR is_bf_admin())
  WITH CHECK (auth.uid() = author_user_id OR is_bf_admin());

-- DELETE：作者本人或 admin
CREATE POLICY team_log_comment_delete ON team_update_log_comments
  FOR DELETE TO authenticated
  USING (auth.uid() = author_user_id OR is_bf_admin());

COMMIT;

-- ============================
-- 5. 通知 PostgREST 刷 schema cache
-- ============================
NOTIFY pgrst, 'reload schema';
