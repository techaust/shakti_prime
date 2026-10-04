# P2b Imports upgrade (wave 2)

| | |
|---|---|
| Branch | `feat/p2b-imports`, made from `main` when the slice starts |
| PC worktree | `p2b-imports`, slot 11: Postgres 54341, app 3041 (`bash tools/integration/setup-worktree.sh p2b-imports feat/p2b-imports 54341 3041`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026): worktree slot 11 (Postgres 54341, app 3041); build and review move to the cloud once the environment exists |
| State | built |
| Next step | review |

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
- `pnpm test:security`: SECURITY_RESULT
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

## Review
None yet.

## Integration notes
1. Hosted imports need `FILES_BUCKET` and the other file settings, which wait for the owner's AWS files stack ([files-setup](../../runbooks/files-setup.md)).
2. After the merge, the import is measured on the dev deployment and recorded in `docs/spikes/import-scale.md`; concurrent batch workers only if it misses the PRD's five minutes for 50,000 rows (PRD §5).
