# P3 fixes: open follow-ups beside Phase 3

| | |
|---|---|
| Branch | `fix/p3-fixes` on GitHub, from the approved design at a549b0d8 (`main` 334a6d0b plus the design) |
| Runs on | a seat session (a cloud session under another of the owner's accounts, taking its work from `ops/seats`); the lead on the PC reviews and integrates (owner, 23-11-2026) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): tests and test helpers, one runtime guard |
| Usage | 5-hour window 4 % on the lead's account at 18:30 UTC when briefed; builder on Opus 5.5 at high effort; builder started on seat 2 on Opus 5.5 at high effort (23-11-2026) |
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
