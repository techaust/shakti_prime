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

### Steps 5 to 9, 15-11-2026, the lead's cloud VM (slot 2, Postgres 54332)
Steps 5 to 9 of the brief on `feat/w1-whatsapp`, with the coordinator's four answers to the early check. Skills loaded: `add-table`, `add-command` (no others listed for the screens in this session).

**Built**
- Migrations (custom unless noted; the lead renumbers): `0170_whatsapp_media_notice.sql` (generated: `files_purpose_check` adds `whatsapp_media`, the notification type checks add `whatsapp_reply_waiting` and the subject type `whatsapp_thread`, each `NOT VALID`); `0171_whatsapp_handler.sql`: `app.merge_customers()` from 0154 and `app.unmerge_customers()` from 0117 with every line kept, each moving the merged-away customer's `whatsapp_threads` to the kept one and back; `app.whatsapp_channel_entity(provider_ref, number)` (the company of a `phone_number_id`, granted to `app_user` and `app_reader`, checks `messaging.process`); `app.whatsapp_template_entities(name, language)`; `app.whatsapp_attach_media(message, file)`; the policy `files_whatsapp_read` (a `whatsapp_media` file is read only by who reads its message's chat); `app.notice_whatsapp_waiting(entity, waited_before, limit)`; `0172_whatsapp_waiting_index.sql` (generated: the waiting index in time order, see the plans below).
- Inbound handler `meta_whatsapp` (`apps/web/src/workers/webhooks/whatsapp.ts`, `whatsapp-deps.ts`, registry line): for each change, the company from `phone_number_id` first (`whatsappChannelEntity`, as `system:workers` with no company), then every command under `systemWorkersPrincipal(thatCompany)` only; an unknown number marks the delivery processed with the code `whatsapp_number_unknown` and creates nothing. Statuses (out of order and repeated), template status events, text, buttons and media; keywords (STOP records the opt-out and queues the one confirmation; HUMAN hands off); the welcome template on a thread's first message; a customer's own text masked before storage. Media: downloaded with the access token, stored as a `whatsapp_media` file through the file checks (masking before `ready`), attached to its own message only. An unknown number's lead goes through the port `IngestLeadPort` in the shape of I1's `crm.lead.ingest` (channel `whatsapp`, `pipelineKey`, `externalId` = the message id, no consent, idempotency key `whatsapp:<externalId>`, the referral as attribution); the default `unwiredIngest` logs and creates nothing, so wiring is one line once I1 merges.
- Messaging worker (`apps/web/src/workers/messaging/{job,send,send-deps}.ts`, route `api/v1/workers/messaging/send`, `EVENT_JOB_ROUTES` and the in-process worker; `messaging.message.requested` now `subscribed`): claims the message once, then opt-out, the 24-hour window, the template's approval, the budget (`packages/domain/src/messaging/budget.ts`: Redis, hashed keys, Meta's tier limit, marketing held at 0.8 of it), the output filter (`output-filter.ts`: length, the companies' link hosts, identity and bank numbers, no phone but the company's), 20 an hour per thread; then the client, never again after a timeout; refusals recorded by reason, `rate_limited` retried.
- Screens: `apps/web/src/screens/messaging/` (`whatsapp-thread.tsx`, `whatsapp-chats.tsx`, `messages-screen.tsx`, `links.ts`); `/messages` (page, layout, loading; menu Messages, needs `messaging.send`; keys J, K and R; keyset by `last_inbound_at`); one mount line each on Account 360 and the Converting workspace (a dynamic import); Integration Health's WhatsApp section (`components/integrations/whatsapp-health.tsx`: each number's quality and limit, the budget used, refusals by reason, failures). The notice `whatsapp_reply_waiting` (10 minutes, calling hours only) in the notices scan. Copy in `en.json`; button keys added to the copy-lint list.
- Reads (`packages/domain/src/queries/messaging/whatsapp.ts`): `listWaitingThreads`, `listAccountThreads`, `readWhatsAppThread`, `readWhatsAppCounts`, `readSendFacts`, `whatsappChannelEntity`, `whatsappTemplateEntities`.
- Documents: SECURITY §3.1 to §3.3, the WhatsApp paragraph and §7; API §3.6 and §6; DATABASE §4.1, §4.4, §6 and §7; the design's "Built (W1)" under §6.1; the workshop pack (LAW-6, the lead pipeline default); `pnpm db:docs` and `machines:docs` regenerated.

**Tests added (all slices of the brief's §14)**
- `packages/db/tests/security/whatsapp.test.ts`: 23 cases in all (19 at the early check, plus the company of a number, a file only on its sender's thread and its read policy, the merge and unmerge of chats, the waiting notice).
- `packages/domain/tests/commands/messaging.test.ts`: 32 (29 plus `messaging.media.attach`).
- `apps/web/tests/whatsapp.test.ts`: 12 (a repeated message and status change nothing; company A's message never writes in company B; an unknown number creates nothing; STOP and HUMAN; media through the checks; the intake call's shape; the worker's checks in order, opt-out refused on every path, nothing sent after a timeout, the hour limit).
- Unit: `packages/domain/src/messaging/` keywords 3, output filter 5, send checks 7, budget 3.
- Changed: `reader-parity` (the five WhatsApp reads), `webhooks.test.ts`, `jobs-check`, catalogue, workshop defaults, `unmasked-fields`, grants, `enum-sync`, the matrix fixture, agent refusals, the route, namespace and layout plumbing tests.
- Journeys `apps/web/e2e/messages.spec.ts`: 4 (a tele-caller answers from Messages, presses R, takes over and gives back, with axe; the chat on the customer's page; Accounts has no Messages; the snapshot caller moves with J and K, snapshot `messages`), with the seed `apps/web/e2e/setup/whatsapp.ts`.

**Checks**
- `pnpm test:security` (through the lock, after the last code change): db 49 files, 1360 passed; domain 84 files, 1152 passed; web 29 files, 369 passed; 4 of 4 tasks successful. (The run before it failed one case, `reader-parity` "covers every query the domain exports": fixed by covering the reads and renaming the three key-value helpers `budgetFor`, `noteConversation`, `messagingHealth`.)
- `pnpm build` passed; `pnpm --filter web js-budget`: "Every page is within its budget (48 pages)" with the new `/messages` entry (197.3 kB measured, 208 budget). `js-budget.json` is a checks file, so the pull request needs the owner's `checks-ok`.
- Journeys (through the lock, after `e2e:seed`): `messages`, `customers`, `converting`, `integrations`, `access`, `notifications` specs: 96 passed, 2 skipped, 21 failed, every failure a screenshot that changed as intended: `customer-sizing` (the WhatsApp section), `converting-board` (the chats beside the lead), `integration-health` (the WhatsApp section), `notification-settings` (the new notice), and `not-found-tele-caller`, `customers-list`, `notification-centre` (the menu's new Messages item), each in the three projects. The new `messages` baselines were written locally and not committed: the lead makes all of them in the Linux image.
- `pnpm lint` (whole repository, once, through the lock): clean. Typecheck of `@shakti/contracts`, `@shakti/db`, `@shakti/domain`, `web`: clean. `pnpm copy-lint`: clean. `@shakti/db` `src/docs`: 23 passed.

**`EXPLAIN (ANALYZE, BUFFERS)`** (`packages/domain/tests/spike/whatsapp-explain.ts`, local only: 20,000 customers in one company with a lead and a chat each, a third waiting, 50 callers, about 200,000 messages and one chat of 2,010):
- `/messages`, first page, General Manager: 8.2 ms; caller (own scope): 11.2 ms; second page, General Manager: 6.0 ms. With the first index `(entity_id, last_inbound_at desc, id desc) where needs_reply` the same pages took 428 to 497 ms: the policies' `entity_id = any(...)` condition turned the scan into a sort of all 6,670 waiting chats. The index is now `(last_inbound_at desc, id desc) where needs_reply` (0172), read per company in time order.
- One chat, newest page (2,010 messages): 0.33 ms; the page before: 0.34 ms (`whatsapp_messages_thread_idx`, one partition per month pruned by the keyset).
- A customer's chats (Account 360, Converting): 0.11 ms (`whatsapp_threads_account_idx`).

**Review checklist:** customer text masked before storage and output, media through the file checks before `ready`; no message to an opted-out number on any path (person, worker, welcome; the STOP confirmation once, by definer and guard); a repeated message or status changes nothing (`whatsapp_message_keys`, forward-only statuses); a file attached only to its own message's chat; the platform writes only through definers checking `messaging.process`; a timed-out send is never sent again (`send_attempted_at`). All hold, each with a test above.

**Decisions the brief did not settle (beyond the early check's eleven)**
12. The lead pipeline for an unknown number is the named default `WORKSHOP_DEFAULTS.whatsapp.leadPipelineKey` = `farmer_pumps`, to be confirmed at the workshop; the lead's name is the customer's WhatsApp profile name, or the number when it has none.
13. A held marketing message stays `queued`; nothing sends it again yet (no sweep). Say if W1 should add one.
14. Voice notes, video and stickers are recorded as a media message with no file; images and documents go through the checks.
15. The WhatsApp media retention job (§11's three years, `retention.whatsappMediaYears`) is not built: the default is in place for it.
16. Templates are registered by command only; no screen in W1.
17. `app.file_purpose_grant()` is not redefined: `whatsapp_media` is in the grant map with no write permission (only the platform writes it), and reading uses the new policy `files_whatsapp_read`, so P2's function stays as `main` has it.
18. The waiting notice goes only within calling hours, once a chat has waited 10 minutes (`replyWaitMinutes`).
19. `/messages` lists chats in the person's scope across the request's companies, newest customer message first, read per company.

**Open for the lead**
- Wire `IngestLeadPort` to `crm.lead.ingest` after I1 merges (one line in `whatsapp-deps.ts`).
- Remake the screenshot baselines listed above and add `messages` in the Linux image.
- `js-budget.json` changed: the owner's `checks-ok`.
- Migrations 0170 to 0172 redefine `app.merge_customers()` (from 0154) and `app.unmerge_customers()` (from 0117) and widen the files and notifications checks: check them against `main`'s latest at the merge (T3 and K3 also touch files).
