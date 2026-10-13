# Audit fixes: events, jobs and observability (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-data`, from `main` |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-data`, slot 7: Postgres 54337, app 3037 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (the outbox, workers and alerts every module relies on): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | start 13-10-2026 06:46 IST, last reading 06:24 (5h 11, week 21); the owner set the weekly gate aside |
| State | built, awaiting review |
| Next step | lead: review; remake the three integration-health baselines |

## Brief
The audit's evidence: `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/2-data.md` (its verification was cut short by the usage limit: verify each finding yourself before fixing it, and say in the report which you confirmed), `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/5-ops.md` and `/tmp/claude-0/-home-user-shakti-prime/763f5e41-bf7b-5815-bc26-350fbeb0dd5d/scratchpad/audit/5-ops.verdict.md`. Report: `docs/14-reviews/2026-10-audit.md`.

1. **DATA-1 (high):** "Send again" delivers: each delivery generation has its own deduplication id (a replay counter the replay increments), and a publish answered `deduplicated` for a replayed row is a failure, not delivered. A test with the QStash publisher.
2. **DATA-2 (medium):** a large import cannot starve other events: imported leads' events are marked and not delivered to subscribers that ignore them (Triage), and a publisher run loops while it claimed a full batch and time remains in the route's limit. Show the drain time of a 50,000-row import before and after.
3. **DATA-3 (medium):** a failed retention or partition job is seen: the last run and error of each job on Integration Health (through an owner definer for `cron.job_run_details`), and a failure or a job missing for more than its period raised to Sentry.
4. **OPS-3 (medium):** handled failures reach Sentry: the logger's error lines (already redacted) sent with `captureException` when a DSN is set; a failure-streak counter for each scheduled route, like the outbox's.
5. **OPS-8 (medium):** the outbox alert is flushed before the function returns (`await Sentry.flush` or `after()`), with a test.
6. **OPS-4, OPS-9 (low):** readiness checks the reader pool too; production refuses to start without `SENTRY_DSN`; DEPLOY §1 gets the uptime monitor and the scheduled routes' check-ins as an owner step; incidents §1 matches.
7. **DATA-4 to DATA-8 (low):** the dead-letter callback race (answer 503 while leased, or the hold-back accepting a leased row); widenings of the `activities` type check as `NOT VALID` (and the rule in AGENTS §6); no audit row for a scan that changed nothing (`auditWhen: 'changed'`); the GST split check (`NOT VALID`, validated outside the deploy); drop `files_entity_idx`.
8. **The hot reads under RLS with statistics:** on a scratch database with committed synthetic data at the audit's volume (about 200,000 customers, 240,000 leads, 1.4 million activities) and `ANALYZE`, time ⌘K search, the lead list and search, the calling queue, the converting board, Account 360, notifications and the orders list as an Executive, a GM and a tele-caller under `EXPLAIN (ANALYZE, BUFFERS)`; fix any over 1 s (index or policy), and record the table in `docs/04-architecture-appendix/`.

Done when: the checks of AGENTS §10 pass; the security suite passes on the slot's Postgres; every hot read under 1 s for every role at that volume.

**Migrations:** after `main`'s last one. **How to work:** as every brief: commit every 20 minutes, never push, never docker (the lead gives you the scratch database), heavy commands through `bash /home/user/shakti_prime/tools/integration/heavy.sh`, no pull request, no install, no hosted service.

## Report

### 13-10-2026, cloud (slot 7, Postgres 54337): early check, items 1 to 5
Skills loaded: `supabase-postgres-best-practices`, `add-command`.

**Findings confirmed before fixing** (the data findings had no skeptic):
- DATA-1 confirmed by reading: the publisher sent every generation under `deduplicationId: event.id`, `app.replay_dead_letter()` reset the same row, and `resultOf()` took any answer with a `messageId` as delivered; the installed `@upstash/qstash` types carry `deduplicated?: boolean` on a publish answer. QStash's 90-day window is from its documentation, not run live.
- DATA-2 confirmed by reading and measured (below): `crm.lead.created` is subscribed, Triage returns at once for `imported`, and a run claimed 100 once.
- DATA-3 confirmed: `activities-partitions` only raises a warning (0088), and nothing in `packages/domain/src` or `apps/web/src` read `retention_runs` or `cron.job_run_details`.
- OPS-3 confirmed: the logger had no Sentry sink; scheduled routes only logged their 500.
- OPS-8 confirmed in the code (un-awaited `import().then()`, no flush); that Vercel freezes the send is plausible, not observed.

**What was built**
1. DATA-1. `outbox_events.replays` (0130) and 0131: the trigger lets only a replay change it, by exactly one; `app.replay_dead_letter()` raises it. The lease answers it (`OutboxRow.replays`); `EventPublisher.publish(events, generations)`; `deliveryDeduplicationId()` sends generation 0 under the event id (as before) and generation n under `<id>:<n>`. The publisher dead-letters the first try of a replayed generation answered `deduplicated` as `queue_deduplicated` (shown as "The delivery service did not take it."); a later try of the same generation answered `deduplicated` counts as delivered, since an earlier try of that generation reached the queue before its run died.
2. DATA-2. The catalogue's `undeliveredWhen` (`crm.lead.created`: `imported`) and `isDelivered()`; the outbox sink inserts such an event with `published_at` already set, and the publisher skips one it still finds. `runOutboxPublisher` takes `budgetMs`: it claims again while a claim came back full and not every event of it failed; the publish route passes `OUTBOX_RUN_BUDGET_MS` (30 s of its 60).
3. DATA-3. The platform-only permission `platform.jobs.check` (held by `system:workers`; `integrations.*` would be agent-restricted), `app.scheduled_jobs()` (0132, owner definer over `cron.job`, `cron.job_run_details` and `retention_runs`, for `admin.integrations.write:all` or `platform.jobs.check:all`, granted to `app_user` and `app_reader`), `readScheduledJobs()` with the pure `scheduledJobHealth()` (missing, paused, failed, running, late, waiting, ok), the hourly route `/api/v1/workers/jobs/check` with its schedule `jobs-check-<env>` at :41, and `job.problem` alerts once per job, state and run (again after a week). The Integration Health section waits for the screens step after this check (contracts `ScheduledJobHealth` and `DATABASE_JOBS` are in place).
4. OPS-3. `apps/web/src/log.ts` sends every `error` line to Sentry with `captureException` when `SENTRY_DSN` is set (`observability/error-reports.ts`: redacted fields, the error rebuilt with its scrubbed message and its stack frames, grouped by event name, kept alive with `after()`), except the alert names and `request.failed`. `workers/job-streak.ts`: each scheduled route (rescore, duplicates, notification scan, quote expiry, now on `nightlyWorkerRoute`, the files sweep and the jobs check) counts failed calls in Redis and the third in a row raises `job.failing`.
5. OPS-8. `AlertSink.report` is async and awaits `Sentry.flush(2000)`; the publisher run and the failure callback await it.

Documents: ARCHITECTURE §6, DATABASE §4.1, §4.4, §6.10, §7, API §3.6, SECURITY §3 (matrix row, platform-only list, worker grants), DEPLOY §1 step 8 (the `job.failing` and `job.problem` rule), INCIDENTS §11 (new), `docs/data` regenerated.

**DATA-2 drain time** (slot database, 50,000 `crm.lead.created` imported events pending, the real lease and record, an instant queue):
| | Before | After |
|---|---|---|
| Imported leads' events | one run of 100 a minute (49 ms each): 500 runs, about 8.3 hours, every later event behind them and readiness down | written delivered: none pending, 0 s |
| A 50,000-event backlog the loop must send | 500 minutes | one call of 8.9 s (instant queue); with QStash's batch call at about 0.5 s per 100, an estimated 9 calls, about 9 minutes |

**Tests added** (39): `publisher.test.ts` 8, `scheduled-jobs.test.ts` (domain unit) 9, `qstash.test.ts` 1, `alerts.test.ts` 2, `error-reports.test.ts` 5, `job-streak.test.ts` 3, `dead-letter-replay.test.ts` 3, `scheduled-jobs.test.ts` (db security) 4, `outbox-replay.test.ts` 2 (the QStash publisher against the real outbox: Send again twice gives `<id>:1` then `<id>:2`; a deduplicated replay is held back), `jobs-check.test.ts` 2; extended: `imports.test.ts` (imported lead events written delivered), `integrations.test.ts`, `grants.test.ts` (the reader may call `app.scheduled_jobs()`), `caller-profiles.test.ts` (nine platform-only keys), `reader-parity.test.ts`.

**Checks run**
- Typecheck: contracts, db, domain, web: no errors.
- ESLint `--max-warnings 0` over every folder touched: clean.
- Unit: contracts 20 files, 181 tests; db `src` 9 files, 131 tests; domain `src/outbox`, `src/queries/platform`, `src/ports` 6 files, 71 tests; web `src/workers`, `src/observability` and the fence, query-name and instrumentation tests 30 files, 199 passed, 1 skipped (the existing OCR case).
- `pnpm copy-lint`: clean.
- Security suite on 54337: db 41 files, 1,202 tests passed; domain 72 files, 932 tests passed; web 24 files, 307 tests passed (the domain and web suites rerun after the container restart, the first domain run having failed only on `reader-parity`, which now covers `readScheduledJobs`).

**For the lead**
- Migrations 0130 to 0132 follow main's 0129; DATABASE §4.1 cites 0131 and 0132 in the definers table, to be renumbered with the files if they move.
- 0132 was edited once after it ran on the slot database (the permission renamed); the slot database was brought level by hand (functions re-created, the stale permission rows removed, the stored hash updated). A fresh database applies the file as it stands.
- Owner steps (hosted): the `job.failing` / `job.problem` alert rule (DEPLOY §1 step 8) and the new schedule `jobs-check-<env>` (`pnpm --filter web qstash-schedule`, DEPLOY §2 step 6).

**Decisions the brief did not settle**
- The permission is `platform.jobs.check` (module label "Upkeep"), since the agent refusal sweep treats every `integrations.*` key as restricted and `system:workers` may hold none.
- Only the first try of a replayed generation answered `deduplicated` fails; a later try of it counts as delivered (otherwise a run that died after QStash took the message would end in a dead letter and a second delivery).
- The hourly jobs check is a new QStash schedule rather than part of the publisher's minute, so its own failure streak covers it.
- `quotes/expire` now uses the shared `nightlyWorkerRoute` (same answers and log names) to carry the streak; the files sweep counts its streak in place.
- A job that never ran counts as late once pg_cron has kept runs for longer than its period and six hours; before that it is `waiting`.

### 13-10-2026, cloud (slot 7, Postgres 54337): items 6 to 8, the Integration Health section, final checks
After the early check passed. Skills as before (`supabase-postgres-best-practices`, `add-command`).

**Confirmed before fixing:** DATA-4 by reading (the hold-back required `published_at`, so a callback ahead of the run's record answered `unchanged` and 200); DATA-5 (0094, 0112 and 0114 drop and add `activities_type_check` whole; `ADD … NOT VALID` on the partitioned table works on Postgres 17, tried in a rolled-back transaction); DATA-6 (`run-command.ts` wrote `[{}]` for a call with no change, and the scan and the three nightly batches audit only what they change); DATA-7 (the live totals checks allow an intra quote with IGST; lines carry no `supply_kind`); DATA-8 (`files_entity_idx` is a prefix of `files_entity_purpose_created_idx`); OPS-9 (no reader probe).

**What was built**
6. OPS-4, OPS-9: `checkReaderReady()` (`packages/db/src/ready.ts`) and `reader` in `ReadyChecks`; `SENTRY_DSN` required when `BOS_ENVIRONMENT=production`; Sentry cron check-ins from every timed route (`observability/check-ins.ts`, the crons in `workers/schedules.ts`, which `qstash-schedule.ts` now reads too, so the monitors and the schedules cannot drift); DEPLOY §1 step 8 (cron monitors and an uptime monitor on `/api/v1/health/ready`, owner steps), step 12 (`SENTRY_DSN`), INCIDENTS §1.
7. DATA-4: `holdBackFailedEvent()` answers `leased` for a row still leased to the run that sent it, and the failure callback answers a retryable 503. DATA-5: the rule in AGENTS §6 and DATABASE §8, and `migration-rules.test.ts`, which refuses a check dropped and added again without `NOT VALID` from the first migration after main's 0129. DATA-6: `auditWhen: 'changed'` on `defineCommand`, set on `notifications.due.scan`, `sales.quote.expire`, `crm.duplicate.scan` and `crm.lead.score_refresh` (AGENTS §5). DATA-7: `quotes_gst_split_check`, `sales_orders_gst_split_check` and the two line checks (a line has CGST and SGST or IGST, never both), added `NOT VALID` in 0133, with DEPLOY §2 step 8 to validate them after the deploy. DATA-8: `files_entity_idx` dropped in 0133.
8. The hot reads under RLS with statistics: [04-architecture-appendix/hot-reads.md](../../04-architecture-appendix/hot-reads.md). On a scratch database `shakti_perf` on the slot's own Postgres (built from the migrations with pg_cron's statements left out, so the suites' database kept its size), 200,000 customers, 240,000 leads, 1,440,000 activities, 596,436 calls, 320,792 tasks, 120,000 notices and 40,000 orders, committed and analysed. Every read is under 1 s for the Executive, the General Manager and the tele-caller; the slowest is ⌘K for a misspelt name as an Executive of four companies, 715 ms, in the trigram match of `app.lead_search_ids()`. No index or policy needed changing. `EXPLAIN (ANALYZE, BUFFERS)` of every statement is summarised in `results/hot-reads-2026-10-13.txt`.
- Integration Health: the section Scheduled upkeep (`ScheduledUpkeep` in `integrations-screen.tsx`): each of the five database jobs by a plain name, its state as a badge, its last run and how often it runs; `jobs` in `IntegrationHealthResponse`; only the state and time cells are masked in screenshots. The error behind a failure goes to the alert and the log, never on screen.
- A local nudge (no queue: development, CI, journeys) now claims again within 10 s (`LOCAL_NUDGE_BUDGET_MS`): the full web suite once failed `actions.test.ts` because a backlog of about 700 events from earlier files sat ahead of the lead the test created, and a single claim of 100 never reached it.

**Tests added** (16, besides the 39 of the early check): `deps.test.ts` 1, `ready.test.ts` 2 (the reader's pool, and a refused password turning readiness down), `check-ins.test.ts` 3, `job-streak.test.ts` 1, `outbox-failures.test.ts` 1, `outbox.test.ts` (db) 1, `migration-rules.test.ts` 2, `run-command.test.ts` 1, `gst-split.test.ts` 3, `admin-integrations.test.ts` 1; extended: `crm-scoring-referrals.test.ts` (a batch that changed nothing writes no audit row), `integration-health.test.ts` (the five jobs), `enum-sync.test.ts` (the GST split checks name the supply kinds), `integrations.spec.ts` (the Scheduled upkeep table).

**Checks run** (all through the lock)
- `pnpm typecheck`: 8 of 8 tasks. `pnpm exec turbo run test --force`: every workspace passed but one OCR timing case in `mask-pdf-pages.test.ts`, which passed when run alone (13 passed, 1 skipped); untouched by this slice.
- `pnpm copy-lint`: clean. `pnpm --filter web js-budget`: every page within its budget (46 pages).
- Security suite on 54337 (`pnpm test:security`): db 42 files, 1,206 tests; domain 72 files, 932 tests; web after the nudge fix 24 files, 309 tests, all passed.
- Journeys: `integrations.spec.ts` on the production build, 22 passed with snapshots ignored (axe included). With snapshots, `integration-health` fails in all three projects, as it must: the page has a new section.
- `pnpm lint` (whole repository): see the last line below.

**Screenshot baselines the lead must remake** (Linux, fresh database): `apps/web/e2e/__screenshots__/{desktop-light,desktop-dark,phone}/integrations.spec.ts/integration-health.png`.

**For the lead**
- Migrations 0130 to 0133 follow main's 0129; DATABASE §4.1 cites 0131 and 0132, and `migration-rules.test.ts` starts its rule at 130 (main's next number), which stays right after renumbering.
- Hosted, after the deploy: validate the four GST split checks (DEPLOY §2 step 8); create the `jobs-check-<env>` schedule; the owner's Sentry steps (the `job.failing` and `job.problem` rule, the seven cron monitors' alerts, one uptime monitor per environment).
- The scratch database `shakti_perf` is still on 54337 for a rerun (`drop database shakti_perf` frees it); the scripts that built and measured it are in the session's scratchpad (`ad/perf`), not in the repository.
- One small endpoint test file (`endpoints.test.ts`) was run once outside the lock by mistake.

**Decisions the brief did not settle**
- Item 8's data went into a separate database on the slot's Postgres rather than the suites' own, so the security suite keeps its size and speed.
- The GST check on lines is "never both"; the header's check ties the split to `supply_kind`, since a line has no supply kind of its own.
- Cron monitors are made by the SDK on the first check-in (`captureCheckIn` with the schedule), so the owner only sets their alerts.
- The migration rule applies to every check dropped and added again, a widening or not: a narrowing is then added `NOT VALID` and validated after the deploy, as DATABASE §8 says.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- The Sentry alert rules and uptime monitors are created by the owner (hosted).
