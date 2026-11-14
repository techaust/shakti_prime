# Backend and product design: Phase 2 (Communications and live voice)

Date: 13-11-2026. Status: approved by the owner on 13-11-2026, with every question of §2 decided. Built slice by slice in the order of §3, each slice recording what it built here in the same pull request, as the Phase 1 design does; progress is in [STATUS](../10-status.md). Governing documents: BLUEPRINT §7.5 to §7.8, §8.1, §8.2, §8.6, §8.11, §9, §10, §12, §13, §16 and §18; ROADMAP §4; PRD CRM-01, CRM-10, TEL-01, TEL-03 to TEL-05, SAL-05, WA-01, WA-03, WA-04, AI-01 to AI-06, NFR-06; ARCHITECTURE; DATABASE; API §2, §3.4, §3.6 and §6; SECURITY §3.3, §3.4, §6 and §7; the spikes in `docs/04-architecture-appendix/` (`whatsapp.md`, `exotel.md`, `voice.md`, `realtime.md`, `knowledge.md`, `calling.md`); [the Phase 1 design](phase1.md). Where this design settles something the documents left open, the section says so; `docs/01-blueprint.md` governs on any conflict.

**Contents:** [1. Scope](#1-scope) · [2. Decisions for the owner](#2-decisions-for-the-owner) · [3. Slices](#3-slices) · [4. New permissions](#4-new-permissions) · [5. Wave 1](#5-wave-1) · [6. Wave 2](#6-wave-2) · [7. Wave 3](#7-wave-3) · [8. Wave 4](#8-wave-4) · [9. Models, speech and latency](#9-models-speech-and-latency) · [10. Costs per month](#10-costs-per-month) · [11. Workshop defaults](#11-workshop-defaults) · [12. Final-phase verification](#12-final-phase-verification) · [13. Questions for the client](#13-questions-for-the-client-final-phase) · [14. Tests per slice](#14-tests-per-slice) · [15. Gaps and conflicts in the governing documents](#15-gaps-and-conflicts-in-the-governing-documents)

## 1. Scope
**In Phase 2:**
- the webhook backbone: signature check, `webhook_inbox`, an answer within 2 seconds, idempotent processing in a QStash worker, replay and health on Integration health; every inbound integration builds on it;
- channels and telecom rules in code: each company's WhatsApp number and its 140-series, 160-series, IVR and missed-call numbers; the calling series chosen by the call's purpose and the lead's consent; TRAI hours; DND scrubbing before a promotional dial;
- WhatsApp Cloud API: threads per company number, inbound messages and media, the 24-hour window, approved templates, opt-out, the portfolio messaging limit with service messages first, quality rating; the thread on Account 360 and in the Lead Converter workspace;
- ingestion from Meta Lead Ads, Google lead forms and the companies' website forms, with attribution and consent, and the qualification facts a lead carries;
- Exotel click-to-dial on DLT-registered numbers, call status, recordings copied to S3, the recording notice; inbound IVR, missed calls and screen-pop;
- the Caller Co-pilot and the WhatsApp Concierge, each from Shadow to Needs approval, with their eval and prompt-injection sets;
- WhatsApp quote dispatch and acceptance (reply, and a one-time code above a value), the order-confirmed milestone, STATUS replies, and the milestone registry later phases add to;
- the speech-vendor adapter, benchmark and selection; audio in the Knowledge Vault;
- Playbook directives with Executive approval and conflict flags; Ask the Business; live voice Teach and Ask with a p50 latency under 1.5 seconds.

**In later phases (BLUEPRINT §14):** filing WhatsApp documents against a project's requirements and their classification (Phase 4, with the document vault); site-visit booking by the Concierge (Phase 4, with the scheduling board); the dispatched, visit-booked, installed, handover-kit (Phases 3 and 4) and payment-due (Phase 5) milestones, each one line of the registry S3 builds; voice Command mode, the Sizing and Quote, Project Orchestrator and Chief of Staff agents, and any Automatic autonomy (Phase 6).

**In the final phase (the owner's decision of 13-11-2026):** every step that needs the client's people or live accounts: DLT registration and the numbers, Meta business verification and one WhatsApp number per company, template approval of the final wording, Meta App Review for Lead Ads, the voice samples and listeners, the consent and notice texts. Each slice is built and tested now on sandboxes, test numbers, recorded fixtures and contract tests; its live check is a row of §12, never a blocker.

## 2. Decisions for the owner
The owner decided all fourteen on 13-11-2026, each the recommended option (a), as marked below and recorded in [DECISIONS](../11-decisions.md).

1. **Which models the runtime names** (all slices with a model; BLUEPRINT §1 and §9.3 name Sonnet 5 and Haiku 4.5, which Sonnet 5.5 and Haiku 5.5 now succeed): **Decided: (a).**
   - (a) *Recommended:* Sonnet 5.5 (`claude-sonnet-5-5`) wherever the blueprint says Sonnet 5 (the Concierge, the Co-pilot's briefs, Ask the Business, voice, Playbook drafting), and Haiku 5.5 (`claude-haiku-5-5`) wherever it says Haiku 4.5 (the Co-pilot's summaries, the conflict labels); the Triage agent moves to Haiku 5.5 only once its recorded eval and injection sets pass on it; Opus 5.5 is named nowhere in the runtime. BLUEPRINT §1, §5 and §9 get a one-line amendment.
   - (b) Sonnet 5.5 for the Sonnet roles; Haiku 4.5 stays for the rest.
   - (c) Keep the blueprint's Sonnet 5 and Haiku 4.5.
2. **The Concierge's first touch while Automatic is unavailable** (A3; BLUEPRINT §9.3 asks for a first touch under 60 seconds, the owner's rule of 05-10-2026 keeps Automatic for Phase 6): **Decided: (a).**
   - (a) *Recommended:* a deterministic welcome on a customer's first message (an approved template sent by the messaging worker, not by the agent): it says the assistant is an AI, offers "reply HUMAN", and asks for consent with two buttons; the Concierge's own replies go Shadow, then Needs approval, sent by a person with one key.
   - (b) Allow Automatic for the Concierge's reply action alone, once its shadow report is reviewed.
   - (c) No automatic message: people make the first reply.
3. **Who owns a lead that arrives from an integration** (I1, W1, T4): **Decided: (a).**
   - (a) *Recommended:* weighted round-robin among the company's present Cold Calling Tele-Callers, by T2's picker (language, segment, open leads), else routed work for the Sales Team Lead; the Triage agent's proposal stays in Shadow beside it.
   - (b) Every such lead goes to the Sales Team Lead as routed work, who assigns it.
   - (c) An unassigned pool that callers take from.
4. **Screen-pop transport** (T4; the Realtime spike was deferred to the production site, which is live since 12-11-2026): **Decided: (a).**
   - (a) *Recommended:* run the Realtime spike on `shaktiprime.com` at T4's start; screen-pop on Realtime's `user:{id}` channel, with a 3-second poll of a Redis-only route while the spike is not passed.
   - (b) Polling only in Phase 2.
5. **WhatsApp quote acceptance** (S3): **Decided: (a).**
   - (a) *Recommended:* an Accept button bound to the quote and the customer's number accepts it; a one-time code is asked as well when the quote's grand total is ₹2,00,000 or more (a named default, `WORKSHOP_DEFAULTS.whatsapp.otpFromRupees`, for the client in the final phase).
   - (b) A one-time code for every acceptance.
   - (c) The button only.
6. **The speech-to-text accuracy target** (V1; ROADMAP §4 sets it from the voice spike before Phase 2 starts, but the spike waits for the client's samples, which moved to the final phase): **Decided: (a).**
   - (a) *Recommended:* the target of §9.2, measured now on a stand-in set the development team records, and confirmed on the client's samples in the final phase: character error rate at most 12% on normalised Roman-script transcripts, key terms at least 95% right, at least 90% of turns answered on topic.
   - (b) No target until the client's samples arrive; the exit gate's accuracy item stays open until then.
   - (c) Other figures the owner names.
7. **Speech vendors in the benchmark** (V1): **Decided: (a).**
   - (a) *Recommended:* Sarvam AI (the lead candidate, adapter built) and one more vendor that offers streaming Hindi speech-to-text and Hindi text-to-speech from an Indian region with acceptable data terms, chosen by the developer at V1's start after reading the vendors' current pages, with the owner's yes on its data terms.
   - (b) Sarvam AI alone.
   - (c) Two more vendors.
8. **Call transcription coverage** (A2; BLUEPRINT §13): **Decided: (a).**
   - (a) *Recommended:* Lead Converter calls only, a setting per company (`AGENT_DEFAULTS.copilot.transcribe`).
   - (b) Every connected call.
   - (c) None in Phase 2: the Co-pilot works from the call log and the thread only.
9. **Who may use Ask the Business** (B1; no permission names it yet): **Decided: (a).**
   - (a) *Recommended:* `knowledge.ask` for the Executive, General Manager, Sales Team Lead, Accounts, Inventory Manager and Project Manager; tele-callers keep the staff knowledge search.
   - (b) The Executive and General Manager only, as voice.
   - (c) Every staff role.
10. **Raw webhook payloads** (P5; they hold phone numbers and message text): **Decided: (a).**
    - (a) *Recommended:* the payload is removed 30 days after it was processed and the row 90 days after it arrived; the messages themselves follow BLUEPRINT §7.9 in their own tables.
    - (b) Payload removed after 7 days.
    - (c) Kept as long as the WhatsApp messages (3 years).
11. **Teach and drafting directives** (K2, V2; a General Manager holds `voice.use` but not `knowledge.playbook.approve`): **Decided: (a).**
    - (a) *Recommended:* a new `knowledge.playbook.draft` for the Executive and the General Manager; approving stays the Executive's alone.
    - (b) Teach and drafting for Executives only.
12. **Voice limits per person** (V2): **Decided: (a).**
    - (a) *Recommended:* 30 minutes and ₹200 a day, sessions of at most 15 minutes (named defaults).
    - (b) 60 minutes and ₹400 a day.
13. **Phase 2 on production until the final phase:** **Decided: (a).**
    - (a) *Recommended:* every Phase 2 integration ships with production's vendor variables unset, so its routes answer `integration_unavailable` and its screens say the channel is not set up; dev and staging run the sandboxes.
    - (b) Switched on in production with sandbox accounts.
14. **Sandbox accounts for the build** (every vendor slice): **Decided: (a).**
    - (a) *Recommended:* the owner opens them in the group's name now (decision of 15-10-2026): a Meta developer app with the WhatsApp test number and a test Page for Lead Ads, an Exotel trial account, a LiveKit Cloud project in India, a Sarvam AI key and the second vendor's key; the keys go to dev and staging only.
    - (b) The developer's own sandbox accounts, moved to the group's in the final phase.

## 3. Slices
Each slice is vertical, as in Phase 1: contract → schema, RLS and grants → command → worker, route or server action → screen → end-to-end test, with its documents. A wave is a dependency tier; at most five builders run at once, and no two slices of a wave own the same file except the shared registration points below. Tiers follow [models-and-usage §2](../runbooks/models-and-usage.md#2-slice-tiers). The Requirements column names the PRD requirements each slice delivers in the part PRD §6 places in Phase 2.

| Wave | Slice | Needs | Tier | Requirements |
|---|---|---|---|---|
| 1 | P5 Webhook backbone | — | A | CRM-01 (a repeated provider event creates nothing), NFR-12 (webhook health) |
| 1 | E1 Channels and dial rules | — | A | TEL-04, CRM-10 (dialling refuses opt-outs), NFR-06 |
| 1 | V1 Speech adapter and benchmark | — | B | AI-03 (vendor, accuracy and latency measure) |
| 1 | K2 Playbook directives | — | B | AI-01 (directive review) |
| 2 | W1 WhatsApp threads and messaging | P5, E1 | A | WA-04, CRM-01 (WhatsApp inbound), CRM-10 (messaging refuses opt-outs), TEL-03 (the thread) |
| 2 | I1 Lead Ads, lead forms and website ingest | P5 | B | CRM-01 (Lead Ads, Google, website), CRM-02 |
| 2 | T3 Click-to-dial and recordings | P5, E1 | A | TEL-01 (click-to-dial), TEL-04 |
| 2 | K3 Vault audio | V1 | B | AI-01 (audio) |
| 2 | B1 Ask the Business | K2 | A | AI-02 |
| 3 | S3 WhatsApp quotes, milestones and STATUS | W1 | A | SAL-05 (WhatsApp dispatch and acceptance), WA-01, WA-03 |
| 3 | A3 WhatsApp Concierge | W1, I1, K2 | A | AI-04 (Concierge), AI-05, AI-06 |
| 3 | A2 Caller Co-pilot | T3, V1, I1, W1 | A | AI-04 (Co-pilot), TEL-03 (the Co-pilot) |
| 3 | T4 Inbound calls and screen-pop | T3, I1 | B | TEL-05, CRM-01 (IVR and missed calls) |
| 3 | V2 Live voice Teach and Ask | V1, B1, K2, P5 | A | AI-03 |
| 4 | G2 Phase 2 exit pack | all | A | the exit gate's engineering items; NFR-12 |

**Shared registration points** are edited by several slices of a wave, one line each, and merge as in Phase 1: the event catalogue and its worker registry, the permission catalogue and its seed, `apps/web/messages/en.json`, `apps/web/src/nav.ts`, `turbo.json` and `.env.example` (new variables), the testing lists, `AGENT_DEFAULTS` and `WORKSHOP_DEFAULTS`. Migrations are numbered at merge in merge order.

**Files each slice of a wave owns, where two could meet:**
- Wave 2: W1 owns the WhatsApp thread component (`apps/web/src/screens/messaging`) and its place on Account 360 and the Converting workspace; I1 owns `crm.lead.ingest`, `crm.lead.qualification.set` and the qualification card on the lead; T3 owns the Dial key and call bar in the Cold Caller and Converting workspaces.
- Wave 3: A2 owns the Co-pilot panel in `/calling` and `/converting`; A3 owns the draft line in W1's thread component; S3 owns `sales.quote.send`'s dispatch, the quote page's send dialog and the inbound button handler; T4 owns the screen-pop in the app shell, not the workspaces; V2 owns `apps/voice-agent` and `/voice`.

## 4. New permissions
Each gets a row in SECURITY §3.2, its seed in `packages/db/seeds/role-permissions.ts` and its oracle case, in the slice that first uses it. `calls.dial`, `calls.recording.listen`, `knowledge.playbook.approve` and `voice.use` are already in the catalogue and the seed; T3, K2 and V2 are their first users. A dash is no grant.

| Permission | Executive | GM | Sales Lead | CC | LC | Store | Inventory | Project Mgr | Field | Accounts | HR | Agents | Slice |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `messaging.send` (session messages and templates on a thread the person may read) | all | entity | team | own | own | own | – | – | – | – | – | Concierge own | W1 |
| `messaging.templates.write` (the template registry and the milestone map) | all | – | – | – | – | – | – | – | – | – | – | – | W1 |
| `crm.sources.write` (lead sources, form field maps, ingest keys) | all | – | – | – | – | – | – | – | – | – | – | – | I1 |
| `knowledge.playbook.draft` | all | all | – | – | – | – | – | – | – | – | – | – | K2 |
| `knowledge.ask` (Ask the Business) | all | all | team | – | – | – | entity | entity | – | entity | – | – | B1 |
| `agents.note.write` (the Co-pilot's briefs and call summaries) | – | – | – | – | – | – | – | – | – | – | – | Co-pilot entity | A2 |

The scope of `knowledge.ask` only opens the screen; what an answer reads comes from the person's own grants and RLS. WhatsApp threads are read under the customer's read rule (`crm.account.read` over the thread's customer, as Account 360), so no read permission is added. Channels are set with `admin.entities.write` and replay with `integrations.dlq.replay`.

**Platform-only grants** (`PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, SECURITY §3.3), each used only through definers that check it, never a person's `crm.*` or `sales.*` grant (ADR 0020):

| Grant | What it is for | Slice |
|---|---|---|
| `webhooks.process` | Claim, mark processed or failed, and purge `webhook_inbox` rows | P5 |
| `crm.dnd.record` | Record the DND register's answer for a customer's phone (`crm.phone.dnd_record`) | E1 |
| `messaging.process` | Record inbound messages and statuses, open threads, send checked messages, record an opt-out or a handoff, send the welcome | W1 |
| `crm.ingest.run` | Create or attach a lead from an integration (`crm.lead.ingest`) with its attribution, consent and owner | I1 |
| `calls.process` | Record a provider call's status, copy and delete recordings, record an inbound or missed call | T3 |
| `sales.quote.accept_remote` | Accept a quote from a verified WhatsApp reply or code, through `app.accept_quote_remote()` | S3 |
| `voice.session.record` | Record a voice session's end, minutes and spend from LiveKit's events | V2 |

**Agents:** `agent:concierge` gains `messaging.send:own`; `agent:copilot` gains `agents.note.write:entity` and keeps `crm.lead.read:entity`, `crm.lead.write:entity` and `knowledge.vault.read.staff:all`. For an agent principal, `own` means the one thread a run is bound to (§7.2). No agent holds `procurement.rate.read`, `finance.cost.read`, `knowledge.ask`, any `sales.*` grant, `calls.dial`, `calls.recording.listen`, the playbook grants or a platform-only grant; the agent refusal sweep covers every Phase 2 command.

## 5. Wave 1

### 5.1 P5 Webhook backbone
- **Contract:** `packages/contracts/src/api/webhooks-*.ts` stay the parsing contracts. New: `WEBHOOK_PROVIDERS` (`meta_whatsapp`, `meta_leadgen`, `google_leadform`, `exotel_status`, `exotel_incoming`, `livekit`), `WebhookProcessJob` (`inboxId`), `WebhookProcessResult` (`processed`, `duplicate`, `failed` with an error code) and `WebhookHealth` in `admin-integrations.ts`.
- **Table `webhook_inbox`** (platform data, no `entity_id` at receipt): `id`, `provider`, `provider_event_id`, `received_at`, `signature_ok` (always true: a delivery that fails its check is refused and counted, never stored), `payload_json`, `payload_sha256`, `entity_id` (set by the worker once the provider's handler names the company), `claimed_until`, `attempts`, `processed_at`, `failed_at`, `error_code`, `payload_purged_at`; unique `(provider, provider_event_id)`; append-only apart from the delivery and purge columns. `provider_event_id` is the provider's own id where one delivery carries one event (Meta `leadgen_id`, Google `lead_id`, LiveKit `id`, Exotel `CallSid` with the status), and the SHA-256 of the raw body for WhatsApp, whose deliveries batch messages and statuses; each item is made idempotent again by its own id in its domain table.
- **Roles:** the routes insert through a new login role `webhook_receiver` (its own small pool, `DATABASE_URL_WEBHOOKS` and `WEBHOOK_RECEIVER_PASSWORD`), which may only call `app.webhook_receive(provider, event_id, payload, sha256)` (insert, `on conflict do nothing`, answering the row's id and whether it was a repeat) and reads nothing. This keeps the route away from `app_user` and from a request context with no company. The worker reads and marks rows as `system:workers` with `webhooks.process` through `app.webhook_claim()`, `app.webhook_mark()` and `app.webhook_purge()`. No request role selects the table; Integration health reads counts through `app.webhook_health()` (`admin.integrations.write:all`). The role follows AGENTS §6's new login role steps (`ensureRoles()`, `requireEnv()`, `turbo.json`, `ci.yml`, `migrate.yml`, `.env.example`, DEPLOY).
- **Routes** `apps/web/src/app/api/v1/webhooks/*`, one per row of API §3.4, through one helper `receiveWebhook(provider, verify)`: the body cap first (256 KiB for Meta, 64 KiB for the rest), the raw bytes read once, the provider's check (Meta `X-Hub-Signature-256` with the app secret; Google's `google_key` compared in constant time with `GOOGLE_LEADFORM_KEY`; Exotel status by the signed per-call address of `status-callback.ts`; Exotel incoming by a secret path segment `EXOTEL_INCOMING_SECRET` compared in constant time, since Passthru signs nothing; LiveKit's `Authorization` JWT with the body's SHA-256), then `app.webhook_receive()`, then the job published to QStash (`/api/v1/workers/webhooks/process`, deduplication id = the row's id) and `200` within 2 seconds. A failed check answers `401` and counts in Redis per provider; a publish that fails still answers `200`, since the sweep picks the row up. The Meta handshake (`GET`) answers the challenge as text. Without QStash, the job runs in process after the answer (local and CI).
- **Worker** `POST /api/v1/workers/webhooks/process` (QStash signature, body cap): claims the row with a 60-second lease, parses the payload with its contract (a parse failure fails the row with `payload_unreadable` and is not retried), calls the provider handler registered in `apps/web/src/workers/webhooks/registry.ts`, marks it processed; a handler error is retried by QStash, and the last retry's failure callback marks it failed and reports to Sentry with ids and codes only. A handler registered by a later slice is the only thing that slice adds; until then a provider's rows are stored and marked `no_handler`.
- **Sweep** `webhook-sweep-<environment>` (every minute): rows no delivery is on its way to for 60 seconds are published again; payloads 30 days after processing are removed, and processed or failed rows 90 days after receipt (`WORKSHOP_DEFAULTS.retention.webhookPayloadDays`, `.webhookRowDays`; question 10); each run that removed something is a `retention_runs` row.
- **Screens:** Integration health gains Webhooks: per provider received, processed, failed and refused in the last 24 hours, the oldest waiting, failed rows newest first with their error code, and Process again (`webhooks.event.replay`, `integrations.dlq.replay`), which clears the failure and publishes the row once more.
- **Acceptance:** the same delivery stored twice is one row and is processed once; a changed byte fails the check and stores nothing; a parse failure is visible with its code and never retried; replay processes a failed row once; 50 deliveries a second for a minute are all answered within 2 seconds on the dev deployment (recorded in G2).
- **Sandbox now:** recorded and generated fixtures for all six providers, signed with test secrets; Meta's test number and LiveKit's dev project deliver to dev through the real route.

**Built (P5):**
- Contracts: `WEBHOOK_PROVIDERS`, `WebhookErrorCodeSchema`, `WebhookProviderHealth`, `FailedWebhook` and `WebhookHealth` in `admin-integrations.ts` (`IntegrationHealthResponse.webhooks`); `WebhookProcessJob`, `WebhookProcessResult`, `WebhookFailureResult`, `WebhookSweepWorkerBody` and `WebhookSweepWorkerResponse` in `worker-jobs.ts`; `ExotelIncomingParams`; the commands' inputs and DTOs in `commands/webhooks/inbox.ts`.
- `webhook_inbox` (DATABASE §6.10) with RLS forced, no policy and no request role's privilege; the guard trigger `app.webhook_inbox_guard()`; the definers `app.webhook_receive()`, `_claim()`, `_mark()`, `_waiting()`, `_purge()`, `_health()` and `_replay()` (DATABASE §4.1); `app.platform_only_permissions()` with `webhooks.process`; per-provider indexes for the day's counts and partial ones for the sweep, the failed list and the payload purge (`app.webhook_health(50)` 23 ms on 300,000 rows).
- The login role `webhook_receiver` (execute on `app.webhook_receive()` alone, a 2-second statement limit), `@shakti/db/webhooks` fenced to `apps/web/src/webhooks`, and its variables in `.env.example`, `turbo.json`, `ci.yml`, the migrate action, `migrate.yml`, `release.yml` and DEPLOY.
- The routes of API §3.4 through `receiveWebhook()` and `metaHandshake()` (`apps/web/src/webhooks`), the worker `/workers/webhooks/process`, its failure callback `/workers/webhooks/failed` and the minute sweep `/workers/webhooks/sweep` (`webhook-sweep-<environment>`); the empty handler registry `apps/web/src/workers/webhooks/registry.ts`; `WORKSHOP_DEFAULTS.retention.webhookPayloadDays` (30) and `.webhookRowDays` (90).
- The commands `webhooks.event.claim`, `webhooks.event.mark`, `webhooks.inbox.sweep` (platform-only `webhooks.process`, no audit row; the sweep's record is `retention_runs`) and `webhooks.event.replay` (Process again, `integrations.dlq.replay` with `admin.integrations.write`, people only, audited); the query `readWebhookHealth`.
- Integration health › Messages from other systems: per provider the last day's received, handled, failed and turned-away messages and those waiting, and the failed ones newest first with Process again (`apps/web/src/components/integrations/webhooks-health.tsx`).
- Decisions the design left open, taken at the early check and accepted by the lead on 13-11-2026:
  1. `WEBHOOK_RECEIVER_PASSWORD` and `DATABASE_URL_WEBHOOKS` are optional, as `app_reader`'s: the migrator creates the role either way, and without the address the routes answer `integration_unavailable`.
  2. The role's statement limit is 2 s and its lock limit 1 s; the route gives the store 1.2 s and the publish what is left of 1.8 s; a store past its share answers 503 and the provider's next delivery is a repeat.
  3. Two definers beyond the five above: `app.webhook_waiting()` for the sweep and `app.webhook_replay()` for Process again.
  4. A row with no handler is processed with the code `no_handler`, not failed.
  5. A row is failed with `too_many_attempts` by the claim after ten tries, counted since it arrived or since Process again last put it back (`attempts - attempts_at_replay >= 10`; review 1).
  6. The claim, the mark and the sweep write no audit row, as the outbox publisher's bookkeeping; Process again is audited.
  7. Lead Ads has its own subscription check (`GET /webhooks/meta/leadgen`) and its own variables `META_LEADGEN_APP_SECRET` and `META_LEADGEN_VERIFY_TOKEN`; WhatsApp uses `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`, Exotel's status `EXOTEL_CALLBACK_SECRET`, LiveKit `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; new: `GOOGLE_LEADFORM_KEY` and `EXOTEL_INCOMING_SECRET`.
  8. Exotel's Passthru calls with GET and the call's fields in the address, so `/webhooks/exotel/incoming/:secret` takes GET and POST; its event id is `CallSid`.
  9. Exotel's status payload keeps the signed address's call reference as `bos_ref`, over any the body names; its event id is `CallSid:status`.
  10. Lead Ads is keyed on `leadgen_id` only when a delivery carries one change, else on the body's SHA-256; an event id over 200 characters falls back to the SHA-256.
  11. A body over the cap answers 400 and is not counted as refused; a refused delivery is counted in one key per provider and UTC hour, kept 25 hours.
  12. NUL characters are dropped from a payload before it is stored.
  13. Deduplication ids: the route publishes with the row's id, the sweep with `<id>:s<attempts>`, Process again with `<id>:r<attempts>`; `attempts` only rises, so each is new.
- Decisions of the review's fix round, 13-11-2026:
  16. A handler error holds the row in a backoff of 1, 2, 4, 8 and 16 minutes, then 30 (`retry_at`), and the worker answers `retrying`, so QStash's chain ends; the sweep republishes only rows no delivery is on its way to (never claimed, a lapsed lease, a backoff passed, or put back by Process again), so ten tries span about two and a half hours and a short outage uses few of them (review 2).
  17. The 90-day removal takes only processed rows and failed rows no live lease holds, never a waiting or leased one; payloads go 30 days after processing (the lead's reading of question 10; review 3).
  18. A purge that removed nothing writes no `retention_runs` row; it stays in the minute sweep (review 8).
  19. The sweep publishes its rows in one QStash batch call, given what is left of its 20-second budget and at most 10 seconds; what the call does not take waits for the next minute (review 7).
  20. Google's form key is not stored (`StoredGoogleLead`); every check refuses an empty secret, and a hosted runtime refuses a `GOOGLE_LEADFORM_KEY` or `EXOTEL_INCOMING_SECRET` under 32 characters; Sentry's copy of a request, transaction, span or breadcrumb has the Exotel inbound segment replaced with `[secret]` (reviews 4 to 6).
  21. A row the claim fails after ten tries is reported with an `error` line (its id and code) and answered `failed` (review 9).
  14. `asExotelStrings` is exported from `status-callback.ts` for the worker's contract map.
  15. An unknown company in `app.webhook_mark()` is refused as `validation_failed`.
- Tests: `packages/db/tests/security/webhooks.test.ts` (the table, the role, every definer and its callers, the guard, the purge, the backoff, Process again past the attempt limit, concurrent stores and claims); `packages/domain/tests/commands/webhooks.test.ts` (claim, mark, sweep, replay: denied, the company refused, the happy paths, the audit row); `apps/web/src/webhooks/checks.test.ts` and `receive.test.ts` (each check, signed deliveries of all six providers, the answers, the time budget); `apps/web/tests/webhooks.test.ts` on real Postgres (each provider delivered twice is one row processed once, a changed byte stores nothing, a parse failure is never retried, the worker and its callback, the sweep, Process again once); the journey `e2e/integrations.spec.ts` (Process again, with axe).
- Not in P5, as the design says: any provider's handler, the hosted secrets and schedules (the owner's), and the 50-a-second measure on dev (G2).

### 5.2 E1 Channels and dial rules
- **Table `entity_channels`** (DATABASE §5, planned): `entity_id`, `channel` (`whatsapp`, `call_promo_140`, `call_service_160`, `ivr`, `missed_call`), `number_e164`, `provider_ref` (WhatsApp `phone_number_id`, Exotel's ExoPhone sid), `dlt_header` (the registered header, for the record), `is_active`, `verified_at`; unique active `(entity_id, channel)` and unique `provider_ref`; read by any request in the company, written by `org.channel.set` and `.archive` (`admin.entities.write:all`, audited). Settings › Companies › Channels shows each company's numbers and whether each is verified.
- **Dial facts:** `app.dial_facts(opportunity_id, contact_phone_id)` answers what `checkDial` needs and nothing more: whether the contact has an unwithdrawn `call` consent for `service` (and for which company, by LAW-2's default of one consent for the group), whether any contact of the customer withdrew call consent, the phone's DND state and when it was checked, and the company's 140 and 160 numbers.
- **Purpose by consent** (`packages/domain/src/telecom/call-purpose.ts`, pure): a call is `service` when the lead's contact has a recorded service consent for calls and the lead is a customer's request, callback or order; otherwise `promotional`. `checkDial` (built) then requires the 160-series for service and the 140-series for promotional, refuses a promotional call to a DND number, and refuses outside 09:00 to 21:00 IST; every broken rule is listed.
- **DND:** a `DndRegistry` port (`packages/domain/src/ports/dnd.ts`) with a fixture adapter now and the scrub source chosen with the DLT registration in the final phase; `contact_phones.is_dnd` and `dnd_checked_at` (built columns) are written by `crm.phone.dnd_record` through the port, as the platform. A promotional dial needs a check newer than 7 days (`WORKSHOP_DEFAULTS.calling.dndFreshDays`); an older one is checked at the dial, and an unreachable registry refuses the promotional dial (`dnd_unknown`), never a consented service call.
- **The Cold Caller and Converting workspaces** show which number a call would go out on and why (service with consent, or promotional), and the reason a dial would be refused, before T3 adds the Dial key.
- **Acceptance:** every case of TEL-04's two criteria refuses with its reasons; a contact who withdrew call consent cannot be dialled by any path; a stale DND check is refreshed or refuses; the security suite proves `entity_channels` per role and company.
- **Sandbox now:** the fixture DND list and the Exotel trial's numbers stand in for the 140 and 160 series.

**Built (E1):**
- `entity_channels` (0162, 0163): RLS forced; read by every principal acting in the company, written by an Executive (`admin.entities.write:all`) through `org.channel.set` and `org.channel.archive`; after the insert only the provider reference, DLT header, verification and active mark change (column grants), and a number out of use is never put back (`app.entity_channels_guard()`). The same number set again is updated in place; another number takes its place and the old row is kept out of use, so what named it keeps it. Settings › Companies › Numbers lists each company's numbers per channel, whether each was checked, and says plainly when a 140 or 160 channel's number is not of its series.
- `app.dial_facts()` for a person holding `calls.dial` who reads the lead; `call-purpose.ts` (service only with a service consent for calls and an order, an open callback or a customer-initiated source: ads, website, WhatsApp, IVR, missed call, walk-in); `checkDial` with `call_consent_withdrawn`, `company_number_missing` and `dnd_unknown`; `planDial` and `prepareDial` in `telecom/dial-plan.ts`; the Cold Caller and Converting workspaces show the plan of a call to the main number (`planCall`), the Dial key waiting for T3.
- DND: the `DndRegistry` port with the fixture register (two synthetic numbers) on local, CI, dev and staging and none on production (`apps/web/src/integrations/dnd/registry.ts`, question 13); `crm.phone.dnd_record` as `system:workers` with the platform-only `crm.dnd.record` through `app.record_phone_dnd()`; `app.contact_phones_dnd_guard()` stops any request marking or clearing a number; `WORKSHOP_DEFAULTS.calling.dndFreshDays` 7 (LAW-4).
- Decisions the brief left open, accepted by the lead on 13-11-2026:
  1. `org.channel.set` does not refuse a 140 or 160 channel whose number is not of that series, so the Exotel trial's numbers can stand in on dev; `checkDial` refuses a wrong-series caller id at every dial, and the screen says so.
  2. `verified_at` is set by the Executive (`verified` on `org.channel.set`); a new number starts unverified unless sent; no provider check sets it in E1.
  3. An opt-out holds across customers: a number whose holder on any customer withdrew call consent and gave none since is refused (`call_consent_withdrawn`), since the phone is what is dialled; `calls.log` keeps its rule of the customer's own contacts.
  4. A service call never asks the DND register, since consent makes it lawful whatever the register says; a stale check is refreshed only for a promotional call.
  5. The DND answer is recorded by `system:workers` in a command of its own, outside the caller's request, bound to the number asked about and never over a newer answer; a failure to record does not change the plan.
  6. The platform-only grant is named `crm.dnd.record`; `org.channel.*` are not `peopleOnly`, as `org.entity.update` is not, and agents are refused by `admin.entities.write`.
  7. Production has no DND register until the final phase: a promotional dial whose check is stale is refused there (`dnd_unknown`), a consented service call is not.

### 5.3 V1 Speech adapter and benchmark
- **Ports** (`apps/web/src/integrations/voice/ports.ts`, extended): `StreamingSpeechToText` (partial and final transcripts, end-of-speech), `StreamingTextToSpeech` (audio chunks from text, first chunk timed), and `transcribeRecording()` for whole files (A2, K3); the adapter may write a line in Devanagari for the vendor's pronunciation and never shows or stores it (ADR 0014).
- **Adapters:** Sarvam AI (built for batch; streaming added where the vendor offers it) and the second vendor of question 7, both behind the ports with recorded responses for the tests.
- **Benchmark** `pnpm --filter web spike:voice -- benchmark`: for every recording of a set, the transcript, the reply's first sentence and its speech, timed per step (§9.3), and against a reference transcript in Roman script the character error rate after normalisation (lower case, numbers as digits, spelling variants folded by a list), the key-term accuracy (numbers, rupee amounts, product and model words, place names) and the listeners' on-topic marks; cost per minute from each vendor's published price. Results go to `docs/04-architecture-appendix/voice.md` with the date.
- **The stand-in set:** 30 questions recorded by the development team and the owner in Hindi, Hinglish and English (some with a Rajasthani accent where a speaker has one), with their reference transcripts; no customer or client voice. The client's 20 to 30 samples run through the same command in the final phase.
- **Model naming:** `claude-stream.ts` takes its model from `AGENT_DEFAULTS.voice.model` (`claude-sonnet-5-5` on question 1 (a)), and the provider wrapper's price table gains Sonnet 5.5 and Haiku 5.5 with the date they were checked; this closes the STATUS follow-up on the spike's model.
- **Selection:** a new ADR records the chosen vendor, the measures, the data terms and the fallback; the adapter stays swappable.
- **Acceptance:** both adapters pass their recorded tests; the benchmark reproduces its numbers from recorded responses in CI; the ADR names the vendor and the target of question 6.
- **Final phase:** the client's samples and three listeners (LAW-5) rerun the benchmark; the exit gate's accuracy item is met on them.
**Built (V1, part 1):**
- the ports `StreamingSpeechToText`, `StreamingTextToSpeech` and `transcribeRecording()` (`apps/web/src/integrations/voice/ports.ts`, `recording.ts`), every transcript in Roman script by `romanOnly()` (`roman-script.ts`);
- Sarvam AI asked for Roman script (`saaras:v3`, `mode=translit`) in batch, and streaming speech to text and text to speech over its WebSockets (`sarvam.ts`, `socket.ts`), tested on fixtures written from its documented shapes and marked `written`;
- the second vendor compared in `docs/04-architecture-appendix/voice.md` §6.2, recommending Amazon Transcribe and Polly in Mumbai; its adapter waits for the owner's yes on its data terms and the vendor's current protocol pages;
- the benchmark `pnpm --filter web spike:voice -- benchmark` (`apps/web/src/integrations/voice/benchmark/`): the measures above as pure functions, a live run that can keep its sessions (`--save-replay`), and a replay (`--replay`) that reproduces the fixture set's report in CI;
- `claude-stream.ts` reading `AGENT_DEFAULTS.voice` (`claude-sonnet-5-5`, effort `low`, thinking `between_tools`), and the price table with Sonnet 5.5 and Haiku 5.5 (Haiku 5.5's dearer prices above 100,000 prompt tokens), each model with the date its price was checked;
- the stand-in set's format in `voice.md` §5. Part 2 (the keys, the 30 recordings, both vendors' runs and the ADR) waits for the owner.

### 5.4 K2 Playbook directives
- **Table `playbook_directives`** (DATABASE §6.9, planned): `entity_id` (null for the group), `type` (`policy`, `priority`, `target`, `sop`, `faq`, `tone`), `audience` (`customer`: the Concierge may state it; `staff`; `management`), `title` (≤ 120), `text` (≤ 2,000), `source_file_id` (a vault file) or `source_voice_session_id` (V2), `state` (the built `playbook-directive` machine: `draft`, `approved`, `retired`), `approved_by`, `approved_at`, `retired_reason`, `conflicts_with` (ids), `embedding vector(1024)`; `playbook_conflict_checks` (`directive_id`, `other_id`, `label` `conflict`, `overlap` or `none`, `reason` ≤ 300, `resolved_by`, `resolution`). Read: `customer` and `staff` by every staff role of the company, `management` with `knowledge.vault.read.management`; written only by the commands.
- **Commands:** `knowledge.playbook.draft` (person with `knowledge.playbook.draft`, or the platform from a Teach session or a vault file), `.edit` (a draft), `.approve` (`knowledge.playbook.approve`; refused while any conflict is unresolved, `playbook_conflict_open`), `.retire` (a reason), `.resolve_conflict` (not a conflict, with a reason, or retire the other directive); each audited, each emitting `knowledge.playbook.changed`, which bumps a version key in Redis so the agents and Ask read the approved set again.
- **Conflict check** (deterministic first): on draft and edit, approved directives of the same type whose companies overlap and whose embedding is within cosine distance 0.20 (`AGENT_DEFAULTS.playbook.conflictDistance`) are candidates; each candidate pair is labelled by Haiku 5.5 (`knowledge:playbook` spend name) with a short reason; a `conflict` or `overlap` label fills `conflicts_with`. The model only labels; approval stays a person's.
- **Drafting from a file:** Draft directives on a vault file asks Sonnet 5.5 for at most 10 typed drafts from its masked passages, each citing its passage; drafts land in `draft` for review.
- **Screens:** `/knowledge/playbook` (menu Playbook under Knowledge): directives by state, type and company; the review sheet with the source passage, the conflicting directive side by side, Approve, Edit, Retire and Not a conflict; keyboard J and K, A to approve.
- **Acceptance:** a draft never steers an agent; a conflict flagged blocks approval until resolved (AI-01); approving or retiring changes what the next agent run reads; the security suite proves each audience per role.

**Built (K2):**
- `playbook_directives` and `playbook_conflict_checks` (DATABASE §6.9, 0165 to 0167): beside the columns above, `source_position` (the cited passage), `retired_at` and `checked_at` (when the conflict check last ran on the wording); `source_voice_session_id` is V2's, with `voice_sessions`. Row security reads a directive by company and audience, and only once approved; a draft or retired directive and every pair only with a playbook grant, so no agent ever reads a draft. The guard `app.playbook_directives_guard()` keeps every write on the machine and refuses an approval of an unchecked draft or one with `conflicts_with` set; a directive drawn from a management file is for management only, and none comes from an Executive-only file.
- `knowledge.playbook.draft` (Executive and GM, all) and the platform-only `knowledge.playbook.check` of `system:workers` (SECURITY §3.2, §3.3); the `playbook_directive` machine built: create and edit by `.draft`, approve by `.approve` (`playbook_check_pending`, `playbook_conflict_open`), retire a draft by `.draft` and an approved directive by `.approve`.
- The commands `knowledge.playbook.draft`, `.edit`, `.approve`, `.retire`, `.resolve_conflict` (not a conflict with a note, or retire the other directive) and `.draft_from_file`, all people only and audited, and `.record_check`, the platform's; each change emits `knowledge.playbook.changed`, whose worker writes a new version id to Redis (`knowledge:playbook:version`, `bumpPlaybookVersion()`) and runs the check. Retiring an approved directive settles every open pair naming it as `other_retired`.
- The conflict check (`checkPlaybook`, `packages/domain/src/knowledge/playbook-check.ts`): the draft embedded (`knowledge:playbook` spend, ₹300 a day for the group), candidates of its type for an overlapping company within `AGENT_DEFAULTS.playbook.conflictDistance` (0.20) through `app.playbook_check_candidates()`, nearest five, each labelled by Haiku 5.5 at low effort with a reason, the rules labelled as data; a pair the model cannot label (no key, an unreadable answer) is recorded unlabelled and counts as open; recorded through `app.record_playbook_check()`, which skips a draft whose wording changed meanwhile. A draft waits unchecked while no embedding key is set. Approval also waits for a check newer than any approval of the same type for an overlapping company, and an `approved` event rechecks those drafts (`app.playbook_check_targets()`).
- Drafting from a vault file (`proposeDirectives`, `packages/domain/src/knowledge/playbook-draft.ts`): the file's passages read as the drafter, at most 60, sent masked to Sonnet 5.5 at medium effort (the drafter's share ₹100 a day); at most ten drafts, each citing its passage, filtered before `knowledge.playbook.draft_from_file` writes them in one transaction.
- `AGENT_DEFAULTS.playbook` and the prices of Haiku 5.5 and Sonnet 5.5 (checked 13-11-2026); the provider wrapper takes an `effort` per call.
- The screen `/knowledge/playbook` (menu Playbook, `knowledge.playbook.draft`): rules by status, kind and company; the review beside the source passage and each approved rule compared, side by side, with the clash and its settlement; Approve, Edit, Retire, Not a clash and Retire the other rule; New rule and Draft from a file; read again every three seconds while a rule waits for its check; keys J, K and A.
- After the review: approvals of a type take an advisory lock and the database clock, the check's candidates are read under the same lock with their read time recorded as `checked_at`, so an approval during a check leaves it stale and is compared on the recheck; the guard refuses an open pair or a stale check whatever the update sets (`app.playbook_approval_blocked()`); the record's wording hash covers type, audience, title and text and it runs in the draft's own company; a failed label call is recorded as an unlabelled, open pair; the candidates sort exactly (no HNSW index on directives); a typed draft keeps the source rules of drafting from a file; the screen stops reading a waiting rule after a minute and says why (not set up, or the day's limit).
- **`approvedPlaybook()`** (`packages/domain/src/queries/knowledge/playbook.ts`) is the one read of the Playbook for the agents and Ask: approved directives only, of the audiences asked for, under the reader's row security, a page of at most 500 at a time with a cursor to read on (never cut silently). B1 and A3 read through it, never from `playbook_directives`, since an Executive or a GM asking holds the playbook grants that show drafts.
- Tests: the machine; `packages/domain/tests/commands/playbook.test.ts`, `playbook-check.test.ts` and `playbook-draft.test.ts` on Postgres with the fake transport; `packages/db/tests/security/playbook.test.ts` (each audience per role, drafts never shown to an agent); the label and drafting filters; the journeys `e2e/playbook.spec.ts` with axe and the snapshot `playbook`; the plans of the list and the candidates in the run file of K2.

## 6. Wave 2

### 6.1 W1 WhatsApp threads and messaging
- **Contract:** `messaging.ts` (built) becomes the catalogue event `messaging.message.requested` with its worker `/api/v1/workers/messaging/send`; new DTOs for threads, messages and templates; the refusal codes stay `MESSAGING_REFUSALS`, with `rate_limited` retryable.
- **Tables:**
  - `whatsapp_threads` (DATABASE §5, planned): `entity_id`, `channel_id`, `account_id`, `contact_phone_id`, `wa_id`, `opportunity_id` (the newest open lead of the customer in the company), `window_open_until`, `opted_out_at`, `handled_by` (`assistant` or `people`), `assignee_id` (the lead's owner), `last_inbound_at`, `needs_reply`; read under the customer's read rule; one thread per company number and customer number.
  - `whatsapp_messages` (monthly partitions in a closed schema, as `activities`): `entity_id`, `thread_id`, `direction`, `provider_message_id`, `kind` (`text`, `template`, `media`, `button`, `system`), `template_name`, `body_masked` (identity and bank numbers masked by the shared finder before storage), `file_id`, `status` (`queued`, `sent`, `delivered`, `read`, `failed`, `refused`), `refusal`, `sent_by` (person, agent or the platform), `drafted_by_agent_action_id`, `created_at`; `whatsapp_message_keys` (`provider_message_id` primary key) makes an inbound message or a status idempotent across partitions; a status only moves forward.
  - `whatsapp_templates`: `entity_id`, `name`, `language` (`en`), `category` (`utility`, `marketing`, `authentication`), `status` from Meta's template events, `params` (count and meaning), `buttons`; written by `messaging.template.register` (`messaging.templates.write`), status by the platform.
- **Inbound handler** (`meta_whatsapp` on P5): for each message, find the company by `phone_number_id` (`entity_channels`), the customer by the number among the company's customers (a number held by several opens the thread unmatched and lists them for staff), open or reuse the thread, open the window, store the message, download media with the system key into a `whatsapp_media` file through P2's checks (malware tag, re-encoding, masking before `ready`), and for an unknown number create the lead through I1's `crm.lead.ingest` (channel `whatsapp`, the click-to-WhatsApp `referral` as attribution); then emit `messaging.message.received` (ids only), or `messaging.button.pressed` for a button reply. Keywords, matched in English and Roman Hindi from `WORKSHOP_DEFAULTS.whatsapp.keywords`: STOP (and its variants) withdraws the WhatsApp consent of that number as the platform and sends one confirmation; HUMAN hands the thread to people. A first message on a thread sends the welcome of question 2 (a).
- **Messaging worker:** checks, in order, opt-out, the 24-hour window for session messages, the template's approval, the portfolio budget (business-initiated messages to distinct customers in a rolling 24 hours, counted in Redis against the limit Meta reports in `phone_number_quality_update`, with marketing templates held once 80% is used, `WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare`), the output filter (length, the link allowlist of the companies' own sites, no identity or bank number, no phone number but the company's), and 20 messages an hour per thread; then sends with the built client (never retried after a timeout) and records the provider id. A held marketing message waits in `queued` for the next window.
- **Commands:** `messaging.message.send` (person, `messaging.send`; a session message in the window, or a registered template), `messaging.thread.hand_off` (to people, with the reason: keyword, request, filter refusals, complaint words; the platform or a person), `messaging.thread.return_to_assistant` (a person), `messaging.template.register`.
- **Screens:** the thread component on Account 360 (tab WhatsApp) and beside the lead in `/converting`: messages with their status, media opened through the checks, the window's time left, a composer that offers templates when the window is closed, and the opt-out state; `/messages` (menu Messages): the threads in the person's scope waiting for a reply, keyset by `last_inbound_at`, keyboard J and K, R to reply.
- **Integration health:** each number's quality rating and limit, the portfolio budget used, refusals by reason.
- **Notifications:** `whatsapp_reply_waiting` to the lead's owner when a thread handed to people waits 10 minutes in calling hours.
- **Acceptance:** WA-04's two criteria; a message to an opted-out customer is refused by every path; a repeated inbound message is stored once; a status out of order never moves back; a file is only ever attached to the sender's thread.
- **Sandbox now:** the WhatsApp test number with five allowed recipients, the `hello_world` template and test templates the sandbox approves; contract tests on recorded payloads, including duplicates and out-of-order statuses. **Final phase:** one number per company, verified business, approved English templates (§12).

### 6.2 I1 Lead Ads, lead forms and website ingest
- **Tables:** `lead_sources` (`entity_id`, `provider` `meta_leadgen`, `google_leadform` or `website`, `external_id` (form or page id), `pipeline_id`, `segment`, `field_map_json` (each form question to a lead field or a qualification fact), `consent_question_key` and `consent_text_version`, `page_token_sealed` (the Meta Page token, sealed by the `FieldCipher`), `is_active`); `ingest_keys` (`entity_id`, `key_hash`, `label`, `revoked_at`) for the website API; `lead_qualifications` (one row per lead: `pump_depth_ft`, `required_hp`, `monthly_bill_rupees`, `roof_area_sq_ft`, `sanctioned_load_kw`, `discom_consumer_no`, `updated_by`, `updated_at`), read and written with the lead.
- **Commands:** `crm.lead.ingest` (platform, `crm.ingest.run`): the same normalisation, PIN lookup, dedupe, attach-to-open-lead and routing of a colleague's customer as `crm.lead.create`, through definers, with the channel, the provider's ids (`campaign_id`, `ad_id`, `form_id`, `gclid` or `ctwa_clid`) as attribution, a consent only when the form's mapped consent question was ticked, with its text version, and the owner of question 3; `crm.lead.qualification.set` (people with `crm.lead.write`, and proposed by the agents); `crm.source.set`, `.archive`, `crm.ingest_key.create` (the key shown once), `.revoke` (`crm.sources.write`). The qualification facts join `RECORDED_STAGE_EXIT_FIELDS`, so a stage may require them.
- **Handlers:** `meta_leadgen` (fetch `GET /<leadgen_id>` with the source's Page token, parse `MetaLeadDetails`, map, ingest), `google_leadform` (`is_test` stored and no lead made), and the website route `POST /api/v1/ingest/leads` (contract built): the key from `X-Ingest-Key` by its hash, Turnstile checked, 60 a minute per key, the lead ingested in the request (it is not a webhook), `GET /ingest/health`.
- **Screens:** Settings › Lead sources (`crm.sources.write`): sources per company, the field map with a preview from the newest test lead, keys; the qualification card on the lead sheet (board, Converting workspace, Account 360's lead).
- **Acceptance:** CRM-01's integration criterion: a lead within 10 seconds of receipt with source, company, attribution and consent; a repeated event creates nothing; an unmapped form is stored and reported, never guessed; the website route refuses a revoked key and a failed Turnstile.
- **Sandbox now:** Meta's Lead Ads testing tool on the developer app's test Page, Google's "send test data", the Turnstile test keys; recorded payloads. **Final phase:** App Review for the leads permission, the companies' Pages and forms, the Google Ads key per account.

### 6.3 T3 Click-to-dial and recordings
- **Table `provider_calls`:** `entity_id`, `opportunity_id`, `contact_phone_id`, `caller_id`, `direction`, `series` (`140`, `160`, `ivr`, `missed_call`), `purpose`, `provider_call_sid` (unique), `status` (`dialling`, `ringing`, `in_progress`, `completed`, `no_answer`, `busy`, `failed`, `canceled`), `started_at`, `answered_at`, `ended_at`, `duration_s`, `recording_file_id`, `transcript_file_id`, `call_id` (the logged call); read with the lead; a status only moves forward. DATABASE planned the provider columns on `calls`, but `calls` is written once by the person's log and never changed, and a provider call changes several times after it starts; so the provider call has its own table and the log links to it.
- **Commands:** `calls.call.dial` (people, `calls.dial`): reads `app.dial_facts()`, runs E1's purpose and `checkDial`, records the provider call as `dialling`, then the built Exotel client places it from the caller's own phone (`caller_profiles.dial_phone_e164`, set by the caller on their profile) to the customer's, with the company's number for the purpose as caller id, recording on, and the signed status address; a refused dial reaches no vendor and lists every reason. `calls.call.log` takes an optional `providerCallId`: the start and duration then come from the provider call, not from the screen. `calls.recording.play` (`calls.recording.listen`) answers a 15-minute address and audits the listen.
- **Handler** `exotel_status` (P5): matches `CustomField` and the CallSid, records the status as the platform (`calls.process`), copies the recording from `RecordingUrl` with the account's key to a `call_recording` file (KMS, never keeping the link), and emits `calls.dial.completed` with ids. The nightly sweep deletes recordings older than 12 months (`WORKSHOP_DEFAULTS.retention.callRecordingMonths`, BLUEPRINT §7.9) and keeps the row.
- **The recording notice:** the call is placed with the company's Exotel flow, which plays the notice to the customer before the caller is joined; the Hinglish wording is a voice prompt in `packages/contracts/src/templates`. If Exotel cannot attach a flow to a click-to-dial call, the sandbox step records it, the call is placed unrecorded and the script card's first line is the notice for the caller to read.
- **Screens:** the Dial key (`C`) in the Cold Caller and Converting workspaces where the company has numbers; the call bar (ringing, connected, time, ended) and the log form filled with the time; the manual flow of Phase 1 stays for a company without numbers and during an Exotel outage (the runbook); Play recording on the call's timeline row.
- **Acceptance:** TEL-04's criteria through the real dial path; a dial outside hours, to DND without consent, or to an opted-out contact never reaches Exotel; a repeated or late status callback changes nothing back; a recording is listened to only with the permission, and each listen is audited.
- **Sandbox now:** the Exotel trial account's numbers and two phones the developer holds; recorded callbacks. **Final phase:** each company's DLT-registered 140 and 160 numbers mapped in Exotel.

### 6.4 K3 Vault audio
- `knowledge_files` gains `source_type` `audio` (MP3, M4A, OGG or WAV, at most 25 MB and 30 minutes); the index job transcribes it through V1's `transcribeRecording()` (`knowledge:index` spend name, its own daily cap), masks identity numbers in the text, and stores the transcript as the file's text before chunking.
- `knowledge.transcript.correct` (`knowledge.vault.write`): the transcript shown beside the audio, corrected and saved, which chunks and embeds again (important for Rajasthani and Marwari, BLUEPRINT §9.1).
- Teach sessions (V2) store their audio and transcript here as `exec_only` files.
- **Acceptance:** an audio upload becomes searchable passages; a correction replaces them; retrieval by sensitivity holds for audio as for documents.

### 6.5 B1 Ask the Business
- **Service** `askTheBusiness()` in `packages/domain/src/ai/ask`: Sonnet 5.5 with tools that each wrap an existing query run through `executeQuery()` as the asking person on the reader pool: the vault search, approved directives the person may read, the pipeline by stage, leads, quotes and orders in summary, targets and progress, dealer credit (only with `sales.credit.write`), each returning ids for citation; no tool writes. Cost and supplier-rate figures come back only where the person's own permissions and RLS give them.
- **Grounding filter** (deterministic): every citation in the answer must be an id a tool returned in this conversation, and every number, amount and date in the answer must appear in a tool result; an answer that fails says what it could not source instead of the figure.
- **Tables:** `ask_conversations` and `ask_messages` (the person's own, read only by them, the question and answer text masked by the finder, the cited ids; removed after 90 days, `WORKSHOP_DEFAULTS.retention.askDays`).
- **Limits:** a daily spend share per person (₹50, `AGENT_DEFAULTS.ask.personDailyCapPaise`) and for the group (₹1,000), `knowledge:ask` spend name.
- **Screens:** `/ask` (menu Ask the Business, `knowledge.ask`): the conversation, each answer with its sources as links, and the figures shown as cards.
- **Contract:** `POST /api/v1/ask` (session, or the voice token) streams the answer; V2's Ask mode uses it.
- **Acceptance:** AI-02: each answer cites its sources; the security suite asks the same questions as a General Manager and an Executive and proves no cost, margin or supplier rate reaches the General Manager's answer, tool results or stored messages.

**Built (B1):**
- `ask_conversations` and `ask_messages` (DATABASE §6.9, 0168 to 0170): a conversation covers the companies in `entity_ids` (`entity_id` the one company, null for several) and is read only by its person in a request covering all of them; a message names its conversation with the same person and companies, holds the masked question and the filtered, masked answer, `outcome` (`answered`, `unsourced`, `no_answer`), the records it cites and those its lookups returned, and is written once. The pg_cron job `ask-conversations-purge` removes them 90 days after last use (`WORKSHOP_DEFAULTS.retention.askDays`), on Integration health's scheduled upkeep.
- `knowledge.ask` (SECURITY §3.2), people only and on no agent. The commands `knowledge.ask.record` (checks every citation against what the conversation's lookups returned, masks both texts, audits without them) and `knowledge.ask.delete`.
- `askTheBusiness()` (`packages/domain/src/ai/ask`): Sonnet 5.5 at medium effort through the provider wrapper under `knowledge:ask` (₹50 a person, ₹1,000 for the group, at most five model calls a question, `AGENT_DEFAULTS.ask`), with ten read-only lookups, each a query run through `executeQuery()` as the person for the conversation's companies: the vault search, `approvedPlaybook()` for the audiences held, open leads by stage, leads, quotes, orders, this month's sales, targets (the person's own and the team's totals), dealer credit with `sales.credit.write`, and catalogue items with their cost side only with `finance.cost.read`. The wrapper takes strict tools with `tool_choice: auto` and sends the model's turn back unchanged; each lookup's answer is masked and labelled as data, amounts after ₹. No name, phone or address of a customer or person reaches the model. A repeated `Idempotency-Key` is answered from its record with no model call.
- The grounding filter (`grounding.ts`, pure): citations as `[ref:<id>]` only of records the conversation's lookups returned; every count, amount and date (any common form, lakh and crore, number words) one the turn's lookups, the question or today give; what fails becomes a mark the screen says in words ("a figure not found in the records").
- `POST /api/v1/ask` (API §3.1): the session from the BOS's own screens, or V2's voice token through the typed seam `AskRouteDeps.bearer`; caps, key, body and the six-a-minute limit checked before the stream; NDJSON lines (`AskStreamEvent`): each lookup as it starts, then the answer once filtered, or an error line.
- `/ask` (menu Ask the Business, `knowledge.ask`): the person's conversations, the open one with each answer's citations as numbered links to their records, its figures in rupees and percentages as cards and its sources by kind and name as the person may read them now; the lookup running; a follow-up; Delete with a confirmation; the day's limit as the catalogue's sentence.
- Tests: the filter (`grounding.test.ts`), the wrapper's tool rounds, the commands and the service on Postgres (`tests/commands/ask.test.ts`), the GM-and-Executive acceptance on seeded costs with a model that writes back everything it read (`tests/security/ask-cost.test.ts`), the eval set on recorded answers with its injection cases (`tests/commands/ask-evals.test.ts`), the tables in the security suite (`ask.test.ts`, the role × company matrix), the route (`apps/web/tests/ask-route.test.ts`), the answer's parts on screen (`screens/ask.test.ts`), the journeys `e2e/ask.spec.ts` with axe and the snapshot `ask`; the plans of the conversation list, a conversation and the sweep in the run file of B1 (`tests/spike/ask-explain.ts`).

## 7. Wave 3

### 7.1 S3 WhatsApp quotes, milestones and STATUS
- **Quote dispatch:** `sales.quote.send` takes `channel` (`whatsapp` or `recorded`); WhatsApp emits `messaging.message.requested` with the company's `quote_sent` utility template, the quote's PDF as its document, the quote number, the grand total and the date it is valid until, and two buttons whose payloads are a token bound to the quote, the thread and the customer's number (HMAC under `WHATSAPP_BUTTON_SECRET`).
- **Acceptance by WhatsApp** (`messaging.button.pressed` handler, the platform with `sales.quote.accept_remote`): the token checks, the sender's number is the thread's, the quote is `sent` and not expired, then `app.accept_quote_remote()` runs the quote machine's `accept` and makes the order draft exactly as `sales.quote.accept` does, with `accepted_via` `whatsapp_reply`; at or above the named value of question 5 it first sends the company's authentication template with a six-digit code (5 minutes, 3 tries, held in Redis by its hash) and accepts with `whatsapp_otp` when the customer sends it back on the same thread. An expired quote answers with a template that says a new quote will follow and tells the lead's owner. Each answer is a thread message the owner sees.
- **Events and notices:** `sales.quote.accepted` (new) tells the lead's owner (`quote_accepted`); `sales.order.confirmed` sends the `order_confirmed` milestone.
- **Milestone registry** `whatsapp_milestones` (`entity_id`, `milestone` `quote_sent`, `order_confirmed`, `dispatched`, `visit_booked`, `visit_reminder`, `installed`, `payment_due`, `handover_kit`, `template_id`, `is_active`): each milestone sends its approved template once per subject (a unique key on milestone and subject), in English, from the selling company's number; one not yet approved is held, not sent (WA-01). Later phases add their event's handler, nothing else.
- **STATUS** (keyword): a deterministic reply, not a model's, listing the sender's own quotes and orders in the company through `app.status_summary(thread_id)`, which reads only the thread's customer; projects join in Phase 4.
- **Screens:** the quote page's send dialog chooses WhatsApp or recorded; the quote shows how it was accepted; Settings › WhatsApp templates maps milestones to templates.
- **Acceptance:** SAL-05's WhatsApp part, WA-01 and WA-03; a button pressed from another number, a forged or replayed token, or a wrong code accepts nothing; acceptance after expiry answers `quote_expired`; one acceptance makes one order.

### 7.2 A3 WhatsApp Concierge
- **Runs on** `messaging.message.received` for a thread `handled_by` the assistant, as `agent:concierge`, one runtime step per message keyed by the message id. The run is bound to one thread: the request context carries `app.agent_thread_id`, and for an agent principal the `own` scope of the lead, customer, thread and message policies matches only that thread's customer and lead, and nothing when the setting is unset (fail closed). The security suite proves a run bound to customer A reads nothing of customer B.
- **What it reads:** the thread's last 20 messages (masked, labelled `untrusted_data`, Devanagari kept as received), the lead's segment, stage and qualification facts, open callbacks, and the approved `customer` directives; no other customer, no note, no price list, no cost.
- **What it proposes** (action types in `AGENT_ACTION_TYPES`): `messaging.reply.send` (an in-window reply in English; approved, it is sent by the approving person and marked as drafted by the assistant), `crm.lead.qualification.set`, and `crm.task.create` for a callback (for the lead's owner, inside calling hours). A handoff is not an action: when the agent answers with one, or a rule fires (HUMAN, complaint or legal words, three filtered or unreadable answers in a row, a price or subsidy question, low confidence), the worker hands the thread to people at once (`messaging.thread.hand_off`, the platform), since stopping the agent needs no approval.
- **Output filter** (`filterConciergeAnswer()`, deterministic): one JSON object; the reply at most 600 characters; links only to the companies' sites; no phone number but the company's; no identity, bank or rupee amount, percentage, kW, HP or date unless it appears in a cited `customer` directive or the thread's own facts; no word from the promise list (`WORKSHOP_DEFAULTS.whatsapp.promiseWords`: discount, guarantee, free and the like); no instruction, code or bracket; a reply citing no directive is one of the fixed forms (greeting, a qualification question, a booking confirmation, a handoff).
- **Autonomy:** Shadow first (`AGENT_DEFAULTS.startingAutonomy`), recorded as drafts with no message; after the Executive reviews the shadow report, Needs approval, with the draft shown in the thread for the owner to send (S), edit (E) or discard (D). Automatic stays unavailable.
- **Sets:** an eval set of made-up conversations per segment (qualification, callback, STATUS, out-of-scope) and a prompt-injection set (instructions in a message, in a document's name, in a contact's profile name; asking for another customer's details, a price, a discount, a promise; tool misuse; a label closed early), run in CI on recorded answers and by hand on the live model (`eval:concierge`); every injection case fails safely.
- **Limits:** a daily spend cap per company (₹500 on dev and staging, `AGENT_DEFAULTS.concierge`), 30 runs a thread a day, and the kill switches.
- **Acceptance:** AI-05 and AI-06 for the Concierge; nothing reaches a customer without a person's approval; the shadow report lists every draft beside what the person sent.

### 7.3 A2 Caller Co-pilot
- **Briefs:** on `crm.opportunity.assigned` (and on demand, at most once an hour per lead), Sonnet 5.5 writes a brief of at most 600 characters from the lead, its calls and outcomes, its thread's last messages and the approved `staff` directives, recorded with `agents.note.record` in `copilot_notes` (`entity_id`, `opportunity_id`, `provider_call_id`, `kind` `brief` or `call_summary`, `body` masked, `fields_json`, `suggested_disposition_id`, `agent_action_id`), read with the lead.
- **Call summaries:** on `calls.dial.completed` for a recorded call within the coverage of question 8, the recording is transcribed by V1's adapter (masked before storage as a `call_transcript` file), then Haiku 5.5 writes the summary, the facts it heard and a suggested outcome; the outcome is shown pre-selected in the log form and never logged by the agent.
- **What it proposes:** `crm.lead.qualification.set` from the facts heard, `crm.task.create` for the follow-up (built action type), and `messaging.template.request` (new) for a nurture message on day 7, 30 or 90 and a quote-expiry nudge two days before expiry, from approved utility or marketing templates (CALL-5's WhatsApp follow-up).
- **Filter:** facts within the qualification fields' bounds; a task inside calling hours for the lead's owner; a template only when the customer holds WhatsApp consent and the template is approved; a note with no identity number, instruction or link.
- **Autonomy:** Shadow, then Needs approval per action type after review; the workspace panel shows the brief, the summary and the suggestions with A and R keys.
- **Sets:** made-up transcripts in Hinglish with their expected facts and outcomes, and an injection set (instructions spoken in a call, in a customer's message); `eval:copilot`.
- **Acceptance:** TEL-03's Co-pilot criterion; a suggestion changes nothing until approved; the shadow report compares suggested outcomes and facts with what the caller logged.

### 7.4 T4 Inbound calls and screen-pop
- **Handler** `exotel_incoming` (P5): records an inbound `provider_calls` row (series `ivr` or `missed_call` by the number dialled), matches the caller's number to customers of the company, finds the answering caller from `DialWhomNumber` (`caller_profiles.dial_phone_e164`) and emits `calls.inbound.ringing` to that person.
- **Screen-pop:** a shell component for callers who are present opens the matched customer's Account 360, a list when several customers share the number, or the new-lead form with the number filled in (TEL-05); by Realtime or the poll of question 4.
- **Missed calls:** a call to the missed-call number makes or attaches the lead through `crm.lead.ingest` (channel `missed_call`) and a callback task due now for its owner, inside calling hours; `missed_call` notice.
- **Acceptance:** TEL-05's two criteria within 2 seconds of the Passthru call on the dev deployment; a missed call outside hours is due at the next opening.

### 7.5 V2 Live voice Teach and Ask
- **App** `apps/voice-agent` (BLUEPRINT §5): a LiveKit Agents worker for Node (`@livekit/agents`, pinned at V2's start), deployed with LiveKit Cloud Agents hosting in India from an image built in CI (ECS Fargate in ap-south-1 if Mumbai placement is not offered); it holds no database credential and calls `/api/v1` with the session's 5-minute token, refreshed through `POST /api/v1/voice/token`.
- **Table `voice_sessions`** (DATABASE, planned): `user_id`, `entity_ids`, `mode` (`teach`, `ask`), `consent_recording`, `audio_file_id`, `transcript_file_id`, `started_at`, `ended_at`, `minutes`, `cost_paise`, `turn_stats_json` (turns and per-step p50 and p95); read by its person and the Executive; `voice.session.start` (`voice.use`) checks the day's minutes and spend (`voice_cap_reached`), makes the room and answers `VoiceSessionResponse` (built contract); `voice.session.record` on LiveKit's events.
- **The voice principal** never carries `finance.cost.read` or `procurement.rate.read`, even for an Executive (settling SECURITY §3.4's proposal); every command it runs is audited with `actor_kind` `voice_session` and the speaking person.
- **The turn:** streaming speech-to-text, Sonnet 5.5 streaming with tools, streaming text-to-speech of each sentence as it ends, barge-in, live captions; push-to-talk and text when the network drops; budget in §9.3.
- **Ask:** B1's service through `/api/v1/ask`; a short spoken answer and the cited cards on screen through the room's data channel.
- **Teach:** an interview by type (policy, priority, SOP, FAQ, tone) that ends with draft directives through `knowledge.playbook.draft` as the person; with recording consent, the audio and transcript go to the Vault as `exec_only` (K3).
- **Screens:** `/voice` (menu Talk to Shakti, `voice.use`): the recording question before each session, the listening light, captions, cards, push-to-talk, the minutes left.
- **Acceptance:** AI-03 for Teach and Ask: p50 first audio under 1.5 seconds over 100 turns from Mumbai on the dev deployment; a session never starts without the recording answer and stops at the cap; a dropped network falls back.

## 8. Wave 4

### 8.1 G2 Phase 2 exit pack
- The shadow reports of the Concierge and the Co-pilot (per action type: proposals, agreement with what people did, filter refusals, handoffs, spend per lead), with a sample of 50 draft-and-reply pairs per agent for the Executive's review, which the exit gate needs.
- The runbooks of BLUEPRINT §12 for Phase 2: WhatsApp template rejected, the messaging limit reached, Exotel outage (manual calling with logging), LiveKit outage (text), speech vendor outage (push-to-talk text), AI provider outage (agents stop, people take the threads).
- Alerts in Sentry: webhook failures and the oldest waiting row, a WhatsApp quality rating at Low, the portfolio budget at 80%, voice and AI spend at 80% of a cap.
- The measures recorded in `docs/04-architecture-appendix/`: webhook answer times under load, the 10-second lead from a Lead Ads test event, the dial accepted in under 2 seconds, screen-pop time, voice p50 and p95.
- The final-phase checklist of §12 written into `docs/13-client-packs/exit-gate-actions.md`, and `currentPhase` moved by the exit gate.

## 9. Models, speech and latency

### 9.1 Models
Subject to question 1 (a); prices from Anthropic's list on 13-11-2026, to be checked again and dated in `AGENT_DEFAULTS` when each slice adds its model.

| Use | Model | Price per million tokens (input / output / cache read) |
|---|---|---|
| Concierge replies, Co-pilot briefs, Ask the Business, voice, drafting directives | Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 / $0.10 |
| Co-pilot call summaries, conflict labels, Triage once its sets pass | Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 for prompts up to 100,000 tokens |
| Triage until then | Haiku 4.5 `claude-haiku-4-5-20251001` | $1 / $5 / $0.10 |

Sonnet 5.5 and Haiku 5.5 reject a forced tool choice, so the runtime asks with `auto` and strict tool schemas and the filters check the answer; Sonnet 5.5's thinking is turned off for the voice path with `between_tools` at low effort, and left adaptive at low or medium effort elsewhere, each setting named in `AGENT_DEFAULTS` and measured by the eval sets before it changes. The voice spike's `claude-stream.ts` reads the voice model from `AGENT_DEFAULTS.voice.model`.

### 9.2 The speech-to-text accuracy target (proposed)
No measurement exists yet: the voice spike's results section is empty because it waits for the client's samples. The target below is proposed for the owner (question 6) and measured by V1 on the stand-in set, then on the client's samples in the final phase:
- **character error rate** at most 12% on transcripts normalised to Roman script (lower case, numbers as digits, spelling variants folded by a list), the measure that suits Hinglish better than word error;
- **key terms** at least 95% right: numbers, rupee amounts (lakh and crore), HP, kW, product and model words, place names;
- **on topic** in at least 90% of turns, marked by listeners from the stored audio.
If the chosen vendor misses on the client's samples, the transcript stays correctable (K3), voice keeps push-to-talk and text, and the second vendor is measured on the same set before the exit gate.

### 9.3 Latency budget, p50 from Mumbai
| Step | Budget |
|---|---|
| End of speech detected | 250 ms |
| Final transcript after end of speech (streaming) | 250 ms |
| Model's first sentence (time to first token and the sentence) | 600 ms |
| Speech of the first sentence to its first audio | 250 ms |
| Network and playback buffer | 150 ms |
| **First audio after the person stops** | **1,500 ms** |

Each step is timed per turn in `turn_stats_json`; a miss names its step. If the model's step misses with Sonnet 5.5, V2 measures Haiku 5.5 for Ask's spoken answer before anything else changes.

## 10. Costs per month
At full volume, against BLUEPRINT §13's assumptions (2,000 leads a day, about half on WhatsApp; 2,500 connected calls a day; 100 users; 300 voice minutes a month), in US dollars unless marked; vendor quotes confirm them in the final phase.

| Item | BLUEPRINT §13 | This design | How it is reached |
|---|---|---|---|
| Concierge (Sonnet 5.5, cached) | $800–2,000 | $800–1,600 | about 180,000 turns a month at about 4,000 cached and 2,000 new input tokens and 400 output: about $0.008 a turn |
| Triage, Co-pilot summaries (Haiku 5.5) | $300–700 | $30–100 | about 30,000 Lead Converter call summaries at about 4,000 input and 300 output tokens, and 60,000 leads triaged |
| Co-pilot briefs, Ask, Playbook (Sonnet 5.5) | $150–400 (with the Phase 6 agents) | $250–500 | about 9,000 briefs, 9,000 questions, a few hundred conflict labels and drafts |
| Voyage embeddings | < $20 | < $20 | vault and directives |
| Call transcription, Lead Converter calls only (~90,000 minutes) | $500–1,800 | $500–1,800 | the chosen vendor's price per minute, from V1's benchmark |
| Live voice (LiveKit, speech, model) | $50–150 | $50–150 | 300 minutes; the model is about $10 of it |
| **AI subtotal** | **$1,800–5,100** | **$1,650–4,200 (about ₹1.7–4.4 lakh at ₹104 a dollar)** | |
| Infrastructure added (QStash messages for webhooks and messaging, Redis, LiveKit Cloud plan, recording storage) | in the $300–550 | +$60–150 | about 60,000 webhook and messaging deliveries a day; recordings at about 1 MB a minute, kept 12 months |
| WhatsApp (Meta's per-message fees; service replies in the window are free) | ₹20–60k | ₹20–60k | mostly customer-first conversations (BLUEPRINT §7.7) |
| Exotel (plan and about 450,000 billed minutes over two legs) | ₹2–3 lakh | ₹2–3 lakh | unchanged |

While building, dev and staging use the sandboxes and the agents' ₹100 daily caps per agent; the live model and speech runs of the benchmarks and eval sets cost under ₹5,000 for the whole phase.

## 11. Workshop defaults
Each default lives in `WORKSHOP_DEFAULTS` or `AGENT_DEFAULTS`, is added by the slice that first uses it, is named under its question in `docs/13-client-packs/workshop-pack.md` and changes in one place:
- `whatsapp`: the keywords for STOP, HUMAN and STATUS in English and Roman Hindi; the marketing hold at 80% of the portfolio budget; the promise words; the code from ₹2,00,000 (question 5); 20 messages an hour per thread; a reply waiting 10 minutes before its notice;
- `calling`: a DND check fresh for 7 days; the recording notice's wording (LAW-3);
- `retention`: webhook payloads 30 days and rows 90 days (question 10); call recordings 12 months; WhatsApp media 3 years then a text summary (BLUEPRINT §7.9); Ask conversations 90 days; voice sessions 24 months; each for the CA to confirm;
- `AGENT_DEFAULTS`: the Concierge and Co-pilot starting in Shadow, their daily caps and run limits, transcription of Lead Converter calls only (question 8), the conflict distance 0.20, the Ask and voice caps (questions 9 and 12), the models of §9.1 and their price date.

Data with no default stays empty until the client gives it: the channels' numbers, the templates' final wording, the lead sources and their field maps, the consent and notice texts, the Playbook's directives, and the caller phones for click-to-dial.

## 12. Final-phase verification
Each row is built and tested now; the live step is done in the final phase and recorded where its document says.

| Slice | Live step in the final phase | Needs |
|---|---|---|
| P5 | Each live provider's deliveries reach production's routes and pass their checks | the live accounts below |
| E1 | The numbers entered per company; the DND scrub source connected and a known DND number refused | DLT registration, 140 and 160 numbers (LAW-4) |
| W1 | One number per company, display names approved, quality and limit read; the welcome and opt-out on each | Meta business verification, WABA, numbers |
| I1 | A real lead from each company's Page and Google account within 10 seconds | Meta App Review (leads), Pages, Google Ads keys |
| T3 | A promotional call on the 140 number and a consented service call on the 160 number per company; the notice plays; the recording is stored | DLT numbers mapped in Exotel, callers' phones |
| T4 | An inbound call pops up, a missed call makes a callback | IVR and missed-call numbers |
| S3 | `quote_sent`, `order_confirmed` and the authentication template approved per number; one acceptance by button and one by code | approved templates |
| A3, A2 | The shadow reports on real conversations and calls reviewed with the Executive before Needs approval | live traffic for two weeks |
| V1, V2 | The client's 20 to 30 samples meet the accuracy target; p50 under 1.5 s with Executives | samples, three listeners (LAW-5) |

The roadmap's exit gate then reads as two parts: the engineering items (webhook idempotency and contract tests green, consent routing verified on the sandbox, voice latency on dev) close with G2; DLT numbers live, the shadow reports on real traffic and accuracy on real samples close in the final phase.

## 13. Questions for the client (final phase)
These need the client's people; none blocks a slice. They join `docs/13-client-packs/client-actions.md` when the final phase is planned.
1. Consent per company or for the group (LAW-2), which decides the 160-series routing: the group's single consent is today's default.
2. Which consents a caller may record, and whether a WhatsApp button opt-in counts for service calls (LAW-1).
3. The texts, with legal advice (LAW-3): the WhatsApp welcome and AI disclosure, the opt-out confirmation, the spoken call-recording notice in Hinglish, and the privacy notice covering recordings and AI.
4. DLT registration of the four companies, headers, the 140 and 160 numbers, the IVR and missed-call numbers, and the DND scrub service (LAW-4).
5. Meta business verification, one WhatsApp number and display name per company, and the English wording of each milestone, `quote_sent`, the welcome and the authentication template.
6. Meta App Review for Lead Ads, the companies' Pages and forms, the consent question on each form, and the Google Ads lead form key per account.
7. The Executives' voice samples and three listeners (LAW-5).
8. The sales head: the intake owner rule (question 3), the WhatsApp nurture and quote-expiry messages (CALL-5), which calls are transcribed, the callers' phones and the Exotel seats and channels.
9. The value above which a WhatsApp acceptance asks for a code.
10. The retention periods with the CA: recordings, WhatsApp media, webhook payloads, Ask conversations, voice sessions.
11. The Concierge's qualification questions per segment, the topics it hands to people at once, and the hours people answer WhatsApp.
12. The first Playbook: the FAQs, policies and tone the Executives approve, and Teach sessions to draft them.

## 14. Tests per slice
Every slice, as in Phase 1: unit tests beside the code; for each new table its place in the `*_TABLES` lists, a fixture row per company and a rule in the role × company matrix; for each command the denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep over new commands; journeys for the roles it touches with axe checks and light, dark and 400 px snapshots; `EXPLAIN` evidence for every list and search; the JavaScript budget; `pnpm db:docs` and `machines:docs`. Beside those:

| Slice | Tests of its own |
|---|---|
| P5 | Contract tests on recorded payloads of all six providers, duplicates and tampered bodies; the receiver role can only insert; replay; the sweep; a load script for the dev deployment |
| E1 | Every `checkDial` case through `app.dial_facts()`; consent withdrawal and stale DND; channels per role and company in the security suite |
| V1 | Adapters on recorded responses; the benchmark's arithmetic (normalisation, error rate, key terms, percentiles); no Devanagari leaves the adapter |
| K2 | The directive machine; conflict candidates and the approval guard; audiences per role in the security suite; the reload on a change |
| W1 | Out-of-order and repeated statuses; window, template, opt-out, budget, filter and rate limit in order; media through the checks; keywords; a file only on the sender's thread; journeys for the thread and `/messages` |
| I1 | Each provider's recorded lead to a lead within 10 seconds (the in-process path); repeated events; unmapped forms; website keys and Turnstile |
| T3 | Refusals never reach the client (a fake transport); forward-only status; recording copy and the 12-month sweep; audited listening; the Dial journey on a fake Exotel |
| K3 | Audio transcription on recorded responses; correction re-indexes; sensitivity per role |
| B1 | The grounding filter; cost isolation per role in the security suite; citations only of returned ids; an eval set of business questions on seeded data |
| S3 | Token, sender, state, expiry and code cases; one order per acceptance; milestones once per subject; STATUS reads only the sender's records |
| A3 | The thread binding in the security suite; the output filter; eval and injection sets on recorded answers in CI and by hand on the live model |
| A2 | Coverage setting; the outcome only pre-selected; the filter; eval and injection sets |
| T4 | Matching one, several and no customers; the pop by Realtime and by the poll; missed-call tasks inside hours |
| V2 | The worker on a fake room (turn timing, barge-in, fallback); the voice token's claims and refresh; caps; no cost permission on the voice principal |
| G2 | The shadow report queries; the alerts fire on synthetic counts |

## 15. Gaps and conflicts in the governing documents
- **Models:** BLUEPRINT §1, §5, §9.2 and §9.3 name Sonnet 5 and Haiku 4.5; Sonnet 5.5 and Haiku 5.5 succeed them (question 1), and the voice spike reads `AGENT_DEFAULTS.voice.model` (`claude-sonnet-5-5`).
- **First touch:** the Concierge's first touch under 60 seconds (BLUEPRINT §9.3) needs either a deterministic welcome or Automatic, which the owner keeps for Phase 6 (question 2); at BLUEPRINT §13's volume, people approving every Concierge reply would be about 6,000 approvals a day, so Needs approval for replies is a stage of the rollout, not the steady state.
- **The accuracy target:** ROADMAP §4 and PRD AI-03 set it from the voice spike before Phase 2 starts, but the spike waits for the client's samples, which moved to the final phase (question 6, §9.2).
- **The exit gate:** "DLT numbers live" and accuracy "on real samples" cannot close before the final phase; §12 splits the gate.
- **Documents and site visits:** BLUEPRINT §7.8 and §8.6 give the Concierge document filing and site-visit booking, which need Phase 4's document vault and scheduling board; Phase 2 receives and checks files on the thread and books callbacks only. STATUS covers projects only from Phase 4, and five of the seven milestones have no event before Phases 3 to 5.
- **Provider calls:** DATABASE plans the provider columns on `calls`, which is written once; T3 uses `provider_calls`.
- **Webhook ids:** API §3.4 keys the inbox on the provider's event id, but a WhatsApp delivery batches events with no single id; P5 keys it on the body's hash and each item on its own id.
- **Exotel incoming:** API §2 names how the status callback is authenticated but not the Passthru applet, which signs nothing; P5 uses a secret path segment.
- **Permissions:** `agent:concierge` holds no messaging grant though BLUEPRINT §7.8 lets it send; Ask the Business has no permission; a General Manager may Teach but not draft (questions 9 and 11); SECURITY §3.4's voice cost rule is only proposed (settled in V2).
- **Lead Ads consent:** BLUEPRINT §7.7 counts a "form submission" as consent, PRD CRM-01 asks for a consent record from every channel; I1 records one only when the form's consent question was ticked, until LAW-1 says otherwise.
- **Realtime:** the spike was deferred to the production site, which is now live, so it can run in Phase 2 (question 4).
