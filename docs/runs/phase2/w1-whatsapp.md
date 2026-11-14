# W1 WhatsApp threads and messaging (wave 2)

| | |
|---|---|
| Branch | `feat/w1-whatsapp` on GitHub, from `main` at 27662a00 |
| Worktree | `w1-whatsapp`, slot 2 (Postgres 54332, app 3032), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 14-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high; 5-hour window 0 % at 07:00 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §6.1](../../03-roadmap-appendix/phase2.md#61-w1-whatsapp-threads-and-messaging), §2 (question 2 (a): the deterministic welcome sent by the messaging worker on a customer's first message; question 3: the owner of a new lead; question 13), §3 (wave 2 file ownership), §4 (`messaging.send`, `messaging.templates.write`, platform-only `messaging.process`), §11 (the `whatsapp` defaults, WhatsApp media retention), §14 and §15.
- Built (P5) and (E1) in §5.1 and §5.2: `webhook_inbox`, the worker and the empty handler registry `apps/web/src/workers/webhooks/registry.ts`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; `entity_channels` (`whatsapp` channel, `provider_ref` = `phone_number_id`).
- `docs/04-architecture-appendix/whatsapp.md`; BLUEPRINT §7.8 and §7.9; PRD WA-04, CRM-01, CRM-10, TEL-03; SECURITY §6 and §7 (customer WhatsApp content is untrusted input); DATABASE §5 (the planned `whatsapp_threads`).
- What exists: `packages/contracts/src/api/messaging.ts` (`MessageRequested`, `MESSAGING_REFUSALS`); the WhatsApp client and webhook parser `apps/web/src/integrations/whatsapp/`; P2's file checks (`apps/web/src/files`, malware tag, re-encoding, masking before `ready`); the shared identity-number finder (`packages/domain/src/privacy`); consents (`packages/domain/src/commands/crm/consent.ts`); `activities`' monthly partitions in a closed schema (the pattern for `whatsapp_messages`); the Redis client; notifications.
- Skills: `add-table`, `add-command`.

**Ordering with I1:** an unknown number's lead is created through I1's `crm.lead.ingest` (channel `whatsapp`, the `referral` as attribution). I1 builds beside you and merges first. Build everything else first; once I1 has pushed its contract commit (`feat(contracts): crm.lead.ingest input` on `feat/i1-ingest`), code against that input shape behind a small port of your own in the handler (`ingestLead(input)`), with a fake in your tests. Do not merge or cherry-pick I1's branch. The lead takes `main` into your branch once I1 merges and you wire the port to the real command then.

Build, in this order:
1. **Tables** `whatsapp_threads`, `whatsapp_messages` (monthly partitions in a closed schema, as `activities`), `whatsapp_message_keys` and `whatsapp_templates` as §6.1 says, with RLS (threads and messages under the customer's read rule, as Account 360; templates by company), the testing lists, fixture rows, the role × company matrix, partitions (AGENTS §6). A status only moves forward (guard trigger). `body_masked` is masked before storage.
2. **Permissions** `messaging.send` (scopes of §4), `messaging.templates.write` (Executive, all) and the platform-only `messaging.process` of `system:workers` (catalogue, scopes, `SYSTEM_MATRIX`, seed, SECURITY §3.2 and §3.3, the oracle case); `app.platform_only_permissions()` keeps every key of `main`'s latest and adds yours. Do not grant `agent:concierge` anything yet (A3, wave 3).
3. **Contract:** `messaging.message.requested` as a catalogue event with its worker `/api/v1/workers/messaging/send`; DTOs for threads, messages and templates; `rate_limited` retryable.
4. **Commands** `messaging.message.send`, `messaging.thread.hand_off`, `messaging.thread.return_to_assistant`, `messaging.template.register`, and the platform's own record commands through definers checking `messaging.process`. Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.
5. **Inbound handler** `meta_whatsapp` on P5's registry: company by `phone_number_id`, customer by number among the company's customers (several holders: the thread opens unmatched and lists them for staff), open or reuse the thread, open the window, store once (`whatsapp_message_keys`), media through the file checks into a `whatsapp_media` file, the unknown-number lead through the port above, then `messaging.message.received` or `messaging.button.pressed` (ids only). Keywords from `WORKSHOP_DEFAULTS.whatsapp.keywords` (English and Roman Hindi): STOP withdraws the number's WhatsApp consent as the platform and sends one confirmation; HUMAN hands the thread to people. The first message on a thread sends the welcome (a template, not an agent).
6. **Messaging worker:** in order, opt-out, the 24-hour window, the template's approval, the portfolio budget (Redis, against the limit Meta reports, marketing held at `WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare` 0.8), the output filter (length, the companies' own link allowlist, no identity or bank number, no phone but the company's), 20 an hour per thread; then the built client (never retried after a timeout), recording the provider id. A held marketing message waits `queued`.

**Early check (Tier A):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: w1-whatsapp early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 9.

7. **Screens:** the thread component in `apps/web/src/screens/messaging` on Account 360 (tab WhatsApp) and beside the lead in `/converting` (one mount line in the page; T3 adds its call bar to the same page in its own component, so keep your change to your component and its mount); `/messages` (menu Messages): threads waiting for a reply in the person's scope, keyset by `last_inbound_at`, keys J, K and R. Integration health: each number's quality and limit, the budget used, refusals by reason. The notification `whatsapp_reply_waiting` (10 minutes in calling hours). Copy in `en.json`; journeys with axe and light, dark and 400 px snapshots; the JavaScript budget.
8. **Tests** of §14: out-of-order and repeated statuses; window, template, opt-out, budget, filter and rate limit in order; media through the checks; keywords; a file only on the sender's thread; a message to an opted-out customer refused by every path; `EXPLAIN (ANALYZE)` for every list.
9. **Documents:** DATABASE, SECURITY §3.2, §3.3 and §7, API §6, the design's "Built (W1)" under §6.1, `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: everything above, `apps/web/src/screens/messaging`, its places on Account 360 and the Converting workspace, `/messages`. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, the event catalogue and worker registry, the webhook handler registry, `turbo.json` and `.env.example`, `WORKSHOP_DEFAULTS`. I1, T3, K3 and B1 build beside you: never touch `crm.lead.create` or `crm.lead.ingest` (I1), the Dial key, call bar or `provider_calls` (T3), the knowledge index job (K3) or `packages/domain/src/ai/ask` (B1).

Review checklist (check before your report): customer text and media treated as untrusted and masked before storage or display; no message to an opted-out number by any path (person, worker, welcome, keyword confirmation excepted as the one confirmation); a repeated inbound message or status changes nothing; a status never moves back; a file attached only to its sender's thread; the platform's writes only through definers checking `messaging.process`; nothing sent after a client timeout.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §6.1 pass; `pnpm test:security` passes on your Postgres.

Not in W1: the Concierge's drafts (A3); quotes, milestones and STATUS (S3); the real numbers and approved templates (final phase).

## Report

### Early check, 14-11-2026, the lead's cloud VM (slot 2, Postgres 54332)
Steps 1 to 4 of the brief, committed and pushed on `feat/w1-whatsapp` (head after this report). Skills loaded: `add-table`, `add-command`.

**Built**
- Tables (`packages/db/src/schema/whatsapp.ts`; migrations `0168_whatsapp.sql`, generated with `PARTITION BY RANGE (created_at)` added by hand, and `0169_whatsapp_rls.sql`, custom):
  - `whatsapp_threads`: one per company number and customer number (`channel_id`, `wa_id` unique); `account_id`, `contact_phone_id`, `opportunity_id` (composite key to the lead's `(id, entity_id, account_id)`, `ON UPDATE CASCADE`, so a merge that moves the lead moves the thread), `assignee_id`, `window_open_until`, `opted_out_at`, `handled_by` with `handoff_reason` and `handed_off_at`, `last_inbound_at`, `needs_reply`. Read under the customer's read rule (`account_entities_read`); a thread no one customer holds only with `messaging.send:entity`. People change only `handled_by`, its reason and time and `needs_reply` (column grants, `app.whatsapp_send_scope_ok()` in the update policy).
  - `whatsapp_messages`: monthly partitions in `messaging_partitions` with a default partition, `app.ensure_whatsapp_message_partitions(3)` and the pg_cron job `whatsapp-messages-partitions` (25th, 03:15 UTC, 0140's limits, a `retention_runs` row per run). Read with its thread; a person inserts only a queued `text` or `template` of their own on a thread they may message. `app.whatsapp_messages_guard()` (definer trigger): append-only, a message keeps what it was written with, a status only moves forward (`app.whatsapp_status_moves()`), and any outbound row but the STOP confirmation to an opted-out number is refused, whoever writes it.
  - `whatsapp_message_keys`: Meta's ids once across the partitions; no policy, no request privilege (`PLATFORM_TABLES`).
  - `whatsapp_templates`: per company, read by every principal in the company; an Executive registers (`messaging.templates.write:all`); status only by the platform.
- Definers (all `search_path = ''`, `messaging.process:entity` checked in the body, DATABASE §4.1): `app.whatsapp_record_inbound`, `_match_thread`, `_record_status`, `_record_template_status`, `_record_opt_out`, `_hand_off`, `_queue_message`, `_send_facts`, `_claim_send`, `_record_send`; and `app.whatsapp_thread_opted_out` for people who read customers or send (as E1's `app.call_opt_out`).
- Permissions: `messaging.send` (Executive all, GM entity, Sales Lead team, CC, LC and Store own), `messaging.templates.write` (Executive all; also in `AGENT_FORBIDDEN_PERMISSIONS`), platform-only `messaging.process` (`SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS`, `app.platform_only_permissions()` with 0167's thirteen keys kept). Catalogue, scopes, seed, labels, SECURITY §3.1, §3.2 (rows and a WhatsApp paragraph) and §3.3; no grant to `agent:concierge`.
- Contracts: `packages/contracts/src/whatsapp.ts` (enums, `WhatsAppThreadDto`, `WhatsAppMessageDto`, `WhatsAppTemplateDto`), `commands/messaging/whatsapp.ts` (every input and answer), `api/messaging.ts` (`MessageRequested` is now the catalogue payload, `MESSAGING_RETRYABLE`), `api/worker-jobs.ts` (`MessagingSendJob` with `messageId`; `MessagingSendResult` adds `failed`, `held`, `skipped`); catalogue events `messaging.message.requested`, `messaging.message.received`, `messaging.button.pressed` (all `subscribed: false` until the worker and the handler).
- Commands (`packages/domain/src/commands/messaging/`): people's `messaging.message.send`, `messaging.thread.hand_off`, `messaging.thread.return_to_assistant` (people only), `messaging.template.register` (people only); the platform's `messaging.inbound.record`, `messaging.thread.match`, `messaging.status.record`, `messaging.template.record_status`, `messaging.opt_out.record`, `messaging.thread.record_hand_off`, `messaging.message.queue`, `messaging.message.claim`, `messaging.message.record_send`. Customer text masked by `maskIdentityNumbers()` before storage and kept off the audit row (`auditInput`).
- Web registrations only: Activity log actions, events, fields and code groups (`apps/web/src/screens/audit.ts`, `activity-details.tsx`, `contract-values.ts`), `en.json` (permissions, module, activity labels, eleven `errors.whatsapp_*`, the job's name). No screen yet.
- DATABASE §4.1, §6.2 and §7 lines; `pnpm db:docs` regenerated.

**Tests added**
- `packages/db/tests/security/whatsapp.test.ts`: 19 (keys table closed, partitions and job, inbound once and matched, late message, several holders unmatched and matched, unknown number and company, forward-only statuses, guard, person insert and thread update policies, opt-out with withdrawals, timeline row, confirmation once, worker definers, templates).
- `packages/domain/tests/commands/messaging.test.ts`: 29, a denied, a wrong-company and a happy case for each of the thirteen commands (masking, events with ids only, out-of-order statuses, window, template checks, opt-out refusal, purposes).
- Matrix fixture rows for the three entity tables (a matched and an unmatched thread, a message on each, a template per company) and their rules; `NARROWER`, `enum-sync` (15 pairs), the reader definer list, `PLATFORM_TABLES`, scheduled-jobs lists, the refusal sweep inputs (`messaging.template.register` restricted; hand-off and return people only), `unmasked-fields` examples (`phoneNumberId`, `waId`, `providerMessageId`), `worker-jobs.test.ts` (2 replaced).

**Checks**
- `pnpm test:security` (through the lock): db 49 files, 1356 passed; domain 84 files, 1148 passed; web 4 failed in `jobs-check.test.ts` (the job count rose by one), fixed, then `pnpm --filter web test:security` 28 files, 357 passed.
- Unit: `@shakti/domain` `src` 92 files, 2405 passed; `@shakti/contracts` 20 files, 185 passed; `@shakti/db` oracle, migration rules and journal 93 passed; web `audit`, `contract-values`, `errors-catalogue`, `roles` 37 passed.
- Typecheck `@shakti/contracts`, `@shakti/db`, `@shakti/domain`, `web`: clean. ESLint on every edited folder, one at a time: clean. `pnpm copy-lint`: clean.
- No `EXPLAIN (ANALYZE)` yet: no list or search exists until the screens (step 7).

**Decisions the brief left open**
1. The event payload is ids only, so `MessageRequested` became `{ messageId, threadId, kind }`; the masked body and template values live in the queued row, which the worker reads as the platform.
2. A thread no one customer holds is read only with `messaging.send:entity` (Executive, GM), who match it.
3. `messaging.send` is checked over the customer in the thread's company (relationship owner and team) or over the thread's lead (owner and team); hand-off and return take `messaging.send` and are people only. The platform's hand-off is its own command, `messaging.thread.record_hand_off`.
4. Opt-out is by number, as E1's decision 3: the thread's STOP, or any holder of the number withdrew WhatsApp consent with none given since. A STOP withdraws every WhatsApp consent of every holder of the number; a consent given later lifts it.
5. The welcome and the STOP confirmation are templates the Executive registers with a `purpose` (`welcome`, `opt_out_confirmation`; one each per company, no body values), so no customer text is invented; with none registered, nothing is sent. The confirmation is kind `system`, the one message an opted-out number gets, once after each STOP (definer and guard).
6. Template statuses `pending`, `approved`, `rejected`, `paused`, `disabled`; Meta's template events map onto them in step 5; a status is recorded for every company of the request that registered the name and language (one business portfolio).
7. Columns beyond §6.1: `template_params`, `button_payload`, `status_at`, `error_code`, `send_attempted_at` (a message is handed to Meta once: never again after a timeout), the thread's `handoff_reason` and `handed_off_at`, the template's `status_at` and `purpose`.
8. Delivery bookkeeping (inbound, status, queue, claim, record send) writes no audit row, as P5's; a STOP, the platform's hand-off, a match and a template's status are audited.
9. `needs_reply` is set by every inbound message (no assistant answers before A3) and cleared when a person queues a reply.
10. A person's message carries no file in W1 (S3 sends quotes); inbound media is step 5.
11. An inbound message's `created_at` is Meta's time, never later than now, so a thread reads in sending order.

**Open for the lead**
- A thread matched to a customer with no open lead does not follow a customer merge (only the lead's key cascades); I left `app.merge_customers()` alone. Say if W1 should move threads in the merge.
- P5's worker calls handlers with an empty company scope; the step 5 handler will run its commands as `system:workers` for every company (the inbound definer finds the company by the number).
- The `whatsapp_media` file purpose (step 5) changes `files_purpose_check` and `app.file_purpose_grant()`, both P2's; I will redefine the function from `main`'s latest.
- I1's contract (`096f1cff`) is read: the port will take its `IngestLeadInput` with channel `whatsapp` and `attribution.ctwaClid`.
- `fail-closed.test.ts` fails on `pin_codes` when run alone on this database (no rows yet); it passes in the whole suite.
