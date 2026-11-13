# V1 Speech adapter and benchmark (wave 1)

| | |
|---|---|
| Branch | `feat/v1-speech` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | brief |
| Next step | build part 1 |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- No migration. Part 2 needs the owner's Sarvam AI key and the second vendor's, set on dev and staging only (question 14), and the stand-in recordings.
