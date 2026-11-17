# A2 Caller Co-pilot (wave 3)

| | |
|---|---|
| Branch | `feat/a2-copilot` on GitHub, from `main` at 9b6ea163 |
| Worktree | `a2-copilot`, slot 3 (Postgres 54333, app 3033), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an AI agent principal, call recordings and transcripts |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | early check passed (lead, 17-11) |
| Next step | a builder resumes steps 5 to 9 on a fresh slot database |

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

## Review

## Integration
### Lead's read of the early check, 17-11-2026
Passed. `app.anonymise_stale_leads()` keeps every line of 0188 and adds the `copilot_notes` delete; `files_purpose_check` keeps every earlier purpose. The `provider_calls_inbound_check` seen once on 54333 is T4's constraint, from outside this worktree; slot 3's database is recreated before steps 5 to 9. The inbox card may show a template's label through one additive summary field; making `agents.note.write` agent-only in `roleMayHold()` is a follow-up, since the insert policy already refuses every writer but the Co-pilot. After T4 merges, `provider_calls.opportunity_id` is nullable: the panel and workers read only dial calls with a lead.
