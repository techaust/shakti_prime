# Audit fixes: CI, merging, tests and documents (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-ci`, from `main` |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-ci`, slot 8: Postgres 54338, app 3038 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (the merge workflow decides what reaches `main`): build Opus 5.5 high, review Opus 5.5 xhigh |
| Usage | the gate's reading at the start and end of each agent run |
| State | brief |
| Next step | the lead branches it from `main` and starts the builder |

## Brief
The audit's evidence: [`5-ops.md`](../../14-reviews/2026-10-audit/5-ops.md), [`5-ops.verdict.md`](../../14-reviews/2026-10-audit/5-ops.verdict.md) (OPS-7 and OPS-12 were refuted: do not fix them) and [`6-arch.md`](../../14-reviews/2026-10-audit/6-arch.md). Report: `docs/14-reviews/2026-10-audit.md`. The merge workflow runs from `main`, so its changes take effect after this merges; test them with `jq` on sample payloads and a scratch repository, as the auditor did.

1. **OPS-1 and OPS-V1 (medium):** a pull request merges only on the `main` it was tested with: when `main` moved, the workflow updates the branch (`gh pr update-branch`) and the new run decides; TESTING §6 says so.
2. **OPS-2 (medium; owner, 13-10-2026):** a pull request that changes the checks themselves (`.github/`, `turbo.json`, the vitest and Playwright configs) runs CI as usual but merges itself only once the owner has added the label `checks-ok`; every other pull request still merges itself on green. AGENTS §8 and TESTING §6 say so.
3. **ARCH-1 (medium):** the lint fences refuse `defineCommand`, `runCommand`, `executeCommand` with a command not from the registry, the audit, outbox and idempotency sinks, and `drizzle-orm` in `apps/web` outside the files that need them; `executeCommand` refuses a command missing from the registry at run time; a lint probe test.
4. **OPS-6 (low):** the missing denied and wrong-company tests for the commands the verdict lists, and a registry-driven check that every command has both.
5. **OPS-10, OPS-11, OPS-13 to OPS-19 (low):** a fork's branch name; concurrency on the merge job and a schedule that re-evaluates green pull requests; `--no-renames`; migrate secrets only on the steps that need them; absolute screenshot thresholds and masks on cells; flaky journeys reported and not merged (fix the known flaky `pipelines.spec.ts` referral-partners journey and the converting journey's clock first); Turbo test inputs; one helper for test phone numbers; images pinned by digest.
6. **ARCH-7 to ARCH-11 (low):** the PRD trace, ROADMAP milestones, README, TESTING and ARCHITECTURE lines brought to the code; the duplicated IST and worker-error helpers made one; the dead fixture removed.

Done when: the checks of AGENTS §10 pass; every workflow change tested on sample payloads, with the results in the report.

**How to work:** as every brief: commit every 20 minutes, never push, never docker, heavy commands through `bash /home/user/shakti_prime/tools/integration/heavy.sh`, no pull request, no install, no hosted service.

## Report
### 13-10-2026, cloud (slot 8: Postgres 54338, app 3038), builder on Opus 5.5 high
Skills loaded: none of the listed ones applied (no table, no new command, no screen); the work followed AGENTS §5, §8 and §10 directly.

**Each finding against the evidence first.** Confirmed in the code at `b45dd07b` and fixed: OPS-1/OPS-V1, OPS-2, OPS-6 (plus nine more missing cases the new check found), OPS-10, OPS-11, OPS-13, OPS-14, OPS-15, OPS-16, OPS-17, OPS-18, OPS-19, ARCH-1, ARCH-7 to ARCH-11. Not fixed: OPS-7 and OPS-12 (refuted by the verdict, as the brief says). No longer applies: "the converting journey's clock" — #167 (`958b045a`) already moved `converting.spec.ts` onto the test clock (`setServerClock`), so nothing was changed there.

**Each finding, its state and its commit**
| Finding | State | Commit |
|---|---|---|
| OPS-1, OPS-V1 (merge only on the tested `main`) | fixed | `945ab839` (workflows), `3e85a2bb` (TESTING §6), `870b96d5` (runbooks) |
| OPS-2 (`checks-ok`) | fixed | `945ab839`, `3e85a2bb` (AGENTS §8, CLAUDE.md, TESTING §6), `870b96d5` |
| OPS-6 (denied and wrong-company cases, registry check) | fixed | `aa34b7ef` (the audit's 11 commands), `74953c6d` (the check and the 9 it found), `b70255e5` |
| OPS-7 | refuted by the verdict, not fixed | — |
| OPS-10 (a fork's branch name) | fixed | `945ab839` |
| OPS-11 (job concurrency, a schedule) | fixed | `945ab839` |
| OPS-12 | refuted by the verdict, not fixed | — |
| OPS-13 (`--no-renames`) | fixed | `945ab839` |
| OPS-14 (migrate secrets on their steps) | fixed | `945ab839` |
| OPS-15 (absolute screenshot limit, cell masks) | fixed; baselines open (Linux image) | `aa34b7ef` |
| OPS-16 (flaky journeys fail CI; the referral journey) | fixed | `aa34b7ef` (`failOnFlakyTests`), `870b96d5` (hydration) |
| OPS-16, the converting journey's clock | no longer applies (#167, `958b045a`) | — |
| OPS-17 (Turbo test inputs) | fixed | `aa34b7ef` |
| OPS-18 (one phone helper) | fixed | `38d810c3`, `b70255e5` |
| OPS-19 (images by digest) | fixed; digests to confirm at the registry | `945ab839`, `870b96d5` (Dependabot note) |
| ARCH-1 (fences, registry check at run time, probes) | fixed | `aa34b7ef`, `74953c6d` |
| ARCH-7 (PRD trace) | fixed | `3e85a2bb` |
| ARCH-8 (ROADMAP, README) | fixed | `3e85a2bb` |
| ARCH-9 (TESTING rows and spike commands) | fixed | `3e85a2bb` |
| ARCH-10 (ARCHITECTURE lines) | fixed | `3e85a2bb` |
| ARCH-11 (IST helpers, worker error answer, dead fixture) | fixed; the shared signed-body prelude of three routes open | `b40b557f`, `b70255e5` |

**What was built (files)**
- **OPS-1, OPS-V1, OPS-2, OPS-10, OPS-11** — `.github/workflows/automerge.yml` rewritten:
  - the rule judges one pull request against the commit CI passed on and answers `merge`, `update` or `skip: <why>`; it reads the PR's full file list (REST, paged, renames from and to) and `compare/<main>...<tested>`'s `behind_by`;
  - `update` (main moved since the tested commit): `PUT pulls/<n>/update-branch` with `expected_head_sha`, waits up to a minute for the new head, then `gh workflow run ci.yml --ref <branch>` (a commit made with the workflow's token starts no `pull_request` run); that run's success brings the PR back; a conflict fails the run with a plain line;
  - `checks-ok`: a PR whose files (or renamed-from paths) match `^\.github/`, `turbo.json` or `(vitest|playwright)(.*)?.config.[cm]?[jt]s` skips with the list until the owner's label is on; a PR listing more files than GitHub returns needs the label too;
  - forks: the job runs only for a CI run of this repository (`head_repository.full_name`), and the PR list drops cross-repository PRs, so a fork's same-named branch no longer shadows the owner's PR;
  - `concurrency` moved onto the job; a `schedule` (4 a day, 23 past 01, 05, 09, 13 UTC) and a `workflow_dispatch` (`-f pull_request=<n>`, digits only) look again at open PRs whose latest CI run (pull_request or workflow_dispatch) passed.
- **CI** — `.github/workflows/ci.yml`: *What changed* uses `git diff --no-renames` (OPS-13) and compares a `workflow_dispatch` run on a branch with `origin/main`; e2e and Lighthouse run on every ref but `main` (pull requests and the re-test runs the merge workflow starts); images pinned by digest (OPS-19).
- **OPS-14** — `.github/workflows/migrate.yml`: no job-level secrets; the check step, `db:migrate` (one step, `--rotate-passwords` from the boolean input), `db:verify` and the seed each get only the secrets they read; checkout and `pnpm install` get none.
- **OPS-19** — `supabase/postgres:17.6.1.177@sha256:8b1dc570…` and `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30…` in `ci.yml`, `compose.yaml` and `apps/web/e2e/setup/snap-in-linux.ts`; `apps/web/src/ci-images.test.ts` keeps every copy pinned and equal, and the Playwright tag at `@playwright/test`'s version; `.github/dependabot.yml`'s comment says they move by hand.
- **OPS-15, OPS-16** — `apps/web/playwright.config.ts`: `maxDiffPixels: 300`, `threshold: 0.2` instead of `maxDiffPixelRatio: 0.01`; `failOnFlakyTests` in CI. `apps/web/e2e/targets.spec.ts` masks the team lead board's `tbody` and `dl dd` instead of whole tables and lists. `apps/web/e2e/pipelines.spec.ts` (the known flaky referral-partners journey) clicks the code button and types the amount only after `hydrated()`.
- **OPS-17** — `turbo.json`: `@shakti/db#test` + `docs/07-security.md`; a new `@shakti/domain#test` + `docs/state-machines/**`, `packages/db/tests/**`, `apps/web/tests/**` (read by the new coverage check); `web#test` + `infra/aws/files.yaml`, `.github/workflows/ci.yml`, `compose.yaml`.
- **OPS-18** — `testPhone()` in `packages/db/src/testing/phone.ts` (exported from `@shakti/db/testing`): ten digits, 6 to 9 first, counting up from the clock in milliseconds per file; every random phone draw of the three suites (41 files) uses it; the two assertions that leaned on a fixed prefix (`call-queue.test.ts`, the printed quote's no-number check in `quotes.test.ts`) now match any drawn number.
- **ARCH-1** — `eslint.config.mjs`: apps/web may not import `defineCommand`, `runCommand`, `databaseAuditSink`, `databaseOutboxSink` or `databaseIdempotencyStore` from `@shakti/domain` (named or `* as`), no file of `packages/domain/src` by a relative path (the testing settings keep their own fence and message), no `drizzle-orm` outside `src/auth`, and no dynamic import of `@shakti/domain` or `drizzle-orm`. `executeCommand()` refuses (`internal`, before any connection) a command that is not the registry's object under its name (`isRegistered()`, `packages/domain/src/command/registry.ts`); tests that exercise the runner with their own command add it through `allowTestCommand()` from `@shakti/domain/testing`.
- **OPS-6** — the missing cases: `crm.task.reschedule`/`.cancel` (denied, colleague, company), `crm.stage.reorder`/`.archive` (GM and caller denied, group scope, company 2's pipeline), `crm.contact.update`/`crm.site.upsert` (denied, company, a customer the company does not share), `crm.consent.withdraw`, `crm.caller_profile.set_presence` (company), `sales.dealer_outstanding.record`, `agents.inbox.edit` (denied, agent, other person, company), `agents.inbox.complete`; and the ones the new check found: `crm.tag.archive`, `crm.note.add`, `crm.customer.unmerge` (denied), `sales.order.cancel` (another company's order), `catalogue.item.update`/`.archive` and `catalogue.kit.update`/`.archive` (denied), `files.file.mark_ready`. `packages/domain/src/command/refusal-coverage.test.ts` reads the registry and the three suites' test cases (an `it`, or a whole `.each` table, with the helpers and constants it names) and fails when a command has no denied (`'forbidden'`) or no wrong-company case and is not in its reviewed list; the list holds the eight personal-setting commands (no company in their input, `profile.write:own` in every person's role) and fails when an entry is no longer needed.
- **ARCH-7 to ARCH-10** — `docs/02-prd.md` (RPT-04, AI-01 test files), `docs/03-roadmap.md` (waves 4 and 5 reached), `README.md` (where work runs), `docs/09-testing.md` (five security files, three spike commands, the retrieval item no longer "to come", §5 and §6 for the new rules), `docs/04-architecture.md` (the Triage filter is built; `agent_evals` has no writer); and `AGENTS.md` §8 and `CLAUDE.md` one line each for `checks-ok`; `docs/runbooks/slice-integration.md`, `deploy.md` and `incidents.md` lines that described the old merge behaviour.
- **ARCH-11** — `IST_OFFSET_MS`, `istCalendarDate()` and `istDayStart()` once in `packages/domain/src/numbering/financial-year.ts` (call schedule, Triage facts, targets, the quote machine, dial policy, push plan, the AI spend day and its two reads use them; `istDay` gone from the domain); `apps/web/src/screens/ist.ts` the browser's one copy (browser code takes no domain value), held equal by `ist.test.ts`, used by the shadow report, the Activity log, calling and print; `workerFailure()` and `NO_RETRY` once in `apps/web/src/workers/route-answers.ts` for the nine worker routes and the nightly route (every status they passed equalled `ERROR_HTTP_STATUS`); `apps/web/src/print/fixtures/spike-images.ts` deleted. The shared signed-body prelude for `quotes/expire`, `files/sweep` and `outbox/publish` was not done (below).

**Tests added:** domain security suite 25 new cases (tasks 6, stages 6, contact and site 6, note 1, consent 1, presence 1, dealer outstanding 1, inbox edit 1, inbox complete 1, tag 1) and new assertions in 6 existing cases (catalogue 2, files 2, unmerge, order cancel); unit tests 13 (`execute.test.ts` 2, `refusal-coverage.test.ts` 3, `lint-fences.test.ts` 2, `ci-images.test.ts` 2, `phone.test.ts` 3, `ist.test.ts` 1).

**Workflow changes, tested on sample payloads** (`scratchpad` scripts, not committed):
- The merge rule extracted from `automerge.yml` with `yq`/Python and run with jq 1.7: 31 of 31 cases as wanted (up to date → merge; main moved → update; newer head, hold, draft, fork, base, closed, stranger; `.github/` file, `turbo.json` at the root and not nested, `vitest.config.ts`, `vitest.security.config.ts`, `vitest.config.mjs`, `playwright.config.ts`, a spec named playwright not a config, a rename out of `.github/`, more files than listed, with and without `checks-ok`; checks-ok with hold; Dependabot group, minor, major, a SHA-titled actions bump, an actions minor bump waiting for `checks-ok`).
- The whole step run with bash against a stand-in `gh` (answers from scenario files, every call logged): 8 of 8 — merge with delete and CI on main; main moved → `update-branch` with `expected_head_sha`, waits for the new head, `gh workflow run ci.yml --ref fix/a`; a conflicting update → plain line and exit 1; a fork's same-named PR ignored; a workflow change without the label waits; a scheduled look over a failed run, a passed run with `checks-ok` (merged) and a run in progress; a dispatch for one PR; a dispatch with something other than a number refused.
- *What changed* run in a scratch git repository: a module moved from `packages/` into `docs/` lists both paths and gives `code=true` (before: only its new path); documents only → `code=false`; a dispatch on a branch compares with `origin/main` the same way; push and dispatch on main → `code=true`.
- Every workflow parses as YAML, every `uses:` is pinned by SHA, every `needs` exists. `actionlint` and `shellcheck` are not installed here, so neither ran.
- **Not verifiable here:** GitHub's own behaviour — that `update-branch` by the workflow's token is allowed when `main`'s new commits change a workflow file (the token has no `workflows` scope; if refused, the run fails with the "take main into it by hand" line), that a dispatch run on the branch shows on the PR, and the schedule. The image digests were read from this VM's containerd store (the index blobs' own SHA-256, which matches their names; the gitleaks digest found there equals the one `ci.yml` already pins); confirm them with `docker buildx imagetools inspect` where the registry is reachable.

**Checks run** (all through `heavy.sh`)
- Security suite on 54338: `pnpm test:security` — db 40 files passed; domain then failed 10 cases in 4 files because ARCH-11 and the phone helper were applied while it waited for the lock (`istDay` still imported by two agent reads and `knowledge.test.ts`; `call-queue.test.ts` asserted a `94` prefix). Fixed in `b70255e5`, then domain `Test Files 72 passed (72), Tests 960 passed (960)` and web `Test Files 22 passed (22), Tests 303 passed (303)`.
- Unit: domain `Tests 2062 passed (2062)`, web `Tests 770 passed | 1 skipped (771)`, db `Tests 133 passed (133)`.
- Typecheck: web, domain and db clean.
- Folder lint (`packages/domain apps/web/src apps/web/e2e apps/web/tests packages/db`): clean. Whole-repository `pnpm lint` (the final check): passed, no warning.
- `pnpm build`: passed; `js-budget`: every page within its budget (46 pages).
- Journeys `pipelines.spec.ts` and `targets.spec.ts` on this Linux host (`E2E_CPU_THROTTLE=4`, after `e2e:seed`): 28 passed, 24 failed, 15 did not run; every failure is `toHaveScreenshot` (48 errors with the retries), because on a Linux host `snap()` compares against the baselines made in the Playwright image, and this slot's database holds stages and rows the security suite left (`settings-pipelines` is 13,474 px tall here against 5,742); the steps before each picture passed. The serial Pipelines group then skipped the referral journey, so it ran alone: `-g "referral partners" --repeat-each 3 --retries 0` under the same throttle, after a fresh `e2e:seed`: every run shown passed (desktop light 3 of 3, desktop dark 2 shown; the listing was cut at 20 lines, so the phone runs and the summary line were not kept). The screenshots are for the lead's run in the Linux image on a fresh database.
- `check-doc-links.py`: `bad 0`. After the last commit: `pnpm exec prettier --check .` "All matched files use Prettier code style!", whole-repository `pnpm lint` passed with no warning, `pnpm copy-lint` "catalogues and templates are clean".
- `EXPLAIN (ANALYZE)`: no list or search was added or changed.

**Unfinished or uncertain**
- The signed-body prelude shared by `quotes/expire`, `files/sweep` and `outbox/publish` (ARCH-11's second half): those routes now share the error answer and retry header, but each still reads and verifies its own body; folding them into `nightlyWorkerRoute` changes three routes' behaviour and tests, beyond the brief's "helpers made one".
- The pipelines flake was fixed by its likely cause (a click before hydration on a loaded machine), not reproduced first; and with `failOnFlakyTests`, the other known retry-only passes (`orders.spec.ts` dealer credit, `files.spec.ts` logo axe, see STATUS) now fail a CI run instead of passing.
- Screenshots: the `home-team-lead` baselines (three projects) change with the new masks, and every baseline must now match within 300 pixels; only the Linux image can say whether all do. Make them on a fresh database.
- The `checks-ok` label approves the PR as it stands: a later push that changes the checks again keeps the label; the owner takes it off to read again. The workflow cannot tell who added it (every PR is the owner's account).
- 13-10-2026's decision line is in the lead's `docs/11-decisions.md`, not on this branch.

**Decisions the brief did not settle**
- "Tested with the current main" is judged as "the tested commit holds main" (`behind_by == 0`), not by the tested merge ref's first parent, which a `workflow_run` payload does not carry; it costs one extra CI run when a PR's branch was behind main but its merge ref was not.
- The schedule runs four times a day (about 120 Actions minutes a month at one billed minute each).
- Dependabot's Actions bumps change `.github/` and so wait for `checks-ok`, as the decision's wording reads.
- `executeCommand()` answers an unregistered command with `internal` (a fault in the code), unaudited.
- The web app keeps one IST copy of its own, since browser code may take no value from the domain; a test holds it to the domain's.

## Review
### 13-10-2026, cloud, slice-reviewer on Opus 5.5 xhigh, head `b1c796a5`
No critical or high finding. Three medium (two in the `checks-ok` rule, one in the screenshots) and ten low. The core of OPS-1 holds: a pull request merges only when its tested commit holds the current `main`.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | medium | **`checks-ok` misses most of the files that define the checks.** `.github/workflows/automerge.yml:77-80` (`checks_path`) matches only `.github/`, the root `turbo.json` and `vitest`/`playwright` config files. **Scenario:** a builder turns a red security suite green by changing the root `package.json` script to `"test:security": "true"` (CI's security job runs `pnpm test:security`). It could equally edit `packages/db/package.json`'s `test` script, add `vitest run --passWithNoTests`, or extend the existing package-level `packages/domain/turbo.json`. The run is green and the pull request merges itself with no label. **Evidence:** the extracted `MERGE_RULE` with jq answers `merge` for a change to each of `package.json`, `packages/db/package.json`, `packages/domain/turbo.json` (the builder's own "nested `turbo.json` not matched" case, though one exists), `eslint.config.mjs` (the ARCH-1 fences), `.gitleaksignore`, `pnpm-workspace.yaml` (audit exceptions, `minimumReleaseAge`, `allowBuilds`), `apps/web/js-budget.json`, `apps/web/lighthouserc.json`, `tools/copy-lint/copy-lint.config.json`, `vitest.workspace.ts` and `packages/db/tests/global-setup.ts`. **Fix (needs the owner, since the 13-10-2026 row names the paths):** match `(^\|/)turbo\.jsonc?$` and the files above by path. For `package.json`, compare `.scripts` at the base and the head through `repos/{repo}/contents/{path}?ref=` with jq, so Dependabot's version bumps still merge on green. | confirmed (rule run with jq); open |
| 2 | medium | **`checks-ok` does not lapse on a later push, and nothing stops the lead from adding it.** `automerge.yml:95-98` reads only whether the label is on. **Scenario:** a slice changes `ci.yml`, and the owner reads it and adds `checks-ok`. A later fix round pushes `if: false` onto the `security` job. CI on the new head is green and the rule answers `merge` (jq: a `.github/` change with the label merges whatever the head is). The 5-ops verdict names this path for OPS-2: "a commit pushed later to turn a red CI green is not reviewed again". The lead runs `gh` as the owner, so it can also add the label itself. No rule says only the owner adds it: `slice-integration.md:59` says only "tell the owner it is waiting". **Fix:** add a small workflow on `pull_request_target: types: [synchronize]`, run from `main`. It checks out nothing, has `pull-requests: write` and runs `gh pr edit <n> --remove-label checks-ok`. The workflow's own `update-branch` commits use `GITHUB_TOKEN` and start no workflow, so taking `main` in keeps the label; a person's push drops it. Add one line to AGENTS §8 and `slice-integration.md` §8: only the owner adds `checks-ok`, the lead never does. | confirmed (rule); open |
| 3 | medium | **The 300-pixel limit and the new cell masks are unproven on any baseline. `home-team-lead` is also likely to vary run to run.** `apps/web/playwright.config.ts:54`, `apps/web/e2e/targets.spec.ts:72-77`. No baseline was compared under the new limit: the builder's local run failed for its database's state. The new masks show the column heads of the leaderboard and queue tables. Their own comment says the counts in the cells "change with what other journeys saved" (`fullyParallel`). Nothing in `packages/ui` or `apps/web` sets `table-layout`, so a two-digit count in place of a one-digit one moves the column widths and the visible head text by a few pixels. Over 300 pixels that fails, where the old 1 % absorbed it. A screenshot that differs on both tries is a plain failure on every pull request, and every pull request then waits. **Fix:** before the pull request, the lead's §7 run must be the full suite, not `--grep` (the limit changes every baseline), in the Linux image on a fresh database, all three projects, `--repeat-each 2`. If `home-team-lead` varies, mask those two figure tables whole again or give them fixed column widths. | plausible; open |
| 4 | low | **A pull request whose update is slow, or whose re-test dispatch fails, is stuck for good, and the message says the opposite.** `automerge.yml:146-157`, `:183-190`. After `update-branch` is accepted, the job waits 60 s for the new head. If GitHub makes the merge commit later, the job ends with "the next look tries again" and starts no CI. The same happens when `gh workflow run` fails once after the update. The new head then has no CI run, and `GITHUB_TOKEN` commits start none. Every later look answers "skip: its latest CI run has not passed" and never dispatches. **Evidence:** the step run with bash against a stand-in `gh`: update, then "did not take main within a minute", exit 1, no dispatch. The next scheduled look at the new head gives "skip: its latest CI run has not passed", with no dispatch. **Fix:** in the schedule and dispatch path, a pull request whose head has no `pull_request` or `workflow_dispatch` CI run gets `gh workflow run ci.yml --ref <branch>`. | confirmed (stand-in run); open |
| 5 | low | **The OPS-17 inputs for `@shakti/domain#test` are dead.** `turbo.json:34`. The package-level `packages/domain/turbo.json` overrides the root `@shakti/domain#test` entry. `turbo run test --filter=@shakti/domain --dry=json` resolves only `$TURBO_DEFAULT$` and `docs/state-machines/**`, with 0 files under `packages/db/tests` or `apps/web/tests`. So after a denied or wrong-company case is deleted in those folders, a local `pnpm test` replays the cached pass of `refusal-coverage.test.ts`. CI has no Turbo cache, so the effect is local only. **Fix:** move the two inputs into `packages/domain/turbo.json` and delete the root entry. | confirmed (dry run); open |
| 6 | low | **The refusal-coverage check counts cases that are not refusals.** `packages/domain/src/command/refusal-coverage.test.ts:37-39` (`OTHER_COMPANY` accepts `(2)`, `, 2)`, `[2]`, `elsewhere`, `config_group_scope` and `catalogue_needs_all_companies`), and `:134-154`, which pulls helpers in two levels deep. **Evidence:** I ran the test's logic over a scratch copy. Deleting "does not reach another company's pipeline" from `crm-pipelines.test.ts` (the case the audit asked for) still passes: the group-scope case and `testPipeline(2)` in happy paths stand in for it. `notifications.notice.read_all` passes with neither case. Its "denied" is an agent's refusal (`notifications.test.ts:667`, titled "…from a company outside" but testing only an agent). Its "wrong company" is an unrelated `entityId: 2` (`apps/web/tests/notifications.test.ts:576`). The check does still catch a deleted task case. **Fix:** drop the weak tokens and require the command to be named in the case's own text or its `.each` table. List group-scope commands in `REVIEWED` with their reason. Give `read_all` a real company case or a `REVIEWED` entry. | confirmed (mutation in scratch); open |
| 7 | low | **The run-time registry check can be bypassed by mutating the registry or a command.** `packages/domain/src/command/registry.ts:257-262`, `define-command.ts:65-69`, `index.ts:18`. `commands` and every command are plain mutable objects, and `commands` is exported to `apps/web`. Linted as `apps/web/src/actions/zz-probe.ts`, all of these pass the fences with no message: `(commands as Record<string, unknown>)[mine.name] = mine` followed by `executeCommand(p, s, mine, …)` (and `isRegistered()` is then true), `(createLead as {handler: unknown}).handler = …`, and `executeQuery(p, s, ({ tx }) => tx.execute('select …'))` (a raw-string read, with no `drizzle-orm` import). It takes a deliberate act, not drift. **Fix:** `Object.freeze` each command in `defineCommand()` and the `commands` object, and fence `commands` out of `apps/web` code that is not a test. | confirmed (lint probe); plausible as a path; open |
| 8 | low | **`failOnFlakyTests` turns known retry-only passes into red pull requests, with no fix in this slice.** `apps/web/playwright.config.ts:40`. `main`'s CI never runs the journeys (`ci.yml:210,301`), so `main` stays green. A flake now fails every pull request it hits, Dependabot's and the re-test runs included: `orders.spec.ts` dealer credit and the orders snapshot load (STATUS follow-ups). The pull request then waits, and each re-run is a full end-to-end job. **Fix:** fix the dealer-credit journey or add a follow-up row, and add one TESTING §6 line: a flaky failure is re-run with `gh run rerun <id> --failed`, which also brings the pull request back to the merge workflow. | plausible; open |
| 9 | low | **Re-test cost and dropped decisions.** The run file counts only the schedule (about 120 minutes a month). Every moved-`main` update starts a full CI run (security suite, three end-to-end jobs and Lighthouse), and N pull requests green at once cost about N²/2 runs. The repository is public now, so these minutes are free; once it is private they count against the 2,000 a month. Job-level concurrency still cancels a pending run when a third arrives, so a decision can wait up to 12 h for the 01:23 UTC look. **Fix:** in `workflow_run` mode, judge every open pull request whose latest run passed, as the schedule does. A dropped run then costs nothing and the schedule can drop to once or twice a day. Write the re-test cost into TESTING §6 or ADR 0017. | plausible; open |
| 10 | low | **Three side effects of `update-branch` are not written down.** (a) GitHub very likely refuses an update with `GITHUB_TOKEN` when `main`'s new commits change `.github/workflows`, since the token cannot hold `workflows`. After every merged `checks-ok` pull request, each behind pull request then gets a red "take main into it by hand" run, again at each scheduled look. (b) Dependabot stops rebasing a pull request once another account has pushed to it. (c) The lead's local branch is now behind `origin`, so the next push of a fix is refused, and force-pushing is never allowed. **Fix:** add these to `slice-integration.md` §8, with "pull with a merge before pushing again", and to TESTING §6. | plausible (GitHub behaviour); open |
| 11 | low | **ARCH-11's second half is smaller than the run file says.** `apps/web/src/app/api/v1/workers/quotes/expire/route.ts` is a verbatim instance of `nightlyWorkerRoute`: same log names (`sales.quote_expiry_*`), answers, `NO_RETRY` and busy branch. Folding it into `nightlyWorkerRoute({ path: QUOTE_EXPIRE_PATH, logPrefix: 'sales.quote_expiry', body: QuoteExpireWorkerBody, budgetMs: QUOTE_EXPIRE_RUN_BUDGET_MS, run: (_, o) => runQuoteExpiry(o) })` changes no behaviour. Only `files/sweep` (no body contract, no busy branch) and `outbox/publish` (verifies without the URL) differ; a shared `signedBody()` prelude would serve them without changing their answers. **Fix:** fold `quotes/expire` here; the prelude for the other two becomes a follow-up row. | confirmed (read); open |
| 12 | low | **Documents.** ADR 0017 lines 16-17 still state the old rule: the journeys run "on pull requests only", and the merge rule has no `checks-ok` and no re-test on a moved `main`. AGENTS §8's merging line is where CLAUDE.md sends readers for "how a pull request merges itself", but it does not say that a pull request merges only on the `main` it was tested with. ARCH-11 left three doc comments stranded. At `packages/domain/src/sales/targets.ts:4` "India has one time zone…" now documents `DAY_MS`; at `state-machines/machines/quote.ts:48` and `telecom/call-schedule.ts:12` it documents nothing. **Fix:** one line in each place. | confirmed (read); open |
| 13 | low | **This pull request will be merged by `main`'s old workflow.** That workflow knows no `checks-ok`, so this slice's own `.github/` changes merge themselves on green without the owner's read. **Fix:** the lead adds `hold` when opening the pull request, the owner reads it, and the lead removes `hold` and runs `gh run rerun <id>`. | confirmed (`origin/main:.github/workflows/automerge.yml`); open |

**Answers to the brief's questions**
- *A merge onto an untested `main`:* not by the workflow.
  - `behind_by == 0` means the tested head holds today's `main`. For a `pull_request` run, which tested the merge ref with some older `main`, the merged tree is then the head's tree; the same holds for a re-test dispatch run on the branch.
  - The only gap is a merge made outside the workflow between the `compare` call and `gh pr merge` (`--match-head-commit` checks only the head). The rules forbid merging by hand.
  - A second pull request from the same branch to another base could lend its run, which the never-stack rule rules out.
- *Changes to the checks without `checks-ok`:*
  - Renames (both paths read), more files than listed (label needed), forks (job `if` and filter) and Dependabot's Actions bumps (label needed) all hold.
  - The gaps are #1 (other files) and #2 (a later push).
- *Token, injection, `pull_request_target`:*
  - `permissions: {}` with three job scopes. No checkout. Every value reaches the shell through `env`, a quoted argument or `jq --arg/--argjson`. The dispatch input is digits only.
  - No `pull_request_target`; one is proposed in #2, without checkout.
  - The `DELETE …/refs/heads/${branch}` path would cut at a `#` in a branch name. That line exists on `main` today, and only same-repository branches reach it.
- *Concurrency, schedule, minutes:* see #9.
- *`ci.yml`:*
  - `--no-renames` and the dispatch comparison with `origin/main` hold. The `What changed` job uses `fetch-depth: 0`, so `origin/main` exists.
  - The journeys and Lighthouse run on `pull_request` and on a dispatch on any branch but `main`, and never on `main`.
- *`migrate.yml`:* sound.
  - Secrets reach only the check, `db:migrate`, `db:verify` and the seed.
  - `--verify` and the seed read only `DATABASE_URL_MIGRATOR` and the CA (`packages/db/src/migrate.ts:128-149`, `seeds/index.ts:33`).
  - `rotate_passwords` is a boolean, so its expression expands to a literal only.
- *Images:*
  - Pinned and equal in `ci.yml` (three), `compose.yaml` and `snap-in-linux.ts`, and held by `ci-images.test.ts`.
  - Both digests equal this VM's `docker image inspect` `RepoDigests`, recorded at pull.
  - `tools/integration/lib.sh` (lines 63 and 68) still extract the references, digest included.
- *Command-layer fences:*
  - The lint probes hold. `executeCommand()` refuses a command that is not the registry's, and the registry test ties every exported command to that same object, so no web path breaks.
  - The way around them is #7.
  - The registry-driven check finds missing cases; its false passes are #6.
  - Its eight `REVIEWED` exceptions are justified: own-person commands with no company in their input, and `profile.write:own` in every person's role.
- *300 pixels and failing on flakes:* `main`'s CI is not affected (no journeys there). Pull requests are: see #3 and #8.
- *ARCH-11's undone half:* fold `quotes/expire` here, and keep the prelude as a follow-up (#11).
- *Documents:*
  - TESTING §5 and §6, the CLAUDE.md and AGENTS §8 lines for `checks-ok`, the PRD trace, ROADMAP, README and ARCHITECTURE match the code, and every file they cite exists.
  - The exceptions are #12.

**Checked and sound**
- The new OPS-6 cases assert each refusal and that the row is unchanged afterwards. The pipelines cases also show the owning company can make the change.
  - Targeted run on 54338: `vitest run --config vitest.security.config.ts` over `tasks`, `crm-pipelines`, `customer-edits`, `consent`, `notifications`, `agents` and `orders`. Result: `Test Files 7 passed (7)`, `Tests 166 passed (166)`.
- Unit tests:
  - `refusal-coverage.test.ts` and `execute.test.ts`: 13 passed.
  - `ci-images.test.ts`, `ist.test.ts` and `lint-fences.test.ts`: 14 passed.
- OPS-17 for `@shakti/db#test` and `web#test` resolves in a Turbo dry run.
- `testPhone()` is sound.
- The IST consolidation keeps behaviour: offset arithmetic equals `Asia/Kolkata`, which has no daylight saving.
- Taking `main` (`git merge-tree` with `origin/main` at `33c03b70`) conflicts only in two places:
  - `apps/web/e2e/targets.spec.ts`: take `main`'s WEB-13 masks (`main td`, `main dd`), which came with new baselines in #170, so this slice's mask change goes.
  - `docs/02-prd.md`: take `main`'s RPT-03 and this slice's RPT-04.
- In the merged tree:
  - The coverage check passes, including `main`'s new `crm.enquiry.take`.
  - No removed IST symbol is still imported.
  - No test draws a random phone number.
  - No `apps/web` file outside `src/auth` imports a fenced name.
- The 13-10-2026 `checks-ok` row is on the lead's branch, not on `main`. It must reach `main` with or before this pull request, since AGENTS §8 and CLAUDE.md link to it.

**Not checked**
- GitHub's own behaviour, which cannot be run from here:
  - `update-branch` with workflow changes (#10).
  - Whether a CI run started by `workflow_dispatch` from `GITHUB_TOKEN` fires `workflow_run`, and whether the three-level chain limit stops a second re-test; the schedule is the fallback either way.
  - That a dispatch run shows on the pull request.
- Screenshots under the new limit (#3).
- The digests at the registry itself.
- No whole security suite, no journeys and no whole-repository lint were run: the lock was shared with another slice's `e2e:snap`.

## Integration notes
