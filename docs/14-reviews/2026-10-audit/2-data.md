# Auditor 2: data layer, migrations, query performance, workers (main at 23f78a5)

## Score

**8 / 10.** The data layer is the strongest part of the codebase I looked at:
- The schema and the 130 migrations do not drift.
- Every redefined function and check keeps what earlier versions added.
- All 77 business tables force RLS.
- The ledgers are append-only in the database itself, through triggers and the absence of UPDATE, DELETE and TRUNCATE grants.
- Money columns carry totals checks.
- The outbox is leased, counts its attempts, backs off with jitter and dead-letters.
- `withRequestContext` is safe to use with a connection pool.

The marks come off for the event delivery around QStash and for the operations side of the jobs:
- "Send again" on an event whose worker failed does nothing. QStash keeps a deduplication id for 90 days, and a replay reuses it.
- A large import starves every other event for minutes or hours, and readiness reports down meanwhile.
- No one is told when a pg_cron retention or partition job fails.

To reach 10:
- Fix DATA-1 and DATA-2.
- Read `retention_runs` and the pg_cron outcomes into Integration Health or an alert (DATA-3).
- Write new widenings of list checks as `NOT VALID` (DATA-5).
- Add a performance check under RLS with statistics: today it can only be run on a committed scratch database (see the limits at the end).

## Findings

| id | severity | effort | title | file:line | failure path | fix |
|---|---|---|---|---|---|---|
| DATA-1 | high | S | "Send again" for an event whose worker failed is silently dropped by QStash's deduplication | `apps/web/src/workers/qstash.ts:214`, `:180-187`; `packages/db/migrations/0054_outbox_reliability.sql:66` (`app.replay_dead_letter`) | 1. An event, for example `files.file.uploaded` or `knowledge.file.index_requested`, is published with `deduplicationId: event.id`. 2. Its worker fails through QStash's retries, say during an S3 or OCR outage, and the failure callback holds it back as `worker_failed`. 3. Following `docs/runbooks/incidents.md:36`, the Executive fixes the cause and presses Send again. 4. `replay_dead_letter` resets the row with the same id, and the publisher sends it again with the same `deduplicationId`. 5. QStash keeps deduplication ids for 90 days (`@upstash/qstash` 2.12 `client-*.d.ts:2276`), so it answers `{messageId, deduplicated: true}` and delivers nothing. 6. `resultOf()` treats any answer with a `messageId` as accepted, so the row is marked `published_at`. **Result:** the file stays unchecked, the vault file stays unindexed, and the PDF stays unrendered. Nothing is listed or alerted. The e2e "Send again" passes only because it runs in process, without QStash. Confirmed by reading the code path end to end; QStash's behaviour is from its SDK documentation, not run live. | Give each delivery generation its own deduplication id, for example `${id}:${replays}` with a `replays` counter that `replay_dead_letter` increments, or the dead-letter time. Treat `deduplicated: true` as a failure (`queue_deduplicated`) for a row that was replayed. Add a test with the QStash publisher that replays a held-back event. |
| DATA-2 | medium | M | One publisher run sends 100 events, so an import starves every other event and turns readiness down | `packages/domain/src/outbox/publisher.ts:15,148`; `packages/contracts/src/imports/enums.ts:139`; `packages/domain/src/imports/commit-leads.ts:346`; `apps/web/src/workers/outbox.ts:21`; lease order `packages/db/src/outbox-client.ts:72` (`order by sequence`) | 1. Each import batch commits 500 leads and 500 `crm.lead.created` events. That type is subscribed (Triage), even though Triage ignores `imported` leads (`apps/web/src/workers/triage/triage-event.ts:21`). 2. Each batch nudges a single run, and a run claims 100 events in sequence order. So a 50,000-row cutover leaves about 40,000 events. 3. Outside working hours they drain at the minute schedule's 100 a minute, which is about 6.5 hours. 4. Meanwhile every later subscribed event waits behind them: upload checks, quote PDFs, handovers and lead-assigned notices. 5. Readiness (`OUTBOX_MAX_DUE_SECONDS = 300`) answers 503 for the whole time. A 5,000-row import at night keeps readiness down for about 35 minutes. QStash also bills 50,000 messages that do nothing. Confirmed by reading the code, not run against QStash. | Mark imported leads' events as not to be delivered: emit them with `imported: true` and skip them at publish time for Triage, or use a separate unsubscribed type. Let a run loop while it claimed a full batch and time remains (the route has 60 s). Consider ordering the lease by `(priority, sequence)` so bulk events cannot block interactive ones. |
| DATA-3 | medium | S | No one is told when a pg_cron retention or partition job fails | `packages/db/migrations/0088_c2_review_rls.sql:226` (`raise warning` only); `retention_runs` is read by no code (`grep` over `packages/domain/src` and `apps/web/src`: no hits); `docs/05-database.md:524` | 1. `activities-partitions` catches each month's error, writes it to `retention_runs.error` and raises only a WARNING, so pg_cron records the run as succeeded. 2. `outbox-events-purge` and `audit-logs-detach` raise, but the failure lands only in `cron.job_run_details`. 3. Nothing reads either table: Integration Health, readiness and the Sentry alerts cover the outbox alone. 4. A run of failures, for example after a permission or extension change on the hosted project, goes unnoticed. Once three monthly runs are missed, activities land in `crm_partitions.activities_default`. From then on, creating that month's partition fails for good ("updated partition constraint for default partition would be violated"), and lists over the timeline lose partition pruning. Confirmed: the code paths and the grep. | Show the last run and error of each job (`retention_runs`, plus `cron.job_run_details` through an owner definer) on Integration Health. Report `retention_runs.error is not null` and a job missing for over 35 days in the readiness log or a Sentry alert. Add a runbook step for moving rows out of a default partition. |
| DATA-4 | low | S | The failure callback can arrive before the publisher records the event as delivered, and the dead letter is then lost | `packages/db/src/outbox-client.ts:168-180` (`where … published_at is not null`); `apps/web/src/app/api/v1/workers/outbox/failed/route.ts:71` (answers 200 on `unchanged`) | 1. The publisher leases the events, calls `batchJSON`, and only then records `published_at` in a second transaction. 2. Meanwhile QStash delivers, the worker refuses with 400, 403 or 404 (no retry), and QStash calls the failure callback at once. 3. If that callback reaches `holdBackFailedEvent` first, `published_at` is still null, so the hold-back answers `unchanged` and the route answers 200. QStash does not retry. 4. The publisher then marks the event delivered. **Result:** a permanently refused event never appears in Held-back updates and no alert is raised. QStash is in the EU and the app in Mumbai, so this happens rarely; it becomes likelier when a batch is large or the `record` transaction is slow. Plausible. | Answer 503 to QStash on `unchanged` while the row is still leased (`claimed_until > now()` and `published_at is null`), so QStash retries the callback. Alternatively, let the hold-back also accept a leased row and have `record` keep the dead letter. |
| DATA-5 | low | S | Each new activity type re-validates the whole `activities` table under ACCESS EXCLUSIVE in the deploy transaction | `packages/db/migrations/0114_calls.sql:22,30` (likewise `0112_duplicates.sql:58,96`, `0094_sizing_timeline.sql:3-4`); single-transaction migrator `packages/db/src/migrate.ts:153` | 1. drizzle-kit writes a widened list check as `DROP CONSTRAINT` plus `ADD CONSTRAINT … CHECK`. 2. On the populated table after G1, the ADD scans every partition while it holds ACCESS EXCLUSIVE, and the lock lasts until the whole multi-migration transaction commits. 3. Every command that writes a timeline row (almost every CRM command) blocks or fails on `lock_timeout` for that time. 4. `activities` is the largest table, and Phase 2 adds types (WhatsApp, voice). Not measured: no DDL was run. Plausible. | Write a widening as `ADD CONSTRAINT … NOT VALID`: rows that met the narrower list meet the wider one, so no `VALIDATE` is needed. Note the rule in AGENTS §6 next to the `CONCURRENTLY` rule. |
| DATA-6 | low | S | Each 5-minute notification scan writes an audit row per company even when it finds nothing | `packages/domain/src/command/run-command.ts:476` (`changes.length > 0 ? changes : [{}]`); `packages/domain/src/commands/notifications/notify.ts:243-291` | `notifications.due.scan` runs every 5 minutes for each company, and the runner writes one audit row per call even when nothing changed. That is 1,152 rows a day with four companies, about 420,000 a year. They are kept for 8 years (BLUEPRINT §7.9) and fill the Activity log's lists and the `audit_logs` partitions with no-ops. The nightly batches add more. Confirmed by reading the code. | Allow a command to declare `auditWhen: 'changed'` and skip the row when `changes` is empty, for the scan and for the empty nightly batches. |
| DATA-7 | low | S | No database check ties the GST columns to `supply_kind` | `quotes_totals_check` and `sales_orders_totals_check` (`packages/db/migrations/0109_quotes.sql`, `0116_s2_orders.sql`), and the line checks | The totals checks verify `tax_total = cgst + sgst + igst` and that the amounts are not negative. They allow an `intra` quote with IGST, or an `inter` quote with CGST and SGST. A defect in the engine or in a future write path would then persist a wrong split on a document that reaches the CA and Tally, and nothing in the database refuses it. The tax engine is the only guard. Confirmed from the live constraint definitions. | Add `(supply_kind = 'intra' and igst = 0) or (supply_kind = 'inter' and cgst = 0 and sgst = 0)` to the header and line checks (`NOT VALID`; validate afterwards, outside the deploy). |
| DATA-8 | low | S | Redundant index `files_entity_idx` | `files_entity_idx (entity_id)` is a prefix of `files_entity_purpose_created_idx (entity_id, purpose, created_at desc)` (live `pg_indexes`) | Every upload pays to maintain a second index that no plan needs. The cost is small today, but this table holds every file. Confirmed. | Drop it in a new migration, with the `notifications_entity_dedupe_idx` drop already planned. |

## Checked and sound

**Schema against migrations.** I ran `drizzle-kit generate` from the schema into a scratch copy of `migrations/`: "No schema changes, nothing to migrate". The journal has 130 entries:
- their times strictly increase;
- the files and tags match one to one;
- the live database has all 130 applied (`drizzle.__drizzle_migrations`).

**Functions and checks redefined across migrations.**
- `app.platform_only_permissions()` has 8 versions. The live one is a superset of every earlier list: `files.process`, `imports.process`, `crm.score.refresh`, `crm.duplicates.scan`, `sales.quote.expire`, `notifications.send`, `knowledge.index`, `crm.handover.run`.
- `activities_type_check`: the live list is a superset of the lists in 0075, 0094, 0112 and 0114.
- `merge_customers` and `unmerge_customers` (redefined in 0117) cover dealer orders and dealer credit. Tasks, quotes, tags and quote orders follow through `ON UPDATE CASCADE` foreign keys.
- `enum-sync.test.ts` pairs every list check with its contract.

**Types.**
- No `timestamp without time zone`, `real`, `double` or `money` column in `public`.
- Money is `numeric(14,2)`, rates `(14,4)` and percentages `(5,2)`, as DATABASE §3 says.
- Every `entity_id` is `smallint`.
- Quotes and orders carry totals, round-off, acceptance, cancel, hold and release checks.

**RLS and roles.**
- All 77 public tables have RLS enabled and forced.
- The `activities` and `audit_logs` partitions live in `crm_partitions` and `audit_partitions`, with no grant to `app_user`, `app_reader` or `readonly_reporter`.
- The append-only and merge-only triggers propagate to every partition.

**Append-only in the database.** `app_user` holds no UPDATE, DELETE or TRUNCATE on these tables, and triggers refuse other changes:

| Table | What may still change |
|---|---|
| `audit_logs`, `price_change_log`, `calls`, `sizings`, `quote_lines`, `quote_versions`, `sales_order_lines`, `agent_runs`, `targets` | Nothing |
| `activities` | `account_id`, only by the merge definer |
| `commission_accruals` | Only its cancel |
| `dealer_terms`, `dealer_outstanding` | Nothing (`dealer_credit_append_only`) |
| `outbox_events` | The delivery columns only; deletes only by the 30-day purge; replay and hold-back only for their roles |

**Outbox.**
- Rows are written in the command's own transaction (`run-command.ts:489-497`).
- The lease uses `for update skip locked` and counts an attempt at lease time, and the record step is guarded by the lease text.
- Backoff runs 1 to 60 minutes with ±20% jitter, and an event is dead-lettered after 10 attempts (about 4 hours).
- `no_outcome` events are dead-lettered by the next lease.
- Consumers are idempotent through the Redis `evt:{id}` claim (6-minute TTL, 7-day done), with `latest-only` ordering available.
- The publisher's role is narrow (`outbox_publisher`).
- Model calls run outside any transaction (`packages/domain/src/ai/runtime.ts:157`).

**Connections.**
- Every `set_config` in `withRequestContext` is transaction-local, read-only is set in the same first statement, and `app_reader` has `default_transaction_read_only`.
- Role-level limits: `statement_timeout` 30 s, `lock_timeout` 10 s, `idle_in_transaction_session_timeout` 30 s.
- Pools use `prepare: false` for Supavisor, open lazily (no secret is read at import), and verify TLS against the CA.
- The migrator takes an advisory lock and has `lock_timeout` 10 s.

**Concurrency and nightly jobs.**
- Dealer credit takes the order row lock and then a per-dealer `pg_advisory_xact_lock`. Read Committed then sees the first confirmation. I found no lock-order inversion.
- The nightly batch runners hand over through deduplicated QStash calls keyed by night and position.
- The notification scan definers use `tasks_open_calls_due_idx`, `quotes_open_valid_until_idx` and `opportunities_open_created_idx`, at 26 ms, 17 ms and 0.2 ms with 321,000 tasks.

**Performance at volume.** Synthetic data, generated and rolled back inside one transaction: 200,000 customers, 240,000 leads, 320,792 tasks, 596,436 calls, 1,440,000 activities, 40,000 orders and 120,000 notices.

Under RLS, as `app_user`, with the real domain functions (EXPLAIN ANALYZE):

| Query | Time |
|---|---|
| Leads list, caller | 0.3 ms and 5 ms |
| Leads list, team lead | 68 ms |
| Leads list, GM | 149 ms |
| Leads list, Executive across 4 companies | 225 ms (by score: 168 ms) |
| Timeline page | 0.5 ms |
| Notification centre | 15 ms |
| Bell | 0.14 ms |
| My tasks | 2 ms |
| Converting board | 166 ms in 7 statements |
| Board | about 640 ms in 8 statements (count 130–258 ms) |
| GM home pipeline | 359 ms |
| GM home response times | 151 ms |
| GM home sales | 0.6 ms |
| Orders list (GM, drafts) | 1.2 ms |

As the table owner, with ANALYZE, over the same data (no RLS):

| Query | Time |
|---|---|
| Call queue page (5,052 leads for the caller) | 136 ms |
| Caller home counts | 101 ms |
| `app.duplicate_facts` batch of 500 | 111 ms |
| Customers list, Executive | 1 ms |
| Customers list with search | 4 ms |
| Orders list, Executive | 0.8 ms |
| Account 360 phones | 0.1 ms |
| ⌘K search | 610 ms, of which the `app.lead_search_ids` definer took 548 ms (it runs as owner, so this time does not depend on RLS). Re-measuring ⌘K is already an open follow-up for M1/G1. |

**Indexes.** Every foreign key without a leading index is a `created_by`, `updated_by` or `*_id` reference to principals, entities or reference tables, which are never deleted. The hot paths named in the brief all have supporting indexes.

## Could not check, and limits

- **No statistics under RLS.** `app_user` cannot ANALYZE rows of an uncommitted transaction, and `postgres` (not a superuser here) may not `SET ROLE app_user`, so under RLS the planner had no column statistics. Without them, ⌘K search took 10–22 s, the customers list 1.9–5 s, and the call queue and caller home exceeded the 30 s statement timeout. The owner-side rerun with ANALYZE (table above) shows these are planning artifacts, not code defects. I could not measure RLS and statistics together without committing data. A committed scratch database is the way to close this.
- **QStash behaviour.** QStash's live deduplication and failure-callback timing (DATA-1, DATA-4) are taken from the SDK's documentation and the code paths. I did not exercise the hosted queue.
- **Hosted state.** I did not check the hosted pg_cron state or `cron.job_run_details`: no hosted access was allowed.
- **Housekeeping.** Each generation run was rolled back; I vacuumed the touched tables afterwards so the local statistics are as they were. Nothing was committed, and the repository is unchanged (`git status` clean).
