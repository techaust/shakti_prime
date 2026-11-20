# G2 Phase 2 runbooks and exit-gate checklist (wave 4)

| | |
|---|---|
| Branch | docs/g2-runbooks on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): documents only, no code |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder (cloud session) on Opus 5.5 at high effort from start to end |
| State | done, waiting for the lead's review |
| Next step | the lead reviews the branch |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §8.1](../../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack) (the second and fifth bullets), §12 (final-phase verification) and §13; BLUEPRINT §12 (the runbooks it lists for Phase 2); ROADMAP §4 (Phase 2's exit gate).
- The documents you edit: [INCIDENTS](../../runbooks/incidents.md) and [exit-gate-actions](../../13-client-packs/exit-gate-actions.md). Their style: plain sentences, numbered steps, each step naming a real screen, command or setting; no change-log wording (`CLAUDE.md`, Approved documents: edited by hand, in targeted lines).
- Every Phase 2 run file in this folder (their Built lists, decisions and integration notes), and the code behind each fallback you describe, so every step is true: the kill switches and autonomy (`packages/domain/src/ai/config.ts`, Admin › Agents), the Concierge's hand-off and availability (`packages/domain/src/ai/concierge/availability.ts`), W1's template states and the messaging budget and marketing hold (`packages/domain/src/messaging/`), T2 and T3's manual call logging beside click-to-dial, `/voice`'s push-to-talk and text, Integration health and the webhook replay (P5).

Write:
1. **Six INCIDENTS sections**, numbered after the last: a WhatsApp template rejected; the messaging limit reached; an Exotel outage (manual calling with logging); a LiveKit outage (text instead of voice); a speech vendor outage (push-to-talk and text); an AI provider outage (the agents stop, people take the threads). Each: how it shows (the alert, the screen's message, Integration health), who acts, the steps, what staff and customers see meanwhile, how to recover and how to check it recovered. The alerts are being added today by `g2-alerts` under these names: `webhooks.failing`, `webhooks.backlog`, `whatsapp.quality_low`, `whatsapp.budget_high`, `ai.spend_high`, `voice.spend_high`; name the ones that apply (the lead aligns the names at the merge). Where a fallback the blueprint promises does not exist in the code, say plainly in the section what staff do instead, and list it in your report as a gap.
2. **exit-gate-actions:** Phase 2's exit gate as two parts (design §12's closing paragraph): the engineering items (webhook idempotency and contract tests green, consent routing verified on the sandbox, voice latency on dev), each with its state and the evidence (the test files, or what it waits on: voice latency on dev waits on the LiveKit and speech keys of V1 part 2); and the final-phase checklist of §12, one row per slice with its live step, what it needs, who acts and where the result is recorded.
3. **Links:** `python3 tools/integration/check-doc-links.py` passes; INCIDENTS' contents line lists the new sections.

No early check (Tier C). No code, no `en.json`.

Files owned: `docs/runbooks/incidents.md`, `docs/13-client-packs/exit-gate-actions.md`.

Do not touch: anything outside those two files and this run file.

Review checklist (check before your report): every step names something that exists (a screen, a setting, a command, a script); nothing claims a measure or a test that is not on `main`; each section says what customers see; no change-log wording; the link check passes.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** docs/g2-runbooks is on GitHub with this file. Start with `git fetch origin && git switch docs/g2-runbooks` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: g2-runbooks <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: g2-runbooks done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: g2-runbooks fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: g2-runbooks blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

### 20-11-2026, cloud session: done
**Written** (documents only; no code, no `en.json`):
- [INCIDENTS](../../runbooks/incidents.md): sections 13 to 18 (a WhatsApp template turned down; the messaging limit reached; Exotel down; LiveKit down, type instead; the speech service down; the AI provider down, people take the chats), each with how it shows (the alert, the screen's words, Integration health), who acts, the steps, what staff and customers see meanwhile, and how to recover and check; the contents line; one header paragraph on the Phase 2 channels (sandboxes on dev and staging, nothing on production until the final phase) and the six alert names; §8 points to §18. §12 corrected where the code differs: a refused dial logs `action.failed` with `dialCall` and a reference, not the call's id; the sweep closes a call Exotel never answered at 17 minutes past the hour once an hour has passed (one to two hours), a refused one at once; reload the page before **Show number** when the bar is stuck on **Placing the call**, or the hand-dialled save is tied to the stuck call.
- [exit-gate-actions](../../13-client-packs/exit-gate-actions.md): retitled "Exit gates"; §6 Phase 2's gate item by item in two parts (engineering: idempotency and contract tests Met with the test files and counts; consent routing Met in code and tests, the sandbox run waiting on the Exotel trial; voice latency on dev waiting on the LiveKit project and the Sarvam key; the three final-phase items pointing to §7); §7 the final-phase checklist, one row per slice of design §12 (A3 and A2, V1 and V2 split), with its live step, needs, who acts and where the result is recorded.

**How each step was checked:** four read-only searches of the code (WhatsApp, Exotel, voice and speech, AI and webhooks), then each claim the steps rest on read in the code myself: `send-checks.ts` and `budget.ts` (order of checks, the 80 % hold, the 250 starting limit), `run-concierge.ts` (a failed model call hands nothing over; a stopped agent does), `availability.ts`, `config.ts`, the template webhook in `apps/web/src/workers/webhooks/whatsapp.ts` (name and English language), `milestones.ts` (which outcomes notify a quote's sender), `send.ts`, `voice/handlers.ts` (room failure, start cap), the voice worker's fallback in `apps/voice-agent/src/session.ts`, `sweep-calls.ts` and `schedules.ts`, `actions/result.ts`, `nav.ts` and the role seed (who sees each screen), and every quoted string against `en.json`.

**Checks:**
- `python3 tools/integration/check-doc-links.py`: `bad 0`.
- The exit gate's evidence, run on the session's Postgres after `pnpm db:migrate` and `pnpm db:seed`: web security `tests/webhooks.test.ts` and `tests/lead-ingest.test.ts`, 25 passed; db security `webhooks` and `entity-channels`, 32 passed; domain security `commands/webhooks` and `commands/dial-rules`, 30 passed; web unit `src/webhooks` and `lead-forms`, 30 passed; domain unit `src/telecom`, `src/messaging` and `ai/config`, 106 passed.
- No typecheck, lint, build or journeys: no code, test or `en.json` changed (Tier C).

**Gaps: fallbacks the blueprint or design promise that the code does not have** (each section says what staff do instead):
1. AI provider outage: no automatic fall back to Suggest (BLUEPRINT §12); with Automatic unavailable until Phase 6 nothing reaches a customer without a person anyway.
2. A failing AI service does not hand the Concierge's chats to people; only a stopped agent, a spent limit or the day's run count does. §18 has the Executive or GM press **Stop**. No test covers the failing-model path.
3. `ai.breaker_opened` is a log line only, with no Sentry report; no alert names an AI outage.
4. A marketing message held at 80 % is never sent later by itself (already the owner's question in STATUS).
5. A quote refused at the messaging limit does not notify its sender (`tier_budget_reached` is outside the milestone's not-sent list); §14 has the sender check the chat.
6. A quality rating of Low changes nothing in sending; templates rejected, number quality and the budget raise no alert on `main` (G2's alerts add the last two).
7. No screen registers a WhatsApp template (`messaging.template.register` has no action); a resubmitted template keeps its name; only English templates take Meta's review.
8. No switch turns click-to-dial off for a company or the day, and no outage notice; **Take out of use** on a number cannot be undone.
9. Incoming and missed calls during an Exotel outage are not recovered by the app (nothing polls Exotel).
10. Talk to Shakti's push-to-talk and text box run inside the LiveKit room: a LiveKit outage leaves no voice, push-to-talk or text there; the written way is Ask the Business (the screen's own message says so).
11. One speech vendor only, no failover; push-to-talk uses the same service, so a speech outage leaves typing only; the screen's message blames the network; a failure of speaking back is not told to the person.
12. Voice spend is not on Integration health and has no group or monthly cap (per person only, in code); there is no stop switch for voice on Admin › Agents.
13. A call transcription that failed has no screen state.

**Assumptions:**
- The six alert names are written as the brief gives them, in one header paragraph and in the sections that apply; the template section names none, since none covers a template. The lead aligns them with `g2-alerts` at the merge.
- The Exotel runbook is a new §15 that covers the whole outage (calls out, calls in, recordings, Exotel's messages) and sends the screen steps to §12, rather than a second copy of §12.
- The branch name in this file's header and *How this slice runs* is out of backticks, since the link check read the branch name as a missing path; naming `docs/runs/phase2/` in exit-gate-actions §6 clears this file's ORPHAN line (the run files' readme does not list it while the slice is in flight).
- exit-gate-actions is retitled "Exit gates: who does what next" with Phase 2 as §6 and §7, since no document links to its title.
- "Where the result is recorded" for I1 is beside G2's 10-second measure in `docs/04-architecture-appendix/`, whose file `g2-measures` names today.

**Skills loaded:** none (documents only; the repository's skills are for code or the lead).

## Review

## Integration
