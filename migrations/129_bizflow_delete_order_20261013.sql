-- 訂單詳情原本不能刪單；舊版分步返還庫存，遇到續保外鍵時會留下半完成的操作。
-- 主站使用者可刪單：鎖住訂單，一個事務返還 sale 庫存、留 sale_reverse、還原 IMEI，清續保後刪單。
-- 回滾定義：DROP FUNCTION IF EXISTS public.bizflow_delete_order(uuid);
BEGIN;
CREATE OR REPLACE FUNCTION public.bizflow_delete_order(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_return record;
BEGIN
  IF public.has_bizflow_main_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Bizflow main access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id::text FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_return IN
    SELECT product_id, warehouse_id, SUM(-delta)::integer AS qty
    FROM public.inventory_movements
    WHERE invoice_id = v_invoice.id AND type = 'sale' AND delta < 0
      AND product_id IS NOT NULL AND warehouse_id IS NOT NULL
    GROUP BY product_id, warehouse_id ORDER BY product_id, warehouse_id
  LOOP
    INSERT INTO public.inventory_stock(product_id, warehouse_id, qty, updated_at)
    VALUES(v_return.product_id, v_return.warehouse_id, v_return.qty, now())
    ON CONFLICT(product_id, warehouse_id) DO UPDATE
      SET qty = inventory_stock.qty + EXCLUDED.qty, updated_at = now();
    INSERT INTO public.inventory_movements(product_id, warehouse_id, delta, type, reason, invoice_id)
    VALUES(v_return.product_id, v_return.warehouse_id, v_return.qty, 'sale_reverse',
      'Order ' || COALESCE(v_invoice.invoice_number::text, v_invoice.id) || ' deletion return', v_invoice.id);
  END LOOP;
  UPDATE public.inventory SET status = 'In Stock', customer_id = NULL, sold_date = NULL,
    warranty_end = NULL, invoice_id = NULL WHERE invoice_id = v_invoice.id;
  DELETE FROM public.warranty_renewals WHERE invoice_id = v_invoice.id;
  DELETE FROM public.invoices WHERE id = v_invoice.id;
END;
$$;
REVOKE ALL ON FUNCTION public.bizflow_delete_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_delete_order(uuid) TO authenticated;
COMMIT;
