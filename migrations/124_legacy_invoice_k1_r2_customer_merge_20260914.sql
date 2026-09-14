-- 124: Pair min(a,b) only within the 370 unequal K1 groups approved for R2.
-- Production execution belongs to the operator. dryrun.sh replaces COMMIT with ROLLBACK.
-- Source-marker inheritance does not make a retained old invoice a remaining original N.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SET LOCAL search_path = public, pg_temp;

CREATE TABLE IF NOT EXISTS public.invoice_dedup_k1r2_20260914 (
  old_id text PRIMARY KEY,
  old_invoice_number int NOT NULL,
  notion_id text NOT NULL UNIQUE,
  group_date date NOT NULL,
  group_total numeric NOT NULL,
  group_fingerprint text NOT NULL,
  pair_rank int NOT NULL,
  group_size int NOT NULL, -- number of pairs = least(old_count_a, notion_count_b)
  old_count_a int NOT NULL,
  notion_count_b int NOT NULL,
  old_customer_id_before uuid,
  notion_row jsonb NOT NULL,
  fk_repoints jsonb NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  batch text NOT NULL DEFAULT 'k1r2-20260914' CHECK (batch = 'k1r2-20260914'),
  -- Counts alone cannot restore individual foreign keys or original notes exactly.
  fk_rows_before jsonb NOT NULL,
  old_row_before jsonb NOT NULL,
  old_row_after jsonb NOT NULL,
  marker_line text NOT NULL,
  run_stats jsonb NOT NULL,
  rolled_back_at timestamptz
);
ALTER TABLE public.invoice_dedup_k1r2_20260914 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_dedup_k1r2_20260914 FROM PUBLIC, anon, authenticated, service_role;

DO $merge$
DECLARE
  fk_tables constant text[] := ARRAY['inventory_movements','shipment_events','inventory','stock_deduction_audit','warranty_renewals'];
  p record; t text; pair_data jsonb; old_row jsonb; n_row jsonb; expected_old jsonb;
  fk_rows jsonb; fk_counts jsonb; child_rows jsonb; current_rows jsonb;
  marker text; next_notes text; before_stats jsonb; after_stats jsonb;
  r1_backup_before jsonb; year_counts jsonb; extra_old int; extra_n int;
  untouched_before jsonb; fk_before jsonb := '{}'::jsonb;
  amount_total numeric; group_count int; pair_count int; changed int; actual_count int;
  backup_count int; original_n_count int; inherited_count int; new_backup int := 0;
BEGIN
  -- Block concurrent invoice/FK writers while allowing ordinary SELECTs.
  LOCK TABLE public.invoices, public.inventory_movements, public.shipment_events,
    public.inventory, public.stock_deduction_audit, public.warranty_renewals,
    public.invoice_dedup_k1r2_20260914 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.invoice_dedup_k1_20260914 IN SHARE MODE;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY old_id) INTO r1_backup_before FROM public.invoice_dedup_k1_20260914 b;
  IF jsonb_array_length(r1_backup_before) IS DISTINCT FROM 989
     OR EXISTS(SELECT 1 FROM public.invoice_dedup_k1_20260914 WHERE rolled_back_at IS NOT NULL) THEN
    RAISE EXCEPTION 'K1R2 abort: R1 must have 989 active backups';
  END IF;

  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='public.invoices'::regclass) <> 5
     OR EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.contype='f' AND c.confrelid='public.invoices'::regclass
       AND (c.conrelid <> ALL (ARRAY['public.inventory_movements'::regclass,'public.shipment_events'::regclass,
              'public.inventory'::regclass,'public.stock_deduction_audit'::regclass,'public.warranty_renewals'::regclass])
         OR c.conkey <> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='invoice_id')]::smallint[])
     ) THEN
    RAISE EXCEPTION 'K1R2 abort: inbound invoice FK schema differs from the five reviewed tables';
  END IF;

  SELECT count(*) INTO backup_count FROM public.invoice_dedup_k1r2_20260914;
  IF backup_count > 0 THEN
    IF backup_count <> 737 OR EXISTS (
      SELECT 1 FROM public.invoice_dedup_k1r2_20260914 b
      LEFT JOIN public.invoices o ON o.id=b.old_id LEFT JOIN public.invoices n ON n.id=b.notion_id
      WHERE b.rolled_back_at IS NOT NULL OR n.id IS NOT NULL OR o.id IS NULL
         OR to_jsonb(o) IS DISTINCT FROM b.old_row_after
    ) THEN
      RAISE EXCEPTION 'K1R2 abort: existing backup is partial, rolled back, or live rows have drifted (backup=%)', backup_count;
    END IF;
    RAISE NOTICE 'K1R2_ALREADY_APPLIED backup=737 changed=0';
    RETURN;
  END IF;

  SELECT jsonb_build_object('invoices',count(*),'unowned',count(*) FILTER (WHERE customer_id IS NULL),
    'notion',count(*) FILTER (WHERE notes LIKE '__NOTION_IMPORT__%' AND customer_id IS NOT NULL AND invoice_number IS NULL
       AND NOT EXISTS(SELECT 1 FROM public.invoice_dedup_k1_20260914 b WHERE b.old_id=i.id)),
    'paid',COALESCE(sum(total) FILTER (WHERE status='Paid'),0))
  INTO before_stats FROM public.invoices i;
  RAISE NOTICE 'K1R2_BEFORE %',before_stats;
  IF (before_stats->>'invoices')::int <> 5760 OR (before_stats->>'unowned')::int <> 2792
     OR (before_stats->>'notion')::int <> 854 OR (before_stats->>'paid')::numeric <> 39184617.417 THEN
    RAISE EXCEPTION 'K1R2 abort: cohort drift before mutation: %', before_stats;
  END IF;

  -- Full JSONB keys, exactly as in the read-only audit; MD5 is not used to match.
  WITH normalized AS MATERIALIZED (
    SELECT i.*, CASE WHEN customer_id IS NULL THEN 'L' ELSE 'N' END AS side,
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(name,qty,price) ORDER BY name COLLATE "C",qty,price),'[]'::jsonb)
       FROM (SELECT lower(btrim(COALESCE(e->>'name',''))) AS name,
                    trim_scale(COALESCE(NULLIF(btrim(e->>'qty'),'')::numeric,1)) AS qty,
                    trim_scale(COALESCE(NULLIF(btrim(e->>'price'),'')::numeric,0)) AS price
             FROM jsonb_array_elements(i.items) e) lines) AS fingerprint
    FROM public.invoices i
    WHERE customer_id IS NULL OR (notes LIKE '__NOTION_IMPORT__%' AND customer_id IS NOT NULL
      AND invoice_number IS NULL AND NOT EXISTS(SELECT 1 FROM public.invoice_dedup_k1_20260914 b WHERE b.old_id=i.id))
  ), keyed AS MATERIALIZED (
    SELECT n.*,jsonb_build_array(date,total,fingerprint) AS k1 FROM normalized n
  ), unequal AS MATERIALIZED (
    SELECT k1,count(*) FILTER(WHERE side='L')::int AS old_count_a,
      count(*) FILTER(WHERE side='N')::int AS notion_count_b,
      least(count(*) FILTER(WHERE side='L'),count(*) FILTER(WHERE side='N'))::int AS group_size
    FROM keyed GROUP BY k1
    HAVING count(*) FILTER(WHERE side='L')>0
       AND count(*) FILTER(WHERE side='N')>0
       AND count(*) FILTER(WHERE side='L')<>count(*) FILTER(WHERE side='N')
  ), old_ranked AS (
    SELECT k.*,b.group_size,b.old_count_a,b.notion_count_b,row_number() OVER(PARTITION BY k.k1 ORDER BY invoice_number ASC,id ASC)::int AS pair_rank
    FROM keyed k JOIN unequal b USING(k1) WHERE side='L'
  ), n_ranked AS (
    SELECT k.*,substring(notes FROM 'idx=([0-9]+)')::bigint AS notion_idx,
      row_number() OVER(PARTITION BY k.k1 ORDER BY substring(notes FROM 'idx=([0-9]+)')::bigint ASC,id ASC)::int AS pair_rank
    FROM keyed k JOIN unequal b USING(k1) WHERE side='N'
  )
  SELECT jsonb_agg(jsonb_build_object('old_id',o.id,'notion_id',n.id,'invoice_number',o.invoice_number,
    'date',o.date,'total',o.total,'fingerprint',o.fingerprint::text,'pair_rank',o.pair_rank,
    'group_size',o.group_size,'old_count_a',o.old_count_a,'notion_count_b',o.notion_count_b,'notion_idx',n.notion_idx) ORDER BY o.date,o.invoice_number,o.id),
    count(*),count(DISTINCT o.k1),sum(o.total),
    (SELECT sum(old_count_a-group_size) FROM unequal),(SELECT sum(notion_count_b-group_size) FROM unequal)
  INTO pair_data,pair_count,group_count,amount_total,extra_old,extra_n
  FROM old_ranked o JOIN n_ranked n ON n.k1=o.k1 AND n.pair_rank=o.pair_rank;

  SELECT jsonb_object_agg(year,n) INTO year_counts FROM (
    SELECT substring(e->>'date',1,4) AS year,count(*) AS n FROM jsonb_array_elements(pair_data) e GROUP BY 1
  ) per_year;
  RAISE NOTICE 'K1R2_REMAINDERS old=% notion=% yearly=%',extra_old,extra_n,year_counts;
  RAISE NOTICE 'K1R2_PREFLIGHT groups=% old=% notion=% amount=% before=%',
    group_count,pair_count,(SELECT count(DISTINCT e->>'notion_id') FROM jsonb_array_elements(pair_data) e),amount_total,before_stats;
  IF group_count IS DISTINCT FROM 370 OR pair_count IS DISTINCT FROM 737 OR amount_total IS DISTINCT FROM 5278736.20
     OR (SELECT count(DISTINCT e->>'notion_id') FROM jsonb_array_elements(pair_data) e) <> 737
     OR (SELECT count(DISTINCT e->>'old_id') FROM jsonb_array_elements(pair_data) e) <> 737
     OR extra_old IS DISTINCT FROM 745 OR extra_n IS DISTINCT FROM 16
     OR year_counts IS DISTINCT FROM '{"2023":104,"2024":466,"2025":146,"2026":21}'::jsonb
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(pair_data) e WHERE e->>'invoice_number' IS NULL OR e->>'notion_idx' IS NULL) THEN
    RAISE EXCEPTION 'K1R2 abort: expected 370 groups / 737 old / 737 Notion / 5278736.20  / extra old 745 / extra N 16 / yearly 104,466,146,21 and valid sort keys';
  END IF;

  -- Preserve every unrelated invoice and every non-repointed child row exactly.
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO untouched_before FROM public.invoices i
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pair_data) e WHERE i.id IN (e->>'old_id',e->>'notion_id'));
  FOREACH t IN ARRAY fk_tables LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),''[]''::jsonb) FROM public.%I x',t) INTO current_rows;
    fk_before := fk_before || jsonb_build_object(t,current_rows);
  END LOOP;

  FOR p IN SELECT * FROM jsonb_to_recordset(pair_data) AS x(old_id text,notion_id text,invoice_number int,
      date date,total numeric,fingerprint text,pair_rank int,group_size int,old_count_a int,notion_count_b int,notion_idx bigint)
  LOOP
    SELECT to_jsonb(i) INTO STRICT old_row FROM public.invoices i WHERE id=p.old_id;
    SELECT to_jsonb(i) INTO STRICT n_row FROM public.invoices i WHERE id=p.notion_id;
    marker := substring(n_row->>'notes' FROM '^(__NOTION_IMPORT__[^\r\n]*)');
    IF marker IS NULL OR marker !~ '^__NOTION_IMPORT__ batch=\S+ idx=[0-9]+ raw_status=\S+$'
       OR old_row->>'customer_id' IS NOT NULL OR n_row->>'customer_id' IS NULL
       OR n_row->>'invoice_number' IS NOT NULL
       OR old_row->>'status' IS DISTINCT FROM 'Paid' OR n_row->>'status' IS DISTINCT FROM 'Paid' THEN
      RAISE EXCEPTION 'K1R2 abort: pair fields/marker drift at old invoice %',p.invoice_number;
    END IF;
    next_notes := CASE WHEN COALESCE(old_row->>'notes','')='' THEN marker ELSE (old_row->>'notes') || E'\n' || marker END;
    expected_old := jsonb_set(jsonb_set(old_row,'{customer_id}',n_row->'customer_id'),'{notes}',to_jsonb(next_notes));
    fk_rows := '{}'::jsonb; fk_counts := '{}'::jsonb;
    FOREACH t IN ARRAY fk_tables LOOP
      EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),''[]''::jsonb) FROM public.%I x WHERE invoice_id=$1',t)
        INTO child_rows USING p.notion_id;
      fk_rows := fk_rows || jsonb_build_object(t,child_rows);
      fk_counts := fk_counts || jsonb_build_object(t,jsonb_array_length(child_rows));
    END LOOP;

    INSERT INTO public.invoice_dedup_k1r2_20260914(old_id,old_invoice_number,notion_id,group_date,group_total,
      group_fingerprint,pair_rank,group_size,old_count_a,notion_count_b,old_customer_id_before,notion_row,fk_repoints,
      fk_rows_before,old_row_before,old_row_after,marker_line,run_stats)
    VALUES(p.old_id,p.invoice_number,p.notion_id,p.date,p.total,p.fingerprint,p.pair_rank,p.group_size,p.old_count_a,p.notion_count_b,
      (old_row->>'customer_id')::uuid,n_row,fk_counts,fk_rows,old_row,expected_old,marker,before_stats);
    new_backup := new_backup+1;

    FOREACH t IN ARRAY fk_tables LOOP
      EXECUTE format('UPDATE public.%I SET invoice_id=$1 WHERE invoice_id=$2',t) USING p.old_id,p.notion_id;
      GET DIAGNOSTICS changed=ROW_COUNT;
      IF changed <> (fk_counts->>t)::int THEN RAISE EXCEPTION 'K1R2 abort: FK repoint mismatch in %',t; END IF;
    END LOOP;
    UPDATE public.invoices SET customer_id=(n_row->>'customer_id')::uuid WHERE id=p.old_id AND customer_id IS NULL;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'K1R2 abort: customer update count=%',changed; END IF;
    UPDATE public.invoices SET notes=next_notes WHERE id=p.old_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed <> 1 OR (SELECT to_jsonb(i) FROM public.invoices i WHERE id=p.old_id) IS DISTINCT FROM expected_old THEN
      RAISE EXCEPTION 'K1R2 abort: old invoice changed outside customer_id/notes';
    END IF;
    DELETE FROM public.invoices WHERE id=p.notion_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'K1R2 abort: delete count=%',changed; END IF;
  END LOOP;

  SELECT count(*) INTO original_n_count FROM public.invoices i
  WHERE notes LIKE '__NOTION_IMPORT__%' AND customer_id IS NOT NULL AND invoice_number IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.invoice_dedup_k1_20260914 b WHERE b.old_id=i.id)
    AND NOT EXISTS(SELECT 1 FROM public.invoice_dedup_k1r2_20260914 b WHERE b.old_id=i.id);
  SELECT count(*) INTO inherited_count FROM public.invoices i JOIN public.invoice_dedup_k1r2_20260914 b ON b.old_id=i.id
  WHERE to_jsonb(i)=b.old_row_after AND position(b.marker_line IN i.notes)>0;
  SELECT jsonb_build_object('invoices',count(*),'unowned',count(*) FILTER(WHERE customer_id IS NULL),
    'original_notion',original_n_count,'inherited_marker',inherited_count,
    'raw_prefix_count',count(*) FILTER(WHERE notes LIKE '__NOTION_IMPORT__%' AND customer_id IS NOT NULL),
    'paid',COALESCE(sum(total) FILTER(WHERE status='Paid'),0),'backup_added',new_backup,
    'unmatched_old',extra_old,'unmatched_notion',extra_n,'yearly_pairs',year_counts)
  INTO after_stats FROM public.invoices;
  RAISE NOTICE 'K1R2_POSTCHECK %',after_stats;
  IF (after_stats->>'invoices')::int <> (before_stats->>'invoices')::int-737
     OR (after_stats->>'invoices')::int <> 5023
     OR (after_stats->>'unowned')::int <> 2055 OR original_n_count <> 117 OR inherited_count <> 737
     OR (after_stats->>'paid')::numeric <> (before_stats->>'paid')::numeric-5278736.20
     OR (after_stats->>'paid')::numeric <> 33905881.217
     OR new_backup <> 737 OR (SELECT count(*) FROM public.invoice_dedup_k1r2_20260914) <> 737 THEN
    RAISE EXCEPTION 'K1R2 abort: postcheck failed: %',after_stats;
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.invoices i
      WHERE NOT EXISTS(SELECT 1 FROM public.invoice_dedup_k1r2_20260914 b WHERE b.old_id=i.id)) IS DISTINCT FROM untouched_before THEN
    RAISE EXCEPTION 'K1R2 abort: unrelated invoice rows changed';
  END IF;
  FOREACH t IN ARRAY fk_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x JOIN public.invoice_dedup_k1r2_20260914 b ON x.invoice_id=b.notion_id',t) INTO actual_count;
    IF actual_count <> 0 THEN RAISE EXCEPTION 'K1R2 abort: dangling Notion FK in %',t; END IF;
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),''[]''::jsonb) FROM public.%I x',t) INTO current_rows;
    SELECT COALESCE(jsonb_agg(CASE WHEN b.old_id IS NULL THEN e ELSE jsonb_set(e,'{invoice_id}',to_jsonb(b.old_id)) END
      ORDER BY e->>'id'),'[]'::jsonb) INTO child_rows
    FROM jsonb_array_elements(fk_before->t) e LEFT JOIN public.invoice_dedup_k1r2_20260914 b ON b.notion_id=e->>'invoice_id';
    -- Compare sets by row id below: bigint shipment ids have a different lexical order.
    IF (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(current_rows) e)
       IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(child_rows) e) THEN
      RAISE EXCEPTION 'K1R2 abort: FK rows changed beyond invoice_id in %',t;
    END IF;
    SELECT COALESCE(sum((fk_repoints->>t)::int),0) INTO changed FROM public.invoice_dedup_k1r2_20260914;
    RAISE NOTICE 'K1R2_FK table=% repointed=% remaining_notion_refs=%',t,changed,actual_count;
  END LOOP;
  IF (SELECT jsonb_agg(to_jsonb(b) ORDER BY old_id) FROM public.invoice_dedup_k1_20260914 b) IS DISTINCT FROM r1_backup_before THEN
    RAISE EXCEPTION 'K1R2 abort: R1 backup changed';
  END IF;
  RAISE NOTICE 'K1R2_SUCCESS groups=370 old=737 notion=737 amount=5278736.20 backup=737 unique_old=737';
END;
$merge$;
COMMIT;
