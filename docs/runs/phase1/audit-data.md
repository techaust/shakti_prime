# Audit fixes: events, jobs and observability (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-data`, from `main` |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-data`, slot 7: Postgres 54337, app 3037 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (the outbox, workers and alerts every module relies on): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | start 13-10-2026 06:46 IST, last reading 06:24 (5h 11, week 21); the owner set the weekly gate aside |
| State | building |
| Next step | lead: early check of items 1 to 5; then builder: items 6 to 8 and the Integration Health section |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- The Sentry alert rules and uptime monitors are created by the owner (hosted).
