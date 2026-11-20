# G2 Phase 2 measures (wave 4)

| | |
|---|---|
| Branch | `feat/g2-measures` on GitHub, from `main` at 889ec54d |
| Runs on | a cloud session of its own; the lead on the PC reviews and integrates (owner, 20-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): measuring scripts and their records |
| Usage | 5-hour window 0 % at 05:45 UTC when briefed; builder on Opus 5.5 at high effort (cloud session, started 05:47 UTC, resumed for the fix and the review's fix round, ended 08:55 UTC, on the same model and effort throughout) |
| State | fixes |
| Next step | the lead reads the fix round |

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

### 20-11-2026, cloud session: measures run (blocked on one)
The lead's "continue" (accepting the early check at 2018323e, assumptions 1 to 6) asked for the runs, a run with processing held off if 100 a second missed through the server's own processing, and each measure's command for dev. All ran in this VM (4 processors, Intel Xeon at 2.1 GHz, 16 GB) against one `pnpm build` served by `next start` here; product code unchanged from `main` at 889ec54d; nothing hosted was called or loaded.

**Blocked: a product defect, which I did not fix (product code is on the brief's "do not touch" list).** On the production build, every webhook POST route with no path parameter answers 500 and stores nothing: `meta/whatsapp`, `meta/leadgen`, `google/leadform`, `exotel/call-status` and `livekit` (server log: `TypeError: Cannot convert undefined or null to object`, `request.failed`). Only `exotel/incoming/[secret]` works. Cause: `paramsOf()` in `apps/web/src/webhooks/receive.ts` lines 115-121 runs `Object.entries(await context.params)`, and Next.js resolves `params` to `undefined` for a route without dynamic segments. The suites call the handlers directly with no context (`context === undefined` returns `{}` first), so none reaches the line. Every Meta, Google, Exotel status and LiveKit delivery to a hosted site would get the same 500 (not checked on dev: no hosted call). Proposed fix: `const params = (await context.params) ?? {};`, and a route test that passes `{ params: Promise.resolve(undefined) }`. I tried to send this to the lead's session directly; the platform refused a message from a cloud session to a session on the owner's PC.

**Question for the lead:** (a) I fix it on this branch in a commit of its own, with the test, and run the six-route load again; or (b) another slice fixes it (p2-fixes?), and the webhook measure stays recorded as blocked until a run after that fix. Either way the command is ready: `pnpm --filter web exec tsx tests/measures/g2.ts webhooks` (and again with `--queue stand-in`).

**Recorded (each under "Measured (G2)", with the date, machine, commit, figures and target):**

| Measure | Figures | Target | Result | Where |
|---|---|---|---|---|
| Webhook answers, all six providers, 20/50/100 a second | five routes answer 500; longest answer 303, 34, 66 ms | every answer ≤ 2 s and stored once | missed: blocked by the defect | `webhooks.md` |
| Exotel Passthru alone, processing in the server | p99 65 / 13 / 21 ms, longest 344 / 39 / 53 ms; 540, 1,350, 2,700 stored once | the same | met | `webhooks.md` |
| Exotel Passthru alone, processing held off (`--queue stand-in`) | p99 96 / 19 / 23 ms, longest 394 / 51 / 71 ms; all stored once; 4,590 publishes to the stand-in | the same | met | `webhooks.md` |
| Lead Ads event to the caller's lead (in process) | p50 63, p95 86, longest 177 ms (20 rounds); with Graph at 1 s: longest 1,158 ms | ≤ 10 s | met | `webhooks.md` |
| Batch call of 200 (stand-in) | outbox p50 5.7 ms, 123,301 bytes; sweep p50 3.6 ms, 75,801 bytes; 200 messages a call, all accepted | none (the app's side) | recorded | `webhooks.md` |
| Dial key to the call accepted (simulated provider) | p50 195, p95 239 ms; the dial action p50 116 ms | p95 < 2 s | met | `exotel.md` |
| Screen-pop by the poll | p50 1,650, p95 2,938, longest 3,030 ms; 18 of 30 within 2 s; Passthru p50 10 ms | p95 ≤ 2 s (TEL-05) | missed: the poll's own wait | `exotel.md`, `realtime.md` |
| Voice turns on the fake room | the worker adds under 1 ms a step; with the budget's delays first audio p50 1,101 ms = 250 + 600 + 250 | first audio p50 ≤ 1,500 ms | real p50 and p95 wait for the vendors | `voice.md` |

At 100 a second the in-process processing did not make Passthru's answers miss; the held-off run is there as the lead asked, and its answers are a millisecond or two slower because the answer includes the publish to the queue, as on Vercel. The first rate of each run carries the server's warm-up (the 300 to 400 ms longest answers at 20 a second).

**Hosted runs, each with its exact command and what it waits on** (in the records): webhooks on dev (the defect's fix deployed, the receiver's role and dev's webhook phrases, with the two lead-form providers left out so no `form_unmapped` errors reach Sentry); Lead Ads on dev (no command: Meta's testing tool, Meta's keys); the batch call against QStash (no command: no vendor call by design); the dial on dev (the Exotel sandbox keys and DLT numbers; `G2_DIAL_*`); the screen-pop by Realtime on dev (`SCREEN_POP_TRANSPORT=realtime`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BOS_JWT_CURRENT_KEY`; `G2_POP_*`); voice (V1 part 2's keys and the LiveKit project). `webhooks.md` is a new note, with its row in the appendix readme.

**Changed since the early check:** `--queue stand-in` (`server.ts` sets the QStash variables to a local stand-in, `queueStandIn()` in `outbox-batch.ts`); `--providers`; `G2_SERVER_LOG=1` prints the measuring server's error output; the dial's timing waits for the action answer that carries the placed call (the first matching answer was another action's, 11 ms); the dial's person and phone come from `G2_DIAL_EMAIL`, `G2_DIAL_PASSWORD` and `G2_DIAL_PHONE` on another server. One run of the dial with the new wait stopped on a 30-second wait in one round; the two runs after it did not, and the recorded run is the last.

**Checks, on this branch's last commit:** `pnpm build` passed (1 min 54 s); `pnpm typecheck` 10 of 10 tasks; `pnpm --filter web test` 161 files, 1170 passed, 1 skipped; `pnpm --filter @shakti/voice-agent test` 5 files, 23 passed; `python3 tools/integration/check-doc-links.py` bad 0; Prettier clean on the measuring code; the whole-repository `pnpm lint` passed. Not run, as nothing they cover changed: `pnpm test:security` (no schema, policy, command or query), `copy-lint` (no copy), `db:docs` and `machines:docs`, the journeys and baselines (no screen). No measuring server is left running.

**Review checklist:** each figure comes from a run on this branch in this VM, and its record says so; nothing hosted was loaded or called; targets stand beside results; percentiles are tested (`stats.test.ts`); the missed targets (the six-route load, the poll's screen-pop) are stated as missed, each with the step that missed.

### 20-11-2026, cloud session: done
The lead answered the blocked question with (a): the fix on this branch in a commit of its own, then the six-route load again.

**The fix, 35305e13** (`fix(webhooks): a route with no path parameter gets no params from Next.js`, pushed at once, touching only `apps/web/src/webhooks/receive.ts` and `receive.test.ts`): `paramsOf()` treats `undefined` from `await context.params` as no params, and `RouteContext` says Next.js may hand it so. The new unit test calls every body provider's handler built by `receiveWebhook()` with `{ params: Promise.resolve(undefined) }` (each stores its delivery and answers 200), and `exotel_incoming` with real params (unchanged). It fails without the fix (1 failed, 16 passed) and passes with it; `src/webhooks` 28 passed; on real Postgres `tests/webhooks.test.ts`, `lead-ingest.test.ts` and `inbound-calls.test.ts` 34 passed.

**A test through the built route: not added, more than a few lines.** The journeys' server (`e2e/setup/server-env.ts`, and CI's `ci.yml`, which sets the same values) has no webhook phrases, so every webhook route answers 503 before it reads its params, and a journey would never reach the line. Catching this class of fault in CI needs the webhook test phrases in the journeys' server settings and in `ci.yml` (a checks change, the owner's `checks-ok`), then one journey case that posts a signed delivery from `signed-deliveries.ts` to `/api/v1/webhooks/meta/whatsapp` and expects 200. Until then, `g2.ts webhooks` on a production build is the check.

**The six-route load after the fix: met** (recorded in `webhooks.md`; the first run's figures kept as they were, with a dated line in `whatsapp.md` and the appendix readme's row). New build at 6a36b166; at 20, 50 and 100 a second every delivery of all six providers was answered 200 and stored exactly once:
- processing in the server: p99 232 / 23 / 30 ms, longest 406 / 43 / 61 ms;
- processing held off: p99 140 / 27 / 28 ms, longest 428 / 73 / 82 ms; 4,590 publishes to the stand-in.
At 100 a second the server's own processing did not make the answers miss. The 20-a-second rows carry the server's warm-up.

**Changed besides the fix:** the held-off load marks the rows it stored processed on the local database afterwards (6a36b166). The first held-off runs had left 4,590 rows waiting, and the sweep's real-Postgres test (`tests/webhooks.test.ts`, "the sweep publishes a row left waiting once per attempt it is on") then failed, because its own row was not among the first 200 waiting. I marked those 4,590 rows processed by hand on the local database, after which the test passed; no hosted database was touched.

**Checks, on this branch's last commit:** `pnpm build` passed (with the fix); `pnpm typecheck` 10 of 10 tasks; `pnpm --filter web test` 161 files, 1171 passed, 1 skipped; `pnpm --filter @shakti/voice-agent test` 23 passed; the three real-Postgres webhook files above 34 passed; `python3 tools/integration/check-doc-links.py` bad 0; Prettier clean; the whole-repository `pnpm lint` passed. Not run: the whole `pnpm test:security` (no schema, policy, command or query changed; the route's own real-Postgres files ran), `copy-lint`, `db:docs`, `machines:docs`, the journeys and baselines (no screen or copy). No measuring server is left running.

**Review checklist:** each figure comes from a run on this branch in this VM, and its record names the commit; nothing hosted was loaded or called; targets stand beside results; percentiles are tested; the missed target that remains (the screen-pop by the poll, the poll's own wait) is stated as missed, and the first webhook run's miss stays in the record with its cause and its fix.

### 20-11-2026, cloud session: fixes
The review at 038b5030 (H1, M1 to M4, L1 to L6), one round. 35305e13 kept on the branch. Every re-run below is on this VM against the same production build (product code at 35305e13), its report in `docs/04-architecture-appendix/results/g2-2026-11-20/`.

| Item | Commit | Test or evidence |
|---|---|---|
| H1 (a) no vendor credential reaches a measure | 25e2bebc | `withoutVendorCredentials()` (`apps/web/scripts/measures/safety.ts`, its list `VENDOR_CREDENTIALS`: Exotel's account keys and subdomain, Sentry, the model, speech, AWS and the bucket, SES, Supabase, Tally, Redis, Voyage, web push, WhatsApp's token and number, QStash) on the measuring server's settings and on the runner's own process, mail to the console; `safety.test.ts` "removes Exotel's keys and every other vendor credential, and keeps the rest" |
| H1 (b) no made-up number off this machine | 25e2bebc, 397c6de0 | `dialLeadPhone()`: a made-up lead only on the server started here; elsewhere `G2_DIAL_LEAD_PHONE` or refused, before any server is reached; `safety.test.ts` "refuses another server without a phone the owner's people answer" and the two other cases; by hand, `dial --base-url http://localhost:3999` without it: `set G2_DIAL_LEAD_PHONE first` |
| H1 the command for dev | ed1321d0 | `exotel.md`: `--rounds 3` with `G2_DIAL_LEAD_PHONE`, who answers each phone (the caller their own, the owner's people the "customer"), real calls billed, nobody else called |
| M1 repeats reach every provider | 5b47262e | `repeatSources()`; `stats.test.ts` "sends repeats to every provider…" (10 each of 600 at six providers) and "makes one delivery in `every` a repeat…"; re-run: 10, 25, 50 repeats a provider at 20, 50, 100 a second, all answered 200, none stored again; the earlier claim restated in `webhooks.md` (those runs reached WhatsApp, Google and Passthru only) |
| M2 a lost lead round counts 30 s | 9bf82036 | `lead-path.ts` pushes `GIVE_UP_MS` for a lost round; a Lost column in `webhooks.md`; re-run: 20 rounds longest 515 ms, 10 with Graph at 1 s longest 1,228 ms, none lost. No unit test: the round needs the database and a lead that never comes |
| M3 voice | f4be1dee, ed1321d0 | `measureTurnTiming()` also times each turn to the fake room's `play()` (`toPlayback`); `turn-timing.test.ts` checks every turn and the delays' sum; `voice.md`: covers 1,100 of §9.3's 1,500 ms (no end-of-speech detection, no network or playback), compared with 1,100; "adds up" said to be by construction in the session, checked outside it by `toPlayback` (1,101 / 1,103 / 1,104 ms against 1,100) |
| M4 a timed-out dial round | 25e2bebc, 5fd98d7e | a miss is 30,000 ms with its step and what the bar showed, and the run goes on; 30 rounds then missed 4, all at "the dial action's answer" while the bar showed the call placed and ended: the measure's own `waitForResponse` predicate reading bodies. Read from the page's response events instead: 30 rounds, none missed, the action read in all (p95 201 ms). Both runs recorded in `exotel.md`, the earlier stopped run's cause stated as the same wait (its log was not kept) |
| L1 settle in a `finally` | 5b47262e | held-off rows are marked processed in a `finally`; `webhooks.md` says the runs leave failed rows and the journeys need a fresh database |
| L2 hosted message count, the EU publish | ed1321d0 | `webhooks.md`: about 4,600 messages for the three rates, about 2,700 with `--rates 100`; dev's answers add a publish to QStash in the EU |
| L3 `--seconds` at most 240 | 25e2bebc | by hand: `--seconds 300` refused |
| L4 the 500s in the past tense | ed1321d0 | `webhooks.md`, `whatsapp.md`, naming 35305e13 |
| L5 every run's report committed | ed1321d0 | 19 reports in `results/g2-2026-11-20/`, numbered as the records name them; gitleaks over the folder: no leaks |
| L6 `--queue` only with webhooks | 25e2bebc | by hand: `lead --queue stand-in` refused |

**Two things found while re-running.** Re-dialling one lead runs into its three tries (after the third Not reachable the lead moves to a follow-up and the outcome is saved differently), so locally each round makes a new lead (nobody rings), and the run with the owner's phone takes `--rounds 3`. The first in-server load after the M1 change had a slow 20-a-second row (longest 1,413 ms, in the server's first seconds); a second run (longest 380 ms) is recorded beside it, both within the 2 seconds.

**Not re-run:** the screen-pop and the batch call, which no fix touched (the server's settings changed only by removing vendor credentials, of which this VM's `.env` holds none).

**Checks, on this branch's last commit:** `pnpm typecheck` 10 of 10; `pnpm --filter web test` 162 files, 1177 passed, 1 skipped; `pnpm --filter @shakti/voice-agent test` 23 passed; on real Postgres `tests/webhooks.test.ts`, `lead-ingest.test.ts`, `inbound-calls.test.ts` and `click-to-dial.test.ts` 41 passed; `python3 tools/integration/check-doc-links.py` bad 0; the whole-repository `pnpm lint` passed. No measuring server is left running.

## Review

## Integration
