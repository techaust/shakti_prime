# Building and merging a slice

How one slice of a phase goes from a brief to `main` and the hosted environments. The scripts are in `tools/integration/`; the skills in `.claude/skills/` run these steps (`integrate-slice`, `migrate-hosted`, `end-session`), and the agents in `.claude/agents/` build and review. Which steps run in a cloud session and which on the PC is [hybrid](hybrid.md). Status after each merge goes to [docs/10-status.md](../10-status.md); history to [CHANGELOG.md](../../CHANGELOG.md).

**Contents:** [1. Machines and ports](#1-machines-and-ports) · [2. Set up a slice](#2-set-up-a-slice) · [3. Build](#3-build) · [4. Review](#4-review) · [5. Take main into the slice](#5-take-main-into-the-slice) · [6. Integrate](#6-integrate) · [7. Linux screenshot baselines](#7-linux-screenshot-baselines) · [8. Pull request and merge](#8-pull-request-and-merge) · [9. Hosted environments](#9-hosted-environments) · [10. Lessons](#10-lessons)

## 1. Machines and ports
- Bash is required: Git Bash on Windows, bash on Linux. Docker runs every database; Python 3 runs the merge helpers and the link check. Every command starts with `cd "<checkout>" && . tools/integration/lib.sh &&`, which puts pnpm on `PATH` on the PC and maps `python3` to `python` where Git Bash has only that.
- On the PC, each slice has its own worktree under `$WT_ROOT` (default: `D:/shakti-wt` where it exists, as on the owner's PC, else a `shakti-wt` folder beside the main checkout), its own Postgres container `shakti-pg-<slug>` and its own app port. A cloud session has one checkout, with Postgres on 54322 and the app on 3000 ([hybrid §8](hybrid.md#8-what-stays-on-the-pc-and-why)).
- Ports on the PC: the main checkout uses Postgres 54322 and app 3000; the integration database is always 54340. A slice takes a free slot *n* from 1 to 19 except 10, and uses Postgres 54330 + *n* and app 3030 + *n*: slot 7 is 54337 and 3037, slot 11 is 54341 and 3041. Slot 10 is never used (54340 is the integration database). The slot is written in the slice's run file and freed when the slice merges.
- On the owner's 8 GB PC: at most two building agents at once, and one heavy command (whole-repository lint, typecheck, build, the security suite, journeys, `integrate.sh`, `e2e:snap`) at a time through `bash tools/integration/heavy.sh <command>`, a lock shared by every worktree; the rule, its dates and the model rules are in [CLAUDE.md](../../CLAUDE.md) and [DECISIONS](../11-decisions.md). Never more than the Claude plan allows across the PC and the cloud ([hybrid §5](hybrid.md#5-how-many-at-once)).

## 2. Set up a slice
- `bash tools/integration/setup-worktree.sh <slug> <branch> <db-port> <app-port>` from any checkout on the PC.
- It reuses the branch when it exists locally or on GitHub, else branches from `origin/main`.
- It writes the worktree's `.env` with every database URL on the slice's port, `BETTER_AUTH_URL` and `E2E_BASE_URL` on the app port, and refuses to finish if a URL points elsewhere.
- It starts an empty Postgres and installs the packages (offline from the store first, then from the registry).
- A slice built in a cloud session needs none of this: the session clones the branch and its start hook makes `.env` and starts Postgres ([hybrid §2](hybrid.md#2-what-a-cloud-session-has-and-lacks)).

## 3. Build
- Write the slice's run file `docs/runs/phase1/<slug>.md` from [the template](../runs/phase1/readme.md): goal, the design section, files owned, tables, contracts, what another slice owns, the stop triggers. The rules every builder follows are in `.claude/agents/slice-builder.md` and the definition of done in [AGENTS §10](../../AGENTS.md#10-definition-of-done); the run file does not repeat them.
- Push the branch with the run file, then start the builder: a cloud session with the first message of [hybrid §4](hybrid.md#4-starting-a-builder-or-a-reviewer), or the `slice-builder` agent on the PC with the run file's path and the worktree.
- One slice per wave owns the hot files (`crm.lead.create`, the opportunity commands, the board); shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue) are append-only.
- On the PC, watch for stalls from the moment the first agent starts until the last one ends: run `bash tools/integration/watchdog.sh` under a monitor (a monitor lasts at most 30 minutes, so arm it again at each expiry while an agent runs), with every merged slice's slug listed in `D:/shakti-wt/.done`; it prints a line for a worktree idle for 20 minutes. An agent that stalls is stopped and a fresh one starts from the last commit with a precise list.
- The lead owns the slots' containers: a builder never runs `docker` or `fresh-db.sh`; when it needs a fresh database it commits and stops with a report, and the lead recreates the database, pushes the branch and resumes it. The lead stops each slot's database when its agent ends.

## 4. Review
- Start the reviewer on the branch with fresh context: a cloud session with the reviewer's first message of [hybrid §4](hybrid.md#4-starting-a-builder-or-a-reviewer) (it writes its findings into the run file), or the `slice-reviewer` agent on the PC (it reports; the lead session copies the findings into the run file).
- Verify each finding yourself before acting on it; fix every medium or worse before the merge (a builder on the same branch, or by hand).

## 5. Take main into the slice
A slice built while others merged takes `main` by a merge commit, never a rebase: one conflict pass, and a normal push.

1. `git rev-parse HEAD > ../<slug>-premerge.sha`, then `git fetch && git merge --no-commit origin/main`.
2. Resolve conflicts:
   - lists (testing lists, fixtures, registries): `python3 tools/integration/merge-union.py <file>`, then read every code hunk by hand;
   - `apps/web/messages/en.json`, before `git add` on it: `python3 tools/integration/merge-json.py apps/web/messages/en.json` (prints any key both sides changed; `main`'s value is kept);
   - `tools/copy-lint/copy-lint.config.json`: `python3 tools/integration/merge-copylint.py` (one conflict hunk);
   - documents and code: by hand.
3. Install the merged packages (`pnpm install --offline --frozen-lockfile`), then renumber the slice's migrations after `main`'s last one: `node tools/integration/renumber-migrations.mjs origin/main $(cat ../<slug>-premerge.sha)`. It keeps each migration's SQL as written, restores `main`'s journal and snapshots, and gives each moved migration a journal time after `main`'s last. The hosted migrator skips a migration older than the last one applied.
4. `pnpm db:generate` must report no changes; `pnpm db:docs`; correct any migration number the slice's documents cite.
5. Commit the merge (`chore: merge main (<what>) into <slice>; its migrations move to NNNN to MMMM`).

## 6. Integrate
- Start `bash tools/integration/heavy.sh bash tools/integration/integrate.sh <worktree> <log>` in the background (30 to 60 minutes; the lock keeps every other heavy command waiting meanwhile, and clears itself after 90 minutes, so a longer run is split with `INTEGRATE_STEPS`).
- It runs install, lint, format, copy lint, the generated-files check, typecheck, unit tests, the security suite, `db:verify`, the audit, the build with `.env` aside, the JavaScript budget, the secret scan over the branch's own commits and the end-to-end journeys, all on a fresh Postgres on 54340. It does not run Lighthouse or compare screenshots; CI runs Lighthouse on the pull request, and the screenshots are §7.
- The last line of `<log>` is `INTEGRATION PASSED` or `INTEGRATION FAILED`; a failed step's output is in `<log>.<step>`.

## 7. Linux screenshot baselines
- Only on a fresh database: `bash tools/integration/fresh-db.sh shakti-pg-<slug> <db-port>` (in a cloud session, `docker compose down -v && docker compose up -d --wait`), then `pnpm db:migrate && pnpm db:seed`, then `bash tools/integration/heavy.sh pnpm build`.
- `bash tools/integration/heavy.sh pnpm --filter web e2e:snap -- --update-snapshots=missing` writes the baselines of new screens. A screen the slice changes on purpose (a new menu item) needs its old baseline deleted first, and the new one looked at before it is committed.
- Run `bash tools/integration/heavy.sh pnpm --filter web e2e:snap` once more without updating: every screenshot must match. Text that changes between runs is masked in the spec (`snap(page, name, { mask })`), never accepted as a flaky difference.

## 8. Pull request and merge
- Push the branch and open the pull request from the [template](../../.github/pull_request_template.md): what it builds, its migrations, the definition-of-done list, its checks and anything left for the owner. End the body with the Claude Code line.
- The merge-on-green workflow merges it when CI passes ([AGENTS §8](../../AGENTS.md#8-git-and-pull-requests)). Nobody merges by hand or pushes to `main`. A commit pushed after CI started is not in the merge: check with `git merge-base --is-ancestor <sha> origin/main` and carry it in the next pull request.
- The `hold` label stops a merge; after removing it, re-run the CI run (`gh run rerun <id>`), since the workflow acts only when a run finishes.

## 9. Hosted environments
After a pull request with migrations merges and CI on `main` is green: migrate dev, then staging, and check both, as [DEPLOY §2](deploy.md#2-every-deploy) says; the `migrate-hosted` skill runs it from the PC under the owner's standing go-ahead ([DECISIONS](../11-decisions.md)). Anything else on a hosted service asks the owner first. If a step fails, [INCIDENTS](incidents.md) says what to do.

## 10. Lessons
Each is a rule that a past slice earned.

**Databases and baselines**
- Make baselines only on a fresh database; a database the security suite used shows leftover rows.
- Wait until several queries in a row succeed before migrating a fresh database: `pg_isready` answers while the Supabase image is still starting.
- A worktree's `.env` needs `E2E_BASE_URL` on its own port and the reader pair (`DATABASE_URL_READER`, `APP_READER_PASSWORD`).
- A new menu item changes every baseline that shows the menu, in screens the slice never touched. Delete and remake every desktop staff baseline that shows the menu, compare each with the old one, and run the full `e2e:snap` verification before the pull request. Playwright counts each baseline it writes as a failure, so only the run without updating is the check, and a baseline that passes under its 1 % allowance can still lack the menu item.
- Only the Linux image's run (`e2e:snap`, as CI) counts; screenshots compared on a cloud VM's host can differ in font hinting.
- `pnpm --filter web e2e -- <spec>` runs every spec; `e2e:snap` takes spec paths.
- `--update-snapshots=changed` keeps a screen whose change is under the 1 % allowance, so an intended change (a note removed, a menu item added) can stay unrecorded: update that spec's screenshots with `--update-snapshots=all --grep "<test>"`, never the whole suite, which rewrites every image with rendering noise.
- The journeys' server is started in three places, and a variable a journey needs goes in all three: `playwright.config.ts`'s `webServer`, `e2e/setup/snap-in-linux.ts` and CI's "Start the app" step (K1's `AI_TRANSPORT=fake` was missing from the last two).
- A full-page screenshot after `page.reload()` keeps the scroll position, which draws the fixed menu across the page: scroll to the top first. A screenshot of a list that other journeys fill (the notification centre) changes from run to run: leave it out or mask the whole list.
- A journey that chooses a branch by the time of day (calling hours) fails when a run crosses the boundary (21:00 IST); run it again before treating it as a defect.

**Merging with main**
- Renumber migrations after `pnpm install`: run before it, the script's `drizzle-kit` runs against stale packages and writes nothing, the last moved snapshot is a copy of the one before, and `pnpm db:generate` then writes a migration. Fold that generated snapshot into the last moved migration's (keeping its `id` and `prevId`) and delete the generated SQL, snapshot and journal entry.
- After the merge, diff every function, check and key the slice's migrations redefine against `main`'s latest definition, and grep the lists for a key used twice. S1, D1 and T1 each had a clash no conflict marker showed: a moved migration that redefined `app.platform_only_permissions()` or the `activities` type check without what `main` had added, a foreign key on a lead's `account_id` with no update action that broke a customer merge, an audit field name with two kinds, and the matrix fixture's id offsets.

**Branches and secrets**
- Never force-push or delete a remote branch, and never leave a key-like literal in a test: the rules and their reasons are in [CLAUDE.md](../../CLAUDE.md#secret-scan-and-dependencies). Rewritten work goes up under a fresh branch name (`feat/c3-pipelines-r2`).

**Memory, stalls and limits**
- Never run two heavy commands together (see [§1](#1-machines-and-ports)): three agents each linting the whole repository used all of the 8 GB and stopped Docker. Lint one folder at a time until the final whole-repository lint, and run at most two builders while an integration run goes.
- Rerun a test that hits vitest's 20-second limit, or a journey its 60 seconds, alone, and the suite with nothing else running, before treating it as a defect.
- Before a full `e2e:snap` run, pause every other agent and stop their databases: with builders beside it the Playwright container ran out of memory and died.
- Stop an agent that has made no tool call for about 20 minutes and start a fresh one from the last commit with a precise list; the watchdog of [§3](#3-build) reports the stall.
- An agent's background wait (an `until` loop on a log line) has a time limit and is stopped before the agent reports: on 09-10-2026 one waited five hours for a line a failed run never wrote, and kept its agent from finishing.
- The Claude usage limit stops every agent at once, on the PC and in the cloud. Work committed every 20 minutes (and pushed, in the cloud) survives, and a fresh agent continues from the branch.
