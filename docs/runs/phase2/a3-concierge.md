# A3 WhatsApp Concierge (wave 3)

| | |
|---|---|
| Branch | `feat/a3-concierge` on GitHub, from `main` at 9b6ea163 |
| Worktree | `a3-concierge`, slot 2 (Postgres 54332, app 3032), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an AI agent principal answering customers, row-level security bound to one thread |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §7.2](../../03-roadmap-appendix/phase2.md#72-a3-whatsapp-concierge), §2 (question 2: the welcome is W1's template, the Concierge's own replies Shadow then Needs approval), §3 (wave 3 file ownership: A3 owns the draft line in W1's thread component), §4 (`agent:concierge` gains `messaging.send:own`; `own` for an agent means the one thread a run is bound to), §9.1 (models), §10 and §11 (the Concierge's cap), §14 and §15 (first touch, documents and visits not in Phase 2).
- The Phase 1 agent pattern to follow, not duplicate: the runtime `packages/domain/src/ai/runtime.ts`, `config.ts` (kill switches, autonomy), `action-types.ts` (`AGENT_ACTION_TYPES`), `agent-defaults.ts` (`AGENT_DEFAULTS.concierge.handlesNewThreads`, false until you turn it on), the Triage agent in `packages/domain/src/ai/triage/` (prompt, facts, deterministic filter) and its worker `apps/web/src/workers/triage/`, `eval:triage` (`packages/domain/scripts/eval-triage.ts`), the agent actions table and its approval commands; [a1-triage.md](../phase1/a1-triage.md) and [ai0-agent-runtime.md](../phase1/ai0-agent-runtime.md).
- Built (W1, K2, I1): [w1-whatsapp.md](w1-whatsapp.md), [k2-playbook.md](k2-playbook.md) (approved `customer` directives), [i1-ingest.md](i1-ingest.md) (`crm.lead.qualification.set`); `whatsapp_threads.handled_by`, `messaging.thread.hand_off` and the platform's `messaging.thread.record_hand_off`, the thread component `apps/web/src/screens/messaging`; `AGENT_MATRIX` in `packages/contracts/src/agent-principals.ts`.
- BLUEPRINT §7.8, §9.3; PRD AI-04, AI-05, AI-06; SECURITY §3.3, §3.4 and §7 (customer WhatsApp content is untrusted input; prompt injection).
- Skills: `add-command`, `add-table` (if you add a table).

Build, in this order:
1. **The thread binding (RLS):** the request context carries `app.agent_thread_id` (set only by `withRequestContext()` for an agent principal's run; never from a request); for an agent principal, the `own` scope of the lead, customer, thread and message policies matches only that thread's customer and lead, and nothing when the setting is unset (fail closed). Read every current policy definition from `main`'s newest migration that defines it before redefining; keep every clause other slices added. Security suite: a run bound to customer A's thread reads nothing of customer B (leads, customers, threads, messages, consents, files) and nothing at all unbound.
2. **Permissions:** `agent:concierge` gains `messaging.send:own` (`AGENT_MATRIX`, seed, SECURITY §3.3, the oracle case); it never holds any cost, price-list, `sales.*` or platform-only grant (the refusal sweep proves it).
3. **Action types and commands:** `messaging.reply.send` (an in-window English reply; approved, it is sent by the approving person through W1's `messaging.message.send` and marked as drafted by the assistant), `crm.lead.qualification.set` and `crm.task.create` (for the lead's owner, inside calling hours) as Concierge proposals in `AGENT_ACTION_TYPES`; a handoff is not an action: the worker hands the thread to people through the platform's hand-off. Denied, wrong-company and happy-path tests on real Postgres.
4. **Filter** `filterConciergeAnswer()` (deterministic, in `packages/domain/src/ai/concierge/`), exactly as §7.2 lists: one JSON object; reply ≤ 600 characters; links only to the companies' sites; no phone but the company's; no identity, bank, rupee amount, percentage, kW, HP or date unless in a cited `customer` directive or the thread's own facts; no word of `WORKSHOP_DEFAULTS.whatsapp.promiseWords` (new: discount, guarantee, free and the like); no instruction, code or bracket; a reply citing no directive is one of the fixed forms. Unit tests for every rule.

**Early check (Tier A):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: a3-concierge early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 9.

5. **Worker:** on `messaging.message.received` for a thread `handled_by` the assistant, as `agent:concierge`, one runtime step per message keyed by the message id. It reads the thread's last 20 messages (masked, labelled `untrusted_data`, Devanagari kept as received), the lead's segment, stage and qualification facts, open callbacks and approved `customer` directives; nothing else. Skip a message the platform already answered: S3 (built beside you) exports `isHandledByPlatform(message)` from `apps/web/src/workers/messaging/`; until its branch merges, keep a local predicate of the same name and signature in your own file, matching W1's keywords and a bare six-digit code, and say in your report where it is so the lead swaps it at merge. Handoff rules (HUMAN, complaint or legal words, three filtered or unreadable answers in a row, a price or subsidy question, low confidence) hand the thread to people at once. Limits: a daily spend cap per company (₹500, `AGENT_DEFAULTS.concierge`), 30 runs a thread a day, the kill switches. Turn `AGENT_DEFAULTS.concierge.handlesNewThreads` on and give back the screens' "give back to the assistant" that W1 hid (read W1's integration notes for where).
6. **Autonomy:** Shadow first (`AGENT_DEFAULTS.startingAutonomy`): drafts recorded, no message; Needs approval after the Executive reviews the shadow report: the draft shown in the thread for the owner to send (S), edit (E) or discard (D). Automatic stays unavailable.
7. **Screens:** the draft line in W1's thread component (your own component, mounted with one line); the shadow report on the agents admin screen (every draft beside what the person sent). Copy in `en.json`; journeys with axe and light, dark and 400 px snapshots; the JavaScript budget.
8. **Sets:** an eval set of made-up conversations per segment (qualification, callback, STATUS, out-of-scope) and a prompt-injection set (instructions in a message, in a document's name, in a contact's profile name; asking for another customer's details, a price, a discount, a promise; tool misuse; a label closed early), run in CI on recorded answers and by hand on the live model (`eval:concierge`, a `package.json` script, which makes the pull request need the owner's `checks-ok`); every injection case fails safely. No live model call in any test.
9. **Documents:** SECURITY §3.3, §3.4 and §7, the agents' document, the design's "Built (A3)" under §7.2, `pnpm db:docs`.

Files owned: `packages/domain/src/ai/concierge/`, the Concierge worker, the draft line component and its mount in the thread component, the shadow report, the policies' agent `own` clause for threads. Shared registration points (one line each, merged by the lead): `AGENT_MATRIX`, `AGENT_ACTION_TYPES`, `AGENT_DEFAULTS`, `WORKSHOP_DEFAULTS`, the permission seed, `en.json`, the event worker registry, the testing lists, `package.json` scripts.

Built beside you, do not touch: S3 owns `apps/web/src/workers/webhooks/whatsapp.ts` changes, `sales.quote.send`, buttons and codes; A2 owns the Co-pilot (`copilot_notes`, `agents.note.write`, the panel in `/calling` and `/converting`) and also appends to `AGENT_ACTION_TYPES` and `AGENT_DEFAULTS`: keep your entries together under a Concierge comment; T4 owns the app shell; V2 owns `apps/voice-agent`. Your migrations are numbered after `main`'s last (0188) and renumbered by the lead at merge.

Review checklist (check before your report): nothing reaches a customer without a person's approval; the binding fails closed and a run reads one thread's customer only; customer text is data, never instructions, labelled and masked; every injection case fails safely; the filter refuses every listed class; spend and run caps and kill switches stop the worker; no cost or price data in the prompt.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §7.2 pass; `pnpm test:security` passes on your Postgres.

Not in A3: Automatic autonomy (Phase 6); document filing and site visits (Phase 4); the live model's shadow run on real threads (final phase).

## Report

## Review

## Integration
