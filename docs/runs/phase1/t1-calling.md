# T1 Cold Caller workspace (wave 3)

| | |
|---|---|
| Branch | `feat/t1-calling` on GitHub, from `main` at cbec38fc (#105) |
| PC worktree | `t1-calling`, slot 15: Postgres 54345, app 3045 (`bash tools/integration/setup-worktree.sh t1-calling feat/t1-calling 54345 3045`) |
| Runs on | Cloud (owner, 05-10-2026): build, review, fixes, the merge with `main`, integration and baselines; the pull request and the hosted steps from the PC |
| State | fixes done; awaiting re-review |
| Next step | the re-review of the fixes; the integration follows D1's merge |

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
  - Inside calling hours (03:51, 03:53 and 04:06 UTC on 06-10-2026, the last on a fresh build of `26b21eb`), desktop-light, desktop-dark and phone, three times: 17 passed with no retry each time, setup included. The keyboard path passed on each project: the unanswered call and its retry task, the callback, the qualified lead and `N`; and the team lead's view.
  - Outside calling hours (19:58 UTC on 05-10-2026): 17 passed, with the refusals checked.
  - "Calling in the snapshot company" fails on all three projects only for want of its `calling.png` baselines. They are made on the PC (hybrid §2); the files written here were deleted, and its axe check passed before the screenshot.
- `pnpm build` passed. `pnpm --filter web js-budget`: every page within budget (30 pages); `/calling` is 196.7 kB of 206.
- `pnpm lint`: clean, last run at 04:08 UTC on 06-10-2026. `pnpm typecheck` (`turbo run typecheck --force`): 8 tasks successful.
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

### 06-10-2026, cloud builder: the review's fixes
The seven findings are fixed on `feat/t1-calling` without `main`, and every check of the fix brief passes. Each fix has its test from the review's cases. The ten new security-suite tests failed on `986c4e8` before the fixes (commit `78b3343`: 10 failed, 31 passed).

**Built (files):**
- `packages/domain/src/commands/crm/call-tasks.ts`:
  - `cancelCallTasks` cancels a lead's open call tasks of the kinds named, each through `crm.task.cancel`.
  - `moveCallTasks` moves a lead's open callbacks and nurture calls to a new owner.
  - `scheduleNurtureCalls` cancels any open nurture calls before it sets the three new ones.
- The commands:
  - `crm.opportunity.reopen` cancels the lead's open nurture calls.
  - `crm.opportunity.lose` cancels its open callbacks and nurture calls.
  - `crm.opportunity.assign` moves its open callbacks and nurture calls to the new owner, before the owner changes.
  - The opportunity machine names each of these as an effect; `machines:docs` regenerated.
- `calls.call.log` (`log-call.ts`):
  - `settleCallTasks` completes the due callbacks and nurture calls, and cancels later callbacks through `cancelCallTasks`. Later nurture calls end in reopen or lose.
  - A Qualified outcome moves the lead only from a stage positioned before Qualified.
- `unansweredAttempts` (`src/telecom/call-schedule.ts`) counts a run's unanswered attempts, from calls made after `opportunities.state_changed_at` only. `log-call.ts`, `loadCallLead` and the queue all call it.
- The queue (`rankedQueue`): a nurture task holds a lead back only while the lead is in nurture. `loadCallLead` shows a nurture call as the next call by the same rule.
- Web: `useCommand(action, form)` and `formKeyFor` (`src/components/screens/use-command.ts`); the workspace keys its log form to the open lead.
- Documents: SECURITY §7 (one line), PRD §8 (TEL-01), DATABASE (`calls.attempt_no`) and the schema comment, design §7.2 "Built (T1)" and §8.2, `docs/spikes/calling.md` and `results/calling.json`; `pnpm db:docs` and `machines:docs` regenerated.

**Tests added (17):**
- `packages/domain/tests/commands/calls.test.ts`, 6:
  - A: a lead reopened on the board keeps no nurture calls, with three audited cancellations.
  - B: a nurtured lead lost on the board keeps no nurture calls, and a lost lead keeps no callback.
  - C: nurtured, reopened and nurtured again, a lead has one set of nurture calls.
  - D: a lead reopened after its three tries starts again at attempt 1, and the workspace shows 0 tries.
  - D: an unanswered nurture call is saved as attempt 1, and the workspace shows 1 of 3.
  - F: a lead at Quoted stays there, with no stage move.
- `packages/domain/tests/queries/call-queue.test.ts`, 4:
  - A: a lead nurtured and reopened is back in its owner's queue as not called.
  - An open lead with a nurture task is in the queue.
  - D: the queue shows 1 try for a nurture call, where it showed 4.
  - A callback at 16:00, reassigned at noon: the old owner has no open task on the lead. The new owner's queue leaves the lead out at 12:30 and shows it as a due callback at 16:00 when read at 16:30.
- `src/telecom/call-schedule.test.ts`, 4 (`unansweredAttempts`); `apps/web/src/components/screens/use-command.test.ts`, 3 (`formKeyFor`).
- Changed: `timeline.test.ts` expects the reopen's three `task_cancelled` rows.

**The spike** (`pnpm spike:calling`, 12:01 IST, the same cloud VM with 4 cores and 16 GB, on a database the suites had used):
- **Times:** every case is under 300 ms at the 95th percentile:
  - queue: p95 67.0 ms for the tele-caller, 72.1 ms for the team lead;
  - lead: p95 57.5 ms or less;
  - team view: p95 177.9 ms for the team lead (11 callers), 186.5 ms for the General Manager (98 callers).
- **`EXPLAIN (ANALYZE, BUFFERS)` under RLS:**
  - Queue page: execution 37.0 ms for the tele-caller, 28.9 ms for the team lead.
  - Team view's counts: execution 188.2 ms, 88,914 buffers.
  - The plans keep their shape. The team view is slower than at 00:14 (p95 127.2 and 136.4 ms then) with about the same buffers (88,142 then). It was not measured again on a fresh database.

**Checks** (the cloud VM, Postgres on 54322, with the code of `2d2b8b6`):
- `pnpm test:security`: db 32 files and 984 tests, domain 58 and 673, web 15 and 242, all passed.
- `pnpm lint`: clean. `pnpm exec turbo run typecheck --force`: 8 tasks successful.
- `pnpm exec turbo run test --force`, 8 tasks, all passed: tokens 134, copy-lint 17, ui 105, contracts 177, db 122, domain 1,603 and web 641.
- `pnpm copy-lint` and `pnpm format:check`: clean. `pnpm db:generate`: no schema changes. `check-doc-links.py`: bad 0.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within budget (30 pages); `/calling` is 196.8 kB of 206.
- `e2e/calling.spec.ts --ignore-snapshots` after `e2e:seed`, against `next start -p 3000`, from 12:00 IST: 20 passed, setup included. The keyboard path and the team lead's view passed on desktop-light, desktop-dark and phone.
- Not run here: the secret scan and the screenshot baselines, both on the PC at integration.

**Decisions the brief did not settle:**
- The app may not change a task's person: 0078 grants update on `due_at`, `state`, `done_at` and the `updated_*` columns only. The assign move therefore creates a task for the new owner at the same time and cancels the old one, both through the task commands. A callback already due moves to the current time, since a task may not be created in the past.
- The assign move takes every open callback and nurture call on the lead that the assigner may change, whoever holds it, and skips any the new owner already holds.
- `cancelCallTasks` and `moveCallTasks` act only on tasks whose person the caller's own lead write scope covers (`app.scope_ok`, as the task update policy asks). Other tasks are left, so a reopen or a lose by a caller with own scope is never refused over a colleague's task. The queue reads only the owner's tasks.
- A call made at the same moment as the state change does not count: its `started_at` must be later. The third try parks the lead at that moment, so a nurture call that goes unanswered is attempt 1.
- `crm.opportunity.win` cancels no call tasks, as the brief did not ask for it. A won lead holds no nurture calls after these fixes, but a pending callback stays open on it.

**Uncertain:**
- The idempotency fix has a unit test of the key rule only, because `apps/web` has no DOM test library to render the hook. The calling journey saved three calls on three leads in a row on each project.

## Review
### Review of cbec38fc..986c4e8, 06-10-2026, slice-reviewer in the cloud
One high and two medium findings, all in the calling rules' tasks and stage moves; the rest is low. The security model, the command's guards, the queue's SQL, the copy and the journeys hold. The findings marked confirmed were reproduced on the cloud VM's Postgres, with a scratch test the review did not commit. Each failing case is described under the finding, so the builder can turn it into a real test.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | High | Nurture calls outlive nurture: a lead reopened from the board drops out of its owner's queue, and lost or re-nurtured leads keep or double their nurture calls | Fixed in `c81bd50`: cases A, B and C, the reopened lead in the queue and the nurture-task rule, each failing on `986c4e8` |
| 2 | Medium | The unanswered-attempt count runs on across nurture: a reopened lead goes back to nurture on its first unanswered call | Fixed in `c81bd50`: case D and a nurture call's count, in the command, the workspace and the queue, each failing on `986c4e8` |
| 3 | Medium | A qualified outcome moves a lead back from a later stage and asks for the handover again | Fixed in `c81bd50`: case F, a lead at Quoted, failing on `986c4e8` |
| 4 | Low | A reassigned lead's callback stays with its old owner, and the new owner's queue shows the lead as ready to call | Fixed in `c81bd50`: the 16:00 callback reassigned at noon, failing on `986c4e8` |
| 5 | Low | After a lost answer, the workspace's one idempotency key blocks every later call until the page reloads | Fixed in `0455cd2`: the key rule `formKeyFor` has a unit test; the hook is not rendered in a test (no DOM test library) |
| 6 | Low | `D`'s calling-hours and consent gate is one click from Account 360's full number and `tel:` link | Fixed in `b6e7bf6`: SECURITY §7; marking a withdrawn consent on Account 360 is the lead's follow-up |
| 7 | Low | PRD §8 still traces TEL-01 to "—" | Fixed in `b6e7bf6`: the four test files |

**1. Nurture calls outlive nurture (high, confirmed).**
- **Where:** `packages/domain/src/commands/crm/nurture-opportunity.ts:36` sets three `nurture` tasks every time a lead enters nurture. `reopen-opportunity.ts` and `lose-opportunity.ts` never cancel them. Only `calls.call.log` does, through `settleCallTasks` when the call itself takes the lead out of nurture. The queue (`packages/domain/src/queries/calls/call-queue.ts:93`, `rankedQueue`) leaves out any lead whose owner holds a later open `callback` or `nurture` task, whatever the lead's state.
- **Reproduced:**
  - A: a lead nurtured on the board at 10:00 and reopened on the board at 11:00 keeps its 3 open nurture tasks. At 12:00 `listCallQueue` for its owner is empty, where the lead should be "Not called yet" or "Ready to call". It stays hidden until day 7, then shows as "Call back due". The day-7 call does not end it: the lead is open, so `settleCallTasks` keeps the day-30 and day-90 nurture tasks (it cancels later ones only when the call itself takes the lead out of nurture). Unless that call's outcome sets an earlier call, the lead hides again until day 30.
  - B: a nurtured lead lost on the board keeps 3 open nurture tasks, on its owner's task list for 90 days.
  - C: nurture, reopen and nurture again on the board leaves 6 open nurture tasks.
- **Why it matters:** reopening a parked lead is an ordinary board action (the customer rings back). The queue is the slice's main deliverable, and it silently loses that lead. A lead reopened and then won keeps them as well, since `win` (only from open) cancels nothing either (by reading the code).
- **Fix:**
  - Cancel the lead's open `nurture` tasks whenever it leaves nurture (reopen and lose), in the commands or in one shared helper, so the board and `calls.log` behave the same.
  - Make `scheduleNurtureCalls` leave no second set: cancel or skip the open ones first.
  - In `rankedQueue`, let a `nurture` task hold back only a lead in state `nurture` (`t.kind = 'callback' or o.state = 'nurture'`).
  - Test each of A, B and C in `calls.test.ts` or `opportunity.test.ts`, plus the queue case in `call-queue.test.ts`.

**2. The attempt count runs on across nurture (medium, confirmed).**
- **Where:** `log-call.ts:209` sets `attemptNo` to the last call's `attempt_no + 1` whenever that call's outcome was a retry, with no regard to what happened to the lead in between. `loadCallLead` (`call-queue.ts`, `attempts`) and the queue's `attempts` read the same number.
- **Reproduced (D):**
  - Three unanswered calls on day 1, 2 and 3 park the lead (`not_reachable`).
  - On day 15 the lead is reopened on the board.
  - Its next unanswered call is saved as attempt 4. `afterUnanswered(4, …)` answers nurture, so the lead goes straight back to nurture (`attemptsUsedUp: true`) after a single try, and gets another set of nurture calls (finding 1).
- **Also:** each unanswered nurture call counts up too (4, 5, 6). The workspace then reads "Tries without an answer: 4 of 3", and the queue "4 tries without an answer".
- **Fix:** start a new run when the lead's state changed after the last call. For example, count only calls made after `opportunities.state_changed_at`, or start at 1 when the last call was made in another state. Give the display the same rule, and test the reopened lead and the nurture-call count.

**3. A qualified outcome can move a lead backwards (medium, confirmed).**
- **Where:** `log-call.ts:298-303` moves the lead to the Qualified stage whenever it is not already there.
- **Reproduced (F):**
  - A residential-rooftop lead was moved New → Contacted → Qualified → Quoted.
  - A call on it saved with the Qualified outcome moved it back to Qualified. Such a lead is found with `/` and is still its tele-caller's until T2's handover reassigns it.
  - `moveOpportunityStage` sets `handover: true` on any move to `qualified` (`move-opportunity-stage.ts:60`), so the event asks for the handover a second time. Once T2's worker runs, that request reassigns the lead (by reading the code).
- **Fix:** move only when the lead's stage is positioned before Qualified; otherwise save the call and leave the stage. Test a lead at Quoted.

**4. A reassigned lead's callback stays with its old owner (low, confirmed by reading).**
- **Where:** `crm.opportunity.assign` moves no tasks. The queue reads only the owner's tasks (`t.assignee_id = o.owner_id`), and `settleCallTasks` and `loadCallLead` read only the caller's and the owner's.
- **What happens:** an open lead with a callback at 4 PM is reassigned at noon. The new owner's queue shows it at once as "Ready to call", so the time the customer asked for is lost. The old owner keeps a callback task on a lead they no longer own.
- **Fix:** have assign move the lead's open `callback` and `nurture` tasks to the new owner (or cancel and recreate them), or have the queue read the lead's open call tasks whoever holds them. If the fix waits for T2's `crm.lead.reassign_all`, say so in design §8.2.

**5. One idempotency key for the whole workspace (low, plausible).**
- **Where:** `calling-screen.tsx:430` uses one `useCommand(logCall)` for every lead and dialog. The key changes only after a success (`use-command.ts`).
- **What happens:** if a save commits but its answer is lost, the key stays. The caller moves on (`N`) and presses an outcome on the next lead. The same key arrives with other input, `runCommand` answers `idempotency_mismatch`, and every later save fails with "This form was already sent with different details" until the page reloads. The lost call is never shown as saved.
- **Fix:** give each lead (or each pick) its own key. For example, key the hook to the open lead so `open()` starts a new form, or let `useCommand` take a reset.

**6. The number gate is one click away (low, confirmed by reading).**
- **What happens:** the workspace's "Open customer" link goes to Account 360. Account 360 shows every phone in full with a `tel:` link at any hour, and for a customer who withdrew consent (`account-screen.tsx:282-288`, C2's). `D`'s refusal outside calling hours, and its absence for a withdrawn consent, therefore only steer the caller; they do not stop the number being dialled. Calls are dialled by hand, so the real control is `calls.call.log` refusing the log.
- **Fix:** say this in SECURITY §7 (the number gate guides the caller, and the log is refused). Alternatively, mark the withdrawn consent beside the number on Account 360 and drop its `tel:` link there; that can be a follow-up outside T1.

**7. PRD §8 trace (low, confirmed).** `docs/PRD.md` §8 still has TEL-01 "Tested in —". Name `packages/domain/tests/commands/calls.test.ts`, `packages/domain/tests/queries/call-queue.test.ts`, `packages/db/tests/security/calls.test.ts` and `apps/web/e2e/calling.spec.ts`.

**Checked and sound:**
- **Data isolation:**
  - `calls` is in `ENTITY_TABLES` with a fixture row per company (byte 0x30), a matrix rule (read with the lead) and `NARROWER` (insert only).
  - RLS is forced. The read policy names `app_user` and `app_reader` and fails closed on a null company setting.
  - The insert policy holds the caller to themselves, to a `user` principal, to `calls.log` scope over the lead's owner and team, and to a live outcome of the group or the lead's company. The composite key ties the call to its lead's company.
  - The append-only trigger is tested against the table owner as well. `readonly_reporter` gets select with no policy, as `sizings` does.
- **Command:**
  - `peopleOnly`; `calls.call.log` is in the agent refusal sweep's `INPUTS`.
  - Tests cover the denied, wrong-company and happy paths. One audit row for the call; every next step runs through its own command in the same transaction, so each is audited and on the timeline. No new event, as the brief asks.
  - The lead is locked (`for update`) before the attempt count is read, so two saves on one lead are serialised.
  - Cost permissions, prices and tax are untouched.
- **Web layer:**
  - Every read goes through `executeQuery()` with a name, the write through `executeCommand()`, and the page through `screenAccess(navRequires('calling'))`.
  - Browser code imports only types from `@shakti/contracts`, and nothing opens a connection at import time (`pnpm build` passed with no change).
- **Copy:** every string is in `en.json`, plain and final. The script card shows no sample script, and the refusal sentences say what to do next.
- **Accessibility and look:** the three screenshots written here (desktop light, desktop dark and phone) were looked at before they were deleted. The selected row reads in both themes, and the phone layout stacks the queue above the lead.
- **Defaults:** the two defaults are in `WORKSHOP_DEFAULTS.calling`, DECISIONS, design §11, the workshop pack's CALL-3 and CALL-5 "Today" lines and exit-gate action 16.
- **Spike:** the queue and team-view SQL is the statement the spike explains (`callQueuePageSql`, `teamQueueCountsSql`). The keyset carries `asOf`, so the pages add up to the whole queue (tested).

**Run by the review** (cloud VM, Postgres on 54322, branch at `986c4e8`):
- **`pnpm test:security`:** db 32 files and 984 tests, domain 58 files, web 15 files, all passed.
- **`pnpm build`:** passed.
- **`pnpm --filter web js-budget`:** every page within budget; `/calling` is 196.7 kB of 206.
- **`e2e/calling.spec.ts`** at 11:23 IST, inside calling hours, against `next start -p 3000`: 17 passed, including the keyboard path on desktop light, desktop dark and phone. The 3 "snapshot company" cases failed only for want of their `calling.png` baselines; those files were deleted and are made on the PC. The browsers are `chromium-1243` and `chromium_headless_shell-1243`, copied from the Playwright image.

**Not checked:** the secret scan (no gitleaks image here) and the screenshot baselines, both made on the PC at integration; the spike's timings were not re-measured.

### 06-10-2026, the lead's fix brief (for a cloud builder)
Fix on `feat/t1-calling` without taking `main`. Invoke the `add-command` and `writing-guidelines` skills with the Skill tool first. Each fix gets the test its finding names (the reviewer's cases A to F), and each must fail on the code before the fix; mark each row of the table above `fixed in <commit>` with what was checked.
1. **Finding 1 (high):** one shared helper cancels a lead's open `nurture` tasks whenever the lead leaves nurture: on `crm.opportunity.reopen` and on `crm.opportunity.lose` (lose also cancels the lead's open `callback` tasks), in the same transaction, each cancellation through the task machine and audited as the other task changes are. `calls.call.log` uses the same helper, so the board and the workspace behave alike. `scheduleNurtureCalls` cancels any open nurture tasks of the lead before it sets the three new ones. In `rankedQueue`, a `nurture` task holds a lead back only while the lead is in state `nurture` (`t.kind = 'callback' or o.state = 'nurture'`). Tests: A, B, C, and the queue case.
2. **Finding 2 (medium):** a run of unanswered attempts counts only calls made after the lead's `state_changed_at`, so a lead that left nurture starts again at attempt 1; the workspace's "Tries without an answer" and the queue's count read the same rule (one function, used by `log-call.ts`, `loadCallLead` and the queue). Tests: D, and the count shown for a nurture call.
3. **Finding 3 (medium):** a Qualified outcome moves the lead only when its stage is positioned before the pipeline's Qualified stage; otherwise the call is saved and the stage left as it is (no second handover). Test: F, a lead at Quoted.
4. **Finding 4 (low), the lead's decision:** `crm.opportunity.assign` moves the lead's open `callback` and `nurture` tasks to the new owner in the same transaction, audited, so the time the customer asked for travels with the lead. T2's `crm.lead.reassign_all` will use the same command. Test: a callback at 16:00, reassigned at noon, shows in the new owner's queue as a callback at 16:00 and not in the old owner's tasks.
5. **Finding 5 (low):** each lead gets its own idempotency key: key the `useCommand(logCall)` form to the open lead, so opening another lead starts a new form. Unit test of the key change if the hook allows; otherwise say how it was checked.
6. **Finding 6 (low):** SECURITY §7 says in one line that the workspace's number button guides the caller and `calls.call.log` is the control that refuses a call outside the hours or without consent. Marking a withdrawn consent on Account 360 is a follow-up outside T1; the lead records it.
7. **Finding 7 (low):** PRD §8 traces TEL-01 to the four test files the finding names.
8. Then run `pnpm test:security`, `pnpm lint`, `pnpm exec turbo run typecheck --force`, `pnpm exec turbo run test --force`, `pnpm copy-lint`, `pnpm db:generate` (no changes), `python3 tools/integration/check-doc-links.py` (bad 0), `pnpm build`, `pnpm --filter web js-budget`, and `e2e/calling.spec.ts` with `--ignore-snapshots` on all three projects after `e2e:seed`, inside calling hours (09:00 to 21:00 IST). Write a dated Report section, set State to "fixes done; awaiting re-review", commit and push. Delete turbo's `turborepo-agent-rules` block from `AGENTS.md` before every commit if a run writes it.

## Integration notes
