# V2 Live voice Teach and Ask (wave 3)

| | |
|---|---|
| Branch | `feat/v2-voice` on GitHub, from `main` at 9b6ea163 |
| Worktree | `v2-voice`, slot 5 (Postgres 54335, app 3035), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an agent principal acting as a person, a platform-only grant, spend caps |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

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

## Review

## Integration
