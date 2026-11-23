# P3 fixes: open follow-ups beside Phase 3

| | |
|---|---|
| Branch | `fix/p3-fixes` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a seat session (a cloud session under another of the owner's accounts, taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): tests and test helpers, one runtime guard |
| Usage | 5-hour window 4 % on the lead's account at 18:30 UTC when briefed; builder on Opus 5.5 at high effort; builder started on seat 2 on Opus 5.5 at high effort (23-11-2026) and ended on the same model and effort; the fix round started on seat 4 on Opus 5.5 at high effort (24-11-2026) and ended on the same model and effort; the second fix round, on seat 4, started and ended on Opus 5.5 at high effort (24-11-2026) |
| State | integrated on the PC; pull request open |
| Next step | merge on green |

## Brief
Four open follow-ups from [STATUS](../../10-status.md#open-follow-ups), one commit each with its test. Read each item's row in STATUS before changing anything; if an item is already fixed on this branch, say so with the evidence and change nothing for it.

1. **`VENDOR_CREDENTIALS` is a fixed list** (`apps/web/scripts/measures/safety.ts`): add a unit test that reads `.env.example` and fails when a variable that holds a vendor secret (a name ending in `_KEY`, `_SECRET`, `_TOKEN` or `_PASSWORD`, or starting with a vendor prefix: `EXOTEL_`, `WHATSAPP_`, `META_`, `GOOGLE_`, `LIVEKIT_`, `SARVAM_`, `ANTHROPIC_`, `VOYAGE_`, `QSTASH_`, `UPSTASH_`, `AWS_`, `SES_`, `SENTRY_`) is neither on the list nor on a short, commented allow-list of non-secret names. Add any variable it finds missing to `VENDOR_CREDENTIALS`.
2. **The axe check on a notice still fading in** (`apps/web/e2e/support/axe.ts`; `channels.spec.ts` failed its contrast check three times on one cloud run): before analysing, wait until no element on the page has a running CSS animation or transition (`document.getAnimations()` empty, at most 2 seconds), then analyse. Run `channels.spec.ts` five times in a row on the VM and record the results.
3. **`duplicate-scan.test.ts` › "searches every live company in turn"** (`apps/web/tests/duplicate-scan.test.ts`) ran past its budget on a database grown by a day of runs: make the case independent of rows other tests left (scope its assertions and its scan to the companies and leads it made itself), and give it its own timeout in the test, not in a config file.
4. **The runtime QStash client** (`apps/web/src/workers/qstash.ts`): confirm that a blank `QSTASH_URL` falls back as `qstash-schedule` does since #236, with a unit test for blank, absent and set; change code only if the test fails.

Files owned: `apps/web/scripts/measures/safety.ts` and its test, `apps/web/e2e/support/axe.ts`, `apps/web/tests/duplicate-scan.test.ts`, `apps/web/src/workers/qstash.ts` and its test.

Do not touch: anything under `inventory`, `procurement`, `catalogue` or `items` (Phase 3's slices), any vitest, Playwright or ESLint config, `package.json` scripts, `.github/`.

Review checklist (check before your report): each fix has a test that failed before it (or the evidence that it was already fixed); the axe wait cannot hang a journey; no config file changed.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `git fetch origin && git switch fix/p3-fixes`, and work in the checkout itself; the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes.
- **Your checks, in the VM, before your report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm --filter web test -- tests/duplicate-scan.test.ts` against the local Postgres; `pnpm build`; the journeys `channels.spec.ts` (five runs) and two other specs with axe checks (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <specs>`).
- **Reporting:** write your report into this file's Report section (a heading with the date and "cloud session"), commit it with the subject `report: p3-fixes <stage>` and push. The stages are `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped.
- **Questions:** for a minor gap take the reasonable call and record it under "Assumptions"; only when no reasonable call exists, push `report: p3-fixes blocked` with the question.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line.

## Report

### 23-11-2026, cloud session (seat 2)
All four items are done, one commit each with its test, on `fix/p3-fixes`. No config file, `package.json` script, package or lockfile changed. No file of a Phase 3 slice was touched. Skills loaded: none; the brief names none, and the slice adds no command or table.

**1. `VENDOR_CREDENTIALS` against `.env.example`** (05bf702a; formatting 4eff3105)
- `apps/web/scripts/measures/safety.ts` adds `KEPT_LOOKALIKES`. It lists the names that look like a vendor's secret and that the measures keep on purpose, grouped and commented by reason: the local database's role passwords, the app's own keys, Turnstile (sign-in needs it), the phrases `MEASURE_SERVER_ENV` gives the measuring server, and settings with no secret.
- `safety.test.ts` adds 4 cases (8 in the file):
  - every variable of `.env.example`, set or commented out, that ends in `_KEY`, `_SECRET`, `_TOKEN` or `_PASSWORD`, or starts with one of the 13 vendor prefixes, is on one of the two lists;
  - the check reports a made-up vendor key, a commented one and a secret of any name;
  - no name is on both lists, and every kept name is in `.env.example`;
  - every kept phrase is one `JOURNEY_SERVER_ENV` or `TEST_WEBHOOK_ENV` gives the server.
- Without the new list the check flags 31 variables (the commit message says 36, a miscount, left since the commit is pushed). None of them lets a measure reach a vendor, so nothing was missing from `VENDOR_CREDENTIALS`.

**2. The axe wait** (9d9186c5)
- `apps/web/e2e/support/axe.ts` swaps the one look at `document.getAnimations()` for `waitUntilStill`, run in the page. It waits until no animation or transition that ends has run for 3 frames in a row, or 2 seconds pass, then axe runs either way. A notice starts its fade a frame or two after it is marked mounted, which a single look misses.
- It moves on after 50 ms where the page draws no frames, so it cannot hang a journey.
- `e2e/support/axe.test.ts` has 6 cases on a stand-in page with fake time: a still page, a fade that starts after the first look, a pending transition, spinners, paused animations and held last frames left out, the 2-second limit, and a page that draws no frames.
- `channels.spec.ts` five times in a row on the VM, seeded before each run: 21 passed and 2 skipped every time (24.2 s, 25.0 s, 24.6 s, 25.2 s, 25.0 s). The skips are the spec's own `desktop-light`-only cases.

**3. `duplicate-scan.test.ts` › "searches every live company in turn"** (2215a5c9)
- The case makes two customers sharing a number in each live company. It then starts each company's search right after an id minted when the case began, through a stand-in `executeCommand` that sets `afterId` on `crm.duplicate.scan` only. The command, its definer, the signature check and the walk through the companies stay real.
- It checks `done`, at least one batch and one find per live company, no hand-over, and each company's own card (`customer`, `phone`, that company).
- It keeps its own 60-second limit in the test. Test files run one at a time, so no other file's rows fall after the marker.
- Evidence on the local database grown with planted customers (removed afterwards):

  | Customers | Old case | New case |
  |---|---|---|
  | 16 | not timed | 0.4 s |
  | 20,000 | 7.0 s | 1.1 s |
  | 140,000 | 8.7 s | 0.5 s |

- The old case's time grows with the database; the new one's does not. I did not reproduce the cloud VM's 42 s, whose database held real leads and pairs.

**4. The runtime QStash client** (0ac46878)
- The confirming test failed, so the code changed. Given no `baseUrl`, `@upstash/qstash` 2.12.2 reads `QSTASH_URL` from the process itself and takes a blank value as its address, so every publish failed with "Invalid URL". `qstashConfig` dropped the blank value, but the client then read it from the process anyway.
- `qstash.ts` now trims `QSTASH_URL` and always gives the client an address: the regional one when set, else `QSTASH_DEFAULT_URL` (`https://qstash.upstash.io`, the library's own default).
- `qstash.test.ts` adds 5 cases: absent, blank and spaces-only give QStash's own address; a set one is used trimmed; and the real client, with a blank `QSTASH_URL` in the process and `fetch` stubbed, calls `https://qstash.upstash.io/v2/publish/…`. All 5 failed against the old client, the last with "Invalid URL".
- `qstash-schedule.ts` is unchanged; its own `unsetBlankQStashUrl` still works.

**Checks in the VM**
- `pnpm typecheck`: exit 0.
- Whole-repository `pnpm lint`: exit 0.
- `eslint --max-warnings 0` on `apps/web/scripts/measures`, `apps/web/src/workers`, `apps/web/tests` and `apps/web/e2e/support`: clean.
- `pnpm --filter web test`: 164 files, 1221 passed, 1 skipped.
- `tests/duplicate-scan.test.ts` against the local Postgres (security config; the brief's `pnpm --filter web test -- tests/…` uses the unit config, which does not include `tests/`): 10 passed.
- `pnpm build`: exit 0 (built before the axe commit, which is outside the app).
- `channels.spec.ts` × 5: as in item 2.
- `notifications.spec.ts` and `customers.spec.ts`: 51 passed, 2 skipped, 12 failed. All 12 are `toHaveScreenshot` on three cases in each of the three projects (`notification-settings`, `notification-centre`, `customers-list`, `customer-sizing`). The same 12 fail with the previous `axe.ts`, so they come from the VM's Chromium beside the Linux image's baselines and this database, which is not fresh. Every axe and functional assertion passed.

**Unfinished or uncertain**
- `pnpm --filter web test:security`: 38 of 39 files passed (459 of 460 cases). `jobs-check.test.ts` › "reads every job as the worker principal…" fails the same way with the previous `qstash.ts`. This VM's database records no pg_cron run (`cron.job_run_details` is empty), and the case expects the migrations' recorded run of the outbox purge. It looks like a VM database matter; the lead may want to check it on a fresh database.
- No list or search was added, so there is no `EXPLAIN (ANALYZE)` evidence.

**Assumptions**
- The brief asks for "a short, commented allow-list of non-secret names". Some kept names are secrets that only check what reaches the server (webhook and button phrases, LiveKit's key and secret), and the measures must keep them: the measuring server is given its own phrases after the merge, and the load measure signs deliveries with them, so taking them off would break the webhook measure. The list says why for each group, and a test ties those phrases to `MEASURE_SERVER_ENV`.
- The axe wait leaves out animations that never end (spinners) instead of waiting for `getAnimations()` to be empty, which a page with a spinner never is. Paused animations and finished ones holding their last frame are left out too.
- The duplicate-scan case keeps the route's `'{}'` body and the real walk through the companies, and moves only where each company's search starts. The brief's "companies it made itself" is met by the customers it makes in each live company: making companies would change what every other suite and journey sees.

### 24-11-2026, cloud session (seat 4), fix round
The three Review findings the lead marked are fixed, one commit each with its test, on `fix/p3-fixes`. Only `apps/web/tests/duplicate-scan.test.ts`, `apps/web/tests/jobs-check.test.ts` (added to the owned files by the lead), `apps/web/e2e/support/axe.ts` and its test changed. No config file, `package.json` script, package, lockfile or Phase 3 slice file changed. Skills loaded: none.

**1. The duplicate-scan number** (3ee6e9a4)
- `unusedPhone()` gives each pair `+9193` and 8 digits from `randomInt(100_000_000)`, drawn again while any contact holds the number (at most 20 draws, then it throws). The run-derived digits and the per-run counter are gone, so no earlier run's customer can share a pair's number.
- New case "gives each pair a number no contact holds, drawing again when one is taken": it makes a pair, offers `unusedPhone` that pair's number first, and checks it is refused and the second draw is taken.
- `tests/duplicate-scan.test.ts` with the security config: 11 passed (10 before, plus the new case).

**2. `jobs-check.test.ts` on a fresh database** (144de0aa)
- The case runs `call app.purge_outbox_events()` through `asMigrator` before its first check, as `retention.test.ts` does. Its comment now says that no migration runs the purge and that pg_cron runs nothing in the test database.
- Proof, the file alone (`vitest run --config vitest.security.config.ts tests/jobs-check.test.ts`), each time on a fresh database (`fresh-db.sh shakti-postgres 54322`, then `pnpm db:migrate` and `pnpm db:seed`):

  | Database | `jobs-check.test.ts` |
  |---|---|
  | fresh, without the fix | 1 failed, 9 passed ("reads every job as the worker principal…") |
  | another fresh one, with the fix, run twice | 10 passed, 10 passed |

**3. The axe wait's `'moving'` answer** (e783c64b)
- `expectNoAxeViolations` keeps `waitUntilStill`'s answer and passes it to the new `violationsMessage()`. On `'moving'` the failure message adds "the page was still moving after 2000 ms, so a colour may have been measured mid-fade". On `'still'` it is unchanged.
- `axe.test.ts` adds 1 case for both answers (7 in the file).

**Checks in the VM**
- `pnpm --filter web typecheck`: exit 0.
- `eslint --max-warnings 0` on `apps/web/tests` and `apps/web/e2e/support`: clean.
- Whole-repository `pnpm lint`: exit 0.
- `pnpm --filter web test`: 164 files, 1222 passed, 1 skipped.
- `pnpm --filter web test:security`, on the fresh database used for item 2: 39 files, 461 passed. The `jobs-check.test.ts` failure in the first round's report is gone.
- `pnpm build`: exit 0.
- `pnpm --filter web e2e:seed`, then `channels.spec.ts` once: 21 passed, 2 skipped (25.3 s), the same as the first round's five runs.

**Assumptions**
- Finding 1: besides the 8 random digits the lead asked for, `unusedPhone` checks the database and draws again, so a collision is impossible rather than unlikely. Test files run one at a time, so nothing can take the number between the check and the insert.
- The axe message is a test failure message, not product copy, so it stays out of `en.json`, as the message before it did.

### 24-11-2026, cloud session (seat 4), second fix round
The two defects found at integration ("Integration (the lead, 24-11-2026, on the PC)") are fixed, one commit each, on `fix/p3-fixes` after the lead's merge of `main` (24fa386c). Only `apps/web/e2e/support/axe.ts`, its test and `apps/web/e2e/channels.spec.ts` changed. No config file, `package.json` script, package, lockfile or Phase 3 slice file changed. Skills loaded: none.

**1. The axe wait covers notices** (a6597723)
- `waitUntilStill` counts a page as moving while any `[data-sonner-toast]` on show is not mounted or not fully opaque (computed `opacity` other than `1`), as well as while an animation runs. It is one loop under the same 2 seconds and 3 still frames, so it still cannot hang a journey. A notice that is leaving (`data-removed="true"`) or hidden behind others (`data-visible="false"`) stays at 0 and is not waited for, per sonner 2.0.8's `styles.css`.
- The separate wait for `data-mounted="false"` in `expectNoAxeViolations` is gone, since the loop covers it.
- `axe.test.ts` adds 3 cases (10 in the file):
  - a notice that sits in the page unmounted, then mounted at opacity 0, then fading, with no animation at any point: the wait ends only once it is opaque;
  - leaving and hidden notices do not hold the wait;
  - a notice that never becomes opaque gives `'moving'` within the limit.
- The first and third cases fail against a6597723's parent `axe.ts` (2 failed, 8 passed).

**2. The spec's clean-up** (8b5b5ef5)
- Root cause: the dialog shows "Loading the numbers." until its list arrives, and `leftOver.count()` does not wait. A count taken before the list showed read 0, so the leftover number was never taken out of use and "Not set" never showed.
- "Take out of use" has no confirm dialog: `channels-dialog.tsx` runs `archive.run` straight from the button. So the brief's "confirm its dialog" has nothing to act on.
- The clean-up now waits until either "Not set" or the "Take out of use" button shows (`expect(notSet.or(leftOver)).toBeVisible()`), clicks the button if it shows, and waits for "Not set".

**Proof on the VM** (fresh database via `fresh-db.sh shakti-postgres 54322` and `pnpm db:migrate`, `pnpm build` of 8b5b5ef5's code, then `pnpm --filter web e2e:seed` before every run)
- `channels.spec.ts` ten times in a row: 21 passed and 2 skipped every time (28.6 s, 28.5 s, 27.9 s, 28.2 s, 27.5 s, 29.7 s, 28.0 s, 28.0 s, 27.8 s, 29.2 s).
- Retry recovery. The first attempt was made to fail just after the number shows "Checked and working" (`if (testInfo.retry === 0) throw …`, added by hand and reverted, the spec checked clean with `git diff`):

  | Clean-up | The retry's numbers load | Result |
  |---|---|---|
  | old (a6597723) | as fast as the VM answers | 1 flaky, 20 passed, 2 skipped: the retry passed, since the list had loaded before the count |
  | new | as fast as the VM answers | 1 flaky, 20 passed, 2 skipped |
  | old (a6597723) | 1.5 s late (the retry's POSTs to `/settings/companies` held by `page.route`) | 1 failed: the retry fails at `expect(sales.getByText('Not set')).toBeVisible()`, element not found, as at integration |
  | new | 1.5 s late | 1 flaky, 16 passed (desktop-light only): the retry takes the number out of use and passes |

**Checks in the VM**
- `pnpm --filter web typecheck`: exit 0.
- `eslint --max-warnings 0` on `apps/web/e2e/support` and `apps/web/e2e/channels.spec.ts`: clean.
- Whole-repository `pnpm lint`: exit 0.
- `pnpm --filter web test`: 1225 passed, 1 skipped.
- `pnpm build`: exit 0.
- `notifications.spec.ts`, after `e2e:seed`: 24 passed, 2 skipped, 6 failed. All 6 (and their retries) are `toHaveScreenshot`, the VM's Chromium against the Linux image's baselines, as in the first round's report. No axe check failed.

**Assumptions**
- The notice wait is folded into `waitUntilStill`'s loop rather than run as a wait of its own before it. It is the same 2 seconds the brief asks for, and a notice that starts fading between the two waits cannot slip through.
- The `channels.spec.ts` change is the lead's call in the Integration section, so the spec counts as owned for this round.

## Review
Slice-reviewer, 23-11-2026, cloud session (seat 3), on d92416f4 (`git diff a549b0d8..fix/p3-fixes`, which is `git diff origin/main...fix/p3-fixes` since `main` ef3798f1 adds nothing past a549b0d8), Tier C. Run in the VM: the three unit files (`safety.test.ts`, `axe.test.ts`, `qstash.test.ts`: 37 passed); `tests/duplicate-scan.test.ts` with the security config (10 passed); the five new `qstash.test.ts` cases against a549b0d8's `qstash.ts` (all 5 fail, the file restored afterwards); `jobs-check.test.ts` on fresh databases (below). Not run: typecheck, lint, the build and the journeys (the builder's report records them), and no screenshot was reviewed, since no screen changed.

**The lead's question, `jobs-check.test.ts` on a fresh database:** it fails on the branch **and on `main`**, so the slice did not cause it.
- On a fresh Postgres (`fresh-db.sh shakti-postgres 54322`), `vitest run --config vitest.security.config.ts tests/jobs-check.test.ts` fails "reads every job as the worker principal…" (1 failed, 9 passed), on d92416f4 and on `main` ef3798f1. Both runs fail the same way: the alerts hold `audit-logs-partitions` and `whatsapp-messages-partitions` late, and no `outbox-events-purge`.
- Cause (confirmed): no migration runs the outbox purge. `retention_runs` on the fresh database holds only the two partition jobs, and `cron.job_run_details` is empty (pg_cron runs nothing in the test container). The only caller of `call app.purge_outbox_events()` outside pg_cron is `packages/db/tests/security/retention.test.ts` (lines 83 and 121). The case's comment ("The migrations run the outbox purge once and record it") is wrong.
- Proof: on another fresh database, the db suite's `retention.test.ts` first (14 passed), then `jobs-check.test.ts`: 10 passed.
- So the case passes only after the db suite has run against the same database, as in the whole `pnpm test:security` (`turbo run test:security --concurrency=1`, where `@shakti/db` runs before `web` in practice; no `dependsOn` orders it). It fails whenever the web suite or this file runs alone, as the builder ran it (`pnpm --filter web test:security`). See finding 2.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | Low | **The duplicate-scan case can fail on a database that holds an earlier run's number (plausible, by reading the code).** `customersSharingAPhone` (`duplicate-scan.test.ts`) builds the number from the last 6 characters of a UUIDv7 with every letter changed to `7`, plus the company's position. Earlier runs' customers stay in the shared database, and the scan looks around every customer of the company, not only those after the marker. So when an earlier run drew the same 6 characters, `candidatesOf(pair.first)` holds a second card and the `toEqual([…one card…])` fails. The chance is about 1 in 7,600 per pair of runs (the letter-to-7 change skews the digits), so roughly 1 % on a database aged by 100 runs, as the PC's main checkout is. Fix: take 8 decimal digits from `randomInt` (or from the id's hex read as a number), or assert `toContainEqual` on the pair's own card and that no card pairs `first` with anything but `second` among this run's ids. | open |
| 2 | Low | **`jobs-check.test.ts` depends on the db suite having run first (confirmed; existed before this slice, outside its files).** See the lead's question above. Scenario: `pnpm --filter web test:security`, or this file alone, on a fresh database fails, as it did in the builder's VM and here on `main`. Fix (a follow-up, outside this brief's owned files): the case runs `call app.purge_outbox_events()` through `asMigrator` before its first check, as `retention.test.ts` does, and its comment says so. | open, for the lead (STATUS follow-up) |
| 3 | Low | **The axe wait drops its `'moving'` answer silently (confirmed by reading the code).** `expectNoAxeViolations` (`axe.ts`) awaits `page.evaluate(waitUntilStill, STILL_WAIT)` and ignores the result. A fade or a finite animation longer than 2 seconds lets axe measure mid-fade again, and a contrast failure then gives no sign that the page was still moving. Fix, one line: when the answer is `'moving'`, add a test annotation, or name it in the failure message. | open |

**The lead, 24-11-2026:** fix 1, 2 and 3 in one fix round, each with its test. Finding 2 adds `apps/web/tests/jobs-check.test.ts` to the files this slice owns: the case runs `call app.purge_outbox_events()` as the migrator before its first check, as `retention.test.ts` does, and its comment says so; prove it by running the file alone on a fresh database. Finding 1 takes 8 decimal digits from `randomInt`. Finding 3 names a `'moving'` answer in the failure message.

Found sound:
- **Item 4, QStash:**
  - `@upstash/qstash` 2.12.2 resolves `config?.baseUrl ?? env.QSTASH_URL ?? DEFAULT_QSTASH_URL` (`chunk-QZWHOQRG.mjs`, `getClientCredentials`), so a blank `QSTASH_URL` in the process became the address. The fix of always passing `baseUrl` is right, and `QSTASH_DEFAULT_URL` equals the library's `DEFAULT_QSTASH_URL`.
  - The real-client case stubs `fetch` and reaches no vendor. `client()` is the only `new Client(` in `apps/web/src`.
  - Passing `baseUrl` with a token skips the library's `QSTASH_REGION` lookup. Nothing in the repository sets `QSTASH_REGION`.
- **Item 1, the vendor list:**
  - The test reads `.env.example` lines, set and commented out, with the brief's endings and 13 prefixes. The made-up-variable case proves the check can fail, and the cross-checks (no name on both lists; every kept name is in `.env.example`; every kept phrase is in `MEASURE_SERVER_ENV`'s parts) hold.
  - The kept LiveKit, WhatsApp, Meta, Google and Exotel phrases are replaced for the measuring server by `JOURNEY_SERVER_ENV` and `TEST_WEBHOOK_ENV`.
  - The measures' own process (`loadRootEnv`) keeps the `.env`'s values of those names, but it runs only the lead path and the outbox batch, and neither reaches `integrations/voice/livekit.ts` or a webhook sender. No gap today.
  - Comparing names with `.env.example` confirms nothing was missing from `VENDOR_CREDENTIALS`.
- **Item 2, the axe wait:**
  - It cannot hang a journey: the loop is bounded by `limitMs`, and each step ends after a frame or 50 ms.
  - Paused animations, finished ones and endless ones (spinners) are left out, so no case waits on what never ends.
  - The function is self-contained for `page.evaluate`.
  - `axe.test.ts` is in the unit config's `e2e/support/**/*.test.ts`, so CI runs it.
- **Item 3, duplicate scan:**
  - The stand-in `executeCommand` moves only the starting cursor of `crm.duplicate.scan`, when its `afterId` is null and a case set the marker. The command, `app.duplicate_facts()`, `app.record_duplicates()`, the signature check and `runCompanyBatches`' walk stay real.
  - The marker is minted before a database round trip, so every customer id after it sorts after it (UUIDv7 milliseconds).
  - `liveCompanies()` mirrors the walk (from company 1 to the first missing id, skipping archived ones).
  - The marker is reset in `afterEach`, the security config runs files one at a time (`fileParallelism: false`), and the 60-second limit is in the test, not a config.
- No config file, `package.json` script, package, lockfile or Phase 3 slice file changed. The diff touches only the brief's owned files and the run file.
- Each fix has a test that fails without it (QStash: reproduced; axe: the function did not exist; the list: the made-up-variable case; duplicate scan: the old case is the evidence of the timing).

Not checked:
- The journeys, `channels.spec.ts` five times included, and the builder's timing table for the duplicate scan: read from the report, not reproduced.
- `pnpm build`, typecheck and lint: the report records them, and this review ran none.

## Integration (the lead, 24-11-2026, on the PC)
Every step of `integrate.sh` passed except the journeys. On a fresh database (`fresh-db.sh`, then `e2e:seed`), `notifications.spec.ts` passed, and `channels.spec.ts` › "sets a sales calls number, says when it is not of its series, and takes it out of use" failed on desktop-light, twice:
1. **First attempt, axe:** `color-contrast` on `div[data-title=""]` (a sonner toast's title), 1.39 (`#c0dfcb` on `#f7fef9`), at `channels.spec.ts:79`. The message did not say "still moving", so `waitUntilStill` answered `'still'`: the toast was in the page before its fade had started, which a look at `getAnimations()` cannot see.
2. **Retry, leftover number:** the first attempt had set RCREF's sales number, and the clean-up's click on "Take out of use" (line 59) does not confirm its dialog, so "Not set" never shows (line 60).

**Second fix round (lead's call, the defect found at integration):**
- Make the axe wait cover toasts: before `waitUntilStill`, wait (within the same 2 seconds) until every `[data-sonner-toast]` is mounted and its computed opacity is 1 (or no toast is present), then run `waitUntilStill`; a unit test on a stand-in page whose toast starts its fade after the first look.
- Make the spec's clean-up complete: when the leftover button is there, click it, confirm its dialog, and wait for "Not set".
- Prove it on the VM: `channels.spec.ts` ten times in a row, each run after a fresh `e2e:seed`, plus one run where the test's first attempt is made to fail after setting the number (by hand, then reverted) to show the retry recovers.

**Integration, after the second fix round (the lead, 24-11-2026):** `channels.spec.ts` and `notifications.spec.ts` on a fresh database passed (37 passed, 4 skipped); `main` taken in again (with `web-push` 4.0.0); `eslint --max-warnings 0` on `apps/web/e2e` and the two test files, and `axe.test.ts` (10), passed. The first integration's other steps (lint, format, copy-lint, generated, typecheck, unit, security, `db:verify`, audit, build, budget, gitleaks) passed before the second round, which changed only `axe.ts`, its test and `channels.spec.ts`.
