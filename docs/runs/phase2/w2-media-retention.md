# W2 WhatsApp media retention (wave 4)

| | |
|---|---|
| Branch | `feat/w2-media-retention` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): deletes customers' files |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed |
| State | briefed |
| Next step | build to the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §11](../../03-roadmap-appendix/phase2.md#11-workshop-defaults) (`retention`: WhatsApp media three years, then a text summary, for the CA to confirm) and §6.1; BLUEPRINT §7.9; DATABASE §10 if it lists retention jobs; ADR 0020 (the workers principal holds platform-only permissions and works through narrow definers).
- [w1-whatsapp.md](w1-whatsapp.md): Built item 15 (the job not built; `WORKSHOP_DEFAULTS.retention.whatsappMediaYears`), decisions 15 and 22 (the anonymisation leaves a customer's WhatsApp files to this job), and the note that a process stopped between a try's store and its attach leaves an original under a key no file row names.
- What exists: `packages/domain/src/workshop-defaults.ts` (`retention`), `packages/db/src/schema/retention-runs.ts`, `whatsapp.ts`, `files.ts`; the existing removal jobs to follow (`apps/web/src/workers/lead-anonymise.ts`, the files sweep, P5's `app.webhook_purge()`), the files layer `apps/web/src/files` and its storage port, the nightly route `apps/web/src/workers/nightly-route.ts` and `schedules.ts`; `infra/aws/files.yaml` (whether the worker's role may delete objects under the WhatsApp prefix).

Build, in this order:
1. **The removal** as a narrow definer only the workers principal may call (a new platform-only permission, e.g. `messaging.media.expire`, held by `system:workers` alone): WhatsApp media whose message arrived more than `retention.whatsappMediaYears` ago lose their file (the file row marked removed, the object deleted through the files layer's port), while the message keeps its text, its caption and a short text summary of what was sent (type, file name, size, the checks' verdict). In batches by a keyset cursor, each batch recorded in `retention_runs`; a dry run that counts without removing. A file another record still uses (filed against a lead, a customer document) is kept; say how you detect that.
2. **Orphan originals:** keys under the WhatsApp prefix that no file row names and that are older than a day are removed in the same run.

**Early check (Tier A):** once steps 1 and 2 are committed with their tests (security suite: only the workers principal may call the definer, a person's role never holds the permission, the agent refusal sweep refuses it; on real Postgres: a message older than the period loses its file and keeps its text and summary, a newer one is untouched, a file still used elsewhere is kept, the dry run removes nothing, batches resume from the cursor; the storage port faked), write a short report here, push `report: w2-media-retention early check` and stop. The lead reads the diff and sends "continue" to this session.

3. **Running it:** from the existing nightly route (no new QStash schedule; a new one is an owner's step on every hosted environment), behind the kill or enable setting the other retention jobs use, reported to the jobs check like them (`job.failing` on repeated failure).
4. **The thread:** a message whose file was removed shows its summary and "This file was removed after three years" (or the wording the catalogue's existing retention notices use), never a broken link; copy in `en.json`, the thread journey and its baselines if the thread changed.
5. **Documents:** DATABASE's retention list, SECURITY if it lists retention, the design's "Built (W2)" line under §11, and in your report whether `infra/aws/files.yaml` lets the worker delete under the WhatsApp prefix (if not, the change set the owner applies, exactly; do not edit hosted stacks).

Files owned: the definer and its migration, the job under `apps/web/src/workers/`, its line in the nightly route and the jobs check, the thread's removed-file line in `apps/web/src/screens/messaging/`.

Do not touch: `apps/web/src/workers/messaging/` notice logic (`p2-fixes`), `apps/web/src/observability/` (`g2-alerts`), `docs/runbooks/` (`g2-runbooks`), the agents' reports (`g2-shadow-pack`).

Review checklist (check before your report): nothing newer than the period is touched; text and summary survive; a file used elsewhere survives; only the workers principal can remove; a dry run changes nothing; every batch is recorded; no customer's details in logs or alerts.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/w2-media-retention` is on GitHub with this file. Start with `git fetch origin && git switch feat/w2-media-retention` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: w2-media-retention <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: w2-media-retention done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: w2-media-retention fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: w2-media-retention blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

## Review

## Integration
