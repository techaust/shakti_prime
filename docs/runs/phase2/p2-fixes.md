# P2 fixes: Phase 2 review follow-ups (wave 4)

| | |
|---|---|
| Branch | `fix/p2-fixes` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): role grants in a definer, a customer-facing filter, an anonymisation window |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed |
| State | briefed |
| Next step | items 1 to 3 to the early check |

## Brief
The open Phase 2 follow-ups of [STATUS](../../10-status.md#open-follow-ups) that are code, one commit each with its tests. Read each item's source finding in the run file named before you change anything.

1. **`agents.note.write` agent-only** ([a2-copilot.md](a2-copilot.md)): the role editor can offer it to a staff role (only the insert policy refuses it). Add it to `roleMayHold()` and `app.role_may_hold()`'s agent-only list. Redefine the SQL function from `main`'s newest migration that defines it, keeping every clause other slices added (diff it line by line and say so in the report). Tests: the role editor's command refuses it; the security suite's oracle agrees.
2. **The Concierge's number-word filter and the customer's own name** ([a3-concierge.md](a3-concierge.md)): Roman Hindi number words that are also names ("Das", "Sat") make the filter refuse a greeting naming that customer. Exempt the words of the customer's own name, only where they stand as that name; a number word elsewhere is still refused. Tests for both, in `packages/domain/src/ai/concierge/`.
3. **The anonymisation window and WhatsApp** ([w1-whatsapp.md](w1-whatsapp.md) re-check N3): `app.customer_idle()` gains the `last_inbound_at` test the anonymisation already applies, so the stale-lead window and the dry run count only what will be anonymised. Redefine from `main`'s newest definition, keeping every clause. Security test: a customer who wrote on WhatsApp inside the period is neither counted nor anonymised.

**Early check (Tier A):** once items 1 to 3 are committed with their tests, write a short report here (with the function diffs against `main`), push `report: p2-fixes early check` and stop. The lead reads the diff and sends "continue" to this session.

4. **Voice's `bosToken`** ([v2-voice.md](v2-voice.md) review L3): drop `bosToken` from `VoiceSessionResponse` and the route's answer; the worker's dispatch already carries it. Tests that the answer no longer holds it and the voice journey still passes.
5. **WhatsApp quotes** ([s3-whatsapp-quotes.md](s3-whatsapp-quotes.md)): a STATUS or a code alone on a chat handled by people no longer brings the reply-waiting notice; a message the messaging worker refuses after the quote was marked sent is told to the person who sent the quote (an in-app notification through the existing notifications path).
6. **The audio player** ([k3-vault-audio.md](k3-vault-audio.md) re-check N2): a file the browser cannot play stops asking for a new address after the first failure and says it cannot be played, with a download link.
7. **The dialled call** ([t3-dial.md](t3-dial.md) re-check 12): a save on one lead clears another lead's dialled call; a save clears only its own lead's.
8. **Website keys and attached enquiries** ([i1-ingest.md](i1-ingest.md) re-check N2): the tests it lists (a key used for another company's site, a site archived after its key was made, the insert policy on its own), and a subscriber for `crm.lead.attached` that tells the lead's owner an enquiry joined their nurtured lead.

For each item touching a screen: copy in `en.json`, the journey that covers it, axe, and baselines for any screen that changed.

Files owned: the files each item names; `packages/domain/src/ai/concierge/rules.ts` and its tests; `apps/web/src/workers/messaging/` notice logic for item 5.

Do not touch: the shadow reports and their pages (`g2-shadow-pack`), `apps/web/src/observability/` and the jobs check (`g2-alerts`), `docs/runbooks/` and `docs/13-client-packs/` (`g2-runbooks`), `docs/04-architecture-appendix/` (`g2-measures`), the WhatsApp media files and their retention (`w2-media-retention`).

Review checklist (check before your report): each SQL function redefined keeps every clause `main` has; no staff role can be granted an agent-only permission; the filter still refuses every number not in the customer's name; the anonymisation and its count agree; nothing reaches a customer without a person; each item has a test that failed before the fix.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `fix/p2-fixes` is on GitHub with this file. Start with `git fetch origin && git switch fix/p2-fixes` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: p2-fixes <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: p2-fixes done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: p2-fixes fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: p2-fixes blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

## Review

## Integration
