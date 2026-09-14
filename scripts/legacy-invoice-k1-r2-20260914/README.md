# Historical invoice K1 unequal groups — R2 operator artifacts

Migration: `migrations/124_legacy_invoice_k1_r2_customer_merge_20260914.sql`.
Baseline `fa818fd`; branch `codex/legacy-invoice-k1-merge-r2-0914`.

Only the 370 unequal K1 groups are eligible. For each group, pair min(a,b) rows by numeric
old invoice_number/id and numeric Notion idx/id, in ascending order. No created_at ordering.
Expected: 737 pairs, HK$5,278,736.20, 745 surplus old invoices and 16 surplus Notion invoices untouched.
Annual pairs: 2023=104, 2024=466, 2025=146, 2026=21. Any drift raises an exception.
`group_size` means the number of pairs in a group; `old_count_a` and `notion_count_b` preserve both original counts.

Original N requires the raw source prefix, customer_id present, invoice_number absent,
and exclusion of R1 retained old ids. Postchecks exclude retained ids from both backups.
Expected final counts inside the transaction: invoices=5023, unowned=2055, original N=117;
Paid=33905881.217; R2 backup=737. Raw source-prefix counts include inherited markers and are diagnostic only.

Back up each pair before repointing the five foreign-key tables, then attach customer_id,
append the original marker line, and delete N. Keep R1 backups and every unpaired invoice unchanged.
The new private backup table has RLS and no API-role grants. It stores full invoice rows,
original notes, exact child-row identities/images, counts, and both original group sizes.
Rerun with 737 valid active backups is a no-op; partial, rolled-back, or drifted states fail closed.

The rollback restores full N rows through jsonb_populate_record (excluding generated columns),
only the captured FK ids, original customer_id and exact notes. Post-merge target edits stop restoration.
R2 backups remain with rolled_back_at; repeated rollback is a no-op. Roll back R2 before R1.

The operator alone runs the committing migration after reviewing DRYRUN.md. Codex only runs
one production ROLLBACK rehearsal. Copy dryrun.sh and rollback_124.sql to the approved private
handoff directory before use; never run dryrun.sh in Git, because its CSV/sample files contain customer data.
Invoke `bash dryrun.sh /absolute/path/to/migrations/124_legacy_invoice_k1_r2_customer_merge_20260914.sql`.
The `.dryrun_started` directory prevents accidental repetition. Its generated SQL has no COMMIT statement.
The wrapper compares complete business-table checksums and R1-backup checksum before/after ROLLBACK,
and confirms that the R2 backup table disappeared. Ten random samples are stratified to include
one group with surplus N and one multi-to-multi group, plus eight other pairs.

No frontend, customer records, R1 migration, or R1 backup rows are modified. The inherited source
marker format is unchanged from R1. K2/K3/no-twin and all surplus rows remain outside the pairing set.
Private reports, snapshots and CSVs are excluded from this commit.
