# Hardening follow-ups, batch 2 (wave 6, after G1)

| | |
|---|---|
| Branch | `fix/followups-hardening-2` on GitHub, from `main` at 83e31c33 (#186) |
| PC worktree | `followups-hardening-2`, slot 2: Postgres 54332 (container `shakti-pg-followups-hardening-2`), app 3032 |
| Runs on | PC (owner, 17-10-2026: spend the week's remainder before the reset; the lead runs it while the owner is away) |
| Tier | B (workers, delivery and test start-up): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | build Opus medium from week 94 (18-10-2026) |
| State | building |
| Next step | the builder reports; the lead reads the diff and starts the review |

## Brief
Open follow-ups from [STATUS](../../10-status.md#open-follow-ups) and from [batch 1's review](followups-hardening.md#review) that need no client input. No change to tax, price, credit or row-level security policies; a migration only if an item cannot be done without one, and then as [AGENTS §6](../../../AGENTS.md#6-database-changes) says.

**Journeys and tests**
1. **The seed's waiting events** (batch 1 review #1): `e2e:seed` leaves 200 to 245 outbox events waiting, and the first person's request in a journey run delivers them through the local nudge (30 to 44 s). The journeys' set-up delivers every waiting event once the seed is done, with `AI_TRANSPORT=fake`, in all three places that start the journeys' server (`playwright.config.ts`, `e2e/setup/snap-in-linux.ts`, CI's "Start the app" step, as [slice-integration §10](../../runbooks/slice-integration.md#10-lessons) says); and the local nudge (`LOCAL_NUDGE_BUDGET_MS`, `apps/web/src/workers/outbox.ts`) also stops inside a claim once its budget is spent, so no request carries more than its budget of delivery. Tests for the budget.
2. **`crm-scoring-referrals.test.ts` "rescores the open leads…"** fails on a database holding more than 1,000 open leads of its scope in company 1 (`RESCORE_BATCH`, batch 1 review #5): make the case independent of other rows (its own company scope or counts of its own leads).
3. **`customers.spec.ts` "sizes a lead from Account 360 and sees it in the history"**: its `customer-sizing` screenshot failed once on CI's phone run and passed on retry (#187, 17-10-2026). Find what differs between runs (a toast, a time, a list other journeys fill) and fix it as the lessons of slice-integration §10 say; do not remake the baseline unless the screen itself is wrong.

**Workers and delivery**
4. **Triage redelivery** (A1 review #7): an event redelivered after a partial run calls the model again for the steps left. Keep the model's answer under the event id in the key-value store (the store idempotency keys already use), read it before calling the model, with a time to live no longer than the redelivery window; tests for a redelivery that finds the answer and one that does not.
5. **The Vault page's time** (K1): a page whose turn begins late (25 s) can outrun the route's 60 s with its own 45 s. Bound the page's work by what is left of the delivery's time (the route's start), and hand back for redelivery when too little is left; tests with a fake clock.
6. **Read again racing redelivery** (K1 review #13): Read again on a file waiting six minutes can race QStash's redelivery and read it twice. Make the file's read claim exclusive (a state change or a lock the second reader sees), so a second read finds the file taken and stops; a test of two readers.
7. **"The destination stream closed early"** is logged as an error when a browser leaves a page while it loads: log it below error level (or not at all) when the cause is the client going away, keeping every other stream error at error level; a test of the classification.

**Screens**
8. **Admin › Agents, the agents table on desktop:** the Autonomy box overlaps the daily spending limit column (seen in `admin-agents.png`, before batch 1 too). Lay the row out so each column's controls stay in their column at the desktop width; tokens only. List the baselines that change for the lead to remake in the Linux image; do not remake them on the host.

Files: the tests, workers and screens above, the journeys' set-up, `en.json` if a word changes. Not here: anything G1 owns (`feat/g1-production`: `.github/workflows/release.yml`, `migrate.yml`, `.github/actions/`, `infra/aws/`, `apps/web/scripts/vercel-ignore.ts`, `apps/web/src/auth/deps.ts`, `apps/web/src/workers/jobs-check.ts`, `backup-age.ts`, `packages/db/src/migrate.ts`, `backup-login.ts`, the deploy and accounts runbooks). Item 1's CI step is in `.github/workflows/ci.yml`; a change there makes the pull request need the owner's `checks-ok`, so keep it to the one step and say so in the report. Shared lists are append-only.

Done when: each changed unit test passes three times in a row, each changed journey twice in a row on the same database; the security suite passes on the slot's Postgres; a first journey command after `e2e:seed` answers within its usual time (show the timing before and after in the report).

**How to work:** you are the only builder on the PC, but the lead may run an integration beside you, so every lint, typecheck, test, build and journey, folder-level ones too, goes through `bash tools/integration/heavy.sh <command>` (the main checkout's copy). Commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Never open a pull request, install a dependency or touch a hosted service.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
