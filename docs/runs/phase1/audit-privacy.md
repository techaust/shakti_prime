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

### Final, 14-10-2026 (cloud, slot 6)
The early check was approved, with one addition: a one-off pass over the imports made before the fix. The whole slice is now built: the pass, the screen, the journey, the documents and OPS-5.

**The one-off identity pass (the lead's addition).** The worker computes the rows and a definer writes them, so the rule stays in one place, the domain's `withoutIdentityNumbers()`.
- Migrations `0145_audit_privacy_identity` (generated) and `0146_audit_privacy_identity_rls` (custom). They add `import_jobs.identity_checked_at`, set at the start of every job from this fix on, and the partial index `import_jobs_identity_unchecked_idx`.
- `app.import_job_to_check(entity)` holds the company's oldest unchecked job that is not committing, skipping a held one, and answers its columns and its rows.
- `app.record_import_identity_check(entity, job, columns, left_out, masked, rows)` writes the changed rows. It refuses a job that would gain a column, and any row left with more keys than the new columns, so a column left out goes from every row. It adds the columns left out and the values masked, and sets `identity_checked_at`. A call that changed something writes a `retention_runs` row (`import-identity-check`).
- Both definers require `imports.process:entity` and the company in the request, and use `search_path ''`.
- The command `imports.job.mask_identity` (`commands/imports/mask-identity.ts`) masks the raw cells and every string of `normalised_json` (`maskIdentityValue()`), sends only the changed rows, and audits the counts.
- The files sweep runs the pass first for each company, call after call, until none is left. After that, each call is one index probe (EXPLAIN below).
- Side effect: marking an earlier job checked changes its `updated_at`, so the 30-day purge of such a job starts again from the pass. Its rows hold no Aadhaar number by then. This is stated in the migration.

**Screen.**
- `components/imports/privacy-notes.tsx` adds the section "What this import does not keep" to the job page. It names the columns left out and how many numbers were hidden, says when the file was deleted, and says when the rows' details were cleared and that the counts stay.
- A purged job left before adding shows "This import was left unfinished" with "Upload the file again" instead of the matching, checking and adding steps. A purged job's rows grid is hidden; its reconciliation stays.
- The catalogue gained `imports.privacy.*`, two `errors.*` sentences, three Activity log action names and four field labels. `uploadAgain` was added to copy-lint's button keys.

**Journey.** In `e2e/imports.spec.ts`, a GM uploads a list with an "Aadhaar No" column and a number inside an address. The page names the column left out and the one number hidden, and no digit of either reaches the page; axe passes. It adds the screenshot `imports-identity-left-out`, whose Linux baseline you need to make.

**Documents.**
- SECURITY §5 now says exactly what Phase 1 masks and when (SEC-2): vault photos and PDFs, imports and their purge, and the scrubber's shapes with the shared finder. Consent proofs, signed quotes and vault Word and Excel files are kept as uploaded. WhatsApp, field-app and `customer_document` uploads wait for their phases.
- SECURITY §3.3 lists the workers' use of `imports.process`.
- DATABASE §4.1 has the four definers; the `files`, `import_jobs`, `import_rows` and `retention_runs` rows are updated; §7 describes the import purge.
- The design's Built record is in §6.3, and the workshop defaults list in §11.
- 06-api: the sweep route's answer. TESTING §6: the OCR model in the unit and security jobs.
- Workshop pack FIN-3 sets out the two periods (7 and 30 days) for the owner and the CA, with its row in the answer table and in exit-gate-actions §5.

**OPS-5.**
- In `ci.yml`, the unit and security jobs read the installed `tesseract.js` version and restore the model from the Actions cache, keyed by that version and the model package's version. On a miss they take `@tesseract.js-data/eng@1.0.0` from the npm registry (npm checks its integrity) and extract `4.0.0_best_int/eng.traineddata.gz`, the file the spike uses. `OCR_LANG_PATH` is set on `pnpm test` and `pnpm test:security`.
- `turbo.json` lists `OCR_LANG_PATH` for `web#test`.
- **For the lead to verify:** `actions/cache` was pinned nowhere in the repository, and the session cannot reach GitHub. I pinned `5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3` from memory, so check that SHA (`gh api repos/actions/cache/git/ref/tags/v4.2.3`) before the pull request. A wrong SHA fails the job loudly; it cannot pass silently.
- Locally, with the same model from the npm registry in `OCR_LANG_PATH`, `mask-pdf-pages.test.ts` ran all 14 tests (one was skipped before), and the security suite's real-OCR case ran.

**Tests added since the early check:**
- `import-purge.test.ts` (db): 12 → 15 (the pass's definers in every refusal, the reader and company checks; the hand-out; the two shape refusals; the write, the record, check-once).
- `import-purge.test.ts` (domain): 9 → 11 (the pass's denied and wrong-company cases; an earlier job with an Aadhaar column in every row and one in its checked input has none after the pass, its reconciliation unchanged, one audit row of counts, then nothing left).
- `apps/web/tests/imports.test.ts`: +1 (an earlier job with an Aadhaar column has none after one sweep, and its reconciliation is unchanged).
- The import journey: +1.

**Checks, all through the lock, on 54336 and port 3036:**
- `pnpm exec prettier --check .`: all matched files use Prettier code style.
- `pnpm db:docs` and `machines:docs`: regenerated; `docs/data` committed.
- `pnpm copy-lint`: clean.
- `pnpm typecheck`: passed.
- `turbo run test --force`, with `OCR_LANG_PATH`: tokens 146, copy-lint 17, ui 107, contracts 182, db 134, domain 2157, web 841; all passed.
- `pnpm test:security`, with `OCR_LANG_PATH`: db 44 files, 1248 tests; domain 76 files, 961 tests; web 25 files, 324 tests; all passed.
- `pnpm build`: 2 tasks successful. `js-budget`: every page within its budget (46 pages).
- `e2e:seed`, then `playwright test e2e/imports.spec.ts --ignore-snapshots`: 29 passed (1.2 min).
- `pnpm lint`, the whole repository, last: clean.

**EXPLAIN (ANALYZE), slot 6:** the identity pass's lookup is an Index Scan using `import_jobs_identity_unchecked_idx`, 0.17 ms. The purge's two lists are in the early check.

**Not done, or uncertain:**
- The Linux baseline of `imports-identity-left-out` is yours to make, and so is the check of the `actions/cache` SHA.
- No journey shows the purged state: reaching it needs a job aged in the database. It is covered by the web and domain suites instead.
- A very large earlier job (50,000 rows) is read and checked in one call. That is fine for the sweep's budget at today's sizes, but it is not measured.
- The migration numbers 0143 to 0146 follow 0142, as you renumber them at integration. The documents cite 0144 and 0146.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
