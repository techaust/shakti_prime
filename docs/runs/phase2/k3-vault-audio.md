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

### 14-11-2026, lead's cloud VM (slot 4): early check, steps 1 to 3
After the lead's decision (a): **WAV only**. MP3, M4A and OGG are refused at upload with a sentence asking for a WAV. A decoder package is a follow-up that needs the owner's yes. Skills loaded: `add-command`.

**Built:**
- **Uploads** (`packages/contracts/src/api/files.ts`, `packages/domain/src/files/limits.ts`):
  - `audio/wav` is an upload type, for the `knowledge` purpose only.
  - `MAX_AUDIO_UPLOAD_BYTES` is 25 MB. Every other vault file keeps 15 MB (`UploadLimit.maxBytesOf`, `uploadMaxBytes()`). The contract checks size by type (`maxUploadBytes()`).
  - `MAX_AUDIO_MS` is 30 minutes. A 16-bit WAV is uncompressed, so the 25 MB cap is what really limits length: about 13 minutes of 16 kHz mono, or 26 minutes at 8 kHz. The document's doc comment says so.
- **File checks** (`apps/web/src/workers/files/audio-check.ts`, called from `handle-file-uploaded.ts`):
  - A vault WAV is read with V1's `readWav()`. Anything else is refused as `file_unreadable`, including a non-PCM WAV or an MP3 renamed to `.wav`.
  - A recording over 30 minutes is refused as `file_audio_too_long`.
  - The file is written afresh from its samples (`audio_checked`), so a `LIST` chunk naming the speaker or device is not kept.
- **Schema** (migrations 0168, 0169 and 0170 on this branch; the lead renumbers them):
  - `knowledge_files` gains `source_type` `audio` (widened `NOT VALID`), `transcript` and `transcript_corrected_at`.
  - Checks:
    - `knowledge_files_transcript_check`: 1 to 100,000 characters, and no character from the Devanagari blocks, written as regex escapes so no migration holds a Devanagari character.
    - `knowledge_files_transcript_source_check`: only `audio` has a transcript. It is paired in `enum-sync`.
    - `knowledge_files_transcript_corrected_check`: a correction needs a transcript.
  - Row security and functions:
    - The insert policy maps `audio/wav` to `audio`, with no transcript at insert.
    - The guard lets a request change the transcript only as a correction: an `audio` file that is indexed, failed or unavailable, sent back to `waiting`, with the time stamped from the database clock.
    - The column grant is on `transcript` and `transcript_corrected_at`.
    - Two `knowledge.index` definers, `app.knowledge_file_transcript()` and `app.record_knowledge_transcript()`. The second keeps the first transcript of a waiting recording and answers false afterwards.
  - The transcript is a column of the vault file, so it is read by the file's company and sensitivity (`knowledge_files_read`), the same as a document.
- **Commands** (`packages/domain/src/commands/knowledge/transcript.ts`; registry; audit labels):
  - `knowledge.file.record_transcript` (the index job's, `knowledge.index`).
  - `knowledge.transcript.correct` (`knowledge.vault.write`, `peopleOnly`):
    - Refuses a non-Roman transcript (`knowledge_transcript_not_roman`), a file that is not a recording (`knowledge_transcript_not_audio`), a file still being read (`knowledge_still_reading`), an archived file (the machine) and an upload that is not ready.
    - Masks the transcript with `maskWholeText()`, sends the file back to `waiting` and emits `knowledge.file.index_requested`.
    - The audit rows hold character counts, never the words.
  - A new machine transition `correct` (indexed/failed/unavailable to waiting). The event catalogue names the correction among the emitters. The server action is `correctKnowledgeTranscript`.
- **Index job** (`packages/domain/src/knowledge/index-file.ts`):
  - A recording's kept transcript (the job's own or a person's correction) is its text. Without one, the job:
    1. checks the length again against `MAX_AUDIO_MS`;
    2. transcribes through the `RecordingTranscriber` dependency, under `provider.metered()`;
    3. refuses a non-Roman answer;
    4. masks the transcript, keeps it through `knowledge.file.record_transcript`, and then cuts and embeds it.
  - A retry reads the kept transcript and never pays twice.
  - With no `SARVAM_API_KEY` and no transcript, the file is recorded `unavailable` (`knowledge_service_missing`).
- **Spend** (`AGENT_DEFAULTS.knowledge`, `packages/domain/src/ai/provider.ts`):
  - Transcription is counted under `knowledge:index`, inside its ₹500 a day.
  - It is also held to its own cap, `transcribeDailyCapPaise`: ₹300 a day, which is ten hours at Sarvam's published ₹30 an hour. The cap is a "part" (`part: { name: 'transcribe' }`), counted beside the caps the way a person's share is.
  - `metered()` reserves the most the recording can cost and settles at the audio actually sent, even when the call fails, because the vendor bills what it heard. A cap that is hit records `knowledge_spend_cap_reached`, which the list already shows as a plain sentence.
- **Web transcriber** (`apps/web/src/workers/knowledge/transcriber.ts`, wired in `index-deps.ts`): Sarvam's batch speech-to-text behind `transcribeRecording()`, priced from `SARVAM_PRICE`, with `hi-IN` and four pieces at a time. It maps failures as follows:
  - unreadable audio and vendor refusals: `knowledge_unreadable`;
  - running out of time: `knowledge_timed_out`;
  - other vendor failures: `integration_unavailable`, so the delivery is tried again.
- **Upload screen** (step 1 only):
  - The vault dialog takes a WAV, recognising the browser names for WAV and the `.wav` ending.
  - Its hint gives both sizes. A document over 15 MB is refused before sending.
  - A plain sentence asks for a WAV instead of an MP3, M4A or OGG.
  - New copy in `en.json`: errors, file types, the sanitising line, `knowledge.source.audio`, and the dialog's hint, wrong-type and too-large sentences.
- **Changes to V1's `apps/web/src/integrations/voice`:**
  - `transcribeRecording()` takes optional `concurrency`, `signal` and `onPiece`. Its default behaviour is unchanged. Pieces are joined in the recording's order, and a failed piece stops further sending.
  - `roman-script.ts` now re-exports `isRomanScript`, `hasDevanagari` and `DEVANAGARI` from `@shakti/contracts` (the new `roman-script.ts` there), so the command and the adapter share one test. Its behaviour is unchanged.

**Tests added:**
- `packages/domain/tests/commands/knowledge-audio.test.ts`, 9 tests on Postgres with a fake transcriber. They cover:
  - transcription, masking (a synthetic Aadhaar number and a phone number), search and the spend;
  - idempotency on a retry;
  - waiting without a key, too long, and the part cap;
  - Devanagari, empty and refused transcripts;
  - the workers-only record;
  - the correction: denied to a reader, wrong company, an Executive-only file, the happy path with audit and event and passages replaced on the re-read, every refusal, and a typed transcript where none was heard.
- `packages/db/tests/security/knowledge-audio.test.ts`, 14 tests:
  - the transcript is read by sensitivity per role (seven roles and agents, and company 2);
  - the guard refuses every change that is not a correction, and refuses readers;
  - the insert policy;
  - the checks hold against the table owner;
  - the definers: once only, a person refused, the wrong company refused, a non-recording refused.
- Smaller additions:
  - the refusal sweep (`knowledge.transcript.correct` in the people-only inputs, `knowledge.file.record_transcript` in the platform checks);
  - `provider.test.ts` (+1, metered spend and the part cap);
  - `limits.test.ts` (+1);
  - `field.test.ts` (+1);
  - `recording.test.ts` (+2: order, concurrency, stopping);
  - `audio-check.test.ts` (3);
  - `enum-sync` pairing.

**Checks:**
- `pnpm test:security` on 54334: db 49 files and 1,338 tests passed; domain 84 files and 1,128 tests passed; web 28 files and 357 tests passed.
- Unit tests:
  - contracts: 186 passed;
  - domain: 2,410, all passing after the catalogue fix;
  - db: 150 passed;
  - web: 1,065 passed and 1 skipped.
- Typecheck of contracts, db, domain and web, and eslint of every folder I touched: clean.
- `pnpm copy-lint`: clean.
- `db:docs` and `machines:docs` were regenerated.
- The whole-repository `pnpm lint` and the journeys have not run yet; they come with steps 4 to 6.
- `EXPLAIN (ANALYZE)`: no new list or search. The transcript is read by primary key in a definer.

**Decisions the brief did not settle:**
- **Cap and language:**
  - The transcription cap is a part of `knowledge:index`'s spend (₹300 a day, flagged for the owner like the others), not a separate spend name.
  - The language is `hi-IN` (`VAULT_AUDIO_LANGUAGE`), the same as the voice benchmark set.
  - Transcription uses four pieces at a time so a 25 MB WAV fits inside the index route's time.
- **Corrections:**
  - A correction is refused while the file is waiting, so a reading never cuts a transcript that changes under it.
  - The old passages stay searchable until the re-read replaces them, as with Read again.
  - A person may type a transcript for a recording the service could not transcribe (for example, no key yet). The job then needs only the embeddings.
- **Stored transcript:**
  - It is masked with `maskWholeText()`, the same masking the passages get (identity numbers, phones and emails), so the stored text matches what is cut.
  - It is refused if it would pass 100,000 characters (`knowledge_too_long`).
- **Sarvam errors:** 4xx refusals (except 401, 403 and 429) and invalid answers are recorded `knowledge_unreadable`. Timeouts, 5xx, 429 and key errors are left to the queue.
- **Env list:** `SARVAM_API_KEY` is not added to `turbo.json`. It is read only at runtime, like the webhook secrets, and adding it would be a checks change that needs `checks-ok`.

**Uncertain, or for the lead:**
- **The recording itself is not masked.** Speech cannot be covered the way a photo can. The stored WAV and the pieces sent to Sarvam carry whatever was said, including any spoken identity number. Only the transcript and passages are masked, and a number spoken as words may escape the masker's digit patterns. No model (Claude) ever receives audio.
- **Sarvam's data terms and workspace retention** need the owner's confirmation before any key is set (`voice.md` §6.1). The vault starts sending recordings as soon as `SARVAM_API_KEY` exists.
- **Sarvam's formats and size limits** are still unconfirmed against its live pages (part 2 of V1). The adapter sends 25-second 16-bit WAV pieces.
- **The migration split.** The check split is a third migration (0170, re-added `NOT VALID`) and was not folded into 0168. 0168 had already been applied to the slot database, and the migrator (AUDIT M22) refuses an applied file that was edited. The lead may fold 0170 into 0168 at renumbering on a fresh database.
- **The documents for steps 4 to 6 are not written yet:** DATABASE, the knowledge document, "Built (K3)" with the WAV-only known limit and the size note, and API/SECURITY. The `.env.example` comment for `SARVAM_API_KEY` also still names only the voice spike.
