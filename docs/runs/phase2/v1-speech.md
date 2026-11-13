# V1 Speech adapter and benchmark (wave 1)

| | |
|---|---|
| Branch | `feat/v1-speech` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | part 1 built |
| Next step | the lead's review of part 1; part 2 when the keys and recordings exist |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §5.3](../../03-roadmap-appendix/phase2.md#53-v1-speech-adapter-and-benchmark), §2 (question 1: Sonnet 5.5 and Haiku 5.5; question 6: the target of §9.2; question 7: Sarvam AI and one more vendor, whose data terms the owner approves), §9 and §14.
- BLUEPRINT §9.2; PRD AI-03; ADR 0014 (Hinglish in Roman script only; Devanagari never shown or stored); `docs/04-architecture-appendix/voice.md` and `results/`.
- What exists: `apps/web/src/integrations/voice/` (the ports, the Sarvam AI batch adapter, `claude-stream.ts`), the `spike:voice` script, `AGENT_DEFAULTS` and the provider wrapper's price table in `packages/domain/src/ai`.

**Part 1, today (no vendor key and no recordings exist yet):**
1. **Ports** of §5.3: `StreamingSpeechToText`, `StreamingTextToSpeech`, `transcribeRecording()`.
2. **The Sarvam AI adapter** extended to streaming where the vendor's published API offers it, behind the ports. With no key, tests run on recorded-style fixtures you write from the vendor's documented response shapes, clearly marked as fixtures; a real recorded response replaces each once the owner's key exists.
3. **The second vendor:** read the current public pages of the candidates offering streaming Hindi speech-to-text and Hindi text-to-speech from an Indian region, and write a short comparison (data terms, region, streaming, price per minute) into `docs/04-architecture-appendix/voice.md` with the date, recommending one. Build its adapter behind the same ports only if its documentation is public and complete; otherwise stop at the comparison. The owner approves its data terms before any key is used.
4. **The benchmark command** `pnpm --filter web spike:voice -- benchmark`: the measures of §5.3 (timing per step of §9.3, character error rate after normalisation, key-term accuracy, on-topic marks, cost per minute), as pure, unit-tested functions; it reproduces its numbers from fixtures in CI and runs nothing against a vendor without a key.
5. **Model naming:** `claude-stream.ts` reads `AGENT_DEFAULTS.voice.model` (`claude-sonnet-5-5`); the price table gains Sonnet 5.5 and Haiku 5.5 with the date their prices were checked (from Anthropic's published pricing page, or stop and say so if it cannot be read).
6. **Documents:** `voice.md` (the stand-in set's format: 30 questions in Hindi, Hinglish and English with reference transcripts in Roman script, recorded by the team and the owner, no customer voice), design §5.3 "Built (V1, part 1)".

**Part 2, later (not today):** the owner's keys and the 30 stand-in recordings, the benchmark run on both vendors, the ADR naming the vendor with the measures and the target of question 6. The lead starts it when they exist.

Files owned: `apps/web/src/integrations/voice/`, the `spike:voice` script, `voice.md`, `AGENT_DEFAULTS.voice`, the price table. P5, E1 and K2 build beside you: never touch the webhook routes, `entity_channels`, the telecom rules or the Playbook. No table and no migration in V1.

Tier B has no early check that stops you: build part 1 to the end.

Done when: AGENTS §10 holds on the branch; both adapters (or Sarvam AI and the comparison) pass their fixture tests; the benchmark reproduces its numbers from fixtures in CI; no Devanagari is shown or stored (copy-lint and a test).

## Report

### 13-11-2026, cloud session (part 1)
Built part 1 to the end. No table, no migration, no screen, no user-facing text; nothing called a vendor and no hosted service was touched. Skills loaded: `claude-api` (for the Sonnet 5.5 request shape and the model table); none of the repository's slice skills applies (no command, no table, no screen).

**What I built**
- **Ports** (`apps/web/src/integrations/voice/ports.ts`): `StreamingSpeechToText` (speech start and end, partial and settled transcripts), `StreamingTextToSpeech` (opened before the reply, then one sentence at a time, each chunk timed), a `Clock` so replays can drive time, and the tokens a reply used on `Reply`. `transcribeRecording()` (`recording.ts`) cuts a 16-bit PCM WAV into pieces under 25 s at the quietest 20 ms near each end and joins the batch transcripts; it also reads and writes WAV and finds where the speaker stops.
- **Roman script only** (`roman-script.ts`): `romanOnly()` refuses any transcript holding a Devanagari character (`\p{Script_Extensions=Devanagari}`, the copy lint's class widened to the shared danda), with an error that names no text. Every Sarvam transcript, batch and streaming, passes it.
- **Sarvam AI** (`sarvam.ts`): batch speech to text now asks for Roman script (`saaras:v3`, `mode=translit`; `saarika:v2.5`, the old default, answers Hindi in Devanagari); streaming speech to text and text to speech over `wss://api.sarvam.ai/…/ws`, behind the ports, on Node's own `WebSocket` with the key as a header (`socket.ts`: open timeout, unexpected close as a `network` error with its code).
- **Second vendor**: compared in `voice.md` §6.2 (Amazon Transcribe and Polly, Azure AI Speech, ElevenLabs, Google), recommending **Amazon Transcribe (streaming) and Polly in Mumbai**; its adapter is not built (see Decisions).
- **Benchmark** `pnpm --filter web spike:voice -- benchmark` (`benchmark/`): normalisation (lower case, numbers as digits in Hindi, English and Indian grouping, spelled letters joined, `SPELLING_VARIANTS`), character error rate, key-term accuracy by kind, on-topic share from the listeners' majority, each §9.3 step's p50 and p95 against its budget with the steps that miss named, and paise per minute of speech (speech to text, speech, model tokens through `costInPaise`). The same turn runner serves live vendors (audio paced in real time, `--save-replay` keeps every session through `recordingSockets` and `recordingFetch`) and recorded turns (`--replay`, no key, allowed in CI). Reports carry no transcript or reply.
- **Fixture set** (`benchmark/fixtures/`): five turns written from the documented shapes, every session marked `source: written`; `report.json` is what the test reproduces, and its key numbers were worked out by hand (CER 24/219, key terms 7/8, on topic 3/4, first audio 1,330 to 1,550 ms, end of speech the one step that misses).
- **Model naming**: `AGENT_DEFAULTS.voice` (`claude-sonnet-5-5`, effort `low`, thinking `between_tools`, 400 tokens); `claude-stream.ts` reads it, sends `thinking: {type: 'between_tools'}` for the voice model only, refuses `stop_reason: refusal`, takes the clock, and accepts a `VOICE_SPIKE_MODEL` only from the price table. The price table gains Sonnet 5.5 ($2 / $10 / $0.10 / $2.50) and Haiku 5.5 ($0.10 / $0.50 / $0.01 / $0.125, and $0.50 / $2.50 / $0.05 / $0.625 above 100,000 prompt tokens, a new `longPrompt` tier in `ModelPrice` that `costInPaise` and `maxCostInPaise` honour), read from Anthropic's pricing page on 13-11-2026; `pricesCheckedOn` is now a date per model (Haiku 4.5 re-checked the same day, Voyage left at 05-10-2026); both models' context windows (1M) are in `MODEL_CONTEXT_TOKENS`.
- **Documents**: `docs/04-architecture-appendix/voice.md` rewritten (what is built, the stand-in set's format, the measures, Sarvam's API as read, the comparison, results not run); design §5.3 "Built (V1, part 1)".

**Tests added** (36): `voice/sarvam-stream.test.ts` 6, `voice/recording.test.ts` 5, `voice/socket.test.ts` 7 (the opener against a minimal local WebSocket server, the queue, the recorder), `voice/benchmark/benchmark.test.ts` 11 (normalisation, every measure, set parsing, the fixture report, and a scan that no voice file holds Devanagari), `voice/voice.test.ts` +2 (Devanagari refused, a declined reply), `packages/domain/src/ai/models.test.ts` 5. Existing voice tests updated for the new defaults.

**Checks run**
- `pnpm --filter web exec vitest run src/integrations/voice`: 43 passed (run three times, stable).
- `pnpm --filter web test`: 132 files, 1,001 passed, 1 skipped. `pnpm --filter @shakti/domain test`: 86 files, 2,358 passed.
- `pnpm typecheck`: 8 of 8 tasks successful. `pnpm lint` (whole repository, final): exit 0, no warnings. `pnpm copy-lint`: clean. Prettier: clean on every changed file.
- `pnpm test:security` on the local Postgres (54322): 4 of 4 tasks successful; db 45 files, 1,272 passed; domain 78 files, 1,047 passed; web 26 files, 342 passed (run before the last commit, which changed only the benchmark's turn runner, outside every security suite).
- `python3 tools/integration/check-doc-links.py`: the 4 findings it prints were there before this branch (three links to `.claude/settings.local.json`, and this run file as an orphan until the status page lists it).
- The benchmark command itself: `VOICE_BENCHMARK_SET=<fixtures> pnpm --filter web spike:voice -- benchmark --replay <fixtures>/turns --out <fixtures>/report.json` wrote the committed report.
- No list or search, so no `EXPLAIN`; no screen, so no journey or baseline.

**Decisions the brief did not settle**
1. **Vendor pages could not be opened.** The session's network policy blocks `docs.sarvam.ai` and `sarvam.ai`, so I stopped trying sites (the tool's rule) and read every vendor through search results quoting their pages. The Sarvam request and answer shapes, prices and data terms are therefore as quoted, pinned by fixtures marked `written`, and flagged in `voice.md` §6 for confirmation in part 2. The owner may want `docs.sarvam.ai`, `sarvam.ai` and `docs.aws.amazon.com` allowed in the cloud environment's network settings.
2. **Second vendor's adapter not built**, as the brief allows: AWS's streaming protocol is public and complete (a SigV4-signed WebSocket with event-stream frames), but I could not read its current pages here, and the owner approves its data terms first. Recommended over Azure because it adds no new data processor and needs no SDK; Azure is the fallback.
3. **Sarvam batch model changed** from `saarika:v2.5` to `saaras:v3` with `mode=translit`, since Saarika answers Hindi in Devanagari, which ADR 0014 forbids past the adapter. Sarvam's docs now name Saaras v4 as default; I kept v3 (also documented for `translit`); `SARVAM_STT_MODEL` switches it.
4. **Devanagari is refused, not transliterated**: a transcript with any Devanagari fails as `invalid_response` / `not_roman_script`; the benchmark counts such a turn as failed. Deterministic transliteration would invent spellings.
5. **No server-side refusal fallback** on the voice request: the `claude-api` guidance enables `fallbacks` by default for Sonnet 5.5, but with `between_tools` the fallback request must be written by hand without it, and this is a timing harness; a declined reply is an error here. V2's worker, which goes through the provider wrapper, decides it.
6. **TTS socket opened after the reply** in the benchmark, so the first-speech step excludes the connection (V2 keeps one open, as the port allows).
7. **Network and playback** (§9.3's 150 ms) is added as its budget, not measured, until V2 measures it in a LiveKit room.
8. **Sonnet 5.5 and Haiku 5.5 are now callable** through the provider wrapper (the price table is its allow-list). No agent names them yet; later slices choose them per question 1 (a).
9. Sarvam's streaming endpoint sends no partial transcripts; its realtime endpoint, which does, needs access Sarvam grants, so it is not built.

**Unfinished or uncertain**
- Every Sarvam streaming shape (frame names, `audio.encoding: audio/wav` for PCM chunks, `output_audio_codec: linear16`, the `final` event) is from the documentation as quoted and is the first thing part 2 checks with `--save-replay`.
- The prices in `SARVAM_PRICE` and the comparison table's figures need confirming on the vendors' pages.
- The STATUS follow-up "the voice spike names a model the documents do not" is closed by this branch (the lead updates `docs/10-status.md`).
- The branch is from `main` at 008066b7; `main` has moved, so the lead takes it in at integration (no migration to renumber).

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- No migration. Part 2 needs the owner's Sarvam AI key and the second vendor's, set on dev and staging only (question 14), and the stand-in recordings.
