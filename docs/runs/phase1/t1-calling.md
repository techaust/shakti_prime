# T1 Cold Caller workspace (wave 3)

| | |
|---|---|
| Branch | `feat/t1-calling` on GitHub, from `main` at cbec38fc (#105) |
| PC worktree | `t1-calling`, slot 15: Postgres 54345, app 3045 (`bash tools/integration/setup-worktree.sh t1-calling feat/t1-calling 54345 3045`) |
| Runs on | Cloud from 05-10-2026 (the owner's decision to go hybrid): the builder continues from the pushed branch per its handover section; review in the cloud; merge with `main`, integration and baselines on the PC |
| State | built |
| Next step | the review (slice-reviewer, in the cloud), then the merge with `main`, integration and baselines on the PC |

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
### 06-10-2026, builder on the PC and in the cloud (final)
The slice is built and every check of AGENTS §10 that runs in the cloud passes. The calling journey passes inside calling hours on desktop-light, desktop-dark and phone, except its three screenshots, whose baselines are the PC's to make. The PC builder built the slice up to 05-10-2026 and handed over; a cloud builder ran the spike, the whole-suite checks and the in-hours journey, and fixed what they found.

**Built (files):**
- Contracts: `calls.log` in `PERMISSION_KEYS` and `PERMISSION_SCOPES`; `call_logged` in `ActivityTypeSchema`; `not_reachable` in `OpportunityNurtureReasonSchema` (the reason the retry rule parks a lead with); `packages/contracts/src/commands/crm/calls.ts` (`CallDirectionSchema`, `CallNumberSeriesSchema`, `LogCallInput`, `CallDto`, `LogCallResultDto`, the queue, lead, dial-number, search and team-view DTOs); the four lead events name `calls.call.log` in `emittedBy`.
- Database: `packages/db/src/schema/calls.ts`; migrations `0107_calls.sql` (table, indexes, the `activities` type check with `call_logged`, hand-edited to name the column alone as 0094 does) and `0108_calls_rls.sql` (append-only trigger; RLS forced; read with the lead for `app_user` and `app_reader`; insert by a user principal whose `calls.log` scope covers the lead, with a live outcome of the group or the lead's company); `calls` in `ENTITY_TABLES`, the matrix fixture (id byte 0x30) and its rule, `NARROWER` and `enum-sync`; the CRM fixture cleans calls; seeds for `calls.log` (Executive all, GM entity, team lead team, both callers and the Store Manager own) and its SECURITY §3.2 row; `packages/db/tests/security/calls.test.ts`.
- Domain:
  - `WORKSHOP_DEFAULTS.calling` (`attemptDays: [0, 1, 2]`, `nurtureCallDays: [7, 30, 90]`, the owner's defaults).
  - `src/telecom/call-schedule.ts` (`istDayStart`, `callingStartOnDay`, `afterUnanswered`, `nurtureCallTimes`) with unit tests.
  - The command `calls.call.log` (permission `calls.log`, people only) in `src/commands/calls/log-call.ts`, registered.
  - `src/commands/crm/call-tasks.ts` (`createCallTask`, `scheduleNurtureCalls`). `crm.opportunity.nurture` now sets the day 7, 30 and 90 nurture tasks: the machine's effect text is updated, `machines:docs` regenerated, and `opportunity.test.ts` and `timeline.test.ts` updated for the three task rows.
  - `src/queries/calls/consent.ts` and `src/queries/calls/call-queue.ts` (`listCallQueue`, `callQueuePageSql`, `loadCallLead`, `dialNumber`, `listTeamQueues`, `teamQueueCountsSql`). In `rankedQueue`, which the queue and the team view share, each lead's next call is a lateral aggregate and the Qualified stage a join; the spike showed why.
  - `listTimeline` names a call's outcome (`outcomeName`); `opportunityRecord` takes any context with `tx`; the machine exports `exitFieldFilled`; `teamIn` is exported.
  - Tests: `tests/commands/calls.test.ts` (20), `tests/queries/call-queue.test.ts` (11), the agent refusal input, and reader parity for the four queries.
  - The spike `tests/spike/calling.ts` (`pnpm spike:calling`), with the plans of the queue page and the team view's counts.
- Web: `src/actions/calling.ts`; the Calling menu item (`calls.log` own) and its home hint; `/calling` in `BOS_PREFIXES` and `calling` in `CLIENT_NAMESPACES`; `app/(bos)/calling/page.tsx` and `loading.tsx`; `components/calling/calling-screen.tsx`, `outcome-dialog.tsx` and `team-queues.tsx`; `components/customers/timeline-row.tsx` (moved out of Account 360, with the call detail); `src/screens/calling.ts` with `calling.test.ts`; the `calling` catalogue, the error sentences, the audit labels (`callLog`, `outcome`, `attemptNo`, `durationSeconds`) and the copy-lint button keys; the named budget for `/calling` (206 kB); `e2e/calling.spec.ts`; the journey seed puts the tele-caller and the team lead in one team of company 1.
- Documents: DATABASE (`calls`, `call_logged`), SECURITY (the §3.2 row and lines in §3.3 and §7), design §7.2 "Built (T1)" and §11, DECISIONS (two rows), workshop pack CALL-3 and CALL-5 "Today", exit-gate action 16; `docs/spikes/calling.md`, `docs/spikes/results/calling.json` and its line in `docs/spikes/README.md`; `pnpm db:docs` and `machines:docs` regenerated.

**Found and fixed in the cloud:**
- The spike found the team view over 300 ms at the 95th percentile: 315.8 ms for the team lead and 324.9 ms for the General Manager.
  - The planner copied each lead's next-call subquery into every place the bucket and the counts read it, about six `tasks` probes a lead. It looked up the Qualified stage once per lead.
  - The next call is now a lateral aggregate, run once per lead. The Qualified stage is a join, one per pipeline by `pipeline_stages_pipeline_key_unique`. The rule and its results are unchanged.
- The desktop-dark journey failed axe on the selected queue row: `--text-muted` on `--accent-soft` is 4.19:1 in the dark theme. The row's score, village and tries take `text-text`, which the tokens hold at AA on `--accent-soft`.
- The in-hours journey found three faults:
  - `N` on the queue's last lead did nothing. After a qualified call, `N` stayed on the lead while the queue still held it as its last row. `N` now goes back to the first lead (`nextLead`, its unit test changed).
  - `/` kept the last search in the field, so a second search added to it. `/` now selects it.
  - The journey pressed `/` before the page had hydrated on its second visit. `findLead` presses it again until the search takes the keyboard.
- Prettier on 13 of the slice's files: CI's `pnpm format:check` would have failed.

**The spike** (`pnpm spike:calling` at its defaults, through `app_reader`, run of 06-10-2026 00:14 IST on the cloud VM, 4 cores and 16 GB, nothing else running; [docs/spikes/calling.md](../../spikes/calling.md)):
- **Seed:** 10 callers with 2,000 leads each; the first caller has 866 calls and 966 tasks; company 1 has 20,353 leads.
- **Times, p50 / p95 ms**; every case is under 300 ms at the 95th percentile:

| Caller | Queue | Queue page 2 | Lead | Team view |
|---|---|---|---|---|
| Tele-caller | 48.7 / 56.5 | 51.8 / 62.9 | 38.5 / 48.2 | |
| Team lead | 52.9 / 64.8 | 49.6 / 57.4 | 37.4 / 44.5 | 117.1 / 127.2 (10 callers) |
| General Manager | 45.5 / 51.7 | 46.8 / 53.6 | 35.9 / 39.7 | 124.3 / 136.4 (117 callers) |

- **`EXPLAIN (ANALYZE, BUFFERS)` under RLS:**
  - The queue page (`callQueuePageSql`):
    - Tele-caller: planning 5.0 ms, execution 25.5 ms.
    - Team lead reading the caller's queue: 2.5 ms and 23.9 ms.
    - The 2,000 leads come off `opportunities_entity_owner_idx` in 1.3 ms. The Qualified stage and the pipeline are memoised per pipeline. Each lead probes `tasks_account_state_due_idx` and `calls_opportunity_started_idx` under the policies.
  - The team view's counts (`teamQueueCountsSql`), team lead over 20,000 leads: planning 2.3 ms, execution 163 ms, 88,142 buffers (355,800 before the change).
  - The full plans are in `results/calling.json`.
- The second page costs the same as the first, because the keyset narrows the rows after ranking. The team view grows with the leads of every caller it lists; 200,000 leads at once is not measured.

**Checks** (the cloud VM, Postgres on 54322):
- `pnpm test:security` on a fresh database with the final query code: db 32 files and 984 tests, domain 58 and 663 (`reader-parity.test.ts` 8), web 15 and 242, all passed.
  - Run a second time on a database the suites, the spike and the journeys had already used, `import-kinds.test.ts` failed once. Its fixed row "Two Sites, Sikar" matched the customer its first run had saved. That test cannot run twice on one database; it is not T1's.
- After the query change: `call-queue.test.ts`, `calls.test.ts` and `reader-parity.test.ts`, 39 passed.
- `e2e/calling.spec.ts`, against the final build:
  - Inside calling hours (03:51 and 03:53 UTC on 06-10-2026), desktop-light, desktop-dark and phone, twice: 17 passed with no retry, setup included. The keyboard path passed on each project: the unanswered call and its retry task, the callback, the qualified lead and `N`; and the team lead's view.
  - Outside calling hours (19:58 UTC on 05-10-2026): 17 passed, with the refusals checked.
  - "Calling in the snapshot company" fails on all three projects only for want of its `calling.png` baselines. They are made on the PC (hybrid §2); the files written here were deleted, and its axe check passed before the screenshot.
- `pnpm build` passed. `pnpm --filter web js-budget`: every page within budget (30 pages); `/calling` is 196.7 kB of 206.
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Unit tests (`turbo run typecheck test --force`, 15 tasks): tokens 134, copy-lint 17, ui 105, contracts 177, db 122, domain 1,600 and web 638, all passed.
- `pnpm copy-lint`, `pnpm format:check` and `check-doc-links.py` (`bad 0`): clean. `db:docs` and `machines:docs`: no change.
- Not run here: the secret scan (the gitleaks image is not on the VM) and the screenshot baselines; both run on the PC at integration.

**The cloud environment** (for the trial, `docs/runbooks/hybrid.md` §10):
- The hook printed `pnpm install failed`. Two causes:
  - The image's corepack records `bin/pnpm.cjs` for pnpm 12.6.0, which ships `bin/pnpm.mjs`.
  - The Node 24 that `cloud-setup.sh` installs in `/usr/local` is hidden behind `/opt/node22/bin`, which comes first in `PATH`; `node` stayed 22.22.0.
- The fix stays in this session's scratchpad and changes nothing in the repository:
  - Node 24.21.0 installed in `/usr/local` as `cloud-setup.sh` installs it (the SHA-256 checked against nodejs.org's list).
  - `/usr/local/bin` and a `pnpm` shim (`node …/pnpm/12.6.0/bin/pnpm.mjs`) put first in `PATH`.
  - `pnpm install --frozen-lockfile` from the lockfile, which it left unchanged.
- The journeys' Chromium (revision 1243) was missing; it was installed with `pnpm --filter web exec playwright install --with-deps chromium`, as the brief allowed.
- When Playwright starts `next start` itself, the run never ends after its last test. A catalogue journey test does the same, so it is not T1's. The journeys here ran against `next start -p 3000`, started beforehand from the build, which Playwright reuses.
- On a Linux host outside the Playwright image, `snap()` compares screenshots and fails against the PC's baselines (a catalogue test did); only the image's run counts.
- These are worth a separate fix to `cloud-setup.sh` and the hook. Raising it as a suggested task failed, because the tool timed out.

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
- `N` on the queue's last lead goes back to the first lead, and does nothing only when the open lead is the queue's only one.
- `/` selects the last search, so typing replaces it.

**Uncertain:**
- The spike's numbers come from a quiet cloud VM with 20,000 made-up leads. The lead engineer measures again at integration and on the hosted stack.
- The selected row's secondary text is now as dark as the customer's name; the reviewer may prefer a token change so that `--text-muted` holds AA on `--accent-soft`, which is a design-system decision outside this slice.

## Review

## Integration notes
