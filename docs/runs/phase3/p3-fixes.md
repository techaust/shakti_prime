# P3 fixes: open follow-ups beside Phase 3

| | |
|---|---|
| Branch | `fix/p3-fixes` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a seat session (a cloud session under another of the owner's accounts, taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): tests and test helpers, one runtime guard |
| Usage | 5-hour window 4 % on the lead's account at 18:30 UTC when briefed; builder on Opus 5.5 at high effort; builder started on seat 2 on Opus 5.5 at high effort (23-11-2026) and ended on the same model and effort |
| State | briefed |
| Next step | the builder's report |

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

