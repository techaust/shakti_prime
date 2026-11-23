# Alert counts after midnight: a date-dependent security test

| | |
|---|---|
| Branch | `fix/alert-counts-midnight` on GitHub, from `main` |
| Runs on | a seat session (taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): one test |
| Usage | builder on Opus 5.5 at high effort |
| State | briefed |
| Next step | the builder's report |

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
