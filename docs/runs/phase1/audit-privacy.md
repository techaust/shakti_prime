# Audit fixes: privacy (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-privacy`, from `main` after M1 merges |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-privacy`, slot 6: Postgres 54336, app 3036 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (identity documents, deleting data): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | the gate's reading at the start and end of each agent run |
| State | brief |
| Next step | the lead branches it from `main` once M1 has merged, then starts the builder |

## Brief
The audit's evidence and the verifier's verdicts: [`1-security.md`](../../14-reviews/2026-10-audit/1-security.md), [`1-security.verdict.md`](../../14-reviews/2026-10-audit/1-security.verdict.md), [`5-ops.md`](../../14-reviews/2026-10-audit/5-ops.md) (OPS-5). Report: `docs/14-reviews/2026-10-audit.md`.

1. **SEC-1 (high):** an import never keeps an identity number. At parse time, a column whose header or values look like an Aadhaar number (twelve digits in any script or separator, by the same rule as item 3) is dropped from `import_rows.raw_json` and the preview, and the importer is told in plain words which column was left out; a value inside another column is masked to its last four digits. The import file itself is deleted from storage once its job is committed or rolled back (or after a stated number of days for a job left open), and `raw_json` and `normalised_json` of committed jobs are cleared after the reconciliation window (name the period in `workshop-defaults.ts`), keeping each row's state, what it made and why it was refused so M1's reconciliation still adds up. Logged in `retention_runs`. Tests: a workbook with an Aadhaar column and one with a number inside an address; the purge; reconciliation still adds up after it.
2. **SEC-3 (medium):** `redactText()` (`packages/domain/src/ports/redaction.ts`) catches every shape `maskForModel()` does (every script's digits, dots, slashes, underscores, commas, brackets, a letter prefix, phones with separators), with one shared normaliser so the two can never drift again; a table-driven test over every input the verifier lists, run against both.
3. **SEC-2 (low):** SECURITY §5 says exactly what Phase 1 masks (vault photos and PDFs, imports after item 1, the scrubber) and which uploads wait for Phase 2's identity-document flows; no promise the code does not keep.
4. **OPS-5 (low):** the real masking test runs in CI: the OCR model cached in CI keyed by the `tesseract.js` version, `OCR_LANG_PATH` set for the unit and security jobs and listed for `web#test` in `turbo.json`.

Done when: the checks of AGENTS §10 pass; the security suite passes on the slot's Postgres; no Aadhaar-shaped value from the test workbooks is found anywhere in the database or storage after an import (a completeness search like M1's).

**Migrations:** after `main`'s last one. **Early check:** after the parse-time filter, the purge job and their tests. **How to work:** as every brief: commit every 20 minutes, never push, never docker, heavy commands through `bash /home/user/shakti_prime/tools/integration/heavy.sh`, no pull request, no install, no hosted service.

## Report

### Early check, 13-10-2026 (cloud, slot 6)
Schema, migrations, the parse-time filter, the purge and SEC-3's shared number finder, with their tests on the slot's Postgres. Screens, documents and OPS-5 are not started.

**SEC-3, one number finder.** `packages/domain/src/privacy/number-shapes.ts` (new) holds what `maskForModel()` had of its own: the normaliser (every script's digits, every space, dash and format character), the safe shapes (UUIDs, dates, times, amounts, quantities, codes) and the digit runs. `model-text.ts` now imports them; `redactText()` (`ports/redaction.ts`) finds numbers with `findPersonalNumbers()` from the same module. Its policy is unchanged in kind: an Aadhaar-shaped number (twelve digits as one run, or groups of 4-8, 8-4, 4-4-4) becomes `[number]`; a phone (`isPhone()`: ten digits from 6 to 9, eleven after 0, twelve after 91, thirteen after 091, any number after `+`) keeps its last four. Any number of another length stays (order numbers, millisecond times, `ASH/Q/2026-27/0001`), as the existing logger tests require. Aadhaar windows are found before phone windows, so a phone is never read across part of an Aadhaar number. Every existing redaction test passes unchanged.

**SEC-1, at parse time.** `packages/domain/src/imports/identity-columns.ts` (new), `withoutIdentityNumbers()`:
- A column is left out when its header names Aadhaar (aadhaar, aadhar, adhaar, UID, UID no, आधार, આધાર, any case or punctuation), or when most of its filled cells are an Aadhaar number (alone, or after a label of at most ten letters).
- Every other Aadhaar number in a cell or header becomes `XXXX XXXX 0123`: separators and the last four digits kept.
- Twelve digits in one run beginning 91[6-9] are a mobile number in a column named as a phone. Anywhere else they count as Aadhaar only when the Verhoeff check digit holds.
- `parseImportFile()` applies it and returns `leftOutColumns` and `maskedValues`. A file with nothing else is refused (`import_only_identity_numbers`).
- `imports.job.create` applies it again to its own input (a caller other than the upload action), stores `import_jobs.left_out_columns` and `masked_values`, and refuses a deleted file.

**SEC-1, the purge.** Migrations `0143_audit_privacy` (generated) and `0144_audit_privacy_rls` (custom):
- Columns: `files.deleted_at`, `import_jobs.left_out_columns`, `masked_values`, `purged_at`. Indexes: `files_import_kept_idx` and `import_jobs_purge_idx`.
- `app.purge_import_rows(entity, days, jobs)` clears `raw_json` and `normalised_json` of up to N jobs of one company. A job qualifies when it is not committing, not purged, and has had no change for the period. It is held with `skip locked`, then marked `purged_at`.
- `app.record_import_files_deleted(entity, open_days, ids)` marks `deleted_at` on import files whose job ended (committed, failed or rolled back), or that were uploaded more than the open period ago. Any other id is passed over.
- Both definers require `imports.process:entity` (platform-only, already held by `system:workers` at all), require the company in the request, and check ranges. Each writes a `retention_runs` row only when it changed something (`import-rows-purge`, `import-files-purge`). `app_user` has no update grant on any of these columns.
- Commands `imports.job.purge` and `imports.file.record_deleted` (`commands/imports/purge.ts`) audit one row per job or file. The query `importFilesToDelete` (`queries/imports/import-purge.ts`) runs as the workers under RLS. The worker `apps/web/src/workers/files/purge-imports.ts` walks the companies (archived ones included): it deletes from the store first, records only the deletions that succeeded, then clears rows. It runs inside the hourly `files-sweep` route, so no new schedule or QStash setup is needed.
- `imports.job.map`, `preview` and `commit` refuse a purged job (`import_job_purged`). Rollback stays allowed, since it reads only `created_id`. `openFile` and `startImport` refuse a deleted file.
- `dedupe_json` is kept (it holds ids and codes only). M1's anonymiser still blanks it with the rest.

**Periods (workshop defaults, `WORKSHOP_DEFAULTS.retention`).** Neither period is settled; both are for the owner and CA to confirm:
- `importReconciliationDays: 30`, which covers the cutover's two-week parallel run;
- `importFileOpenDays: 7`.

**Tests added:**
- `privacy/number-shapes.test.ts`: 72. Every verifier shape, run against `redactText`, `redactForAudit` and `maskForModel`.
- `imports/identity-columns.test.ts`: 7.
- `imports/parse.test.ts`: +2.
- `packages/db/tests/security/import-purge.test.ts`: 12. Every role, agent and narrower worker refused; fails closed; company and range checks; reader pool refused; no request may write the new columns; which jobs and files; states kept; `retention_runs`; idempotent.
- `packages/domain/tests/commands/import-purge.test.ts`: 9. Denied, wrong company and happy path for both commands and the query; the reconciliation is equal before and after the purge; a purged job is refused. It also runs a completeness search over every text, JSON and array column of every public table for the masked digits of a workbook with an Aadhaar column (a number cell, a spaced text and a hyphenated text) and of a CSV with a number inside an address: no hit after the import, and none after the purge.
- `apps/web/tests/imports.test.ts`: +1. Upload, `startImport`, commit, then the purge with the memory store: a failing store leaves the file recorded as kept; the bytes go once the job ends; an open job's file stays; the reconciliation is equal after the rows are cleared; a deleted file starts nothing; a purged job refuses mapping.

**Checks:**
- `pnpm test:security` on 54336: db 44 files, 1245 tests; domain 76 files, 959 tests; web 25 files, 323 tests; all passed.
- `turbo run test --force`: all passed after two fixes (Activity log names for the two commands, `machines:docs`).
- Folder lint and the workspaces' typechecks clean; `copy-lint` clean; `db:docs` and `machines:docs` regenerated.

**EXPLAIN (ANALYZE), slot 6, as `system:workers`:**
- Files to delete: Index Scan using `files_import_kept_idx`, 1.1 ms. The ended-job test is a hashed subplan over `import_jobs` (161 rows).
- Jobs to purge: Index Scan using `import_jobs_purge_idx`, 0.06 ms.

**Decisions the brief did not settle:**
- The purge reuses `imports.process`, not a new permission.
- It runs inside the hourly files sweep.
- Rows of rolled-back, failed and left jobs are cleared too, after the same period, and such a job is then closed to mapping, checking and adding.
- An import file is deleted at most seven days after upload, whatever its job's state.
- Archived companies are purged as well.
- `retention_runs` gets a row only for a call that changed something, so the hourly runs leave no empty rows.

**Next, after the early check:**
- The job screen: the columns left out, values hidden, file deleted, rows cleared, and the two refusals.
- The journeys.
- SECURITY §5 (SEC-2 and the import rule), DATABASE (columns, definers, §7 retention), the design's Built record, 06-api (the sweep route's answer), the workshop pack rows.
- OPS-5 (`ci.yml` model cache, `OCR_LANG_PATH` for `web#test`).

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
