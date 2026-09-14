#!/usr/bin/env bash
# One production rehearsal only. Every invoice/backup write is rolled back.
# Usage: ./dryrun.sh /absolute/path/to/migrations/123_legacy_invoice_k1_customer_merge_20260914.sql
set -euo pipefail
umask 077
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration_path="${1:?Pass the reviewed migration 123 path}"
python3 - "$task_dir" "$migration_path" <<'PY'
from pathlib import Path
import hashlib,re,shlex,sys
p=Path(sys.argv[1]); migration=Path(sys.argv[2]).resolve(); source=migration.read_text()
assert len(re.findall(r'^BEGIN;$',source,re.M))==1
assert len(re.findall(r'^COMMIT;$',source,re.M))==1 and source.rstrip().endswith('COMMIT;')
tables=['invoices','inventory_movements','shipment_events','inventory','stock_deduction_audit','warranty_renewals']
snapshot="jsonb_build_object("+','.join("'%s',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb)::text) FROM public.%s x)"%(t,t) for t in tables)+",'backup_exists',to_regclass('public.invoice_dedup_k1_20260914') IS NOT NULL)"
before="SELECT "+snapshot+" AS k1_before \\gset\nSELECT to_regclass('public.invoice_dedup_k1_20260914') IS NULL AS k1_no_backup \\gset\n\\if :k1_no_backup\n\\else\n\\echo K1_DRYRUN_ABORT_BACKUP_EXISTS\n\\quit 3\n\\endif\n"
sql='\\set ON_ERROR_STOP on\n'+source.rsplit('COMMIT;',1)[0]
sql=sql.replace('CREATE TABLE IF NOT EXISTS public.invoice_dedup_k1_20260914',before+'\nCREATE TABLE IF NOT EXISTS public.invoice_dedup_k1_20260914',1)
sql+=r'''
DO $samples$
DECLARE x record;
BEGIN
 FOR x IN
  SELECT b.old_invoice_number AS invoice_number,b.group_date AS date,b.group_total AS total,
    b.old_row_before->'items' AS old_items,b.notion_row->'items' AS notion_items,
    c.name AS customer_name,c.phone AS customer_phone,c.phone_mainland AS customer_phone_mainland,
    substring(b.marker_line FROM 'idx=([0-9]+)')::bigint AS notion_idx,b.pair_rank,b.group_size,
    b.old_row_before->>'notes' AS old_notes,b.marker_line
  FROM public.invoice_dedup_k1_20260914 b JOIN public.customers c ON c.id=(b.notion_row->>'customer_id')::uuid
  ORDER BY random() LIMIT 10
 LOOP
  RAISE NOTICE 'K1_SAMPLE %',to_jsonb(x);
 END LOOP;
END;
$samples$;
\echo K1_PAIRS_BEGIN
COPY (
 SELECT b.old_id,b.old_invoice_number AS invoice_number,b.group_date AS date,b.group_total AS total,
   b.notion_id,substring(b.marker_line FROM 'idx=([0-9]+)')::bigint AS notion_idx,
   b.notion_row->>'customer_id' AS customer_id,c.name AS customer_name,c.phone AS customer_phone,
   c.phone_mainland AS customer_phone_mainland,b.pair_rank,b.group_size>1 AS is_multi_group,b.group_size
 FROM public.invoice_dedup_k1_20260914 b JOIN public.customers c ON c.id=(b.notion_row->>'customer_id')::uuid
 ORDER BY b.old_invoice_number,b.old_id
) TO STDOUT WITH (FORMAT csv,HEADER true);
\echo K1_PAIRS_END
ROLLBACK;
BEGIN;
SET TRANSACTION READ ONLY;
'''
sql+="SELECT "+snapshot+" = :'k1_before'::jsonb AS k1_rollback_exact \\gset\n"
sql+='\\if :k1_rollback_exact\n\\echo K1_ROLLBACK_EXACT_OK\n\\else\n\\echo K1_ROLLBACK_STATE_CHANGED\n\\quit 4\n\\endif\nROLLBACK;\n'
assert not re.search(r'^COMMIT;',sql,re.M)
(p/'dryrun.generated.sql').write_text(sql)
(p/'migration.used.sql').write_text(source)
(p/'migration.sha256').write_text(hashlib.sha256(source.encode()).hexdigest()+'\n')
command="ssh ecs-user@47.242.242.233 'docker exec -i supabase-db psql -U postgres -t -A -F \",\"' <<'K1_DRYRUN_SQL' > "+shlex.quote(str(p/'dryrun.stdout'))+' 2> '+shlex.quote(str(p/'dryrun.stderr'))+'\n'+sql+'K1_DRYRUN_SQL\n'
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
assert 'K1_SUCCESS groups=761 old=989 notion=989 amount=6716667.00 backup=989 unique_old=989' in err
assert 'K1_ROLLBACK_EXACT_OK' in out
body=out.split('K1_PAIRS_BEGIN\n',1)[1].split('K1_PAIRS_END',1)[0]
body=re.sub(r'^COPY \d+\n','',body,flags=re.M)
rows=list(csv.DictReader(io.StringIO(body)))
assert len(rows)==989 and len({r['old_id'] for r in rows})==989 and len({r['notion_id'] for r in rows})==989
assert sum(Decimal(r['total']) for r in rows)==Decimal('6716667.00')
(p/'pairs.csv').write_text('\ufeff'+body,encoding='utf-8')
samples=[json.loads(line.split('K1_SAMPLE ',1)[1]) for line in err.splitlines() if 'K1_SAMPLE ' in line]
assert len(samples)==10
(p/'samples.json').write_text(json.dumps(samples,ensure_ascii=False,indent=2)+'\n')
safe=[line for line in err.splitlines() if re.search(r'K1_(PREFLIGHT|POSTCHECK|FK|SUCCESS)',line)]
(p/'dryrun.summary.txt').write_text('\n'.join(safe)+'\nK1_ROLLBACK_EXACT_OK\nPSQL_EXIT=0\n')
print('\n'.join(safe))
print('K1_ROLLBACK_EXACT_OK; pairs.csv=989 rows; random samples=10; production execution count=1.')
PY
