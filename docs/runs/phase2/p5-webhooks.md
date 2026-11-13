# P5 Webhook backbone (wave 1)

| | |
|---|---|
| Branch | `feat/p5-webhooks` on GitHub, from `main` at 008066b7 |
| PC worktree | none: built in a cloud session of its own (Postgres 54322, app 3000) |
| Runs on | a cloud session, the lead on the PC (owner, 13-11-2026, for this day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high, 5-hour window 11 % at the start |
| State | brief |
| Next step | build to the early check |

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

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- Migrations are numbered after `main`'s last at merge; check `app.platform_only_permissions()` against `main`'s latest definition (E1 or K2 may add a key).
