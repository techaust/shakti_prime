# A2 Caller Co-pilot (wave 3)

| | |
|---|---|
| Branch | `feat/a2-copilot` on GitHub, from `main` at 9b6ea163 |
| Worktree | `a2-copilot`, slot 3 (Postgres 54333, app 3033), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an AI agent principal, call recordings and transcripts |
| Usage | build Opus 5.5 high (agent-usage.py: every request at high); 5-hour window 1 % at 12:40 UTC, over 95 % by 16:25 UTC; this build about 12 points of it (early check) |
| State | steps 5 to 9 built, report written (18-11) |
| Next step | review |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §7.3](../../03-roadmap-appendix/phase2.md#73-a2-caller-co-pilot), §2 (question 1: Sonnet 5.5 for briefs, Haiku 5.5 for summaries; question 8 (a): Lead Converter calls only, a setting per company, `AGENT_DEFAULTS.copilot.transcribe`), §3 (A2 owns the Co-pilot panel in `/calling` and `/converting`), §4 (`agents.note.write`, Co-pilot entity; `agent:copilot` keeps `crm.lead.read:entity`, `crm.lead.write:entity`, `knowledge.vault.read.staff:all`), §9, §10, §11, §14.
- The Phase 1 agent pattern to follow, not duplicate: `packages/domain/src/ai/runtime.ts`, `config.ts` (kill switches, autonomy), `action-types.ts`, `agent-defaults.ts`, the Triage agent `packages/domain/src/ai/triage/` and its worker, `eval:triage`; [a1-triage.md](../phase1/a1-triage.md), [ai0-agent-runtime.md](../phase1/ai0-agent-runtime.md).
- Built (T3, V1, I1, W1, K2): [t3-dial.md](t3-dial.md) (`provider_calls`, recordings copied to the private bucket, `calls.dial.completed`, the call bar; today calls go out unrecorded until the owner's Exotel notice, so summaries are exercised on fixtures), V1's `transcribeRecording()` in `apps/web/src/integrations/voice/recording.ts` behind the ports of `ports.ts` (Roman script only, recorded fixtures), [i1-ingest.md](i1-ingest.md) (`crm.lead.qualification.set`, the qualification fields' bounds), [w1-whatsapp.md](w1-whatsapp.md) (templates, consent, `messaging.message.send`), [k2-playbook.md](k2-playbook.md) (approved `staff` directives); the masking finder `packages/domain/src/privacy`; file purposes `packages/domain/src/files`.
- BLUEPRINT §7.6, §9.3, §13; PRD AI-04, TEL-03, CALL-5; SECURITY §3.3, §3.4 and §7.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **Table** `copilot_notes` as §7.3 says (`entity_id`, `opportunity_id`, `provider_call_id`, `kind` `brief` or `call_summary`, `body` masked, `fields_json`, `suggested_disposition_id`, `agent_action_id`, created by and at): RLS read with the lead (whoever reads the opportunity reads its notes), written only through `agents.note.record` by a principal holding `agents.note.write`; append-only; the testing lists, fixture rows, the role × company matrix, `app_reader` grants (AGENTS §6). File purpose `call_transcript` (masked before storage, read with the lead; keep every purpose of `main`'s latest definition).
2. **Permission** `agents.note.write` (Co-pilot entity; no person's role) in the catalogue, `AGENT_MATRIX`, seed, SECURITY §3.2 and §3.3, the oracle case.
3. **Commands and action types:** `agents.note.record` (the Co-pilot only); proposals `crm.lead.qualification.set` (facts within the qualification fields' bounds), `crm.task.create` for the follow-up (inside calling hours, for the lead's owner) and a new `messaging.template.request` (a nurture template on day 7, 30 or 90, a quote-expiry nudge two days before expiry; only when the customer holds WhatsApp consent and the template is approved; approved, it runs W1's `messaging.message.send` as the approving person). Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep (no other agent may run them; the Co-pilot never holds a cost, price, `sales.*`, `calls.dial`, `calls.recording.listen` or platform-only grant).
4. **Filter** `filterCopilotOutput()` (deterministic, `packages/domain/src/ai/copilot/`): brief and summary ≤ 600 characters; facts within bounds; a task inside calling hours; a template only with consent and approval; a note with no identity number, instruction or link. Unit tests for every rule.

**Early check (Tier A):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: a2-copilot early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 9.

5. **Workers:** briefs on `crm.opportunity.assigned` and on demand (at most once an hour per lead): Sonnet 5.5 from the lead, its calls and outcomes, its thread's last messages (untrusted, labelled, masked) and approved `staff` directives. Summaries on `calls.dial.completed` for a recorded call inside the company's coverage setting: the recording through `transcribeRecording()`, masked and stored as a `call_transcript` file, then Haiku 5.5 writes the summary, facts and a suggested outcome. Spend caps per company in `AGENT_DEFAULTS.copilot`, the kill switches; no live model call in any test.
6. **Autonomy:** Shadow, then Needs approval per action type after review; the outcome is only pre-selected in the log form and never logged by the agent.
7. **Screens:** the Co-pilot panel in `/calling` and `/converting` (your own component in `apps/web/src/screens/copilot`, one mount line in each page; T3's call bar and W1's thread already sit on these pages: do not edit their components) with the brief, the summary and the suggestions, A to approve and R to reject; the log form's pre-selected outcome; the shadow report (suggested outcomes and facts against what the caller logged). Copy in `en.json`; journeys with axe and light, dark and 400 px snapshots; the JavaScript budget.
8. **Sets:** made-up Hinglish transcripts (Roman script) with their expected facts and outcomes, and an injection set (instructions spoken in a call, in a customer's message); `eval:copilot` (a `package.json` script, which makes the pull request need the owner's `checks-ok`), on recorded answers in CI.
9. **Documents:** DATABASE, SECURITY §3.2, §3.3 and §7, the agents' document, the design's "Built (A2)" under §7.3, `pnpm db:docs`.

Files owned: `copilot_notes`, `packages/domain/src/ai/copilot/`, the Co-pilot workers, `apps/web/src/screens/copilot` and its mounts, the log form's pre-selection, `messaging.template.request`. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `AGENT_MATRIX`, `AGENT_ACTION_TYPES` and `AGENT_DEFAULTS` (keep your entries together under a Co-pilot comment; A3 appends beside you), file purposes, `en.json`, the event worker registry, the testing lists, `package.json` scripts.

Built beside you, do not touch: A3 owns the Concierge and W1's thread component's draft line; S3 owns `sales.quote.send`, the WhatsApp inbound handler and milestones; T4 owns `exotel_incoming`, inbound and missed calls, the screen-pop and the app shell; V2 owns `apps/voice-agent`. Your migrations are numbered after `main`'s last (0188) and renumbered by the lead at merge.

Review checklist (check before your report): a suggestion changes nothing until a person approves it; the outcome is never logged by the agent; transcripts and notes masked before storage and never sent to a model unmasked; customer and call text is data, never instructions; the coverage setting is honoured; spend caps and kill switches stop the workers; no cost or price data in a prompt.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §7.3 pass; `pnpm test:security` passes on your Postgres.

Not in A2: live recordings (wait for the owner's Exotel notice); the live model's shadow run (final phase).

## Report

### Early check, 17-11-2026 (the lead's cloud VM, worktree `a2-copilot`, Postgres 54333)
Steps 1 to 4 are built and committed with their tests; steps 5 to 9 wait for the lead's read of this diff. Skills loaded: `add-table`, `add-command`.

**Built**
- Table `copilot_notes` (`packages/db/src/schema/copilot-notes.ts`; migrations `0189_copilot_notes` generated, with the widened `agent_runs_filter_reason_check` and `files_purpose_check` added `NOT VALID`, and `0190_copilot_notes_rls` custom): RLS enabled and forced; read with the lead (`copilot_notes_read`, `app_user` and `app_reader`); inserted only when `app.role` is `agent:copilot`, `created_by` is the caller, it holds `agents.note.write:entity`, the lead is in the note's company, the call is of that lead and the outcome is one in use of the group or the company; grants select and insert to `app_user`, select to `app_reader` and `readonly_reporter`; `app.copilot_notes_append_only()` refuses every update and delete except a delete by the stale-lead anonymisation for a lead in its scope. One summary per call (`copilot_notes_call_unique`), indexes on the lead, the action, the outcome and the company's summaries.
- File purpose `call_transcript` (contracts, `FILE_PURPOSE_RULES` with a new read kind `call`, the schema check, `contract-values.ts`, `en.json`): no request uploads one; read with its provider call through `files_call_transcript_read`, so with the lead; every earlier purpose kept.
- `app.anonymise_stale_leads()` redefined from 0188 with one added statement: it deletes the leads' Co-pilot notes. Every other line is 0188's.
- Permission `agents.note.write` (catalogue, `PERMISSION_SCOPES` `entity`, `AGENT_MATRIX` for `agent:copilot`, seed label and empty staff row, SECURITY §3.2 row of dashes so the oracle passes, SECURITY §3.3's Co-pilot row, the role editor's label).
- Contracts `packages/contracts/src/copilot.ts`: note kinds, `RecordCopilotNoteInput` and `CopilotNoteDto`, `CopilotFactsSchema` (the five measures, no DISCOM number), template occasions, `RequestTemplateInput`, `COPILOT_ACTION_TYPES`; five filter reasons in `AGENT_FILTER_REASONS` with their sentences.
- Commands: `agents.note.record` (`packages/domain/src/commands/agents/notes.ts`; `agents.note.write` at `entity`, only `agent:copilot`, the filter's text check again, the body masked, a brief at most once an hour per lead under the lead's lock, the call of the same lead, the outcome in use; audit holds the lead, call and kind, never the text) and `messaging.template.request` (`packages/domain/src/commands/messaging/template-request.ts`; `crm.lead.write`, refused to every agent with `people_only`; checks the occasion, the customer's newest chat, the template approved with no blanks, a WhatsApp consent in force, then runs `messaging.message.send` as the person). Both registered and exported; the event catalogue names the second as an emitter of `messaging.message.requested`.
- Action types (`AGENT_ACTION_TYPES`, between Co-pilot comments): `crm.lead.qualification.set` and `messaging.template.request` beside the existing `crm.task.create`; names on the agents screen, the inbox summary labels, the occasion shown in words, audit names and value labels.
- `AGENT_DEFAULTS.copilot` (`briefIntervalMinutes: 60`, `quoteNudgeDaysBefore: 2`, each flagged for the owner).
- Filter `filterCopilotOutput()` (`packages/domain/src/ai/copilot/filter.ts`): one JSON object or nothing; note at most 600 characters with no identity number, contact detail, instruction or link; facts within the fields' bounds and only those that change; an outcome from the offered list; a follow-up with its offset, later than now, inside calling hours, for the lead's owner; a template approved, utility or marketing, not the platform's own, no blanks, on its occasion's day (a nurture day of `WORKSHOP_DEFAULTS.calling.nurtureCallDays`, or two days before a sent quote expires), only with a chat and a consent in force (promotional for marketing).
- DATABASE §6.9 line, `pnpm db:docs` regenerated.

**Tests added**
- `packages/domain/src/ai/copilot/filter.test.ts`: 20 unit tests, every rule.
- `packages/domain/tests/commands/copilot.test.ts`: 13 on real Postgres (denied, wrong company, happy path for both commands; the hour limit; one summary per call; outcome never logged; text kept off the audit row; an Aadhaar number stored with its last four digits; append-only; consent, template, nurture, chat and quote refusals; a suggestion queues nothing until approved, and nothing when rejected).
- `packages/db/tests/security/copilot-notes.test.ts`: 8 (writers refused, even holding the grant; other company, lead and call refused; read with the lead role by role; no update or delete; the anonymisation's one exception; transcripts read with their call and unattached ones by nobody).
- `agent-refusals.test.ts`: 9 (every agent and the workers refused both commands; `agents.note.write` the Co-pilot's alone; none of its grants restricted, platform-only, `sales.*`, pricing, `calls.dial` or `calls.recording.listen`).
- Matrix rules for `copilot_notes` and `call_transcript`, fixture rows per company, `NARROWER`, the enum pair, contract-value pairs, the CRM fixture's clean-up, the anonymisation completeness test now carries a Co-pilot summary with the marker, and the agents screen's settings test lists the three action types.

**Checks**
- `pnpm test:security` on Postgres 54333: db `54 passed (54)`, `1440 passed (1440)`; domain `91 passed (91)`, `1264 passed (1264)`; web `32 passed (32)`, `402 passed (402)`; `Tasks: 4 successful, 4 total`.
- Unit: domain `99 passed (99)`, `2564 passed (2564)`; db `158 passed (158)`, web `1095 passed | 1 skipped`, the filter `20 passed (20)`.
- Typecheck: contracts, db, domain, web clean. ESLint with `--max-warnings 0` on `packages/contracts`, `packages/db`, `packages/domain`, `apps/web/src/screens`, `apps/web/src/components/agents`, `apps/web/src/components/activity`: clean. `pnpm copy-lint`: clean. The whole-repository lint waits for the final check.
- `EXPLAIN (ANALYZE)`: no list or search yet; the panel's reads come with step 7.

**Open or uncertain**
- On the third suite run, `enum-sync` once saw a `provider_calls_inbound_check` constraint on my database that no migration of this branch makes (none after it, and none now); the same file and the whole suite passed on the next runs. Something outside this worktree touched port 54333 for a while; the lead may want to check T4's environment.
- The inbox card shows a template by its registered name (a code), not its label; the summary DTO carries labels only for people. The Co-pilot panel (step 7) shows the label; the inbox card needs the lead's call (a template label in `summaryFields`, a shared file).
- The qualification proposal's inbox card shows no values (`summary: []`, the facts are nested); the panel will show them. A summary kind for a facts object would change A0's inbox DTO.
- `agents.note.write` can still be offered by the role editor to a staff role (it is neither platform-only nor Executive-only); the insert policy refuses any writer but `agent:copilot`, so a person given it writes nothing. Making it agent-only needs a change to `roleMayHold()` and `app.role_may_hold()`, which the lead may want as its own decision.
- Merge points with siblings: `app.anonymise_stale_leads()` is redefined (anyone else redefining it must keep the `copilot_notes` delete); `agent_runs_filter_reason_check` and `files_purpose_check` are widened (A3 and others may widen them too); fixture ids `0x7a`, `0x7b`.

**Decisions the brief did not settle**
- `messaging.template.request` takes `crm.lead.write` (the Co-pilot's own grant, so the action type passes the holding check) and refuses every agent in its handler; only the approving person sends, under their own `messaging.send`.
- The Co-pilot proposes only templates with no blanks, so the person approves exactly the words sent; the model never fills template values.
- A utility template needs a WhatsApp consent in force (service or promotional), a marketing template a promotional one, on the chat's person.
- The Co-pilot never proposes the DISCOM consumer number (a long number the transcript's masking hides).
- An answer whose outcome is not offered, or whose facts are out of bounds, loses its note too (`unknown_outcome`, `fact_out_of_bounds`): the filter fails closed.
- A follow-up title is held to 80 characters and the note's checks.
- The "instruction" rule for notes is narrower than the Triage agent's (a summary may say the customer will send or pay), and adds links in any form.

### Steps 5 to 9, 18-11-2026 (the lead's cloud VM, worktree `a2-copilot`, Postgres 54333)
Steps 5 to 9 are built, tested and committed. Skills: `add-table` and `add-command` were loaded in the early check; this run added no table and followed `add-command` for its two commands.

**Built**
- **Workers** (`packages/domain/src/ai/copilot/`: `facts.ts`, `read-facts.ts`, `prompt.ts`, `run-copilot.ts`, `summarise-call.ts`, `evaluate.ts`; `apps/web/src/workers/copilot/`):
  - Briefs on `crm.opportunity.assigned`, after its notices, and on `agents.brief.requested`, by Sonnet 5.5. They read the lead, its last ten calls, the outcomes, the chat's last ten messages (masked and labelled), the approved `staff` directives, the templates and the dates of the lead's sent quotes, never an amount. A lead briefed within the hour is skipped before anything is read.
  - Summaries on `calls.dial.completed`. The platform reads the call through `app.copilot_call_facts()` and checks: a dial of a lead, answered, recorded, not anonymised, inside the coverage (`AGENT_DEFAULTS.copilot.transcribe`, Lead Converter calls), a WAV of at most 15 minutes. It then transcribes through V1's `transcribeRecording()`, metered against the Co-pilot's caps, checks the transcript is Roman script, masks it whole (`maskWholeText()`), stores it and records it (`calls.transcript.attach`). After that, Haiku 5.5 writes the summary, the facts heard and the outcome.
  - Each run is one runtime step per action type, keyed by the event. The model's answer is kept for an hour under `copilot:answer:{eventId}`. The note is recorded with `agents.note.record`, with the facts' suggestion as its `agentActionId`.
  - Kill switches, a missing cap and the Co-pilot's own cap (`companyDailyCapPaise`, ₹100 a day per company, beside the Executive's) each stop a run before anything is read.
- **Migrations** `0191_copilot_workers` (custom) and `0192_copilot_chat` (custom):
  - `app.copilot_call_facts()` and `app.attach_call_transcript()`, both `calls.process`.
  - `app.call_recordings_due()` and `app.drop_call_recording()` redefined so they also cover `call_transcript`. Every other line of 0173's and 0169's definitions is kept.
  - `app.copilot_lead_chat()` and `app.copilot_chat_messages()` serve `agent:copilot` only (`app.role`, `crm.lead.read:entity`). A chat is read under the customer's rule, which the Co-pilot does not hold; I chose not to give it `crm.account.read`.
- **Commands:**
  - `agents.brief.request`: people only, `crm.lead.read:own`, the lead open, no brief within the hour. It emits `agents.brief.requested`.
  - `calls.transcript.attach`: the platform's, `calls.process`, audited on a change. Both are registered, labelled in `audit.ts`, in the agent refusal sweep, and the event is in the catalogue.
- **Autonomy:** `AGENT_DEFAULTS.startingAutonomy` now starts `agent:copilot` in Shadow. Raising an action type to Needs approval is done on Admin › Agents.
- **Screens:**
  - `apps/web/src/screens/copilot/copilot-panel.tsx` holds `useCopilot` and `CopilotPanel`. It is mounted in `calling-screen.tsx` and in Converting's calls panel (`lead-workspace.tsx`), three lines each: the hook, the panel and `suggestedId` on `Outcomes`.
  - The panel shows the brief (Ask for a brief, once an hour), the last call's summary with the facts heard and the suggested outcome, and the suggestions in the caller's inbox scope. A approves and R rejects the first suggestion that needs approval; a suggestion to act on herself is dismissed.
  - `Outcomes` (`calling-parts.tsx`) highlights the suggested outcome with a note. Nothing is saved until the caller chooses.
  - Admin › Agents › Co-pilot report (`/admin/agents/copilot`, `apps/web/src/screens/copilot/copilot-report.tsx`, a link on Admin › Agents). It shows agreement on outcomes and on facts, the filter's refusals by reason, the suggestions by action type and how they ended, and each call summary beside the outcome saved and the facts the lead holds.
  - The inbox card shows a template by its label: new summary kind `template` and `templateLabelKey()`, as the lead's read allowed.
  - Copy is in `en.json` under `agents.copilot`, `agents.copilotReport`, `calling.outcomes.suggested` and the errors.
- **Sets:**
  - `packages/domain/tests/fixtures/copilot-sets.ts`: 7 eval cases (made-up Hinglish calls and briefs, with the facts and outcome a person takes) and 10 injection cases (instructions spoken in a call or written in a customer's message). They run on recorded answers in CI (`src/ai/copilot/copilot-sets.test.ts`).
  - `scripts/eval-copilot.ts` and the `eval:copilot` script run them on the live model. I did not run it live (no key, by instruction). Without a key it refuses and runs nothing; this was checked.
- **Documents:**
  - DATABASE: the definers in §4.1, the `files` purpose, transcript retention, and the `copilot_notes` reads.
  - SECURITY: the `calls.process` row, the starting autonomy, a new "The Caller Co-pilot" part of §3.3, the §6 injection and eval lines, and a §7 line on call transcription.
  - ARCHITECTURE §11, the design's "Built (A2)" under §7.3, `.env.example` (`CALL_TRANSCRIBE`), and `pnpm db:docs` regenerated.

**Decisions the brief did not settle**
- **The assigned-lead event's route.** `crm.opportunity.assigned` no longer goes to the notify route, whose 30 seconds would not hold a model call. It now uses its own event route (60 seconds), whose registry worker sends the notices first and then writes the brief (`qstash.ts`, test updated). This changes hosted delivery of a Phase 1 notice, so the lead should know.
- **Notes in Shadow.** Notes (the brief, the summary, the outcome highlight) show whatever the autonomy while the Co-pilot is switched on; Shadow applies to the action types only. A run needs at least one of its kind's action types switched on, because a stopped step never calls the model.
- **The transcription switch.** Call transcription needs its own switch, `CALL_TRANSCRIBE=on`, beside `KNOWLEDGE_TRANSCRIBE`. A call recording holds a customer's voice, so the owner turns it on with the data terms and the recording notice. It reuses K3's `recordingTranscriber()`.
- **Recordings that arrive late.** The status is recorded before the recording is copied in. A covered, completed call with no recording yet is delivered again for `recordingWaitMinutes` (5), with reason `call_recording_pending`, and is left alone after that. This only happens with the Co-pilot on and a speech service set.
- **Limits on what is transcribed and read.** Only WAV recordings are transcribed, at most 15 minutes (`maxCallMinutes`), so that one call fits the event route's minute. Exotel's MP3 waits for a decoder, as K3's did. The stored transcript keeps its last 100,000 characters, and the model reads its last 18,000 (the masker's limit is 20,000).
- **Transcript retention.** Transcripts are kept and removed with their recordings (12 months, and at once for an anonymised lead).
- **Which prompts get the directives.** The directives (at most 30) go into the brief's prompt only.
- **Templates in the prompt.** Templates are offered in the prompt only on a day one is due (a nurture day, or two days before a sent quote expires), with a consent in force and a chat.
- **The panel's reads.** The panel shows a summary only for a dial of the lead (`direction = 'outbound'`, inner join to `provider_calls`), and pre-selects only while that call is not logged. It reads the suggested facts from `agent_actions.input_json`, which a caller may read for an inbox item of hers. `ListInboxInput` gained optional `subjectId` and `agent` (additive).
- **Test settings.** The runtime and inbox suites now name Suggest for their Co-pilot stand-in, since its default is Shadow.

**Tests added**
- `packages/domain/tests/commands/copilot-runs.test.ts`, 16 tests:
  - the brief request: denied, wrong company, happy path with the event, the hour, a closed lead;
  - the transcript attach: denied, wrong company, happy path, once only, read with the lead;
  - briefs: stopped with no cap and when switched off, the company cap, masked and labelled in Shadow, a repeat or the hour asking nothing, Needs approval for the owner, a refused note;
  - summaries: outside coverage, transcribed and masked before storage, never logged and asked once, the recording wait, switched off, no speech service, MP3.
- `packages/db/tests/security/copilot-notes.test.ts`: 3 more tests (the definers' grants and companies).
- `apps/web/tests/copilot-workers.test.ts`, 6 tests: the registry, the brief through its event and a repeat, unavailable without a key, the switch, a non-dial, and the speech switch.
- Unit tests:
  - `copilot-sets.test.ts`: 19 (7 eval, 10 injection, 2 counts);
  - `prompt.test.ts`: 4;
  - `config.test.ts`: 1;
  - `qstash.test.ts`: 1.
- Updated: reader parity (the panel and report queries), the people-only sweep, the unmasked-field example, the catalogue's subscribed list, the client namespaces, the contract values.
- Journey `apps/web/e2e/copilot.spec.ts`, with axe, and its seed `e2e/setup/copilot.ts` plus `e2e/copilot-fixtures.ts`. There is one fresh lead per project for Neha Saini, with a brief two hours old, an unlogged dial, its summary and two Needs approval suggestions. It covers the brief, the summary, the highlighted outcome, A and R, Ask for a brief, and the panel on Converting.

**Checks** (all through the lock, on Postgres 54333)
- `pnpm test:security`:
  - db: `54 passed (54)`, `1443 passed (1443)`;
  - domain: `92 passed (92)`, `1280 passed (1280)`;
  - web: `33 passed (33)`, `408 passed (408)`;
  - `Tasks: 4 successful, 4 total`.
- `turbo run test --force`:
  - domain: `101 passed (101)`, `2590 passed (2590)`;
  - web: `144 passed (144)`, `1098 passed | 1 skipped`;
  - db: `158 passed`; contracts: `194 passed`; ui: `107`; tokens: `146`; copy-lint: `17`.
- `turbo run typecheck --force`: `8 successful`. `pnpm lint` (whole repository): exit 0. `pnpm copy-lint`: clean. `pnpm db:docs` regenerated; `machines:docs` had no change.
- `pnpm build`: compiled. `pnpm --filter web js-budget`: `Every page is within its budget (52 pages)`.
  - `/admin/agents/copilot` is new, at 230.1 kB with a budget of 242.
  - `/calling` is at 204.9 of 206 kB; `/converting` at 208.2 of 213 kB.
- Journeys, seeded on the host:
  - `copilot.spec.ts` passed in all three projects.
  - `calling`, `converting`, `agents` and `click-to-dial` failed only at `toHaveScreenshot`: 27 picture differences from the host renderer, and the panel now on `/calling` and `/converting`.
  - Run again on desktop-light with pictures refreshed, the five specs gave `35 passed`, so every step after the pictures holds.
  - The refreshed and new pictures were thrown away; no baseline is committed.
- `EXPLAIN (ANALYZE)` (`pnpm --filter @shakti/domain spike:copilot`, 3,000 leads with briefs, dials and summaries in company 2, under RLS):

| Query | Reader | Plan | Time |
|---|---|---|---|
| Panel: newest brief | tele-caller | `copilot_notes_opportunity_idx` | 0.29 ms |
| Panel: newest summary | tele-caller | `copilot_notes_opportunity_idx` + `provider_calls_opportunity_started_idx` | 0.40 ms |
| Report: first page of 30 days | Executive | `copilot_notes_entity_created_idx` | 5.6 ms |
| Report: outcome agreement over 1,467 summaries | Executive | `copilot_notes_entity_created_idx` | 8.0 ms |
| Report: refused runs | Executive | — | 0.10 ms |

**Screens and baselines for the lead**
- New: `copilot-panel` (desktop-light, desktop-dark, phone) from `copilot.spec.ts`.
- Changed by the panel on `/calling` and `/converting`: `calling`, `converting-board`, `converting-quote` and `call-bar-ended`.
- Changed because the Co-pilot now starts in Shadow and the seed adds Co-pilot items: `agent-inbox` and `admin-agents`.
- The new report page `/admin/agents/copilot` has no picture.

**Not done, or open**
- No live model, Sarvam or Exotel call was made. `eval:copilot` was not run live.
- Live recordings wait for the owner's Exotel notice. MP3 recordings wait for a decoder (the owner's yes).
- `agents.note.write` can still be offered by the role editor. This is the `roleMayHold()` follow-up the lead noted.
- The pull request will need the owner's `checks-ok`: the `eval:copilot` and `spike:copilot` scripts, and `js-budget.json`. The copy-lint config gained the button key `askBrief`.
- Merge points:
  - the redefined `app.call_recordings_due()` and `app.drop_call_recording()`;
  - the removed `crm.opportunity.assigned` line in `EVENT_JOB_ROUTES`;
  - `startingAutonomy`;
  - the copilot rows the e2e seed sets for companies 1 to 3.

## Review

### Slice review, 18-11-2026 (slice-reviewer, head 1e8a03cd, diff from the merge base 9b6ea163)
No critical or high finding. 6 medium, 9 low. Run on Postgres 54333 through the lock: `copilot-notes`, `role-entity-matrix` and `grants` security files `297 passed`; `copilot.test.ts`, `copilot-runs.test.ts` and `agent-refusals.test.ts` `87 passed`.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| 1 | Medium | `packages/domain/src/commands/agents/brief-request.ts:45-58`; `apps/web/src/screens/copilot/copilot-panel.tsx:96-109` | The hour limit counts only briefs that were recorded. A request that produced no note (filtered, model unavailable, cap reached) does not count, and nothing locks the lead, so two requests at once both pass. The panel turns the button back on after 20 polls (80 s) when no brief arrived. | A caller, or a script on the server action, asks again every 80 s on a lead whose briefs the filter refuses. Each request is one Sonnet call at about ₹4 reserved, so the company's ₹100 for the day goes in about 25 asks. Every call summary in that company then stops for the rest of the day. | Hold the lead (`lockOpportunity`) and refuse when an `agents.brief.requested` event or a `copilot_brief` run for the lead falls within the hour, not only a note. | confirmed (read end to end) |
| 2 | Medium | `packages/domain/src/ai/copilot/run-copilot.ts:214-236`; `summarise-call.ts:219-233` | `copilotMayRun()` checks only that a cap is set. When the day's spend has already reached the cap, the brief still reads the lead, its chat (through the chat definers) and the directives, and the summary still downloads the whole recording from the store; only then does the reservation refuse. The brief asked for the cap to stop the workers before anything is read. `copilot-runs.test.ts:438` shows this: the model is not called, but the facts are read first. | After the cap is reached at noon, each later assignment or ended call still reads customer chat text, or downloads a WAV of up to about 28 MB, only for the reservation to refuse it. | Before reading, check the agent's spend key for the day against the settings' caps and `companyDailyCapPaise`. Read only (no reservation), the same check the provider makes, and record `cap_reached` without reading. | confirmed |
| 3 | Medium | `apps/web/src/screens/copilot/copilot-panel.tsx:147-176`; `packages/domain/src/queries/agents/copilot.ts:166-167` | In Shadow the caller still sees the summary's facts and the suggested outcome, highlighted among the outcomes. The shadow report then measures how often callers "agreed" after they saw the suggestion. | The Executive raises an action type from Shadow on agreement figures inflated by anchoring. That is the decision the design's "Shadow, then Needs approval after review" depends on. It also differs from SECURITY's Shadow ("records what it would propose", as Triage does). | The lead or owner decides. Either hide the outcome highlight and the facts heard while the summary's action types are in Shadow, or mark in the report which summaries the caller saw. | confirmed (design question) |
| 4 | Medium | `packages/domain/src/ai/copilot/summarise-call.ts:233-246`, `run-copilot.ts:238-255`; `apps/web/src/app/api/v1/workers/outbox/[type]/route.ts:22` | One summary run can use 40 s to transcribe (`totalTimeoutMs`), then up to 40 s more for the model, plus the reads and the store, on a route that stops at 60 s. Neither step uses `ctx.startedAt`. | A 12 to 15 minute call on a slow vendor: Vercel stops the function partway through. If it stops between `store.put` and the attach, the transcript object has no `files` row (see 7). The event's claim then holds for 6 minutes, and the retry transcribes again (paid twice) or asks the model again. Spend reserved by the stopped run is never settled. | Bound each step by what is left of the route's time (`ctx.startedAt`), for example a 25 s transcription and the remainder for the model. Or hand the summary on as a second job once the transcript is attached. | plausible |
| 5 | Medium | `apps/web/src/workers/events/registry.ts:172-180`; `AGENT_DEFAULTS.copilot.companyDailyCapPaise` | Every `crm.opportunity.assigned` starts a Sonnet brief, and briefs draw on the same ₹100 a day as the call summaries. The event also comes from `crm.lead.reassign_all` and `crm.opportunity.hand_over`. | A normal day of Triage assignments, or one handover of a leaving caller's leads, uses the cap on briefs for leads nobody calls today (about ₹4 reserved each, so roughly 25 briefs). The covered Lead Converter calls then get no summary. | For the owner: give briefs and summaries separate daily amounts (the provider's `part` cap), or skip the brief on bulk reassignment and handover and write it when the lead is opened. | plausible |
| 6 | Medium | `apps/web/src/app/(bos)/admin/agents/copilot/page.tsx`; `apps/web/e2e/copilot.spec.ts` | The new report page `/admin/agents/copilot` has no journey, axe check or screenshot. AGENTS §10 requires all three for a new screen. | The page's access, layout and contrast in light, dark and at 400 px are unchecked, as is its company and period form. A regression there goes unnoticed. | Add a journey step as the Executive: open the page from Admin › Agents, run axe and take a `copilot-report` snapshot. Its seed already writes summaries. | confirmed |
| 7 | Low | `packages/domain/src/ai/copilot/summarise-call.ts:277-296` | The transcript is put in the store before `calls.transcript.attach` records it. If the attach answers `not_recorded` or `missing`, or the run stops in between, the object stays in the store with no `files` row. | The retention sweep finds files only through `app.call_recordings_due()`, so a masked transcript is never removed: not after 12 months, and not on anonymisation. | Delete the object when the attach does not answer `attached` or `already`. Or record the file row first (`pending`) and mark it ready after the put, as uploads do. | confirmed |
| 8 | Low | `packages/db/migrations/0191_copilot_workers.sql` §3 and §4 | The redefined `app.call_recordings_due()` and `app.drop_call_recording()` keep every line of main's latest versions (0173 and 0169; nothing on `origin/main` redefines them since, including V2's 0189 to 0194). But no test shows the sweep listing and removing a `call_transcript`, either by age or for an anonymised lead. | The retention claim in DATABASE and SECURITY §7 for transcripts rests on reading the code alone. A later merge that redefines the function from 0173 would drop transcripts with no test failing. | Add a case to the provider-calls or copilot security test: a transcript older than the period and one on an anonymised lead are listed, and `drop_call_recording` marks them deleted. | confirmed (test gap) |
| 9 | Low | `packages/domain/src/queries/agents/copilot.ts:112-124, 166-167` | The outcome is pre-selected from the newest summary while its call is not logged. That call may be someone else's (`pc.caller_id` is not compared with the viewer) or an older dial that was never logged. | Call A is summarised and never logged; the caller redials and logs call B. Every later visit to the lead, by anyone, still highlights A's suggested outcome. | Pre-select only when the summarised call is the viewer's own and is the lead's newest dial. | confirmed |
| 10 | Low | `packages/domain/tests/security/agent-refusals.test.ts:834-895` | The report says `calls.transcript.attach` is in the agent refusal sweep. It is not: the platform sweep (`CHECKS`) does not list it. Only `copilot-runs.test.ts:354` refuses it, and only for `agent:triage` and `agent:copilot`. | A later grant of `calls.process` to an agent is not caught by the sweep that covers every agent. | Add `calls.transcript.attach` (and T3's `calls.*` platform commands) to `CHECKS`. | confirmed |
| 11 | Low | `docs/06-api.md:146`; `docs/02-prd.md` §8 (TEL-03, AI-04, AI-05 rows) | The API document still says the publisher sends `crm.opportunity.assigned` to `/workers/notify`. The PRD trace rows do not name the Co-pilot's tests (W1 added its own to TEL-03). | A reader of the API document looks for the assigned-lead notice on the wrong route. | Move `crm.opportunity.assigned` to the event route's line in 06-api. Add `copilot-runs.test.ts`, `copilot-notes.test.ts`, `copilot-sets.test.ts` and `copilot.spec.ts` to the TEL-03, AI-04 and AI-05 trace rows. | confirmed |
| 12 | Low | `apps/web/tests/copilot-workers.test.ts` | Nothing tests the rerouted assigned-lead worker end to end: a brief that throws after the notices, a retry that writes no second notice, notices still written when the brief fails. `notifications.test.ts:260` covers only the in-process path, where the brief records `unavailable`. | A later change that awaits the brief before the notices, or lets a brief error escape before `notify`, would hold the Phase 1 notice back with no test failing. | One test: an assigned event whose brief path throws `integration_unavailable`, delivered twice. Assert one notice, written on the first delivery. | confirmed (test gap) |
| 13 | Low | `packages/domain/src/ai/copilot/summarise-call.ts:267` | `maskWholeText()` masks digit runs. An Aadhaar number spoken as Hindi or English number words ("nau aath saat ...") stays in the stored transcript if Sarvam's `translit` output keeps words. | An identity number spoken in a call would be stored, and sent to Haiku, unmasked, against the rule that Aadhaar is never stored. | Check Sarvam's output for spoken digits on a recorded fixture. If it keeps words, turn number words into digits before masking. | plausible |
| 14 | Low | `packages/domain/src/ai/copilot/read-facts.ts:179-180`; `prompt.ts:172-175` | The brief sends the chat's outbound text messages as written by staff. A free-text reply quoting a price reaches the model. The brief's checklist says no price in a prompt; the set's `/₹|price|cost/` check covers only fixtures. | A brief prompt carries "Your quote is ₹2,40,000". | Leave outbound session text out of the brief (keep the direction and the time), or drop amounts from it. | plausible |
| 15 | Low | `packages/domain/src/ai/copilot/filter.ts:131`; `prompt.ts:33` | The brief prompt asks for "what the caller should do", but the note filter refuses "you should" and "you must". | A large share of live briefs is refused as `text_has_instruction`, each paid for. `eval:copilot` was not run live, so the refusal rate is not known. | Tell the prompt to write the advice in the imperative ("Ask about ...") and name the banned phrasing. Or drop "you should" from the rule. Run `eval:copilot` before raising autonomy. | plausible |

**Checked and sound**
- The agent principal. `AGENT_MATRIX['agent:copilot']` holds `crm.lead.read:entity`, `crm.lead.write:entity`, `knowledge.vault.read.staff:all` and `agents.note.write:entity`. It holds nothing restricted, platform-only, `sales.*`, pricing, `calls.dial`, `calls.recording.listen` or `calls.log`; the sweep asserts this and passes. It acts only through `runAgentStep()` and `agents.note.record`. Its suggestions start `shadowed`, and `messaging.template.request` refuses every agent in its handler: approved, it runs as the person under their own `messaging.send`. No agent logs the outcome.
- `copilot_notes`. RLS is enabled and forced, and fails closed. Read with the lead for `app_user` and `app_reader`. Insert only for `app.role = 'agent:copilot'` holding the grant, as itself, in the lead's company, with the call and outcome checked. Append-only, with the anonymisation's one exception. It is in the testing lists, the fixture and the matrix.
- `app.anonymise_stale_leads()` keeps every line of 0188. `files_purpose_check` and `agent_runs_filter_reason_check` keep every earlier value. Main has changed none of them since.
- The definers: `copilot_call_facts`, `attach_call_transcript`, `copilot_lead_chat`, `copilot_chat_messages` and `copilot_require_lead`. Each sets `search_path = ''` and checks permission and company in its body (`require_calls_process`; `app.role`, `crm.lead.read:entity` and the request's companies). Each revokes `public` and `readonly_reporter`; the helper is not granted. The chat is tied to the lead's customer and company.
- Masking and labels. The transcript is masked whole before it is stored and masked and labelled again in the prompt. Chat bodies are masked as stored, then labelled. The note is checked by the filter and masked again in the command. The audit keeps the lead, the call and the kind, never the text. The injection set runs the real prompt builder, the provider wrapper and the filter on recorded answers, including a label closed early.
- The kill switches and a missing cap stop a run before anything is read (`copilotMayRun`). The cap reservation is atomic (`incrBy` per agent and company), so concurrent runs cannot both pass it. The ₹100 ceiling applies to model calls and transcription alike. `CALL_TRANSCRIBE` and the coverage setting are checked before any recording leaves the BOS.
- The reroute. `crm.opportunity.assigned` now goes to its own queue group, made lazily by `ensureUrlGroups`. The worker sends the notices before the brief. Model failures are recorded by `runAgentStep()` and do not throw, so a retry happens only on a store or database fault, and the notices are idempotent ("a repeat writes and pushes nothing new"). Events already queued to `/workers/notify` are still handled there.
- The commands. Each new one has denied, wrong-company and happy-path tests that pass. `auditFields` keys are labelled. `agents.brief.request` is people-only and in the sweep. The panel and report go through `executeQuery`/`executeCommand` with names. The report page uses `screenAccess(navRequires('admin-agents'))` and its query checks the agent controls again. Browser code imports only types from `@shakti/contracts`. Copy is in `en.json` and passes copy-lint. The `EXPLAIN` evidence covers the panel and report reads.

**Could not check**
- No Linux baselines (the lead makes them). No screenshots were committed, so layout was not reviewed.
- No live Sonnet, Haiku or Sarvam call: the refusal rate in 15 and Sarvam's spoken-digit output in 13 are open.
- The whole `pnpm test:security` and the journeys were not run again here (single files only, by instruction).

**Merge points for the lead** (beyond the run file's list). Main's V2 added a `voice_session` principal and `voiceSession` on `peopleOnly`. `messaging.template.request` refuses only `isAgent`, so check that no voice route can reach it. Main's `agent-defaults.ts` also changed (V2): keep both the Co-pilot block and `startingAutonomy`.

### Lead's fix list, 18-11-2026
Every finding is fixed in one fix round on this branch, each with a test that fails before the fix; the builder reports each under Report › Fix round with its commit. Two design points are the lead's call, recorded here and told to the owner.
- 1: "Ask for a brief" locks the lead and counts brief requests and runs in the hour, not only saved briefs; the panel's button follows the same rule.
- 2: before anything is read or downloaded, a run checks today's spend against the cap (with the run's largest estimate) and stops when it would not fit; the reservation stays as the final guard.
- 3 (lead's decision): in Shadow the caller sees the brief and the summary text, but no suggested outcome is pre-selected or highlighted and no proposed fact or suggestion is shown; the shadow report then measures callers who did not see the suggestion. Needs approval shows them as built.
- 4: transcription and the model call are each bounded by the time left on the route, and a run that cannot finish in time stops before it spends; a transcript whose attach fails is removed from the store (see 7).
- 5 (lead's decision): briefs may use at most half of a company's daily cap, so call summaries keep the other half; bulk reassignments brief only leads with no brief in the last 24 hours.
- 6: a journey for `/admin/agents/copilot` with axe and light, dark and 400 px snapshots (the lead makes the Linux baselines).
- 7: a transcript stored before a failed attach is deleted by the run, and the retention sweep removes any transcript object with no file row.
- 8: tests that the sweep removes transcripts by age and for an anonymised lead.
- 9: the outcome is pre-selected only from the caller's own latest call on that lead that is not yet logged.
- 10: `calls.transcript.attach` joins the agent refusal sweep (and the report's sentence is made true).
- 11: `docs/06-api.md` routes `crm.opportunity.assigned` to its own event route; PRD §8's TEL-03, AI-04 and AI-05 rows name the Co-pilot's tests.
- 12: a test of the assigned-lead worker where the brief throws after the notices: the notices are sent once and a retry repeats none.
- 13: the transcript masking also catches a 12-digit identity number spoken as English or Hindi digit words in Roman script, with tests; the shared finder in `packages/domain/src/privacy` gains the rule only if it applies to every caller of it.
- 14: amounts in staff messages are masked before the brief's prompt, so no price reaches it.
- 15: the brief's prompt and the filter agree (the prompt asks for next steps in words the filter allows).
- Merge point: `messaging.template.request` refuses every principal but a person (`peopleOnly`, which V2's `voiceSession` covers), with a test once `main` is taken in at integration.

## Integration
### Lead's read of the early check, 17-11-2026
Passed. `app.anonymise_stale_leads()` keeps every line of 0188 and adds the `copilot_notes` delete; `files_purpose_check` keeps every earlier purpose. The `provider_calls_inbound_check` seen once on 54333 is T4's constraint, from outside this worktree; slot 3's database is recreated before steps 5 to 9. The inbox card may show a template's label through one additive summary field; making `agents.note.write` agent-only in `roleMayHold()` is a follow-up, since the insert policy already refuses every writer but the Co-pilot. After T4 merges, `provider_calls.opportunity_id` is nullable: the panel and workers read only dial calls with a lead.
