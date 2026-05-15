-- 051: 報銷模組（expense_reimbursements）
-- 場景：
--   · 員工提交報銷單（日期/金額/類別/說明/收據圖）→ status='pending'
--   · admin 看完整表 + 行內按鈕：通過 / 拒絕（帶理由）/ 標記已打款
--   · 員工只能看自己的，且只能改自己 pending 狀態的（已審批就鎖）
-- 類別：餐飲 / 交通 / 辦公 / 物料 / 通訊 / 其他
-- 收據圖走新 storage bucket `expense-receipts`（public read, authenticated upload）

BEGIN;

CREATE TABLE IF NOT EXISTS public.expense_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  expense_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'RMB' CHECK (currency IN ('RMB', 'HKD', 'USD')),
  category text NOT NULL,
  description text,
  receipt_urls text[] DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exp_reimb_employee_idx
  ON public.expense_reimbursements(employee_id);
CREATE INDEX IF NOT EXISTS exp_reimb_status_idx
  ON public.expense_reimbursements(status);
CREATE INDEX IF NOT EXISTS exp_reimb_date_idx
  ON public.expense_reimbursements(expense_date DESC);

-- updated_at 自動刷新
CREATE OR REPLACE FUNCTION public.touch_expense_reimb_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exp_reimb_updated_at ON public.expense_reimbursements;
CREATE TRIGGER trg_exp_reimb_updated_at
  BEFORE UPDATE ON public.expense_reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.touch_expense_reimb_updated_at();

ALTER TABLE public.expense_reimbursements ENABLE ROW LEVEL SECURITY;

-- SELECT：本人能看自己的，admin 全看
DROP POLICY IF EXISTS exp_reimb_select ON public.expense_reimbursements;
CREATE POLICY exp_reimb_select ON public.expense_reimbursements
  FOR SELECT TO authenticated
  USING (employee_id = current_employee_id() OR is_bf_admin());

-- INSERT：本人只能插自己的
DROP POLICY IF EXISTS exp_reimb_insert ON public.expense_reimbursements;
CREATE POLICY exp_reimb_insert ON public.expense_reimbursements
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = current_employee_id());

-- UPDATE：本人只能改自己 pending 狀態的（已審批就鎖）
DROP POLICY IF EXISTS exp_reimb_update_self ON public.expense_reimbursements;
CREATE POLICY exp_reimb_update_self ON public.expense_reimbursements
  FOR UPDATE TO authenticated
  USING (employee_id = current_employee_id() AND status = 'pending')
  WITH CHECK (employee_id = current_employee_id() AND status = 'pending');

-- DELETE：本人只能刪自己 pending 狀態的
DROP POLICY IF EXISTS exp_reimb_delete_self ON public.expense_reimbursements;
CREATE POLICY exp_reimb_delete_self ON public.expense_reimbursements
  FOR DELETE TO authenticated
  USING (employee_id = current_employee_id() AND status = 'pending');

-- admin 全權（審批 / 拒絕 / 標記打款 / 刪除）
DROP POLICY IF EXISTS exp_reimb_admin_all ON public.expense_reimbursements;
CREATE POLICY exp_reimb_admin_all ON public.expense_reimbursements
  FOR ALL TO authenticated
  USING (is_bf_admin())
  WITH CHECK (is_bf_admin());

-- Storage bucket：收據圖
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', true)
ON CONFLICT (id) DO NOTHING;

-- bucket policies（沿用 task-attachments 模式：public read + authenticated upload）
DROP POLICY IF EXISTS "expense_receipts_public_read" ON storage.objects;
CREATE POLICY "expense_receipts_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "expense_receipts_auth_upload" ON storage.objects;
CREATE POLICY "expense_receipts_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "expense_receipts_auth_update" ON storage.objects;
CREATE POLICY "expense_receipts_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'expense-receipts')
  WITH CHECK (bucket_id = 'expense-receipts');

DROP POLICY IF EXISTS "expense_receipts_auth_delete" ON storage.objects;
CREATE POLICY "expense_receipts_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts');

NOTIFY pgrst, 'reload schema';

COMMIT;
