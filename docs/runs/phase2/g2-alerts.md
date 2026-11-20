# G2 Phase 2 alerts (wave 4)

| | |
|---|---|
| Branch | `feat/g2-alerts` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): workers and notifications |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; build Opus 5.5 at high effort (start) |
| State | early check |
| Next step | the lead reads the early check's diff and sends "continue" |

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

### 20-11-2026, cloud session: early check

**Built (steps 1 and 2, and the lead's addition).**
- `apps/web/src/observability/sentry-on.ts`: seven alert names in `ALERT_NAMES`, under a comment naming this slice: `webhooks.failing`, `webhooks.backlog`, `whatsapp.quality_low`, `whatsapp.budget_high`, `ai.spend_high`, `ai.provider_failing` (the lead's addition, below) and `voice.spend_high`.
- `apps/web/src/observability/alerts.ts`: the Sentry fingerprint is the name plus the alert's `subject` (a provider, a company code, `agent:company`, an agent, a person's id), as a job's alert already adds its job, so each subject is one issue.
- `apps/web/src/observability/whatsapp-quality.ts`: `qualityRating()`, moved out of `integration-health.ts` unchanged, so the screen and `whatsapp.quality_low` read Meta's report through one function (the start of step 4).
- `apps/web/src/workers/phase2-alerts.ts`: `PHASE2_ALERT_THRESHOLDS`, the one block of thresholds; the pure checks `webhookAlerts`, `qualityAlerts`, `budgetAlerts`, `spendSubjects` with `aiSpendAlerts`, `providerAlerts` and `voiceAlerts` (each fires at and above, silent below); `raiseOnce`, the no-repeat rule; and `runPhase2Alerts`, which reads the counts and raises what is due.
- `apps/web/src/workers/jobs-check.ts`: one call line (with its import and a comment): `await runPhase2Alerts({ requestId, keyValue, alerts, now })` after the jobs' own alerts. `JobsCheckWorkerResponse` is unchanged; the run logs `alerts.checked` with `due` and `alerted`. No QStash schedule is added.
- `packages/db/migrations/0219_g2_alert_counts.sql`: the definer `app.alert_counts()`. It checks `platform.jobs.check:all`, the jobs check's own platform-only permission, which only `system:workers` holds. So every person (the Executive too), agent and voice session is refused. It answers JSON with counts, ids, codes and times only. `companies` gives each company's id, code, and whether it has an active WhatsApp number. `webhooks` gives, per provider, the rows failed in the last hour, the rows waiting, and the oldest's wait in seconds. `agentCaps` gives the daily caps set on Admin › Agents. `agentsUnavailable` gives, per agent, its runs recorded `unavailable` in the last hour. `voice` gives, per person today in India, their minutes (an open session counts its minutes so far, at most its own length) and spend. Executable by `app_user` and `app_reader` only.
- `packages/domain/src/queries/platform/alert-counts.ts`: `readAlertCounts()` parses that answer strictly, exported from `@shakti/domain`; `partSpendKey` is exported beside `spendKey`.

**Where each figure comes from.**
- The database, through the definer: the webhook counts, the caps set on Admin › Agents, the runs left unavailable and the voice use. The jobs check reads them as `systemWorkersPrincipal(null)`, with no company and no person's grant.
- The key-value store: each number's quality report, the portfolio's limit and its use over 24 hours. Both are read through `messagingHealth()`, the function Integration Health uses. Also each day's AI spend, under the keys the spend caps count it under (`spendKey`, `partSpendKey`).

**Thresholds (`PHASE2_ALERT_THRESHOLDS`, flagged for the owner to confirm).**
- `webhookFailedLastHour` 3. This matches `job.failing`'s three in a row.
- `webhookOldestWaitingMinutes` 30. The sweep resends each minute, and a row's first five backoffs add up to 31 minutes.
- `whatsappQualityLow` is `red`: Meta's `FLAGGED`, Low.
- `whatsappBudgetShare` is `WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare` (0.8), so the alert starts with the marketing hold.
- `aiUnavailableLastHour` 5. This is the failures in a minute that open the provider's breaker.
- `aiSpendShare` 0.8 and `voiceShare` 0.8.

**No repeat.** Each due alert has a subject and a period; `raiseOnce` raises it only when the store's `alert:<name>:<subject>:<period>` key is new, held 7 days. The period is the day in India for every alert but `whatsapp.quality_low`, whose period is the quality report's own time (again after a week while the same report stands, as `job.problem`). A store that cannot answer means the alert is told, as `job.problem` does.

**Tests added (23, and two existing lists extended).**
- `apps/web/src/workers/phase2-alerts.test.ts`, 17 unit tests on synthetic counts. Each alert is checked one below, at, and above its threshold. Providers, agents, companies and the group are kept apart. `spendSubjects` takes the smaller of two caps, and each total is read under its own key. The no-repeat rule is checked: 24 hourly runs give one alert, another subject or the next day gives one more, two alerts on one subject stay apart, and a failing store still tells.
- `apps/web/src/observability/alerts.test.ts`, +1: the fingerprint `['webhooks.failing', 'meta_whatsapp']`.
- `packages/db/tests/security/alert-counts.test.ts`, 4 tests:
  - only `app_user` and `app_reader` may execute the definer;
  - the Executive, a GM, Accounts, a tele-caller, two agents, an Executive's voice session and a call with no context are all refused;
  - `system:workers` with no company gets exactly the five keys, every company and provider, and counts only;
  - with fixture rows in a rolled-back transaction it counts 3 failed and 1 waiting webhook row (and not the one failed two hours ago), a cap, the 5 unavailable runs (not the older or failed ones), and 25 voice minutes (20 ended and 5 open). Its JSON contains neither the payload's phone number, nor a display name, nor an error code.
- `apps/web/tests/jobs-check.test.ts`, +1: the hourly check with spend, budget and below-threshold figures in the store, run three times, raises `ai.spend_high` for `concierge:SS` and `knowledge:ask:group` and `whatsapp.budget_high` once each.
- `packages/db/tests/security/grants.test.ts`: `app.alert_counts()` added to the reader's definers. `packages/domain/tests/queries/reader-parity.test.ts`: `readAlertCounts` added.

**Checks run in this VM.**
- `pnpm typecheck` per workspace (`web`, `@shakti/domain`, `@shakti/db`): no errors.
- `pnpm exec eslint --max-warnings 0` on every folder and file touched: clean.
- `vitest run src/workers/phase2-alerts.test.ts src/observability/alerts.test.ts`: 22 passed.
- `alert-counts.test.ts` 4 passed; `grants.test.ts` 198 passed; `reader-parity.test.ts` 8 passed.
- `pnpm test:security`: the result is in the next paragraph.

SECURITY_RESULT

**`EXPLAIN (ANALYZE)` evidence.** The figures are from a transaction rolled back after inserting 300,000 processed inbox rows over three providers, 50 failed rows, 20 waiting rows and 200,000 agent runs, then `analyze`:
- Failed rows in the last hour: an Index Scan on `webhook_inbox_failed_idx` with `failed_at >= now() - 1 hour`; 7 rows read, grouped by provider.
- Waiting rows: a Bitmap Index Scan on `webhook_inbox_waiting_idx`; 35 rows read.
- Unavailable runs: per company (4 loops), a Bitmap Index Scan on `agent_runs_entity_created_idx` for the last hour; 142 rows a loop, outcome filtered.
- Voice today: an Index Scan on `voice_sessions_started_idx` from `app.voice_day_start(now())`.
- The whole `app.alert_counts()`: 4.4 ms.
- The first version read each provider's failed rows through `webhook_inbox_provider_received_idx`, which would read every row of a busy provider. It was rewritten (7c17612f) to the grouped ranges above before this report.

**Addition from the lead (20-11-2026).** `ai.provider_failing` is built from the runbooks slice's findings. Today an AI provider outage reaches nobody: `ai.breaker_opened` is only a log line, and runs end recorded as unavailable. It fires per agent when the agent's runs recorded `unavailable` in the last hour reach `aiUnavailableLastHour`, once a day, carrying `agent` and `unavailable` only. It is tested on synthetic counts and in the definer's security test. Its INCIDENTS section is §18.

**Assumptions (calls the brief did not settle).**
1. The definer checks the existing `platform.jobs.check` rather than a new permission. The counts are read only by the jobs check, and the permission is already platform-only and held only by `system:workers` (ADR 0020), so the permission catalogue, the seed and the platform-only list are unchanged.
2. AI spend is the store's running totals that the caps refuse calls on. Integration Health's spend from `agent_runs` is not used. The store's totals are the figure a cap is reached by, and they cover the Vault's, the Playbook's and Ask's spend, which writes no `agent_runs` row.
3. Caps covered:
   - the caps set per agent per company and for the group;
   - the Concierge's and the Co-pilot's own per-company caps (the Co-pilot's `companyDailyCapPaise` is the cap the brief's list missed, added here);
   - the Vault's index cap and its transcribing part;
   - the search, the Playbook and Ask.
   Where two caps hold one total, the smaller is checked. Not alerted: the per-person shares (Ask's, search's and the Playbook's `personDailyCapPaise`) and the Co-pilot's brief part. These are shares inside a cap, not caps, and the store cannot list one person's keys without a scan.
4. Voice: no company voice cap exists (`AGENT_DEFAULTS.voice` holds only each person's 30 minutes and ₹200 a day), so `voice.spend_high` is per person, on minutes or spend. The voice agent's model spend is Ask's (B1's service) and falls under `ai.spend_high` for `knowledge:ask:group`. I did not invent a company cap.
5. `whatsapp.quality_low` checks only companies with an active WhatsApp number, so a stale report on a removed number is silent.
6. The `webhooks.*` and `ai.provider_failing` windows use the database's clock (`now()`), as the sweep and Integration Health do. Only the store's day keys use the check's `now`.
7. A failed read (database or store) fails the jobs check, so its route's streak raises `job.failing` after three calls. The alerts are not silently skipped.
8. In `apps/web/tests/jobs-check.test.ts`, the first case's assertions now look at `job.problem` alerts only, because the same check may also raise Phase 2 alerts on what the shared database holds. Nothing it asserts about the jobs was dropped.
9. `ai.provider_failing` also fires where an agent runs with no AI key set, since those runs are recorded `unavailable` too. That case also stops the agent, so it is worth telling.

**Not yet done (after "continue").**
- Step 3: the test that no alert carries personal data through `sentry-scrub.ts`.
- Step 4: the rest of Integration Health on the same figures.
- Step 5: the documents, the Sentry rule per alert, and the INCIDENTS routing lines.
- `pnpm build`, the full lint and the web unit suite.

## Review

## Integration
