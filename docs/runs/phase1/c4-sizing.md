# C4 Sizing (wave 2)

| | |
|---|---|
| Branch | `feat/c4-sizing-r2` on GitHub (c670631, from `main` at #82) |
| PC worktree | `c4-sizing`, slot 8: Postgres 54338, app 3038; its local branch `feat/c4-sizing` is at the same commit and pushes to `feat/c4-sizing-r2` (`git push origin HEAD:feat/c4-sizing-r2`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026); later the integration list may run in the cloud |
| State | merged (#100, 05-10-2026) |
| Next step | none |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §6.7](../../design/phase1.md#67-c4-sizing) and §11 (workshop defaults)
- BLUEPRINT §8.3 (quote validations) and §3 ("LLMs never do this math")
- PRD SAL-04
- the quote machine's guards `sizingComplete`, `pumpCurveInBounds`, `dcrRuleMet` (`packages/domain/src/state-machines/machines/quote.ts`)
- the workshop pack
- ADR 0007 for the pure-function style
- Skills: `supabase-postgres-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.
- The owner decided on 30-09-2026 that only people record the sizing a quote relies on; agents may only suggest one ([ADR 0021](../../adr/0021-people-record-sizing.md)).

1. **Pure calculators** in `packages/domain/src/sizing/` (no framework imports; SI units inside, inputs in the units field staff use), each tested with fixture tables, boundary cases and property tests (`fast-check`), with two worked examples per calculator in the test comments: `totalDynamicHead`, `pumpPower`, `solarArrayForPump`, `rooftopSize`, `pumpDutyPoint`, `dcrRule`, `sanctionedLoadRule`. Every result carries `inBounds` and `reasons` (codes) so the quote guard can refuse and say why.
2. **Engineering defaults** under `sizing` in `packages/domain/src/workshop-defaults.ts`, each named with its source and flagged for the client's engineering head to confirm; each in the exit-gate actions and design §11. Never presented as client facts.
3. **Table `sizings`**, a child of a lead (`entity_id`, `opportunity_id` with the composite key, `site_id`, `kind` pump or rooftop, `inputs_json`, `result_json`, `in_bounds`, `reasons_json`, `engine_version`, `item_id` for a pump sized against its curve): RLS as a child of `opportunities`, append-only (the latest row is the one a quote uses), indexed for the latest sizing of a lead, fixture rows per company and a matrix rule.
4. **Command `crm.sizing.record`** (`crm.lead.write`): runs the calculators on the inputs (never trusting results from the client), stores inputs, result, bounds and engine version, audits and emits `crm.sizing.recorded`. Query `latestSizing(opportunityId)`.
5. **Sizing panel** (`apps/web/src/components/sizing/`): pump and rooftop tabs, inputs with units, each part of the head, the standard HP, the duty point against a chosen pump's curve, bounds and reasons in plain words; keyboard-first; loaded on first use.
6. **Documents:** DATABASE §6.2, ARCHITECTURE §5, design §6.7 "Built (C4)", `pnpm db:docs`.

## Report
### 05-10-2026, lead session on the PC (integration)
- Second review (the integration work, e014a7f..730a0f2): no critical or high; one medium (the definer's filters unpinned by tests) and five lows, all fixed by the builder (see Review); `main` taken again after P4 (#99), migrations 0092 to 0095.
- `integrate.sh` on a fresh Postgres (54340): every step passed but the journeys, which failed because the worktree's `.env` had no `E2E_BASE_URL` (the app ran on 3000 while its links pointed at 3038); with the line added, the journeys passed (175 passed, 2 flaky). Unit tests 2,695; security suite 1,695 (db 917, domain 559, web 219); `/customers/[accountId]` 194.5 of 205 kB.
- Linux baselines on a fresh database: `customer-sizing` new and `customer-account` remade (the Size this lead button), every image looked at. The verification run without updating found no screenshot difference; two tests timed out under the other agents' load, so CI's Linux journeys are the full check.

### 03-10-2026, builder on the PC
- Built, reviewed and fixed. The review confirmed the formulas and found 2 high (the pump's flow short of the need; the suction lift of a surface pump) and 4 medium; all fixed. Engine version 2; `quoteSizingFacts()` for S1; people-only, voice sessions included; six engineering defaults added for the engineering head (flow tolerance, overshoot, suction lift 7 m, sanctioned-load ratio 1.0, motor margin 0.1, pipe velocity 2 m/s).
- Checks on the branch: security suite 1,343, unit tests 2,394.

### 04-10-2026, builder on the PC (second run)
- Started from dfcb293 after the first builder stopped at the usage limit. `main` was taken at e014a7f (the sizing migrations as 0090 and 0091); `pnpm db:generate` reports no schema changes. The branch's migrations are 0090 to 0093; the lead renumbers them at the merge.
- Integration note 2: done. `packages/contracts/src/commands/crm/sizing.ts` imports C1's `PumpTypeSchema` from `packages/contracts/src/catalogue/specs.ts`; the branch has no copy of its own.
- Integration note 3: done. Each lead in Account 360 has a "Size this lead" button that opens the sizing panel below the lead; the panel loads on first use (`next/dynamic`), and a saved sizing reads the page again. The journey "sizes a lead from Account 360 and sees it in the history" (`apps/web/e2e/customers.spec.ts`) runs as a tele-caller with axe twice. `/customers/[accountId]` measures 194.4 kB of its 205 kB budget; its reason in `apps/web/js-budget.json` now names the sizing panel.
- Integration note 4: done. An out-of-bounds sizing opens a `review` task for the lead's team lead through the definer `app.open_sizing_review()` (0093), audited and on the timeline as `crm.task.create` does. Four tests in `packages/domain/tests/commands/sizing.test.ts` ("crm.sizing.record on the timeline and for review") cover the timeline row, the one open review, a team with no lead, and the definer's refusals (a sizing within limits, someone else's sizing, an agent).
- Integration note 5: done. `ctx.activity()` writes `sizing_recorded` (0092 widens the `activities` type check); the History section shows "Sizing worked out" with the kind and whether it is within limits.
- Documents: DATABASE §4.1 (the definer) and §6.2 (`sizings`, `activities`), design §6.7 "Built (C4)", ARCHITECTURE §5 and SECURITY §3.3 name the timeline row and the review task. `pnpm db:docs` and `machines:docs` leave no change.
- Checks, run one at a time against Postgres on 54338:
  - `pnpm typecheck`: 8 successful, 8 total. `pnpm lint`: no warnings or errors (repeated at the end). `pnpm copy-lint`: catalogues and templates are clean.
  - Unit tests (`turbo run test --force`): 2,679 passed (copy-lint 17, tokens 134, ui 105, contracts 177, db 118, domain 1,540, web 588).
  - `pnpm test:security`: 1,654 passed (db 916 in 29 files, domain 532 in 51 files, web 206 in 12 files); 4 successful, 4 total.
  - `pnpm build`, then `pnpm --filter web js-budget`: every page is within its budget (27 pages).
  - Journeys (on Windows, not the Linux baselines): the sizing journey passed on desktop-light, desktop-dark and phone; `customers.spec.ts` on desktop-dark: 16 passed, 1 flaky ("records consent and adds a task for their own customer", which timed out at 1.1 minutes on the first try while another worktree ran its journeys, and passed on the retry).
- `EXPLAIN (ANALYZE)` of the definer's three lookups on the suite's data (85 sizings, 2,039 leads, 1,119 role rows): the sizing by `sizings_pkey` and its lead by `opportunities_id_entity_unique`, 0.7 ms; the team lead by `user_entity_roles_team_idx`, then `principals_pkey` and `users_pkey`, 3.6 ms; the open review by `tasks_opportunity_idx` (with sequential scans off, as the table holds 36 rows), 0.3 ms.
- Decisions the brief did not settle, taken by the first builder and kept: the review task is due at once; it goes to the active person with the Sales Team Lead role on the lead's team in its company, the longest-serving first when there are two; no task when the lead has no team or the team no lead; one open review of a lead per team lead, so a second out-of-bounds sizing adds none; the task carries no outbox event, as `crm.task.create` sends none.
- Unfinished: the Linux baselines and the integration run, which are the lead's.

### 04-10-2026, builder on the PC (review fixes)
- The six findings of the review of e014a7f..730a0f2 are fixed (Review below); 0093 was edited in place, as it is not on `main`, and the database was made fresh. Sizing file 30 passed (8 cases added); `grants.test.ts` 108 passed; `pnpm typecheck` 8 successful, 8 total; unit tests 2,679 passed (copy-lint 17, tokens 134, ui 105, contracts 177, db 118, domain 1,540, web 588); `pnpm test:security` 1,662 passed (db 916, domain 540, web 206), 4 successful, 4 total; `pnpm lint` clean. The added lock reads the lead by `opportunities_id_entity_unique`, the index the sizing lookup already uses.
- `main` taken again at 775e300 (P4, #99) in e1779a0: the sizing migrations are now 0092 to 0095 (`app.open_sizing_review()` in 0095), DATABASE cites them so, `pnpm db:generate` reports no changes and `pnpm db:docs` was run. On a fresh database: `pnpm typecheck` 8 successful, 8 total; unit tests 2,695 passed (web 604); `pnpm test:security` 1,695 passed (db 917, domain 559, web 219), 4 successful, 4 total; `pnpm lint` and `pnpm copy-lint` clean.

## Review
Every finding is fixed on the branch; what needs C1 and C2 on `main` is in the integration notes.

### Review of e014a7f..730a0f2
| # | Severity | Finding | State |
|---|---|---|---|
| 1 | Medium | No test pins the definer's filters | Fixed (35c4f64, 2b4c4f8): cases for the caller's own sizing with only company 2 in the request, the lead reassigned to someone else, an archived lead, a lead with no team, and a team whose only team lead is suspended; removing each filter from the function in the local database fails its own case and no other. The no-team check is a shortcut: with it removed, the team-lead lookup on a null team finds nobody, so no test can fail on it alone |
| 2 | Low | The agent and system guard test proves nothing | Fixed (35c4f64, 2b4c4f8): out-of-bounds sizings written as the migrator by the seeded sizing agent, a user principal holding `agent:copilot`, a voice session and a user principal acting as `system:workers`, each refused with "a sizing review is opened by people only"; removing the agent leg, the system leg or the principal-kind leg each fails the case |
| 3 | Low | Two sizings recorded at once could open two reviews | Fixed (35c4f64): the function locks the lead (`for update`) after the sizing lookup and before the open-review check |
| 4 | Low | Documents and the task machine | Fixed (35c4f64, b2d3fef, a4f53f0): design §6.7 Built says one open review of a lead per team lead; DATABASE §6.2 `tasks` names `app.open_sizing_review()` as its second insert path (and the data dictionary); `openReview` fires the task machine's `create` before the function, as `crm.task.create` does |
| 5 | Low | The recorder could be asked to review their own sizing | Fixed (35c4f64, b2d3fef): the reviewer is never the recorder; no task when nobody else qualifies, and the next team lead when the longest-serving one recorded it; tested both ways; design §6.7 Built and DATABASE §4.1 say so |
| 6 | Low | No screenshot of the opened sizing panel | Fixed (b2d3fef): `snap(page, 'customer-sizing')` in the sizing journey after the saved message has gone, masking the customer's name, numbers of five or more digits and years; baselines are the lead's (Linux) |

## Integration notes
1. **Take `main`:** the branch's 0065 and 0066 clash with P2's on `main`; renumber after `main`'s last ([slice-integration §5](../../runbooks/slice-integration.md#5-take-main-into-the-slice)).
2. **Drop the branch's `PumpTypeSchema`** (`packages/contracts/src/crm/sizing.ts`) and use C1's in `packages/contracts/src/catalogue/specs.ts`.
3. **The sizing panel in Account 360** (the lead section of `/customers/[accountId]`).
4. **An out-of-bounds sizing creates a `review` task** for the team lead through C2's tasks, with a test.
5. **The timeline row:** `ctx.activity()` with type `sizing_recorded`.
6. Then integrate and make the baselines on the PC.
