# V2 Live voice Teach and Ask (wave 3)

| | |
|---|---|
| Branch | `feat/v2-voice` on GitHub, from `main` at 9b6ea163 |
| Worktree | `v2-voice`, slot 5 (Postgres 54335, app 3035), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an agent principal acting as a person, a platform-only grant, spend caps |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | built, for review |
| Next step | the lead's review and integration (baselines in the Linux image; `checks-ok` for eslint, playwright, copy-lint and scripts) |

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

## Review

## Integration
