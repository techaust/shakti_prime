# Spike: the Cold Caller queue and the team view

**PRD TEL-01** and design §7.2 (the queue, the workspace's lead and the team lead's view, under 300 ms p95, `SLOW_CALL_MS`). Status (06-10-2026): **met on the run of 06-10-2026 for every caller and every case**, through the `app_reader` pool, on a quiet cloud machine; the final measure is taken by the lead engineer at integration, and on the hosted stack. Owner: the lead engineer. Slice T1.

Run it with `pnpm spike:calling` (`packages/domain/tests/spike/calling.ts`; options `-- --callers 10 --leads 2000 --runs 100 --warmup 10 --keep`). It needs the local Docker Postgres and is not part of CI. [results/calling.json](results/calling.json) holds the run of 06-10-2026, with its full plans.

## What it does
- **Seed:** as `app_user`, through the import commit's set-based lead path, 2,000 made-up leads of company 1 for each of 10 made-up tele-callers of one team (20,000 leads; the company had 20,353 with the suites' own).
- **Call history:** as the migrator, on the first caller's leads, as a working queue has it: a third called once without an answer with the retry due tomorrow, a tenth with a callback due now, a twentieth nurtured with its day-7 call due and a twentieth moved to Qualified (866 calls and 966 tasks). Scores are spread from 20 to 89.
- **Callers:** the tele-caller who owns the leads, the team lead of that team and the General Manager of the company; the team lead and the General Manager read the tele-caller's queue through `callerId`.
- **Cases:** the queue's first page of 50, its second page, the workspace's lead (`loadCallLead`) and the team view (`listTeamQueues`, not for the tele-caller).
- **Timing:** through `executeQuery`, 10 untimed and 100 timed runs per case; the time is the `durationMs` of the `query.completed` line.
- **Plans:** `EXPLAIN (ANALYZE, BUFFERS)` under RLS of the queue page's own statement (`callQueuePageSql`) for the tele-caller and for the team lead, and of the team view's counts (`teamQueueCountsSql`) for the team lead over the team's 10 callers.
- **Clean-up:** the spike removes its leads, customers, calls and tasks at the end unless `--keep` is given; their timeline rows stay, since the timeline is append-only. The made-up callers stay, so the General Manager's team view lists the callers of earlier runs too (117 rows on the recorded run).

## Runs
Two runs are recorded, both on 06-10-2026 (IST) in a Claude Code cloud session (4 cores, 16 GB, nothing else running, load average about 1), through the `app_reader` pool as the app reads (`DATABASE_URL_READER` set).
- **00:09 IST, before the change below:** the queue and the lead met the target; the team view did not.
- **00:14 IST, after it** (the one in `results/calling.json`): every case under 300 ms at the 95th percentile.

The first run's raw result was not kept; its numbers are recorded here only.

### Run of 06-10-2026, 00:14 IST (after the change)
| Caller | Queue p50 / p95 ms | Queue page 2 p50 / p95 ms | Lead p50 / p95 ms | Team view p50 / p95 ms |
|---|---|---|---|---|
| Tele-caller, own queue | 48.7 / 56.5 | 51.8 / 62.9 | 38.5 / 48.2 | |
| Team lead, the caller's queue | 52.9 / 64.8 | 49.6 / 57.4 | 37.4 / 44.5 | 117.1 / 127.2 (10 callers) |
| General Manager, 1 company | 45.5 / 51.7 | 46.8 / 53.6 | 35.9 / 39.7 | 124.3 / 136.4 (117 callers) |

### Run of 06-10-2026, 00:09 IST (before the change)
| Caller | Queue p50 / p95 ms | Queue page 2 p50 / p95 ms | Lead p50 / p95 ms | Team view p50 / p95 ms |
|---|---|---|---|---|
| Tele-caller, own queue | 65.2 / 72.9 | 72.9 / 83.4 | 36.1 / 41.0 | |
| Team lead, the caller's queue | 71.4 / 81.2 | 80.1 / 93.7 | 34.0 / 38.2 | 281.8 / **315.8** (10 callers) |
| General Manager, 1 company | 70.9 / 82.2 | 77.3 / 92.3 | 36.3 / 42.6 | 279.8 / **324.9** (84 callers) |

Bold marks a time over the 300 ms target.

## Why the pages are fast
**The queue** ranks every lead the caller owns and keeps the first 51 (one more than the page, to know whether there is a next one). For the tele-caller, 2,000 leads come off `opportunities_entity_owner_idx` in 1.3 ms; each is joined to its stage, its pipeline and the pipeline's Qualified stage (memoised per pipeline), then probes its next open callback or nurture call through `tasks_account_state_due_idx` and its last call through `calls_opportunity_started_idx`, each under the read policies. Planning 5.0 ms and execution 25.5 ms for the tele-caller; 2.5 ms and 23.9 ms for the team lead reading the same queue. The second page costs the same as the first: the keyset narrows the rows after ranking, not before, so the time grows with the leads one caller owns, not with the company's.

**The team view** counts the ranked queues of every caller it lists in one statement: for the team lead, 20,000 leads, planning 2.3 ms and execution 163 ms under `EXPLAIN (ANALYZE, BUFFERS)` (127 ms at the 95th percentile when timed without it).

**The change between the runs** (`rankedQueue` in `packages/domain/src/queries/calls/call-queue.ts`):
- The lead's next call was a subquery in the select list. The bucket's `case` and the team view's three counts read it, and the planner copied it into each place: about six probes of `tasks` under its policy for each of the 20,000 leads (355,800 buffers in the team view's plan on a shorter run before the change). It is now a lateral aggregate, run once per lead (88,142 buffers on the recorded run).
- The Qualified stage's position was a subquery correlated on the lead's pipeline, run once per lead (19,900 loops). It is now a join: a pipeline has at most one stage keyed `qualified` (`pipeline_stages_pipeline_key_unique`), so the join keeps one row per lead and is hashed or memoised once per pipeline.
- The rule and its results are unchanged; the query suites (`call-queue.test.ts`, `calls.test.ts`, `reader-parity.test.ts`) pass on it.

## Still to measure
The queue and the team view are measured again by the lead engineer at integration, on the hosted stack, and with the client's imported leads and real calling history. The team view grows with the leads of every caller it lists: a company of 100 callers with 2,000 open leads each would count 200,000 leads at once, which this spike does not measure.
