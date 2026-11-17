# V2 Live voice Teach and Ask (wave 3)

| | |
|---|---|
| Branch | `feat/v2-voice` on GitHub, from `main` at 9b6ea163 |
| Worktree | `v2-voice`, slot 5 (Postgres 54335, app 3035), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an agent principal acting as a person, a platform-only grant, spend caps |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | early check |
| Next step | the lead reads the early check's diff |

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

## Review

## Integration
