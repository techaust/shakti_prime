# Hardening follow-ups, batch 2 (wave 6, after G1)

| | |
|---|---|
| Branch | `fix/followups-hardening-2` on GitHub, from `main` at 83e31c33 (#186) |
| PC worktree | `followups-hardening-2`, slot 2: Postgres 54332 (container `shakti-pg-followups-hardening-2`), app 3032 |
| Runs on | PC (owner, 17-10-2026: spend the week's remainder before the reset; the lead runs it while the owner is away) |
| Tier | B (workers, delivery and test start-up): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | build Opus medium from week 94 (18-10-2026) |
| State | built |
| Next step | the lead reads the diff, remakes the three baselines the report names in the Linux image, and starts the review |

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

### 18-10-2026, PC (slot 2, Opus 5.5 medium)
Skills loaded: none (no table, no command and no new screen; the brief names none).

**What was built, by item**
1. The seed's waiting events and the nudge's budget. `apps/web/e2e/setup/deliver-waiting.ts` (new) delivers, in the seed's own process with `AI_TRANSPORT=fake`, every event the seed left waiting, run after run until a claim is empty (two-minute limit); `seed.ts` calls it last and prints the count. The in-process publisher (`apps/web/src/workers/outbox.ts`) takes a deadline: once the run's budget has passed, the events left in a claim are answered `notTried` (a new `PublishResult` case, `packages/domain/src/ports/event-publisher.ts`); `runOutboxPublisher` records nothing for them, so the claim releases them with their attempt given back, and claims no more. The first event of each call is always delivered. `publishOutbox` gives the default in-process publisher `now + budgetMs`, so the local nudge (10 s) and the local publisher route (30 s) both stop inside a claim.
2. `crm-scoring-referrals.test.ts`: the rescoring case counts the two rule records exactly and the batch records by their rows (which must add up to `rescored`), and checks the clear by its own two leads' scores, with `rescored >= 2`.
3. `customers.spec.ts` "sizes a lead…": the cause is the scroll position. The page is left scrolled to the Work out size button by however far the run scrolled it, and a full-page picture draws the fixed top bar there (the committed phone baseline shows the top bar mid-page); the journey now scrolls to the top and waits for `scrollY` 0 before the picture (the lesson of slice-integration §10 for `reload`).
4. Triage redelivery. `runTriage` takes `TriageDeps` (`AgentStepDeps` with `keyValue`); the worker passes the event context's shared store. Before the model is called, the answer kept under `triage:answer:{eventId}` is read; an answer from the model is kept for `TRIAGE_ANSWER_TTL_SECONDS` (3 h, under the shortest outbox redelivery window, 3¼ h with jitter). Only the model's text is kept, and it goes through the output filter again. A store that is away costs only a model call (logged at warn).
5. The Vault page's time. `maskInTime` takes `deliveryMs` (`PAGE_DELIVERY_LIMIT_MS`, 50 s from the route's start): when the turn begins, the mask gets the lesser of `maskMs` and what is left. With under `MASK_MIN_LEFT_MS` (5 s) left, or when the cut-down time runs out, the masking step is closed and the delivery answers `integration_unavailable` (delivered again; the file is not refused); `too_slow` stays for a mask that runs out its own 45 s. The route's start: the event route reads `performance.now()` first and passes it through `deliverEvent` (`startedAt`) into `EventHandlerContext.startedAt` and the file check (`FileCheckDeps.startedAt`, with a `clock` for tests). The vault photo path has the same bound.
6. Read again racing redelivery. `indexKnowledgeFile` claims the vault file in the shared store (`knowledge:reading:{id}`, `SET NX`, `KNOWLEDGE_READ_CLAIM_SECONDS` 330: longer than the 300 s route, shorter than the 360 s after which Read again is offered) and gives it back when the reading ends, however it ends. A second reading finds it taken and stops with `taken` (nothing read, spent or recorded); the index route answers it `duplicate`. The route and the in-process worker both pass the store (`indexDeps(principal, requestId, keyValue)`).
7. `apps/web/src/observability/client-left.ts` (new): `clientLeft(error)` is true only for React's "The destination stream closed early." and Next's `ResponseAborted`, along a short chain of causes. `onRequestError` logs those as `request.client_left` at info level and sends nothing to Sentry; every other error stays `request.failed` at error level.
8. Admin › Agents: the overlap comes from the screenshots' fixed table layout (`e2e/support/snap.css` lays out a table holding a masked value from its heads), which gave every column the same width while the Autonomy and limit controls are 14rem wide. The two control columns now carry `w-64` on their head and cells, so the fixed layout keeps them; the browser's own layout is unchanged.

**Baselines for the lead to remake in the Linux image** (none remade on the host): `desktop-light/agents.spec.ts/admin-agents.png` and `desktop-dark/agents.spec.ts/admin-agents.png` (item 8; the phone shows cards, unchanged), and `phone/customers.spec.ts/customer-sizing.png` (item 3: its committed picture has the top bar drawn mid-page; the desktop ones were taken at the top and should not change).

**CI step**: not changed. All three places that start the journeys' server run `e2e:seed` first (`e2e`, `e2e:snap`, CI's "Migrate and seed"), so the delivery sits at the seed's end with `AI_TRANSPORT=fake` set in the seed's process, and no `checks-ok` is needed. This departs from the brief's wording (the three server starts); the effect is the same in all three.

**Tests added** (19): domain `publisher.test.ts` +1 (untried events released, no further claim); web `outbox.test.ts` +4 (deadline inside a call, first event always delivered, no deadline, untried left unanswered through `publishOutbox`); `triage.test.ts` +2 (a redelivery after a partial run finds the kept answer and calls nothing; one that finds none calls again; the answer's time to live); `timed-mask.test.ts` +3 with a fake clock (a turn at 30 s gets 20 s, then hands back; under 5 s left hands back at once; a mask out of its own 45 s is still `too_slow`); `mask-pdf-pages.test.ts` +1 (a page with 3 s of the delivery left is handed back, nothing kept); `knowledge.test.ts` +2 (two readers: the second finds the file taken, one model call, the claim given back; a failed reading gives the claim back and a dead one's lapses); `client-left.test.ts` +5; `instrumentation.test.ts` +1. The rescoring case was checked by hand with `RESCORE_BATCH = 1` (one lead a batch): the old assertions fail and the new ones pass (the constant restored).

**Checks**
- Each changed unit file three times in a row: `outbox.test.ts` 12 passed ×3, `publisher.test.ts` 27 ×3, `timed-mask` with `mask-pdf-pages` 20 passed, 1 skipped ×3, `instrumentation` with `client-left` 8 ×3; on Postgres `crm-scoring-referrals` 26 ×3, `triage` 12 ×3, `knowledge` 25 ×3, web `triage` 3.
- Unit suites: domain 2,242 passed (81 files); web 875 passed, 1 skipped (120 files).
- `pnpm test:security` on 54332: db 1,263, domain 1,025, web 327, all passed.
- Journeys `agents.spec.ts` and `customers.spec.ts`, after `pnpm --filter web build`, with `e2e:seed` before each run: 69 passed, 2 skipped (5.4 min), then 69 passed, 2 skipped (5.7 min), none flaky. A run without seeding first fails the inbox cases, whose suggestions the run before used up; the `e2e` script always seeds. Pictures are compared only on Linux, so these runs compare none.
- Typecheck of `web` and `@shakti/domain`, eslint of each folder, Prettier; the whole-repository `pnpm lint` passed.

**Timing of the first journey command after `e2e:seed`**
- Before (main's code): the seed left 63 events waiting on a fresh database and 85 after a second seed; a nudge in a process of its own took 5.9 s and 2.8 s to deliver them. Batch 1's review measured 200 to 245 waiting and 30 to 44 s on the first request of a journey run.
- After: the seed delivers 127 (fresh database), 211 and 253 (after journey runs) events in 2 runs, about 4 s, leaving 0 waiting; a nudge then takes 44 ms. In the journey runs the first command (`agents.inbox.edit`) answered in 1.0 s and 1.4 s, and the first publisher run claimed 1 event.

**`EXPLAIN`**: none; no list or search query was added or changed.

**Decisions the brief did not settle**
- Item 1: the delivery is in the seed, not after each of the three server starts (above). `PublishResult` gains a `notTried` case rather than reading a missing answer as untried, so a queue's missing answer still fails as `no_answer`.
- Item 4: the answer is kept 3 h, only its text, in the store the event ids use. It holds the model's verdicts on a lead (the model is never sent a name, number or address), so it is short-lived lead data in Redis.
- Item 5: 50 s for a delivery's masking and 5 s as the least worth starting; a mask cut short by the delivery is handed back, never refused.
- Item 6: a store claim (no migration) rather than the event id recorded on the file; the second reading stops for good (`duplicate`), since the first is retried by its own queue if it fails.
- Item 7: Node's `ECONNRESET` and "Premature close" stay errors; only the two errors that can only mean the browser left are lowered. Next may still print its own console line for the aborted render, which is outside the app's logger.

**Unfinished or uncertain**: the three baselines above wait for the lead's Linux run. Item 3's flake could not be reproduced on the host (pictures are compared only on Linux), so its fix rests on the committed picture showing the top bar mid-page.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
