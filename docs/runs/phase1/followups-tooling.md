# Tooling and test-stability follow-ups (wave 6, beside M1)

| | |
|---|---|
| Branch | `fix/followups-tooling`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/followups-tooling`, slot 3: Postgres 54333 (container `shakti-pg-followups-tooling`), app 3033 |
| Runs on | cloud, beside M1 and the database follow-ups (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock |
| Tier | B (tooling and tests, no schema): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | building |
| Next step | builder: the items below |

## Brief
Open follow-ups from [STATUS](../../10-status.md#open-follow-ups) on the scripts and on tests that fail by order or time. No migration, no product behaviour change.

1. **`tools/integration/heavy.sh` hands the lock out in order:** a numbered queue (a ticket per waiting command, served lowest first; a ticket whose process is gone is skipped; the 90-minute stale-lock clearing kept). The same command line and exit code for callers; a short test script or a dry run in the report showing three waiters served in order. Update the lines of `docs/runbooks/hybrid.md` §5 and `slice-integration.md` §1 that describe the first-retry behaviour (single targeted lines).
2. **The cloud session hook notices a half-finished pnpm self-install** (`.claude/hooks/cloud-session.sh`, `tools/integration/lib.sh`): when `~/.local/share/pnpm/.tools/pnpm/<v>_tmp_*` holds the placeholder, run that folder's `node install.js` (as hybrid §2 describes) and check turbo starts; the hybrid §2 line updated.
3. **`tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing:** treat "nothing to write" as success and say so.
4. **`converting.spec.ts` onto the test clock** (L1 review #6): its in-hours branch runs only between 09:05 and 20:50 IST; set the server clock with `e2e/support/clock.ts` and run both branches on every run (#145's pattern).
5. **The converting catalogue item seeded where only `converting.spec.ts` reads it** (`apps/web/e2e/converting-fixtures.ts`, `apps/web/e2e/setup/converting.ts`): the catalogue, tax rates and price master screenshots must no longer show "Converting solar module 540 Wp". List the baselines that change for the lead to remake in the Linux image; do not remake them on the host.
6. **`files.spec.ts`'s logo journey:** wait for `/settings/companies` to show its title before axe runs.
7. **The PIN code journey's axe check:** wait for the success toast to finish appearing first.
8. **Order- and time-dependent tests:** `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database (make it independent of an earlier run's customer); `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first (create its own); `reader-parity.test.ts`'s Executive case (about 12 s against a 20 s limit: make it faster if the cause is in the test, else raise the limit with a comment saying why).

Done when: each changed test passes three times in a row, the changed journeys pass twice in a row on the same database, typecheck and lint pass, and `bash -n` passes on every changed script.

Not here: anything M1 builds (`feat/m1-migration-uat`) or the database bundle (`fix/followups-db`: notifications, commission accruals, the Triage shadow report, `app.ensure_audit_partitions()`). Shared lists are append-only. Any script change must keep working for builders already waiting on the lock while it is replaced: the new `heavy.sh` takes effect for commands started after it lands in the main checkout, which the lead does at the merge, so test it from your worktree's copy only.

**How to work:** commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh` (the main checkout's copy, `/home/user/shakti_prime/tools/integration/heavy.sh`). Never open a pull request, install a dependency or touch a hosted service.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Screenshot baselines that lose the converting item are remade in the Linux image at the integration.
