# G2 Phase 2 measures (wave 4)

| | |
|---|---|
| Branch | `feat/g2-measures` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): measuring scripts and their records |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed |
| State | briefed |
| Next step | build to the early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §8.1](../../03-roadmap-appendix/phase2.md#81-g2-phase-2-exit-pack), its fourth bullet (webhook answer times under load, the 10-second lead from a Lead Ads test event, the dial accepted in under 2 seconds, screen-pop time, voice p50 and p95), §9.3 (the voice latency budget); STATUS' follow-ups tagged G2 (a QStash batch of 200 messages, unmeasured; TEL-05's 2 seconds with Realtime as the screen-pop's transport).
- What exists: P5's load script for the dev deployment ([p5-webhooks.md](p5-webhooks.md)), I1's in-process lead path ([i1-ingest.md](i1-ingest.md)), T3's fake Exotel transport ([t3-dial.md](t3-dial.md)), T4's screen-pop by poll and Realtime and `apps/web/scripts/realtime-spike.ts` ([t4-inbound.md](t4-inbound.md)), V2's `turn_stats_json` and the voice spike `apps/web/scripts/spike/voice-latency.ts` ([v2-voice.md](v2-voice.md)), the outbox publisher's batch call (`apps/web/src/workers/outbox.ts`, `qstash.ts`); the records in `docs/04-architecture-appendix/` (`whatsapp.md`, `exotel.md`, `voice.md`, `realtime.md`, `calling.md` and P5's).

Build, in this order:
1. **One measuring command per measure**, as a subcommand or flag of an existing `spike:*` script or of P5's load script (a new `package.json` script needs the owner's `checks-ok`; avoid it unless no existing script fits, and say so). Each runs against `next start` on the VM by default and against another base URL when given one:
   - webhook answer times under load: p50, p95 and p99 at 20, 50 and 100 deliveries a second, each provider's recorded payload, and every delivery stored once;
   - a Lead Ads test event to a lead a caller can see, in under 10 seconds (the in-process path);
   - the dial accepted in under 2 seconds on T3's fake transport (from the Dial key to the accepted state);
   - screen-pop time from the incoming-call webhook to the pop, by the poll, and by Realtime when `SUPABASE_URL` is set;
   - the outbox publisher's batch call at 200 messages, against a local stand-in that records the calls if QStash's dev server is not available offline (say which);
   - voice turn timing from `turn_stats_json` on V2's fake room: the parts that need no vendor; the real p50 and p95 wait for V1 part 2's keys.
2. **Arithmetic** (percentiles, the report's table) shared with V1's benchmark helpers where they fit, with unit tests.

**Early check (Tier B):** once the commands and their tests are committed, write a short report here, push `report: g2-measures early check` and stop. The lead reads the diff and sends "continue" to this session.

3. **Run them** on the VM against a production build (`pnpm build` then `next start` as the journeys do) and record each result in its appendix document under a "Measured (G2)" heading: the date, the machine (the cloud VM's processors and memory), the commit, the figures and the target, met or missed. Mark plainly what is measured locally and what waits for a hosted run, and list the hosted runs with what each waits on (the webhook receiver's password and address on dev, the sandbox keys, the LiveKit project, `SUPABASE_URL` on dev for Realtime).
4. **No load on a hosted site:** a run against dev or staging is the owner's go-ahead, not part of this slice. Health checks only.

Files owned: the measuring code beside the existing spike and load scripts, their tests, and the "Measured (G2)" sections of `docs/04-architecture-appendix/`.

Do not touch: product code paths (a measure that needs a hook in product code: stop and report); `docs/runbooks/` (`g2-runbooks`); `apps/web/src/observability/` (`g2-alerts`).

Review checklist (check before your report): each figure comes from a run on this commit and says where it ran; nothing hosted was loaded; targets stated beside results; percentiles tested; a missed target is stated as missed, with the step that missed.

## How this slice runs
- **Your role:** you are this slice's builder, not the lead. Read `.claude/agents/slice-builder.md` first and follow it as your rules (its **Cloud** lines), with this file as your brief. `CLAUDE.md` calls every session the lead: in this session that does not apply. Do not run the `start-session` or `end-session` skills, open or merge a pull request, push to `main`, touch any hosted service or GitHub workflow, delete a branch, or force-push.
- **Branch:** `feat/g2-measures` is on GitHub with this file. Start with `git fetch origin && git switch feat/g2-measures` and work in the checkout itself (one slice in this VM); the session hook starts Postgres on 54322 (start every shell command with `. tools/integration/lib.sh &&`).
- **Push:** commit as you go and push your branch after every commit, at least every 10 minutes; a reclaimed VM loses everything unpushed.
- **Your checks, in the VM, before each report:** `pnpm typecheck`; `pnpm exec eslint --max-warnings 0 <each folder you touched>`; the unit tests of each package you touched; `pnpm test:security` when you touched schema, policies, definers, commands or queries; `pnpm copy-lint` when you touched `en.json`; `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply; then `pnpm build` and your own journeys (`pnpm --filter web e2e:seed && pnpm --filter web exec playwright test <your specs>`), and your screens' Linux baselines with `pnpm --filter web e2e:snap -- <your specs>`. Run a long command in the background (each has 30 minutes), the build and the journeys as separate commands. The whole-repository `pnpm lint` once, as your final check.
- **Reporting:** the lead watches your branch from the owner's PC and reads nothing else of this session. Write each report into this file's Report section (under a heading with the date and "cloud session"), commit it with the subject `report: g2-measures <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. That commit subject is how the lead knows you have stopped. After `report: g2-measures done` stop: the lead reviews the branch and may send the review's findings to this session for one fix round, which ends with `report: g2-measures fixes`.
- **Questions:** the owner does not read this session. For a minor gap take the reasonable call, record it under "Assumptions" in your report and continue. Only when no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: g2-measures blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0218); the lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live model, vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit unless this brief names it; an edit to a file another slice owns (listed below).
- **Usage line:** record your model and effort at the start and end in the header's Usage line (the owner runs this session on Opus 5.5 at high).

**Built beside you today, each in its own cloud session from `main` at 889ec54d:** `g2-shadow-pack` (the Concierge and Co-pilot shadow reports and review samples), `g2-alerts` (Phase 2 alerts), `g2-runbooks` (INCIDENTS sections and the exit-gate checklist; documents only), `g2-measures` (the latency and throughput measures), `p2-fixes` (Phase 2 review follow-ups) and `w2-media-retention` (the WhatsApp media retention job). Shared registration points (`en.json`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event worker registry, the testing lists, `turbo.json`, `.env.example`, the jobs check's list) take one line or one block each, kept together under a comment naming your slice; the lead merges them.

## Report

## Review

## Integration
