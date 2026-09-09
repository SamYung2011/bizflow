-- 118: expense-receipts 桶改私有；读收据 = 谁能看这笔报销谁能读（本人目录 / 报销管理员）。
-- 写策略（088）不动。回滚见文件尾。
UPDATE storage.buckets SET public = false WHERE id = 'expense-receipts';

DROP POLICY IF EXISTS expense_receipts_public_read ON storage.objects;
DROP POLICY IF EXISTS expense_receipts_auth_read ON storage.objects;
CREATE POLICY expense_receipts_auth_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.has_bizflow_main_access()
    AND (
      (storage.foldername(name))[1] = public.current_employee_id()::text
      OR public.can_admin_expenses()
    )
  );

-- 回滚：
-- UPDATE storage.buckets SET public = true WHERE id = 'expense-receipts';
-- DROP POLICY IF EXISTS expense_receipts_auth_read ON storage.objects;
-- CREATE POLICY expense_receipts_public_read ON storage.objects
--   FOR SELECT TO public USING (bucket_id = 'expense-receipts');
