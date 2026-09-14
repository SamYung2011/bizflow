#!/usr/bin/env bash
# One production rehearsal only. Every invoice/backup write is rolled back.
# Usage: ./dryrun.sh /absolute/path/to/migrations/124_legacy_invoice_k1_r2_customer_merge_20260914.sql
set -euo pipefail
umask 077
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration_path="${1:?Pass the reviewed migration 124 path}"
python3 - "$task_dir" "$migration_path" <<'PY'
from pathlib import Path
import hashlib,re,shlex,sys
p=Path(sys.argv[1]); migration=Path(sys.argv[2]).resolve(); source=migration.read_text()
assert len(re.findall(r'^BEGIN;$',source,re.M))==1
assert len(re.findall(r'^COMMIT;$',source,re.M))==1 and source.rstrip().endswith('COMMIT;')
tables=['invoices','inventory_movements','shipment_events','inventory','stock_deduction_audit','warranty_renewals']
snapshot="jsonb_build_object("+','.join("'%s',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb)::text) FROM public.%s x)"%(t,t) for t in tables)+",'r1_backup',(SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY old_id)::text) FROM public.invoice_dedup_k1_20260914 x),'backup_exists',to_regclass('public.invoice_dedup_k1r2_20260914') IS NOT NULL)"
before="SELECT "+snapshot+" AS k1r2_before \\gset\nSELECT to_regclass('public.invoice_dedup_k1r2_20260914') IS NULL AS k1r2_no_backup \\gset\n\\if :k1r2_no_backup\n\\else\n\\echo K1R2_DRYRUN_ABORT_BACKUP_EXISTS\n\\quit 3\n\\endif\n"
sql='\\set ON_ERROR_STOP on\n'+source.rsplit('COMMIT;',1)[0]
sql=sql.replace('CREATE TABLE IF NOT EXISTS public.invoice_dedup_k1r2_20260914',before+'\nCREATE TABLE IF NOT EXISTS public.invoice_dedup_k1r2_20260914',1)
sql+=r'''
DO $samples$
DECLARE x record;
BEGIN
 FOR x IN
  WITH extra_n_sample AS MATERIALIZED (
    SELECT old_id FROM public.invoice_dedup_k1r2_20260914 WHERE old_count_a<notion_count_b ORDER BY random() LIMIT 1
  ), multi_sample AS MATERIALIZED (
    SELECT old_id FROM public.invoice_dedup_k1r2_20260914
    WHERE old_count_a>1 AND notion_count_b>1 AND old_id NOT IN(SELECT old_id FROM extra_n_sample)
    ORDER BY random() LIMIT 1
  ), picked AS (
    SELECT old_id FROM extra_n_sample UNION ALL SELECT old_id FROM multi_sample
    UNION ALL (SELECT old_id FROM public.invoice_dedup_k1r2_20260914
      WHERE old_id NOT IN(SELECT old_id FROM extra_n_sample UNION ALL SELECT old_id FROM multi_sample)
      ORDER BY random() LIMIT 8)
  )
  SELECT b.old_invoice_number AS invoice_number,b.group_date AS date,b.group_total AS total,
    b.old_row_before->'items' AS old_items,b.notion_row->'items' AS notion_items,
    c.name AS customer_name,c.phone AS customer_phone,c.phone_mainland AS customer_phone_mainland,
    substring(b.marker_line FROM 'idx=([0-9]+)')::bigint AS notion_idx,b.pair_rank,b.group_size,b.old_count_a,b.notion_count_b,
    b.old_row_before->>'notes' AS old_notes,b.marker_line
  FROM public.invoice_dedup_k1r2_20260914 b JOIN public.customers c ON c.id=(b.notion_row->>'customer_id')::uuid
  WHERE b.old_id IN(SELECT old_id FROM picked) ORDER BY random()
 LOOP
  RAISE NOTICE 'K1R2_SAMPLE %',to_jsonb(x);
 END LOOP;
END;
$samples$;
\echo K1R2_PAIRS_BEGIN
COPY (
 SELECT b.old_id,b.old_invoice_number AS invoice_number,b.group_date AS date,b.group_total AS total,
   b.notion_id,substring(b.marker_line FROM 'idx=([0-9]+)')::bigint AS notion_idx,
   b.notion_row->>'customer_id' AS customer_id,c.name AS customer_name,c.phone AS customer_phone,
   c.phone_mainland AS customer_phone_mainland,b.pair_rank,(b.old_count_a>1 AND b.notion_count_b>1) AS is_multi_group,b.group_size,b.old_count_a,b.notion_count_b
 FROM public.invoice_dedup_k1r2_20260914 b JOIN public.customers c ON c.id=(b.notion_row->>'customer_id')::uuid
 ORDER BY b.old_invoice_number,b.old_id
) TO STDOUT WITH (FORMAT csv,HEADER true);
\echo K1R2_PAIRS_END
ROLLBACK;
BEGIN;
SET TRANSACTION READ ONLY;
'''
sql+="SELECT "+snapshot+" = :'k1r2_before'::jsonb AS k1r2_rollback_exact \\gset\n"
sql+='\\if :k1r2_rollback_exact\n\\echo K1R2_ROLLBACK_EXACT_OK\n\\else\n\\echo K1R2_ROLLBACK_STATE_CHANGED\n\\quit 4\n\\endif\nROLLBACK;\n'
assert not re.search(r'^COMMIT;',sql,re.M)
(p/'dryrun.generated.sql').write_text(sql)
(p/'migration.used.sql').write_text(source)
(p/'migration.sha256').write_text(hashlib.sha256(source.encode()).hexdigest()+'\n')
command="ssh ecs-user@47.242.242.233 'docker exec -i supabase-db psql -U postgres -t -A -F \",\"' <<'K1R2_DRYRUN_SQL' > "+shlex.quote(str(p/'dryrun.stdout'))+' 2> '+shlex.quote(str(p/'dryrun.stderr'))+'\n'+sql+'K1R2_DRYRUN_SQL\n'
(p/'.run_dryrun.sh').write_text(command)
print('Prepared ROLLBACK-only SQL. Migration SHA256 recorded; no customer data printed.')
PY
# An existing directory prevents accidental re-execution after a success or failure.
mkdir "$task_dir/.dryrun_started"
bash "$task_dir/.run_dryrun.sh"
python3 - "$task_dir" <<'PY'
from pathlib import Path
from decimal import Decimal
import csv,io,json,re,sys
p=Path(sys.argv[1]);out=(p/'dryrun.stdout').read_text();err=(p/'dryrun.stderr').read_text()
assert 'K1R2_SUCCESS groups=370 old=737 notion=737 amount=5278736.20 backup=737 unique_old=737' in err
assert 'K1R2_ROLLBACK_EXACT_OK' in out
body=out.split('K1R2_PAIRS_BEGIN\n',1)[1].split('K1R2_PAIRS_END',1)[0]
body=re.sub(r'^COPY \d+\n','',body,flags=re.M)
rows=list(csv.DictReader(io.StringIO(body)))
assert len(rows)==737 and len({r['old_id'] for r in rows})==737 and len({r['notion_id'] for r in rows})==737
assert sum(Decimal(r['total']) for r in rows)==Decimal('5278736.20')
(p/'pairs_r2.csv').write_text('\ufeff'+body,encoding='utf-8')
samples=[json.loads(line.split('K1R2_SAMPLE ',1)[1]) for line in err.splitlines() if 'K1R2_SAMPLE ' in line]
assert len(samples)==10
(p/'samples.json').write_text(json.dumps(samples,ensure_ascii=False,indent=2)+'\n')
safe=[line for line in err.splitlines() if re.search(r'K1R2_(BEFORE|REMAINDERS|PREFLIGHT|POSTCHECK|FK|SUCCESS)',line)]
(p/'dryrun.summary.txt').write_text('\n'.join(safe)+'\nK1R2_ROLLBACK_EXACT_OK\nPSQL_EXIT=0\n')
print('\n'.join(safe))
print('K1R2_ROLLBACK_EXACT_OK; pairs_r2.csv=737 rows; random samples=10; production execution count=1.')
PY
