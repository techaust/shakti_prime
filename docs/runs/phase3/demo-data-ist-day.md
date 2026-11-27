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

### 27-11-2026, builder in the lead's cloud VM (worktree `demo-data-ist-day`, Postgres 54333)
**Cause: the database's age, not the hour.** The case fails once the shared database holds about 194 active items that sort by name before the demo pump. It does not depend on the time of day. Reproduced outside the window: the whole `pnpm test:security` run five times in a row from 14:24 UTC on this slot's database. The first four runs passed `demo-data.test.ts`. The fifth (15:17 to 15:31 UTC, 20:47 to 21:01 IST, before midnight in India) failed it:
```
FAIL  tests/demo-data.test.ts > the demo data loader > puts the items, kits and prices, the customers and one account per role in place
AssertionError: expected undefined to be '31000.00' // Object.is equality
 ❯ tests/demo-data.test.ts:175:53
```
This is the same assertion I1's review recorded on an aged database (`phase2/i1-ingest.md`). Each whole suite run leaves 39 more active items (55, 94, 133, 172, then 211 after the fifth run; all 211 sort before `Submersible pump 3 HP (demo)`). `pricedOn()` read only the first 200 rows of `listPrices` (items by name), so the demo pump fell off the first page while the kit (`listKitPrices`, 10 kits) stayed on it. The loader itself pages (`listedPrices()`), so it priced the pump. Only the test missed it. H1's builder passed at 18:0x UTC and failed at later runs on a database those runs had aged, which is why the failure looked tied to the clock.

**Fix (test only):** `apps/web/tests/demo-data.test.ts` `pricedOn()` now reads every page of the list's item and kit prices with the cursor, as the loader does (commit 699a5817). No production code changed: the date reads checked below are all by the day in India.

**Brief item 1, which side reads the date:**
- The loader dates its lists with `istCalendarDate(new Date())`.
- `listPriceLists()` takes a list's state from `istCalendarDate(now)`.
- `pricing.list.create`, `.approve` and `pricing.price.set` compare with `istCalendarDate(ctx.now)`, and `ctx.now` is the process clock (`run-command.ts`).
- No migration or domain query reads `current_date`, `now()::date` or `localtimestamp` for price lists. The SQL reads the day through `at time zone 'Asia/Kolkata'` (orders, voice sessions, inbound calls).
- Nothing reads a price list "in force" by the UTC date, so no production fix was due.

**Brief item 2, the UTC-date pattern in price-list and quote tests** (`toISOString().slice(0, 10)` or `current_date`):
- `packages/domain/tests/commands/price-lists.test.ts:28-30`: today by `istCalendarDate()`, later days counted from its midnight. Correct at every hour.
- `packages/domain/tests/commands/tax.test.ts:77-79` and `apps/web/tests/actions.test.ts:808-810`: days in random years 3000 to 8000. No clock read.
- `packages/domain/tests/queries/shadow-report.test.ts:54` and `shadow-pack.test.ts:562`: the IST date (`now + 330 minutes`). `shadow-pack.test.ts:47-48`: a fixed period in 2011 to 2017, read at `+05:30`. Correct.
- `apps/web/e2e/setup/copilot.ts:37` and `e2e/orders.spec.ts:33`: IST dates. Correct.
- `packages/db/tests/security/imports.test.ts:417`: `dealer_outstanding.as_of = current_date` (UTC). This is a dealer's balance, not a price or a quote, and the case asserts nothing about the date. It cannot fail by the hour.
- Quote tests set `valid_until` as instants (`now() - interval '1 minute'`, `Date.now() ± …`). No day boundary.
- Not tests, not price lists: `apps/web/src/workers/lead-anonymise.ts:67` and `company-batches.ts:72` name a night's run by its UTC date. That name is only an id kept the same across one run's hand-overs. Not a fault.
- None of these needed a change.

**Brief item 3, proof by the clock:**
- **Process clock.** I ran the file with `vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })` and `vi.setSystemTime()`. A temporary first case asserted the clock and printed it (`2026-11-27T18:00:00Z` = 23:30 IST, and `2026-11-27T19:00:00Z` = 00:30 IST on 28-11). Each run: 10 of 10 passed (the 9 cases and the clock check). The edit was not committed. In the 00:30 IST run, the database's clock was 21:1x IST on the 27th, so the process's day in India was a day ahead of the database's.
- **Database clock.** No price-list read takes its date from the database. The only database times in the file are `approved_at`, written from `ctx.now`, and `archived_at = now()` in `afterAll`, and neither is compared with a date. The whole web security suite was also run inside the window (below).

**Checks** (all through `tools/integration/heavy.sh`, on Postgres 54333):
- Five whole `pnpm test:security` runs before the fix. Each: db 60 files, 1,532 passed; domain 100 files, 1,415 passed. Web: 461 of 461 in runs 1, 3 and 4. Run 2: 460 of 461, failing `outbox-route.test.ts`, see below. Run 5: 460 of 461, failing `demo-data.test.ts:175`, quoted above.
- After the fix, on the database with 211 active items: `tests/demo-data.test.ts` alone, 9 of 9 passed.
- `pnpm --filter web typecheck`: clean.
- `pnpm exec eslint apps/web/tests --max-warnings 0`: clean.
- Whole-repository `pnpm lint`: exit 0.

**Also seen, not this slice's, not changed:**
1. Run order of the suites. Run alone first on a fresh database, `demo-data.test.ts` makes the shared Retail, Dealer and Commercial lists as version 1. The db suite's `catalogueFixture()` (`packages/db/src/testing/catalogue-fixture.ts:75`) then stops on `price_lists_tier_entity_version_unique`, because it inserts its own shared Retail list as version 1 and deletes only its own ids. CI runs the db suite first, so CI never meets it. Here I moved the three archived lists to versions 1001 by hand on this slot's database, rather than ask for a fresh one. A fix belongs to the fixture (a version clear of the commands' series, or deleting by series).
2. `outbox-route.test.ts` › "runs the publisher for a call signed with the current key" failed once (run 2, `expected 0 to be greater than or equal to 1`). The publisher claimed 100 other rows of the aged database, so this case's own row was not among them. It passed in runs 1, 3, 4 and 5. This is the aged-database kind, not the hour.
