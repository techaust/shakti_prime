# A2 Caller Co-pilot (wave 3)

| | |
|---|---|
| Branch | `feat/a2-copilot` on GitHub, from `main` at 9b6ea163 |
| Worktree | `a2-copilot`, slot 3 (Postgres 54333, app 3033), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an AI agent principal, call recordings and transcripts |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

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

## Review

## Integration
