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
- After the nudge fix and this report: `pnpm build` passed, the journey `integrations.spec.ts` again 22 passed (snapshots ignored), and the whole-repository `pnpm lint` passed with no warning, the last check.

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
13-10-2026, cloud, of `fix/audit-data` at 77d49697 (Opus 5.5 xhigh). No critical or high finding: nothing blocks the merge. M1 and L1 are one-line fixes.

| # | Severity | Finding | State |
|---|---|---|---|
| M1 | medium | **Customer data reaches Sentry through the rebuilt stack** (`apps/web/src/observability/error-reports.ts:28`). `errorOf()` keeps every line of `raw.stack` after the first. A failed query through drizzle-orm 0.45 throws `DrizzleQueryError`, whose message has several lines (`Failed query: <sql>` then `params: <values>`), so the SQL and the raw parameter values are copied into the stack unredacted. That bypasses the rule in `redaction.ts:220` that turns `params:` into `params: [redacted]`. Sentry's Node stack parser makes a frame of any line containing `at `, and `scrubFrame()` cleans only `vars` and query strings. *Confirmed* with `@sentry/node` 11.6.0's `defaultStackParser`: a parameters line holding a note ("…asked us to call at home on +919876543210 after six") became the frame `filename` and `module` "home on +919876543210 after six". Any `error` line carrying a failed query whose parameters hold free text sends that text to Sentry's US region. **Fix:** keep only the frame lines (`raw.stack.split('\n').filter((l) => /^\s+at /.test(l))`), and add a test with a two-line message. | open |
| M2 | medium | **A pg_cron run that never finishes is never reported** (`packages/domain/src/queries/platform/scheduled-jobs.ts:94`, `apps/web/src/workers/jobs-check.ts:40`). The job's state is decided as `running` before `late` is ever checked, and the hourly check skips `running`. pg_cron does not start a job while its previous run is still active, and none of the five jobs sets `lock_timeout` or `statement_timeout`. So a run stuck behind a lock stops the job for good: `activities-partitions` making a partition behind a long transaction, or `audit-logs-detach` detaching one. The page shows "Running now" and no `job.problem` is raised. This is DATA-3's "a job missing for more than its period". *Confirmed* by reading; that a run hangs is *plausible*. **Fix:** count an unfinished run that started more than its period plus margin ago as `late` (or a `stuck` state that alerts), with a unit case. | open |
| L1 | low | **A worker's refusal can still be lost (the rest of DATA-4)** (`packages/db/src/outbox-client.ts:188`). `leased` requires `claimed_until > now()`. Suppose a run sends an event and dies before it records it. Once the two-minute lease lapses, and before the next run claims the event again, the failure callback answers `unchanged` with a 200, and QStash drops the callback. The next run sends the event under the same deduplication id, QStash answers `deduplicated`, and with `attempts > 0` the publisher marks it delivered: no dead letter and no alert. *Confirmed*: on the slot database, the statement against a pending row (attempts 1, lease lapsed 10 s ago) answered held f, leased f. The publisher step is confirmed by reading. `outbox.test.ts:738` asserts this case as `unchanged` on purpose. **Fix:** answer `leased` (503) for any row neither delivered nor dead-lettered, by dropping `claimed_until > now()`, and change that assertion. | open |
| L2 | low | **`auditWhen: 'changed'` hides one real change** (`packages/domain/src/commands/notifications/notify.ts:228`). `notifications.due.scan` settles pending pushes through `app.record_notice_push()`, which updates `notifications.channel_sent_json`, and names no change for it. A scan whose only work was that settling now leaves no audit row, where before it left the call's row. The other three commands audit everything they write: `app.expire_quotes`, `app.record_duplicates` (whose search, `app.duplicate_facts`, is `stable`) and `app.write_lead_scores` (which answers its row count). *Confirmed* by reading. **Fix:** when `settled.length > 0`, call `ctx.audit()` with a `push_batch` change and its count. | open |
| L3 | low | **The NOT VALID GST checks have no one to validate them, and older rows break on update first** (0133, DEPLOY §2 step 8, DATABASE §8 item 7). (a) A NOT VALID check is still enforced on every later update. *Confirmed* on the slot database: on an intra quote holding IGST, `update quotes set updated_at = now()` failed with 23514. Such a row makes every change to it fail, for example the nightly `sales.quote.expire` batch that contains it. Step 8 says to validate after the deploy and correct a refused row then; it does not say to look for such rows before the deploy. (b) DATABASE §8 gives the `alter table … validate constraint` to "the lead session" in the SQL editor. The lead's Supabase access is read-only on the PC and absent in the cloud, and the standing go-ahead covers only migration, redeploy and health checks (DECISIONS), so as written nobody runs it. **Fix:** in step 8, a pre-deploy query that counts the rows breaking each check; validate the checks in a migration of the next deploy (SHARE UPDATE EXCLUSIVE, small tables), or make validation an owner step. | open |
| L4 | low | **Nudges hide a deleted minute schedule from Sentry** (`apps/web/src/app/api/v1/workers/outbox/publish/route.ts:50`). `nudgeViaQStash()` calls the same `publishUrl` as the minute schedule (`qstash.ts:241`), and every call checks in `ok` to `outbox-publish`. While commands commit through the working day, the monitor sees a check-in in every window even with the schedule deleted, so the missed run shows only once activity stops. *Confirmed* by reading; Sentry's handling of extra check-ins is *plausible*. **Fix:** check in only for the schedule's calls, for example from a header or body field that the schedule sets and the nudge does not. | open |
| L5 | low | **DEPLOY §2 step 6 does not list `jobs-check`**: it names the schedules the script makes, and the owner creates them from that list in the Upstash console, but the new hourly `jobs-check` at :41 is missing from it. *Confirmed*. **Fix:** add it to the sentence. | open |
| L6 | low | **A missing job shows the wrong period** (`scheduled-jobs.ts:73`): a `missing` job is given `everyHours: 24`, so Scheduled upkeep says "Every day" for a missing monthly job (`activities-partitions`, `audit-logs-detach`). *Confirmed* by reading. **Fix:** keep each expected job's period beside `DATABASE_JOBS`, or show no period for a missing job. | open |
| L7 | low | **The local nudge's 10 s loop is a timing fix for a test-isolation problem** (`apps/web/src/workers/outbox.ts:37`, `apps/web/tests/actions.test.ts:279`). That test's event sits behind whatever backlog earlier files leave pending, and it passes only if one action's nudge drains that backlog within 10 s. A bigger backlog or a busier shared machine fails it again. Every local and CI action may also wait those 10 s plus the in-process deliveries of the claim already started. *Plausible*. **Fix:** make the test independent of the backlog (publish until its own row is delivered, or drain the outbox before it), and keep or drop the 10 s on its own merits. The test's comment "No worker listens to this event yet" is stale, since Triage does. | open |
| L8 | low | **A jobs-check assertion could pass with nothing checked** (`apps/web/tests/jobs-check.test.ts:19`): `alerted === problems` and the loop over the alerts still pass with zero problems. Today `retention_runs` rows keep it from passing empty. **Fix:** add `expect(first.problems).toBeGreaterThan(0)`. | open |

**Checked and sound**
- Redefinitions against main:
  - 0131's `app.outbox_delivery_only()` is 0064's with only the two `replays` rules added.
  - 0131's `app.replay_dead_letter()` is 0054's plus `replays + 1`, with the revokes widened.
  - 0132's `app.platform_only_permissions()` is 0125's eight keys plus `platform.jobs.check`.
  - Main's new 0130–0133 redefine no function this slice touches.
- Reproduced on the slot database (port 54337), in rolled-back transactions:
  - The trigger refuses a `replays` change outside a replay, a hand-made replay, and a jump of two under `app.dlq_replay`.
  - `outbox_publisher` cannot update `replays`.
  - `app.scheduled_jobs()` refuses `app_user` and `app_reader` with no settings, with empty permissions, and with `platform.jobs.check:entity`.
  - `ADD … NOT VALID` on the partitioned `activities` reaches every partition, and partitions made afterwards are created valid.
- DATA-1: each delivery generation has its own deduplication id. The first try of a replayed generation answered `deduplicated` is held back; a later try counts as delivered. The tests assert `<id>:1` and `<id>:2` against the real outbox.
- DATA-2:
  - Only Triage subscribes to `crm.lead.created`, and `imported` is set only on the import path.
  - The loop stops on a claim that is not full, on a claim whose every event failed, and at the budget. The last claim of a run ends well inside the 60 s route limit and the two-minute lease.
- DATA-3 and OPS-3: `scheduleEveryHours()` reads main's new daily `audit-logs-partitions` correctly, and `retention_runs` job names match the cron job names.
- OPS-8: the flush test holds `report()` open until `flush` resolves. Alerts are awaited before the route answers.
- OPS-9: the reader probe and its refused-password test.
- `migration-rules.test.ts` catches drizzle-kit's drop-and-add form, upper or lower case. `renumber-migrations.mjs` keeps SQL verbatim, so the hand-written NOT VALID survives the move.
- The role editor hides platform-only keys. Copy is in `en.json` with no new button.
- The hot-reads record meets the brief's volume and states its gaps (quote volume, hosted stack).
- Tests run through the lock, all passing:
  - db `migration-rules.test.ts`: 2.
  - domain `scheduled-jobs`, `publisher` and `run-command`: 80.
  - db security `outbox`, `dead-letter-replay`, `scheduled-jobs`, `gst-split`, `grants` and `caller-profiles`: 6 files, 226.
  - web security `outbox-replay`, `jobs-check`, `ready` and `integration-health`: 4 files, 23.

**Not checked**
- The layout of Scheduled upkeep: no baseline or builder screenshot exists yet.
- Live, with no network: QStash's 90-day deduplication window and its retries of a failure callback, and Sentry's cron monitors and uptime monitor.
- The whole security suite: only the files above were run.

**For integration**
- `main` has its own 0130–0133 since this branch started (followups-db, #168), so this slice's migrations move to 0134–0137. Their citations follow: DATABASE §4.1's 0131 and 0132, and every "0133" in DATABASE, DEPLOY and `docs/data`, which must be regenerated.
- `migration-rules.test.ts` keeps its rule from 130: main's 0130–0133 drop and re-add no check.
- Main's 0133 runs `audit-logs-partitions` daily and records its runs in `retention_runs`. Scheduled upkeep reads the period from the schedule, so nothing changes.

## Integration notes
- The Sentry alert rules and uptime monitors are created by the owner (hosted).
