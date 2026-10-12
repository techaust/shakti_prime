# Database and domain follow-ups (wave 6, beside M1)

| | |
|---|---|
| Branch | `fix/followups-db`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/followups-db`, slot 2: Postgres 54332 (container `shakti-pg-followups-db`), app 3032 |
| Runs on | cloud, beside M1 and the tooling follow-ups (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock |
| Tier | A (row-level security definer and a money column): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | building |
| Next step | builder: the five items below |

## Brief
Five open follow-ups from [STATUS](../../10-status.md#open-follow-ups), each small and self-contained. Read each one's origin first (the slice's run file and review named in brackets).

1. **Drop `notifications_entity_dedupe_idx`** (N1 re-check L6): nothing reads it since the per-person check. A new migration drops it; the schema file loses it; `pnpm db:docs`. Show with `EXPLAIN` that the per-person dedupe query uses its own index.
2. **`app.claim_push_subscription()` re-claim** (N1 review L4, `packages/db/migrations/0119_notifications_rls.sql`, `packages/domain/src/commands/notifications/own.ts`): a person who knows another person's browser push address can re-claim it. Fix so a subscription held by another person is never moved to the caller (refuse with a catalogue reason, or replace only when the push service's keys prove ownership — choose the safer, state why). Security tests in `packages/db/tests/security/notifications.test.ts`: the re-claim refused, the owner's own re-registration still works, fail-closed without context.
3. **`commission_accruals.measure` precision** (S2 review #8, `numeric(14,3)`): it cannot hold the measure of an order of ₹1e11 or more. Widen it to hold any order the `numeric(14,2)` money columns allow (check every function and view that reads it, `app_reader` grants unchanged); a test with the largest allowed order.
4. **Triage shadow report shows the pipeline's name** (A1 review #3): the DTO carries the pipeline name, not its key through the segment labels; the screen shows the name; tests updated (the `triage.spec.ts` screenshot only if the text changes; then record it in the report for the lead to remake in Linux).
5. **`app.ensure_audit_partitions()` per-month error handling** (STATUS follow-up "audit-logs-partitions"): match `app.ensure_activity_partitions()` — one failing month does not stop the others, each failure logged in `retention_runs` — in a new migration redefining the function from `main`'s latest version; and the job runs daily, not on the 25th (find the schedule in the code; the hosted QStash schedule change is the owner's, list it in the report). Security tests in `packages/db/tests/security/audit-logs.test.ts` or `retention.test.ts`.

Done when: the checks of AGENTS §10 pass on the branch; the security suite passes on the slot's Postgres.

Not here: anything M1 builds (`feat/m1-migration-uat`: import reconciliation, lead anonymisation, `app.platform_only_permissions()`, retention for leads) or the tooling bundle (`fix/followups-tooling`: `tools/integration`, `.claude/hooks`, `converting.spec.ts`, `files.spec.ts`, test-stability edits). Shared lists are append-only.

**Migrations:** start at 0130 (M1 also starts at 0130; the lead renumbers at the merge). Each redefined function from `main`'s latest version.

**How to work:** commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service.

**Reviewer's checklist (check it yourself before reporting):** the push re-claim cannot move another person's subscription under any input; the widened column keeps every check constraint and reader grant; the redefined partition function keeps everything `main`'s version does; no copy outside `en.json`.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations from 0130 move after `main`'s (and M1's, if it merges first) last one.
