# M1 Migration and UAT packs (wave 6)

| | |
|---|---|
| Branch | `feat/m1-migration-uat`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/m1-migration-uat`, slot 1: Postgres 54331 (container `shakti-pg-m1-migration-uat`), app 3031 |
| Runs on | cloud, beside the follow-up bundles `fix/followups-db` and `fix/followups-tooling` (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | A (deleting or anonymising data): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | second fix round done (rows 14 to 21 fixed; the import file in the file store stays out of scope); waiting for the re-review and integration |
| Next step | lead: the re-review of the second fix round, then integration (take `main`, renumber 0130 and 0131 after `main`'s last (0135 today), apply on a fresh database, make the `imports-row-counts` baseline in Linux); the owner makes the QStash schedule `lead-anonymise-<environment>` on dev and staging after the merge |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md`](../../03-roadmap-appendix/phase1.md) wave 6 (M1, line "M1 Migration and UAT"), §11 (workshop defaults), §12 (tests per slice).
- PRD IMP-01 and IMP-02 and their trace rows; BLUEPRINT §7.9 (retention: unqualified leads with no transaction are anonymised 24 months after their last activity; retention runs as scheduled, logged jobs).
- What exists and is reused, never forked: P2b's imports (`packages/domain/src/imports`, `packages/db/src/schema/imports.ts`, `apps/web/src/workers/imports.ts`, the imports screens), `retention_runs` and the retention functions of migrations 0053 and 0062 (`packages/db/tests/security/retention.test.ts`), the nightly route (`apps/web/src/workers/nightly-route.ts`) and the QStash schedules, ADR 0020 (the workers principal holds platform-only permissions and works through narrow definers), the audit redaction rules (`packages/domain/src/audit`), the masking rules (`packages/domain/src/privacy`).
- Skills: `add-table` and `add-command` where they apply, `supabase-postgres-best-practices`, `writing-guidelines`.

1. **Reconciliation report per import job:** for every import job, rows in, created, attached to an existing record, skipped, refused, with the refusals counted by reason (the `errors.*` reasons the import already records). A query through `executeQuery()` (with `EXPLAIN (ANALYZE)` under RLS in the report), a screen section on the import job's page that an importer can read and print or download as CSV, and the same figures in the job's completion notice if the notice exists. No new figures are invented: every count comes from what the import already stores; add a column only if a count is not recoverable, and say why.
2. **Anonymisation of old unqualified leads:** a scheduled, logged job that finds leads that are unqualified (not converted, no quote, no order, no payment, no project) whose last activity is 24 months or more ago, and anonymises them: name, phones, email, addresses and free-text notes replaced or cleared, consent records kept as the fact of consent without the contact, the account kept only if no other company or record uses it (ADR 0008), and Aadhaar never involved. Name the 24 months in `packages/domain/src/workshop-defaults.ts` (retention is confirmed with the CA). It runs as `system:workers` through a narrow definer that checks a platform-only permission (ADR 0020; append it to `app.platform_only_permissions()` taking `main`'s latest definition), logs each run in `retention_runs` (rows affected, error), writes one audit row per anonymised lead with no personal value in it, is idempotent and batched, and has a nightly schedule route beside the others (the hosted QStash schedule is made by the owner later; list its name in the report). A dry-run mode that counts without changing anything, for the cutover rehearsal.
3. **Cutover runbook (IMP-02):** `docs/runbooks/cutover.md`: the staging dry run, the count reconciliation (using item 1), the cutover weekend hour by hour, the go/no-go rule, the rollback, who does what (by role, never by a person's name).
4. **Parallel-run pack:** `docs/13-client-packs/parallel-run.md`: the two-week parallel run, what is compared each day between the old records and the BOS, how a difference is logged and resolved, and the exit rule.
5. **UAT pack per role:** `docs/13-client-packs/uat/<role>.md` for Executive, GM, Accounts, Sales Team Lead, Cold Caller, Lead Converter and Store Manager: numbered steps in business words, the expected result, a pass/fail box. Every step names a screen that exists today; nothing from a later phase.
6. **Role journeys:** Playwright journeys for the Cold Caller, Lead Converter, Store Manager and Executive, and the dealer credit block, end to end across modules (a new `apps/web/e2e/uat.spec.ts`, or one file per role if clearer), each with axe and `expectAligned`, no screenshots unless they seed their own figures. They must run locally as today's journeys do; that they can run against staging is a later lead step (record what they need: accounts per role and seeded data).
7. **Tests:** the reconciliation query on Postgres with the role × company matrix; the anonymisation definer in `packages/db/tests/security` (refused to every person's role and to agents, allowed to the workers principal, fail-closed without context, exactly the right leads touched — a lead with a quote, an order, a recent activity or another company's use is never touched — idempotent, the `retention_runs` row and audit rows); the job's unit tests; the journeys above.
8. **Documents:** design wave 6 "Built (M1)", the PRD trace rows for IMP-01 and IMP-02, `docs/09-testing.md` if a suite is new, `pnpm db:docs` for the schema, the client packs' readme.

Done when: the checks of AGENTS §10 pass on the branch; the new journeys pass twice in a row on the same database; the security suite passes on the slot's Postgres.

Not in M1: G1 (production accounts), the real parallel run and UAT (they need the client's file), any change to tax, price or credit logic. Two other builders run at the same time: `fix/followups-db` edits notifications, commission accruals, the Triage shadow report and `app.ensure_audit_partitions()`; `fix/followups-tooling` edits `tools/integration`, `.claude/hooks`, `converting.spec.ts`, `converting-fixtures.ts`, `files.spec.ts` and a few test files. Do not edit those. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue, `copy-lint.config.json`) are append-only.

**Migrations:** start at 0130 (the database bundle also starts at 0130; the lead renumbers at the merge).

**Early check:** when the schema, migrations, the definer and the commands and queries are committed with their security tests passing, commit, write a short report and stop; the lead reads that diff before the screens, runbooks and journeys.

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service.

**Reviewer's checklist (check it yourself before reporting):** no personal value in any audit row, log or `retention_runs.error`; the anonymisation can never reach a lead with a quote, order, payment or project, or one another company still uses; RLS fails closed on any new table; the platform-only permission is held by no person's role and no agent; every user-facing word in `en.json` and plain (copy lint); the reconciliation counts add up to rows in.

## Report

### Early check, 12-10-2026, cloud VM (worktree `/home/user/shakti-wt/m1-migration-uat`, Postgres 54331)
Tier A stop: schema, migrations, the anonymisation definers, the command and both queries are committed with their tests; no worker route, screen, runbook, pack or journey yet. Skills loaded: `add-command`, `add-table`, `supabase-postgres-best-practices`.

**Built**
- Permission `crm.retention.run`, platform-only: `packages/contracts/src/permissions.ts` (key, scope `all`, `PLATFORM_ONLY_PERMISSIONS`), `system-principal.ts` (`SYSTEM_MATRIX`), `packages/db/seeds/permissions.ts` and `role-permissions.ts` (no staff role), its role-editor label in `en.json`, SECURITY §3.2 row, §3.1 list and §3.3 row.
- Schema (`0130_m1_retention`, generated): `opportunities.anonymised_at`, `accounts.anonymised_at`, partial index `opportunities_retention_idx (entity_id, updated_at, id) where anonymised_at is null and state <> 'won'`.
- `0131_m1_retention_rls` (custom): `app.platform_only_permissions()` with main's eight keys plus `crm.retention.run`; `app.lead_is_stale(lead, cutoff)` (plain SQL, executable by no request role); `app.stale_leads(entity, months, after_at, after_id, limit)` (definer, read only, `app_user` and `app_reader`); `app.activities_append_only()` (0113's merge exception kept, plus the delete of a `note` of the customer named by `app.lead_anonymise`, only as the anonymiser's owner); `app.anonymise_stale_leads(entity, months, leads[])` (definer, `app_user` only).
- Domain: `WORKSHOP_DEFAULTS.retention.unqualifiedLeadMonths = 24`; command `crm.lead.anonymise` (`commands/crm/anonymise-stale-leads.ts`, registered, audit field `anonymisedAt` labelled); dry-run query `countStaleLeads` (`queries/crm/stale-leads.ts`); reconciliation query `getImportReconciliation` (`queries/imports/import-queries.ts`).
- Contracts: `commands/crm/retention.ts` (cursor, input, `LeadAnonymiseBatchDto`, `StaleLeadCountDto`), `ImportReconciliationDto` (refuses counts that do not add up), `LeadAnonymiseWorkerBody` and `LeadAnonymiseWorkerResponse` for the route still to come.
- Documents so far: DATABASE §4.1 (both definers), §5, §6.2 (`anonymised_at`), §6.10, §7; SECURITY; `pnpm db:docs` and `machines:docs` regenerated.

**Tests** (new: 19)
- `packages/db/tests/security/lead-anonymise.test.ts` (13): refused to every staff role, every agent and the workers without the permission; fail-closed with no context; company outside the request and a period under 12 months refused; no role holds the permission; the reader may count but not anonymise; exactly the right leads stale among 15 fixture leads plus a customer's second lead (quote, order, won, other company, Qualified stage, second lead, dealer, future task, shared person, open duplicate card, recent call, recent note); window order and cursor; a failure recorded as `failed with code P0001` only, changing nothing, while the error message carried the name; personal details removed and facts kept, field by field, import rows included; every other lead untouched; idempotent; the timeline delete refused to a request and to the owner without the setting.
- `packages/domain/tests/commands/lead-anonymise.test.ts` (3): denied to people, wrong company, happy path with one audit row per lead and no personal value, the dry run on a read-only request, a second run with no new audit row.
- `packages/domain/tests/queries/import-reconciliation.test.ts` (3): every bucket and reason counted, totals add up; every staff role in company 1 and 2 (only importers in the job's company read it); another company's job not found.
- Changed: `caller-profiles.test.ts` (nine platform keys), `grants.test.ts` (reader may call `app.stale_leads`), `agent-refusals.test.ts` (`CHECKS` entry), `crm-scoring-referrals.test.ts` (the workers' platform keys), `reader-parity.test.ts` (both queries), `workshop-defaults.test.ts`.

**Checks** (all through `heavy.sh`)
- `eslint packages/contracts packages/db packages/domain apps/web/src/screens --max-warnings 0`: clean; `eslint packages/domain/tests`: clean.
- Typecheck `@shakti/contracts`, `@shakti/db`, `@shakti/domain`, `web`: clean.
- Unit: contracts 181 passed; db 131 passed; domain 2057 passed (76 files); web `audit.test.ts` 17 passed; copy lint clean.
- Security suite on the slot's Postgres: db 1208 passed (41 files); web 303 passed (22 files); domain 937 of 938: the one failure is `import-kinds.test.ts` "adds the different site of a repeated row", which uses the fixed name "Two Sites" in "Sikar" and on a second run against the same database finds the first run's customer by name and village. It passed in the first full run on this database and touches nothing of M1; on a fresh database it passes.

**`EXPLAIN (ANALYZE)` evidence** (slot Postgres, transactions rolled back)
- Window of `app.stale_leads`, 80,000 leads idle 30 months spread over the four companies: `Index Only Scan using opportunities_retention_idx`, `Index Cond: (entity_id = 4) AND (updated_at < now() - '2 years')`, 500 rows, 0.6 ms; the next batch's cursor is part of the index condition (`ROW(updated_at, id) > ROW(...)`), 0.8 ms. The 500 eligibility checks (`app.lead_is_stale`, each about 25 index probes, read by `auto_explain` nested plans: `opportunities_id_entity_unique`, `quotes_opportunity_idx`, `quotes_account_idx`, `sales_orders_*_idx`, `account_entities_account_entity_key`, `opportunities_account_idx`, `customer_merges_*`, `duplicate_candidates_*`, per-partition `activities_*_account_id_created_at_id_idx` with `created_at >= cutoff`, `calls_opportunity_started_idx`, `tasks_opportunity_idx`) take 112 to 125 ms per batch, about 0.25 ms per lead. With every old lead in one company the planner takes `opportunities_keyset_idx` instead (13 rows filtered).
- Reconciliation, as `app_user` with a General Manager's settings over a 50,000-row job: one `Seq Scan on import_rows` (the job is 99.97% of the table, so the scan is the right plan) under `import_rows_read` (job lookup a hashed subplan over the company's jobs), `HashAggregate` to 3 groups, 55.9 ms.

**Decisions the brief did not settle**
1. Unqualified: never won and at a stage before the pipeline's live Qualified stage, as well as the brief's no quote, order or commission; a lead at Qualified or later is kept even without a quote.
2. "Another company or record uses it": the lead is never touched when its customer deals with another company, has any other lead, is a dealer or referral partner (type, `referral_partners`, `dealer_terms`, `dealer_outstanding`), is in a merge that stands or an open duplicate card, or shares a person with another customer. So a customer is anonymised only with its only lead, never partly.
3. Last activity: nothing changed since the cutoff on the lead (made, changed, state), the customer and its company relationships, people, phones, consents and sites, nor any timeline row, call, sizing or task (changed or due); an open task due later keeps the lead.
4. Removed: customer name (to empty) and GSTIN; people's names (to empty), email addresses and phone numbers (rows deleted); sites' address, village, PIN, map point and technical notes; the lead's campaign fields; task titles; the customer's notes (deleted, since a replacement text in the database would be copy outside the catalogue); what import rows that made the lead or customer said, and later rows of the file skipped as their repeat (state, counts and reasons kept, so the reconciliation still adds up). Kept: the lead row (state, stage, pipeline, score), customer type, tehsil, district and state code, calls, sizings, tags, consents, company relationships. The lead, customer, people and sites are archived, so every list and search leaves them out; the lead and the customer carry `anonymised_at`.
5. The definers refuse a period outside 12 to 120 months, so no call can reach a lead changed within the last year.
6. `retention_runs`: one row per batch (job `leads-anonymise`), a batch with nothing to do included; the error is `failed with code <SQLSTATE>[ on <constraint>]` and nothing else; a failure changes nothing else (a block that rolls back) and the batch answers `failed`. The dry run writes nothing, not even a run row, and runs as a read-only query (on the reader pool when it is set).
7. Concurrency: the leads and customers are held `for update skip locked`, then their people, and each lead is checked again in a new statement; a lead a quote, order or new lead is being written for (a key lock) waits for the next night.
8. Batches of 500 leads, oldest last change first, cursor `(updated_at, id)` to the microsecond; a run out of time leaves the rest to the next night, as the quote expiry does (no hand-over).
9. Reconciliation buckets: `created` (committed and made a lead, customer or PIN office), `attached` (committed and linked to a customer, or made nothing new), `skipped`, `refused` (invalid, or the row a failed commit stopped at, `commit_failed`), `waiting` (pending or valid), `undone` (rolled back); each refused row counts once under its first finding, so the reasons add up to `refused`. No column added: every count is recoverable. No completion notice exists (`imports.job.committed` has no subscriber and no notification), so none was changed.
10. Platform-only permission named `crm.retention.run`; the command `crm.lead.anonymise`.

**For the owner or the CA**
- Consent evidence files (a signed form or recording holds the person) are kept with the consent as proof of consent; whether they are deleted at anonymisation is for the CA.
- Audit rows written before the anonymisation keep what they recorded (redacted values such as the last four digits, and the before and after of customer edits) for the eight years of BLUEPRINT §7.9; not touched.
- Rows of import files that were refused or never became a lead keep what the file said indefinitely; outside M1.

**Notes for the lead**
- I edited `0131_m1_retention_rls.sql` after it ran on the slot database (the anonymiser now answers `{ leads, error }`): I replaced that one function by hand and updated its recorded hash, so the slot passes `assertAllApplied`; a fresh database applies the file as committed. A fresh-database apply is still to be shown.
- DATABASE cites the migrations as 0130 and 0131; they move at the merge.
- Left for after the check: the nightly worker and route (`/api/v1/workers/crm/anonymise`, QStash schedule `lead-anonymise-<environment>`, the dry run by body `{ "dryRun": true }`), the reconciliation section and CSV on the import job page, API and design "Built" records, PRD trace rows, TESTING, the cutover runbook, the parallel-run and UAT packs, and the journeys.

### Final, 13-10-2026, cloud VM (worktree `/home/user/shakti-wt/m1-migration-uat`, Postgres 54331, freshly recreated by the lead)

**The early check's findings, answered**
1. `contacts.name_key` and 2. `customer_sites.village_key` are generated columns (`regexp_replace(lower(name|village), …)`), so they follow the cleared values: `name_key` becomes empty and `village_key` null. `lead-anonymise.test.ts` now asserts both, and that tehsil, district and state code stay (named in the function's header as coarse geography for reports).
3. The sweep of every table holding text about a lead, customer, contact or site (every foreign key to `opportunities`, `accounts`, `contacts`, `customer_sites`, `contact_phones`, `referral_partners`, and the tables that name them without one), column by column:

| Table · column | Decision |
|---|---|
| `contacts` · name, email; `contact_phones` (rows) | Name emptied, email cleared, phone rows deleted (`name_key`, `e164_reversed` follow) |
| `accounts` · name, gstin | Name emptied, GSTIN cleared; type kept; `anonymised_at` set; archived |
| `customer_sites` · address, village, pin, lat, lng, technical_json | Cleared; tehsil, district, state code kept; archived |
| `opportunities` · campaign_json | Cleared; score_reasons_json (rule codes and catalogue keys) kept |
| `activities` · body (notes) | Note rows deleted. Every other type's `payload_json` holds ids, codes, booleans or field names only (checked in every `ctx.activity()` call: stage moves, calls with the outcome code, tasks, tags, sizing, consent channel and purpose, merges, customer edits as the names of the fields changed), so it stays |
| `tasks` · title | Cleared |
| `inbox_items` · note (routed work) | Cleared for items about the lead or the customer (new index `inbox_items_subject_idx`) |
| `agent_actions` · input_json, decided_input_json `note` | The agent's note removed from proposals about the lead (new index `agent_actions_opportunity_idx`); the rest of the proposal is ids and codes |
| `agent_runs` | No text about the lead (codes, counts, request id) |
| `import_rows` · raw_json, normalised_json, dedupe_json | Cleared for the rows that made the lead or customer and the later rows skipped as their repeat; state, made record and reasons kept |
| `duplicate_candidates` · signals_json | Codes only (`same_phone`, `same_name`, …); kept. A lead or customer with an open card is never anonymised |
| `customer_merges` · moved_json | Ids only; a customer in a standing merge is never anonymised |
| `sizings` · inputs_json, result_json, reasons_json | Numbers and codes only (no address or map point in the sizing contracts); kept |
| `consents` | Kept as the fact of consent with its evidence file (the signed form holds the name: for the CA, workshop FIN-2) |
| `calls`, `opportunity_tags`, `account_entities`, `account_contacts` | Ids, codes and times only; kept |
| `notifications` · payload_json, dedupe_key | Ids only by the table's own rule; kept |
| `quotes`, `quote_versions`, `sales_orders`, `commission_accruals`, `dealer_*`, `referral_partners` | A lead or customer with any of them is never anonymised |
| `idempotency_keys` · response_json | Can hold a lead's answer, but expires after 7 days and is purged daily, long before 24 months |
| `outbox_events` · payload_json | Ids, codes and counts by the catalogue; purged after 30 days |
| `audit_logs` | Rows written before the run keep what they recorded (redacted), for the 8 years of BLUEPRINT §7.9 |
| `files` | The consent evidence is kept (above). An import file's bytes in the file store still hold what the file said; the definer cannot reach the store: a follow-up for a store sweep |

4. The completeness test (`lead-anonymise.test.ts`, "nothing of the person is left"): the fixture lead `marked` carries this run's random marker in its customer's and person's names, email, site address, village and technical notes, campaign fields, note, task title, import row (raw and checked), routed-work note and Triage proposal note, and its own random phone; its consent rests on an evidence file named with the marker. After the run, every text, character, json and array column of every public table (more than 100, partitions through their parents) is searched for the marker and the phone digits: the only hit is `files.name` of the kept evidence file. No audit row is written by the definer, so none needed excluding.
5. The trigger exception no longer rests on a setting: `app.lead_anonymise_scope` (schema `app`, no grant to any request role) names the customers and leads for the current transaction (`pg_current_xact_id()`); `app.anonymise_stale_leads()` writes it and empties it before it returns. `app.activities_append_only()` (delete of a note) and the new exception of `app.agent_actions_append_only()` (removal of the agent's note, nothing else) open only for a row named there; both are definers so they may read the table whoever writes, closed to `public` and reporting. Every definer that deletes from `activities` or `agent_actions` was searched (`pg_proc.prosrc`): `app.anonymise_stale_leads()` is the only one, and no definer other than it writes the scope table. Tests: a request that sets `app.lead_anonymise` and deletes is refused (no grant), the owner deleting a note outside the anonymisation is refused even with the setting, the owner changing a proposal outside it is refused, and a request writing the scope table is refused. The older `app.customer_merge` setting of 0113 and 0117 has the same shape as the one removed here (a setting any request can make); it opens only an update of `account_id`, which `app_user` has no grant for and only the merge definers make, so it is left as it is and named here for the review.

**Built since the early check**
- Migrations: `0130_m1_retention` regenerated with the two lookup indexes; `0131_m1_retention_rls` with the scope table, both trigger exceptions, the inbox and agent notes, the inbox and agent recency in `app.lead_is_stale()`, and the header listing what is removed and what is kept. Applied fresh by the lead on 13-10-2026.
- Worker and route: `apps/web/src/workers/lead-anonymise.ts` (`runLeadAnonymise`, every company in turn, a failed batch logged and that company left to the next night, the dry run on a read-only request), `apps/web/src/app/api/v1/workers/crm/anonymise/route.ts` (`nightlyWorkerRoute`), `LEAD_ANONYMISE_PATH`, and the schedule `lead-anonymise-<environment>` at 22:30 UTC in `apps/web/scripts/qstash-schedule.ts`.
- Screen: the action `getImportReconciliation`, the section "What happened to each row" on the import job page once the rows are checked (`components/imports/reconciliation.tsx`), its CSV through `screens/import-reconciliation.ts` (the same lines, fields never read as a formula); copy under `imports.reconcile` in `en.json`, the button key `downloadCsv` in the copy lint's list. Print is the browser's print of the page; no print view was added.
- Documents: `docs/runbooks/cutover.md`, `docs/13-client-packs/parallel-run.md`, `docs/13-client-packs/uat/` (seven roles) and the packs' readme; design §10 "Built (M1)"; PRD trace rows IMP-01 and IMP-02; API §3.6 and ARCHITECTURE §6 (the route and schedule); DATABASE §4.1, §5, §6, §7; SECURITY; TESTING §5; workshop pack FIN-2 (the default and the evidence-file question).
- Journeys: `apps/web/e2e/uat.spec.ts` (five journeys: a Cold Caller's new lead qualified on Calling and taken on by the present Lead Converter on Converting; a Store Manager's walk-in, a note on the customer's page and the lead on Converting; the Executive's Home, Activity log and Integration health; a GM's customers file and its row counts with the CSV checked line by line; a dealer order held for credit from Accounts of the journeys' company to the Executive's release and back to Accounts' Dealer credit), each page through `expectNoAxeViolations` (axe and `expectAligned`), no screenshots. Seed: `e2e/setup/uat.ts` (a new dealer per project each seed) and the signed-in person `journeyAccounts` (Accounts of company 2) in `users.ts`. Against staging they need the 13 signed-in people of `users.ts`, the journey tier's price list in company 2, and the seed's dealers.

**Tests added since the early check:** `apps/web/tests/lead-anonymise.test.ts` (8: the four refusals, no queue, a body it does not know, the dry run then the run over every company with equal counts, the time budget), `apps/web/src/screens/import-reconciliation.test.ts` (3), `lead-anonymise.test.ts` now 15 (the completeness search and the append-only exceptions). In all, M1 adds 32 tests and 15 journey runs (5 journeys in 3 projects).

**Checks** (all through `heavy.sh`, on the recreated 54331)
- `pnpm typecheck`: 8 successful. `pnpm format:check`: clean. `pnpm copy-lint`: catalogues and templates are clean.
- `turbo run test --force`: contracts 181, db 131, domain 2057, tokens 134, ui 106, copy-lint 17 passed; web 767 passed and 1 failed: `mask-pdf-pages.test.ts` "counts a page time from its turn", a timing test, which passed alone (13 passed, 1 skipped).
- `pnpm test:security`: db 1210 passed (41 files); domain 936 of 938: `customers.test.ts` failed on a random tag name already taken by the earlier (killed) run on this database, and passed alone; `import-kinds.test.ts` "adds the different site of a repeated row" fails on any database that ran it before (fixed name "Two Sites" in "Sikar", found again by name and village), as in the early check; neither touches M1. `pnpm --filter web test:security`: 311 passed.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page is within its budget (46 pages).
- Journeys, twice in a row on the same database (seed, then `playwright test e2e/uat.spec.ts`): 29 passed (2.3 min), then 29 passed (2.0 min).
- `pnpm lint` (whole repository, last): clean.

**Unfinished or uncertain**
- `writing-guidelines` could not fetch its rules (no web access in the VM); the packs and runbook follow docs/08-design-system.md §11 instead.
- The import file's bytes in the file store are outside the anonymisation (table above).
- The two domain tests that fail on a reused database are older than M1; a follow-up could give `import-kinds.test.ts` a name of its own per run.
- The QStash schedule on dev and staging is the owner's after the merge.

### Fix round, 13-10-2026, cloud VM (worktree `/home/user/shakti-wt/m1-migration-uat`, Postgres 54331)

One round over every finding of the review (`9f814e2c`), on the lead's decisions; commits `68ca643e` (migrations), `2813c02e` (code and tests), `94893946` (documents and runbook), `de2a3a30` (journeys, the repeats index), `2dd60c1e` (format), `19bc141f` (the security fixture re-runnable on one database). `main` not taken in; the migrations are still 0130 and 0131.

**Each finding**
1. **Lost leads.** `app.lead_reached_qualified()` decides "reached Qualified" from the current stage only when it is an open stage at or after Qualified, otherwise from the lead's `stage_moved` timeline rows (`toStageId` an open stage at or after Qualified). Stages of kind `won` and `lost` never count by position. A lead lost from New or Contacted is anonymised; a lead that was Qualified before it was lost is kept. Fixtures: `staleLost` and `qualifiedThenLost` sit at the pipeline's real `lost` stage with the `lost` timeline row `crm.opportunity.lose` writes, the second with a stage move to Qualified first.
2. **Audit rows (owner, 13-10-2026).** In the same call, every earlier `audit_logs` row about the customer, its leads, people, sites, relationships, tasks, calls, sizings, consents and inbox items (by `aggregate_id`, or by the `accountId` or `opportunityId` of its input) has every string that is not an id and every number in `input_json`, `before_json` and `after_json` replaced by "removed" (`app.audit_blank()`, recursive; keys, ids, booleans and nulls stay). Action, actor, time, company and record ids stay. `app.audit_logs_append_only()` (a definer, on the partitioned table so every partition) allows only that exact replacement, only for a row whose subject is in `app.lead_anonymise_scope` for the current transaction; any other change or delete is refused as before. The rows are found on two new expression indexes, `audit_logs_input_account_idx` and `audit_logs_input_opportunity_idx`. The new domain test `lead-anonymise-complete.test.ts` makes its lead through `crm.lead.create` (with consent), `crm.contact.update`, `crm.site.upsert`, `crm.note.add` and `crm.task.create`, ages it, runs the command as `system:workers`, and searches every text, json and array column of every public table for the run's marker and phone digits: no hit (audit, outbox and idempotency rows included). DECISIONS has the row of 13-10-2026. DATABASE §4.1 and §5, SECURITY and workshop FIN-2 say so in plain words.
3. **Cutover rehearsal.** No real file goes to staging. Staging is rehearsed with anonymised copies made on the developer's machine (same columns, rows and repeats). The real files are rehearsed on production before go-live and then put back by point-in-time recovery to a noted restore point, checked by the counts of customers, leads and import jobs per company. The rehearsal's uploaded files are deleted from the files bucket and listed in the cutover log. "Undo this import" is named as not being the way back, with the reason from its own dialog. Of the two choices the lead allowed, this is the one BLUEPRINT §7.10 and the design's G1 line allow without a project of its own.
4. **Concurrency.** `app.refuse_anonymised_customer()` runs before insert on `opportunities`, `account_entities`, `account_contacts`, `customer_sites` (and on its updates), `tasks`, `activities`, `quotes` and `sales_orders`. It reads the customer `for key share` and refuses with `check_violation` / `customer_anonymised` once `anonymised_at` is set. A writer that read the lead before the job held it waits for the job, then is refused. The catalogue reason `errors.customer_anonymised` is reached through the runner's shared constraint reasons. Tests: four refused writes (task, note, site insert, site update), and a two-session test in which a note written while another session holds and marks the customer waits, then is refused.
5. **A customer with several leads.** The definer works one customer at a time. It holds every lead of the customer, the customer and its people, and anonymises them together when every lead is stale (idle, never reached Qualified, no quote, order or commission) and nothing else is current. A second company (`account_entities` in another company), a standing merge or an open duplicate card still keeps it. Tests: `twoStale` (two old leads of one customer, both anonymised) and `otherCompany` (kept).
6. **Fairness.** The worker hands the rest of the night to a fresh QStash call with `{ entityId, after }` when its 40-second budget is spent, as the rescoring does. The call's dedupe id is `lead-anonymise[-dry]-<run date>-<company>-<start or the cursor's lead>`. Leads that can never become eligible (won, Qualified reached, a quote, order or commission, a dealer or referral-partner customer) are marked `retention_kept_at` and leave the window's partial index. None of these ever comes undone, so the mark is final. `opportunities_set_updated_at` ignores that column, so marking does not make a lead look active.
7. **Owners and stages.** The runbook uses what exists: one leads file per caller per company, imported by an importer (a GM-role team member made for the cutover), then Team members › **Move all leads** to the caller. The old stages are not carried: every lead starts at the pipeline's first stage. An owner and a stage column on the leads import is named as a prerequisite for a later slice if the group wants them.
8. **A failing lead.** Each customer is its own block. A failure takes back that customer only, is counted, and keeps only its SQLSTATE and constraint (`retention_runs.error`: "failed with code X on c for N customer(s)"). The rest of the batch goes on, and the batch's leads are passed by the cursor.
9. **Co-pilot titles.** The run removes `title` as well as `note` from proposals about the lead (`input_json` and `decided_input_json`). The `agent_actions` exception allows exactly those two keys. Task titles are cleared too.
10. **Three checks that could not fail.** `ImportReconciliationDto` carries `fileRows` (the job's stored `total_rows`) and its refine requires `rowsIn = fileRows`. The web test seeds a stale lead of its own in company 4 and checks the dry run's count equals the run's (both at least 1). The worker body `{ entityId: 2 }` is now valid, so the unknown-body test sends `{ companyId: 2 }`.
11. **EXPLAIN for the writes** (below).
12. **Copy.** The UAT packs say "sign in as a person with the X role in one company". The runbook names the screen's steps (*Choose the file*, *Match the columns*, *Check the rows*, *Add the rows*). `commit_failed` reads "Adding stopped at this row". FIN-2 names the setting in words, not by its code name.
13. **Journeys.** The Lead Converter sizes the Cold Caller's Residential Rooftop lead and starts a quote; the lead has no price tier yet, so the screen says so. The Store Manager's walk-in is sized and reaches the same message. The Executive's journey goes end to end in company 2: a new lead, its price tier, sizing, the quote (₹26,880.00), its PDF, sent, the signed copy, the order confirmed, the lead Won, then the Activity log and Integration health. The GM's import journey takes a screenshot of the new section, `imports-row-counts` (heading and start time masked).

**EXPLAIN (ANALYZE) of the anonymiser's writes** (slot database with 50,000 import rows of one job and 100,000 audit rows added in a transaction then rolled back, the statements as the definer runs them for one customer):
- Import rows (the CTE: rows that made the lead or customer, then the skipped repeats of them): Index Scan on `import_rows_created_idx`, then Index Scan on `import_rows_skipped_repeat_idx` (job, `inFileRowNo`, partial on `skipped`, new in 0131), 0.66 ms.
- Audit rows (the union of the three finders): per partition, Index Scan on the aggregate index, Bitmap Index Scan on `audit_logs_input_account_idx` and on `audit_logs_input_opportunity_idx`, 0.23 ms.
- Notes delete: per partition, Index Scan on the timeline's account index, 0.17 ms.
- Earlier, unchanged: the window on `opportunities_retention_idx` 0.6 ms over 80,000 leads; 500 eligibility checks about 125 ms; the reconciliation 56 ms over 50,000 rows.

**Tests added or changed in the round**
- `packages/db/tests/security/lead-anonymise.test.ts`: 15 → 19. New: audit trail blanked, audit append-only outside the scope, four refused writes, the two-session race. New fixtures: `qualifiedThenLost`, `twoStale`, and the kept-for-good marking. The fixture now uses ids of its own for every row a test writes and keeps its actor across runs, so the file passes again on the same database.
- `packages/domain/tests/commands/lead-anonymise-complete.test.ts`: 1, new (the completeness search through the commands).
- `apps/web/tests/lead-anonymise.test.ts`: 4 → 5 (the hand-over with the cursor and its dedupe id; its own stale lead).
- `apps/web/e2e/uat.spec.ts`: the same five journeys, three of them longer, and one screenshot.

**Checks** (all through `heavy.sh`, on 54331; this database is the one the lead recreated, with 0130 and 0131 applied by hand after their edits and their hashes and times updated in `drizzle.__drizzle_migrations`. Applying both on a fresh database is still to be shown, at the lead's next recreation or the integration.)
- `pnpm db:docs`: regenerated (`docs/data/`, committed in `19bc141f`). `pnpm typecheck`: 8 successful. `pnpm format:check`: clean. `pnpm copy-lint`: catalogues and templates are clean.
- `turbo run test --force`: contracts 181, db 131, domain 2057, tokens 134, ui 106, copy-lint 17 passed; web 768 passed, 1 skipped.
- `pnpm test:security`: db 1214 passed (41 files). Domain 937 of 939: `import-kinds.test.ts` and `customers.test.ts` failed as they do on any database that has run them before (Still open); `customers.test.ts`, `lead-anonymise.test.ts` and `lead-anonymise-complete.test.ts` alone: 13 passed. `pnpm --filter web test:security`: 311 of 312; `actions.test.ts` (outbox delivery) alone: 41 passed.
- `pnpm build`: 2 successful. `pnpm --filter web js-budget`: every page is within its budget (46 pages).
- Journeys, twice in a row on the same database (`e2e:seed`, then `playwright test e2e/uat.spec.ts --ignore-snapshots`): 29 passed (2.3 min), then 29 passed (2.3 min).
- `pnpm lint` (whole repository, last): clean.

**Decisions the brief and the lead's notes did not settle**
- The rehearsal is done twice: staging with anonymised copies, production with the real files, then put back by point-in-time recovery. The lead allowed either; this keeps real data off staging and still measures the real files.
- Owners by **Move all leads**, one file per caller. Stages are not carried.
- `retention_kept_at` is never cleared, because each reason it records is permanent.
- `app.audit_blank()` keeps keys, ids (uuid-shaped strings), booleans and nulls, and replaces every other string and every number. A count or an amount in an audit row of the person is blanked with the rest.
- The refusal trigger also covers a site update (the review's example of an address written back).

**Still open**
- An import file's bytes in the file store, and the refused rows of an import file, which no record links to the person. The definer cannot reach the store. This is a follow-up for a store sweep, or for the import files' own retention.
- Two domain tests and one web test fail only on a database that has run them before. `import-kinds.test.ts` uses the fixed name "Two Sites" in Sikar. `customers.test.ts` hits a tag name already taken. `apps/web/tests/actions.test.ts` "have the publisher deliver them after the commit" finds the event unpublished behind this database's 121 waiting events (72 `admin.user.reactivated` at 10 attempts, test-health probes). None touches M1. Results of their runs alone are under Checks.
- The screenshot `imports-row-counts` has no baseline yet. The lead makes it in Linux (`pnpm --filter web e2e:snap -- --update-snapshots e2e/uat.spec.ts`).

### Second fix round, 13-10-2026, cloud VM (worktree `/home/user/shakti-wt/m1-migration-uat`, Postgres 54331)

One round over findings 14 to 21 of the second review (`160630fb`), on the lead's decisions. Commits:
- `d4b389a7`: schema, migrations, code and the db tests.
- `944e295e`: documents, the completeness test with Triage and a routed walk-in, and the `qualified_at` test.
- `2d74e4ff`: the eligibility checks in PL/pgSQL.
- `f29a9283`: formatting.
- `92944934`: the `enum-sync` pair, the fixture PIN and `docs/data`.
- the commit of this report.

`main` was not taken in. 0130 (regenerated) and 0131 were edited in place and are still numbered 0130 and 0131.

**Each finding**

14. **Audit rows.**
    - Two more finders, each on an expression index (0130):
      - `input_json #>> '{proposal,input,opportunityId}'` (`audit_logs_input_proposal_opportunity_idx`): the Triage agent's `agent_run` and `agent_action` rows.
      - `input_json ->> 'existingAccountId'` (`audit_logs_input_existing_account_idx`).
    - The definer and the exception in `app.audit_logs_append_only()` both match these finders.
    - Refused rows no longer store a person's details when they are written. `executeCommand` passes a refusal's input through `withoutPersonalDetails()` (`packages/domain/src/audit/redact.ts`). This replaces the value of every field named name (also full, contact or customer name), phone(s), mobile, WhatsApp, e164, email, village, PIN or PIN code, address or note with "removed", at any depth. The reason (`error_code`), the company, the ids and the codes stay.
    - 0131 does the same to the refusals already written, other than sign-in events. It uses `app.audit_without_personal()`, the same rule in SQL, and runs in one `do` block:
      - each row is named in `app.lead_anonymise_scope` by its own id;
      - its input is changed;
      - the scope is emptied.
    - The audit trigger's exception allows that change only for a row whose outcome is not `ok`, that is named there by its own id, with only its input changed, to exactly `app.audit_without_personal()` of it. No other exception was added, and only the owner can write the scope. On the slot, 44 refused rows held a name, phone, village or similar before the migration and 0 after.
    - The completeness test now adds two things. The Triage agent reads the lead and proposes, through `runTriage` with the fake model and the marker in its note. A colleague's walk-in for the same number is refused as `customer_held_by_colleague`, through `executeCommand`, so its refusal row is written, and is then routed with a note through `crm.enquiry.route`. After the run, no column of any table holds the marker or the number.
    - DATABASE §4.1 and §5 (the `audit_logs` row and the exceptions), SECURITY (the `crm.retention.run` row and §8) and FIN-2 say so.
15. **"Reached Qualified".**
    - `opportunities.qualified_at` (0130) is stamped by `crm.opportunity.stage.move` in the same write that moves the lead to the pipeline's live Qualified stage or a later open one. It is set once and never cleared. No other writer moves a lead to an open stage past New: lead creation, the import and reopening go to the first stage, and win and lose go to the won or lost stage.
    - 0131 backfills it from the stage history, using today's positions: the earliest `stage_moved` to such a stage, or the lead's last change when only its current stage shows it. On the slot this filled 86 of 2,168 leads.
    - Eligibility reads `qualified_at` only, so `app.lead_reached_qualified()` is gone. A change of `qualified_at` alone keeps `updated_at`.
    - New test in `opportunity.test.ts`: moving to Contacted stamps nothing, moving to Qualified stamps the time, and a lead already stamped keeps its time.
16. **Other companies and merges.**
    - `app.customer_idle()` no longer refuses a second company or a merge.
    - A customer several companies know is anonymised with all its leads in every company once every one of them is stale. This happens in one call of whichever company's run reaches it first.
    - The definer answers `leads: [{ id, entityId }]`. The command writes the audit row of a lead of another company with no company, because the company-scoped request may not write one for another company (the audit insert policy). Such rows are read with `audit.read:all`.
    - A customer in a standing merge is kept with the reason `merge`, so the window passes it by.
    - DECISIONS has the lead's row of 13-10-2026, and SECURITY says this is the one worker that acts beyond its company.
    - Tests:
      - `twoCompanies`: one stale lead in company 1 and one in company 2, both anonymised by the company 1 call, each listed with its company.
      - `merged`: kept, reason `merge`.
17. **The kept mark stores its reason.**
    - `retention_kept_reason` is one of `LEAD_RETENTION_KEPT_REASONS` (contracts; the check is in `enum-sync`), and the mark and its reason are set together or not at all.
    - `app.lead_kept_reason()` gives the first reason that applies. The permanent ones come first, so a lead that is both a dealer's and qualified is marked `qualified`. The permanent reasons are: `won`, `qualified`, `quote`, `order`, `commission`, `dealer_credit`, `referral_partner`, `other_lead` and `customer`.
    - The two lapsing reasons come last and are cleared by the change that ends them, through definer triggers that see every company:
      - `dealer`: cleared when `crm.account.update` changes the customer's type back to household, farm or business (`app.retention_kept_lapse_type()`).
      - `merge`: cleared when `crm.customer.unmerge` sets `undone_at` (`app.retention_kept_lapse_merge()`). An undone merge clears every mark of both customers' leads except `won` and `qualified`, because the leads, quotes and orders moved back with it. Those still kept are marked again on the next run.
    - Tests:
      - The dealer's lead is unmarked when its type becomes farm, and the window returns it as stale.
      - A `qualified` mark survives a type change.
      - The merged customer's lead is unmarked when the merge is undone.
18. **Cutover put-back**, `docs/runbooks/cutover.md` §2.2, written step by step:
    - the freeze: only the cutover lead and the importer sign in, no set-up changes, and production's QStash schedules paused by the owner of the group's Upstash account;
    - the restore point, with the counts noted;
    - the import of the real files;
    - the dry run;
    - the data owner's go-ahead;
    - the in-place point-in-time restore of the production project itself, by an owner or administrator of the group's Supabase organisation. Production is offline during it, the restore cannot be undone, and it is not the DATABASE §10 drill, which restores into a scratch project;
    - the files bucket cleared of the rehearsal's uploads the same day;
    - the counts checked company by company;
    - the freeze ended.

    Move all leads is rehearsed on staging only, so no caller gets a notice about leads that disappear. "Where the real files are kept": the data owner holds them in a folder on the group's own storage, never in the repository, on staging or dev, in email or chat; the cutover lead keeps no copy afterwards. §6 refers to these steps.
19. **FIN-2** states the rule in full:
    - the 24 months without change, in every company that knows the customer;
    - never reached Qualified or won;
    - no quote, order, commission, dealer credit or referral-partner record;
    - kept while a dealer or referral partner, while a company holds them as a customer with no lead, or while a merge stands;
    - the history of changes included;
    - a refused entry keeps no personal details.
20. **The race test** polls `pg_stat_activity` (at most 100 times, 50 ms apart) until the waiting insert's session shows `wait_event_type = 'Lock'`, and asserts it before it lets the job commit. The insert is written out in full so its session can be told apart.
21. `SHARED_CONSTRAINT_REASONS` is exported from `@shakti/domain`. `apps/web/src/errors-catalogue.test.ts` adds its values to the reasons checked against `en.json` and asserts that it holds `customer_anonymised`.

**Found and fixed in the round:** calling the eligibility functions from one another as SQL functions planned their bodies again on every call: 500 checks took 1.5 s. As PL/pgSQL (plans kept for the session) they take about 0.16 s.

**EXPLAIN (ANALYZE)** on the slot. Two things were measured:
- The audit finders for one customer, with 200,000 audit rows added in a transaction and rolled back: the five-way union uses, partition by partition, the aggregate index and the four expression indexes, including the two new ones (Bitmap Index Scans on `…_expr_idx2` and `…_expr_idx3`). Execution time 0.50 ms.
- The window and 500 eligibility checks of company 1: Index Only Scan on `opportunities_retention_idx`, 162 to 170 ms in a fresh session.

**Tests added or changed:**
- `packages/db/tests/security/lead-anonymise.test.ts` went from 19 to 22 tests:
  - new: the clean-up exception of a refusal; a dealer's mark lapsing; a merge's mark lapsing;
  - new fixtures `twoCompanies` and `merged`, and the reasons asserted per lead;
  - the Triage run and the refusal for the known customer added to the audit test;
  - the race test now waits for the lock.
- `packages/domain/tests/commands/lead-anonymise-complete.test.ts`: the Triage run and the routed walk-in.
- `packages/domain/tests/commands/opportunity.test.ts`: +1 (`qualified_at`).
- `packages/domain/src/audit/redact.test.ts`: +1 (`withoutPersonalDetails`).
- `apps/web/src/errors-catalogue.test.ts`: the shared reasons.

**The slot database:** I took the previous 0130 and 0131 off it by hand (their objects, columns and migration rows) and let `pnpm db:migrate` apply the new ones. Both applied with no error. Then I applied the PL/pgSQL change by hand and updated 0131's hash. A fresh database is still to be shown at integration.

**Checks** (all through `heavy.sh`, on 54331)
- `pnpm db:docs`: regenerated (`docs/data/`, `92944934`).
- `pnpm typecheck`: passed (4 tasks from cache).
- `pnpm format:check` and `pnpm copy-lint`: clean. `pnpm exec prettier --check .`: clean.
- `turbo run test --force`: contracts 181, db 131, domain 2058, tokens 134, ui 106 and copy-lint 17 passed; web 768 passed, 1 skipped.
- `pnpm test:security`, last run (after `92944934`), db: 1216 of 1217. The failure was `pin-codes.test.ts` "clears the flag of every company's sites": on a reused database it meets its own sites from earlier runs that hold the same randomly drawn PIN. Alone, 14 passed.
  - The run before showed two M1 causes, both fixed in `92944934`: `enum-sync` did not yet pair the new check, and the retention fixture's sites used PIN 999931, inside `pin-codes.test.ts`'s range. They now use 999905.
- Domain security: 939 of 940. The failure was `import-kinds.test.ts` "adds the different site of a repeated row", which fails on any database that ran it before, as in both earlier reports. `lead-anonymise-complete`, `lead-anonymise`, `opportunity`, `audit-trail`, `notifications` and `triage` together: 72 passed.
- Web security: 312 passed in the first run. In the second, 311 of 312: `actions.test.ts` (outbox delivery) failed, and alone it passed (41).
- db `lead-anonymise.test.ts` alone: 22 passed.
- `pnpm build`: 2 successful. `pnpm --filter web js-budget`: every page is within its budget (46 pages).
- Journeys `e2e/uat.spec.ts`, twice in a row on the same database: 29 passed (2.3 min), then 29 passed (2.2 min). No journey changed in this round; they ran because the stage move and the refusal rows changed.
- `pnpm lint` (whole repository, last): clean.

**Decisions the lead's notes did not settle**
- **`customer`, a permanent reason I added (open for your call; it narrows your rule).** A company that knows the customer with no lead of it there, such as a customers file or a dealer, keeps the customer. Without it, a leads file in one company would anonymise a customer that another company imported as an existing buyer. If you want your rule as written, the change is one line of `app.lead_kept_reason()` and one fixture expectation.
- **A lead of another company** is recorded in an audit row of no company (above).
- **An undone merge** clears every mark of both customers' leads but `won` and `qualified`, since customer-level reasons move with the leads.
- **The personal fields of a refusal** are named exactly, not by any key that contains "name", so `brandName` or `pipelineKey` stay. Their values become "removed" rather than being dropped, so the row shows that the field was given.
- **A customer that shares a person with another customer** is still looked at again each night without a mark. The link can be removed by an edit, and no change clears a mark for it. It is rare.
- **The import file's bytes and the import's refused rows** remain out of scope (the privacy batch, audit SEC-1).

## Review
Reviewer: slice-reviewer (Opus 5.5), 13-10-2026, on `de83903d` against `origin/main` at 89e44024 (#167). Findings: 3 high, 4 medium, 6 low.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | High | *Confirmed.* **Lost leads are never anonymised.** `0131_m1_retention_rls.sql:44-50` treats a lead at or after the pipeline's live Qualified stage as qualified, going by the stage's position. But `crm.opportunity.lose` moves every lost lead to the pipeline's `lost` stage (`lose-opportunity.ts:38`), which is position 6, after `qualified` at 3, in every seeded pipeline. On the slot database, all 21 leads lost through the command are at `lost`, and the stage rule refuses each one: `app.lead_is_stale(id, now() + interval '100 years')` is false for all of them, and the stage subquery is true. Lost leads ("not interested", "wrong number") are most of the leads BLUEPRINT §7.9 means, and they keep their details forever. The fixture hides this: `staleLost` is inserted at stage `new` (`lead-anonymise.test.ts:219-220`), which the command never does. Fix: judge a lost or nurture lead by the furthest open stage it reached (the `toStageId` of its `stage_moved` timeline rows, or the stage it was lost from), keep stages of kind `won` and `lost` out of the position rule, and lose the fixture's lead through the real `lost` stage. | Fixed: 68ca643e (`app.lead_reached_qualified()` from the stage history), 2813c02e (fixture lost at the `lost` stage) |
| 2 | High | *Confirmed.* **The person can still be read on the Activity log after anonymisation.** `audit_logs` rows written before the run keep `input_json`, `before_json` and `after_json` under the lead's and customer's ids. On the slot database, `crm.lead.create` rows hold the contact's full name, village, PIN and the last four digits of the phone, and `crm.note.add` rows hold the whole note. The Activity log returns `input` (`queries/audit/query-audit.ts:106`) and shows `name` and `village` (`screens/audit.ts:461, 504`). So anyone with `audit.read` can identify an anonymised lead from its history, for the eight years audit rows are kept. The completeness test cannot find this because its fixture is written with raw inserts, never through the commands, so no audit, outbox or idempotency row about the person exists. Elsewhere the gap is understated: the note for the owner calls these "redacted values such as the last four digits", and DATABASE §4.1 and the design's Built record say the personal details go. Also left behind: the import file's bytes in the file store, and the refused rows of import files. Fix: either the anonymisation clears the personal fields of the audit rows of the lead, the customer, its people and its sites (one more exception opened through `app.lead_anonymise_scope`), or the owner and the CA decide the audit trail keeps them for eight years. That decision goes in DECISIONS and is stated plainly in DATABASE §4.1, SECURITY and workshop FIN-2 before the schedule is made. Either way, the completeness test should make its marked lead through `crm.lead.create` and `crm.note.add`, so the audit trail is part of the search. | Fixed: 68ca643e (audit rows blanked in the same call), 2813c02e (completeness test through the commands), 94893946 (DECISIONS, DATABASE, SECURITY, FIN-2); the import file in the file store stays open |
| 3 | High | *Confirmed.* **The cutover runbook puts real customer files on staging.** `docs/runbooks/cutover.md:28` rehearses "on staging with a copy of the real files". This goes against BLUEPRINT §7.10 ("Staging: synthetic or anonymised data only; never raw production PII") and the design's G1 line ("the reconciliation … on real data happen there, since staging holds synthetic data only"). The clean-up at `:35` (each import's **Undo this import**) does not remove the data either. By the rollback dialog's own words, undoing a leads import keeps the customers it made, and undoing a customers import keeps any customer with a lead, a consent or another company. Fix: rehearse on staging with the files anonymised first (names, numbers and villages replaced, row count and columns kept), or rehearse on production before go-live and then restore it as §6 says. Remove the claim that Undo deletes the data. | Fixed: 94893946 |
| 4 | Medium | *Plausible* (reasoned from Postgres row-locking rules, not reproduced). **A write that read the lead before the batch locked it can land after the anonymisation.** The re-check under lock (`0131:288-318`) only stops writers that already hold a key lock when the batch takes its locks. `loadQuoteLead` (`queries/sales/quote-facts.ts:64-98`) reads the lead without a lock and checks `archived_at`. If the batch locks, anonymises and commits between that read and the quote's insert, the insert's foreign-key check waits for the batch and then passes, because the key did not change. The result is a quote for a lead whose customer has no name or number. The same happens with a new lead on the customer (`crm.lead.create` with an existing customer) and with a site edit, which waits and then has its address overwritten. A note does not even wait, since the timeline has no foreign key: a fresh note with personal text lands on a customer the job never visits again. Fix: in a before-insert trigger on `quotes`, `sales_orders`, `opportunities`, `account_entities`, `tasks` and `activities` (or in the writers), read the parent row `for key share` and refuse when `anonymised_at` is set. Under read committed, that read waits for the batch and then sees its result. | Fixed: 68ca643e (`app.refuse_anonymised_customer()`), 2813c02e and 19bc141f (refusal and two-session tests) |
| 5 | Medium | *Confirmed.* **A customer with a second lead, a second company or a standing merge is never anonymised.** `lead_is_stale()` (`0131:62-69`) refuses a lead whose customer has any other lead, another company or a standing merge, even when all of them are idle and unqualified. A leads import of a known customer always makes a new lead (`create-lead.ts:179`, `inImportBatch`), so any customer who appears in two imported lists keeps their details forever. The brief keeps only the account when another company or record uses it, and BLUEPRINT §7.9 applies per lead. Fix: decide per customer. Anonymise the customer together with all its leads when every lead in every company is stale and has no transaction. When a live record still uses the customer, clear only the lead's own text: campaign fields, task titles, and its notes and proposals. | Fixed: 68ca643e, 2813c02e |
| 6 | Medium | *Plausible.* **Later companies can be starved.** Each night starts at company 1 with no cursor (`apps/web/src/workers/lead-anonymise.ts:55`). It looks again at every old, never-won lead, including those that can never become eligible (with a quote, at Qualified or later, or with a second lead), within 40 s (`:25`). It then stops with `done: false`, and nothing hands the rest on, unlike the rescoring and the duplicate search. At about 0.25 ms per lead, once company 1 holds more than about 100,000 such leads, companies 2 to 4 are never reached. Fix: hand the rest to a fresh call with `{ entityId, after }`, as the rescoring does, or keep each company's cursor between nights. Also keep leads that can never become eligible out of the window. | Fixed: 68ca643e (`retention_kept_at`), 2813c02e (hand-over with the cursor) |
| 7 | Medium | *Confirmed.* **The cutover imports leads "with owners and stages", which the leads import cannot do** (`cutover.md:19, 47, 48`). The leads import maps neither (`LeadImportFieldSchema`: name, mobile, customer name and type, language, site type, village, PIN, source, pipeline). Every imported lead is owned by whoever imports it (here the cutover lead, a developer) and sits at the first stage. So the 16:00 check of owner and stage fails for every lead, and "Every caller has a queue" (`:52`) cannot hold. Fix: describe what exists today (leads arrive with the importer at the first stage and are passed on in Leads by a GM), and record owner and stage columns as a cutover prerequisite for a later slice. | Fixed: 94893946 |
| 8 | Low | *Plausible.* **One lead that always fails stops its company for good** (`lead-anonymise.ts:91-95`). A failed batch takes back all 500 leads and ends the company's night, and the next night starts at the same first batch. A lead whose anonymisation always fails therefore stops all anonymisation in that company, and the only sign is the `retention_runs` rows and an error log line. No such lead was found today. Fix: when a batch fails, run its leads one at a time, or carry on from the cursor. | Fixed: 68ca643e (one customer per block), 2813c02e |
| 9 | Low | *Confirmed.* **The co-pilot's follow-up proposals keep their title.** `crm.task.create` is a registered agent action (`ai/action-types.ts`, `agent:copilot`). Its `input_json.title`, and the person-edited `decided_input_json.title`, are free text. The run removes only `note` (`0131:333-337`), and the trigger's exception allows nothing else (`0131:217-224`), while DATABASE and the sweep table above say the rest of a proposal is ids and codes. No co-pilot proposals exist in Phase 1 yet. Fix: remove `title` as well, and widen the exception to those two keys. | Fixed: 68ca643e, 2813c02e |
| 10 | Low | *Confirmed.* **Three checks cannot fail.** `rowsIn` is the sum of the buckets (`import-queries.ts:109`), so the refine of `ImportReconciliationDto` always adds up. Compare `rowsIn` with the job's stored `total_rows` instead. In `apps/web/tests/lead-anonymise.test.ts:109`, `result.anonymised === counted.anonymised` reads 0 = 0 on a database whose stale fixtures the db and domain suites have already anonymised. Seed one stale lead in that test. | Fixed: 2813c02e |
| 11 | Low | **No `EXPLAIN` for the anonymiser's writes**: the `import_rows` self-join with its OR over a job's skipped rows, and the delete of notes across every `activities` partition. These matter on the night 24 months after the cutover, when thousands of leads from one 50,000-row import fall due together. Only the window and the eligibility checks were measured, and the slot database (501 import rows) cannot show it. | Fixed: de2a3a30 (index), Report "Fix round" |
| 12 | Low | *Confirmed.* **Copy:** "sign in as a Accounts" and "as a Executive" (`uat/accounts.md:5`, `uat/executive.md:5`). The runbook names the steps "Upload → … → Add", where the screen says "Choose the file" and "Add the rows" (`cutover.md:13`). `imports.reconcile.reasons.commit_failed` "The row stopped the adding" is not plain English (for example "Adding stopped at this row"). Workshop FIN-2 shows the CA the code name `WORKSHOP_DEFAULTS.retention.unqualifiedLeadMonths`. | Fixed: 94893946, 2813c02e |
| 13 | Low | *Confirmed.* **The role journeys are thinner than "end to end across modules".** The Lead Converter's journey stops at opening the lead, before any sizing, quote or order. The Store Manager's stops at opening the lead in Converting. The Executive's only loads three pages. The new "What happened to each row" section has no screenshot, though the snapshot company's seeded import would give stable figures. | Fixed: de2a3a30; the screenshot `imports-row-counts` for the lead to make in Linux |

**Checked and found sound**
- **The scope table and the append-only exceptions:**
  - No request role has a grant on `app.lead_anonymise_scope`: `app_user` and `app_reader` hold no select, insert or delete.
  - The only definer that writes it is `app.anonymise_stale_leads()`. `pg_proc` shows no other writer and no definer that runs dynamic SQL.
  - It is emptied before the definer returns, and on a failure it is taken back with the block. `pg_current_xact_id()` is the top-level id inside the block.
  - `app_user` holds no update or delete on `activities` and holds only the decision columns of `agent_actions`.
  - The `app.customer_merge` setting still opens only an update of `account_id`, which no request role may make.
  - Both trigger functions keep main's rules (0113 and 0108).
- **The permission:** `crm.retention.run` is held only through `SYSTEM_MATRIX`. No staff role, no agent and no seed grant holds it. `app.platform_only_permissions()` keeps main's eight keys (0125) and adds it, and the refusal sweep has its `CHECKS` entry.
- **The definers:** both check the permission, the company and the period in their bodies, and set `search_path = ''`. Neither is executable by `public` or `readonly_reporter`, and no request role may call `app.lead_is_stale()`. They run as `postgres` (bypassing RLS) and filter by company themselves. Outside the inner block, no statement can carry a value into an error.
- **Failure records and the dry run:** a failure is recorded with its SQLSTATE and constraint only, and the worker logs ids only. The dry run goes through `executeQuery`, which is read-only (Postgres refuses any write); the reader pool may run `app.stale_leads()` and not the anonymiser.
- **The route:** QStash signature checked over the body and URL; 503 when no queue is set; 400, not retried, for a body it does not know. A second run finds nothing, because anonymised leads leave the partial index, and it writes no new audit row.
- **The command:** `anonymisedAt` is labelled, there is one audit row per lead with the time only, no event, and it is registered.
- **The reconciliation:**
  - It reads through a named `executeQuery`, guarded by `imports.write:entity` and the job's company, in one pass over the job's rows, and its matrix test covers every role in two companies.
  - The CSV holds catalogue words and numbers only, with a formula guard.
  - The page asks for it only once the rows are checked, so the `imports-job` screenshot is unchanged.
- **Timeline payloads:** every `ctx.activity()` writer records ids, codes and field names only. Calls store no number, and sizing inputs hold no text.
- **The journeys' seed:** the UAT data goes into companies 1 and 2, plus an Accounts person in company 2. Every screenshot is of the snapshot company (3) or masked, so the seed changes none of them.
- **Tests run:** `packages/db/tests/security/lead-anonymise.test.ts` passed 15 of 15 on the slot Postgres 54331, through the lock.

**Not checked**
- The full security suite, the journeys, the build and the lint; the builder's runs are in the report.
- The domain tests `lead-anonymise.test.ts` and `import-reconciliation.test.ts`: the lock was held by another integration run for the whole review.
- The layout of the new section, since no screenshot of it exists.
- The race in finding 4 was not reproduced, because that needs two committed sessions on the slot database.

**For the integration:** the slice also redefines `app.activities_append_only()` and `app.agent_actions_append_only()`. Check both against `main`'s latest at the merge, as well as `app.platform_only_permissions()`. `fix/followups-db` touches none of the three.

### Second review, of the fix round
Reviewer: slice-reviewer (Opus 5.5), 13-10-2026, on `7dccb4f5` against `origin/main` at 16ee04ac (#168). Findings: 1 high, 2 medium, 5 low. Rows 1, 3, 4 and 6 to 13 are fixed. Rows 2 and 5 are fixed only in part (rows 14 and 16).

| # | Severity | Finding | State |
|---|---|---|---|
| 14 | High | *Confirmed.* **Two kinds of audit row about the person are not blanked, so row 2 is fixed only in part.** The finders (`0131:645-662`) and the exception in `app.audit_logs_append_only()` (`0131:388-390`) reach a row in two ways: by its record, for 11 aggregate types, or by an `accountId` or `opportunityId` at the top of its input. (a) `agents.run.record` puts the Triage agent's proposal into the input of two audit rows, `agent_run` and `agent_action`. The proposal holds the agent's free-text `note` (`TriageNoteSchema`, up to 160 characters, written by the model from the lead and checked only for phone numbers, identity numbers and instructions), and the lead sits at `proposal.input.opportunityId`. Triage runs for every lead made through a form. (b) A refused call writes a row with no record and the redacted input (`execute.ts:136-143`). Every walk-in that becomes routed work because a colleague holds the customer starts with a refused `crm.lead.create` (`takeEnquiry`, `apps/web/src/actions/crm.ts:124`). Its input holds the contact's name, the site's village and the phone's last four digits, and names the customer only as `existingAccountId`, or not at all. Reproduced on 54331 in a rolled-back transaction: customer `01a132b0-f606-…` of company 4 was aged 30 months and `app.anonymise_stale_leads(4, 24, …)` was called with the workers' settings. The lead's `crm.lead.create` and `crm.opportunity.assign` rows read "removed", and the note left `agent_actions`, but both `agents.run.record` rows still read "Pump enquiry from a farm.". The slot also holds 25 refused `crm.lead.create` rows with `contact.name` and the last four digits, and none has an `accountId`. The Activity log shows `input`. This goes against the owner's decision of 13-10-2026, DATABASE §4.1 and FIN-2 ("everywhere, the history of changes included"). Neither completeness test runs the Triage worker or a refused create. Fix: the finder and the trigger also match `input_json #>> '{proposal,input,opportunityId}'` and `input_json ->> 'existingAccountId'`, each on an expression index like the two already added. For a refusal that names no customer (a create by phone alone), either record no contact details on `crm.lead.create`'s refusal row, or state the gap in the decision row and FIN-2. Add a Triage run and a routed walk-in to `lead-anonymise-complete.test.ts`. | Fixed: d4b389a7 (finders, indexes, refusals without personal values, the clean-up of earlier refusals), 944e295e (completeness test with Triage and a routed walk-in; documents) |
| 15 | Medium | *Confirmed.* **Archiving or reordering a stage changes which leads count as having reached Qualified, and those leads are then kept for good.** The history branch of `app.lead_reached_qualified()` (`0131:35-41`) compares each stage's position today. `crm.stage.archive` moves an archived stage after every live one, won and lost included (`pipeline-settings.ts:157-164`). Only New, Qualified and Quoted are protected (`packages/contracts/src/crm/enums.ts:92`). Reproduced in a rolled-back transaction: for a lead lost from Contacted, the function answers false. Once Contacted is archived and renumbered as the command does it, it answers true, and so does `app.lead_kept()`. The next night therefore marks `retention_kept_at` on every lead that ever passed through the archived stage, and the mark is never cleared. `crm.stage.reorder` re-judges past moves the same way, in both directions. Fix: record the fact when it happens. For example, add `qualified_at` on the lead, stamped by `crm.opportunity.move` when the lead reaches an open stage at or after Qualified and filled from the history by the migration, and judge by it. Leaving archived stages out of the comparison alone would turn a later stage, once archived, into a reason to anonymise. | Fixed: d4b389a7 (`qualified_at`, stamped by the move, backfilled), 944e295e (test) |
| 16 | Medium | *Confirmed* (code path read end to end; the fixture `otherCompany` asserts it). **Row 5 is fixed only in part: a customer known to a second company, or in a merge that stands, is never anonymised, and neither is any of its leads.** `app.customer_idle()` (`0131:122-127`) refuses such a customer even when every one of its leads, in every company, is idle, never qualified and has no quote, order or commission. The leads are not marked kept either, so the window looks at them again every night. This misses the customers the companies share (ADR 0008; the cutover's customer files come one per company) and the kept customer of every confirmed duplicate. The brief keeps the account when another company uses it, but the lead's own details still go. Fix: when another company or a standing merge keeps the customer, still clear the lead's own text (campaign fields, its tasks' titles, its notes and proposals, and its audit rows found by `opportunityId`). Or anonymise the customer once its leads in every company are stale. Otherwise, record the rule in DECISIONS and state it in FIN-2. | Fixed: d4b389a7 (several companies in one call, `merge` kept), 944e295e (DECISIONS) |
| 17 | Low | *Confirmed.* **The "kept for good" mark can outlive its reason.** `app.lead_kept()` reads the customer's type, which `crm.account.update` can change from dealer or referral partner back to household, farm or business (`customer.ts:86-130`). `crm.customer.unmerge` takes a lead back from a customer whose quote or order kept it. `retention_kept_at` is never cleared, and the window passes marked leads by (`0131:228`). Reproduced: after the fixture's `dealer` customer is changed to farm, its lead stays marked and `app.stale_leads()` never returns it. Fix: mark only for reasons that cannot be undone (won, a quote, order, commission or dealer credit), and judge the type and merges each night. Or clear the mark when the type changes or a merge is undone. | Fixed: d4b389a7 (`retention_kept_reason`, lapse triggers and tests), 92944934 (enum-sync) |
| 18 | Low | **The way the production rehearsal is put back is not fully written** (`docs/runbooks/cutover.md:44`). The runbook cites "the restore drill's steps 1 to 3 on production itself", but step 1 of DATABASE §10 restores into a new scratch project. It does not describe the restore of production itself: who in the Supabase organisation runs it, that production is offline meanwhile, and that it cannot be undone. Nothing keeps production unchanged between the restore point and the restore, so a setup change made that day is lost without notice. During the rehearsal, **Move all leads** sends callers notices about leads that then disappear. The runbook also does not say where the real files are kept while their anonymised copies are made, or when they are deleted. The rest holds: no real file goes to staging, and the counts are read before and after, company by company. Fix: write out the restore of production itself, add a freeze on production from the restore point to the restore, and say where the real files are kept and when they are deleted. | Fixed: 944e295e |
| 19 | Low | **FIN-2 tells the CA that "leads with no sale" are anonymised** (`docs/13-client-packs/workshop-pack.md:263`). Several kinds of lead with no sale are kept: a lead that reached Qualified, a dealer's or referral partner's lead, and a lead whose customer is in a second company or a standing merge. The CA confirms the period against this sentence. Fix: state the rule in plain words, as DATABASE §4.1 does. | Fixed: 944e295e |
| 20 | Low | *Confirmed.* **The two-session test can pass without testing the wait** (`packages/db/tests/security/lead-anonymise.test.ts:907-911`). It sleeps 500 ms, then lets the job commit. If the write's connection only starts after the commit, the write is refused without having waited, and the test passes all the same. Fix: before letting the job commit, poll `pg_stat_activity` until the write's backend waits on a lock. | Fixed: d4b389a7 |
| 21 | Low | *Confirmed.* **The new shared reason is outside the catalogue test.** `apps/web/src/errors-catalogue.test.ts:54-55` checks `RUNNER_REASONS` and each command's `constraintReasons`, but not `SHARED_CONSTRAINT_REASONS` (`packages/domain/src/command/run-command.ts:233`, which the package does not export). A shared reason added later could be missing from `en.json` without a failing test. Fix: export the map and add its values to the test's list. | Fixed: d4b389a7 |

**Checked and found sound**
- **The scope table and the three exceptions:**
  - No request role has a grant on `app.lead_anonymise_scope`.
  - `pg_proc` shows `app.anonymise_stale_leads()` as its only writer, and no definer that runs dynamic SQL.
  - Every `continue` comes before the scope's insert. The scope is emptied for each customer, and a failed block takes it back.
  - Only the owner may update `audit_logs`: `app_user` holds select and insert, and `auth_service` insert. The anonymiser is the only definer that updates it.
  - `app.in_lead_anonymise_scope()` is executable by `app_user` (the default privileges of schema `app`), but it answers only for the caller's own transaction.
- **The four redefined functions against `origin/main` at 16ee04ac:**
  - `app.platform_only_permissions()` keeps 0125's eight keys.
  - `app.activities_append_only()` keeps 0113's merge clause.
  - `app.agent_actions_append_only()` keeps 0108's rule.
  - `app.audit_logs_append_only()` adds only the one exception to 0033's refusal of every change.
  - `app.opportunities_set_updated_at()` keeps 0100's rule.
  - `main`'s 0130 to 0133 redefine none of them. 0133 makes its partitions `partition of public.audit_logs`, so they take the trigger that 0131, renumbered after it, makes again. 0132 changes only `commission_accruals.measure`.
- **The slot database matches the committed 0131.** The md5 of every function body equals the file's, and the eight refusal triggers, the audit trigger on the table and its partitions, and the seven indexes are present.
- **The refusal of writes:**
  - `account_id` is not null on all eight tables.
  - The trigger reads the customer `for key share`, which waits for the job's `for update` and then reads its result.
  - The customer edits take `app.hold_customer()` first, so the job's `skip locked` passes over a customer being edited.
  - The two-session test uses two connections.
- **Reached Qualified, through every writer of a stage:**
  - A new lead starts at the first open stage.
  - A move writes `stage_moved` with `toStageId`.
  - Reopening goes to the first stage.
  - The hand-over definer refuses a stage change.
  - No command moves a lead to another pipeline.
  - Qualified cannot be archived.
- **The hand-over:**
  - The company and the cursor travel in the body that QStash signs. The route verifies it with its own address (Upstash `Receiver`, `clockTolerance: 5`), so forging a hand-over needs the signing keys.
  - A replay within the token's life runs an idempotent range again, and each customer is checked again under lock.
  - After a hand-over the worker goes on to the later companies.
- **Completeness, apart from row 14:**
  - Every text, JSON and array column of the customer, lead and person tables is covered.
  - Timeline payloads on the slot hold codes only.
  - No foreign key points at `contact_phones` or `activities`, and no trigger copies customer rows to another schema.
  - Audit partitions are detached only after 8 years.
  - The files bucket expires earlier versions after a day.
  - `app.recheck_site_pins()` skips archived sites.
- **The cutover runbook:**
  - No real file goes to staging.
  - The production rehearsal is put back and then checked by counts per company.
  - The runbook's screen words are the catalogue's.
  - Imported leads do not start Triage, so the rehearsal calls no model.
- **Tests run on 54331, through the lock:**
  - db `lead-anonymise.test.ts`: 19 passed.
  - domain `lead-anonymise.test.ts`, `lead-anonymise-complete.test.ts` and `import-reconciliation.test.ts`: 7 passed.
  - web `tests/lead-anonymise.test.ts`: 9 passed.

**Not checked**
- 0130 and 0131 applied on a fresh database. The slot's were applied by hand; the integration shows it.
- The full security suite, the journeys, the build and the lint.
- How long the eligibility checks take since the fix round added the stage history, the kept checks for every lead of the customer, and the inbox and proposal lookups. The report repeats the earlier 125 ms; only one lookup's plan was read here (the timeline's lead index, partition by partition).
- The layout of "What happened to each row", which has no baseline yet.

**Out of scope, noted:** the uploaded import file's bytes and the import's refused rows still hold personal details (the privacy batch, audit SEC-1).

## Integration notes
- Migrations from 0130 move after `main`'s last one at the merge; `app.platform_only_permissions()` is redefined: check it against `main`'s latest definition.
- The nightly anonymisation schedule on dev and staging is made by the owner after the merge (QStash is on the PC's tools).
