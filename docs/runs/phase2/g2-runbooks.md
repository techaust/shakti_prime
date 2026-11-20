# G2 Phase 2 runbooks and exit-gate checklist (wave 4)

| | |
|---|---|
| Branch | docs/g2-runbooks on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | C ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): documents only, no code |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder (cloud session) on Opus 5.5 at high effort from the start |
| State | building |
| Next step | write the six INCIDENTS sections and the exit-gate checklist |

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

## Review

## Integration
