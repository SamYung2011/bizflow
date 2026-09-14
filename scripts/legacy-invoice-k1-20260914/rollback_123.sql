-- Operator-only inverse of migration 123. It refuses post-merge edits instead of overwriting them.
-- Backups remain for audit, with rolled_back_at set. A second rollback is a no-op.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SET LOCAL search_path = public, pg_temp;
DO $rollback$
DECLARE
  fk_tables constant text[] := ARRAY['inventory_movements','shipment_events','inventory','stock_deduction_audit','warranty_renewals'];
  b record; t text; r jsonb; current_row jsonb; columns_sql text; select_sql text;
  amount_before numeric; amount_after numeric; count_before int; count_after int;
  backup_count int; active_count int; changed int; restored int := 0;
  fk_restored jsonb := '{}'::jsonb; fk_before jsonb := '{}'::jsonb; current_rows jsonb; expected_rows jsonb;
BEGIN
  IF to_regclass('public.invoice_dedup_k1_20260914') IS NULL THEN
    RAISE EXCEPTION 'K1 rollback abort: backup table does not exist';
  END IF;
  LOCK TABLE public.invoices, public.inventory_movements, public.shipment_events,
    public.inventory, public.stock_deduction_audit, public.warranty_renewals,
    public.invoice_dedup_k1_20260914 IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*),count(*) FILTER(WHERE rolled_back_at IS NULL) INTO backup_count,active_count
  FROM public.invoice_dedup_k1_20260914;
  IF backup_count=989 AND active_count=0 THEN
    RAISE NOTICE 'K1_ROLLBACK_ALREADY_DONE changed=0';
    RETURN;
  END IF;
  IF backup_count<>989 OR active_count<>989 THEN
    RAISE EXCEPTION 'K1 rollback abort: expected 989 active backup pairs, got % / %',backup_count,active_count;
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='public.invoices'::regclass) <> 5 THEN
    RAISE EXCEPTION 'K1 rollback abort: inbound invoice FK schema changed';
  END IF;
  SELECT count(*),COALESCE(sum(total) FILTER(WHERE status='Paid'),0) INTO count_before,amount_before FROM public.invoices;
  FOREACH t IN ARRAY fk_tables LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),''[]''::jsonb) FROM public.%I x',t) INTO current_rows;
    fk_before := fk_before || jsonb_build_object(t,current_rows);
    fk_restored := fk_restored || jsonb_build_object(t,0);
  END LOOP;
  -- Exclude generated columns (bizflow_item_search_text); PostgreSQL recomputes them.
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum),string_agg(format('x.%I',attname),',' ORDER BY attnum)
    INTO columns_sql,select_sql FROM pg_attribute
    WHERE attrelid='public.invoices'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='';

  -- Check every row before the first restoration. Exact snapshots prevent clobbering subsequent edits.
  FOR b IN SELECT * FROM public.invoice_dedup_k1_20260914 ORDER BY old_id LOOP
    SELECT to_jsonb(i) INTO current_row FROM public.invoices i WHERE id=b.old_id;
    IF current_row IS DISTINCT FROM b.old_row_after OR EXISTS(SELECT 1 FROM public.invoices WHERE id=b.notion_id) THEN
      RAISE EXCEPTION 'K1 rollback abort: old invoice drift or Notion id already exists (invoice %)',b.old_invoice_number;
    END IF;
    FOREACH t IN ARRAY fk_tables LOOP
      IF jsonb_array_length(b.fk_rows_before->t) <> (b.fk_repoints->>t)::int THEN
        RAISE EXCEPTION 'K1 rollback abort: corrupt FK backup in %',t;
      END IF;
      FOR r IN SELECT value FROM jsonb_array_elements(b.fk_rows_before->t) LOOP
        EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id::text=$1',t) INTO current_row USING r->>'id';
        IF current_row IS DISTINCT FROM jsonb_set(r,'{invoice_id}',to_jsonb(b.old_id)) THEN
          RAISE EXCEPTION 'K1 rollback abort: repointed FK row drift in %',t;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOR b IN SELECT * FROM public.invoice_dedup_k1_20260914 ORDER BY old_id LOOP
    EXECUTE format('INSERT INTO public.invoices (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.invoices,$1) x',columns_sql,select_sql)
      USING b.notion_row;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'K1 rollback abort: Notion insert count=%',changed; END IF;
    SELECT to_jsonb(i) INTO current_row FROM public.invoices i WHERE id=b.notion_id;
    IF current_row IS DISTINCT FROM b.notion_row THEN RAISE EXCEPTION 'K1 rollback abort: Notion full row differs after restore'; END IF;

    FOREACH t IN ARRAY fk_tables LOOP
      FOR r IN SELECT value FROM jsonb_array_elements(b.fk_rows_before->t) LOOP
        EXECUTE format('UPDATE public.%I SET invoice_id=$1 WHERE id::text=$2 AND invoice_id=$3',t)
          USING b.notion_id,r->>'id',b.old_id;
        GET DIAGNOSTICS changed=ROW_COUNT;
        IF changed<>1 THEN RAISE EXCEPTION 'K1 rollback abort: FK restore count in % = %',t,changed; END IF;
        fk_restored := jsonb_set(fk_restored,ARRAY[t],to_jsonb((fk_restored->>t)::int+changed));
      END LOOP;
    END LOOP;
    -- Restore the exact original value, including NULL, empty text and all line breaks.
    UPDATE public.invoices SET customer_id=b.old_customer_id_before,notes=b.old_row_before->>'notes' WHERE id=b.old_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    SELECT to_jsonb(i) INTO current_row FROM public.invoices i WHERE id=b.old_id;
    IF changed<>1 OR current_row IS DISTINCT FROM b.old_row_before THEN
      RAISE EXCEPTION 'K1 rollback abort: retained old invoice restoration mismatch';
    END IF;
    restored := restored+1;
  END LOOP;

  FOREACH t IN ARRAY fk_tables LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),''[]''::jsonb) FROM public.%I x',t) INTO current_rows;
    SELECT COALESCE(jsonb_agg(COALESCE(saved.r,e) ORDER BY e->>'id'),'[]'::jsonb) INTO expected_rows
    FROM jsonb_array_elements(fk_before->t) e
    LEFT JOIN (SELECT value AS r FROM public.invoice_dedup_k1_20260914 backup CROSS JOIN LATERAL jsonb_array_elements(backup.fk_rows_before->t)) saved
      ON saved.r->>'id'=e->>'id';
    IF (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(current_rows) e)
       IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(expected_rows) e) THEN
      RAISE EXCEPTION 'K1 rollback abort: child table restoration mismatch in %',t;
    END IF;
  END LOOP;
  SELECT count(*),COALESCE(sum(total) FILTER(WHERE status='Paid'),0) INTO count_after,amount_after FROM public.invoices;
  IF restored<>989 OR count_after<>count_before+989 OR amount_after<>amount_before+6716667.00 THEN
    RAISE EXCEPTION 'K1 rollback abort: totals mismatch restored=% before=% after=% paid_before=% paid_after=%',
      restored,count_before,count_after,amount_before,amount_after;
  END IF;
  UPDATE public.invoice_dedup_k1_20260914 SET rolled_back_at=now() WHERE rolled_back_at IS NULL;
  RAISE NOTICE 'K1_ROLLBACK_SUCCESS restored=% invoices=% paid=% fk_restored=% backup_retained=989',restored,count_after,amount_after,fk_restored;
END;
$rollback$;
COMMIT;
