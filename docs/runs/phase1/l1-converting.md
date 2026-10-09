# L1 Lead Converter workspace (wave 5)

| | |
|---|---|
| Branch | `feat/l1-converting`, from `main` at 2e4ad05a (#144) |
| PC worktree | cloud day: `/home/user/shakti-wt/l1-converting`, slot 2: Postgres 54332 (container `shakti-pg-l1-converting`), app 3032 |
| Runs on | cloud, beside A1 and the journey fixes (owner, 09-10-2026: all pending Phase 1 work at once), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | C (a screen composed from existing commands): build Sonnet 5.5 high, review Opus 5.5 medium |
| Usage | not readable in the cloud session; the owner ran the day past the budget gate by instruction |
| State | built, for review |
| Next step | review, then integration (Linux baselines for `converting-board` and `converting-quote`) |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §9](../../03-roadmap-appendix/phase1.md#9-wave-5) (L1), §3 (L1 needs T2, S2, C4), §11 (workshop defaults: no converter capacity cap) and §12 (tests per slice).
- PRD TEL-03 ("Board, sizing, quote builder and next-best-action"; WhatsApp thread and Co-pilot are Phase 2) and its trace row; BLUEPRINT §8 (the Lead Converter's workspace) and the cost rule in `CLAUDE.md` (no supplier rates, item costs or margins on this screen).
- What exists and is reused, never forked: T1's Cold Caller workspace `/calling` (its keyboard model: `/` to search, J and K, focus returning to the workspace; `apps/web/src/app/(bos)/calling`), T2's handover and `/converters`, C3's pipelines and the leads board (`/leads`), C4's sizing (`packages/domain/src/sizing`, its screens and commands), S1's quote builder (`/quotes/new`) and quote expiry, S2's orders and credit holds, the call logging and callbacks of T1, N1's notices, the testing lists.
- Skills: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`; `add-command` only if a new command is unavoidable (state why in the report).

1. **Route** `/converting` (menu item "Converting", shown to the Lead Converter role and to those who supervise it, through `screenAccess()` with the permissions the board, sizing and quotes already use; `nav.ts` append-only).
2. **The converter's board:** the leads assigned to the signed-in converter (handed over by T2 or assigned), grouped by their pipeline stage, read through `executeQuery()` with existing queries where they exist; a new query only where none fits, with `EXPLAIN (ANALYZE)` under RLS in the report.
3. **One lead on the same screen:** the lead's summary, its calls and callbacks (log a call and set a callback through T1's commands), its sizing (open or make a sizing through C4's commands and components), and the quote builder (S1's, embedded or opened in place, the same command) — the converter never leaves `/converting` to do these.
4. **Next-best-action list, rules only** (a pure, unit-tested function in `packages/domain`, no model): callback due or overdue; a quote about to expire (S1's validity; use the existing expiry rule, not a new number); sizing missing on a lead in a stage that needs a quote; an order held (S2's credit hold) or blocked; each row opens the lead at the right panel. Name any threshold in `workshop-defaults.ts` only if one is truly new.
5. **Keyboard-first:** the same model as `/calling` (`/` search, J and K to move, Enter to open, keys for log call, callback, sizing, quote shown in a help panel), focus kept visible, every action reachable without a mouse; buttons placed per design system §6 (the alignment lint and `expectAligned`).
6. **Tests:** the next-best-action function (every rule, ties and ordering); any new query on Postgres with the role × company matrix if it reads a new path; the journey `apps/web/e2e/converting.spec.ts`: a converter opens a handed-over lead, logs a call, makes a sizing, builds a quote from the workspace and sees the next-best-action list change, with axe, `expectAligned`, and snapshots in light, dark and 400 px (seed its own figures so the picture does not depend on other journeys).
7. **Documents:** design §9 "Built (L1)", the PRD trace for TEL-03 (tests column), `docs/08-design-system.md` only if a new pattern appears; `pnpm db:docs` only if the schema changes.

Done when: the checks of AGENTS §10 pass on the branch; the journey above passes twice in a row on the same database; `js-budget` holds for `/converting`.

Not in L1: WhatsApp thread and Co-pilot (Phase 2), converter capacity caps, any new price, tax or credit logic, costs or margins. A1 (Triage in shadow) is built at the same time on `feat/a1-triage`: do not edit `packages/domain/src/ai`, the agent tables or `/inbox`. A third builder fixes the journeys on `claude/vibrant-cori-5kst85` (`apps/web/e2e/support`, `calling.spec.ts`, `customers.spec.ts`, `targets.spec.ts`, `notifications.spec.ts`): do not edit those files. Shared lists (`testing/index.ts`, the matrix fixture, `nav.ts`, `en.json`, the registry, the event catalogue, `copy-lint.config.json`) are append-only. Matrix fixture offsets, if needed: `per(e, 0x50)` to `0x57`.

**Migrations:** none expected; if one is needed, start at 0128 (A1 also starts at 0128; the lead renumbers at the merge).

**How to work:** commit at least every 20 minutes and at each finished layer; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; any background wait has a time limit and is stopped before you report; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh`. Never open a pull request, install a dependency or touch a hosted service. If a tool you need is missing, stop and report.

## Report

### 09-10-2026, cloud (builder, Sonnet 5.5)

**Skills loaded:** `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines` (the last two fetch their rules from GitHub, which this VM cannot reach, so they were applied from knowledge of the guidelines, not run as a review). `add-command` was not needed: no command is new, so there is no contract, registry entry, audit label or agent-refusal input to add.

**Built (no table, command or migration):**
- Contract `packages/contracts/src/dto/converting.ts` (the board, a lead's facts, the next-action row).
- Pure rules `packages/domain/src/crm/next-best-action.ts` (`nextBestActions()`, `rulesMet()`), reusing `QUOTE_EXPIRY_NOTICE_MS` (the notice's one day) for "about to expire"; `workshop-defaults.ts` is untouched.
- Query `packages/domain/src/queries/crm/converting-board.ts` (`loadConvertingBoard`; `stageMovesOf` and `sizesOf` of the leads board are now exported and reused), action `apps/web/src/actions/converting.ts`.
- Screen: `apps/web/src/app/(bos)/converting/{page,loading}.tsx`, `apps/web/src/components/converting/*` (`converting-screen`, `lead-board`, `lead-workspace`, `quote-panel`, `keys-help`, `use-call-logging`), `apps/web/src/screens/converting.ts`, the menu item (`nav.ts`, `session-gate.ts`, `client-namespaces.ts`), the copy (`converting` namespace, `nav.converting`, `home.hint.converting` in `en.json`).
- Reuse, no fork: the parts `/calling` and `/converting` share moved to `components/calling/calling-parts.tsx` (`Panel`, `Key`, `DialNumber`, `Outcomes`, `Search`, `savedMessage`) and `calling-screen.tsx` imports them; the outcome dialog, `calls.log` (`logCall`), `loadCallLead`, the sizing panel (new optional `initialKind` prop) and the quote builder (new optional `onCreated` prop, so a quote made stays on the screen; the default still opens the quote page).
- Journey `apps/web/e2e/converting.spec.ts`, fixtures `apps/web/e2e/converting-fixtures.ts` and the seed `apps/web/e2e/setup/converting.ts` (called from `seed.ts`, three lines).
- Documents: `phase1.md` §9 "Built (L1)", the TEL-03 trace row of the PRD, the spike line of `docs/09-testing.md`.
- `apps/web/js-budget.json`: `/converting` entry (203.1 kB gzip measured, budget 213) and `/leads` raised from 240 to 243 (it measured 240.2 kB; it was close to the edge already and the new menu item is in the shell of every page).

**Tests added:**
- `packages/domain/src/crm/next-best-action.test.ts`: 15 (every rule, the window's edges, lapsed and settled quotes, stale sizing, dealer line, ordering, ties, the list changing with the facts).
- `packages/domain/tests/queries/converting-board.test.ts`: 7 on Postgres (refusals, own scope, every fact, the list's order, the lapse by time, a team lead's reach, another team and another company); `reader-parity.test.ts` now covers `loadConvertingBoard` on both pools for every kind of caller.
- `apps/web/src/screens/converting.test.ts` (keys, columns, movement, panels, sizing kind) and `apps/web/src/components/converting/converting.test.tsx` (static renders of the list, the board and the key help): 16 together.
- Journey `converting.spec.ts`: 3 tests a project, 9 in all (the converter works a lead from the keyboard; a tele-caller who makes no quotes has no screen; a team lead opens a person's leads), each with axe and `expectAligned`, two snapshots (`converting-board`, `converting-quote`; light, dark and the 400 px phone project).

**Checks run (all through the lock):**
- `pnpm test:security` (turbo, against my database on 54332): db 40 files, 1192 tests; domain 70 files, 912 tests; web 21 files, 300 tests; all passed (run before the last two small edits, which touched only the journey spec and a document).
- Web unit suite `vitest run src`: 98 files, 731 passed, 1 skipped (before the component test was added); the converting tests alone: 2 files, 16 passed.
- `pnpm lint` (whole repository, last): exit 0, no warnings. `pnpm typecheck` (turbo, 8 packages): exit 0. `pnpm copy-lint`: clean. `pnpm exec prettier --check` on every file this branch touches: clean. Document links: `bad 0`. `pnpm build` (turbo): exit 0. `pnpm --filter web js-budget`: exit 0, every page within budget (`/converting` 203.1 kB).
- Journey, two runs in a row on one database (seed, run, seed, run; the first run only writes the missing baselines, as Playwright does): the second run, `converting.spec.ts`, 18 passed (9 sign-ins and 9 tests), exit 0. The baselines made on this VM were deleted, not committed: the lead makes the Linux ones.
- The calling-hours branch (D shows the number, C opens the callback dialog, Enter saves it, the due row leaves the list) cannot run at the VM's hour (01:43 to 04:00 IST during the journey runs): the journey takes the other branch there, as `calling.spec.ts` does, and checks the refusal sentence. To prove the in-hours branch I ran a copy of the spec with `inCallingHours()` forced true against a server whose clock was moved nine hours on by a preload (`Date` patched in the server process only, a scratch file outside the repository): 9 of 9 passed. Whoever runs the journey in CI between 09:05 and 20:50 IST gets that branch for real.

**`EXPLAIN (ANALYZE)` evidence** (`pnpm --filter @shakti/domain spike:converting`, `packages/domain/tests/spike/converting-explain.ts`: 20,000 leads in company 2, 150 the Lead Converter's, each with a callback, a sizing and a quote, 1 in 10 with a held order; run under the policies, as the Lead Converter, the team lead and the Executive):
- the board's lead query: `opportunities_entity_owner_idx` (150 rows), then the customer by primary key, the pipeline and the stage: 4.0 ms as the Lead Converter (planning 16 ms the first time), 2.3 ms as the team lead, 2.0 ms as the Executive;
- the owner's callbacks of the 150 leads: 0.9 ms (`tasks_assignee_state_due_idx`, `tasks_opportunity_idx`);
- the newest quote of each lead: 6.5 ms (`quotes_opportunity_idx`; the policy reads the lead's row for each, 5.9 ms of it a scan of `opportunities` for the 150 ids);
- the leads with a sizing: 4.4 ms (`sizings_opportunity_kind_latest_idx`); held orders: 0.5 ms;
- the whole board in the app (`loadConvertingBoard`, 150 leads): 102 ms against the 300 ms the PRD allows.

**Decisions the brief did not settle:**
1. **Who sees the menu item:** `crm.lead.read`, `calls.log` and `sales.quote.create` at own scope: the Lead Converter, the Store Manager, a Sales Team Lead, a General Manager and an Executive. A Cold Caller (no `sales.quote.create`) does not; the journey checks it.
2. **The board holds open leads only**, newest change first, at most 200 (`CONVERTING_BOARD_LIMIT`; a note says when there are more). Nurtured leads stay on `/calling`, where their follow-up calls are. Columns are by the stage's key (the same stage of each pipeline is one column), earliest first.
3. **Rules and their order:** callback due, quote about to expire, order held, sizing missing, in that order (a customer waiting for a call, a quote about to lapse, money held, then housekeeping); within a rule the earliest time first. "Blocked" order is the credit hold, the only way an order is blocked in Phase 1 (`credit_held_at` on a draft order); a lapsed quote is expired, not about to expire. A lead can have more than one row. "A stage that needs a quote" is Qualified or any open stage after it; a dealer line is not sized, so it never asks for a sizing; a sizing from an earlier engine counts as missing.
4. **A team lead** (`calls.log` at team scope or wider) can open a person of the team's board at `?owner=<id>&company=<id>`, from a My team list (the calling screen's pattern); RLS decides which leads show.
5. **Callback** is set through the call outcome that sets one (`calls.log`, key `C`), not through a task command; a pipeline with no such outcome has no `C`.
6. **Keys:** `/`, `J`, `K`, Enter, `N` (first row), `L`, `C`, `D`, `S`, `Q`, `1` to `9`, `?`; `J`/`K` move the browser's own focus from card to card, Enter is the button's own press.
7. **The journey works in Shakti Motor Pumps (company 2)** with a converter of its own per project (three people with one name, no team, not a handover target), not Kishan Verma of company 1: other journeys hand leads to Kishan every run, which would change the board and its picture; and a quote made in company 1 numbers the quote series the security suite's fixture (`catalogue-fixture.ts`) creates for company 1, so the security suite fails on a database a journey has used. The seed keeps its own tier, item (`CNV-MOD-540`) and price list, test values said so in the tier's name.
8. The leads the seed makes are put at Qualified by a direct update (the stage command would ask for a handover that takes them from their owner).

**Not done / uncertain:**
- Linux baselines for `converting-board` and `converting-quote` (the lead makes them in the image). The pictures mask the activity region and every `time`; the snapshots are taken before the call step so they do not depend on the hour.
- `web-design-guidelines` and `writing-guidelines` could not fetch their rules (no route to GitHub); the screen follows `docs/08-design-system.md` and the copy rules, and the journey's axe check passes in the three projects.
- Pre-existing, seen here: `pnpm build` and `turbo run ...` fail in this VM with "Exec format error" when started as `pnpm build`/`pnpm test:security` (pnpm 12.6.0's placeholder binary has no shebang and turbo cannot spawn it); I ran turbo as `env PATH=/opt/node22/bin:$PATH node_modules/.bin/turbo run ...`. The lead's `integrate.sh` steps use `pnpm exec turbo`, which will meet the same.
- A database the journeys have used fails the security suite once a journey numbers a quote in company 1 (the suite's own fixture creates that series); this slice keeps its quotes in company 2, as `quotes.spec.ts` does. I removed the company 1 quotes my first journey runs made from my own database before the suite ran.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
