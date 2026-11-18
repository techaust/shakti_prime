# V2 Live voice Teach and Ask (wave 3)

| | |
|---|---|
| Branch | `feat/v2-voice` on GitHub, from `main` at 9b6ea163 |
| Worktree | `v2-voice`, slot 5 (Postgres 54335, app 3035), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an agent principal acting as a person, a platform-only grant, spend caps |
| Usage | build Opus 5.5 high (agent-usage.py: every request at high); 5-hour window 1 % at 12:40 UTC, over 95 % by 16:25 UTC; this build about 37 points of it (the whole build) |
| State | integrated, pull request open |
| Next step | the owner's `checks-ok` (eslint config, Playwright config, js-budget, package scripts, pnpm-workspace); then migrate dev and staging (0189 to 0194) |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §7.5](../../03-roadmap-appendix/phase2.md#75-v2-live-voice-teach-and-ask), §2 (question 1: Sonnet 5.5 for the turn; question 12: voice at 30 minutes and ₹200 a day a person, sessions of at most 15 minutes; question 13: every Phase 2 integration off on production until the final phase), §3 (V2 owns `apps/voice-agent` and `/voice`), §4 (`voice.use` is in the catalogue and seed, V2 its first user; platform-only `voice.session.record`), §9 (models, the latency budget of §9.3), §10, §11, §14, §15 (SECURITY §3.4's voice cost rule is settled here).
- Built (V1, B1, K2, K3, P5): [v1-speech.md](v1-speech.md) and `apps/web/src/integrations/voice/` (the ports `ports.ts`, Sarvam streaming `sarvam.ts`, `claude-stream.ts`, `latency.ts`, `roman-script.ts`, and `livekit.ts`, which already signs LiveKit access tokens with `jose` and calls the room service over HTTP: use it, do not add `livekit-server-sdk`), `AGENT_DEFAULTS.voice`; [b1-ask.md](b1-ask.md) (`packages/domain/src/ai/ask`, the grounding filter, cited cards); [k2-playbook.md](k2-playbook.md) (`knowledge.playbook.draft`); [k3-vault-audio.md](k3-vault-audio.md) (audio and transcripts into the Vault as `exec_only`); [p5-webhooks.md](p5-webhooks.md) (the registry's `livekit` provider, `packages/contracts/src/api/webhooks-livekit.ts`); the existing contracts `packages/contracts/src/api/voice.ts` (`VoiceSessionRequest`, `VoiceSessionResponse`, the BOS token) and the `voice.session` endpoint; the BOS token keys in `apps/web/src/realtime/keys.ts`.
- BLUEPRINT §5 (`apps/voice-agent`), §9.2; PRD AI-03; SECURITY §3.3, §3.4; ADR 0010; AGENTS §3 (import fences: `apps/voice-agent` imports `@shakti/contracts` only and never the database).
- Skills: `add-table`, `add-command`, `vercel-react-best-practices`.

**Packages:** the owner approved on 17-11-2026 `@livekit/agents` and its peer `@livekit/rtc-node` for `apps/voice-agent` only. The lead adds them, pinned exactly (`@livekit/agents` 1.9.5, `@livekit/rtc-node` 1.2.1, both over two weeks old), with the workspace's `package.json` before you start; you install nothing else. If the worker needs another package, stop and report.

Build, in this order:
1. **Table** `voice_sessions` as §7.5 says (`user_id`, `entity_ids`, `mode` `teach` or `ask`, `consent_recording`, `audio_file_id`, `transcript_file_id`, `started_at`, `ended_at`, `minutes`, `cost_paise`, `turn_stats_json`): RLS read by its person and the Executive, written only through commands; the testing lists, fixture rows, the role × company matrix, `app_reader` grants (AGENTS §6).
2. **Permission** platform-only `voice.session.record` of `system:workers` (catalogue, `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS`, seed, SECURITY §3.2 and §3.3, the oracle case); `app.platform_only_permissions()` keeps every key of `main`'s latest definition (read the newest migration that redefines it) and adds yours.
3. **The voice principal:** a request made with a session's BOS token acts as the speaking person with `actor_kind` `voice_session` on every audit row, and never carries `finance.cost.read` or `procurement.rate.read`, even for an Executive (settle SECURITY §3.4). Security suite: an Executive's voice principal is refused a cost read that the same Executive's own session is allowed.
4. **Commands:** `voice.session.start` (`voice.use`): checks the day's minutes and spend (`voice_cap_reached`, a named value in `AGENT_DEFAULTS.voice`), refuses without a recording answer, makes the room through `livekit.ts`, answers `VoiceSessionResponse`; `voice.session.record` (the platform, from LiveKit's events: end, minutes, spend, turn stats); `POST /api/v1/voice/token` refreshes the 5-minute BOS token for a live session only. With no LiveKit variables set, start answers a plain "voice is not set up" refusal (every Phase 2 integration is off on production). Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.

**Early check (Tier A):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: v2-voice early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 9.

5. **The `livekit` webhook handler** on P5's registry: the session's end and minutes through `voice.session.record`, idempotent by LiveKit's event id.
6. **`apps/voice-agent`:** a LiveKit Agents worker for Node that holds no database credential and calls `/api/v1` with the session's BOS token, refreshing it before expiry. The turn: streaming speech-to-text through V1's ports, Sonnet 5.5 streaming with tools (`AGENT_DEFAULTS.voice`), text-to-speech of each sentence as it ends, barge-in, live captions over the room's data channel; push-to-talk and text when the network drops. Ask: B1's service through `/api/v1/ask`, a short spoken answer and the cited cards on screen. Teach: an interview by type (policy, priority, SOP, FAQ, tone) that ends with draft directives through `knowledge.playbook.draft` as the person; with recording consent, the audio and transcript to the Vault as `exec_only`. A `Dockerfile` for the image; no CI workflow change (deployment to LiveKit Cloud is the owner's, later).
7. **Screens:** `/voice` (menu Talk to Shakti, `voice.use`; one line in `nav.ts`): the recording question before each session, the listening light, captions, cards, push-to-talk, the minutes left; the LiveKit client side uses only what `@livekit/rtc-node`'s browser counterpart would need: if the page needs a browser LiveKit package, stop and report rather than install it, and build the page against a small port with a fake room. Copy in `en.json`; journeys with axe and light, dark and 400 px snapshots on a fake room; the JavaScript budget.
8. **Tests** of §14: the worker on a fake room (turn timing, barge-in, fallback); the voice token's claims and refresh; caps (minutes, spend, 15-minute session); no cost permission on the voice principal; no live vendor or model call in any test.
9. **Documents:** DATABASE, SECURITY §3.2, §3.3 and §3.4, API, the design's "Built (V2)" under §7.5, `pnpm db:docs`; `turbo.json` and `.env.example` for any new variable (which makes the pull request need the owner's `checks-ok`).

Files owned: `apps/voice-agent`, `voice_sessions`, the voice commands and routes, the `livekit` handler, `/voice` and its menu line. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, the webhook handler registry, `turbo.json` and `.env.example`, `AGENT_DEFAULTS`, `app.platform_only_permissions()`.

Built beside you, do not touch: S3 and A3 own the WhatsApp paths; A2 owns the Co-pilot; T4 owns the app shell and `exotel_incoming`. Your migrations are numbered after `main`'s last (0188) and renumbered by the lead at merge.

Review checklist (check before your report): the worker holds no database credential and no long-lived secret; a voice principal never reads costs or supplier rates; every command it runs is audited as `voice_session` with the person; caps stop a session; no session starts without the recording answer; transcripts in Roman script, masked before storage; the BOS token refreshes only for a live session of its own person.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §7.5 pass on a fake room; `pnpm test:security` passes on your Postgres.

Not in V2: the p50 measured over 100 turns from Mumbai on the dev deployment (needs the owner's LiveKit Cloud project; G2 records it); the image's deployment.

## Report

### Early check, 17-11-2026 (the lead's cloud VM, worktree `v2-voice`, Postgres 54335)
Steps 1 to 4 are built and committed; steps 5 to 9 wait for the lead's read of this diff. Skills loaded: `add-table`, `add-command` (`vercel-react-best-practices` waits for the screens).

**Built**
- Table `voice_sessions` (`packages/db/src/schema/voice-sessions.ts`, migrations 0189 and 0190 on this branch): the columns of §7.5 plus `entity_id` (the one company, as `ask_conversations`) and `updated_at`; its `id` is also the session's own `principals` row (kind `voice_session`) and its LiveKit room's name. Read by its person, and by the Executive (`audit.read:all`), in a request covering all its companies; no request role writes it. In `ENTITY_TABLES`, fixture rows per company (own and another person's) and a group row, a matrix rule, `NARROWER` (select only), `enum-sync` (`voice_sessions_mode_check`), `app_reader` on the select policy and grant.
- Permission `voice.session.record`, platform-only, of `system:workers`: catalogue, `PERMISSION_SCOPES`, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, seed, `en.json`, SECURITY §3.1, §3.2 (the oracle row) and §3.3; `app.platform_only_permissions()` keeps 0183's sixteen keys and adds it.
- Definers (0190): `app.voice_session_open()` (a person with `voice.use:all`; one start per person at a time; ends the person's open sessions; reads the day's minutes and spend across every company, the day in India; `cap_reached` writes nothing) and `app.record_voice_session()` (`voice.session.record:all`, no company, every value only forward).
- The voice principal (`packages/domain/src/auth/voice-principal.ts`, `apps/web/src/auth/voice-principal.ts`): the person's principal as it resolves on each call, kind `voice_session`, `voiceSessionId` set, narrowed to the session's companies, with `finance.cost.read` and `procurement.rate.read` removed; resolved only from a valid voice token of this deployment for a live session of the token's own person. `withRequestContext()` sets `app.voice_session_id`; `auditBase()` writes the session as the actor, `actor_kind` `voice_session` and the person in `on_behalf_of_user_id`; the `audit_logs` insert policy (redefined in 0190) holds a voice request to exactly that, and only for a session the person opened; `app.request_is_person()` answers no for it. SECURITY §3.4 is settled in those words.
- Commands (`packages/domain/src/commands/voice/sessions.ts`, registered, labelled in the Activity log): `voice.session.start` (`voice.use`, people only), `voice.session.token` (`voice.use`, run as the voice principal; live session of its own person only, `voice_session_ended` otherwise) and `voice.session.record` (the platform). Caps in `AGENT_DEFAULTS.voice` (`personDailyMinutes` 30, `personDailyCapPaise` 20,000, `sessionMaxMinutes` 15).
- Routes: `POST /api/v1/voice/session` and `POST /api/v1/voice/token` (`apps/web/src/voice/handlers.ts`, `token.ts`, `route-deps.ts`): without LiveKit or the signing keys a start answers `integration_unavailable` (`voice_unavailable`) before anything is written; the room is made through `livekit.ts` (new `createAgentRoom`, LiveKit's `CreateRoom` with the worker dispatched and `VoiceDispatchMetadata`); BOS tokens are ES256, audience `shakti-voice`, 5 minutes, never past the session's 15 minutes. Contracts: `packages/contracts/src/commands/voice/sessions.ts`, `VoiceTokenRequest`/`Response`, `VoiceDispatchMetadata`, `VOICE_AGENT_NAME`, the `voice.token` endpoint and fixture, reasons `voice_unavailable` and `voice_session_ended`; API §3.1 rows; DATABASE §4.1, the definer table and §6.9; `pnpm db:docs`.

**Tests added (42):** `packages/db/tests/security/voice-sessions.test.ts` 9; `packages/domain/tests/commands/voice-sessions.test.ts` 9 (denied, wrong company, happy path for each command; the cap; no recording answer; command mode); `packages/domain/tests/security/voice-cost.test.ts` 2 (an Executive's voice principal reads no `item_costs` row the same Executive reads); `apps/web/src/voice/token.test.ts` 3, `handlers.test.ts` 8 (fake room, no LiveKit call), `apps/web/src/auth/voice-principal.test.ts` 3. Changed: the people-only sweep input, the refusal-coverage review entry for `voice.session.record` (no company by design), the matrix, grants, enum-sync and platform-only lists, and the two older tests that made a `voice_session` principal now use `createTestVoicePrincipal()`.

**Checks**
- `pnpm test:security` on Postgres 54335: db 1441 passed (54 files), domain 1252 passed (92), web 402 passed (32); Tasks 4 successful.
- Unit: contracts 195 passed (21 files); db 158 (the data-docs test failed until DATABASE named the migrations, then its file 18 passed); domain 2543 of 2544 (the refusal-coverage test, fixed, then its file 4 passed); web 1111 passed, 1 skipped (147 files).
- Typecheck of contracts, db, domain and web; ESLint `--max-warnings 0` on every touched folder (in batches, one hit fixed); Prettier check of every touched file; `pnpm copy-lint` clean. The whole-repository `pnpm lint` waits for the final check.
- `EXPLAIN (ANALYZE)`: the token's session read as `app_user` under RLS uses `voice_sessions_user_started_idx` (Bitmap Index Scan, `user_id`; a seq scan over 30 rows when the planner may choose); the day's usage inside `app.voice_session_open()` is a Bitmap Index Scan on `voice_sessions_user_started_idx` (`user_id` and `started_at >= app.voice_day_start(now())`).

**Decisions the brief did not settle (for the lead)**
1. The voice principal keeps the person's id (so own and team scopes, idempotency keys and `created_by` are the person's) and names its session in a new `Principal.voiceSessionId`; each session gets its own `principals` row, which the audit rows name as the actor (the contract's `sid` already said so). A `voice_session` principal without its session is refused by `withRequestContext()`.
2. Because the voice principal is the person to the database, DB checks that read the person's `principals.kind` see a person. I made `app.request_is_person()` refuse a voice request and moved the two definers for people only that read the kind, `app.open_sizing_review()` and `app.claim_push_subscription()`, onto it (0191, bodies otherwise unchanged). Four insert or update policies still read the kind only: `sizings_insert`, `calls_insert`, `targets_insert`, `duplicate_candidates_update`; their commands are for people only, so the command guard refuses a voice session first, and no voice route reaches them. Redefining those policies too (`and (select app.voice_session_id()) is null`) is a lead's call: it adds four more redefinitions to watch at merge.
3. The Executive reads everyone's sessions through `audit.read:all` (only the Executive holds it by default); a session over several companies is read in a request covering them all, as Ask's.
4. One live session per person: a new start ends the earlier one (minutes from its times, at most 15). A session whose room failed to open stays unended but stops being live after 15 minutes; the person's next start closes it.
5. `minutes` are whole minutes rounded up; spend before the end is kept; `voice.session.record` audits with no company, since a session may cover several.
6. `voice.session.token` is a command (one audit row per refresh, as Realtime tokens) rather than a query; the session route answers `bosToken` as the built contract requires (the worker gets the same token in the dispatch metadata).
7. Rate caps: 10 starts per person and 10 refreshes per session in 5 minutes.

**Open**
- Steps 5 to 9 (the LiveKit handler, the worker, `/voice`, the worker and caps tests of §14, the design's "Built (V2)" record).
- Linking `audio_file_id` and `transcript_file_id` after a Teach session with consent: the recording is filed by the worker as the person (K3), and nothing records the link yet; it comes with step 6, likely as a person-side command.
- Voice sessions have no retention job yet (§11 names 24 months for the CA); not in the brief.
- The migrations here were edited after they were applied to my database (two definer and policy fixes); I applied the same text by hand and updated their hashes, so a fresh database applies them as they are. A fresh-database run by the lead would confirm.

### Step 5, the two sweeps, and a stop at step 6, 17-11-2026 (the lead's cloud VM, worktree `v2-voice`, Postgres 54335)
**Built**
- The `livekit` handler (`apps/web/src/workers/webhooks/livekit.ts`, one line in the registry). It runs as `system:workers` with `voice.session.record` and no company:
  - `room_finished` ends the session named by the room, at the event's time; minutes come from the session's own times.
  - The voice worker leaving the room (`participant_left` of LiveKit's `AGENT` kind) gives its last report, `VoiceWorkerReport` read from its participant metadata: spend, turn timings and, for a Teach session, its vault files.
  - Every other event, a room of no session and an unreadable report record nothing. The inbox is one row per LiveKit event id, and the record only moves forward.
  - The person's join token neither makes them an agent nor lets them set their own metadata.
- Teach files: migration 0192 replaces `app.record_voice_session()` with a seven-argument version. It links `audio_file_id` and `transcript_file_id` once, never replaces them, only with the person's yes to the recording question, and only a `knowledge` file that person uploaded. `RecordVoiceSessionInput` and the DTO (`filesLinked`) carry them, and DATABASE describes it.
- Ask through the voice token:
  - `askRouteDeps().bearer` is `voicePrincipalFromToken`. The Ask route now takes a `voice_session` principal only from a bearer token, and a person only from the cookie.
  - `knowledge.ask.record` is people-only, so I added an opt-in to the command guard: `defineCommand({ voiceSession: true })` lets a person's own voice session run a people-only command. Agents and the system are still refused. `knowledge.ask.record` is the one command that opts in; this is a one-line change in B1's file.
- The lead's two tests:
  - (a) `agent-refusals.test.ts`, new describe: a voice session holding every needed grant is refused at the guard by every people-only command except the opt-in list, which the test pins to `knowledge.ask.record`.
  - (b) `apps/web/src/voice/voice-token-routes.test.ts`: the modules that read the voice token are exactly four, and the routes reaching them are exactly `ask`, `voice/session` and `voice/token`. Any new reader or route fails the test.
- P5's webhook tests now expect LiveKit's handler. The fixture's `room_started` delivery is processed and handled with no code, where it used to be `no_handler`.

**Tests added**
- `apps/web/tests/voice-webhook.test.ts`: 5 tests.
- `voice-sessions.test.ts` (db): 1 test for the file link.
- `ask-route.test.ts`: 1 test. A voice token's question is answered, with `knowledge.ask.record` audited as the session. A voice principal arriving through the cookie, or a person arriving through the token, is refused.
- `run-command.test.ts`: 1 test for the opt-in.
- The voice sweep in `agent-refusals.test.ts`.
- `voice-token-routes.test.ts`: 3 tests.

**Checks**
- Typecheck of contracts, domain and web passed.
- Postgres runs:
  - db `voice-sessions` 10 passed.
  - domain `voice-sessions` and `agent-refusals` 59 passed, then `agent-refusals` and `ask*` 75 passed after the opt-in.
  - web `voice-webhook`, `webhooks` and `ask-route`: 27 passed.
- Unit runs: domain `src/command` 157 passed; web `src/voice` 14 passed; db `src/docs` 23 passed after `pnpm db:docs`.
- ESLint on every touched folder is clean, after one fix. The whole security suite was not rerun after this round; the full run above was before it.

**Stopped at step 6: the brief and the governing documents conflict.** Each point needs the lead's or the owner's decision before the worker and the page are built.
1. **Import fence (AGENTS §3).** `apps/voice-agent` may import `@shakti/contracts` only. V1's streaming adapters (`apps/web/src/integrations/voice`: the ports, Sarvam's sockets, `claude-stream.ts`, `roman-script.ts`, the `http.ts` wrapper) live in `apps/web`, and `claude-stream.ts` reads `AGENT_DEFAULTS` from `@shakti/domain`. The worker can reuse none of them without breaking the fence or copying them, and copying breaks "never duplicate a helper". A new shared workspace package would need a `pnpm-lock.yaml` change, which I may not make. Options:
   - (a) Move the framework-free adapters, which need only Node's `fetch` and `WebSocket`, into a subpath of `@shakti/contracts` such as `@shakti/contracts/voice`, not re-exported from its index so browser code never loads them, and have `apps/web` import them from there. This changes what contracts holds.
   - (b) The lead adds a `packages/voice` workspace with its lockfile entry.
   - (c) The model's turn runs on the BOS behind a voice-token route, and only speech stays in the worker. That route would still need the speech adapters in the worker.
2. **"No long-lived secret".** The 1.5-second budget needs the worker to call Sarvam (speech) and, under (a) or (b), Anthropic directly, so it would hold those vendor keys as LiveKit Cloud secrets, beside LiveKit's own credentials. I read the checklist line as "no BOS credential": no database URL, no signing key, no service role, only the 5-minute token. Please confirm. Under (c) the Anthropic key stays on the BOS.
3. **Teach drafts are for people only.** `knowledge.playbook.draft` (K2) is people-only, and test (a) holds a voice session to that. My proposal: the worker sends each drafted directive to the `/voice` page over the room's data channel, and the person saves it with one tap through K2's own command under their session. This is the same rule as SECURITY §3.4's "confirms with a tap". With that, no playbook route takes the voice token, and the allowlist in test (b) stays at three routes.
4. **Teach recording.** Filing the audio and transcript in the vault is `files.upload.*` plus `knowledge.file.add`, and `knowledge.file.add` is people-only, so the worker cannot file them as the person. The link on the session (0192) is built; who files the files is open. Options:
   - The page files them with one tap, which needs the audio in the browser.
   - A platform command records them as `exec_only` for the person. That needs its own grant, `voice.session.record` widened or a new one.
   - LiveKit Egress writes to our bucket. That is a new vendor feature.
5. **Browser LiveKit package (step 7).** `/voice` must join the room from the browser. The browser counterpart is `livekit-client`, which is not installed, so as the brief says I stop rather than install it. The page can be built against a small room port with a fake room, but it can only talk to a real room once the owner approves the package.

Steps 6 to 9 wait for these answers. Steps 7 and 8's page journeys depend on the data-channel messages that 3 and 4 decide.

**Open**
- The 24-month retention of `voice_sessions` (§11, for the CA to confirm) has no job. It was not to be built in V2, by the lead's message.
- Migrations 0189 to 0191 are as the lead read them; 0192 is new in this round.

### Steps 6 to 9, 17-11-2026 (the lead's cloud VM, worktree `v2-voice`, Postgres 54335)
Built on the lead's answers to the step 6 stop. Skills loaded this round: `vercel-react-best-practices`.

**Built**
- **`packages/voice` (`@shakti/voice`), decision 1 (b).** V1's streaming adapters moved here, with their tests: the ports, sockets, Sarvam, the Claude stream, latency, Roman script, vendor JSON, the recorded replays, the WAV and recording helpers, and the vendor HTTP plumbing. `apps/web/src/integrations/http.ts` re-exports the plumbing beside its signature helpers. The `apps/web` copies are deleted.
  - `claudeConfig()` takes its model settings as a parameter. The web app passes `AGENT_DEFAULTS.voice` (`integrations/voice/voice-model.ts`); the worker passes `VoiceDispatchMetadata.model`, which the session route fills from `AGENT_DEFAULTS`: model, effort, thinking, answer length, Teach's drafting length (`playbook.draftMaxTokens`), the model's prices, `paisePerUsd` and the new `voice.speechPaisePerMinute` (50, Sarvam's published ₹30 an hour).
  - The reply step now takes the conversation so far, hands over each sentence as it ends, and stops on a signal (barge-in).
  - `pnpm install` ran once. `pnpm-lock.yaml` gained only importer entries: the new `packages/voice` importer and the two `link:` lines; no package was added or changed. `@shakti/voice` is in Next's `transpilePackages`.
  - The journeys import `@shakti/voice/recording` directly, because the package index loads the contracts' JSON, which Playwright cannot import.
- **Fences.** In `eslint.config.mjs`, with cases in `lint-fences.test.ts`:
  - `apps/voice-agent` imports only `@shakti/contracts`, `@shakti/voice`, `@livekit/agents`, `@livekit/rtc-node`, `zod` and `node:` modules, and no other app's or package's file by a relative path.
  - `packages/voice` imports no `@shakti/db` or `@shakti/domain` module.
  - No page, component or screen helper imports `@shakti/voice`.
  - AGENTS §3 records the package and the three fences.
- **The `livekit` handler** (step 5, in the earlier round) is unchanged. The worker's report carries the recording's file id.
- **Teach recording, decision 4.**
  - `POST /api/v1/voice/recording` takes the voice token. It works only for a live Teach session with the recording yes, and only for a person who may file an Executive-only file (`knowledge.vault.write` and `knowledge.vault.read.exec`, so a GM is refused). It runs `files.upload.begin` with the session id as the idempotency key, so there is one file per session.
  - `POST /api/v1/voice/recording/complete` runs `files.upload.complete` (the checks run as for any upload), then `knowledge.file.add` as the voice principal with `exec_only`, then the platform's link through `voice.session.record` (0192).
  - `knowledge.file.add` opts in with `voiceSession: true`. Test (a)'s opt-in list now has it, with its reason, and test (b)'s allowlist has the two routes.
  - Deviation from the message: no transcript is uploaded. K3's index job transcribes the vault recording, masks the transcript and keeps it as the vault file's own text, so `transcript_file_id` stays empty.
  - The worker records only the person's speech, at 8 kHz, so 15 minutes fit the 25 MB vault upload.
- **`apps/voice-agent`, the worker.**
  - `main.ts`: `defineAgent` and `ServerOptions` with `agentName` `shakti-voice`. It refuses a room not named after its session.
  - `livekit-room.ts`: the `RoomPort` over `@livekit/rtc-node`. The person's audio comes in at 16 kHz, messages go on the reliable data channel (topic `shakti`), and the report goes out as the worker's participant metadata.
  - `session.ts`, the turn engine:
    - Sarvam streaming speech-to-text, with each sentence spoken as it ends.
    - Barge-in on the person's `speech_start`.
    - Captions, the light and the minutes go to the page.
    - When speech-to-text fails or is not set up, it falls back to push-to-talk and typed questions.
    - Each turn is timed by step (`final_transcript`, `first_sentence`, `first_speech`, `first_audio`). `end_of_speech` is not measured: Sarvam reports no voice-activity latency.
    - Spend is counted from the dispatch's prices, and the session ends itself at the day's spend.
    - It also ends itself at its longest length, 30 seconds before `notAfter` (decision 2), so the recording is still filed while the session is live.
  - `responders.ts`:
    - Ask goes through `/api/v1/ask` as the person. It speaks two sentences and shows the cited cards.
    - Teach is a Sonnet 5.5 interview with the conversation kept. On the page's Make drafts tap, it drafts directives as JSON, read through `VoiceDraft` (at most five).
  - `bos-client.ts`:
    - It refreshes the token a minute before expiry. A refusal ends the session; a network failure is retried while the token lasts.
    - It also covers Ask and the recording upload.
  - `config.ts` reads only vendor keys. `Dockerfile` (built from the repository root and run with the root's `tsx`) and `.env.example` name them. There is no CI change.
- **Contracts.**
  - `VoiceDispatchMetadata` gains `notAfter` and `model`.
  - New: `VoiceRecordingRequest`, `VoiceRecordingCompleteRequest`, `VoiceRecordingCompleteResponse`, `VoiceWorkerReport` (earlier), and the data-channel messages `VoiceRoomMessage` and `VoicePageMessage` (`text`, `push_to_talk`, `make_drafts`, plus `VoiceDraft`).
  - Eight Talk to Shakti voice prompts (`TALK_PROMPTS`) in Hinglish and English, which the copy lint reads.
  - The `voice.recording` and `voice.recording.complete` endpoints with their fixtures, the `voice_recording_refused` reason, and two rows in API §3.1.
- **`/voice` (step 7)**: the page, its layout, its `/voice` client scope, the menu line "Talk to Shakti" (`voice.use`) in `nav.ts`, the session gate, a home hint, and `readVoiceToday` (`voiceToday()`: minutes left, read under the person's policy in the companies viewed).
  - The screen asks the recording question before each talk, with no default; Start stays disabled until it is answered. It offers Ask or Teach and shows the minutes left.
  - During a talk it shows the light, the captions, the cited records as links, push-to-talk and a text box when the state says so, and Make drafts in Teach. Each draft card is saved by the person through K2's `draftDirective` action on their cookie session (decision 3).
  - The page reaches its room only through `window.shaktiVoiceRoom`. Without one installed, Start says "not set up" before anything is written, so `livekit-client` is still not installed (question 5).
  - `setUp` means LiveKit and the issuer are set; the start route still checks the signing keys.
  - The journeys' `next start` gets LiveKit stand-in phrases in `playwright.config.ts`, so the page offers a talk.
  - Copy is in `en.json`. The new button keys are in `copy-lint.config.json`, and `/voice` has a JavaScript budget (204 kB: 193.7 kB measured plus 5 %).
- **Documents (step 9).** SECURITY §3.4 has three new rows: the worker's environment and its own end; the routes that take the token and the two opted-in commands; the recording. The design's "Built (V2)" is under §7.5. DATABASE covers the file link, `pnpm db:docs` was rerun, AGENTS §3 is updated, and `apps/voice-agent/.env.example` is new. Neither `turbo.json` nor the root `.env.example` changed: the BOS reads no new variable.

**Tests added this round**
- `apps/voice-agent`: 15 tests.
  - `session.test.ts` (9): turn timing by step, barge-in, the fall back to push-to-talk and text, starting with no speech service, the end at its longest length and at the session's own limit, the end by the BOS or by the person leaving, the recording filed, Teach drafts.
  - `bos-client.test.ts` (6): refresh, refusal and retry; Ask's answer and its error line; drafts, spend, the recording buffer.
- `@shakti/voice`: 2 new tests (sentences streamed with history; the stop). The package's 49 tests include the moved ones.
- `apps/web`:
  - `integrations/voice/voice.test.ts`: 1 new, plus the LiveKit and checklist tests that stayed here.
  - `voice-token-routes.test.ts`: 3 tests, now listing 5 routes.
  - `voice-screen.test.tsx`: 3 tests.
  - `lint-fences.test.ts`: 3 new cases.
  - `tests/voice-recording.test.ts`: 2 tests on Postgres.
  - `e2e/voice.spec.ts`: 2 journeys in each of the 3 projects, the first with axe at three points.
- Domain: the sweep's opt-in list covers `knowledge.file.add`.

**Checks**

| Check | Result |
|---|---|
| `pnpm test:security` on 54335, through `heavy.sh` | db 1442 passed (54 files). domain 1251 passed, 2 failed in `ask-cost.test.ts` (B1's): its random tag held nine digits, so the masking turned it into `[number]` and the lookup found nothing. That file rerun alone: 2 passed. Turbo then stopped before web, so web ran on its own: 410 passed (34 files). |
| `pnpm lint` (whole repository, through the lock) | exit 0 |
| `turbo run typecheck test` | 19 of 19 tasks; unit tests: domain 2545, web 1075 (1 skipped), contracts 197, db 158, ui 107, tokens 146, voice 49, voice-agent 15, copy-lint 17 |
| `pnpm copy-lint` | clean |
| `pnpm --filter web build` | passed |
| `js-budget` | passes with `/voice` at 193.7 kB |
| Journeys `voice`, `ask`, `knowledge-audio` in desktop light, desktop dark and phone | 35 passed, 6 failed. Both voice journeys passed in all three projects, axe included. The 6 failures are the existing screenshots of `ask` (snapshot Executive) and `knowledge-audio`, failing on font rendering: every glyph differs between this VM's Chromium and the Playwright image's baselines. I deleted the `voice-start` and `voice-live` pictures this run wrote. The menu line changes the Executive's and GM's shell, so the baselines need remaking in the Linux image at integration. |

**Decisions the messages did not settle**
1. The Ask route takes a `voice_session` principal only from a bearer token and a person only from the cookie.
2. `voiceSession: true` is the opt-in: a people-only command with it is open to a person's own voice session.
3. `/voice` reaches its room through the `window.shaktiVoiceRoom` seam until `livekit-client` is approved.
4. The worker leaves 30 seconds before `notAfter`, so the recording is filed while the session is live.
5. The worker's identity is LiveKit's own (`agent-…`). The handler recognises it by LiveKit's `AGENT` kind, not by an identity prefix.
6. Teach's drafting is a separate model call with the Playbook's draft length, triggered by the person's tap rather than by the model.
7. Spend counts only the model and Sarvam's speech-to-text price. Text to speech and LiveKit minutes wait for the vendors' quotes.
8. An Ask answer is spoken as its first two sentences; the cards show the rest.

**Open**
- **Masking before the model (SECURITY §3.4).** Teach's interview text goes from the worker to the model without the identity masking of `packages/domain/src/privacy`, which the worker may not import. This is a lead's decision: move `model-text.ts`, `number-shapes.ts`, `identity-numbers.ts` and `verhoeff.ts` into `packages/voice` (or contracts), or accept that an Executive teaching rules speaks no identity numbers.
- **24-month retention of `voice_sessions`.** §11 names it, for the CA to confirm. No job is built (the lead's instruction).
- **The browser's LiveKit client** (question 5, the owner's). Until it is approved, `/voice` cannot join a real room.
- **Screenshot baselines.** The voice baselines, and those the menu line changes, are made in the Linux image at integration.
- **Live verification.** The worker has not run against LiveKit Cloud, Sarvam or Anthropic, as no test calls a vendor. The p50 over 100 turns is G2's, on the owner's project.
- **Recording format.** A GM's Teach session keeps no recording: they read no Executive-only file. The audio is 8 kHz WAV of the person's speech only, not Shakti's.
- **Doc link check.** `check-doc-links.py` reports this run file as an orphan (not linked from `docs/runs/phase2/readme.md`, which is the lead's to edit), beside 8 existing `.claude/settings.local.json` paths.
- **Workshop pack.** It does not yet name the voice limits; question 12 was the owner's, not the client's.

### livekit-client and the real room, 17-11-2026 (the lead's cloud VM, worktree `v2-voice`, Postgres 54335)
Skills loaded this round: none (the brief's skills were loaded in the earlier rounds; this round adds no table or command).

**Package.** `pnpm --filter web add livekit-client@2.23.0 --save-exact` ran as given, with no refusal. `apps/web/package.json` gains `"livekit-client": "2.23.0"`. The `pnpm-lock.yaml` diff holds only livekit-client and its own tree: `@livekit/protocol` 1.52.1, `@types/dom-mediacapture-record` 1.0.22 (its peer), `loglevel`, `machina`, `sdp`, `sdp-transform`, `typed-emitter` (with `rxjs` as its optional dependency) and `webrtc-adapter`. `pnpm-workspace.yaml` is unchanged.

**Built**
- **The port** (`components/voice/room.ts`). `VoiceRoom` gains `onConnection` (`connected`, `reconnecting`, `lost`), `onSoundBlocked` and `startSound`. `voiceRoomConnector()` gives the room installed at `window.shaktiVoiceRoom` when a test put one there, else the LiveKit connector. That connector loads the adapter and `livekit-client` by `import('./livekit-room')` and `import('livekit-client')`, both plain string literals, only when Start is pressed. `voiceSupported()` checks for a microphone and real-time audio before anything is written on the BOS.
- **The adapter** (`components/voice/livekit-room.ts`). It is written against a narrow `LiveKitClient` interface; `room.ts` passes the real module in, so the compiler holds `livekit-client`'s `Room` to it.
  - It joins with the session's `url` and `participantToken`, with echo cancellation, noise suppression and gain control on.
  - The microphone is published on the first `setMicrophone(true)` and muted or unmuted after that.
  - The worker's audio track (LiveKit's agent kind only) is attached and mounted on the page, and taken off when unsubscribed or on leave.
  - Data comes in on `VOICE_DATA_TOPIC` from the agent only. Each message is checked by hand against the shape the page reads (`VoiceRoomMessage`), keeping only known fields. The repository's `shakti/browser-contract-types` rule bars Zod from browser code, so the lists it checks against are in a new `screens/voice-values.ts`, kept equal to the contracts by `contract-values.test.ts`. Messages that arrive before the page listens are kept for it.
  - The page's messages go out reliable on the same topic.
  - `reconnecting` and `reconnected` map to the page's reconnecting and connected. A `disconnected` the page did not ask for maps to lost. Leaving disconnects once (which stops the microphone), and nothing reaches the page or the room after it. A failed join disconnects before it rethrows.
  - The browser's held audio (`canPlaybackAudio`, `audioPlaybackChanged`) becomes `onSoundBlocked`; `startSound` calls `startAudio()` from the person's tap.
- **The page** (`voice-screen.tsx`).
  - It holds the talk's room in a ref and leaves it when the worker says the talk ended, when the person ends it, when the connection is lost, and on unmount. Before this round, an `ended` from the worker left the room open.
  - It shows "The connection dropped. Joining the talk again…" while reconnecting, and a "Turn on sound" button while the browser holds Shakti's voice.
  - It turns the microphone off when the worker switches to push-to-talk, so the microphone is on only while the hold button is held.
  - It names three failures in plain words: a browser that cannot talk (`voice_browser`, before anything is written), a failed join (`voice_connection`), and a refused microphone (`voice_microphone`, which leaves the room).
- **Copy** (`en.json`): `errors.voice_browser`, `errors.voice_microphone`, `errors.voice_connection`, `voice.live.reconnecting`, `voice.live.soundBlocked`, `voice.live.turnOnSound` (added to `copy-lint.config.json`'s button keys) and `voice.ended.lost`.
- **Documents.** The design's "Built (V2)" line on `/voice` (phase2.md §7.5) and the `/voice` budget's reason in `js-budget.json` now describe the room. `js-budget.json` is one of the check files, but it was already changed in this slice, so the owner's `checks-ok` was already needed.
- **A test made robust** (`packages/db/tests/security/voice-sessions.test.ts`, V2's own). The earlier-session case moved a session back 40 minutes and expected today's use to be 15 minutes. In the first 40 minutes after midnight in India (18:30 to 19:10 UTC), that start falls on the day before, and the count is 0. The first suite run here, at 18:57 UTC, failed on it. The case now reads which day the moved start falls on and expects 15 or 0.

**Tests added**
- `components/voice/livekit-room.test.ts`: 15 tests, against a fake of the `livekit-client` surface (no network, no room, no browser):
  - joining with the join phrase, and nothing published before the microphone is on;
  - a failed join leaves nothing behind;
  - the microphone published, muted and unmuted, and its refusal passed on;
  - the worker's messages taken from the agent on the voice topic only, with every malformed shape dropped;
  - only the fields the page reads kept;
  - early messages kept;
  - sending reliable on the topic;
  - the worker's voice mounted and taken off;
  - the browser's held sound and `startSound`;
  - the reconnect states mapped, and a lost room not used again;
  - leaving once, with nothing after it;
  - the connector taking a test's room, loading LiveKit (through `vi.mock('livekit-client')`) and mounting the voice;
  - `voiceSupported()`.
- `contract-values.test.ts`: four more equalities (the topic, the states, the end reasons, the cited record kinds).
- `e2e/voice.spec.ts`: the fake room gains the new port methods. The Executive journey now also checks:
  - reconnecting shown and cleared;
  - Turn on sound;
  - the microphone off in push-to-talk;
  - the room left when the worker ends the talk;
  - a second talk whose connection is lost, ending with the lost sentence and the room left.

**JavaScript budget** (`pnpm --filter web build`, then `js-budget`, through the lock). I ran it twice: first on this round's starting sources (`bb60c4fb`'s `apps/web/src`, `messages` and the voice journey), then on the branch.

| Page | Before | After |
|---|---|---|
| `/voice` | 193.7 kB gzip (628.1 raw) | 194.2 kB gzip (629.6 raw), budget 204 |
| `/` (public) | 158.8 kB | 158.8 kB |
| `/ask` | 194.6 kB | 194.6 kB |
| Every other page (52 in all) | | unchanged, row for row |

- The shell has no row of its own. The staff pages that carry it (for example `/ask`, `/admin/roles/[roleKey]` at 195.0 kB) are unchanged.
- `livekit-client` is one lazy chunk of 586.7 kB raw, 151.0 kB gzip. No route's first load names it in `route-bundle-stats.json`.
- A first build put the new lists in `contract-values.ts`, which most pages share. That grew 28 other pages by 0.1 to 0.2 kB gzip, so the lists moved to `voice-values.ts`, which only the room loads.
- "Every page is within its budget (52 pages)."

**Checks** (each through `bash tools/integration/heavy.sh`)

| Check | Result |
|---|---|
| `pnpm typecheck` | 10 of 10 tasks; web and copy-lint ran, the rest replayed from the cache with unchanged inputs |
| ESLint `--max-warnings 0` on `apps/web/src/components/voice`, `apps/web/src/screens`, `apps/web/e2e/voice.spec.ts`, `packages/db/tests/security` | clean |
| `pnpm copy-lint` | catalogues and templates are clean |
| Web unit tests (`pnpm --filter web exec vitest run`) | 146 files, 1090 passed, 1 skipped (1075 before) |
| `pnpm test:security` on 54335 | First run: db 1441 passed, 1 failed (the midnight case above), and Turbo stopped. After the fix, the whole suite ran (`turbo run test:security --concurrency=1 --continue`): db 1442 passed (54 files), domain 1253 passed (92 files), web 410 passed (34 files), 4 of 4 tasks |
| `pnpm --filter web build` and `js-budget` | passed, as above |
| Journeys `e2e/voice.spec.ts` (after `e2e:seed`, on the branch build) | 20 passed: both voice journeys in desktop light, desktop dark and phone, axe included, with the setup projects. The screenshots this VM wrote were deleted; the baselines are made in the Linux image at integration. |
| `pnpm lint` (whole repository, last) | exit 0 |

**Decisions the message did not settle**
1. The adapter takes the `livekit-client` module as a parameter, typed by a narrow interface that the real module must satisfy. This is the seam for the unit tests' fake. Both the adapter and the package load only on Start.
2. Messages from the room are checked by hand, not with Zod: the repository's lint rule bars Zod from browser code. The page's own outgoing messages are typed and sent as they are.
3. The port gained three members (`onConnection`, `onSoundBlocked`, `startSound`), since reconnects and the browser's autoplay hold need the page. The journey's fake implements them.
4. A refused microphone ends the talk with a plain sentence rather than falling back to typing. The worker records the minutes when the person leaves.
5. The page turns the microphone off when the worker switches to push-to-talk.
6. The answer to the recording question still stays chosen after a talk ends (as built in the earlier round). A second talk in the same visit starts with the same answer unless the person changes it. The reviewer may want it cleared after each talk, since the brief says "before each session".

**Not verified**
- No real LiveKit room was joined; no test reaches the network. A join against the owner's LiveKit Cloud project, with real audio, autoplay on iOS Safari and a real reconnect, is unverified and waits for that project, with G2's measurement.
- The new copy's screens have no screenshot baselines (the reconnecting line and Turn on sound are checked by the journey, not by a snapshot).

### Fix round, 17-11-2026 (the lead's cloud VM, worktree `v2-voice`, Postgres 54335)
The review's one fix round, from `6f139174`. Skills loaded: none this round (the brief's `add-table` and `add-command` were loaded in the earlier rounds; this round adds a column and changes two definers and no command).

**Findings and their fixes**

| # | Fix | Test (fails before, passes after) |
|---|---|---|
| H1 | The pure masking modules move to `packages/contracts/src/masking/` (`model-text.ts`, `number-shapes.ts`, `identity-numbers.ts`, `verhoeff.ts`, with the tests of the first, third and fourth), exported as `@shakti/contracts/masking`, which `packages/contracts/src/index.ts` does not re-export. `packages/domain/src/privacy/*` re-export them, so every caller is unchanged. The worker's `teachResponder` (`apps/voice-agent/src/responders.ts`) masks each turn before `model.reply()`, keeps the masked turn in its history, and masks the drafting transcript again as a whole. Ask sends no text to a model from the worker: `/api/v1/ask` masks on the BOS. Fence: `@shakti/contracts/masking` is barred from `apps/web/src/app`, `components` and `screens` (`eslint.config.mjs`). | `apps/voice-agent/src/responders.test.ts`: a Verhoeff-valid Aadhaar number spoken in groups, a 14-digit account number and a mobile number in two Teach turns. None of them reaches the fake model unmasked, in the turns, the history or the drafts; `[number]` and `[phone]` reach it. `lint-fences.test.ts`: a new case refuses the subpath in a page, a component and a screen helper, and allows it in a server module, the worker and the domain (checked failing with the old `eslint.config.mjs`). |
| M1 | `app.voice_session_open()` (new migration 0194) answers `ended_sessions`, the person's earlier sessions it ended. `voice.session.start` returns them as `endedSessionIds`. After the transaction, the start route (`apps/web/src/voice/handlers.ts`) deletes their rooms through `livekit.ts`'s `deleteRoom`, in parallel with making the new room. A failure is logged as `voice.room_delete_failed` and never blocks the start. A superseded session ends with the minutes it actually ran, capped at its own length. `app.record_voice_session()` lets a later end (LiveKit's `room_finished`) raise the minutes up to the session's own length. It never lowers them, and the first recorded end stays. The worker ends its session when its room closes under it (`RoomEvent.Disconnected` in `livekit-room.ts`). The end then runs through even when the closed room refuses the last messages. | `packages/db/tests/security/voice-sessions.test.ts`: the second open answers the first session's id, and the first gets at most 1 minute. A `room_finished` 4 minutes after its start raises it to 4 (before the fix: `unchanged`, 0), with the end kept, and an earlier report lowers nothing. `handlers.test.ts`: the earlier rooms are deleted, and a failing delete still answers 200. `voice-sessions.test.ts` (domain): `endedSessionIds`. `session.test.ts`: the end runs through on a closed room. |
| M2 | `voice_sessions.max_minutes`: a new column in a new migration (0193, after 0192). Rows already present get 15, the one length they had. It is NOT NULL, with a check of 1 to 1440, and it is set at open to `least(session minutes, day minutes − used)`. `voiceSessionLive()` and `voiceSessionNotAfter()` read it, and so do the refresh (`voice.session.token`), the grant's new `notAfter`, the BOS token, the join token's lifetime, the dispatch's `notAfter` and `limits.maxSessionMinutes`, and `voiceToday()` for a session still open. The dispatch's `paiseRemainingToday` was already the day's cap less the day's recorded spend. It is now asserted. | DB: `keeps the session its own longest length`: 15, then 2 with 28 minutes used, kept on the row. A later start an hour on counts only those 2. Domain: a person at 28 minutes and ₹165 gets `maxSessionMinutes` 2, `paiseRemainingToday` 3,500 and `notAfter` = start + 2 minutes. The refresh's `notAfter` matches, and 3 minutes on the refresh is refused (`voice_session_ended`). Route: the dispatch's `notAfter` and limits, the BOS token cut to 2 minutes, and a 2-minute join token. |
| M3 | `/voice` (`voice-screen.tsx`) keeps the day's minutes apart from the talk's. The live header reads "N minutes left in this talk" (new key `voice.live.talkMinutesLeft`). The top line is the day's minutes at the start less the talk's minutes used (`dayMinutesLeft()`). After every talk and every failed start, the day's minutes and a talk's length come from the server again (`readVoiceToday`). | `voice-screen.test.tsx`: `dayMinutesLeft` (a full talk leaves 15 of 30, not none). `e2e/voice.spec.ts`: "12 minutes left in this talk" and "17 minutes left today" during a talk. After a talk that ran to 0, the day line reads the server's 30, not the stand-in's 20, and Start is enabled once the question is answered. |
| M4 | The recording answer is cleared in `finish()` (every talk's end) and on every failed start (`failStart()`): a browser that cannot talk, a refused start, a failed join and a refused microphone. | Journey: after the talk, both answers are unchecked and Start is disabled. After a start the BOS refuses (`voice_cap_reached`, stood in by the route), the reason shows, the answer is cleared and Start is disabled. |
| M5 | The worker says and hears nothing until the person is in the room (`RoomPort.onPersonJoined`, from LiveKit's participant events). It leaves after `PERSON_JOIN_WAIT_MS` (60,000) without them. A session whose room could not be made is ended at once through `voice.session.record` as the platform (`SessionRouteDeps.endUnopened`), with the minutes it used (whole minutes, rounded up). | `session.test.ts`: with no person, nothing is spoken and no speech stream opens. At 60 seconds the session ends (`ended`), reports, stops its BOS client and leaves. A person who joins within the minute gets the greeting. `handlers.test.ts`: a failed room ends that session at once. |
| L1 | `/voice/recording/complete` takes only the file of the upload begun for its session. The new domain query `voiceRecordingUpload()` reads it from the person's own `idempotency_keys` row (key = the session's id, command `files.upload.begin`). Any other id is refused with `forbidden` (`voice_recording_refused`) before anything is completed, filed or linked. | `apps/web/tests/voice-recording.test.ts` (Postgres): the person's own other knowledge upload is refused, before and after the session's upload is begun. No vault file and no link (checked failing with the old route). |
| L2 | The worker registers with its own key of the project, `LIVEKIT_AGENT_API_KEY` and `LIVEKIT_AGENT_API_SECRET` (`agentCredentials()` in `config.ts`, passed to `ServerOptions` in `main.ts`). It refuses to start with the BOS's `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` in its environment, which the Agents framework would otherwise read. `apps/voice-agent/.env.example` and SECURITY §3.4 name them. The BOS's webhook check already pins its own key as issuer and its own secret. | `apps/voice-agent/src/config.test.ts` (3): its own key, a refusal with either BOS name, a refusal without the agent key. `checks.test.ts`: a delivery signed with a worker key pair is refused (`bad_token`). It passed before too: the code path already took no other key. |
| L4 | `costPaise` is a new field kind `paise` in `screens/audit.ts`, shown as `money` through `moneyFromPaise()` and the app's rupee formatter. The label is "Spend". | `screens/audit.test.ts`: 1,250 paise shows as `12.50`, and 7 as `0.07`. |
| L5 | The design's Built (V2) and SECURITY §3.4 now say that K3 transcribes only with `KNOWLEDGE_TRANSCRIBE=on`, and that without it a recorded session keeps audio and no transcript. They also record H1's masking, M1, M2, M5, L1 and L2. DATABASE (`max_minutes`), API (`/voice/session`, `/voice/recording/complete`) and AGENTS §3 and §9 (the subpath and its fence) are updated. The documents that named the moved files now point to `packages/contracts/src/masking` (PRD, SECURITY §5, the OCR appendix, phase 1 §5.2). `pnpm db:docs` was rerun. | `data-docs.test.ts` (in the db unit run, 158 passed). |
| L3 | Not changed (follow-up, below). | – |

**Checks** (each through `bash tools/integration/heavy.sh`, on the branch at `c0ccf842` or its parent)

| Check | Result |
|---|---|
| `pnpm typecheck` | 10 of 10 tasks successful |
| ESLint `--max-warnings 0` on each touched folder (`packages/contracts/src/masking`, `packages/domain/src/privacy`, `ports`, `queries/voice`, `commands/voice`, `packages/db/src`, `apps/voice-agent`, `apps/web/src/voice`, `screens`, `components/voice`, `e2e/voice.spec.ts`, the test files, `eslint.config.mjs`) | clean |
| `pnpm copy-lint` | catalogues and templates are clean |
| Unit tests | contracts 321 (24 files; 197 before plus the 124 moved masking tests), domain 2421 (95 files; 2545 before less the 124 moved), web 1096 passed and 1 skipped (146 files), voice-agent 22 (4 files), voice 49, db 158 |
| `pnpm test:security --continue` on 54335 | db 1444 passed (54 files), domain 1255 passed (92 files), web 411 passed (34 files): 4 of 4 tasks successful |
| `pnpm db:docs` | regenerated; `docs/data/data-dictionary.md` and `erd.md` committed |
| `pnpm --filter web build`, `js-budget` | build passed. `/voice` is 194.4 kB gzip (194.2 before), within its 204 kB; every page is within its budget (52 pages) |
| Voice journeys (`e2e:seed`, then `e2e/voice.spec.ts`) | 20 passed (both journeys in desktop light, desktop dark and phone, axe included, with the setup projects). The screenshots this VM wrote were deleted, since the baselines are made in the Linux image at integration |
| `pnpm lint` (whole repository, last) | exit 0 |

**Decisions the message did not settle**
1. `redactText()` moved too. `maskForModel()` ends with it, so the masking set has no import outside itself only with it. It lives in `masking/redact-text.ts`, and `ports/redaction.ts` (and `@shakti/domain/redaction`) re-exports it. The browser's Sentry chunk, loaded lazily after first load, reaches the masking index through `@shakti/domain/redaction`, as it reached `number-shapes` before. No page's first load changed except `/voice`, by 0.2 kB.
2. `number-shapes.test.ts` stays in `packages/domain/src/privacy`, through the re-exports. It checks the import filter, the audit redaction and the model masker against each other, and those first two are domain modules.
3. A later `room_finished` raises minutes for every session, not only a superseded one. The cap is the session's own length, and the first recorded end stays. Two existing expectations changed with it: the DB "only moves forward" case and the web handler's "a later finish changes nothing", which now expects the raise to 15 and an earlier finish lowering nothing.
4. The migration's backfill writes 15 for rows that already exist (the one length sessions had). No hosted database has the table yet.
5. The worker waits for the person before it greets or listens. Before this, a greeting spoken before the person joined was lost. A room that closes under the worker reaches the session as "the person left".
6. A session whose room failed is ended at the route's own time, with minutes from the times, rounded up (normally 1).
7. The recording's own upload is found from the idempotency key that `files.upload.begin` already wrote. No new column or table.
8. The rooms of earlier sessions are deleted while the new room is made, and both are awaited before the answer. LiveKit's 5-second timeout bounds both.

**Open**
- **L3** (follow-up, unchanged): `VoiceSessionResponse.bosToken` still reaches the browser, which never uses it. Script on `/voice` could use up the session's refreshes with it. Drop it from the contract in a change of its own; the dispatch already carries it.
- Not verified live: no LiveKit room was joined or deleted, and no Sarvam or Anthropic call was made (no test reaches a vendor). Unverified are LiveKit Cloud's `DeleteRoom` on a room with a dispatched agent, the worker's `Disconnected` event when its room is deleted, `ServerOptions` with the worker's own key, and LiveKit signing webhooks with the BOS's key while the worker holds another key of the same project. These wait for the owner's LiveKit project, with G2.
- The voice screenshots (start and live, in three projects) still need Linux baselines at integration. The live view's header line now reads "minutes left in this talk".
- The doc link check still reports this run file as an orphan and the 8 `.claude/settings.local.json` paths, as before.
- 24-month retention of `voice_sessions` and the workshop pack's voice limits stay as the earlier report left them.

## Review
### slice-reviewer, 17-11-2026 (Tier A, `feat/v2-voice` at 32cebfc3 against `main` at 9b6ea163)
Verdict: **one high finding blocks the merge** (H1, or the lead's and owner's written acceptance in SECURITY §3.4). M4 is a one-line fix to make now; the other medium ones are short fixes or follow-ups as the lead decides.

| # | Severity | Where | What is wrong, and how it fails | Fix | Status |
|---|---|---|---|---|---|
| H1 | high | `apps/voice-agent/src/responders.ts` (`teachResponder`: `model.reply(TEACH_SYSTEM, text, …)` and the drafting `transcript`) | Teach sends each spoken turn, transcribed by Sarvam, to Anthropic unmasked, and the whole interview again at Make drafts. SECURITY §3.4 (line 347: "PII masking before any model call"), BLUEPRINT §9.2 and ADR 0010 require masking before any model call. An Executive who reads out a customer's Aadhaar or bank number while teaching a rule sends it to the model in full. The builder left this open for the lead, and no document records an exception. | Move the pure masking (`model-text.ts`, `number-shapes.ts`, `identity-numbers.ts`, `verhoeff.ts`) into `packages/voice`, which has no database or domain dependency. Mask each turn before `reply()` and the drafting transcript, and add a worker test with a Verhoeff-valid twelve-digit number. Or the owner accepts the gap, and SECURITY §3.4 and the design's Built (V2) say so. | confirmed (code read end to end) |
| M1 | medium | `packages/db/migrations/0190_voice_sessions_rls.sql` (`voice_session_open`, the `update … where vs.user_id = v_user and vs.ended_at is null`); `0192` (`record_voice_session`: `when v.minutes is not null then v.minutes`); `apps/web/src/voice/handlers.ts` (start route) | A new start ends the person's earlier session in the database, but nothing closes its LiveKit room. Its worker keeps talking: Teach needs no BOS call until the refresh at about 4 minutes, which is refused. When that room finishes, its minutes never go up again. Each worker of a parallel room also holds the full `paiseRemainingToday` from its own dispatch. Proved on 54335 (rolled back): session A opened, then B, gives A `minutes` 0; `record_voice_session(A, now()+4 min)` then answers `unchanged`, still 0. With two tabs and the cap of 10 starts in 5 minutes, a person can talk well past the 30 minutes and ₹200 of question 12. | Have `voice_session_open()` return the sessions it ended, and have the route delete their rooms (`liveKitRooms().deleteRoom`, already in `livekit.ts`). Or refuse a start while a session is live (`conflict`). Also let a superseded session's minutes follow its room's real end, capped at the session's longest length. | confirmed (query) |
| M2 | medium | `apps/web/src/voice/handlers.ts` (`voiceSessionNotAfter(new Date(grant.startedAt))`); `packages/domain/src/queries/voice/sessions.ts` (`voiceSessionLive`, `voiceSessionNotAfter`) | The BOS backstop is always start + 15 minutes, even when `limits.maxSessionMinutes` is `min(15, minutes left)`. A person with 2 minutes left gets a token, live checks and refreshes for 15 minutes. So the day's minute cap after the start rests only on the worker obeying its dispatch, yet SECURITY §3.4 calls the BOS refusal past `notAfter` the backstop. | Keep the session's own longest length (or its `not_after`) on the row at open (`min(15, left)`). Use it in `voiceSessionLive`, `voiceSessionNotAfter`, the refresh and the dispatch, and test it with a person at 28 minutes. | confirmed (code read) |
| M3 | medium | `apps/web/src/components/voice/voice-screen.tsx:107` (`setLeft(message.minutesLeft)`), `:238` (`noMinutes={left === 0}`), `:341`, `:386` | The worker's `minutes` message is the minutes left in this talk (`maxSessionMinutes − elapsed`, `session.ts` `sendMinutes`), but the page writes it into the "minutes left today" line. Example: 30 minutes left today and a 15-minute talk. At the start the line reads "15 minutes left today", which is wrong. If the last report of a full talk is 0, the line reads "No minutes left today" and Start stays disabled, although 15 minutes remain, until the page is reloaded. The live header also labels the talk's own minutes "left today". | Keep the day's count apart: `minutesRemainingToday − (maxSessionMinutes − message.minutesLeft)`, or read `readVoiceToday` again after the talk. Label the live count as this talk's. Add a journey step: a talk that ends at its time leaves Start enabled. | confirmed (code read) |
| M4 | medium | `apps/web/src/components/voice/voice-screen.tsx:64` and `finish()` (`:89-95`) | The recording answer stays chosen after a talk, so a second talk in the same visit starts without the question being asked. ADR 0010, SECURITY §3.4 ("a recording question before every session") and the brief ("before each session") say otherwise. The builder flagged it (decision 6). | `setRecord(undefined)` in `finish()`, and after a failed start. Add a journey assertion that Start is disabled again after a talk. | confirmed |
| M5 | medium | `apps/voice-agent/src/session.ts` (`run()`: only `onPersonLeft` and the hard end), `apps/voice-agent/src/livekit-room.ts` | If the person never joins (`voice_connection` on the page after the session route succeeded: blocked WebRTC, a closed tab), the dispatched worker greets an empty room and opens Sarvam. It stays until 30 seconds before `notAfter`, because nothing ends it when no person arrives. The session then counts about 15 of the 30 daily minutes, plus 15 minutes of speech spend. Also, when `createAgentRoom` fails (`handlers.ts` catch), the session stays live. `voiceToday` counts its elapsed minutes until the next start. | End the worker with `ended` when no person joins within a short wait (for example 60 seconds), with a fake-room test. On a room that failed to open, record the session ended with 0 minutes through `voice.session.record`. | plausible (depends on whether LiveKit closes a room that holds only an agent) |
| L1 | low | `apps/web/src/voice/recording.ts` (`voiceRecordingCompleteRoute`) | `complete` takes any `fileId`. It is not tied to the upload begun under the session's idempotency key, so the token can file another of the person's pending knowledge uploads as `exec_only` and link it as the session's audio. Two concurrent completes are not serialised; only the link is single. Only the person's own files are affected. | Read the file begun with the session's key (or check `name`, `purpose` and `created_by` within the session's time), and refuse any other. | confirmed (code read) |
| L2 | low | `apps/voice-agent/.env.example` (`LIVEKIT_API_SECRET`); `apps/web/src/webhooks/providers.ts:154` | The worker's LiveKit secret is the same variable, and in practice the same key, that the BOS verifies LiveKit webhooks with. A leaked worker image or environment can forge `room_finished` or `participant_left` for any session. It could end the session, or set `cost_paise` up to 100,000,000 and lock the person out for the day. It can also mint a join token to any room. SECURITY §3.4 lists the key as a vendor key only. | Give the worker its own API key in the LiveKit project, sign the project's webhooks with a key the worker does not hold, and say so in SECURITY §3.4. | plausible (deployment) |
| L3 | low | `apps/web/src/voice/handlers.ts` (`VoiceSessionResponse.bosToken`) | The page never uses the worker's token but receives it. Script on `/voice` can call `/voice/token` with it and use up the session's 10 refreshes in 5 minutes, which ends the worker (a refusal under 500 ends the session), and the bearer token now lives in the browser too. The contract required it (early-check decision 6), so this is a follow-up only. | Drop `bosToken` from `VoiceSessionResponse` in a contract change; the dispatch already carries it. | confirmed |
| L4 | low | `apps/web/messages/en.json` (`audit` field `costPaise`: "Spend (paise)") | The Activity log shows a voice session's spend as a raw paise integer. Money reaches people in rupees (`docs/08-design-system.md` §11). | Format the value as rupees with a "Spend" label, as the other money fields do. | plausible |
| L5 | low | `docs/03-roadmap-appendix/phase2.md` Built (V2); `docs/07-security.md` §3.4 | The Built record says K3 keeps the recording's masked transcript. K3 transcribes only with `KNOWLEDGE_TRANSCRIBE=on` (SECURITY §6, line 381), so without it a recorded Teach session has audio and no transcript, while the brief names both. Neither document records H1's unmasked model call. | One line in Built (V2) on `KNOWLEDGE_TRANSCRIBE`, and H1's outcome in SECURITY §3.4. | confirmed |

**Checked and sound**
- **Migrations 0189 to 0192.**
  - `voice_sessions` has forced RLS and fails closed: a null user, permissions or companies deny. The select policy covers `app_user` and `app_reader`, and no request role holds a write grant.
  - Both definers set `search_path = ''`, check `voice.use:all` or `voice.session.record:all` in their body, and revoke execute from `public`, `readonly_reporter` and `app_reader`.
  - `app.platform_only_permissions()` keeps 0183's sixteen keys and adds `voice.session.record`; only 0178, 0183 and 0190 define it.
  - The `audit_logs_insert` branch for any other caller is 0033's clause, unchanged.
  - `app.request_is_person()` is 0113's body with one more condition.
  - 0191's two definers match 0095 and 0131, the latest definitions, apart from that call.
  - The other `principals.kind = 'user'` reads (0117 line 444, 0119's earlier `claim_push_subscription`, which 0131 replaced) admit no voice write.
- **Audit trail.** `auditBase()` writes the session as actor, `voice_session` as kind and the person in `on_behalf_of_user_id`. The policy holds a voice request to exactly that, and only for a session the person opened. `withRequestContext()` refuses a voice principal without its session.
- **Cost isolation.** `voiceSessionPrincipal()` removes `COST_PERMISSIONS` and narrows to the session's companies within the person's current ones. `app.has_perm` reads only the request setting, and no cost path checks the role key. `voice-cost.test.ts` asserts the Executive reads the row and the voice principal does not.
- **Token.** ES256, issuer, the `shakti-voice` audience and expiry are checked. The person is resolved again on every call. The session must be live (not ended, under 15 minutes) and the person's own (`user_id` filter). Refresh goes through the same check, so an ended or foreign session gets no token.
- **Routes and commands.** The route allowlist test (5 routes, 4 reader modules) is real and fails on a new reader. The guard's opt-in needs `voiceSession: true` on a people-only command (only `knowledge.ask.record` and `knowledge.file.add`), and the sweep pins that list. `voice.session.start` is for people only. The Ask route takes a voice principal only from a bearer token.
- **Webhook.** It goes through P5's signed inbox, one row per event id, and every value only moves forward. Only an `AGENT` participant's metadata counts, and the person's join token cannot set metadata.
- **Worker.** It holds vendor keys only. The ESLint fences hold (the new web block equals the general one plus `@shakti/voice`, so nothing is weakened). Its model comes from the dispatch, pinned to the priced model. Refresh is a minute before expiry, and a refusal ends the session. Its page messages are read from `user:` identities only and parsed with `VoicePageMessage`. Its replies and transcripts pass `romanOnly()`. It has no tools, so speech cannot drive a command, and drafts are saved by the person through K2.
- **Browser.** `livekit-client` and the adapter load only on Start. Data is taken only from the agent on the voice topic, checked field by field. The page imports only types from the contracts. `screenAccess(navRequires('voice'))` guards the page, and `readVoiceToday` goes through a named `executeQuery`.
- **Copy.** Every string is in `en.json` and plain (L4 aside).
- **Tests run.** `packages/db/tests/security/voice-sessions.test.ts` on 54335: 10 passed.

**Layout** (the builder's VM screenshots in `apps/web/e2e/test-results`, light, dark and phone): nothing out of line or cut off. The live view shows the minutes twice, once at the top and once beside "Your talk", with different meanings (M3).

**Not checked**
- The whole security suite. The run file's last full run passed; only the one file above was rerun.
- The journeys and the Linux baselines, which are made at integration.
- Whether LiveKit's dispatch metadata, which holds the BOS token, ever reaches a room participant. The browser already receives the same token (L3).
- How LiveKit Cloud closes a room that holds only an agent (M5).

## Integration
### Integration, 17-11-2026 (the lead, cloud VM)
- Review (6f139174): H1 high (Teach turns unmasked before the model), M1 to M5, L1 to L5. Fix round (861e470c): all fixed but L3 (the BOS token reaches the browser; a follow-up). The lead re-read H1: each Teach turn and the drafting transcript pass `maskForModel()` from `@shakti/contracts/masking` before the model.
- `main` taken in by a merge commit (43f49f11): `apps/web/package.json` resolved to main's versions plus `livekit-client` 2.23.0, the lockfile regenerated from main's; migrations 0189 to 0194 stay after main's 0188; `pnpm db:generate` no changes; `db:docs` rerun. main brought no migration, so every function and policy V2 redefines still matches main's latest.
- `integrate.sh` in parts: install, lint, format (one test file of V2's refactor reformatted), copy, generated, typecheck, unit; security on a fresh database (db 1,444, domain 1,255, web 411) and dbverify; audit, build, js-budget, gitleaks: all passed. The host journeys (voice, access) passed except access's not-found screenshot, a host-renderer difference that the Linux image does not show.
- Baselines on a fresh slot-5 database in the Linux image: `e2e:snap` first read /voice as not set up, because snap-in-linux.ts started the build without the stand-in LiveKit values playwright.config.ts gives its own server; both now take them from `e2e/setup/server-env.ts`. Then 41 passed with the six new voice baselines (light, dark, phone: start and live), each looked at, and the verification run without updating matched (41 passed).
- CI on #261 (54a3197e) failed the journeys for two causes of V2's own: the menu line Talk to Shakti lengthens the masked menu and the home page's list of screens for an Executive and a General Manager, so eighteen full-page baselines changed (design, agents, imports, integration health, pipelines, the two home pages; the phone home pages gain the Talk to Shakti card); and CI's own server (`ci.yml`, Start the app) lacked the stand-in LiveKit settings, so /voice read not set up there. `ci.yml` now passes them; the eighteen baselines were remade in the Linux image on a fresh database (the whole run, 522 passed), each change looked at, and a verification run of the seven affected journey files matched (138 passed).
### Lead's notes, 17-11-2026
- Early check passed (13:50 UTC): 0190's audit insert policy keeps 0033's clauses, `app.request_is_person()` keeps 0113's body, `app.platform_only_permissions()` keeps 0183's sixteen keys, 0191's two definers match 0095 and 0131 apart from the `request_is_person()` call. The four policies that read only `principals.kind` stay as they are; the sweep and the route allowlist cover them.
- Step 6 decisions (lead, 17-11): (1) `packages/voice` for the shared adapters, the worker's model settings in its dispatch; (2) the worker holds vendor keys only, no BOS credential; (3) Teach drafts saved by the person from `/voice`; (4) the recording filed as the person through the upload flow and two voice-token routes.
- The owner approved `livekit-client` 2.23.0 (17-11-2026, the newest release over two weeks old), pinned exactly in `apps/web` and loaded only on `/voice`; the lead adds it behind `window.shaktiVoiceRoom`'s port before the review.
- `ask-cost.test.ts` (B1's, on `main`) fails when its random tag is nine digits, which the masking turns into `[number]`; a follow-up on `main` gives the tag letters.
