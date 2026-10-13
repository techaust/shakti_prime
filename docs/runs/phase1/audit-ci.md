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
- *What changed* run in a scratch git repository: a `packages/x.ts` → `docs/x.ts` rename lists both paths and gives `code=true` (before: `docs/x.ts` only); documents only → `code=false`; a dispatch on a branch compares with `origin/main` the same way; push and dispatch on main → `code=true`.
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
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
