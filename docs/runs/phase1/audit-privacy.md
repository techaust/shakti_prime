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
14-10-2026, cloud, of `fix/audit-privacy` at f445ff0b against `origin/main` 150778f3 (#172), Opus 5.5. **H1 blocks the merge.** M1 is a one-line fix, so it goes in with H1. The other mediums and lows are follow-ups unless the lead takes them now. The probes ran `withoutIdentityNumbers()`, `parseImportFile()`, `redactText()` and `maskForModel()` from the worktree under `tsx`. The SQL ran as `app_user` on the slot's Postgres (54336), inside rolled-back transactions.

| # | Severity | Finding | State |
|---|---|---|---|
| H1 | high | **The import can keep a whole Aadhaar number, or 8 of its 12 digits, while it counts the cell as hidden** (`packages/domain/src/privacy/number-shapes.ts:264-298`, used by `imports/identity-columns.ts:47` and `:78`). *Confirmed* under tsx. There are two causes. (a) Aadhaar windows are taken greedily from the left (`for (const size of [3, 2, 1])`), so a 4- or 8-digit group joined before the number takes the mask, and the number's own groups are left: `"DOB 12.05.1985, 2345 6789 0124"` → `"DOB 12.05.XXXX, XXXX 6789 0124"` (8 digits of the number kept, and the year of birth destroyed); `"12051985 2345 6789 0124"` → `"XXXXXXXX 2345 6789 0124"` (all 12 kept); `"Plot 1234, 2345 6789 0124"` → `"Plot XXXX, XXXX 6789 0124"`. Each answers `maskedValues: 1`, so the page tells the importer the number was hidden. `redactText()` keeps 8 digits in the 8-digit case (`"[number] 6789 0124"`). (b) A run that starts with `+` is never tried as an Aadhaar number (`:270`). It is read as an international phone, which the import keeps whole: `"Aadhaar +2345-6789-0124"` and `"Ram + 2345 6789 0124"` are stored unchanged (`maskedValues: 0`), and a column of them is not left out. **Scenario:** a subsidy list has a Remarks column that reads "DOB 12.05.1985, 2345 6789 0124". `import_rows.raw_json` and `normalised_json` keep 8 of the 12 digits for 30 days, and a lead field mapped from that column keeps them for good. That fails the brief's "no Aadhaar-shaped value … anywhere in the database". **Fix:** in `masked()` and `maskIdentityValue()`, when a run holds an Aadhaar window, keep only the last four digits of the whole run (as `maskForModel()` masks the whole run). In `numbersOfRun`, try a `+` run for an Aadhaar window too, unless it is `+91` and a mobile. Add these inputs to `identity-columns.test.ts` and `number-shapes.test.ts`. | open |
| M1 | medium | **A column the import leaves out keeps its header text unmasked, for good** (`identity-columns.ts:128`, `commands/imports/create-job.ts:96`, `commands/imports/mask-identity.ts:76`). The kept headers are masked, but `leftOutColumns` is the file's own text. *Confirmed:* `withoutIdentityNumbers(['Name', 'UID 2345 6789 0124'], …)` answers `leftOutColumns: ['UID 2345 6789 0124']`. A headerless CSV whose rows read `Rekha Devi,Rampur,UID 2345 6789 0124` passes header detection (every cell has a letter). `parseImportFile()` then takes that first person's row as the header and answers `leftOutColumns: ['UID 2345 6789 0124']`. The name goes into `import_jobs.left_out_columns`, which neither the purge nor M1's anonymiser clears. It is also sent to the browser in `ImportJobDto` and printed under "What this import does not keep". Live, `app.record_import_identity_check()` stored `{"UID 2345 6789 0124"}` when given that name (rolled back). **Fix**, one line in each of the two places: record the name through `masked()`, and add a test with a header that holds a number. | open |
| M2 | medium | **SEC-3 is not fully met: other groupings and invisible characters pass the scrubber and the import** (`number-shapes.ts:248`). `AADHAAR_GROUPINGS` accepts only 12, 4-8, 8-4 and 4-4-4. *Confirmed:* these pass `withoutIdentityNumbers()` whole, in a cell or as a whole column (which is kept), and they pass `redactText()`: `"234 567 890 124"`, `"234567 890124"`, `"23 45 67 89 01 24"`, `"2345 6789 01 24"`, and `"234567‎890124"`. The last has one left-to-right mark, which a spreadsheet shows as a plain run of twelve digits; any format character reads as a space. `maskForModel()` masks every one. The brief's item 2 asks that `redactText()` catch every shape `maskForModel()` does, and item 1 asks for "twelve digits in any script or separator". The OCR masker already accepts any join (`privacy/identity-numbers.ts`, `AADHAAR_PATTERN`). **Fix:** read twelve digits in one run as an Aadhaar shape whatever their grouping (a first digit of 2 to 9 keeps the false positives down), and add these inputs to the shared table. | open |
| M3 | medium | **The import corrupts phone numbers in a column it does not recognise as a phone column** (`identity-columns.ts:38-39`). `namesPhone()` strips `\W` without the `u` flag, so a Hindi or Gujarati header (`मोबाइल नंबर`) is reduced to nothing. "Ph No", "Ph. No.", "Number" and "Cust No" match nothing either. In such a column, a mobile number written as 91 and ten digits counts as Aadhaar whenever its check digit happens to hold, about one in ten. *Confirmed:* under each of those headers, 98 of 1,000 such mobile numbers were masked to `XXXXXXXX9190`; under "Mobile", none were. A masked phone fails `CreateLeadInput` (`imports/leads.ts:131`, `phone_invalid`), so about one row in ten of such a list is refused at the check (*plausible* end to end). Separately, twelve digits beginning with 0 or 1, which is never an Aadhaar number, are treated as one (an "Invoice No" column of `202610140001` is left out). **Fix:** also decide a phone column by its values (most filled cells are 91 and a mobile number), match headers in Indian scripts and "ph"/"no", and require a first digit of 2 to 9. | open |
| M4 | medium | **One large or failing earlier job stops the whole import purge, every hour, for every company** (`apps/web/src/workers/files/purge-imports.ts:62-120`, `0146` §1–2). The pass reads a job in one call and writes it back in one statement. `app_user` runs with `statement_timeout` and `idle_in_transaction_session_timeout` both at 30 s (`packages/db/src/migrate.ts:87-89`). On the slot (load average 7.5, with journeys running), in rolled-back transactions, for a 50,000-row, 12-column job: `app.import_job_to_check()` answered 26 MB in 0.8 s; `app.record_import_identity_check()`, writing the rows back without their Aadhaar column, was cancelled at 30 s by the statement timeout. The Node part of the pass took 8 s for the same job, all of it idle time in the transaction. `purgeImports()` catches nothing. The run answers 500 and the job stays unchecked and first in line, so the next hour fails the same way. From then on, no company's files are deleted and no rows are cleared until someone steps in. A hard kill at `maxDuration` also skips `recordJobOutcome`; only Sentry's missed check-ins would show it. *Confirmed* on the slot for the write; whether a hosted database holds such a job is not known. For comparison, `app.purge_import_rows()` cleared 100,000 rows in 4.8 s. **Fix:** page the pass (rows by `row_no` range, one job over several calls, `identity_checked_at` set on the last); catch and log a company's failure and move on to the next company; set aside a job that failed several times. | open |
| L1 | low | **The upload now pays for the filter twice, the second time inside `imports.job.create`'s transaction** (`create-job.ts:90`). There its CPU time counts against the 30 s idle-in-transaction limit. Under tsx on the slot, the filter took 6 s for 50,000 × 12 cells, and 18 s for an 11.7 MB file with 20 columns. *Plausible:* on a slow or busy host, a maximum-size import is lost to "terminating connection due to idle-in-transaction timeout". **Fix:** measure it with `pnpm spike:import` on the dev deployment and record the result in `import-scale.md`. If it comes close to the limit, decide the columns first, then mask chunk by chunk between the inserts. | open |
| L2 | low | **`app.record_import_identity_check()` checks a count of columns, not their names** (`0146_audit_privacy_identity_rls.sql:101-118`). *Reproduced*, rolled back: given `["Bank account","PAN","Aadhaar"]` for a job of `["Name","Mobile","Notes"]` and no rows, it set those columns and marked the job checked, while the job's row still read `Notes: "Aadhaar 2345 6789 0124"`. Only the worker principal can call it, so this is defence in depth only. Still, the migration's comment and DATABASE §4.1 say the definer "lets a job only lose columns". **Fix:** require every key of every row afterwards to be one of `p_columns`, or describe the check in the documents as a count. | open |
| L3 | low | **`files.name` is never masked or cleared, and the file row stays after its bytes go.** An upload named `rekha_234567890124.xlsx` keeps the number in `files.name`, in `ImportJobDto.file.name`, on the job page and in the name of the reconciliation CSV. *Plausible.* **Fix:** mask the name at `files.upload.begin` for the import purpose, or replace it when the bytes are deleted. | open |
| L4 | low | **File deletion can stall** (`queries/imports/import-purge.ts:50`, `purge-imports.ts:88-99`). The list is the oldest 200 kept files. A file in another bucket is skipped, and one the store refuses is only logged, so both come back at the head of the list every hour. Once there are 200 of them, no newer file is deleted. *Plausible* (it needs a bucket change or a store error that persists). **Fix:** filter by `bucket` in the query, keep the failures from blocking the rest of the list, and log the file id with the failure. | open |
| L5 | low | **OPS-5: the model's bytes are checked only against the registry's own metadata, and only on a cache miss** (`.github/workflows/ci.yml:110-129`, `:216-235`). A cache hit is never checked at all. **Fix:** pin the sha256 of `eng.traineddata.gz` in the workflow, and run `sha256sum -c` after extracting it or restoring it from the cache. | open |
| L6 | low | **The shared finder adds false positives to the append-only audit trail.** A list of small numbers joined by commas or slashes now reads as 4-4-4. *Confirmed:* `"qty 1000, 2000, 3000"` → `qty [number]`; `"visited 2024, 2025, 2026"` → `visited [number]`; `"ids 1001/1002/1003"` → `ids [number]`; `"rows 1-1000, 1001-2000, 2001-3000"` → `rows 1-[number], 2001-3000`. On `main`, groups were joined only by a space or a hyphen. Only readability suffers. **Fix:** accept it, or require a first digit of 2 to 9, which also settles M3's 0 and 1 case. | open |
| L7 | low | **Documents and copy.** SECURITY §5's "Imports made before this rule were put through it once by the hourly files sweep" states an event, true only once deployed. The import item does not say that a phone column keeps twelve digits beginning with 91 and then 6 to 9. Nor does it say that the uploaded file holds every column, Aadhaar included, for up to a week until it is deleted, although the item is headed "Aadhaar: never stored". 06-api says "for 30 seconds at most", but the budget is checked only between calls, so one call can run longer. 0146's comment says the definer "lets a job only lose columns" (see L2). `errors.import_job_purged` says "This import is finished" for a job left unfinished, while the panel says "This import was left unfinished". **Fix:** correct the wording in each place. | open |
| L8 | low | **The completeness search can fail with no defect** (`packages/domain/tests/commands/import-purge.test.ts`, `hitsOf()`). It strips every non-digit from a whole value, so the digits of UUIDs, timestamps and counts run together, then looks for the first 8 digits of 4 random numbers anywhere in them. *Measured:* on the slot, 6 of 400 random 8-digit prefixes were found by chance in `audit_logs` and `outbox_events` alone. That is roughly a 6% chance per search, and the test searches twice. The file failed once here, straight after the db file, and then passed twice, including in the same order; the first output was not kept. **Fix:** join only digits that a separator people use joins (`[ .,/_:()-]{1,3}`) and search within those runs, or search for all 12 digits as well as the prefix within a run. | open |

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

## Integration notes
