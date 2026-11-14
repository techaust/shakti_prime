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
