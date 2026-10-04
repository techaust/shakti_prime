# Building and merging a slice

How one slice of a phase goes from a brief to `main` and the hosted environments. The scripts are in `tools/integration/`; the skills in `.claude/skills/` run these steps (`integrate-slice`, `migrate-hosted`, `end-session`), and the agents in `.claude/agents/` build and review. Status after each merge goes to [docs/STATUS.md](../STATUS.md); history to [CHANGELOG.md](../../CHANGELOG.md).

**Contents:** [1. Machines and ports](#1-machines-and-ports) · [2. Set up a slice](#2-set-up-a-slice) · [3. Build](#3-build) · [4. Review](#4-review) · [5. Take main into the slice](#5-take-main-into-the-slice) · [6. Integrate](#6-integrate) · [7. Linux screenshot baselines](#7-linux-screenshot-baselines) · [8. Pull request and merge](#8-pull-request-and-merge) · [9. Hosted environments](#9-hosted-environments) · [10. Lessons](#10-lessons)

## 1. Machines and ports
- Bash is required: Git Bash on Windows, bash on Linux. Docker runs every database; Python 3 runs the merge helpers.
- Each slice has its own worktree under `$WT_ROOT` (default: a `shakti-wt` folder beside the main checkout; on the owner's PC `WT_ROOT=/d/shakti-wt`), its own Postgres container `shakti-pg-<slug>` and its own app port.
- Ports: the main checkout uses Postgres 54322 and app 3000; slice *n* uses Postgres 5433*n* and app 303*n* (for example 54339 and 3039); the integration database is always 54340.
- At most three building agents and one reviewer at a time on a machine with 8 GB of memory.

## 2. Set up a slice
- `bash tools/integration/setup-worktree.sh <slug> <branch> <db-port> <app-port>` from any checkout.
- It reuses the branch when it exists locally or on GitHub, else branches from `origin/main`.
- It writes the worktree's `.env` with every database URL on the slice's port, `BETTER_AUTH_URL` and `E2E_BASE_URL` on the app port, and refuses to finish if a URL points elsewhere.
- It starts an empty Postgres and installs the packages.

## 3. Build
- Write the brief: goal, the design section, files owned, tables, contracts, what another slice owns, the definition of done ([AGENTS §10](../../AGENTS.md)), and the stop triggers.
- Start the `slice-builder` agent with the brief's path and the worktree. One slice per wave owns the hot files (`crm.lead.create`, the opportunity commands, the board); shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue) are append-only.
- Watch for stalls: run `bash tools/integration/watchdog.sh` under a monitor; it prints a line for a worktree idle for 20 minutes. An agent that stalls is stopped and a fresh one starts from the last commit with a precise list.

## 4. Review
- Start the `slice-reviewer` agent on the branch (fresh context, read-only).
- Verify each finding yourself before acting on it; fix every medium or worse before the merge (a builder agent on the same branch, or by hand).

## 5. Take main into the slice
A slice built while others merged takes `main` by a merge commit, never a rebase: one conflict pass, and a normal push.

1. `git rev-parse HEAD > ../<slug>-premerge.sha`, then `git fetch && git merge --no-commit origin/main`.
2. Resolve conflicts:
   - lists (testing lists, fixtures, registries): `python tools/integration/merge-union.py <file>`, then read every code hunk by hand;
   - `apps/web/messages/en.json`: `python tools/integration/merge-json.py apps/web/messages/en.json` (prints any key both sides changed; `main`'s value is kept);
   - `tools/copy-lint/copy-lint.config.json`: `python tools/integration/merge-copylint.py`;
   - documents and code: by hand.
3. Renumber the slice's migrations after `main`'s last one: `node tools/integration/renumber-migrations.mjs origin/main $(cat ../<slug>-premerge.sha)`. It keeps each migration's SQL as written, restores `main`'s journal and snapshots, and gives each moved migration a journal time after `main`'s last. The hosted migrator skips a migration older than the last one applied.
4. `pnpm db:generate` must report no changes; `pnpm db:docs`; correct any migration number the slice's documents cite.
5. Commit the merge (`chore: merge main (<what>) into <slice>; its migrations move to NNNN to MMMM`).

## 6. Integrate
- Start `bash tools/integration/integrate.sh <worktree> <log>` in the background (30 to 60 minutes).
- It runs install, lint, format, copy lint, the generated-files check, typecheck, unit tests, the security suite, `db:verify`, the audit, the build with `.env` aside, the JavaScript budget, the secret scan over the branch's own commits and the end-to-end journeys, all on a fresh Postgres on 54340.
- The last line of `<log>` is `INTEGRATION PASSED` or `INTEGRATION FAILED`; a failed step's output is in `<log>.<step>`.

## 7. Linux screenshot baselines
- Only on a fresh database: `bash tools/integration/fresh-db.sh shakti-pg-<slug> <db-port>`, then `pnpm db:migrate && pnpm db:seed`, then `pnpm build`.
- `pnpm --filter web e2e:snap -- --update-snapshots=missing` writes the baselines of new screens. A screen the slice changes on purpose (a new menu item) needs its old baseline deleted first, and the new one looked at before it is committed.
- Run `pnpm --filter web e2e:snap` once more without updating: every screenshot must match. Text that changes between runs is masked in the spec (`snap(page, name, { mask })`), never accepted as a flaky difference.

## 8. Pull request and merge
- Push the branch and open the pull request with what it builds, its migrations, its checks and anything left for the owner. End the body with the Claude Code line.
- The merge-on-green workflow merges it when CI passes. Nobody merges by hand or pushes to `main`. A commit pushed after CI started is not in the merge: check with `git merge-base --is-ancestor <sha> origin/main` and carry it in the next pull request.
- The `hold` label stops a merge; after removing it, re-run the CI run (`gh run rerun <id>`), since the workflow acts only when a run finishes.

## 9. Hosted environments
After a pull request with migrations merges and CI on `main` is green (the owner's standing go-ahead, [DECISIONS](../DECISIONS.md)):

1. `gh workflow run migrate.yml -f environment=dev -f seed=true`; wait for it (`gh run watch`); then the same with `environment=staging`.
2. Vercel deploys `main` to both projects by itself; wait for both deployments.
3. `/api/v1/health` and `/api/v1/health/ready` answer 200 on both sites ([STATUS](../STATUS.md#hosted-environments) has the addresses).
4. The count of `drizzle.__drizzle_migrations` equals the number of migration files.
5. Any new subscribed event's QStash URL group is made by the publisher itself; a new pg_cron job is checked in `cron.job`.

Anything else on a hosted service (new resources, settings, plans, deletions) asks the owner first. If a step fails, [INCIDENTS](INCIDENTS.md) says what to do.

## 10. Lessons
- Make baselines only on a fresh database; a database the security suite used shows leftover rows.
- A worktree's `.env` needs `E2E_BASE_URL` on its own port and the reader pair (`DATABASE_URL_READER`, `APP_READER_PASSWORD`).
- gitleaks scans every branch pushed to GitHub, so a key-like literal in a test fails CI even on a backup branch; history is never rewritten on GitHub, so rebased work goes up under a new branch name.
- The Claude usage limit stops every agent at once; work committed every 20 minutes survives, and a fresh agent continues from the branch.
- Agents sometimes stop working for about 30 minutes without a tool call; stop them and start a fresh one from the last commit.
