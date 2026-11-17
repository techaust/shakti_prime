# S3 WhatsApp quotes, milestones and STATUS (wave 3)

| | |
|---|---|
| Branch | `feat/s3-whatsapp-quotes` on GitHub, from `main` at 9b6ea163 |
| Worktree | `s3-whatsapp-quotes`, slot 1 (Postgres 54331, app 3031), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money (a quote accepted into an order) and a platform-only grant |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §7.1](../../03-roadmap-appendix/phase2.md#71-s3-whatsapp-quotes-milestones-and-status), §2 (question 5: an Accept button, a one-time code from a grand total of ₹2,00,000), §3 (wave 3 file ownership), §4 (platform-only `sales.quote.accept_remote`), §11, §14 and §15 (STATUS covers projects only from Phase 4).
- Built (W1) under §6.1 and its run file [w1-whatsapp.md](w1-whatsapp.md) (Report and Integration notes): `whatsapp_threads`, `whatsapp_messages`, `whatsapp_templates` with `purpose`, the messaging worker `apps/web/src/workers/messaging/` (opt-out, window, template approval, budget, filter, rate limit, in that order), the inbound handler `apps/web/src/workers/webhooks/whatsapp.ts` (keywords from `WORKSHOP_DEFAULTS.whatsapp.keywords`, `messaging.button.pressed` emitted with ids only), the platform's definers checking `messaging.process`.
- What exists for quotes: `packages/domain/src/commands/sales/send-quote.ts`, `accept-quote.ts`, `quote-shared.ts`, `expire-quotes.ts`, `confirm-order.ts`; the quote state machine in `packages/domain/src/state-machines`; `quotes.accepted_via` already allows `whatsapp_reply` and `whatsapp_otp` (`packages/db/src/schema/quotes.ts`); the catalogue's `sales.quote.accepted` (`acceptedVia` enum) and `sales.order.confirmed`; the quote PDF (`attach-quote-pdf.ts`, `apps/web/src/workers/pdf`); notifications (`quote_accepted` is new); the Redis client.
- PRD SAL-05, WA-01, WA-03; SECURITY §3.3 (platform-only grants, ADR 0020) and §7 (customer WhatsApp content is untrusted); BLUEPRINT §7.9.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **Table** `whatsapp_milestones` as §7.1 says (company, `milestone` of the eight names, `template_id`, `is_active`; one row per company and milestone) and `whatsapp_milestone_sends` (or an equivalent unique key) so each milestone sends once per subject (milestone, subject kind, subject id). RLS by company (read by the company's people, written with `messaging.templates.write:all`; sends by the platform only), the testing lists, fixture rows, the role × company matrix (AGENTS §6).
2. **Permission** platform-only `sales.quote.accept_remote` of `system:workers` (catalogue, `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS`, seed, SECURITY §3.2 and §3.3, the oracle case). `app.platform_only_permissions()` keeps every key of `main`'s latest definition (read the newest migration that redefines it) and adds yours.
3. **Definer** `app.accept_quote_remote(...)` (`search_path = ''`, checks `sales.quote.accept_remote` in its body): the quote is `sent` and not expired, the thread's customer is the quote's customer, then the quote machine's `accept` and the order draft exactly as `sales.quote.accept` makes it, `accepted_via` `whatsapp_reply` or `whatsapp_otp`; one acceptance makes one order (lock the quote row; a second press answers the existing order). Reuse `accept-quote.ts`'s order building: factor the shared part, never copy it. `app.status_summary(thread_id)` (definer, the same grant or `messaging.process`): the thread's customer's own quotes and orders in the thread's company, nothing else.
4. **Contract and commands:** `sales.quote.send` takes `channel` (`whatsapp` or `recorded`; `recorded` is today's behaviour, the default, so every existing caller is unchanged); WhatsApp queues the company's `quote_sent` template through W1's `messaging.message.queue` with the PDF as its document, the quote number, grand total and valid-until date, and two buttons whose payloads are HMAC tokens (`WHATSAPP_BUTTON_SECRET`, new in `.env.example` with a low-entropy local value and in `turbo.json`) bound to the quote, the thread and the customer's number; refused when the customer has no WhatsApp thread, holds no WhatsApp consent or is opted out (an `errors.*` reason each). Platform commands `sales.quote.accept_remote` and `messaging.milestone.send`; Settings command `messaging.milestone.set` (`messaging.templates.write`). Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep (no agent may run any of them).

**Early check (Tier A):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: s3-whatsapp-quotes early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 9.

5. **Handlers:** the `messaging.button.pressed` subscriber (worker route on the event registry) as the platform: token checks (constant-time HMAC compare, the token's thread and number equal the sender's thread and number), the quote `sent` and not expired, then accept below ₹2,00,000 grand total (a named value in `WORKSHOP_DEFAULTS`, not a literal); at or above it, send the company's authentication template with a six-digit code (5 minutes, 3 tries, only its hash held in Redis, keyed by thread and quote) and accept with `whatsapp_otp` when the same thread sends it back. In `apps/web/src/workers/webhooks/whatsapp.ts`, a six-digit text while a code is pending on that thread, and the keyword STATUS (add it to `WORKSHOP_DEFAULTS.whatsapp.keywords`, English and Roman Hindi), are answered by your code, deterministically, before `messaging.message.received` is emitted; mark such a message so the Concierge (A3, built beside you) does not draft a reply to it — expose one exported predicate `isHandledByPlatform(message)` from a file of your own in `apps/web/src/workers/messaging/` and say in your report where A3 should call it. An expired quote answers with the `quote_expired` template and tells the lead's owner. Each answer is a thread message the owner sees.
6. **Milestones:** `sales.quote.accepted` notifies the lead's owner (`quote_accepted`); `sales.order.confirmed` sends the `order_confirmed` milestone; a milestone with no approved template is held, not sent (WA-01); once per subject. Later phases add only their event's handler.
7. **Screens:** the quote page's send dialog chooses WhatsApp or recorded (WhatsApp disabled with a plain reason when it cannot be used); the quote shows how it was accepted; Settings › WhatsApp templates maps milestones to templates. Copy in `en.json` (and new button keys in `tools/copy-lint/copy-lint.config.json`); journeys with axe and light, dark and 400 px snapshots; the JavaScript budget.
8. **Tests** of §14: token, sender, state, expiry and code cases (a press from another number, a forged token, a replayed token after acceptance, a wrong code three times, a code after 5 minutes) accept nothing; one order per acceptance under two concurrent presses; milestones once per subject; STATUS reads only the sender's records (security suite: a thread bound to customer A never lists B's quotes); `EXPLAIN (ANALYZE)` for every new list.
9. **Documents:** DATABASE, SECURITY §3.2 and §3.3, API, the design's "Built (S3)" under §7.1, `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: the above, `sales.quote.send`'s dispatch, the quote page's send dialog, the inbound button and code handling, Settings › WhatsApp templates' milestone map. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, the testing lists, the event catalogue and worker registry, `turbo.json` and `.env.example`, `WORKSHOP_DEFAULTS`, `app.platform_only_permissions()`.

Built beside you, do not touch: A3 owns the Concierge, the draft line in W1's thread component (`apps/web/src/screens/messaging`) and `AGENT_DEFAULTS.concierge`; A2 owns `copilot_notes`, the Co-pilot panel and `messaging.template.request`; T4 owns `exotel_incoming`, the screen-pop and the app shell; V2 owns `apps/voice-agent` and `/voice`. Your migrations are numbered after `main`'s last (0188) and renumbered by the lead at merge.

Review checklist (check before your report): no order without a verified token from the thread's own number on a `sent`, unexpired quote; one acceptance, one order, under concurrency; the code never stored or logged in clear; nothing sent to an opted-out number or without consent; the platform's writes only through definers checking the platform-only grant; customer text untrusted and masked; no amount formatted or computed in UI code.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §7.1 pass; `pnpm test:security` passes on your Postgres.

Not in S3: the Concierge (A3); Phase 3 to 5 milestone events; real approved templates and numbers (final phase).

## Report

## Review

## Integration
