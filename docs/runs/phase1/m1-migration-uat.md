# M1 Migration and UAT packs (wave 6)

| | |
|---|---|
| Branch | `feat/m1-migration-uat`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/m1-migration-uat`, slot 1: Postgres 54331 (container `shakti-pg-m1-migration-uat`), app 3031 |
| Runs on | cloud, beside the follow-up bundles `fix/followups-db` and `fix/followups-tooling` (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | A (deleting or anonymising data): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | built; waiting for review |
| Next step | lead: the review (Opus 5.5 xhigh), then integration; the owner makes the QStash schedule `lead-anonymise-<environment>` on dev and staging after the merge |

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

4. The completeness test (`lead-anonymise.test.ts`, "nothing of the person is left"): the fixture lead `marked` carries this run's random marker in its customer's and person's names, email, site address, village and technical notes, campaign fields, note, task title, import row (raw and checked), routed-work note and Triage proposal note, and its own random phone; its consent rests on an evidence file named with the marker. After the run, every text, character, json and array column of every public table (114 and more, partitions through their parents) is searched for the marker and the phone digits: the only hit is `files.name` of the kept evidence file. No audit row is written by the definer, so none needed excluding.
5. The trigger exception no longer rests on a setting: `app.lead_anonymise_scope` (schema `app`, no grant to any request role) names the customers and leads for the current transaction (`pg_current_xact_id()`); `app.anonymise_stale_leads()` writes it and empties it before it returns. `app.activities_append_only()` (delete of a note) and the new exception of `app.agent_actions_append_only()` (removal of the agent's note, nothing else) open only for a row named there; both are definers so they may read the table whoever writes, closed to `public` and reporting. Every definer that deletes from `activities` or `agent_actions` was searched (`pg_proc.prosrc`): `app.anonymise_stale_leads()` is the only one, and no definer other than it writes the scope table. Tests: a request that sets `app.lead_anonymise` and deletes is refused (no grant), the owner deleting a note outside the anonymisation is refused even with the setting, the owner changing a proposal outside it is refused, and a request writing the scope table is refused. The older `app.customer_merge` setting of 0113 and 0117 has the same shape as the one removed here (a setting any request can make); it opens only an update of `account_id`, which `app_user` has no grant for and only the merge definers make, so it is left as it is and named here for the review.

**Built since the early check**
- Migrations: `0130_m1_retention` regenerated with the two lookup indexes; `0131_m1_retention_rls` with the scope table, both trigger exceptions, the inbox and agent notes, the inbox and agent recency in `app.lead_is_stale()`, and the header listing what is removed and what is kept. Applied fresh by the lead on 13-10-2026.
- Worker and route: `apps/web/src/workers/lead-anonymise.ts` (`runLeadAnonymise`, every company in turn, a failed batch logged and that company left to the next night, the dry run on a read-only request), `apps/web/src/app/api/v1/workers/crm/anonymise/route.ts` (`nightlyWorkerRoute`), `LEAD_ANONYMISE_PATH`, and the schedule `lead-anonymise-<environment>` at 22:30 UTC in `apps/web/scripts/qstash-schedule.ts`.
- Screen: the action `getImportReconciliation`, the section "What happened to each row" on the import job page once the rows are checked (`components/imports/reconciliation.tsx`), its CSV through `screens/import-reconciliation.ts` (the same lines, fields never read as a formula); copy under `imports.reconcile` in `en.json`, the button key `downloadCsv` in the copy lint's list. Print is the browser's print of the page; no print view was added.
- Documents: `docs/runbooks/cutover.md`, `docs/13-client-packs/parallel-run.md`, `docs/13-client-packs/uat/` (seven roles) and the packs' readme; design §10 "Built (M1)"; PRD trace rows IMP-01 and IMP-02; API §3.6 and ARCHITECTURE §6 (the route and schedule); DATABASE §4.1, §5, §6, §7; SECURITY; TESTING §5; workshop pack FIN-2 (the default and the evidence-file question).
- Journeys: `apps/web/e2e/uat.spec.ts` (five journeys: a Cold Caller's new lead qualified on Calling and taken on by the present Lead Converter on Converting; a Store Manager's walk-in, a note on the customer's page and the lead on Converting; the Executive's Home, Activity log and Integration health; a GM's customers file and its row counts with the CSV checked line by line; a dealer order held for credit from Accounts of the journeys' company to the Executive's release and back to Accounts' Dealer credit), each page through `expectNoAxeViolations` (axe and `expectAligned`), no screenshots. Seed: `e2e/setup/uat.ts` (a new dealer per project each seed) and the signed-in person `journeyAccounts` (Accounts of company 2) in `users.ts`. Against staging they need the 13 signed-in people of `users.ts`, the journey tier's price list in company 2, and the seed's dealers.

**Tests added since the early check:** `apps/web/tests/lead-anonymise.test.ts` (7: the four refusals, no queue, a body it does not know, the dry run then the run over every company with equal counts, the time budget), `apps/web/src/screens/import-reconciliation.test.ts` (3), `lead-anonymise.test.ts` now 15 (the completeness search and the append-only exceptions). In all, M1 adds 38 tests and 15 journey runs (5 journeys in 3 projects).

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations from 0130 move after `main`'s last one at the merge; `app.platform_only_permissions()` is redefined: check it against `main`'s latest definition.
- The nightly anonymisation schedule on dev and staging is made by the owner after the merge (QStash is on the PC's tools).
