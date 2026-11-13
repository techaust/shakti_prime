# P5 Webhook backbone (wave 1)

| | |
|---|---|
| Branch | `feat/p5-webhooks` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | early check |
| Next step | the lead reads the early-check diff, then the worker, sweep and screen |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §5.1](../../03-roadmap-appendix/phase2.md#51-p5-webhook-backbone), §2 (question 10: payload 30 days after processing, row 90 days after receipt; question 13: off on production), §3, §4 (`webhooks.process`, platform-only), §11, §12 and §14.
- BLUEPRINT §10 (verify → store in `webhook_inbox` → 200 → idempotent worker) and §12; API §3.4 (the webhook rows) and §6; SECURITY §3.3; DATABASE (the planned `webhook_inbox`); ADR 0020 (the workers principal and its definers).
- What exists: `packages/contracts/src/api/webhooks-meta.ts`, `webhooks-exotel.ts`, `webhooks-google.ts`, `webhooks-livekit.ts`, `webhooks.test.ts`; `apps/web/src/integrations/whatsapp/webhook.ts`; Exotel's `status-callback.ts`; the worker routes, `EVENT_JOB_ROUTES` and the in-process registry in `apps/web/src/workers/qstash.ts`; `qstash-schedules.ts`; `retention_runs`; Integration health (`/admin/integrations`); `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and the latest `app.platform_only_permissions()` (migration 0142).
- Skills: `add-table`, `add-command`, `supabase-postgres-best-practices` if present.

Build, in this order:
1. **Contracts** of §5.1: `WEBHOOK_PROVIDERS`, `WebhookProcessJob`, `WebhookProcessResult`, `WebhookHealth`.
2. **`webhook_inbox`** with RLS forced and failing closed, no request role able to select it; the definers `app.webhook_receive()`, `app.webhook_claim()`, `app.webhook_mark()`, `app.webhook_purge()`, `app.webhook_health()`; unique `(provider, provider_event_id)`; append-only apart from the delivery and purge columns (a trigger refuses any other update). Follow AGENTS §6 for the table and its testing lists.
3. **The login role `webhook_receiver`**, AGENTS §6's new-login-role steps in full: `ensureRoles()`, `requireEnv()`, `DATABASE_URL_WEBHOOKS` and `WEBHOOK_RECEIVER_PASSWORD` in `.env.example`, `turbo.json`, `ci.yml`, `migrate.yml` and DEPLOY. It may execute `app.webhook_receive()` only. Hosted values are the owner's: write the owner's steps (the hidden-prompt script pattern of `tools/secrets`) in your report, never a value.
4. **`webhooks.process`**: platform-only, in `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and a new `app.platform_only_permissions()` that keeps every key 0142 has.
5. **Routes** `apps/web/src/app/api/v1/webhooks/*` through one `receiveWebhook(provider, verify)` helper, with the body caps, the six checks (constant-time where a secret is compared), the Meta `GET` handshake, `401` plus a Redis count on a failed check, `200` within 2 seconds, and the in-process fallback without QStash. Every vendor secret is a new optional variable; with it unset the route answers `integration_unavailable` (question 13).
6. **Worker** `/api/v1/workers/webhooks/process` and `apps/web/src/workers/webhooks/registry.ts` (empty registry: rows are marked `no_handler`); the lease, `payload_unreadable` not retried, the failure callback to Sentry with ids and codes only.
7. **Sweep** `webhook-sweep-<environment>` in `qstash-schedules.ts`, with `WORKSHOP_DEFAULTS.retention.webhookPayloadDays` (30) and `.webhookRowDays` (90), each run a `retention_runs` row.
8. **Integration health › Webhooks** and Process again (`webhooks.event.replay` with `integrations.dlq.replay`); copy in `en.json`; a journey with axe.
9. **Tests:** every acceptance line of §5.1 (a repeat is one row processed once; a changed byte stores nothing; a parse failure is visible and never retried; replay processes once), signed fixtures for all six providers with low-entropy test secrets, the security suite for the table, role and definers, the agent refusal sweep, and a unit test for each check.
10. **Documents:** DATABASE, SECURITY §3.3, API §3.4 (each row's state), DEPLOY (the role, the variables), design §5.1 "Built (P5)", `pnpm db:docs`.

Files owned: everything above. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `turbo.json`, `.env.example`, the testing lists, `WORKSHOP_DEFAULTS`. E1, V1 and K2 build beside you: never touch `entity_channels`, the telecom rules, `apps/web/src/integrations/voice` or the Playbook.

**Early check (Tier A):** once the contracts, the table, the role, the definers and the routes are committed with their tests, write a short report in this file, commit it with the subject `report: p5-webhooks early check`, push and stop. The lead reads that diff and starts you again for the worker, sweep and screen.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §5.1 pass on real Postgres; `pnpm test:security` passes on the local Postgres. The 50-deliveries-a-second measure on dev is G2's, not this slice's.

Not in P5: any provider's handler (W1, I1, T3, T4 and V2 register theirs); a hosted secret or schedule (the owner's and the lead's); the Realtime spike.

This branch changes the checks (`ci.yml`, `migrate.yml`, `turbo.json`): its pull request merges only after the owner's `checks-ok`.

## Report

### Early check, 13-11-2026, cloud session (Postgres 54322)
Skills loaded: `add-table`, `add-command` (`supabase-postgres-best-practices` is a PC plugin, absent here). Branch at `ee05d05`, nine commits, all pushed.

**Built (brief items 1 to 5, with parts of 6 and 8 the contract change pulled forward):**
- Contracts: `WEBHOOK_PROVIDERS` (six), `WebhookErrorCodeSchema`, `WebhookProviderHealth`, `FailedWebhook`, `WebhookHealth` (now `IntegrationHealthResponse.webhooks`) in `admin-integrations.ts`; `WebhookProcessJob`, `WebhookProcessResult` in `worker-jobs.ts`; `ExotelIncomingParams`; `commands/webhooks/inbox.ts` (claim and mark); the endpoint catalogue and fixtures (`webhooks.leadgen.verify`, `webhooks.exotel.incoming.get`, `workers.webhooks.process`, `WEBHOOK_ERRORS`).
- `webhook_inbox` (migration `0160_webhook_inbox`) and `0161_webhook_inbox_rls`: RLS forced with no policy and no request role's privilege; guard trigger `app.webhook_inbox_guard()`; definers `app.webhook_receive()`, `_claim()`, `_mark()`, `_waiting()`, `_purge()`, `_health()`, `_replay()`, each `search_path = ''`; `app.platform_only_permissions()` with the eleven keys of 0142 plus `webhooks.process`.
- `webhook_receiver`: `ensureRoles()`, `optionalEnv()`/`requireEnv()`, `@shakti/db/webhooks` (`webhook-client.ts`, pool of four) fenced to `apps/web/src/webhooks` in `eslint.config.mjs` and `lint-fences.test.ts`; `.env.example`, `turbo.json` (`test:security`, `test:e2e`), `ci.yml` (security job), the migrate action, `migrate.yml`, `release.yml`, `release-workflows.test.ts`, `tools/integration/integrate.sh`, DEPLOY.
- `webhooks.process` in `PERMISSION_KEYS`, `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX`, the seed and its description, `en.json` (`roles.permissions`, `roles.modules.webhooks`).
- Commands `webhooks.event.claim` and `webhooks.event.mark` (registry, `audit.ts` labels); query `readWebhookHealth`.
- Routes `apps/web/src/app/api/v1/webhooks/{meta/whatsapp, meta/leadgen, google/leadform, exotel/call-status, exotel/incoming/[secret], livekit}` through `receiveWebhook(provider, verify)` and `metaHandshake()` in `apps/web/src/webhooks/{checks, providers, receive, refusals}.ts`; `publishWebhookJob` in `qstash.ts`; the processor `apps/web/src/workers/webhooks/process.ts`, `contracts.ts` and the empty `registry.ts`, which the in-process fallback runs. Integration Health's loader fills `webhooks` from `app.webhook_health()` and the refused counts.
- Documents: API §3.4 (each row's state) and the §3.6 worker row, DATABASE (§3 role, §4.1 definers, §4.4 rules, §5, §6.10, §7 indexes), SECURITY (§3.1 list, the matrix row, §3.3 row, checklist item 9), DEPLOY, `pnpm db:docs`.

**Not yet (after the early check):** the worker route `/api/v1/workers/webhooks/process` and its failure callback `/workers/webhooks/failed` (the processor exists; `publishWebhookJob` already names both paths), the sweep and its schedule, `WORKSHOP_DEFAULTS.retention.webhookPayloadDays`/`webhookRowDays`, `webhooks.event.replay`, the Webhooks part of the Integration Health screen and its copy, the journey, the design's "Built (P5)" record.

**Tests added (all pass):** `packages/db/tests/security/webhooks.test.ts` 19; `packages/domain/tests/commands/webhooks.test.ts` 5; `apps/web/src/webhooks/checks.test.ts` 9 and `receive.test.ts` 17 (signed deliveries of all six providers, `signed-deliveries.ts` with low-entropy test secrets and recorded or generated fixtures); `apps/web/tests/webhooks.test.ts` 5 on real Postgres (each provider delivered twice is one row processed once, a changed byte stores nothing, a parse failure is `payload_unreadable` and never retried, Exotel inbound by POST, both Meta handshakes); one fence case; updated: `grants.test.ts`, `enum-sync.test.ts`, `caller-profiles.test.ts` (10 → 11 platform-only keys), `integration-health.test.ts`, `reader-parity.test.ts`, `refusal-coverage.test.ts` (REVIEWED entries for the two commands, which name no company).

**Checks:** `pnpm test:security` on 54322: db 1292, domain 1052, web 347 passed (run at `1ead9a5`; after the index change of `ee05d05` the db unit tests 147 and `webhooks`, `grants`, `enum-sync` suites 189 passed again). `pnpm exec turbo run test`: 8 of 8 tasks, web 995 passed and 1 skipped, domain 2353. `pnpm typecheck` 8 of 8; `pnpm lint` clean; `pnpm copy-lint` clean; `pnpm --filter web build` with no `.env` and no database variables passes and lists the six routes; `db:verify` passes; the document link check reports only its four findings that `main` has too. The gitleaks scan was not run (no Docker here).

**EXPLAIN (ANALYZE)**, 300,000 synthetic rows in a rolled-back transaction: the failed rows newest first by `webhook_inbox_failed_idx`, 0.53 ms; received and processed in 24 hours per provider by `webhook_inbox_provider_received_idx` and `_provider_processed_idx`, 0.05 ms and 0.02 ms; waiting per provider by a BitmapAnd of `_waiting_idx` and `_provider_received_idx`, 1.8 ms; the sweep's 500 by `_waiting_idx`, 0.69 ms; the whole `app.webhook_health(50)`, 22.7 ms.

**Decisions the brief did not settle:**
1. `WEBHOOK_RECEIVER_PASSWORD` and `DATABASE_URL_WEBHOOKS` are optional, as `app_reader`'s: the migrator creates the role either way, so a hosted migrate after the merge does not stop before the owner sets the secret, and the routes answer `integration_unavailable` without the URL (`DATABASE_URL_WEBHOOKS` is in `requireEnv()`'s list for the pool, read through `optionalEnv()` for the check).
2. The role's `statement_timeout` is 2 s and `lock_timeout` 1 s; the route gives the store 1.2 s and the publish what is left of 1.8 s; a store past its share answers 503 and the provider's next delivery is a repeat.
3. Two definers beyond the design's five: `app.webhook_waiting()` (the sweep's list) and `app.webhook_replay()` (Process again; `app_user` has no update on the table).
4. A row with no handler is marked processed with the code `no_handler`, not failed, so Integration Health's failed list holds real failures only.
5. A row is failed with `too_many_attempts` at its tenth claim, so no row is tried for ever.
6. The claim and mark write no audit row (`auditWhen: 'changed'`, nothing named), as the outbox publisher's bookkeeping; Process again will be audited.
7. Lead Ads has its own subscription check (`GET /webhooks/meta/leadgen`) and its own new variables `META_LEADGEN_APP_SECRET` and `META_LEADGEN_VERIFY_TOKEN`, since Meta's Page subscription needs a handshake and Lead Ads may sit in another Meta app; WhatsApp reuses `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`, Exotel's status `EXOTEL_CALLBACK_SECRET`, LiveKit `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; new: `GOOGLE_LEADFORM_KEY`, `EXOTEL_INCOMING_SECRET`.
8. Exotel's Passthru calls with GET and the call's fields in the address, so `/webhooks/exotel/incoming/:secret` takes GET (the query string is the stored body) and POST; its event id is `CallSid` alone.
9. Exotel's status payload keeps the signed address's call reference as `bos_ref`, over any the body names; its event id is `CallSid:status`.
10. Lead Ads is keyed on `leadgen_id` only when a delivery carries one change, else on the body's SHA-256; any event id over 200 characters falls back to the SHA-256.
11. A body over the cap answers 400 and is not counted as refused; a refused count is one Redis key per provider and UTC hour, kept 25 hours.
12. NUL characters are dropped from a payload before it is stored (Postgres JSON keeps none, and every redelivery would fail).
13. Dedup ids: the route publishes with the row's id; the sweep and Process again will use the id with the attempt (`<id>:s<n>`, `<id>:r<n>`), since QStash keeps an id for days.
14. `asExotelStrings` is exported from `status-callback.ts` for the worker's contract map; `zod` is not a web dependency, so the map types the contracts without it.
15. An unknown company in `app.webhook_mark()` raises 23503, answered `validation_failed`.

**Seen, not changed:** `webhook_receiver`, like every role, can read `extensions.pg_stat_statements` and its own rows of `cron.job` (PUBLIC grants of the Supabase image); the test checks the BOS's schemas. Exotel's secret path segment is in the platform's request log, as the design accepts.

**Owner's steps for dev and staging (no values here; the hidden-prompt pattern of `tools/secrets`):** make a long random password for `webhook_receiver` per environment; set `WEBHOOK_RECEIVER_PASSWORD_DEV` and `_STAGING` as repository secrets; after the merge run *Migrate a hosted database* for each with *Set the login roles' passwords again* ticked (the first migrate creates the role without a password if the secret came later); set `DATABASE_URL_WEBHOOKS` (transaction pooler, user `webhook_receiver.<project ref>`) and the sandbox vendor secrets of DEPLOY §1 step 11 in each Vercel project, marked Sensitive. Production stays without them until the final phase (question 13); `tools/secrets/set-production-secrets.ps1` gains the role then.

**Shared registration points touched (one line or entry each):** `permissions.ts`, seeds, `en.json` (two role lines, two audit labels), `audit.ts`, `turbo.json`, `.env.example`, the testing lists (`PLATFORM_TABLES`, `asWebhookReceiver`), `grants.test.ts`, `enum-sync.test.ts`, `caller-profiles.test.ts`, `reader-parity.test.ts`, `refusal-coverage.test.ts`. `WORKSHOP_DEFAULTS` not yet.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; check `app.platform_only_permissions()` against `main`'s latest definition (E1 or K2 may add a key).
