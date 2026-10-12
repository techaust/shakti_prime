# Tooling and test-stability follow-ups (wave 6, beside M1)

| | |
|---|---|
| Branch | `fix/followups-tooling`, from `main` at 23f78a5 (#166) |
| PC worktree | cloud day: `/home/user/shakti-wt/followups-tooling`, slot 3: Postgres 54333 (container `shakti-pg-followups-tooling`), app 3033 |
| Runs on | cloud, beside M1 and the database follow-ups (owner, 12-10-2026: all pending Phase 0–1 work at once), heavy commands through the VM's lock |
| Tier | B (tooling and tests, no schema): build Opus 5.5 medium, review Opus 5.5 high |
| Usage | no reading posted at the start; the owner said to proceed (12-10-2026) |
| State | built; report written (12-10-2026) |
| Next step | lead: review, then the Linux baselines listed in the report |

## Brief
Open follow-ups from [STATUS](../../10-status.md#open-follow-ups) on the scripts and on tests that fail by order or time. No migration, no product behaviour change.

1. **`tools/integration/heavy.sh` hands the lock out in order:** a numbered queue (a ticket per waiting command, served lowest first; a ticket whose process is gone is skipped; the 90-minute stale-lock clearing kept). The same command line and exit code for callers; a short test script or a dry run in the report showing three waiters served in order. Update the lines of `docs/runbooks/hybrid.md` §5 and `slice-integration.md` §1 that describe the first-retry behaviour (single targeted lines).
2. **The cloud session hook notices a half-finished pnpm self-install** (`.claude/hooks/cloud-session.sh`, `tools/integration/lib.sh`): when `~/.local/share/pnpm/.tools/pnpm/<v>_tmp_*` holds the placeholder, run that folder's `node install.js` (as hybrid §2 describes) and check turbo starts; the hybrid §2 line updated.
3. **`tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing:** treat "nothing to write" as success and say so.
4. **`converting.spec.ts` onto the test clock** (L1 review #6): its in-hours branch runs only between 09:05 and 20:50 IST; set the server clock with `e2e/support/clock.ts` and run both branches on every run (#145's pattern).
5. **The converting catalogue item seeded where only `converting.spec.ts` reads it** (`apps/web/e2e/converting-fixtures.ts`, `apps/web/e2e/setup/converting.ts`): the catalogue, tax rates and price master screenshots must no longer show "Converting solar module 540 Wp". List the baselines that change for the lead to remake in the Linux image; do not remake them on the host.
6. **`files.spec.ts`'s logo journey:** wait for `/settings/companies` to show its title before axe runs.
7. **The PIN code journey's axe check:** wait for the success toast to finish appearing first.
8. **Order- and time-dependent tests:** `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database (make it independent of an earlier run's customer); `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first (create its own); `reader-parity.test.ts`'s Executive case (about 12 s against a 20 s limit: make it faster if the cause is in the test, else raise the limit with a comment saying why).

Done when: each changed test passes three times in a row, the changed journeys pass twice in a row on the same database, typecheck and lint pass, and `bash -n` passes on every changed script.

Not here: anything M1 builds (`feat/m1-migration-uat`) or the database bundle (`fix/followups-db`: notifications, commission accruals, the Triage shadow report, `app.ensure_audit_partitions()`). Shared lists are append-only. Any script change must keep working for builders already waiting on the lock while it is replaced: the new `heavy.sh` takes effect for commands started after it lands in the main checkout, which the lead does at the merge, so test it from your worktree's copy only.

**How to work:** commit at least every 20 minutes and at each finished item; never push (the lead pushes); never run `docker` or `fresh-db.sh` — when you need a fresh database, commit and stop with a report saying so; long output to log files, reading summaries only; the whole-repository lint once, last. Two other builders share the VM (4 vCPUs, 16 GB) and the heavy-command lock: every lint, typecheck, test, build and journey goes through `bash tools/integration/heavy.sh` (the main checkout's copy, `/home/user/shakti_prime/tools/integration/heavy.sh`). Never open a pull request, install a dependency or touch a hosted service.

## Report

### 12-10-2026, cloud (builder, Opus 5.5), from 9dcebe64
Six commits, c1b3c832 to 122dcb4f. Skills: none of the repository's skills cover this work (no command, table or screen); `add-command` and `add-table` were not needed.

**1. `heavy.sh` serves in order** (`tools/integration/heavy.sh`, new `tools/integration/heavy-queue-test.sh`). Each waiter makes a numbered ticket folder in `~/.shakti-heavy.lock.queue` with `mkdir` (atomic; on a clash it takes the next number), writes its process number into it, and only the lowest live ticket tries for the lock. A ticket whose process is gone (or that has no process number after 60 s) is removed and skipped; the 90-minute stale-lock clearing is kept; the ticket leaves the queue once the lock is held, and an EXIT trap removes ticket and lock on any end (INT and TERM exit 130 and 143). Same command line; the command's exit code is passed through. Checks every 5 s instead of 15 (only the head of the queue tries `mkdir`). A command started by the old `heavy.sh` still takes the lock whenever it is free, so builders waiting while the new script lands keep working. `HEAVY_LOCK` and `HEAVY_POLL` exist only for the test. The test (a holder, a dead ticket ahead of everyone, then three waiters a second apart) ran three times from the worktree's copy: `order: first second third - ok`, `exit code: 7 - ok`, about 11 s each, no lock or ticket left behind. Lines changed: hybrid §5 (the first-retry line now says the order and names the test) and slice-integration §1 (the lock "handed out in the order the commands arrived").

**2. The half-finished pnpm self-install** (`tools/integration/lib.sh` `repair_pnpm_self_install`, `.claude/hooks/cloud-session.sh`). The function finds every `~/.local/share/pnpm/.tools/pnpm/*/node_modules/pnpm` whose `pnpm` file is still pnpm's shebang-less placeholder, runs that folder's `node install.js`, checks the file was replaced, and prints the folders it repaired (status 1 and a line on stderr when one could not be). The hook runs it after the package install and, when it repaired one, checks `pnpm exec turbo run typecheck --filter=@shakti/tokens --force`; both outcomes are one `[cloud-session]` line. Found live on this VM: `12.6.0` and `12.6.0_tmp_214` both held the placeholder and `turbo run typecheck --filter=@shakti/tokens` stopped with "Exec format error (os error 8)"; after `repair_pnpm_self_install` both are the ELF binary and the same task ran ("1 successful"); a second call repairs nothing. This repaired the shared `~/.local/share/pnpm` of the VM, so the other builders' turbo runs work too. Hybrid §2's line now names the function.

**3. `renumber-migrations.mjs`.** I could not make the current script fail: on a disposable clone (`git clone --shared` into the scratch folder, a `pnpm exec` stand-in that runs the package's own bin) a custom-only migration moved from 0130 to 0131 behind a base with one more migration, and drizzle-kit's "No schema changes, nothing to migrate" took the existing branch; drizzle-kit exits 0 there. The change makes the outcome independent of drizzle-kit's exit code: an error whose output says "nothing to migrate" counts as success, any other error still stops the script, the output buffer is raised to 256 MB (drizzle-kit prints every table), and the line now says `drizzle-kit wrote nothing (no schema change in 0131_custom_only): its snapshot is the one before with a fresh id, and that is correct.` Ran on the clone: drizzle-kit exit 0 with nothing written → success; a stand-in that prints "nothing to migrate" and exits 1 → success; a stand-in that fails otherwise → the script stops (exit 1).

**4. `converting.spec.ts` on the test clock.** `inCallingHours()` is gone. After the quote, the server's clock is set outside the hours (`outsideCallingHours()`): D shows the hours sentence and no number; then inside (`insideCallingHours()`): D shows the number, C, the dialog, axe on the dialog, the call saved, two rows left; N then always opens the expiring quote's lead at its Quote tab. The test clock moves only the calling rule's "now" (`dialNumber`, `logCall`); the list and the quote's expiry read the server's own clock, so neither shift changes them. Both branches ran at 00:20 IST (inside shift about 9 hours, outside shift none).

**5. No converting catalogue item.** The converting journey now quotes from the quote journeys' module (`Solar module 540 Wp`, JRN-MOD-540, ₹12,000, 12 % GST) on their tier and company 2 price list (`e2e/setup/quotes.ts`, made earlier in the seed): the same price and rate, so the journey's ₹67,200.00 holds. `e2e/setup/converting.ts` no longer makes a tier, item, GST rate or price list; its customers get the "Journey prices" tier and its seeded quotes and order name that tier and list; `CONVERTING_TIER` is gone and `CONVERTING_ITEM` holds only the option text. A database seeded before this keeps its old converting rows (journey quotes reference them); the baselines are made on a fresh database.
- Baselines the lead remakes in the Linux image, on a fresh database, in all three projects (desktop-light, desktop-dark, phone): `catalogue.spec.ts/catalogue-items.png`, `catalogue-read-only.png`, `tax-rates.png`, `tax-rates-one-company.png` (the converting row goes) and `price-master.spec.ts/price-master-executive.png`, `price-master-read-only.png` (the "Converting prices" list goes, so the list opened first becomes "Journey prices · Shakti Motor Pumps"). `catalogue-kits.png` should not change (the item was in no kit); `converting-board.png` and `converting-quote.png` matched their baselines on this host (the screen shows no tier name). On my database, which the domain suite had filled, every catalogue and price list picture differs because of the suite's items, so the host run proves only that the converting item and list are gone.

**6. `files.spec.ts`.** The logo journey already waited for the title (`journey-fixes`); the second test of that describe ("a PDF on the logo field is refused") ran axe on `/settings/companies` without it, so it now waits for `Companies · ` in the title too.

**7. Toasts before axe** (`e2e/support/axe.ts`). The PIN journey already waited for the "We read 2 rows" notice to go (`journey-fixes`). What was left is the moment a notice is drawn in its hidden state before sonner marks it mounted and starts its fade: the animation wait cannot see a fade that has not started. `expectNoAxeViolations` now waits until no `[data-sonner-toast][data-mounted="false"]` is on the page, then for every running animation as before, so every axe check (the PIN journey's included) sees a notice fully in.

**8. Order- and time-dependent tests.**
- `import-kinds.test.ts` "adds the different site of a repeated row": the customer's name was always "Two Sites", so an earlier run's customer in Sikar was suggested by name and village (`existingByNameAndVillage`) and the dedupe lines no longer matched. The name now carries a suffix from the run's own number (letters, e.g. `Two Sites bcadfe`).
- `enum-sync.test.ts` "a site point is on the globe": it inserted a site for `accounts limit 1`, which inserts nothing (and passes no check) when no other file has made an account. It now makes its own principal and account and inserts the site for that.
- `reader-parity.test.ts`: the cause is in the test: each caller ran about a hundred queries on the reader pool and then on `app_user`, one after the other. The two pools are now asked at once (`Promise.all`), so a caller takes the time of one pool's reads. On a database the domain suite had filled: Executive of 1 to 4 from 2,323 ms to 1,563 ms (and 2,066 ms on a fresh one before the change); I could not reproduce 12 s on this VM, so the 20 s limit is unchanged.

**Checks** (every one through the main checkout's lock):
- `bash -n` on `heavy.sh`, `heavy-queue-test.sh`, `lib.sh`, `cloud-session.sh`; `node --check` on `renumber-migrations.mjs`: clean.
- Domain security suite, whole, once on this database before item 8's edits: `Test Files 72 passed (72)`, `Tests 932 passed (932)`.
- The changed test files three times in a row on the same, used database: `import-kinds` and `reader-parity` together `Tests 30 passed (30)` ×3; `enum-sync` `Tests 4 passed (4)` ×3.
- Typecheck `@shakti/domain`, `@shakti/db`, `web`: clean. `eslint tools/integration`, `packages/domain/tests packages/db/tests apps/web/e2e` with `--max-warnings 0`: clean. Final whole-repository `pnpm lint`: exit 0. `vitest run e2e/support` (web): `Tests 8 passed (8)`.
- `pnpm build`, then twice on the same database `e2e:seed` and `playwright test e2e/converting.spec.ts e2e/files.spec.ts e2e/imports.spec.ts`: both runs 37 passed, 3 failed, no flaky; every converting, files and PIN journey passed in the three projects both times (converting's screenshots matched). The 3 failures are `imports.spec.ts` "uploads a spreadsheet of leads" in each project, a screenshot only: `imports-job` shows a "Saved column layout" box because the domain suite had saved import layouts for company 1 on this database. Not caused here; a fresh database (the integration's) does not have them.
- No security suite run for the db or web workspaces beyond `enum-sync`: nothing else changed there.

**Not done or uncertain:**
- The original failure of item 3 was not reproduced; the change guards the one path it could be (drizzle-kit exiting non-zero after "nothing to migrate") and says so plainly.
- The new `heavy.sh` takes effect once it is in the main checkout; until every builder started under the old one has finished, an old-script waiter can still take the lock ahead of the queue's head when it finds it free.
- `docs/10-status.md`'s follow-up lines for these items are left for the end of the day.

**Decisions the brief did not settle:**
1. Item 5 by reuse, not by a new seed place: the quote journeys' module has the same price and rate, so the converting journey needs no catalogue item of its own and nothing new shows anywhere.
2. Item 7 in the shared axe helper rather than in the PIN journey alone, since any toast can be caught before its fade starts.
3. Item 6 also covered the describe's second test, which had the same gap.
4. The queue checks every 5 s (was 15) so the next ticket starts sooner; only the head of the queue touches the lock.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Screenshot baselines that lose the converting item are remade in the Linux image at the integration.
