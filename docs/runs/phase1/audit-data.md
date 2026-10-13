# Audit fixes: events, jobs and observability (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-data`, from `main` |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-data`, slot 7: Postgres 54337, app 3037 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (the outbox, workers and alerts every module relies on): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | start 13-10-2026 06:46 IST, last reading 06:24 (5h 11, week 21); the owner set the weekly gate aside |
| State | building |
| Next step | builder: the findings below |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- The Sentry alert rules and uptime monitors are created by the owner (hosted).
