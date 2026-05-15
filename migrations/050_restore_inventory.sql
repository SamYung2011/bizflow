-- 050: REVERT migration 049 — 重建 inventory 表
-- Bug：049 看著 0 行 + grep `from('inventory')` 沒看到引用就刪了，但實際 bizflow 主端 App.jsx
-- 有 4 處用（用了 `from("inventory")` 雙引號，grep 漏）：
--   · L1303 qInventory useQuery
--   · L1879 update inventory 記錄
--   · L2213 / L2216 刪發票時按 invoice_id 查 + 恢復 inventory
-- 是「單品序列號 / 保修」那條業務線（每台機器一行，serial_no / warranty_end / extended）。
-- 雖然 0 行（煊煊沒走 sold 錄序列），代碼路徑在，PostgREST 找不到表會直接 500 整個 bizflow。
--
-- 教訓：grep 找引用要試多種寫法（單/雙引號 / from(/.from(），且看 useQuery 的 fetchAllTable 字符串參數。

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id),
  serial_no text,
  status text DEFAULT 'In Stock'::text,
  customer_id uuid REFERENCES public.customers(id),
  sold_date date,
  warranty_end date,
  extended boolean DEFAULT false,
  extended_end date,
  notes text,
  created_at timestamptz DEFAULT now(),
  invoice_id text REFERENCES public.invoices(id) ON DELETE SET NULL
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_all ON public.inventory;
CREATE POLICY authenticated_all ON public.inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
