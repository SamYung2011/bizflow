# Historical invoice K1 merge — operator artifacts

Migration: `migrations/123_legacy_invoice_k1_customer_merge_20260914.sql`.
Baseline: `c916bd4`; branch: `codex/legacy-invoice-k1-merge-0914`.

The operator runs the committing migration only after reviewing the dry-run.
Codex ran exactly one production rehearsal, ending in ROLLBACK; nothing was committed to the database.

Copy `dryrun.sh` and `rollback_123.sql` to the approved private handoff directory before use.
Do not run the rehearsal from this repository: its CSV and random samples contain customer data.
Run `bash dryrun.sh /absolute/path/to/migrations/123_legacy_invoice_k1_customer_merge_20260914.sql` in that private directory.
An existing `.dryrun_started` directory prevents accidental repetition; the delivered rehearsal has already run.
No customer snapshots, CSVs, or sample reports belong in Git.

The merge pairs 761 balanced K1 groups / 989 invoices on each side / HK$6,716,667.
Both sides are sorted numerically within each group: old invoice_number then id; Notion idx then id.
Every affected row is backed up before mutations. The backup also stores exact old notes and child row identities/images.
The five child tables are repointed before deletion. Unrelated invoices and child fields are checked byte-for-byte as JSONB values.
Re-running an applied merge changes no invoice/child data; partial, rolled-back, or drifted states raise an error.
The inverse restores generated-column-safe full Notion rows, captured child ids, original customer_id and exact notes.
It refuses subsequent edits to affected rows and retains the 989 backup records with rolled_back_at.

`original_notion=854` excludes retained old ids recorded in the backup: transferred markers must not turn old invoices into original N records.
The raw notes-prefix count after rehearsal is 1675, including 821 old invoices whose original notes were empty; all 989 old invoices retain the source marker.

Parser inspection at c916bd4 found an existing presentation mismatch: root-site hides machine-note text and has no Notion badge;
legacy React leaves batch/idx/raw_status text and also has no Notion badge. No frontend file was modified under this SQL-only scope.
The private DRYRUN.md records this limitation and the exact checks; source-tag display was not claimed to pass.
