-- 100: E4/G-exp-8 fix — expense_reimbursements into the realtime publication.
-- Root cause: root-site/data/live-realtime.js never subscribed to this table
-- (client wiring in expense.js + live-snapshot-dependencies.js was already
-- correct), so cross-tab writes never reached other open "我的報銷" tabs.
-- See VERIFY-ROUND-B.md E4. Client-side fix lands alongside this file.
--
-- Events are still filtered per subscriber by the existing RLS policies
-- (migration 088: own row for the submitter, or can_admin_expenses() for
-- reviewers) — this migration only makes the table visible to the
-- replication stream, it does not change who can read which rows.
--
-- 待批准后应用；应用前 E4 在生产 realtime 上可能仍不触发（本迁移只写文件，未执行）。
-- 生产 ALTER 由维护者通过 psql 执行，风格同 099。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='expense_reimbursements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_reimbursements;
  END IF;
END $$;
