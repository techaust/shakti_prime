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

### Fix round, 14-10-2026 (cloud, slot 6)
All thirteen review findings are fixed, as the lead decided, in 936a1159 and 89b35646, with the migrations 0147 to 0149.

**Finder (H1, M2, L6).** `privacy/number-shapes.ts`:
- Invisible characters (format characters such as LRM, RLM, ZWSP, ZWJ and ZWNJ, and the no-break spaces) are dropped before anything is read.
- A run counts as an Aadhaar number when consecutive groups of it hold twelve digits, the first 2 to 9, in any grouping. The whole run is then the number, so a group joined to it is masked with it.
- A `+` run is a phone only when it is +91 and a mobile number; otherwise it is tried as an Aadhaar number like any other.
- A comma or semicolon followed by a space ends a run, so lists of small numbers stay as they are.
- Document numbers with a financial year (`SS/2026-27/000123`) are added to the safe shapes, so the audit trail keeps them.
- `redactText()` keeps its earlier format for 91 and a mobile written in groups. The review's inputs run through the import filter, `redactText`, `redactForAudit` and `maskForModel` in `number-shapes.test.ts`.

**Import filter (H1, M1, M3, L1, L3).** `imports/identity-columns.ts`:
- A run holding an Aadhaar number keeps only its last four digits, and `maskedValues` counts only cells where a number was removed.
- A column whose header holds an Aadhaar number is left out, and the left-out names are masked. Both the reader and `imports.job.create` do this.
- `namesPhone()` uses the `u` flag and reads Ph, Ph No, Phone No, Mobile No, Contact, Number, and phone and mobile in Hindi and Gujarati. A column mostly of phone numbers is a phone column whatever its header. Elsewhere, 91 and a mobile number counts as Aadhaar when its check digit holds.
- `imports.job.create` no longer reads the cells again inside its transaction. It checks the headers only (`withoutIdentityHeaders`) and masks the left-out names it is given.
- `files.upload.begin` masks an import file's name.

**Pass and purge (M4, L2, L3, L4).**
- **0147** adds `import_jobs.identity_checked_through`.
- **0148** replaces the pass's two definers:
  - `app.import_job_to_check(entity, job, limit)` hands out the next part of a named job.
  - `app.record_import_identity_check(...)` checks every column name and every key of the part's rows. It checks that the rows lie in the part, and that a new file name changes only digits to X. It moves the cursor on, and marks the job checked with the last part.
  - `app.record_import_purge_failure()` records a failed call by its code alone.
- **0149** writes the rows by their key. The first two parts of a 50,000-row job had taken 13 s each while the statistics did not yet count its rows: a join read every row of the table for each row given. Now every part takes at most 151 ms.
- `imports.job.mask_identity` takes `{ entityId, jobId }` and checks 1,000 rows a call. The first part decides the columns; later parts mask cells only (`maskIdentityCells`).
- `nextImportJobToCheck` hands out the next job, passing by those that failed this run. `imports.purge.record_failure` is new.
- `purgeImports()`:
  - catches a failed job (passed by until the next hour), a failed company part (the run goes on to the next company) and a file the store refuses (logged by its id and paged past); each is recorded by its code;
  - pages the files by bucket with a cursor;
  - reports `failures`.
- Map, preview and commit check a purged job after its state, so only a job left before adding answers `import_job_purged`.

**CI (L5).** The model's SHA-256 (`45b4cb34…ff91`) is pinned and checked with `sha256sum -c` after the cache or the registry, in both jobs.

**Documents (L7):**
- SECURITY §5's import item and the scrubber's sentence. The pass is put in the future tense; the item now says that a phone column keeps 91 and a mobile, and that the uploaded file holds every column for up to a week.
- 06-api: the budget starts no new call after 30 seconds; `failures` is in the answer.
- `errors.import_job_purged`.
- DATABASE: §4.1 (three definers and the import job row), §7 and the `retention_runs` row.
- The design's Built record and TESTING.
- 0146's comment cannot change on a database that ran it: the migrator compares each file's hash. DATABASE and 0148's header carry the correction instead.

**Tests:**
- `number-shapes.test.ts`: 72 → 99 (the review shapes against all three; whole-run counts; +91 and other countries; lists and 0 or 1 left alone).
- `identity-columns.test.ts`: 7 → 9 (a masked left-out header; phone headers in three scripts and a phone column by its values).
- `import-purge.test.ts` (db): 15 → 16. The new definers in every refusal and the reader check; the part hand-out and a job adding rows; names, part, file-name and failure-code refusals; the cursor; a failure row.
- `import-purge.test.ts` (domain): 11 → 15:
  - a 50,000-row job in 50 calls of at most 10 s each (measured at 151 ms at most), leaving no Aadhaar column and no twelve-digit run;
  - a failing job, recorded, with the next job handed out past it;
  - mobile numbers under "मोबाइल नंबर", "Ph No" and "Cust" with no `phone_invalid`;
  - a headerless file whose `left_out_columns` holds no twelve digits;
  - the direct-input test reworked for L1;
  - the completeness search made exact (L8).
- `apps/web/tests/imports.test.ts`: 34 → 36 (a masked file name; a sweep that records a failing job by its code and checks the others).

**Checks, through the lock, on 54336 and 3036:**
- `pnpm exec prettier --check .`: clean.
- `pnpm db:docs` and `machines:docs`: regenerated; `docs/data` committed.
- `copy-lint`: clean.
- `pnpm typecheck`: passed.
- `turbo run test --force`, with `OCR_LANG_PATH`: tokens 146, copy-lint 17, ui 107, contracts 182, db 134, domain 2186, web 841; all passed.
- `pnpm test:security`, with `OCR_LANG_PATH`: db 44 files, 1249 tests; domain 76 files, 965 tests; web 25 files, 326 tests; all passed.
- `pnpm build`: 2 tasks successful. `js-budget`: every page within its budget (46 pages).
- `e2e:seed`, then `playwright test e2e/imports.spec.ts --ignore-snapshots`: 29 passed (1.1 min).
- `pnpm lint`, the whole repository, last: clean.

**Things to know:**
- 0149 failed on its first use on the slot (`pg_catalog.nullif` does not exist, since `NULLIF` is syntax). I corrected the file before any other database ran it, removed its record from the slot's `drizzle.__drizzle_migrations`, and the migrator applied the corrected text (`create or replace`). No other database has seen it.
- The finder now masks a few more shapes in the audit trail and the logs. Twelve digits starting 2 to 9 in any grouping are masked (for example a space-separated year list "2024 2025 2026"), as is a document number of another shape that holds twelve such digits. Each is masked in full, never in part.
- The review's "Invoice No `202610140001`" begins with 2, so it is Aadhaar-shaped and is still masked: privacy wins, as decided. Only twelve digits beginning with 0 or 1 are left alone.
- The rows purge clears up to 20 jobs in one statement, as before. A failure there is caught per company rather than per job.

## Review
14-10-2026, cloud, of `fix/audit-privacy` at f445ff0b against `origin/main` 150778f3 (#172), Opus 5.5. **H1 blocks the merge.** M1 is a one-line fix, so it goes in with H1. The other mediums and lows are follow-ups unless the lead takes them now. The probes ran `withoutIdentityNumbers()`, `parseImportFile()`, `redactText()` and `maskForModel()` from the worktree under `tsx`. The SQL ran as `app_user` on the slot's Postgres (54336), inside rolled-back transactions.

| # | Severity | Finding | State |
|---|---|---|---|
| H1 | high | **The import can keep a whole Aadhaar number, or 8 of its 12 digits, while it counts the cell as hidden** (`packages/domain/src/privacy/number-shapes.ts:264-298`, used by `imports/identity-columns.ts:47` and `:78`). *Confirmed* under tsx. There are two causes. (a) Aadhaar windows are taken greedily from the left (`for (const size of [3, 2, 1])`), so a 4- or 8-digit group joined before the number takes the mask, and the number's own groups are left: `"DOB 12.05.1985, 2345 6789 0124"` → `"DOB 12.05.XXXX, XXXX 6789 0124"` (8 digits of the number kept, and the year of birth destroyed); `"12051985 2345 6789 0124"` → `"XXXXXXXX 2345 6789 0124"` (all 12 kept); `"Plot 1234, 2345 6789 0124"` → `"Plot XXXX, XXXX 6789 0124"`. Each answers `maskedValues: 1`, so the page tells the importer the number was hidden. `redactText()` keeps 8 digits in the 8-digit case (`"[number] 6789 0124"`). (b) A run that starts with `+` is never tried as an Aadhaar number (`:270`). It is read as an international phone, which the import keeps whole: `"Aadhaar +2345-6789-0124"` and `"Ram + 2345 6789 0124"` are stored unchanged (`maskedValues: 0`), and a column of them is not left out. **Scenario:** a subsidy list has a Remarks column that reads "DOB 12.05.1985, 2345 6789 0124". `import_rows.raw_json` and `normalised_json` keep 8 of the 12 digits for 30 days, and a lead field mapped from that column keeps them for good. That fails the brief's "no Aadhaar-shaped value … anywhere in the database". **Fix:** in `masked()` and `maskIdentityValue()`, when a run holds an Aadhaar window, keep only the last four digits of the whole run (as `maskForModel()` masks the whole run). In `numbersOfRun`, try a `+` run for an Aadhaar window too, unless it is `+91` and a mobile. Add these inputs to `identity-columns.test.ts` and `number-shapes.test.ts`. | Fixed: 936a1159, 89b35646. A run holding an Aadhaar number is masked whole except its last four digits; a `+` run is tried as Aadhaar unless it is +91 and a mobile; `maskedValues` counts only real removals. The review's inputs are in `number-shapes.test.ts` (import filter, `redactText`, `maskForModel`) |
| M1 | medium | **A column the import leaves out keeps its header text unmasked, for good** (`identity-columns.ts:128`, `commands/imports/create-job.ts:96`, `commands/imports/mask-identity.ts:76`). The kept headers are masked, but `leftOutColumns` is the file's own text. *Confirmed:* `withoutIdentityNumbers(['Name', 'UID 2345 6789 0124'], …)` answers `leftOutColumns: ['UID 2345 6789 0124']`. A headerless CSV whose rows read `Rekha Devi,Rampur,UID 2345 6789 0124` passes header detection (every cell has a letter). `parseImportFile()` then takes that first person's row as the header and answers `leftOutColumns: ['UID 2345 6789 0124']`. The name goes into `import_jobs.left_out_columns`, which neither the purge nor M1's anonymiser clears. It is also sent to the browser in `ImportJobDto` and printed under "What this import does not keep". Live, `app.record_import_identity_check()` stored `{"UID 2345 6789 0124"}` when given that name (rolled back). **Fix**, one line in each of the two places: record the name through `masked()`, and add a test with a header that holds a number. | Fixed: 936a1159, 89b35646. A column whose header holds an Aadhaar number is left out, and every left-out name is masked (`maskIdentityText`), in the reader, in `imports.job.create` and in the pass; a headerless file is tested in `identity-columns.test.ts` and the domain suite |
| M2 | medium | **SEC-3 is not fully met: other groupings and invisible characters pass the scrubber and the import** (`number-shapes.ts:248`). `AADHAAR_GROUPINGS` accepts only 12, 4-8, 8-4 and 4-4-4. *Confirmed:* these pass `withoutIdentityNumbers()` whole, in a cell or as a whole column (which is kept), and they pass `redactText()`: `"234 567 890 124"`, `"234567 890124"`, `"23 45 67 89 01 24"`, `"2345 6789 01 24"`, and `"234567‎890124"`. The last has one left-to-right mark, which a spreadsheet shows as a plain run of twelve digits; any format character reads as a space. `maskForModel()` masks every one. The brief's item 2 asks that `redactText()` catch every shape `maskForModel()` does, and item 1 asks for "twelve digits in any script or separator". The OCR masker already accepts any join (`privacy/identity-numbers.ts`, `AADHAAR_PATTERN`). **Fix:** read twelve digits in one run as an Aadhaar shape whatever their grouping (a first digit of 2 to 9 keeps the false positives down), and add these inputs to the shared table. | Fixed: 936a1159, 89b35646. One finder: invisible characters (format characters, NBSP) dropped first, twelve digits starting 2 to 9 in any grouping; the shared table runs against all three |
| M3 | medium | **The import corrupts phone numbers in a column it does not recognise as a phone column** (`identity-columns.ts:38-39`). `namesPhone()` strips `\W` without the `u` flag, so a Hindi or Gujarati header (`मोबाइल नंबर`) is reduced to nothing. "Ph No", "Ph. No.", "Number" and "Cust No" match nothing either. In such a column, a mobile number written as 91 and ten digits counts as Aadhaar whenever its check digit happens to hold, about one in ten. *Confirmed:* under each of those headers, 98 of 1,000 such mobile numbers were masked to `XXXXXXXX9190`; under "Mobile", none were. A masked phone fails `CreateLeadInput` (`imports/leads.ts:131`, `phone_invalid`), so about one row in ten of such a list is refused at the check (*plausible* end to end). Separately, twelve digits beginning with 0 or 1, which is never an Aadhaar number, are treated as one (an "Invoice No" column of `202610140001` is left out). **Fix:** also decide a phone column by its values (most filled cells are 91 and a mobile number), match headers in Indian scripts and "ph"/"no", and require a first digit of 2 to 9. | Fixed: 936a1159, 89b35646. `namesPhone()` uses `u` and reads Ph, Ph No, Phone No, Mobile No, Contact, Number and the Hindi and Gujarati words; a column mostly of phone numbers is a phone column; a first digit of 0 or 1 is never Aadhaar; the domain suite shows no `phone_invalid` from masking |
| M4 | medium | **One large or failing earlier job stops the whole import purge, every hour, for every company** (`apps/web/src/workers/files/purge-imports.ts:62-120`, `0146` §1–2). The pass reads a job in one call and writes it back in one statement. `app_user` runs with `statement_timeout` and `idle_in_transaction_session_timeout` both at 30 s (`packages/db/src/migrate.ts:87-89`). On the slot (load average 7.5, with journeys running), in rolled-back transactions, for a 50,000-row, 12-column job: `app.import_job_to_check()` answered 26 MB in 0.8 s; `app.record_import_identity_check()`, writing the rows back without their Aadhaar column, was cancelled at 30 s by the statement timeout. The Node part of the pass took 8 s for the same job, all of it idle time in the transaction. `purgeImports()` catches nothing. The run answers 500 and the job stays unchecked and first in line, so the next hour fails the same way. From then on, no company's files are deleted and no rows are cleared until someone steps in. A hard kill at `maxDuration` also skips `recordJobOutcome`; only Sentry's missed check-ins would show it. *Confirmed* on the slot for the write; whether a hosted database holds such a job is not known. For comparison, `app.purge_import_rows()` cleared 100,000 rows in 4.8 s. **Fix:** page the pass (rows by `row_no` range, one job over several calls, `identity_checked_at` set on the last); catch and log a company's failure and move on to the next company; set aside a job that failed several times. | Fixed: 936a1159, 89b35646 (0147 to 0149). The pass reads 1,000 rows a call with a row cursor (`identity_checked_through`); `purgeImports()` catches per job and per company and records the failure by code (`imports.purge.record_failure`). A 50,000-row job took 50 calls of at most 151 ms; a failing job is passed by |
| L1 | low | **The upload now pays for the filter twice, the second time inside `imports.job.create`'s transaction** (`create-job.ts:90`). There its CPU time counts against the 30 s idle-in-transaction limit. Under tsx on the slot, the filter took 6 s for 50,000 × 12 cells, and 18 s for an 11.7 MB file with 20 columns. *Plausible:* on a slow or busy host, a maximum-size import is lost to "terminating connection due to idle-in-transaction timeout". **Fix:** measure it with `pnpm spike:import` on the dev deployment and record the result in `import-scale.md`. If it comes close to the limit, decide the columns first, then mask chunk by chunk between the inserts. | Fixed: 936a1159, 89b35646. The cell filter runs once, in `parseImportFile()`, before the transaction; `imports.job.create` checks only the headers (`withoutIdentityHeaders`) |
| L2 | low | **`app.record_import_identity_check()` checks a count of columns, not their names** (`0146_audit_privacy_identity_rls.sql:101-118`). *Reproduced*, rolled back: given `["Bank account","PAN","Aadhaar"]` for a job of `["Name","Mobile","Notes"]` and no rows, it set those columns and marked the job checked, while the job's row still read `Notes: "Aadhaar 2345 6789 0124"`. Only the worker principal can call it, so this is defence in depth only. Still, the migration's comment and DATABASE §4.1 say the definer "lets a job only lose columns". **Fix:** require every key of every row afterwards to be one of `p_columns`, or describe the check in the documents as a count. | Fixed: 936a1159, 89b35646. The definer checks every column name and every key of the part's rows |
| L3 | low | **`files.name` is never masked or cleared, and the file row stays after its bytes go.** An upload named `rekha_234567890124.xlsx` keeps the number in `files.name`, in `ImportJobDto.file.name`, on the job page and in the name of the reconciliation CSV. *Plausible.* **Fix:** mask the name at `files.upload.begin` for the import purpose, or replace it when the bytes are deleted. | Fixed: 936a1159, 89b35646. `files.upload.begin` masks an import file's name; the pass masks an earlier one's name (digits to X only, checked by the definer) |
| L4 | low | **File deletion can stall** (`queries/imports/import-purge.ts:50`, `purge-imports.ts:88-99`). The list is the oldest 200 kept files. A file in another bucket is skipped, and one the store refuses is only logged, so both come back at the head of the list every hour. Once there are 200 of them, no newer file is deleted. *Plausible* (it needs a bucket change or a store error that persists). **Fix:** filter by `bucket` in the query, keep the failures from blocking the rest of the list, and log the file id with the failure. | Fixed: 936a1159, 89b35646. The list is filtered by bucket and paged by a cursor; a refused file is logged by id, recorded by code and paged past |
| L5 | low | **OPS-5: the model's bytes are checked only against the registry's own metadata, and only on a cache miss** (`.github/workflows/ci.yml:110-129`, `:216-235`). A cache hit is never checked at all. **Fix:** pin the sha256 of `eng.traineddata.gz` in the workflow, and run `sha256sum -c` after extracting it or restoring it from the cache. | Fixed: 936a1159, 89b35646. The model's SHA-256 is pinned and checked with `sha256sum -c` on a cache hit and a miss |
| L6 | low | **The shared finder adds false positives to the append-only audit trail.** A list of small numbers joined by commas or slashes now reads as 4-4-4. *Confirmed:* `"qty 1000, 2000, 3000"` → `qty [number]`; `"visited 2024, 2025, 2026"` → `visited [number]`; `"ids 1001/1002/1003"` → `ids [number]`; `"rows 1-1000, 1001-2000, 2001-3000"` → `rows 1-[number], 2001-3000`. On `main`, groups were joined only by a space or a hyphen. Only readability suffers. **Fix:** accept it, or require a first digit of 2 to 9, which also settles M3's 0 and 1 case. | Fixed: 936a1159, 89b35646. A comma or semicolon and a space ends a run; a first digit of 0 or 1 is never Aadhaar; the review's lists are left alone |
| L7 | low | **Documents and copy.** SECURITY §5's "Imports made before this rule were put through it once by the hourly files sweep" states an event, true only once deployed. The import item does not say that a phone column keeps twelve digits beginning with 91 and then 6 to 9. Nor does it say that the uploaded file holds every column, Aadhaar included, for up to a week until it is deleted, although the item is headed "Aadhaar: never stored". 06-api says "for 30 seconds at most", but the budget is checked only between calls, so one call can run longer. 0146's comment says the definer "lets a job only lose columns" (see L2). `errors.import_job_purged` says "This import is finished" for a job left unfinished, while the panel says "This import was left unfinished". **Fix:** correct the wording in each place. | Fixed: 936a1159, 89b35646. SECURITY §5, 06-api and `errors.import_job_purged` corrected; 0146's comment is corrected in DATABASE and 0148's header, since an applied migration's text cannot change |
| L8 | low | **The completeness search can fail with no defect** (`packages/domain/tests/commands/import-purge.test.ts`, `hitsOf()`). It strips every non-digit from a whole value, so the digits of UUIDs, timestamps and counts run together, then looks for the first 8 digits of 4 random numbers anywhere in them. *Measured:* on the slot, 6 of 400 random 8-digit prefixes were found by chance in `audit_logs` and `outbox_events` alone. That is roughly a 6% chance per search, and the test searches twice. The file failed once here, straight after the db file, and then passed twice, including in the same order; the first output was not kept. **Fix:** join only digits that a separator people use joins (`[ .,/_:()-]{1,3}`) and search within those runs, or search for all 12 digits as well as the prefix within a run. | Fixed: 936a1159, 89b35646. The search joins only digits that a separator joins and looks for all twelve digits |

**Checked and sound**
- **Definers.**
  - The four are `security definer` with `search_path ''`, owned by `postgres`.
  - Live `has_function_privilege`: only `app_user` may execute them; `anon`, `authenticated`, `app_reader`, `readonly_reporter`, `outbox_publisher` and `auth_service` may not.
  - Each body checks `app.user_id()` and `imports.process:entity`, the company in `app.entity_ids()`, and its ranges.
  - Reproduced: with no settings, and with `imports.write` only, the refusal is "imports.process is required"; for company 2 in a request for `{1}`, "outside the request".
  - `imports.process` is in `app.platform_only_permissions()` and held by no person's role.
- **Grants.**
  - Live `column_privileges`: `app_user` has no UPDATE on `import_rows.raw_json`, on `import_jobs.left_out_columns`, `masked_values`, `purged_at` or `identity_checked_at`, or on `files.deleted_at`.
  - A direct update as a GM, and as the workers, is refused.
  - `app_reader` holds nothing on `files`, `import_jobs` or `import_rows`.
- **Races and idempotency.**
  - The purge takes jobs `for update skip locked` with `state <> 'committing'`, which Postgres checks again on the locked row.
  - Map, preview and commit load the job `for update` before `assertNotPurged`, so a commit that waits behind the purge's lock sees `purged_at`.
  - `commit_batch` runs only on `committing`, which the purge never takes.
  - Rollback reads only `state` and `created_id`, so it still works after the purge.
  - Two overlapping sweeps take different jobs.
  - Recording a deletion checks `deleted_at is null` again under the row lock.
  - A second call of each command changes nothing (tests).
- **Deleting before recording.**
  - When recording fails, the file reads "kept" with no bytes; the next run deletes again (a key with no versions returns at once) and records it.
  - `delete()` removes every version and delete marker; the IAM role has `s3:DeleteObjectVersion` and `s3:ListBucketVersions`, and older versions expire after a day anyway.
  - Keys are per file id (`<company>/import/<id>.<ext>`), so no object is shared between files.
  - `import_jobs_file_unique` allows one job per file, so a file whose job ended is never needed again.
  - `openFile`, `startImport` and `imports.job.create` refuse a file with `deleted_at` set.
- **Reconciliation.** No reconciliation query reads `raw_json` or `normalised_json`, and the domain and web tests assert it is equal before and after the purge and the pass.
- **Where else a number could persist.**
  - `errors_json` holds a field and a code only (`ImportRowErrorDto`); `dedupe_json` holds ids.
  - The audit rows and `retention_runs` record counts; the new commands emit no event; the worker logs counts.
  - The reader pool has no access to these tables.
  - Sentry and the logs go through `redactText()`, so they are as good as M2 and H1 allow.
  - The completeness search in `import-purge.test.ts` covers every text, JSON and array column of `public`, partitioned parents included.
- **Redefinitions.** 0143–0146 redefine no existing function, check constraint or foreign key; `origin/main` is still the merge base, 150778f3.
- **OPS-5.**
  - `tesseract.js` 7.0.0 is a direct dependency of `web`, and the key includes its version.
  - `npm pack` runs no lifecycle scripts.
  - The model is the one `tesseract.js` itself loads by default (`4.0.0_best_int`).
  - `OCR_LANG_PATH` is listed for `web#test` and `test:security`.
  - `actions/cache` is pinned by SHA (v4.2.3, confirmed by the lead).
  - A pull request's cache cannot reach `main`'s scope.
- **Commands and screen.**
  - The three commands are registered, permission `imports.process` at entity scope, `auditWhen: 'changed'`, with denied, wrong-company and happy-path tests.
  - `peopleOnly` is rightly absent, since the worker calls them.
  - The agents' refusal sweep needs no inputs for them: no agent holds `imports.process`.
  - The copy is in `en.json`, and `uploadAgain` is listed in copy-lint.
  - The journey asserts the notes and runs axe.
- **Suites run here through the lock.**
  - `packages/db` `import-purge.test.ts`: 15 of 15 passed, twice.
  - `packages/domain` `import-purge.test.ts`: 11 of 11 passed twice, after one failed run (L8).

**Not checked**
- The screenshots: `imports-identity-left-out` has no baseline on the branch, and the builder left no image, so the layout of the new section is unseen.
- A fresh-database migration run.
- The pass's timing against a hosted database.
- The whole suites; only the two targeted files ran.

### Second review, 14-10-2026 (cloud, slot 6)
Of the fix round, `fix/audit-privacy` at be16598e against `origin/main` 150778f3 (#172), Opus 5.5. **No finding blocks the merge.** M5 and M7 are one-line fixes, so they go in now. M6 is a few lines; it should go in before the deploy, because the one-off pass runs once and the cells it masks cannot be restored. The lows are follow-ups. The probes ran `parseImportFile()`, `withoutIdentityNumbers()`, `maskIdentityValue()`, `redactText()`, `redact()` and `maskForModel()` from the worktree under `tsx`. The SQL ran as `app_user` with the workers' settings on the slot's Postgres (54336), inside rolled-back transactions.

| # | Severity | Finding | State |
|---|---|---|---|
| M5 | medium | **A header cut to 75 characters keeps up to 11 digits of an Aadhaar number** (`packages/domain/src/imports/parse.ts:394`, the cut at `:344`). `parseImportFile()` cuts every header to 75 characters (`maxHeaderLength - 5`) before `withoutIdentityNumbers()` reads it. A number that crosses the cut is then no longer twelve digits, so the column is kept under its cut name. *Confirmed* under tsx: a headerless CSV whose first row is `Rekha Devi,Rampur,"Ward 5, behind the old post office, near the Hanuman temp UID 2345 6789 0124"` answers the column `"Ward 5, behind the old post office, near the Hanuman temp UID 2345 6789 012"`, with `leftOutColumns: []` and `maskedValues: 0`. The twelfth digit is the Verhoeff check digit, so the whole number can be worked out from the eleven kept. **Scenario:** a subsidy list exported without a header row, whose first person's address ends with their UID. The cut name goes into `import_jobs.columns_json`, which neither the purge nor M1's anonymiser clears. It also becomes every row's `raw_json` key and reaches the mapping screen and `ImportJobDto`. The one-off pass reads the stored names, which were cut the same way. **Fix (one line):** mask before the cut, `uniqueColumns(header.cells.map(maskIdentityText), …)`, or decide `leftOut` on the uncut header. Add the case to `parse.test.ts`. | Fixed: fdd34f53. `parseImportFile()` masks each header before it is cut; `parse.test.ts` has a headerless file whose number starts at character 63 and crosses the cut |
| M6 | medium | **The `+` rule reads valid landlines and foreign numbers as Aadhaar numbers, in every column and in the one-off pass** (`packages/domain/src/privacy/number-shapes.ts:303`, `:324`; introduced by the H1 fix). A `+` run is a phone only when it is +91 and a mobile number. Two kinds of number hold twelve digits starting 2 to 9 and are masked, even under a "Mobile" header (`alsoPhone` is false after a `+`): +91 with a landline whose code starts 1 to 5 (most Rajasthan and Gujarat codes, such as Jaipur's 141, Jodhpur's 291 and Surat's 261: `+91 141 2345678`, `+91 22 2345 6789`), and twelve-digit numbers of other countries (`+971 50 123 4567`, `+966 55 123 4567`, `+44 7911 123456`, `+44 20 7946 0958`). `normaliseIndianPhone()` accepts every one of them. *Confirmed* under tsx: a `Name,Mobile` file of `+91 141 2345678`, `+91 98765 43210` and `+971 50 123 4567` loses the whole Mobile column (`leftOutColumns: ["Mobile"]`), and the importer is told it held Aadhaar numbers. With one landline among mobiles, that cell becomes `+XX XXX XXX5678`, which the check refuses (`phone_invalid`). `maskIdentityValue({ contact: { phone: '+911412345678' } })` gives `+XXXXXXXX5678`. So the pass breaks the stored E.164 phone of each such row of an earlier job, and `commitLeadBatch` then refuses the row (`CreateLeadInput.safeParse`). In the logs such a phone becomes `[number]`, which is harmless. **Fix:** read a `+` run as a phone when it is +91 and ten digits starting 1 to 9, or a country code of one to three digits followed by a separator; nobody writes an Aadhaar number like that. In a phone column or under a phone key, read any `+` run as the phone. Add these inputs to the shared table. | Fixed: fdd34f53. A `+` run is a phone when it is +91 and ten digits starting 1 to 9, or eight to fifteen digits written as one run or after a country code of one to three digits (`plusPhone`); the four phones, more, and the H1 cases are tested, and the pass leaves E.164 phones in `normalised_json` alone |
| M7 | medium | **`"2345, 6789, 0124"` is kept whole by the import, the logs and the audit trail, and masked by the model masker** (`number-shapes.ts:358`; introduced by the L6 fix). `NUMBER_RUN` ends a run at a comma or semicolon followed by a space, whatever the numbers; `maskForModel()`'s `DIGIT_RUN` (`:224`) does not. *Confirmed:* `withoutIdentityNumbers()` keeps the cell, and keeps a whole column of such cells. `redactText()` and `redact({ notes })` return it unchanged, while `maskForModel()` gives `[number]`. Through `parseImportFile()`, a CSV cell `"2345, 6789, 0124"` is stored as written. SEC-3 asks that the scrubber catch every shape the model masker does. SECURITY §5 says only "a list of small numbers" is passed over. **Fix (one line):** drop `(?![,;] )`. "visited 2024, 2025, 2026" and the L6 range list are then masked, as "2024 2025 2026" already is (privacy wins, as decided), and the L6 test changes with them; "qty 1000, 2000, 3000" stays, since a first digit of 1 is never Aadhaar. A narrower option is to join across a comma and a space only when the groups make exactly 4-4-4. Add the input to the shared table for all three consumers. | Fixed: fdd34f53. `(?![,;] )` is gone: one run rule (`DIGIT_RUN`) for the import, `redactText`, the audit scrubber and `maskForModel`, tested across all four |
| L9 | low | **Separators and invisible characters the finder still misses, in all three consumers** (`number-shapes.ts:48`, `:145`, `:361`; `identity-columns.ts:114`). *Confirmed* under tsx. Twelve digits pass the import, `redactText()` and `maskForModel()` whole when split by `"`, `\|`, `*`, `#`, `~`, `+`, `=`, `·`, `•` or `\`. They also pass when split by an invisible character that is not a format character: U+034F, the variation selectors U+FE00 to U+FE0F, the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, or U+2800. Superscript and subscript digits are a second gap. `normalise()` reads them as digits, but the `ANY_DIGIT` shortcut (`\p{Nd}`) finds no number in a text made only of them, which `maskForModel()` masks, so the two drift. And `lastFourOnly()` counts only `\p{Nd}`, so `"card 2345 6789 01²⁴"` is stored as `"card XXXX XX89 01²⁴"`: six digits kept, while the cell is counted as hidden. All of these are unusual in a spreadsheet. **Fix:** drop `\p{Default_Ignorable_Code_Point}` and U+2800 in `INVISIBLE`; make `ANY_DIGIT` `[\p{Nd}\p{No}]`; count digits in `lastFourOnly()` as `normalise()` reads them. | Fixed: fdd34f53. `SEP` takes the ten separators; `INVISIBLE` takes every default-ignorable character and U+2800; `ANY_DIGIT` takes superscripts; `lastFourOnly()` counts a superscript digit |
| L10 | low | **"Any grouping" masks everyday numbers next to a mobile** (`number-shapes.ts:279-287`). *Confirmed:* in the import, `"House 45 9876543210"`, `"Ward 23 9876543210"`, `"Plot 32 98765 43210"` and `"call at 10:30 98765 43210"` become `"House XX XXXXXX3210"` and the like, each counted as a hidden number; in the logs they become `[number]`. The same happens to two PINs in a cell (`"302001 302002"`), to a landline and a mobile together (`"0141 2345678 / 98765 43210"`; a "Phone" column of these is left out), and to document numbers such as `INV-2026-27-000123` and `SO/2026/10/000123`. A mobile number written in a village or notes cell is lost. This follows from "privacy wins". No field a lead needs is mapped from such cells today, except a phone column of landline-and-mobile cells, which `normaliseIndianPhone()` refuses anyway. **Fix:** accept it and say so in SECURITY §5, or read a run whose last group is a whole mobile number after one short group as that number and the group. | Stays: masking a group next to a number is "privacy wins", and reading the last group as a mobile would mask a real Aadhaar number written after one short group less. SECURITY §5 now says that a house, ward or plot number or a time before a mobile is masked with it |
| L11 | low | **An "Aadhaar linked mobile" column is left out; this predates the fix round** (`identity-columns.ts:29-39`, unchanged since f445ff0b). `namesAadhaar()` matches "adhar" anywhere in a header, so "Aadhaar linked mobile", "Mobile (Aadhaar linked)" and "Aadhaar seeded" each leave a column out; the first two are columns of phones, and PM-KUSUM forms ask for the Aadhaar-linked mobile. In a headerless file, a first person named "Radharani Devi" or a village "Madhari" leaves that column out too. *Confirmed* under tsx. The importer is told which column went, so they can rename it. **Fix:** keep a header that also names a phone or mobile, and match the Aadhaar words only at the start of a word. | Fixed: fdd34f53. `namesAadhaar()` matches its words only at the start of a word, and never for a header that also names a phone or mobile |
| L12 | low | **The pass's write still takes the worker's word for what it records** (`packages/db/migrations/0149_audit_privacy_review_rows.sql:42-117`, and `0148` §3). *Reproduced* as `app_user` with the workers' settings, rolled back. `p_left_out = {"UID 2345 6789 0124"}` is stored in `left_out_columns` as given. A column dropped from `p_columns` with no name in `p_left_out` is accepted, so the job page would not say it went. `p_through = 999999` with `p_done` and no rows marks a job checked without its other parts being read. `app.record_import_purge_failure()` stores `'2345 6789 0124'` as a code (`^[a-z0-9 _.:-]{1,120}$`), where DATABASE §4.1 says "never a value". The pass also never rewrites `mapping_json`, so an earlier headerless job that was mapped keeps a left-out column's unmasked name there (*plausible*). Only the worker principal can call these, so this is defence in depth, as L2 was. **Fix:** require each `p_left_out` name to be a dropped column with only digits turned to X (the file-name check), and as many names as columns dropped. Refuse a `p_through` past the part's last row. Take a code of `^([0-9a-z]{5}\|[a-z_]{1,40})$`. Drop or mask a left-out column in `mapping_json`. | Fixed: fdd34f53 (0149). Left-out names must be the dropped columns' with only digits turned to X, one for each, never twelve digits; the cursor moves at most 2,000 rows and `done` needs no row past it; the failure code is `^([0-9a-z]{5}|[a-z_]{1,40})$`; the pass masks `mapping_json` (checked digits-to-X only) |
| L13 | low | **`imports.job.create` now trusts its caller's cells and counts** (`packages/domain/src/commands/imports/create-job.ts:89-119`). It stores the rows, `leftOutColumns` and `maskedValues` it is given and sets `identity_checked_at`, so the one-off pass never reads the job. Its only caller, `startImport`, parses the stored file on the server, so nothing gets past it today. But the rule now lives in one web action rather than in the command, and a later caller (an `/api/v1` import or an agent) would store a whole Aadhaar number. The design's Built record still says `withoutIdentityNumbers()` is applied "again by `imports.job.create`". **Fix:** in the command, mask only the cells that hold twelve digits or more, which is cheap behind a digit count; or take the parsed file as a type only `parseImportFile()` makes. Correct the Built record either way. | Fixed: fdd34f53. `imports.job.create` masks any cell of twelve digits or more and leaves the job unchecked, so the pass reads it; the Built record is corrected |
| L14 | low | **The file pages' cursor has millisecond precision, while `files.created_at` holds microseconds** (`apps/web/src/workers/files/purge-imports.ts:196-198`, `packages/domain/src/queries/imports/import-purge.ts:55-60`). The cursor is `createdAt.toISOString()`, so a page's last file comes back on the next page if it is still kept. *Reproduced* in SQL: a file created at `04:22:19.882020` is matched by `created_at >` the cursor `04:22:19.882000`. A refused file at a page boundary is therefore tried and recorded twice a run. With 200 or more refused files created in one millisecond (a bulk-created set), the same page would be read until the budget runs out, writing 200 failure rows each time. Separately, while the store is down, every kept file writes a failure row every hour. **Fix:** carry the cursor at full precision (as Postgres's text), or page by `id`; stop a company's file part after a few store failures in a row. | Fixed: fdd34f53. The file pages are ordered and resumed by id (UUIDv7, exact); three store refusals in a row leave a company's files for the next hour |
| L15 | low | **The file-name check depends on the database's locale provider** (`0149:100`). `~ '[[:digit:]]'` matches Devanagari and full-width digits under ICU, which is what this slot uses (`datlocprovider = i`); there, a Devanagari name masked to X is accepted (*reproduced*). Under a libc locale it matches only 0 to 9. On such a database, an earlier job whose file name holds an Aadhaar number in those digits fails the pass every hour and is never checked; it writes a failure row each hour until the rows purge clears it. The hosted projects' provider was not checked. *Plausible.* **Fix:** accept X for the digit ranges `maskIdentityText()` masks (Devanagari, Gujarati, full-width and the rest), named explicitly in the definer. | Fixed: fdd34f53 (0149). `app.only_digits_masked()` and `app.digit_count()` name the digit ranges (ASCII, Arabic-Indic, the Indian scripts, full-width) |
| L16 | low | **Documents.** SECURITY §5 has five sentences the code does not match: "a list of small numbers separated by a comma and a space is not read as one number" (any numbers are, M7); "or an invisible character between" (only format characters and no-break spaces, L9); "so the two cannot drift apart" (M7, L9); the import item does not say that a `+` number other than +91 and a mobile is masked (M6); and its "by a name that keeps only the last four digits" fails at the 75-character cut (M5). The model masker's paragraph and step 1 of `model-text.ts`'s header still say format characters read as a space, while `normalise()` now drops them. The design's Built record says `imports.job.create` applies `withoutIdentityNumbers()` again (L13) and counts four definers where there are five. DATABASE §4.1 says "never a value" (L12). **Fix:** correct each sentence along with the code fixes. | Fixed: fdd34f53. SECURITY §5, the model masker's paragraph, `model-text.ts`'s header, the Built record and DATABASE §4.1 say what the code does |

**Checked and sound**
- **The H1, M1 and M2 inputs.** Each is masked whole by all three consumers (the review table, run again), and `maskedValues` counts only real removals.
  - A date, plot or PIN joined to a number is masked with it.
  - `"DOB 12/05/1985, 2345 6789 0124"` keeps the date and masks the number.
  - `"(+91) 234567890124"`, `"+ 2345 6789 0124"` and `"+91-234567890124"` are masked.
- **Separators and scripts.** All three consumers mask twelve digits written with any of these:
  - dots, slashes, underscores, colons, brackets, hyphens with spaces, or tabs;
  - CR LF inside a quoted CSV cell;
  - the format characters (ZWSP, ZWJ, ZWNJ, LRM, RLM, U+2060, U+2063, the soft hyphen, U+180E) and no-break spaces;
  - Devanagari, Gujarati and full-width digits;
  - digits touching letters.
- **XLSX and CSV.** In a workbook made with ExcelJS, the columns are left out whatever form the number takes:
  - a number cell formatted `0.00E+00` (read as its value, 234567890124);
  - rich text split across runs;
  - a formula's cached result;
  - a hyperlink's text.

  The text "2.34568E+11" holds only six digits. `2.34567890124e+11`, `234567890124.0` and `="234567890124"` are masked.
- **Left alone, as they should be.** GSTIN, IFSC, `ASH/Q/2026-27/0001` and `SS/2026-27/000123`; amounts with lakh and western commas; dates, timestamps and date ranges; HP lists; latitude and longitude; two mobiles in one cell; +1 numbers; a mobile after a PIN.
- **M3.**
  - `namesPhone()` uses the `u` flag and matches Ph, Ph No, Mobile No, Contact, Number, and the Hindi and Gujarati words.
  - A column is a phone column when most of its cells are phones.
  - Outside a phone column, 91 and a mobile number is masked only when its Verhoeff check digit holds.
  - A 4-4-4 grouping is always masked.
  - An Aadhaar number starting 916 to 919, written ungrouped in a phone column, is kept, as SECURITY §5 says.
- **The definers of 0148 and 0149.**
  - Each is `security definer` with `search_path ''`, owned by `postgres`.
  - Live `has_function_privilege`: execute for `app_user` only; `anon`, `authenticated`, `service_role`, `authenticator`, `app_reader`, `readonly_reporter`, `outbox_publisher` and `auth_service` are refused.
  - Each body checks the permission, the company and its ranges.
  - The job is held `for update` (`skip locked` on the read), and one command reads and writes in one transaction.
  - Refused: rows outside the part, another job's rows, names the job lacks, keys left behind, and any change to the file name other than a digit turned to X.
  - `app_user` has no UPDATE on `identity_checked_through`, `columns_json`, `left_out_columns` or `files.name`.
- **Races and idempotency.**
  - The job row lock makes the pass take turns with map, preview, commit, rollback and the purge.
  - A committing job is skipped by the query and by both definers.
  - A second run skips a job another run holds.
  - A call that committed but whose answer was lost is not done again, since the cursor has moved on.
  - Between parts the lock is released, so a person could start adding a large earlier job partway through the pass. Its unchecked rows would be added as they are, as they would have been before the pass reached the job; the window is one sweep run.
- **`purgeImports()`.**
  - A failed job is passed by for the run and recorded by its code.
  - A company part that fails is caught, and the next company runs.
  - A refused file is logged by its id, recorded and paged past.
  - `failureCode()` answers only a domain code or an SQLSTATE.
  - A failure that cannot be recorded is logged and goes no further.
- **L5.**
  - The pinned SHA-256 is checked after a cache restore and after the registry download, before `pnpm test` and `pnpm test:security`, in both jobs.
  - A failed check fails the job before the cache is saved.
  - The hash matches the model file kept in the session's scratch folder.
- **Migrations.**
  - The merge base is still `origin/main` 150778f3, whose last migration is 0142.
  - 0143 to 0149 define the five import definers (new on this branch), one check constraint and three indexes; `main` defines none of them.
  - The journal times follow 0142's.
- **EXPLAIN (ANALYZE), slot 6, as the workers.**
  - The paged file list with its cursor: bitmap scans on `files_import_kept_idx`, 2.5 ms.
  - The next job to check: Index Scan using `import_jobs_identity_unchecked_idx`, 0.09 ms.
- **Suites, through the lock, on 54336.**
  - Domain unit tests (`number-shapes`, `identity-columns`, `model-text`, `ports`): 6 files, 245 passed.
  - `packages/db` `import-purge.test.ts`: 16 of 16 passed.
  - `packages/domain` `import-purge.test.ts`: 15 of 15 passed.
  - `apps/web` `imports.test.ts`: 36 of 36 passed.

**Not checked**
- The hosted databases' locale provider (L15).
- The whole suites, the journeys and the screenshots; only the targeted files ran.
- Where the model file came from, beyond its hash: the session has no network.
- A fresh-database migration run.


### Fix round two, 14-10-2026 (cloud, slot 6)
All three mediums and seven of the eight lows are fixed in fdd34f53; L10 stays, as decided below. 0149, applied nowhere but the slot, carries every migration change. On the slot, its record in `drizzle.__drizzle_migrations` was removed and the migrator applied the new text. `pnpm db:docs` made no change, since no column changed.

**Fixed:**
- **M5.** Each header is masked before `uniqueColumns()` cuts it to its length (`parse.ts`).
- **M6.** A `+` run is a phone number (`plusPhone`), never masked, when it is either:
  - +91 and ten digits starting 1 to 9 (a mobile, or a landline with its code), in any grouping; or
  - eight to fifteen digits written as one run (stored E.164) or after a country code of one to three digits.

  Any other `+` run is tried as an Aadhaar number, so the H1 cases stay masked: `+2345-6789-0124`, `+ 2345 6789 0124` and `+91-234567890124`.
- **M7.** One run rule for all four consumers (`DIGIT_RUN`). "2345, 6789, 0124" is masked everywhere. So are a list such as "visited 2024, 2025, 2026" and a phone written after an Aadhaar number with a comma; numbers starting 0 or 1 still are not.
- **L9.**
  - Ten more separators join a run: `"` `|` `*` `#` `~` `+` `=` `·` `•` `\`.
  - Every default-ignorable character, and U+2800, is dropped before reading.
  - A text of superscript digits is read as a number.
  - `lastFourOnly()` counts superscript and subscript digits.
- **L11.** The Aadhaar words count only at the start of a word, and never in a header that also names a phone or mobile. "Aadhaar linked mobile", "Radharani" and "Madhari" are now kept; "Aadhaar seeded" is still left out.
- **L12** (0149):
  - The left-out names are exactly the dropped columns', with only digits turned to X, and none holds twelve digits.
  - The cursor moves at most 2,000 rows, and `done` needs no row past it.
  - A failure code is an SQLSTATE or a domain code only, both in the contract and in the definer.
  - The pass masks a job's saved mapping, and the definer accepts only digits turned to X.
- **L13.** `imports.job.create` masks any cell of twelve digits or more, behind a cheap digit count, and leaves every new job unchecked, so the hourly pass reads it as it reads an earlier one.
- **L14.** The files are paged by id, which is UUIDv7 and so follows the upload. After three refusals in a row, a company's files wait for the next hour.
- **L15.** The "digits turned to X" checks (`app.only_digits_masked()`, `app.digit_count()`) name the ranges they accept: ASCII, Arabic-Indic, the Indian scripts and full-width.
- **L16.** SECURITY §5's import item, scrubber sentence and model masker's paragraph; `model-text.ts`'s header and step 4; `redactText()`'s comment; the Built record (the five definers, and what `imports.job.create` does); DATABASE §4.1 (the code check, the new checks and the mapping).

**Stays: L10.** Masking a whole run, a house, ward or plot number or a time before a mobile included, is the "privacy wins" rule of H1. The review's alternative would read the run's last group as a mobile number and the short group before it as its own. But that would also read an Aadhaar number written as a short group and ten digits ("23 4567890124") as a mobile number, masking a real Aadhaar number less, which the lead's condition rules out. SECURITY §5 now says so.

**Tests:**
- `number-shapes.test.ts`: 99 → 120. M7 and L9 run across all four consumers (the import, `redactText`, the audit scrubber, `maskForModel`): a comma-separated number, ten separators, seven invisible characters and superscripts. Also the superscript count, ten phones after a `+` (the review's four among them) with the H1 `+` cases, and the updated joined-run expectations.
- `identity-columns.test.ts`: 9 → 11 (L11; a Mobile column of `+` phones kept, and E.164 phones in `maskIdentityValue`).
- `parse.test.ts`: +1 (M5).
- `import-purge.test.ts` (db): 16 tests, with new refusals for L12: a dropped column without its name, a name not of a dropped column, a name holding twelve digits, `done` with rows past the cursor, and a code that is a number.
- `import-purge.test.ts` (domain): 15 → 16. An earlier job's E.164 phones in `normalised_json` are left alone, and its saved mapping and left-out name are masked (M6, L12).

**Checks, through the lock, on 54336 and 3036:**
- `pnpm exec prettier --check .`: clean. `pnpm db:docs` and `machines:docs`: no change. `copy-lint`: clean. `pnpm typecheck`: passed.
- `turbo run test --force`, with `OCR_LANG_PATH`: tokens 146, copy-lint 17, ui 107, contracts 182, db 134, domain 2210, web 841; all passed.
- `pnpm test:security`, with `OCR_LANG_PATH`: db 44 files, 1249 tests; domain 76 files, 966 tests; web 25 files, 326 tests; all passed.
- `pnpm build`: passed. `js-budget`: every page within its budget (46 pages).
- `e2e:seed`, then `playwright test e2e/imports.spec.ts --ignore-snapshots`: 29 passed.
- `pnpm lint`, the whole repository, last: clean.

## Integration notes
