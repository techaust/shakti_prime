# ADR 0010 — LiveKit Cloud with a TypeScript agent worker for live voice

**Status:** Proposed (27-09-2026); the LiveKit and speech-vendor spike (`docs/spikes/voice.md`) confirms it once the vendor sandboxes and 20–30 voice samples exist · **Date:** 27-09-2026 · **Deciders:** Lead developer; the owner accepts after review · **Blueprint:** §5, §9.2, §12, §13, §16, §17, §18 (risk 4) · **Architecture:** §2, §7 · **API:** §2, §3.1 (`/voice/session`) · **Security:** LiveKit tokens · **ADR:** 0003, 0011, 0014

## Context
"Talk to Shakti" lets Executives and GMs teach the Business Playbook, ask business questions and give commands by voice (blueprint §9.2). It needs WebRTC transport that works on Indian mobile networks, streaming speech-to-text for Hindi, Hinglish and Rajasthani-accented speech, Claude Sonnet 5 with tools, and streaming speech that pronounces Roman-script Hinglish naturally (ADR 0014), with barge-in and a median response under 1.5 s. The BOS runs on Vercel functions, which cannot hold a long-lived media session. The group has one developer and a TypeScript codebase.

## Decision
**LiveKit Cloud in the India region for transport, and a LiveKit Agents worker written in TypeScript (`apps/voice-agent`) hosted on LiveKit Cloud Agents.**

- The browser or app joins a LiveKit room created by `POST /api/v1/voice/session`, which returns the room name, a participant join token and, for the worker only, a 5-minute BOS token scoped to the speaking user (`VoiceTokenClaims`, `aud: shakti-voice`). The worker calls `/api/v1` with that token, so every tool call is a command run as the person, under their RLS scope and cost masking; it holds no database credentials and no service role.
- Pipeline: streaming STT → Claude Sonnet 5 (streaming, typed tools) → streaming TTS, with barge-in, live captions, push-to-talk and a text fallback. STT and TTS go through the speech adapter chosen by the voice spike's benchmark (lead candidate Sarvam AI), which may convert a Hinglish line to Devanagari internally for pronunciation and never stores or shows it.
- The worker image is built in CI and deployed to LiveKit Cloud Agents in the India region. If Mumbai placement is not offered, the same image runs on **AWS ECS Fargate in ap-south-1**, registered with LiveKit Cloud as a self-hosted worker; the choice is recorded after the spike.
- **Target:** p50 turn latency below 1.5 s, measured from the end of the person's speech to the first audio of the reply (blueprint §9.2, §17).
- **Consent and safeguards:** a recording question before every session (`consentRecording`), a visible listening indicator, PII masking before any model call, and per-user daily minute and spend caps checked when the session starts (`voice_cap_reached`) and enforced by the worker during it. Executives and GMs first.
- LiveKit webhooks (`/api/v1/webhooks/livekit`) close sessions and record minutes and cost in `voice_sessions`.

## Consequences
- The voice worker is the one long-running process outside Vercel; it is stateless beyond the call and scales with LiveKit's agent dispatch.
- The whole path stays TypeScript and reuses `@shakti/contracts`; no Python runtime to operate.
- Latency depends on three vendors in series; the spike measures each hop and the speech vendor is swappable behind its adapter if it misses the target or the pronunciation criterion.
- A LiveKit outage leaves the text fallback (Ask the Business) available; the runbook covers it (blueprint §12).
- Cost is bounded by the per-user caps; the estimate is $50–150 a month at about 300 executive minutes (blueprint §13), confirmed by vendor quotes in Phase 0.
- The recording, transcript and consent are kept per blueprint §7.9 (default 24 months).
