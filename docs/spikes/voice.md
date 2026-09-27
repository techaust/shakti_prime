# Spike: LiveKit and speech latency, Roman-Hinglish pronunciation

**Status:** ready to run. Provider interfaces, wrappers over plain HTTP and the timing harness are built and tested with fixtures; nothing has called a vendor yet.
**Roadmap:** §2 week 6 · **Blueprint:** §9.2 (target p50 below 1.5 s), §10 · **ADR:** 0014 (Roman-script Hinglish for speech)

## 1. What is built
| Piece | Where |
|---|---|
| Step interfaces: `SpeechToText`, `ReplyModel`, `TextToSpeech`, so vendors can be swapped | `apps/web/src/integrations/voice/ports.ts` |
| Sarvam AI (lead candidate): speech to text (`POST /speech-to-text`, multipart, `saarika:v2.5`) and text to speech (`POST /text-to-speech`, `bulbul:v2`, speaker `anushka`); models and speaker set by environment | `apps/web/src/integrations/voice/sarvam.ts` |
| Claude reply over the streaming Messages API (server-sent events), timing the first text and the end of the first sentence; model `claude-sonnet-5` (blueprint §9.2) at effort `low` unless `VOICE_SPIKE_MODEL` or `VOICE_SPIKE_EFFORT` say otherwise | `apps/web/src/integrations/voice/claude-stream.ts` |
| LiveKit: access tokens (HS256 over the API secret, `video` grant) and the room service (create, list, delete) over HTTPS, for the round trip to the project's region | `apps/web/src/integrations/voice/livekit.ts` |
| Timing: one turn = transcript, reply, speech of the first sentence (then the rest); `firstAudioMs` = transcript + first sentence + its speech, the measure the 1.5 s target applies to; nearest-rank p50 and p95 | `apps/web/src/integrations/voice/latency.ts` |
| Twelve Roman-Hinglish checklist lines (brand, HP, lakh and crore, kW, subsidy scheme, model code, date and time, document number, depth, recording notice, handoff) with what to listen for | `apps/web/src/integrations/voice/pronunciation-checklist.ts` |
| Fixture tests (stream parsing across chunks, request shapes, error mapping, token claims, turn arithmetic, checklist has no Devanagari) | `apps/web/src/integrations/voice/voice.test.ts` |
| Spike script: `latency` and `pronunciation` | `pnpm --filter web spike:voice -- latency` or `-- pronunciation` |

No SDK is added: all three vendors are called with `fetch`. The real voice worker (LiveKit Agents, streaming speech, barge-in) is Phase 4; this spike measures the vendors, not WebRTC media. A batch speech-to-text call on the whole recording is slower than the streaming recogniser the worker will use, so `firstAudioMs` here is an upper bound.

## 2. What the user supplies
1. **20 to 30 recordings** of Shakti executives asking business questions (ROADMAP §5 client input): WAV, 16 kHz mono, 3 to 10 s each, one question per file, in a local folder outside the repository (`VOICE_SPIKE_AUDIO_DIR`). They stay on your machine and are sent only to Sarvam.
2. A **Sarvam AI** account and API subscription key (`SARVAM_API_KEY`); optionally `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER` to compare voices. Confirm Sarvam's data-retention terms before sending recordings.
3. A **Claude API key** for the Shakti workspace (`ANTHROPIC_API_KEY`).
4. A **LiveKit Cloud** project in the India region: `LIVEKIT_URL` (`wss://…livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
5. A folder for the synthesised checklist audio (`VOICE_SPIKE_OUT_DIR`) and **three listeners** from the Shakti team (one tele-caller, one executive, one field engineer) to rate it.
Optional: `VOICE_SPIKE_LANGUAGE` (default `hi-IN`), `VOICE_SPIKE_ROUNDS` (default 20).

## 3. Steps
1. From a machine in India (ideally Mumbai, as the Vercel functions will be): `pnpm --filter web spike:voice -- latency`. It prints per-recording timings (never the words) and a JSON report.
2. Repeat with `VOICE_SPIKE_EFFORT=medium` and, if Sarvam's streaming endpoints are in scope, note them as the next step.
3. `pnpm --filter web spike:voice -- pronunciation`: writes one WAV per checklist line and `rating-sheet.md` into `VOICE_SPIKE_OUT_DIR`. Each listener rates every line 1 to 5.
4. If a second speech vendor is on the shortlist, implement its two methods behind the same interfaces and run both steps again.
5. Save the reports and the filled rating sheets under `docs/spikes/voice/` with the date; record the results below.

## 4. Pass criteria
- `firstAudioMs` p50 below 1 500 ms (blueprint §9.2); p95 recorded. If the batch upper bound misses, record the step that dominates and whether streaming closes the gap.
- LiveKit room-service round trip from India recorded (p50, p95), as a proxy for the region's distance.
- Pronunciation: every checklist line rated 4 or 5 by at least two of three listeners; lakh and crore amounts and the recording notice must pass.
- Speech-to-text understands Hinglish questions well enough that the reply answers them (listeners mark each turn's reply as on-topic or not from the stored audio, not from a printed transcript).

## 5. Results
Not run yet.
