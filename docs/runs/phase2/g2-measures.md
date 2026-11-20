# G2 Phase 2 measures (wave 4)

| | |
|---|---|
| Branch | `feat/g2-measures` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): measuring scripts and their records |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder on Opus 5.5 at high effort (cloud session, started 05:47 UTC) |
| State | early check |
| Next step | the lead reads the early check and sends "continue" |

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

### 20-11-2026, cloud session: early check
Built on `feat/g2-measures` from 889ec54d, one cloud VM (4 processors, 15 GB). No skill of the brief applies (no table, command or screen); none loaded.

**The commands** (run from the repository root; each starts `next start` on the production build itself, on the port of `BETTER_AUTH_URL`, with the journeys' settings, the webhook test phrases and no queue, unless `--base-url` names a running server):
- `pnpm --filter web exec tsx apps/web/tests/measures/g2.ts <measure|all>`, written `pnpm --filter web exec tsx tests/measures/g2.ts …` (pnpm runs it in `apps/web`), with `--base-url`, `--port`, `--rounds`, `--rates 20,50,100`, `--seconds`, `--graph-ms`, `--out <file.json>`:
  - `webhooks` (`tests/measures/webhook-load.ts`): an open-loop run at each rate, the six providers' recorded payloads in turn, each signed as its provider signs it with an event id of its own, one delivery in ten a repeat of an earlier one; each answer timed from the send to the end of its body; p50, p95, p99 and max overall and per provider, the answers other than 200, the generator's own send lag; then, on this machine's database, every delivery stored exactly once (`storedOnce`).
  - `lead` (`lead-path.ts`): I1's in-process path: the signed `leadgen` delivery through the route's own `receiveWebhook()`, processed after the answer with no queue, Meta's Graph API a stand-in answering the recorded lead (no Meta call; `--graph-ms` adds its time), the lead given to the company's one present caller; timed until that caller's own `searchLeads` (under RLS) finds it by phone. The other callers' presence is put back afterwards.
  - `dial` (`browser.ts`): headless Chromium signed in through the screens as the journeys' tele-caller; a new lead each round; from the `C` key to the call bar showing the call accepted ("Ringing", or a later state if the simulated provider moved first), and the dial action's answer; each call saved as Not reachable before the next.
  - `screen-pop` (`browser.ts`): the journeys' screen-pop caller waiting on `/home`; Exotel's Passthru call on the real route (`/webhooks/exotel/incoming/<secret>`) at a random moment of the 3-second poll, from a number two of her customers share (so no page opens); timed to the ringing route's answer carrying it; the transport read from the page (a socket to the Realtime project or the poll).
  - `outbox` (`outbox-batch.ts`): `qstashEventPublisher().publish()` and `publishWebhookJobs()` with 200 messages each, through `@upstash/qstash`'s own client, against a local stand-in that records every call and accepts every message; the call's time, the request's bytes, messages per call.
- `pnpm --filter @shakti/voice-agent exec tsx src/measure-turns.ts [--turns 200]` (`apps/voice-agent/src/turn-timing.ts`): the worker's `VoiceSession` on V2's fake room with the real clock and timers, stand-ins for speech and the reply; its `turnStats()` (`turn_stats_json`) once with every stand-in instant (the worker's own time per step) and once with §9.3's budget as their delays (250, 600, 250 ms), which checks the timing adds up.
- The arithmetic (`apps/web/scripts/measures/stats.ts`): p50, p95, p99 by V1's nearest-rank `percentile` (`@shakti/voice`), share within a limit, the verdict against a target, the open-loop send times and send lag, the stored-once check, the Markdown table.

**Targets the report states:** webhook answers every one within 2 s (the route's own budget, design §5.1; read at the max, p99 beside it); the lead within 10 s (max); the dial accepted within 2 s (p95, which is the max at 10 rounds); the screen-pop within 2 s (p95); the batch call none (a stand-in: the app's side and the size); voice first audio p50 1,500 ms (§9.3) only with the vendors.

**Tests:** `apps/web/scripts/measures/stats.test.ts` 15 (percentiles on 100 and 5 samples, sub-millisecond rounding, no samples, 200,000 samples; share within; verdicts; open-loop offsets and refusals; send lag; stored once passes and names missing, repeated and unexpected ids; the table); `apps/voice-agent/src/turn-timing.test.ts` 1 (on the fake room with the real clock: every turn counted, each step at least its stand-in's delay, first audio at least the sum).

**Checks:** `pnpm --filter web typecheck` and `pnpm --filter @shakti/voice-agent typecheck` clean; `pnpm exec eslint --max-warnings 0 apps/web/tests/measures apps/web/scripts/measures apps/web/src/webhooks/signed-deliveries.ts apps/voice-agent/src` clean; `pnpm --filter web test` 161 files, 1170 passed, 1 skipped; `pnpm --filter @shakti/voice-agent test` 5 files, 23 passed; `tests/webhooks.test.ts` and `tests/lead-ingest.test.ts` on real Postgres (they use the changed helper) 25 passed. Smoke runs only, not the recorded measures: `lead --rounds 3` (139 ms p50, 194 ms max) and `outbox --rounds 3` (200 messages a call, all accepted); `measure-turns --turns 20`. The build, the webhook, dial and screen-pop runs and the records come after "continue".

**Assumptions (the brief left these open):**
1. P5's load script does not exist on `main` (design §14 lists one; P5's run file built none), and no `spike:*` script fits: each talks to one vendor with real keys and refuses to start without them. Rather than a new `package.json` script (the owner's `checks-ok`), the measures run through `pnpm --filter <workspace> exec tsx`; a `measure:g2` script can be added later with the label if the owner wants one.
2. The runners live in `apps/web/tests/measures/`, not `apps/web/scripts/`: ESLint fences scripts away from `@shakti/db/testing` and `@shakti/db/webhooks`, which the stored-once count and the lead measure's set-up need, and allows them under `apps/*/tests/**`. No file there ends in `.test.ts`, so neither suite runs them. The voice measure lives in `apps/voice-agent/src/`, since apps/web may not import the worker.
3. `apps/web/src/webhooks/signed-deliveries.ts` (P5's test helper, not a product path) takes an optional signing-phrases argument, the test phrases by default, so the load can be signed for another server; every existing caller is unchanged.
4. Locally the server processes each delivery itself after answering (no queue), so under load the processing shares the server's processors with the answers; on Vercel the worker is a function of its own. The local figures are therefore a harder case for the answers, and say so.
5. QStash's dev server is `@upstash/qstash-cli`, not in this repository and not installable here: the batch call goes to a local stand-in; QStash's own time and limits wait for a hosted call.
6. Any `--base-url` off this machine is refused without `--hosted-run-approved`: a run on dev or staging is the owner's go-ahead.

## Review

## Integration
