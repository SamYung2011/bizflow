-- 040: 允許 authenticated 用戶為自己 INSERT task_pending
-- 之前只 anon_insert 一條，但 supabase.auth.signUp() 成功後 session 立即建立，
-- 客戶端身份變 authenticated → 接下來的 task_pending.insert 被 RLS 挡掉 → 註冊半截死掉
-- （auth user 創建了，task_pending 沒寫進去，登入後「找不到註冊申請」）。
-- 修：加 authenticated INSERT policy，要求 user_id = auth.uid()。

CREATE POLICY task_pending_self_insert ON public.task_pending
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
