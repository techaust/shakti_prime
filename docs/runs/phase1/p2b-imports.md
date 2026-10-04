# P2b Imports upgrade (wave 2)

| | |
|---|---|
| Branch | `feat/p2b-imports`, made from `main` when the slice starts |
| PC worktree | `p2b-imports`, slot 11: Postgres 54341, app 3041 (`bash tools/integration/setup-worktree.sh p2b-imports feat/p2b-imports 54341 3041`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026): worktree slot 11 (Postgres 54341, app 3041); build and review move to the cloud once the environment exists |
| State | reviewed, fixes done |
| Next step | take main, then the lead's integration |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §6.3](../../design/phase1.md#63-p2b-imports-upgrade)
- PRD IMP-01 and CRM-02
- the import framework (`packages/domain/src/imports`, the `imports.job.*` commands, the worker `/api/v1/workers/imports/commit`)
- P2's uploads (`packages/domain/src/files`, `apps/web/src/files`)
- `docs/spikes/import-scale.md`
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`.
- Lead creation and the import batch's attribution belong to C3's integration (its run file): coordinate any change to `packages/domain/src/imports/commit-leads.ts` with the lead session.

1. **Uploads:** import files arrive by the pre-signed flow of P2; the workbook is read as a stream (the `exceljs` streaming reader), so memory stays flat; the server-action body limit (`serverActions.bodySizeLimit` and `proxyClientMaxBodySize` in `apps/web/next.config.ts`, set to `UPLOAD_BODY_LIMIT` for the import form) returns to the default.
2. **Batch budgets:** one deadline across the whole set-based try, then a short row-by-row slice; a job fails after its last queue retry (`Upstash-Retried`).
3. **Import kinds** `accounts` (customers, one relationship per row's company, a repeated customer folded into one record) and `pin_codes`.
4. **PIN master** `pin_codes(pin, office_name, taluk, district, state_code)`, shared and read-only to requests, written by the `pin_codes` import (an Executive, in a request for every company) from the public India Post directory; a PIN fills the tehsil and district and offers its post-office localities for the village; a PIN outside the master is flagged for review (CRM-02).
5. **The sweep of abandoned pending uploads.**
6. **The slow dedupe query:** the preview's name-and-village match (`regexp_replace` over `customer_sites` and `contacts` in `packages/domain/src/commands/imports/preview-job.ts`) ran past the statement time limit (SQLSTATE 57014) at about 25,000 customers; make it use an index, with `EXPLAIN (ANALYZE)` under RLS.
7. **Documents:** DATABASE (the PIN master and the import kinds), API (the upload path for imports), design §6.3 "Built (P2b)", `pnpm db:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a 50,000-row import is measured locally with the streaming reader.

## Report
### 04-10-2026, builder on the PC
Built on the worktree `p2b-imports` (Postgres 54341, app 3041), continuing from the previous builder's wip commit 2d4794d, which held the contracts, schema and migrations, the streaming reader, the kinds, the fail and sweep commands, the PIN lookup, the web flow and most tests; that commit was checked and kept as it was. This session's commits: e7abcfa, fa12b4f, c097264, 2dd43fb, 5816f8b, 11a38ec, 36528b0 and this report.

**What the slice holds (brief items 1 to 7):**
1. Uploads: import files on P2's pre-signed upload (purpose `import`, CSV or `.xlsx`, 10 MB: `packages/contracts/src/api/files.ts`, `packages/domain/src/files/limits.ts`, `purposes.ts`); the upload check `importFileReadable` in `apps/web/src/workers/files/handle-file-uploaded.ts`; `startImport` in `apps/web/src/actions/imports.ts` reads the `ready` file from the store and runs `imports.job.create` (`fileId`, `import_jobs_file_unique`); the workbook read by ExcelJS's streaming reader (`packages/domain/src/imports/parse.ts`); `serverActions.bodySizeLimit`, `proxyClientMaxBodySize` and `UPLOAD_BODY_LIMIT` removed (`apps/web/next.config.ts`, `apps/web/src/files/limits.ts`).
2. Batch budgets: one deadline for the set-based try (`keep` before each statement sets `statement_timeout` to the time left), then a row-by-row slice of `ROW_BY_ROW_SLICE_MS` (`packages/domain/src/imports/batch-settings.ts`, `commands/imports/commit-job.ts`); `imports.job.fail` (`commands/imports/fail-job.ts`), run by the commit route on QStash's last retry (`Upstash-Retried`, `IMPORT_COMMIT_RETRIES`).
3. Kinds `accounts` (`imports/accounts.ts`, `commit-accounts.ts`) and `pin_codes` (`imports/pin-codes.ts`, `commit-pin-codes.ts`, `gst-states.ts`), with preview, commit, rollback and the screens (`apps/web/src/components/imports/*`, `screens/import-wizard.ts`, `app/(bos)/imports/new/page.tsx`).
4. The PIN master `pin_codes` (migrations 0090 and 0091 on the branch), the trigger `app.customer_sites_pin_fill()` and `customer_sites.pin_needs_review`; `lookupPin` (`queries/crm/pin-lookup.ts`, `actions/pin-codes.ts`, `components/leads/pin-lookup.tsx`) on the lead form and the site dialog; Account 360 marks a site whose PIN waits for a check.
5. The sweep: `files.upload.sweep` (`commands/files/sweep-uploads.ts`), `app.stale_upload_entities()` (0093), `files_pending_created_idx` (0092), the worker `apps/web/src/workers/files/sweep-uploads.ts`, the route `/api/v1/workers/files/sweep` and the hourly QStash schedule `files-sweep` (`apps/web/scripts/qstash-schedule.ts`).
6. The dedupe: `contacts.name_key` and `customer_sites.village_key`, stored generated columns with partial indexes on live rows (0090), compared by equality in `existingByNameAndVillage` (`commands/imports/preview-job.ts`).
7. Documents: DATABASE (`pin_codes`, `customer_sites`, `contacts`, the import kinds, the `files` rules, the definer row, `app_reader`), API §3.2a and §3.6 (the import upload path, the commit worker's budget and last retry, the sweep route), DEPLOY step 6 (the `files-sweep` schedule), design §6.3 "Built (P2b)", `docs/design/backend-weeks-3-5.md` (the batch rule), `docs/spikes/import-scale.md` (the local measurement) and `docs/data/` (regenerated by the previous builder; no schema change since).

**What this session added or fixed:**
- the e2e seed's snapshot import takes an uploaded file (`apps/web/e2e/setup/seed.ts` still passed the old `file` object, which no type check covers there), and `createReadyImportFile` takes an id, bucket, key and type (`packages/db/src/testing/index.ts`);
- the spike `packages/domain/tests/spike/import-scale.ts` rewritten for the upload flow: a 50,000-row workbook written by ExcelJS's streaming writer, read by `parseImportFile` with the process's memory sampled, a second file previewed against the customers made, the name-and-village search explained under the policies, and a job an interrupted run left committing failed and undone first;
- `pinLookup` added to the browser's message groups (`apps/web/src/i18n/client-namespaces.ts`): the unit test showed that the PIN hint's messages never reached the browser;
- `packages/domain/tests/commands/files.test.ts`: the case that expected an import upload to be refused now expects a CSV import upload to be taken, and a spreadsheet for another purpose and an image as an import file to be refused (the brief opens the purpose);
- `apps/web/tests/files-sweep.test.ts` (5 tests): the sweep refuses an upload still pending after a day and deletes its bytes, leaves a fresh one, audits each, survives a failing deletion; the route refuses an unsigned call and one signed for another route, answers 503 without the queue, and sweeps for a signed call;
- `apps/web/e2e/imports.spec.ts`: the leads upload on the new flow (no PIN code list offered to a GM), a customers file matched and checked with its repeated row folded into the first, and an Executive's PIN code list uploaded, checked and added through the screens, then found by the lead form (tehsil and district, the offices offered for the village, an unknown PIN flagged); axe on each screen.

**Change to `packages/domain/src/imports/commit-leads.ts` (shared with C3):** only an optional last parameter `keep: (tx) => Promise<void>` on `commitLeadBatch` (default: does nothing), awaited before each of its statements, so the batch keeps to its one deadline. Nothing it writes, its attribution or its order changes; C3's merge needs only an `await keep(tx)` before any statement it adds.

**Tests added on the branch (both builders):** `packages/db/tests/security/pin-codes.test.ts` 10, `packages/domain/tests/commands/import-kinds.test.ts` 12, `apps/web/tests/files-sweep.test.ts` 5, one case in `packages/domain/tests/commands/files.test.ts`, the cases added to `apps/web/tests/imports.test.ts` (the upload flow and the give-up path), `packages/db/tests/security/imports.test.ts` and `packages/domain/tests/commands/lead-guard.test.ts`, the unit tests of the limits, purposes and parser, and two new journeys (one rewritten).

**Checks** (local database at 54341; `.env` checked to name no other port before each suite run):
- `pnpm typecheck`: `Tasks: 8 successful, 8 total`.
- `pnpm lint` (whole repository, once at the end): exit 0, no problems.
- `pnpm exec turbo run test --concurrency=1`: contracts 177, db 118, domain 1,376, web 558, ui 105, tokens 134, copy-lint 17 passed, after the namespace fix (web had failed 1 of 558 on it).
- `pnpm test:security` (last run, 05-10-2026): db `Tests 913 passed (913)` in 29 files; domain `Tests 516 passed (516)` in 51 files; web `Tests 3 failed | 213 passed (216)`: three cases ran past vitest's 20-second limit on the saturated machine (two in `auth-actions.test.ts`, outside the slice, and "gives up on a job only while it commits" in `imports.test.ts`); those two files rerun alone: `Tests 42 passed (42)`. The web suite's run before it, on the same code but for the journeys and documents, passed `Tests 216 passed (216)`.
- `pnpm copy-lint`: `copy-lint: catalogues and templates are clean`.
- `pnpm build`: `Tasks: 2 successful, 2 total`; `pnpm --filter web js-budget`: `Every page is within its budget (27 pages).`
- `pnpm --filter web e2e imports.spec.ts` (three projects): 17 passed and 3 failed on the run before the last two journey fixes; then the customers journey alone: 9 passed, 2 flaky (the first try on desktop light and dark waited more than 30 seconds for the check on the loaded machine; the wait is now 60 seconds). The leads, PIN code list and snapshot journeys passed on all three projects. Screenshots compare only in Linux; no baselines were made.
- Prettier on every changed file: clean.

**EXPLAIN (ANALYZE) evidence:**
- The name-and-village search (item 6), [results/import-dedupe-plan.txt](../../spikes/results/import-dedupe-plan.txt): 1,000 pairs as a General Manager under the policies, with 59,854 live customer sites in the company: `Index Scan using customer_sites_village_key_idx` per wanted village (46 sites each), the policies' `account_entities` probes by `account_entities_account_entity_key`, `contacts` by its key with the name compared on the joined row; execution 2,568.9 ms on the saturated machine, every buffer a hit. The planner did not use `contacts_name_key_idx` (the village probe is cheaper here); the work follows the customers of the wanted villages, not the size of the group.
- `lookupPin` is an equality on the leading column of `pin_codes_pin_office_unique`; the local `pin_codes` holds only the journey's two made-up offices, so a plan of it would show nothing yet. The sweep's `app.stale_upload_entities()` reads pending files through `files_pending_created_idx`; no plan was taken.

**The 50,000-row import measured locally** (`pnpm spike:import -- --budget 1500`; [results/import-scale-xlsx.json](../../spikes/results/import-scale-xlsx.json); recorded in [import-scale.md](../../spikes/import-scale.md)): the workbook, 1.2 MB, read by the streaming reader in 8.0 s with the process's resident memory up 114 MB and the heap up 64 MB at the peak; create 62.1 s; preview 53.9 s; commit of all 50,000 rows 1,264.9 s (39.5 rows a second, median batch 8.1 s, slowest 47.7 s, 13 set-based tries cut off at their deadline); rollback 50.9 s. The PC was saturated throughout (processor at 100 %, 345 MB free of 8 GB, other worktrees running, Docker restarted earlier after running out of memory; database round trip 4.68 ms against 1.39 ms on 28-09-2026), so the five-minute target is neither confirmed nor refuted by this run; the dev deployment's measure (Integration note 2) settles it.

**Unfinished or uncertain:**
- The other journeys through changed screens (`leads.spec.ts` for the lead form's PIN field, `customers.spec.ts` for the site dialog and Account 360) were started once and stopped: on the saturated machine, with the spike's 50,000 customers in this database, the Executive's customers and leads lists ran past the 30-second statement limit (`listCustomers`, `listLeads`, SQLSTATE 57014), so most of `customers.spec.ts` timed out; `files.spec.ts` passed on retry. They are to run again at integration, on a quiet machine and a fresh database.
- Seen outside this slice: after an import of 50,000 leads is rolled back, its archived leads are the most recently changed rows, and the leads list (`order by updated_at desc`, no partial index on live leads) walks them first; its 50,000 customers also stay in the customers list. Worth a look with the lists' owner before a client rolls back a large import.
- Under load, a batch whose set-based try is cut off at its 17 seconds does only a 3-second slice of single rows, so on a slow database most of a batch's time goes to a try that is taken back; a smaller next batch after a cut-off would keep the rate up. Not built: the brief fixed the budget rule.
- The previous builder's last DATABASE items (the platform rows, the files rules, the definer table) were already in its wip commit and are complete; `pin_codes` is in `SHARED_TABLES`, not `PLATFORM_TABLES`, because requests write it, so no platform-table row was due.

**Decisions the brief did not settle:**
- The made-up PIN 999001 and its two offices are written only by the PIN code journey, through the screens (9 begins the Army Postal Service's PINs, so no office of the directory uses it); no PIN row is seeded or invented anywhere else.
- The spike's results go to a new `import-scale-xlsx.json`, keeping the 28-09-2026 records, and the spike fails and undoes a job an interrupted run left committing.
- `test.slow()` on the three import journeys that upload a file, with the reason beside each.

### 05-10-2026, builder on the PC (review fixes)
Worktree `p2b-imports` (Postgres 54341, app 3041), from 7b58f03. Commits: 7bcc795 (the review table), a997ba2, 1254629, 41e154a, 2d4f272, eb6c8af, 6754b86, 389ba04, eb4f130, 68f1690, 2de2cc5, 1df5b70, b47310b and this report. Every row of the Review table names its fix.

**What changed, by finding:**
- H1: `packages/domain/src/imports/zip-guard.ts` walks the archive as `unzipper.Parse` reads it: from the first byte, each local header where the last part (and its data descriptor) ended, matched one-to-one and in order with the directory (offset, name, method, packed and unpacked sizes), the last part ending where the directory starts; a part with the data-descriptor flag must have no local sizes, its descriptor's signature first found exactly where the directory's packed size ends, and the descriptor's sizes the directory's. Each part is still unpacked with a ceiling of its declared size. The verdict now names each part's record, and `readXlsx` (`parse.ts`) feeds ExcelJS only the checked records it reads (relationships, workbook, shared strings, styles, then the sheets in file order) followed by the directory, so what the reader inflates is exactly what the guard inflated.
- H2: `readXlsx` reads each row cell by cell (`row.eachCell`, only the cells the row has); a value beyond `maxColumns` or a cell over `maxCellLength` is refused in the row it is met, a formatted empty cell past the limit is passed over, and no list wider than the limit is made (trailing blanks never stored).
- M5: the reader is given the shared strings and relationships first, with empty ones standing in where a workbook has none, so ExcelJS never takes its temporary-file path (it spooled a sheet stored before its shared strings and deleted the file only when read to the end). This also removed a race: "refuses a sheet longer than the limit" failed one run in three on the old reader.
- H3: `rollback-job.ts` asks `app.import_accounts_in_use(job)` (new definer, 0095): the job's own customers now in use in any company (a live lead, a consent of a contact, a relationship whose `created_at` differs from the customer's, i.e. not made with it); only the others are archived. It also refuses up front a request that does not act for every company the job's rows name (with M2).
- M1: `app.customer_sites_pin_fill()` now fires on every update and checks a flagged site again when its PIN is unchanged (filling only what the site leaves empty); `app.recheck_site_pins(pins)` (definer, 0095, `imports.write:all` in a group request, answers a count) is called after each PIN batch and after a PIN rollback removes offices, clearing or setting the flag of the live sites of every company with those PINs; partial index `customer_sites_pin_idx`.
- M2: `import_jobs.entity_ids` (0094): the preview stores the companies its ready rows name, the job's own first (null for a PIN code job, which needs the whole group anyway); `imports.job.commit`, `imports.job.commit_batch` and `imports.job.rollback` refuse with `import_companies_out_of_reach` (catalogue sentence added) when the request leaves one out; `commitImportJob` passes that set to the worker (`ImportJobDto.entityIds`).
- M3: `foldAccountRows` carries a later row's site that differs from the customer's sites so far (type, village through `matchKey`, PIN) into `moreSites` of the first row, at most `MORE_SITES_MAX` (100); the commit inserts them; the preview says per repeated row whether its site was added, was already there or was one too many (`ImportDedupeDto.site`).
- M4: the owner's rule: a customers row whose number belongs to a customer the importer can see (the first phone match the preview finds under the importer's policies) carries `existingAccountId`; the preview marks it `linkedTo` ("This row adds its company to that customer instead of making a new one"); the commit adds each of its companies through `app.attach_account_entity` and makes nothing else (`created_type = 'account_link'`); a number held by a colleague is still refused by `app.lead_phone_status` first.
- L1: `imports.job.create` and `startImport` take only the caller's own upload (`files.created_by = actor`); `StoredFile` carries `createdBy`.
- L2: `await keep(tx)` before the stage and source look-ups of `commit-leads.ts` (two lines; `writeActivities` already had one). `lead-guard.test.ts`'s clock now counts those two readings.
- L3: the same-content check counts only a job committing, committed, or failed with rows added.
- L4: `pin_codes_pin_office_unique` is a unique index on `(pin, lower(office_name))`; the upsert's conflict target is `(pin, lower(office_name))`.
- L5: both test files draw PINs from their own range (database 999910 to 999949, domain 999950 to 999989), never one drawn before in the file.
- L6: new platform-only permission `imports.process` (contracts, seeds, `SYSTEM_MATRIX`, `app.platform_only_permissions()`, SECURITY, the role editor's catalogue line); `imports.job.fail` requires it; the worker principal reads and stops a job of its company (`import_jobs_process_read` for `app_user, app_reader`, `import_jobs_process_update`); the commit route fails the job as `system:workers` on a forbidden call (suspended importer, lost permission or company) and on the last retry whatever the cause.
- L7: PRD §8 CRM-02 trace row; `grants.test.ts` comments without the branch's migration numbers; the sweep route's comment says the schedule asks for no retries.
- Also: the ERD writer draws an array column (`smallint[]`) as Mermaid accepts it (`data-docs.ts`, a test case); the preview's and rollback's new audit fields (`linked`, `companies`, `kept`) are named on the activity screen; the customers journey's repeated row gives another village and finds "Its company and its site are added to that customer."

**Migrations (branch only):** 0094 (generated: `import_jobs.entity_ids` with its check, `created_type` gains `account_link`, the PIN unique index, `customer_sites_pin_idx`) and 0095 (custom: the column grant, `imports.process`, the worker's job policies, the trigger, the two definers). 0090 to 0093 unchanged.

**Tests added or changed:** `zip-guard.test.ts` +10 (a part only as a local header, between and after the listed parts; local packed and unpacked sizes differing; a local name differing; the directory in another order; a descriptor flag with local sizes; a descriptor signature inside the data; a streaming writer's workbook with descriptors passes and parses; a workbook with an unlisted sheet refused); `parse.test.ts` +4 (a value at column XFD refused with no list wider than 50 made, formatting past the limit passed over, a long cell refused in its row, no temporary file left); `pin-codes.test.ts` (database) +4; `imports.test.ts` (database) +3; `import-kinds.test.ts` +8 (folded sites, the link, companies out of reach, rollback keeping customers taken on elsewhere or with a consent, own uploads only, same-content rules, the PIN re-check and its rollback, an office in another case) and the two fail tests rewritten for the worker principal; `apps/web/tests/imports.test.ts` +2 (a colleague's upload, a suspended importer's job failed by the worker) and the same-content case rewritten; `import-wizard.test.ts` +1; parity of `MORE_SITES_MAX` in `contract-values.test.ts`; `role-entity-matrix.test.ts` knows the worker reads jobs.

**Checks** (`.env` checked to name only port 54341 before each suite run; database reset with `fresh-db.sh` before each full run):
- touched test files, each alone: database `pin-codes` and `imports` 43 passed; domain `import-kinds` 20 passed; web `imports.test.ts` 31 passed.
- `pnpm typecheck`: `Tasks: 8 successful, 8 total`.
- unit tests (`pnpm exec turbo run test --concurrency=1 --force`, then the three packages again after the last fixes): contracts 177, tokens 134, ui 105, copy-lint 17, db 119, domain 1,390, web 559 passed.
- `pnpm test:security`: db `Tests 3 failed | 917 passed (920)`, the three failures each a 20-second timeout in `role-entity-matrix.test.ts` on the loaded machine (the run before it had shown two real gaps there and in `grants.test.ts`, fixed in 68f1690); that file alone: `Tests 93 passed (93)`. Turbo stops at the first failing suite, so the other two were run next by themselves: domain `Tests 524 passed (524)` in 51 files, web `Tests 218 passed (218)` in 13 files.
- `pnpm lint` (once, whole repository): exit 0, no problems.
- `pnpm copy-lint`: `copy-lint: catalogues and templates are clean`.
- `pnpm db:docs`: regenerated; committed in b47310b.
- `pnpm build`: `Tasks: 2 successful, 2 total`. `pnpm --filter web e2e imports.spec.ts`: `20 passed (1.7m)`.

**EXPLAIN (ANALYZE) evidence** ([results/import-review-plans.txt](../../spikes/results/import-review-plans.txt), synthetic rows in a transaction rolled back afterwards, run as the table owner as the definers run): `app.recheck_site_pins` over 50,000 flagged sites, a batch of 40 PINs: `Index Scan using customer_sites_pin_idx` per PIN, 400 sites updated, 36.2 ms; a batch of 500 PINs (10 % of the sites) takes a hash join over a sequential scan, 4,600 sites updated, the per-row triggers most of its time. `app.import_accounts_in_use` for a job of 500 customers among 20,500: the accounts by primary key, the relationships by `account_entities_account_entity_key`, the leads and consents as hashed subplans; 2.7 ms.

**Unfinished or uncertain:**
- Byte counting inside ExcelJS was not added: its `unzipper` entry streams cannot be reached without patching the library, and the reader now receives only the records the guard walked and unpacked.
- A rollback leaves the relationships a linked row added (and the customer itself): `account_entities` has no delete grant and no archive column, so undoing a link would need a new definer; the rollback screen says so.
- The whole security suite in one turbo run still meets 20-second timeouts on this machine when other worktrees are busy.

**Decisions the brief and the review did not settle:**
- Data descriptors are accepted when exactly placed instead of refused: ExcelJS's own streaming writer (used by the spike and by many export tools) writes them for every part.
- A linked row adds only the companies: the customer's name, contact and sites stay as they were, and its site is not added (the preview says the row adds its company). A linked customer archived since the check is made anew. The first phone match the importer can see is the one linked.
- H3 is fixed both ways the review offered: the definer for cross-company dependents and the up-front refusal when the request leaves out one of the job's companies. A relationship counts as made with the customer when its `created_at` equals the customer's (the same transaction).
- A PIN rollback flags again the live sites whose PIN no longer has an office (the review asked only for clearing).
- Folded sites: at most 100 more per customer from one file; the preview says when a site was one too many.
- L6 through a new permission `imports.process` rather than a definer, so the stop goes through the command with its audit row and event; the importer no longer calls `imports.job.fail` at all.
- The new audit field is `companies` (a count), because the activity screen shows no ids.

## Review
### 05-10-2026, review of 6e5eac7...7b58f03 (lead session)
| # | Severity | Finding | State |
|---|---|---|---|
| H1 | High | The zip guard (`packages/domain/src/imports/zip-guard.ts`) reads the central directory, but the streaming reader (`unzipper.Parse`) reads local headers in order and inflates each with no ceiling: an entry present only as a local header, or a local size differing from the directory's, passes the guard. | fixed in a997ba2 |
| H2 | High | `readXlsx` turns sparse `row.values` into a dense array before the column limit is checked, so one value at a far column allocates a huge row; check the highest column and each cell's length inside the row loop and refuse at once. | fixed in a997ba2 |
| H3 | High | Rollback of a customers job tests "a lead now uses it" under the caller's policies and current company view, so a dependent in a company outside the view is missed; check dependents across every company with a yes/no definer, or refuse when the request does not cover the job's companies. | fixed in 2d4f272 (definer in 1254629) |
| M1 | Medium | `pin_needs_review` changes only when the PIN changes: after a PIN batch commits, sites whose PIN now has an office stay flagged and keep empty tehsil and district. | fixed in 2d4f272 (trigger and definer in 1254629) |
| M2 | Medium | The companies the preview resolved are not stored on the job; the commit does not refuse up front when the request does not cover them, and the worker does not get that set. | fixed in 2d4f272 (column in 1254629) |
| M3 | Medium | A repeated customer row's distinct site is dropped silently when the row is folded into the first. | fixed in 2d4f272 |
| M4 | Medium | Owner decision 05-10-2026: a customers row whose mobile number belongs to a customer the importer can see is linked to that customer (the row's company added as a relationship, ADR 0008, CRM-04), the preview says so per row, and no second customer is made; a colleague's number stays refused. | fixed in 2d4f272 |
| M5 | Medium | ExcelJS's streaming reader leaves temp files when it is not read to its end, which fills a warm instance's `/tmp`. | fixed in a997ba2 |
| L1 | Low | No tests for starting a job from another company's file or a colleague's file; `created_by = actor` not decided. | fixed in 2d4f272 |
| L2 | Low | `commit-leads.ts`: `await keep(tx)` missing before the stage, source and `writeActivities` statements. | fixed in 1254629 |
| L3 | Low | The same-content check counts rolled-back and never-committed jobs. | fixed in 2d4f272 |
| L4 | Low | The PIN office uniqueness is case-sensitive; make it `lower(office_name)` with a matching conflict target. | fixed in 2d4f272 (index in 1254629) |
| L5 | Low | `pin-codes.test.ts` can draw the same PIN twice. | fixed in 41e154a and 2d4f272 |
| L6 | Low | The commit worker does not fail the job on the last retry for every cause (a suspended importer included); fail it through a system path. | fixed in 2d4f272 (permission and policies in 1254629, the queries' role in 68f1690) |
| L7 | Low | Documents: PRD §8 CRM-02 trace row; the migration number in `grants.test.ts`'s comment; the sweep route's comment against `retries: 0`. | fixed in eb6c8af |

### Second review (05-10-2026), re-review of 7b58f03..fd97f34 (lead session)
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | High | The worker's commit request covers only `job.entityIds` (the companies the rows name), but the preview decides each link across all the importer's companies: a customer visible only through an unnamed company is invisible at commit and is made anew, a duplicate. Store on the job the companies each link was seen through (or give the worker the preview's scope), and never make anew because a customer is invisible: decide from `attach_account_entity`'s own result. Test the worker path for a company-3-only customer linked from a file into company 1. | open |
| 2 | Medium | M5 not fully fixed: an empty or root-less `xl/_rels/workbook.xml.rels` leaves ExcelJS's `workbookRels` undefined, so every sheet spools to `/tmp` and is never cleaned on `break` or throw. Do not feed the rels part, or make `workbookRels` and `sharedStrings` impossible to set falsy. Test with an empty rels part. | open |
| 3 | Medium | The same-content check runs only at create, so two jobs of one file can both commit. Repeat it in `imports.job.commit` under an advisory lock on (company, sha256), refusing with `import_file_duplicate`. Test two jobs of one content committed one after the other, and adjust the side-by-side web test. | open |
| 4 | Medium | When the first row of a number is linked to an existing customer, its repeats still say their site is added, but a linked row inserts no sites. Add the sites to the linked customer, or mark the repeats with a distinct value and plain copy. Test. | open |
| 5 | Low | Rollback: lock each chunk's accounts first, then call `app.import_accounts_in_use` for that chunk under the same lock. | open |
| 6 | Low | Cap each non-sheet part (styles, rels, workbook, content types) at a small unpacked size and shared strings at its own cap, refusing with the existing too-large reason. Test. | open |
| 7 | Low | Lead's decision: a customer also counts as in use when someone other than the importer has added an activity (note, customer or site update) or a tag to it after the import; extend `app.import_accounts_in_use` and test. | open |
| 8 | Low | `zip-guard.test.ts`: the "data descriptor flag with sizes in the local header" case must write a real descriptor so it fails only on the local-sizes check; add a case for a descriptor whose sizes differ from the directory's. | open |

## Integration notes
1. Hosted imports need `FILES_BUCKET` and the other file settings, which wait for the owner's AWS files stack ([files-setup](../../runbooks/files-setup.md)).
2. After the merge, the import is measured on the dev deployment and recorded in `docs/spikes/import-scale.md`; concurrent batch workers only if it misses the PRD's five minutes for 50,000 rows (PRD §5).
