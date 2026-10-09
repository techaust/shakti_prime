# Journey fixes and home-page screenshots (wave 5, fixes)

| | |
|---|---|
| Branch | `claude/vibrant-cori-5kst85`, from `main` at 2e4ad05a (#144) |
| PC worktree | cloud day: `/home/user/shakti-wt/fixes`, slot 1: Postgres 54331 (container `shakti-pg-fixes`), app 3031 |
| Runs on | cloud, beside L1 and A1 (owner, 09-10-2026), heavy commands through the VM's lock (`bash tools/integration/heavy.sh <command>`) |
| Tier | C (tests and seeds): build Sonnet 5.5 high; the lead reads the diff |
| State | building |
| Next step | build |

## Brief
Read first: STATUS's open follow-ups (the rows on `calling.spec.ts` across 21:00 IST, the Customers consent and task timeouts, the home pages' and the notification centre's screenshots, the journeys not repeatable on a used database), [TESTING §5](../../09-testing.md#5-end-to-end-and-later-layers), [slice-integration §10](../../runbooks/slice-integration.md#10-lessons), `apps/web/e2e/support`, `apps/web/playwright.config.ts`, `apps/web/e2e/setup`.

1. **Calling hours across 21:00 IST** (`apps/web/e2e/calling.spec.ts`): the journey chooses its branch from Node's clock while the server enforces TRAI hours from its own. Give the server's calling-hours check a test clock that is honoured only on a local runtime (`BOS_ENVIRONMENT=local` with a localhost `BETTER_AUTH_URL`, the rule `productionConfigProblems()` uses) and ignored and refused on any hosted runtime (a unit test proves both), for example a cookie or header the journeys set; then run both branches every time (inside hours and outside) instead of choosing by the wall clock. No change to the TRAI rule itself.
2. **Customers "records a consent with its proof" and "adds a task"** (`customers.spec.ts`) time out under load (the consent dialog does not open within 45 s; pass alone). Find the cause (hydration before the click, the file check holding the page, a server action queued behind another journey) from a trace, and fix the cause; a longer time limit alone is not a fix.
3. **Repeatable on a used database:** a run leaves the shared Executive's selected company on another company and the pipelines journey's stages behind, so a second run fails elsewhere. Reset that state in the journeys' set-up (`apps/web/e2e/setup`, `auth.setup.ts`) through the app's own commands or the seed, never by raw SQL from a spec.
4. **Seeded figures and screenshots:** the tele-caller's, the GM's and the Executive's home pages, Targets, and the notification centre show figures other journeys make. Give each its own seeded rows on clearly synthetic people of a company no other journey writes to (the R1 journey seed is the pattern; fix its midnight-IST straddle, R1 review #11, by seeding relative to the IST day at run time), then add their `snap()` screenshots in `targets.spec.ts` and `notifications.spec.ts`. Linux baselines are made by the lead with `e2e:snap`, not by you; record the names in the Integration notes.
5. Also, if small: `files.spec.ts`'s logo journey waits for the page title before axe; the PIN code journey waits for the toast before axe.

Done when: typecheck, the folders' lint, `pnpm test` for web, and the journeys `calling`, `customers`, `targets`, `notifications`, `pipelines`, `files` pass twice in a row on the same database (through the lock); the STATUS rows these close are listed in the report.

Not here: product behaviour, copy beyond any new test-only strings, migrations. L1 (`feat/l1-converting`) and A1 (`feat/a1-triage`) are built at the same time; do not edit `/converting`, `packages/domain/src/ai`, or the agent tables.

**How to work:** commit at least every 20 minutes; never push (the lead pushes); never run `docker` or `fresh-db.sh`; long output to log files; the whole-repository lint once, last, through the lock. Never open a pull request, install a dependency or touch a hosted service.

## Report

## Integration notes
