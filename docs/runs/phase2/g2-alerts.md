# G2 Phase 2 alerts (wave 4)

| | |
|---|---|
| Branch | `feat/g2-alerts` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): workers and notifications |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed |
| State | briefed |
| Next step | build to the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §8.1](../../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack), its third bullet (alerts in Sentry: webhook failures and the oldest waiting row, a WhatsApp quality rating at Low, the portfolio budget at 80 %, voice and AI spend at 80 % of a cap), §11 (the caps), §14 (G2: "the alerts fire on synthetic counts"); ADR 0020 (the workers principal holds platform-only permissions).
- What exists: `apps/web/src/observability/` (`alerts.ts`, `sentry-on.ts` with `ALERT_NAMES`, `check-ins.ts`, `integration-health.ts`, `sentry-scrub.ts`), `apps/web/src/workers/jobs-check.ts`, `job-streak.ts`, `outbox-failures.ts`, `backup-age.ts` (the pattern to follow), the webhook inbox (`packages/db/src/schema/webhook-inbox.ts`, `apps/web/src/workers/webhooks/sweep.ts`, P5's [run file](p5-webhooks.md)), the messaging budget and hold (`packages/domain/src/messaging/budget.ts`), where W1 stores each number's quality rating and messaging limit ([w1-whatsapp.md](w1-whatsapp.md)), the agents' spend and caps (`packages/domain/src/queries/agents/spend.ts`, `packages/domain/src/ai/agent-defaults.ts`: the per-agent daily caps, the Concierge's per company, Ask, Playbook, transcription and voice caps), and V2's voice minutes and spend ([v2-voice.md](v2-voice.md)). DEPLOY §2 step 6 (schedules) and INCIDENTS §11.

Build, in this order:
1. **Alert names** added to `ALERT_NAMES`: `webhooks.failing` (failed inbox rows in the last hour at or above a threshold, per provider), `webhooks.backlog` (the oldest waiting row older than a threshold), `whatsapp.quality_low` (a company number's quality rating at Low), `whatsapp.budget_high` (the portfolio's messaging used at or above 80 % of its limit), `ai.spend_high` (an agent's spend today at or above 80 % of its cap, per agent and company), `voice.spend_high` (a person's or the company's voice minutes or spend today at or above 80 % of a cap). Thresholds are named defaults in one place, following where the existing alerts keep theirs; if you find a cap this list misses, add it and say so.
2. **The checks** as pure functions over counts (fires at and above, silent below, one alert per subject per period so nothing repeats every hour, a fingerprint per subject), with the counts read through the jobs check's existing read path, or a narrow definer only the workers principal may call (ADR 0020), never a person's grant. Run them from the existing hourly jobs check; add no QStash schedule (a new schedule is an owner's step on every hosted environment).

**Early check (Tier B):** once steps 1 and 2 are committed with their tests (unit tests on synthetic counts for every alert at, above and below its threshold and for the no-repeat rule; a security test for any definer: only the workers principal may call it, and it returns counts only), write a short report here, push `report: g2-alerts early check` and stop. The lead reads the diff and sends "continue" to this session.

3. **What an alert carries:** counts, ids, company codes and job names only; never a phone number, a message's text or a person's name (`sentry-scrub.ts`, a test that proves it).
4. **Integration health:** where the screen already shows webhooks or messaging health, the same figures the alerts use (one source of truth); no new screen.
5. **Documents:** the alert list where the existing Sentry alerts are listed (DEPLOY or the observability section it points to), each with the Sentry alert rule the owner makes per environment (an email alert on issues with that fingerprint); in your report, one line per alert saying which INCIDENTS section it should point to, for the lead to route into `g2-runbooks`' sections (do not edit INCIDENTS).

Files owned: the new alert names and checks (`apps/web/src/observability/`, new files under `apps/web/src/workers/`), one call line in `jobs-check.ts`, the thresholds' block, any definer and its migration.

Do not touch: the shadow reports (`g2-shadow-pack`), `docs/runbooks/incidents.md` and `docs/13-client-packs/` (`g2-runbooks`), `docs/04-architecture-appendix/` (`g2-measures`), `apps/web/src/workers/messaging/` (`p2-fixes`, `w2-media-retention`).

Review checklist (check before your report): each alert fires on its synthetic count and stays silent below it; no alert storm (one per subject per period); no personal data in any alert; counts read without a person's grant; nothing added to a hosted schedule; thresholds named in one place.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/g2-alerts` is on GitHub with this file. Start with `git fetch origin && git switch feat/g2-alerts` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: g2-alerts <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: g2-alerts done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: g2-alerts fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: g2-alerts blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

## Review

## Integration
