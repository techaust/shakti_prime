# The calling screen outside calling hours (follow-up)

| | |
|---|---|
| Branch | `fix/calling-hours-clock` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): telecom hours rules on the calling screen |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; builder (lane moved from seat 2) on Opus 5.5 at high, started 27-11-2026 16:55 UTC, done 27-11-2026 21:15 UTC on Opus 5.5 at high |
| State | built |
| Next step | the reviewer |

## Brief
STATUS's open follow-up: the click-to-dial journeys fail in CI before 09:20 IST and after 20:30 IST (#284's runs before 09:20 failed on phone and dark, and passed after). The suspect is the app's clock-shift path outside calling hours, which may also reach real callers. Find the root cause and fix it in code, not only in the journey.

1. **Reproduce first:**
   - Read the click-to-dial journeys and the calling screen's handling of the TRAI calling hours (`apps/web/src/screens/calling.ts`, the dial rules in `packages/domain/src/telecom`, `app.dial_facts()`).
   - Run the logic under the journeys' test clock (`bos-test-clock`, `apps/web/e2e/support/clock.ts`) and in unit tests at 09:10, 09:20, 20:30 and 21:05 IST.
   - Name the failing assertion and the code path in the report.
2. **Fix the cause:** a time read by the UTC date or the browser's zone instead of IST; a window edge off by one; a dial refused and shown wrongly; or the screen choosing a branch by the wall clock. What a caller sees outside calling hours must be plain and correct (copy in `en.json`, the §11 rules).
3. **Make the journey deterministic:** per [slice-integration §10](../../runbooks/slice-integration.md#10-lessons), it sets the server's clock with the test clock and runs both branches (inside and outside calling hours) on every run, never choosing a branch by the wall clock.
4. **Tests:** unit tests at each edge, in the domain or screen helper that holds the rule; the journey's two branches.

Files owned: the calling screen's hours handling and its helpers and tests; the click-to-dial journeys.

Do not touch: Phase 3 slices; `app.dial_facts()`'s consent and number-series rules beyond the hours edge, unless the cause is there, and then say so.

Review checklist: the hours rule is IST on every path; the journey runs both branches whatever the hour; the copy follows §11.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5, §10, §13 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: calling-hours-clock <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: calling-hours-clock blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (wave 2, 27-11-2026):**
- `x4-stock-reasons`: the reason registry of `app.stock_move()`;
- `h2-reservations`: reservations and availability, and the only body change to `app.stock_move()`;
- `u2-purchase-orders`: purchase orders, receipts and the scan field;
- `h3-stock-counts`: stock counts;
- `q1-labels`: labels and `parseLabelPayload()`;
- `r3-warranty`: warranty claims and supplier returns;
- `calling-hours-clock`: the calling screen outside calling hours.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the print document registry, the testing lists, `nav.ts`, `turbo.json` and `.env.example`.

## Report

### 27-11-2026 and 28-11-2026 IST, cloud VM lane (moved from seat 2)

**Reproduction (step 1).** Run in the failing window, on this worktree's Postgres (54331) and a local production build, Playwright's Chromium 1248:
- 22:25 IST, `click-to-dial.spec.ts`, desktop-light, no retries: 3 of 4 passed; the C test failed only at `toHaveScreenshot(call-bar-ended.png)` (3,145 pixels).
- 01:45 IST, the same spec on desktop-dark and phone with `--ignore-snapshots`: 8 of 8 passed. With pictures: only `call-bar-ended` differs (2,672 dark, 2,697 phone).
- 02:00 IST, the whole phone project as CI runs it (two workers, one retry): every click-to-dial step passed. The only failure in the spec was the same picture.
- Each of these pictures has the same content as its baseline: the same words, `Call ended`, `0:03` and `No call is set for later.` The difference is the font smoothing of this VM's Chromium against the Linux Playwright image's. The same counts came back after the fix.
- **What could not be reproduced here:** a failing step, or a picture whose content differs. The CI failure of #284 itself (its log and pictures) was not read: reading GitHub's workflow runs is outside this lane.

**Root cause, as far as this VM can show it:**
- The window (before 09:20 and after 20:30 IST) is exactly where `insideCallingHours()` (`e2e/support/clock.ts`) moves the server's clock. From 09:20 to 20:30 it returns 0 and nothing moves. So the wall clock chose between two paths, and only the moved path failed.
- On the moved path, the server's clock is up to 13 hours ahead of the browser's. The only calling-screen code that sets one clock against the other is the call bar (`apps/web/src/components/calling/call-bar.tsx`):
  - `elapsedSeconds(shown, Date.now())`: the browser's clock against the server's `startedAt` and `answeredAt`.
  - The three-hour read limit, `Date.now() - startedAt > POLL_LIMIT_MS`.
  - The duration handed to the log when the provider gave none.
- On the moved path the bar's time stood at 0:00 while a call rang and ran. A real caller whose device clock runs more than three hours fast would see the bar stop reading the call: it stays on "Placing the call", and Call stays disabled until the page is reloaded.
- The hours rule itself is IST on every server path: `withinCallingHours`, `checkDial`, `callLogRefusal`, `dialNumber`, `planCall`, `placeDial` and `logCall` all read the server's (or the test clock's) instant through `istMinuteOfDay`. No window edge is off by one (the edge tests below).

**What I built:**
- `apps/web/src/components/calling/call-bar.tsx`:
  - `serverClockOffset(startedAt, receivedAt)`: the server's clock taken from the dial's answer.
  - `stillReading(call, now)`.
  - The bar's time, its read limit and the duration it hands to the log are all on the server's clock (`Date.now() + offset`).
  - No copy changed. What a caller sees outside the hours is unchanged and already plain: "This call cannot be placed now:" and "It is outside calling hours. Calls can be made from 9 AM to 9 PM."
- `apps/web/e2e/support/clock.ts`:
  - `shiftToIstMinute(minute, now)`: always forward, more than 0 and at most a day.
  - `INSIDE_CALLING_HOURS_MINUTE` (11:00) and `OUTSIDE_CALLING_HOURS_MINUTE` (22:00).
  - `setClocks(context, shift)`: moves the server's clock through the cookie and the browser's through Playwright's `context.clock.install`, which keeps running in real time.
- `apps/web/e2e/click-to-dial.spec.ts`: each test that dials moves both clocks, to 11 AM in India or to 10 PM, on every run. The outside branch also asserts the hours sentence among the listed rules.
- The earlier attempt's browser-clock stand-in in `e2e/support/fixtures.ts` (`FAKE_CLOCK_OFFSET_MS`) is removed.

**Tests added (count):**
- `packages/domain/src/telecom/dial-policy.test.ts` (+7): dials at 09:10, 09:20, 20:30 and 21:05 IST (allowed, allowed, allowed, refused with `outside_calling_hours` only), with their UTC instants. A call at each edge logged as the hours say: 20:30 is still logged at 21:05, and 21:05 is refused. The next start from 21:05 is 09:00 the next IST day.
- `apps/web/src/components/calling/call-bar.test.ts` (+3): the offset from a device clock behind or ahead; the time counted from the press at device skews of −11 h, −5 min, 0 and +5 h; reading kept for three hours from the press on a device five hours fast, then stopped.
- `apps/web/e2e/support/clock.test.ts` (+8): the moved times from 09:10, 09:20, 20:30, 21:05, 11:00 and 22:00:30 IST; always forward and within a day, on the right side of the hours for 30 minutes, over two days at 7-minute steps; the moved browser's callback (10 AM the next day) 23 hours ahead of the moved server.

**Checks (through `heavy.sh`):**
- `pnpm typecheck`: 10 successful, 10 total.
- `pnpm lint` (the whole repository): exit 0. Eslint on `apps/web/src/components/calling`, `apps/web/e2e/support`, `apps/web/e2e/click-to-dial.spec.ts` and `packages/domain/src/telecom`: exit 0.
- Web unit tests: 167 files, 1,252 passed, 1 skipped. Domain unit tests: 110 files, 2,813 passed.
- `pnpm build`: exit 0. `pnpm --filter web js-budget`: every page is within its budget (65 pages).
- Journeys after the fix (01:58 IST, outside the hours, so the inside branch ran on moved clocks):
  - Run: `click-to-dial`, `calling`, `converting` and `channels`, three projects, no retries: 52 passed, 9 failed.
  - Every failure is a picture comparison, with no other error:
    - `call-bar-ended`: 3,145, 2,672 and 2,697 pixels, the same counts as before the fix, so the moved browser clock changed nothing in the picture.
    - `calling` snapshot company and `converting` keyboard pictures: this VM's fonts, specs not touched.
  - Every click-to-dial step passed in all three projects, both branches.
- Not run:
  - The security suite: no schema, policy, definer, command or query changed.
  - `copy-lint`: `en.json` is unchanged.
  - `db:docs` and `machines:docs`: not affected.
  - The Linux baselines: none needs remaking, since the content is unchanged. The lead's `e2e:snap` confirms.
- `EXPLAIN`: no list or search changed.

**Assumptions and decisions the brief did not settle:**
1. The fixed times are 11:00 and 22:00 IST, so a run of up to two hours stays on its side of the hours.
2. The browser's clock moves with the server's (Playwright's clock in real-time mode), so the screen's own times (the callback proposed for 10 AM tomorrow, the bar) agree with the server's, as on a caller's device.
3. Only the click-to-dial journeys moved to `setClocks`. `calling`, `converting`, `channels` and `uat` still use `insideCallingHours()` and `outsideCallingHours()`, which choose by the wall clock. They are not this slice's files (Phase 3 slices own them). A follow-up can move them to `setClocks` the same way.
4. The outcome dialog's proposed callback (`defaultCallbackLocal(new Date())`) still reads the device's clock. A wrong device clock proposes the wrong day, and the server refuses a time in the past or outside the hours (`callback_in_past`, `callback_outside_calling_hours`), so nothing wrong is saved. Left as it is: it needs a server time the dialog does not have.
5. Skills: none loaded. The repository's skills are for tables, commands and React performance; this change adds none of those.

**Uncertain:** the CI failure of #284 is not shown to be this cause. If the next CI run outside 09:20 to 20:30 IST still fails, the job's report artifact (`e2e-report-<project>`) names the step. With this change every run takes the moved path, so such a failure now shows on every run, not only by the hour.

## Review

### 27-11-2026, cloud VM lane, reviewer (Opus 5.5 at high), Tier B, at `627eca28`

**Verdict:** no critical or high finding. M1 has a one-line fix and should be fixed before the merge. M2 is for the lead to settle from #284's CI artifacts, or from this branch's first CI run. The low findings are follow-ups.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| M1 | medium | `apps/web/src/components/calling/call-bar.tsx:185-186`; `packages/domain/src/calls/place-dial.ts:61` with `apps/web/src/actions/dialling.ts:87` | The offset is measured when the dial's answer *arrives*. `startedAt` is the server's time at the *start* of the dial action. Between the two come the facts query, a possible DND registry lookup, the dial command, Exotel's connect call (`DIAL_TIMEOUT_MS` 8 s), the ringing record and the trip back. So the offset absorbs the dial action's whole duration, even on a device whose clock is right. The unit test encodes this (`call-bar.test.ts:56`, `-200`). | A caller with a correct phone clock places a real call, and the dial action takes 3 s. The bar starts at 0:00 instead of 0:03, and "On the line" shows 0:07 when the customer has been on for 0:10. Every real call under-counts by the dial's duration, and by about 9 s on the uncertain path. Before this change, a device with a correct clock counted right. The fix for a rare skewed device adds a bias to every device. The saved duration is not affected while the provider sends `durationS` or `endedAt`. | Take the offset from the moment of sending: `const sentAt = Date.now()` inside the thunk before `dialCall(...)`, and `serverClockOffset(outcome.call.startedAt, sentAt)`. The error is then only the upload time, a fraction of a second, on the press side. Alternatively, apply the offset only when its size passes a threshold, such as 60 s. Adjust the unit test to match. | confirmed (code path read end to end) |
| M2 | medium | Brief step 1; run file Report, "Uncertain" | The failing assertion of #284 is not named, and the brief requires it. The call-bar change does not touch any step the journey asserted before the fix. Before the fix, the moved path showed 0:00 on the bar while the call was live, and no assertion read that. "Call ended" and `0:03` come from the provider's `durationS`. So the change cannot explain a failing step. The builder's runs in the window found no failing step and no picture with different content. The real cause of the CI failure is still unknown. | The slice merges as "the root cause, fixed". The next CI run outside 09:20–20:30 IST, or now every run, since the journey always takes the moved path, fails on the same unknown step. | Before the merge, the lead reads #284's `e2e-report-phone` and `e2e-report-desktop-dark` artifacts, or this branch's own CI journeys, to name the step. If they are green on the moved path, record that the cause was the wall-clock branch choice in the journey (step 3 fixed it), and that the call-bar change is a separate fix for skewed devices. | plausible |
| L1 | low | `apps/web/e2e/support/clock.ts:8` and `apps/web/src/test-clock.ts:8` ("the clock only moves forward"); `click-to-dial.spec.ts:101, 150, 246` | Each test snaps the server back to the same on-the-minute target, the next 11:00:00 IST. A later test, or a retry, in the same run therefore starts *behind* the rows the earlier test made, by the earlier test's run time. The documented invariant breaks between tests on every run now. With `insideCallingHours()` it broke only in the moved window. | Today nothing reads across tests: each test uses fresh leads, and `refuseRepeat` reads only `dialling`/`ringing` calls. Take a retry of the C test after a failure that left a call ringing. That call has `startedAt` ≈ 11:00:30. The retry's server starts at 11:00:00, so `startedAt > now − 60 s` holds and the retry is refused with `dial_in_progress`. Any later test that reads the tele-caller's latest call or orders across tests would also see a future row. | Compute the shift once per worker, for example in `beforeAll` or a worker fixture, and reuse it, so the server's clock keeps running forward across the file's tests and retries. The other way is to drop the "only forward" sentence from both comments. | plausible |
| L2 | low | `apps/web/src/components/calling/call-bar.tsx:144, 153, 169, 185-189` | No test fails if the component's use of the offset is reverted. The new unit tests cover only the pure helpers. The journey moves both clocks together, so its offset is about 0 and the skewed-device path the fix is for never runs end to end. | A later edit puts `Date.now()` back on line 153 or 144. All tests stay green, and a device whose clock runs fast again stops the bar on "Placing the call". | Add one test to the C journey that moves only the server's clock, as on a device behind. While "On the line", it asserts that the bar's time moves past `0:00` before the call ends, for example with `expect.poll`. | confirmed |
| L3 | low | `apps/web/e2e/calling.spec.ts`, `converting.spec.ts`, `channels.spec.ts`, `uat.spec.ts` (8 calls to `insideCallingHours()` / `outsideCallingHours()`) | These journeys still choose between the moved and the unmoved path by the wall clock, against slice-integration §10. That is the same pattern this slice removed from click-to-dial. They are outside the brief's files (assumption 3). | One of them fails only before 09:20 or after 20:30 IST, as click-to-dial did. | Add a STATUS follow-up: move them to `setClocks(context, shiftToIstMinute(...))`. | confirmed |

**Checked and sound:**
- **The hours rule is IST on every server path.** `withinCallingHours`, `checkDial`, `callLogRefusal` and `nextCallingWindowStart` all go through `istMinuteOfDay`. `dialNumber`, `planCall`, `dialCall` and `logCall` all take `testNow()`. The manual flow's `startedAt` is the server's `dialledAt`. The simulated provider's reports run on the request's clock. `defaultCallbackLocal` is in IST. The new edge tests at 09:10, 09:20, 20:30 and 21:05 IST assert the right sides. The 21:05 test is refused with `outside_calling_hours` only. The 20:30 call logged at 21:05 stays within the grace.
- **The fix for a device more than 3 h fast is real.** It was read end to end: before the fix, `Date.now() - startedAt > POLL_LIMIT_MS` stopped the polling and the tick, and the bar stayed on "Placing the call" with Call disabled. `stillReading` on the server's clock removes this. Adding `offset` to the `onCall` effect's dependencies does not call `onCall` twice: `setOffset` and `setCall` are batched in one callback.
- **The journey runs both branches on every run.** Each dialling test calls `setClocks` with a fixed IST minute and no wall-clock choice. `shiftToIstMinute` is always more than 0 and at most a day, under `MAX_SHIFT_MS` and the cookie's 10-digit pattern. Playwright 1.64.1's `clock.install` keeps time running. The outside branch now asserts the exact hours sentence, which is a check that can fail. The sentence matches `en.json` (`calling.plan.refusal.outside_calling_hours`).
- **Copy:** no strings were added. What a caller sees outside the hours is plain and final under §11.
- **No change to schema, policies, definers, commands, queries, permissions, events or documents.** The security suite, `EXPLAIN`, `db:docs` and `machines:docs` do not apply. No screenshot baseline changed.
- **Run here through `heavy.sh`:**
  - the web unit tests `call-bar`, `e2e/support/clock`, `test-clock` and `screens/calling`: 4 files, 28 passed;
  - the domain `src/telecom` tests: 4 files, 70 passed;
  - eslint on `apps/web/src/components/calling`, `apps/web/e2e/support`, `click-to-dial.spec.ts` and `packages/domain/src/telecom`: clean;
  - `pnpm --filter web typecheck`: exit 0.

**Not checked:**
- **The journeys:** none was run. This session cannot sign in. That covers all four tests of `click-to-dial.spec.ts`: the dialled call kept across leads (T3 re-check 12), the profile phone refusal, the C call with its recording and the `call-bar-ended` picture, and the outside-hours branch. It covers all three projects. The specs were read only.
- **The Linux baselines:** the `call-bar-ended` pictures on moved clocks were not compared in the Playwright image. The lead's `e2e:snap` does this.
- **Other checks:** `pnpm build`, `js-budget` and the whole-repository lint were not re-run here. The builder reports them green.
- **CI:** #284's CI logs and artifacts were not read: this session has no network beyond the push.

## Integration
