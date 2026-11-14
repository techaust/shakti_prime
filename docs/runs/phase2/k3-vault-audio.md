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
