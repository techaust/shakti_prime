# Demo data after midnight in India: a date-dependent web test

| | |
|---|---|
| Branch | `fix/demo-data-ist-day` on GitHub, from `main` |
| Runs on | a seat session (taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): a test, or the code under it if the code is wrong |
| Usage | builder on Opus 5.5 at high effort |
| State | briefed |
| Next step | the builder's report |

## Brief
`apps/web/tests/demo-data.test.ts` fails in the web security suite between 18:30 and 24:00 UTC (00:00 to 05:30 in India), as H1's builder recorded twice on 23-11-2026: the demo data's price lists take effect "today in India", which is still tomorrow's date in UTC in that window, and something reads them by the UTC date. The alert-counts case had the same kind of fault (#282).

1. Find which side is wrong: the demo-data loader (`apps/web/src/...demo...`, find it from the test) choosing the date, a query that reads a price list "in force today" by the UTC date instead of the day in India, or the test's own expectation. Prices in force are a business rule (the day in India, as quotes' validity is), so if production code reads by UTC, fix the code, with a unit test at 23:30 IST and 00:30 IST; if only the test is wrong, fix the test.
2. Search the other price-list and quote tests for the same pattern (a date built with `toISOString().slice(0, 10)` or `current_date` compared with a day in India) and list each in the report; fix only those that can fail at some time of day.
3. Prove it: run the file with the process clock set to 23:30 and 00:30 IST (`vi.setSystemTime`) where the case reads the clock in JavaScript, and say how the database side is covered.

Files owned: `apps/web/tests/demo-data.test.ts`, the demo-data loader, and any price-list query item 1 finds reading by the UTC date, with their tests.

Do not touch: migrations that do not need to change, config files, Phase 3 slices.

## How this slice runs
- **Your role:** builder, not the lead; follow `.claude/agents/slice-builder.md` (its Cloud lines) with this brief. Never run the start-session or end-session skills, open or merge a pull request, push to `main`, delete a branch or force-push.
- **Branch:** `git fetch origin && git switch fix/demo-data-ist-day`; start every shell command with `. tools/integration/lib.sh &&`.
- **Checks:** `pnpm --filter web test:security` (and the db or domain suite if you touch them), `pnpm typecheck`, `pnpm exec eslint --max-warnings 0` on each folder touched, the unit tests of each package touched.
- **Reporting:** write the report in this file's Report section, commit `report: demo-data-ist-day done` (or `blocked`) and push.

## Report
Lead, 24-11-2026, on the PC (seat 2 left no commit in three hours): not reproduced. With the test process's clock at 00:30 IST on 25-11 (`vi.useFakeTimers({ toFake: ['Date'] })`, the database's clock at 06:00 IST on 24-11), `demo-data.test.ts` passed 9 of 9 three times on a fresh database and on the same database aged by the runs before. The loader dates its price lists by `istCalendarDate()`, `listPriceLists()` and the price-list commands read the day in India, and no migration or domain query reads `current_date`; the failure H1's builder saw in the whole web suite after 18:30 UTC is not explained by the loader alone. Next step: run the whole web security suite inside the window (after 18:30 UTC) and keep the failing assertion's text, then fix what it names.
