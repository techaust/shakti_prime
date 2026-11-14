# K3 Vault audio (wave 2)

| | |
|---|---|
| Branch | `feat/k3-vault-audio` on GitHub, from `main` at 27662a00 |
| Worktree | `k3-vault-audio`, slot 4 (Postgres 54334, app 3034), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 14-11-2026, a cloud day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high; 5-hour window 0 % at 07:00 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §6.4](../../03-roadmap-appendix/phase2.md#64-k3-vault-audio), §5.3 and "Built (V1, part 1)" (the ports, `transcribeRecording()`, Roman script only by `romanOnly()`), §9, §11, §14.
- BLUEPRINT §9.1 (Rajasthani and Marwari corrections); PRD AI-01; ADR 0014 (no Devanagari stored or shown); ADR 0011 (embeddings); the knowledge document and DATABASE for `knowledge_files` and `knowledge_chunks`.
- What exists: K1's vault (`knowledge_files`, `knowledge_chunks`, the index job `apps/web/src/workers/knowledge/job.ts` and `index-deps.ts`, `packages/domain/src/knowledge/` extract, chunk and passages, `searchKnowledge()`, `/knowledge`), the masking finder, the provider wrapper's spend names and caps (`AGENT_DEFAULTS.knowledge.indexName`), V1's `apps/web/src/integrations/voice/recording.ts` (it reads WAV and cuts pieces of at most 25 s) and the Sarvam adapter.
- Skills: `add-command`.

Build, in this order:
1. **Audio files:** `knowledge_files.source_type` gains `audio` (MP3, M4A, OGG, WAV; at most 25 MB and 30 minutes, checked on upload and again in the job); the enum's sync and the upload screen's accepted types.
2. **Transcription in the index job:** through V1's `transcribeRecording()` port, with its own spend name and daily cap in `AGENT_DEFAULTS` (`knowledge:index` per the design; name the cap), identity numbers masked in the text, the transcript stored as the file's text before chunking, Roman script only. **Formats:** `recording.ts` reads WAV only. Check whether the vendor's batch API takes MP3, M4A and OGG as they are (read the Sarvam adapter and `docs/04-architecture-appendix/voice.md`). If it does, pass them through in pieces the vendor accepts; if a decoder package would be needed, stop and report: you may not install one, and the lead decides (WAV only for now, or a package with the owner's yes).
3. **`knowledge.transcript.correct`** (`knowledge.vault.write`): the corrected transcript replaces the text and the passages, chunked and embedded again; audited; denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.

**Early check (Tier B):** once steps 1 to 3 are committed with their tests, write a short report here, commit it with the subject `report: k3-vault-audio early check`, push and stop. The lead reads that diff and starts you again for steps 4 to 6.

4. **Screen:** on the vault file's page, an audio file shows its player (through the file checks' signed address) and its transcript beside it, editable by a holder of `knowledge.vault.write`, with Save; the index state while it transcribes. Copy in `en.json`; journeys with axe, light, dark and 400 px snapshots; the JavaScript budget.
5. **Tests** of §14: transcription on recorded responses (the fake transport, no live vendor); a correction re-indexes and replaces the passages; retrieval by sensitivity per role holds for audio as for documents (security suite); no Devanagari leaves the job; an over-long or over-size file is refused with a plain sentence.
6. **Documents:** DATABASE, the knowledge document, the design's "Built (K3)" under §6.4, `pnpm db:docs`.

Files owned: the audio paths of the knowledge index job and upload, `knowledge.transcript.correct`, the transcript panel. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, the testing lists, the event catalogue, `AGENT_DEFAULTS`. W1, I1, T3 and B1 build beside you: never touch the webhook handlers, `apps/web/src/screens/messaging`, `provider_calls`, `crm.lead.*` or `packages/domain/src/ai/ask`; V1's `apps/web/src/integrations/voice` is read and extended only where `transcribeRecording()` needs it (say what you changed in your report).

Review checklist (check before your report): the audio and its transcript keep the file's sensitivity and company; nothing unmasked reaches a model or the store; the spend cap stops transcription and says so on screen; a correction cannot be made by a reader; the job is idempotent on a retry.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §6.4 pass; `pnpm test:security` passes on your Postgres.

Not in K3: Teach sessions' audio (V2 stores it here later); call recordings (T3, A2).

## Report

### 14-11-2026, lead's cloud VM (slot 4): stopped at step 2's format check, before any code
**Finding: no decoder package is needed for WAV; one would be needed for MP3, M4A and OGG as the design asks.**
- `recording.ts` reads 16-bit PCM WAV only, and cuts each piece at the quietest 20 ms before 25 s, which needs the audio as PCM. Its header says a recording in another format "is converted when it is copied in (T3, K3)", and converting needs a decoder.
- The repository does not say which formats Sarvam's REST speech-to-text takes. `voice.md` §6.1 records that the build session could not open `docs.sarvam.ai`, and this session cannot either. The only thing recorded is "about 30 seconds of audio" per call. The adapter sends every piece as `turn.wav`. My own memory of Sarvam's pages lists MP3, AAC, OGG and M4A among the accepted types, but no recorded answer or page in the repository confirms that.
- Even if the vendor takes them, a file of up to 30 minutes still has to go in pieces under 30 s. Cutting compressed audio without decoding it:
  - **MP3:** can be cut on frame boundaries by hand. The cut lands at a fixed time, not a pause, so a word can be split.
  - **OGG (Opus or Vorbis):** can be cut on page boundaries by hand, with the header pages repeated and the page numbers and CRCs rewritten. A fixed-time cut again.
  - **M4A:** needs an MP4 demuxer and a remuxer (sample tables, or AAC frames rewrapped as ADTS) written by hand. It is a sizeable, fragile binary parser and the vendor's acceptance is still unconfirmed.
- No audio package is installed (`node_modules/.pnpm` has none for ffmpeg, mp3, ogg, mp4 or audio).

**For the lead to decide:**
- (a) WAV only for now: upload accepts `audio/wav` alone, and the job runs `transcribeRecording()` as built.
- (b) A decoder package, with the owner's yes, so the job converts MP3, M4A and OGG to PCM before `transcribeRecording()`.
- (c) Hand-written MP3 and OGG frame/page cutting with fixed-time cuts, after the vendor's format list is confirmed. M4A waits for (b).

Steps 1 and 3 and the WAV path of step 2 do not depend on this choice. I can build them as soon as the lead answers.

**Two things the brief does not settle, also for the lead:**
- `MAX_UPLOAD_BYTES` is 15 MB (`packages/contracts/src/api/files.ts`) and the `knowledge` purpose uses it, but the design allows 25 MB for audio. I would give audio its own cap of 25 MB within the `knowledge` purpose, unless the lead says otherwise.
- A 30-minute 16 kHz mono 16-bit WAV is about 57.6 MB, so under a 25 MB cap a WAV can hold only about 13 minutes at 16 kHz, or about 26 minutes at 8 kHz. Under (a), the 30-minute limit is effectively the size limit.

Checks run: none (no code changed). Skills loaded: none yet (`add-command` is loaded when step 3 starts).
