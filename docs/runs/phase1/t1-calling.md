# T1 Cold Caller workspace (wave 3)

| | |
|---|---|
| Branch | `feat/t1-calling` on GitHub, from `main` at cbec38fc (#105) |
| PC worktree | `t1-calling`, slot 15: Postgres 54345, app 3045 (`bash tools/integration/setup-worktree.sh t1-calling feat/t1-calling 54345 3045`) |
| Runs on | Cloud from 05-10-2026 (the owner's decision to go hybrid): the builder continues from the pushed branch per its handover section; review in the cloud; merge with `main`, integration and baselines on the PC |
| State | building |
| Next step | a cloud builder continues from the handover in the Report (spike, in-hours journey, whole-suite checks), then the review |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.2](../../design/phase1.md#72-t1-cold-caller-workspace), §3 (T1 needs P1, C2 and C3; D1 owns `crm.lead.create`, `crm.opportunity.stage.move` and the board in wave 3), §4 (`calls.log`), §11 (workshop defaults) and §12
- PRD TEL-01 (Phase 1: manual call logging and the number shown to dial; click-to-dial is Phase 2), CRM-06 (the score), CRM-10 (consent)
- BLUEPRINT §8.1 and §8.2; SECURITY §3.2 (`calls.log`, `calls.dial`), the telecom section (TRAI hours 9 AM to 9 PM, DND, consent) and §11; ADR 0014 (Hinglish only in caller scripts)
- DESIGN.md §6 and §11; workshop pack CALL-1 to CALL-5
- C2's Account 360, tasks and consent; C3's call outcomes (`call_dispositions` with `next_action`), pipelines and stages with exit rules, scores and the first-contact SLA; `packages/domain/src/telecom/dial-policy.ts` (`withinCallingHours`, `nextCallingWindowStart`, `checkDial`)
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Table `calls`:** `entity_id`, `opportunity_id`, `caller_id`, `direction`, `number_series` (`manual` beside `140`, `160` and `inbound`; every Phase 1 call is `manual`, dialled by hand on a phone outside the system), `disposition_id`, `attempt_no`, `started_at`, `duration_s`. Append-only. RLS as the leads' scope (own, team, entity), fixture rows, matrix rules, `app_reader`, the testing lists, `NARROWER` and `enum-sync` where they apply.
2. **`calls.log`** (people only; the matrix in design §4): records the call, its timeline activity and its next action from the outcome's `next_action`:
   - a callback: a task at the time the caller picks, inside calling hours;
   - a retry, by the owner's default of 05-10-2026 (CALL-3, `WORKSHOP_DEFAULTS.calling`): three attempts in all, on the day of the first call, the next day and day 3, each due at the start of that day's calling hours (`nextCallingWindowStart`); after the third unanswered attempt the lead moves to nurture;
   - nurture, by the owner's default of 05-10-2026 (CALL-5): call tasks on day 7, 30 and 90 after the lead enters nurture, then none (WhatsApp follow-up is Phase 2);
   - qualified: the stage move that asks for the handover (through the existing stage-move command and its exit rules; the handover itself is T2's);
   - lost, with its reason.
   - A customer who withdrew consent is marked in the queue and cannot be logged as called; a log outside calling hours is refused with a plain reason.
   - The defaults go in `packages/domain/src/workshop-defaults.ts`, the workshop pack's CALL-3 and CALL-5 "Today" lines, design §11 and the exit-gate actions, each named as a default the sales head confirms.
3. **Queue `listCallQueue`:** the caller's open leads in their pipeline's first stages, ordered by due callbacks, then SLA breach, then score, then age; keyset paging; `EXPLAIN (ANALYZE)` under RLS at a realistic size (a spike like the others, numbers in the report).
4. **`/calling`:** keyboard-first: `N` next lead, `1` to `9` the outcomes, `D` shows the number to dial (only inside calling hours; the policy's plain sentence otherwise), `/` search.
   - The script card for the lead's segment and the customer's language. There are no scripts yet (CALL-2, the client's): the card says so in plain words and shows no sample, placeholder or made-up script.
   - The stage's exit-rule checklist and the lead's recent activity.
   - A team lead's view of the team's queues.
   - Journeys with axe, copy in `en.json` (English on screen), the JavaScript budget with a named budget for `/calling`.
5. **Documents:** DATABASE (`calls`), SECURITY (`calls.log`), API if a route is added, design §7.2 "Built (T1)", DECISIONS rows for the two defaults (owner, 05-10-2026), `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a journey has a tele-caller work the queue by keyboard, log an unanswered call (its retry task appears), a callback, and a qualified lead (it moves stage), and a team lead see the team's queues.

## Report
### 05-10-2026, builder on the PC (handover to the cloud)
The slice is built end to end and its suites pass where they were run. Still to do: the spike's numbers and its document, one in-hours journey run, the whole-suite checks and this report's final form. Everything is committed on `feat/t1-calling`; nothing is pushed from the PC.

**Done (files):**
- Contracts: `calls.log` in `PERMISSION_KEYS` and `PERMISSION_SCOPES`; `call_logged` in `ActivityTypeSchema`; `not_reachable` in `OpportunityNurtureReasonSchema` (the reason the retry rule parks a lead with); `packages/contracts/src/commands/crm/calls.ts` (`CallDirectionSchema`, `CallNumberSeriesSchema`, `LogCallInput`, `CallDto`, `LogCallResultDto`, the queue, lead, dial-number, search and team-view DTOs); the four lead events name `calls.call.log` in `emittedBy`.
- Database: `packages/db/src/schema/calls.ts`; migrations `0107_calls.sql` (table, indexes, the `activities` type check with `call_logged`, hand-edited to name the column alone as 0094 does) and `0108_calls_rls.sql` (append-only trigger; RLS forced; read with the lead for `app_user` and `app_reader`; insert by a user principal whose `calls.log` scope covers the lead, with a live outcome of the group or the lead's company); `calls` in `ENTITY_TABLES`, the matrix fixture (id byte 0x30) and its rule, `NARROWER` and `enum-sync`; the CRM fixture cleans calls; seeds for `calls.log` (Executive all, GM entity, team lead team, both callers and the Store Manager own) and its SECURITY §3.2 row; `packages/db/tests/security/calls.test.ts`.
- Domain:
  - `WORKSHOP_DEFAULTS.calling` (`attemptDays: [0, 1, 2]`, `nurtureCallDays: [7, 30, 90]`, the owner's defaults).
  - `src/telecom/call-schedule.ts` (`istDayStart`, `callingStartOnDay`, `afterUnanswered`, `nurtureCallTimes`) with unit tests.
  - The command `calls.call.log` (permission `calls.log`, people only) in `src/commands/calls/log-call.ts`, registered.
  - `src/commands/crm/call-tasks.ts` (`createCallTask`, `scheduleNurtureCalls`). `crm.opportunity.nurture` now sets the day 7, 30 and 90 nurture tasks: the machine's effect text is updated, `machines:docs` regenerated, and `opportunity.test.ts` and `timeline.test.ts` updated for the three task rows.
  - `src/queries/calls/consent.ts` and `src/queries/calls/call-queue.ts` (`listCallQueue`, `callQueuePageSql`, `loadCallLead`, `dialNumber`, `listTeamQueues`).
  - `listTimeline` names a call's outcome (`outcomeName`); `opportunityRecord` takes any context with `tx`; the machine exports `exitFieldFilled`; `teamIn` is exported.
  - Tests: `tests/commands/calls.test.ts` (20), `tests/queries/call-queue.test.ts` (11), the agent refusal input, and reader parity for the four queries.
- Web: `src/actions/calling.ts`; the Calling menu item (`calls.log` own) and its home hint; `/calling` in `BOS_PREFIXES` and `calling` in `CLIENT_NAMESPACES`; `app/(bos)/calling/page.tsx` and `loading.tsx`; `components/calling/calling-screen.tsx`, `outcome-dialog.tsx` and `team-queues.tsx`; `components/customers/timeline-row.tsx` (moved out of Account 360, with the call detail); `src/screens/calling.ts` with `calling.test.ts`; the `calling` catalogue, the error sentences, the audit labels (`callLog`, `outcome`, `attemptNo`, `durationSeconds`) and the copy-lint button keys; the named budget for `/calling` (206 kB, measured 196.6 kB); `e2e/calling.spec.ts`; the journey seed puts the tele-caller and the team lead in one team of company 1.
- Documents: DATABASE (`calls`, `call_logged`), SECURITY (the §3.2 row and lines in §3.3 and §7), design §7.2 "Built (T1)" and §11, DECISIONS (two rows), workshop pack CALL-3 and CALL-5 "Today", exit-gate action 16; `pnpm db:docs` and `machines:docs` regenerated.

**Half done:**
- The spike `packages/domain/tests/spike/calling.ts` (`pnpm spike:calling`) is written and typechecks but has not run, because the database was stopped. Missing: its run, `docs/spikes/results/calling.json`, and `docs/spikes/calling.md` with the numbers and the `EXPLAIN (ANALYZE)` plans. The design's "Built (T1)" already links `docs/spikes/calling.md`, so the document link check reports it missing until it exists.
- The journey's in-hours path has not passed yet: the journey ran only outside calling hours (16:04 UTC), where it checks the refusals instead. A local run with the hours forced open, never committed, found a bug: opening a lead sent the whole queue row to the strict input. A later commit fixes it, and no journey has run since.

**Checks last run (all on the PC, Postgres 54345):**
- `db` security suite: `calls.test.ts`, `enum-sync`, `grants` and `role-entity-matrix`: 4 files, 231 passed.
- `domain` security suite:
  - `tests/commands/calls.test.ts`: 20 passed.
  - `tests/queries/call-queue.test.ts`: 11 passed.
  - `agent-refusals`, `opportunity`, `lead-flows`, `tasks` and `timeline`: 94 passed, then 27 for the last two files after their update.
- Unit tests:
  - `@shakti/contracts`: 177 passed.
  - `@shakti/db`: 122 passed.
  - `@shakti/domain`: 1,600 passed.
  - Web `audit`, `calling` and `contract-values`: 29 passed. The whole web unit suite was 635 passed before the last three fixes, which were then run alone.
- `pnpm --filter web typecheck` and `pnpm --filter @shakti/domain typecheck` are clean; eslint over every touched file is clean; `pnpm copy-lint` is clean.
- `pnpm build` passed; `pnpm --filter web js-budget`: every page within budget, `/calling` 196.6 kB.
- `e2e/calling.spec.ts`, desktop-light, outside calling hours: 12 passed, setup included.
- Not run:
  - the whole security suite (`pnpm test:security`, which also runs `reader-parity.test.ts` with the new queries);
  - a full `pnpm lint` and `pnpm typecheck`;
  - the phone and dark journeys;
  - the spike.

**Next steps, in order:**
1. `pnpm install`, then `pnpm test:security` (it migrates and seeds). Fix anything it finds, starting with `reader-parity.test.ts`.
2. `pnpm spike:calling` (defaults: 10 callers with 2,000 leads each). Write `docs/spikes/calling.md` from `docs/spikes/results/calling.json` as `docs/spikes/account360.md` is written, with both plans. `python3 tools/integration/check-doc-links.py` must then report nothing missing.
3. `pnpm build`, `pnpm --filter web e2e:seed`, then `pnpm --filter web exec playwright test e2e/calling.spec.ts` on desktop-light, desktop-dark and phone. Run it inside calling hours (03:35 to 15:20 UTC) so the keyboard path runs: the unanswered call and its retry task, the callback, the qualified lead and `N`.
4. `pnpm --filter web js-budget`, a full `pnpm lint`, `pnpm typecheck`, the unit tests and `pnpm copy-lint`. If a turbo run writes an "agent rules" block into AGENTS.md, restore AGENTS.md from `main`.
5. Replace this section with the final report (the EXPLAIN evidence from step 2, the test counts, the decisions below). Set State to built and Next step to the review, commit and push the branch.

**Decisions the brief did not settle:**
- The command is `calls.call.log` under the permission `calls.log`, because the registry requires `module.resource.action` names.
- Retries are `callback` tasks; no new task kind was added.
- Callbacks, retries and nurture calls are for the lead's owner. When the caller may not set a task for the owner, the task is the caller's own.
- A retry whose day has already passed moves to 9 AM the next day, so the rule never has a lead called twice in one day.
- A lead parked after its third unanswered try gets the new nurture reason `not_reachable` ("Could not reach the customer"). The board's nurture dialog now offers it too.
- `crm.opportunity.nurture` sets the nurture calls itself, so a lead parked from the board gets them as well.
- The queue also holds nurtured leads whose nurture call is due:
  - a callback or qualified outcome on one reopens it;
  - a retry or nurture outcome keeps it parked, with its later calls.
- A lead with a later call set (callback, retry or nurture) stays out of the queue until that call falls due.
- "First stages" are the open stages positioned before the pipeline's Qualified stage.
- Consent counts as withdrawn when a contact of the customer has a withdrawn `call` consent, of either purpose, and has given no `call` consent since.
- "A log outside calling hours" is judged at the moment the call is saved.
- A qualified outcome whose stage exit rules are unmet is refused whole (the stage move's `stage_fields_missing`), so the call is not saved. The workspace shows the checklist beforehand.
- An outcome key saves the call at once when the outcome needs nothing more. A callback, a lost lead or a parked lead first asks in a dialog.
- The number to dial is a read (`dialNumber`) gated by `calls.log`, not `calls.dial` (click-to-dial, Phase 2), and it writes no audit row.
- Outside calling hours the journey checks the refusals instead of the keyboard path, because the server's clock decides.

## Review

## Integration notes
