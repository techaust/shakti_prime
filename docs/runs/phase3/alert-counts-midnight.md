# Alert counts after midnight: a date-dependent security test

| | |
|---|---|
| Branch | `fix/alert-counts-midnight` on GitHub, from `main` |
| Runs on | a seat session (taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): one test |
| Usage | builder on Opus 5.5 at high effort; started and ended on seat 2 on Opus 5.5 at high effort (23-11-2026) |
| State | merged (#282) |
| Next step | none |

## Brief
`packages/db/tests/security/alert-counts.test.ts` › "counts failed and waiting rows, caps and voice use, and answers no payload, number or name" fails in the first 40 minutes after midnight in India: it makes an ended voice session started 40 minutes ago and an open one started 4 minutes 30 seconds ago, and `app.alert_counts()` counts only sessions started on the current day in India (`app.voice_day_start(now())`), so near midnight the sessions fall on the previous day and the person's 25 minutes are missing (seen on the PC at 00:10 IST on 24-11-2026). The function is right; the test is not.

1. Make the case pass at every time of day: start both sessions at or after `app.voice_day_start(now())` (for example `greatest(now() - interval '40 minutes', app.voice_day_start(now()))`, with `ended_at` kept at or after `started_at` as `voice_sessions_ended_check` requires), and compare the open session's minutes with what the function computes from the same clock: read `app.alert_counts()` and the open session's `ceil(extract(epoch from now() - started_at) / 60)` in one statement, so both use the same `now()`, and expect `20 + least(10, that)` minutes and ₹120.
2. Look through the other security and domain tests for the same pattern (a fixed interval before `now()` compared with a day boundary in India, `voice_day_start`, `ist_day`, `date_trunc('day', … 'Asia/Kolkata')`) and list each one you find in the report; fix only those that can fail at some time of day, one commit each.
3. Prove it: run the case with the database's clock moved, by wrapping the call in a transaction that sets nothing but runs at a time you choose is not possible, so instead show the arithmetic on two cases in a unit check of your own inside the test file: a day start 5 minutes ago and one 3 hours ago (computed from `now()` in SQL with the `greatest()` form), both giving the expected total.

Files owned: `packages/db/tests/security/alert-counts.test.ts` and any test file item 2 finds.

Do not touch: migrations, functions, config files, anything outside tests.

## How this slice runs
- **Your role:** builder, not the lead; follow `.claude/agents/slice-builder.md` (its Cloud lines) with this brief. Never run the start-session or end-session skills, open or merge a pull request, push to `main`, delete a branch or force-push.
- **Branch:** `git fetch origin && git switch fix/alert-counts-midnight`; start every shell command with `. tools/integration/lib.sh &&`.
- **Checks:** `pnpm --filter @shakti/db test:security` (and the domain suite if item 2 touched it), `pnpm typecheck`, `pnpm exec eslint --max-warnings 0 packages/db/tests` (and any folder touched).
- **Reporting:** write the report in this file's Report section, commit `report: alert-counts-midnight done` (or `blocked`) and push.

## Report

### 23-11-2026, cloud session (seat 2)
One test file changed: `packages/db/tests/security/alert-counts.test.ts`, in one commit (72fa2d2d). No migration, function, config or other file changed. Skills loaded: none; the brief names none.

**1. The case passes at every time of day**
- The ended session now starts at `greatest(now() - interval '40 minutes', app.voice_day_start(now()))` and ends at `greatest(now() - interval '20 minutes', app.voice_day_start(now()))`, which is never before its start, as `voice_sessions_ended_check` requires.
- The open session starts at `greatest(now() - interval '4 minutes 30 seconds', app.voice_day_start(now()))`.
- One statement reads `app.alert_counts()` and the open session's `ceil(extract(epoch from now() - started_at) / 60)`. Everything happens inside the case's one transaction, so every `now()` there is the same instant anyway.
- The case expects `20 + least(10, that)` minutes and ₹120 (12000 paise).

**2. Other tests with the same pattern**
I searched the db, domain and web security tests for `voice_day_start`, `ist_day`, `Asia/Kolkata`, `date_trunc('day'`, `+05:30`, IST offsets, `current_date`, dates sliced from `toISOString()`, and every fixed interval before `now()`. I also listed the database functions and domain code that draw a day line in India: `alert_counts`, `voice_day_start` with the voice session open and record functions, the commission rule date of `0117`, the inbound-call hours of `0196`, `readAgentSpend`, the dial policy and the Concierge's facts. None other needs a change:
- `packages/db/tests/security/voice-sessions.test.ts:181-190`: moves a session back 40 minutes and already allows for midnight. It reads `sameDay` and expects 15 or 0 minutes. Its three statements read the clock separately, so only a run within milliseconds of 00:40 IST could disagree; not changed.
- `packages/db/tests/security/voice-sessions.test.ts:272`: an earlier day's session 36 hours ago, always before today's start in India.
- `packages/db/tests/security/voice-sessions.test.ts:223` and `packages/domain/tests/commands/voice-sessions.test.ts:201` and `:267`: sessions moved back 1 hour, 3 minutes and 16 minutes. They check a session's own length or liveness, not the day's use.
- `packages/domain/tests/commands/copilot-runs.test.ts:584` and `:1224`: a brief 2 hours old. "Recent" is a rolling window (`briefedRecently`, in minutes), not a calendar day.
- `packages/db/tests/security/inbound-calls.test.ts:52`, `packages/domain/tests/commands/inbound-calls.test.ts`, `dial-rules.test.ts`, `click-to-dial.test.ts` and `calls.test.ts`: fixed times on yesterday's date in India or fixed dates, so the same at any hour.
- `alert-counts.test.ts` › "reads the webhooks as Integration Health does": failures 3 hours ago against Integration Health's rolling 24 hours (`0161`), not a day.
- Tests that take today's date in India in JavaScript and read rows they make at `now()`: `shadow-report.test.ts` (computed once per file), `shadow-pack.test.ts:562`, `concierge-runs.test.ts`, `ask.test.ts`, `knowledge-audio.test.ts` and `price-lists.test.ts`. Their date and their rows share one moment, so they fail only on a run that crosses midnight in India while it is running (seconds), not at a time of day; not changed. `shadow-report.test.ts` is the widest, since its date is fixed when the file loads.
- `imports.test.ts:417` (`current_date` for an outstanding) and `tax.test.ts` (far-off years): no day comparison.

**3. The arithmetic**
- A new case, "counts the case's sessions in full whenever the day in India began", runs three ways. It takes the case's start times with the day start set to `now() - 5 minutes`, `now() - 3 hours` and `now() - 2 minutes` in place of `app.voice_day_start(now())`. It then sums them as `app.alert_counts()` does, over the sessions started on or after that day start.
- It expects both sessions on the day, the ended one ending after it starts, and the function's total equal to the case's `20 + least(10, open minutes)`: 25, 25, and 22 where the day began after the open session.
- With the old start times and a day start 5 minutes ago, the same sum gives 5 (the ended session falls on the day before), not 25.

**Checks in the VM**
- `pnpm --filter @shakti/db test:security`: 60 files, 1532 passed.
- `alert-counts.test.ts`: 8 passed.
- `pnpm typecheck`: 10 of 10 tasks successful.
- `pnpm exec eslint --max-warnings 0 packages/db/tests`: clean.
- The domain suite was not run, since item 2 changed no domain test.

**Found while running, not changed (outside this brief)**
This VM's one database also served the previous slice's web suite and journeys, which left two rows that broke the db suite before any case ran. I put both aside on the local database only:
- An archived retail price list of version 1 for the group, made by a web case at 18:38 UTC, clashed with `catalogueFixture()`'s `price_lists_tier_entity_version_unique`. Its `price_change_log` rows are append-only, so instead of deleting it I moved its version to 2.
- The journeys' seed (`e2e:seed`, id `0199e2e0-…-a002`) writes a Co-pilot cap for company 3, and this case inserts the same one (`agent_configs_scope_unique`). I deleted it; the next seed writes it again.

Neither clash happens in CI, where each suite has its own database. On a cloud VM that runs the journeys and then the db suite, the second clash will recur. The fix is either a cap scope the journeys' seed does not use in this case, or the case taking any existing cap into account; that is the lead's call.

**Assumptions**
- The arithmetic check runs as its own case beside the case it checks, on the database's `now()`, rather than inside the rolled-back transaction. It writes nothing.
- I added a third day start, 2 minutes ago, to the brief's two, because it is the one where the open session is cut short and the `least()` matters.


## Integration
24-11-2026, the lead on the PC: reviewed (sound; no finding), `main` already in the branch. `integrate.sh` with `install format typecheck security dbverify gitleaks` passed (security 00:32 to 00:50 IST, so the case ran inside the first 40 minutes after midnight in India, where the old case failed); `eslint --max-warnings 0` on the test file clean. The whole-repository lint, the unit tests, the build and the journeys run in CI.
