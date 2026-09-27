# Architecture — Shakti Prime BOS

Blueprint reference: §3–§6, §9.3, §10, §12. This document describes how the system is built and how a request, an event and an integration move through it. `docs/BLUEPRINT.md` governs on any conflict.

## 1. Quality attributes
| Attribute | Target | Mechanism |
|---|---|---|
| Correctness of money, stock and state | Zero drift | Deterministic domain layer, state machines, append-only ledgers, tax engine |
| Entity isolation | No cross-entity read or write; a shared customer is seen only through a relationship in an entity the caller holds | RLS with fail-closed policies, one request-context helper, `account_entities` as the customer scope root (ADR 0008) |
| Cost confidentiality | Cost fields never leave the DB for unauthorised roles | Restricted tables, cost-permission RLS, whitelisted DTOs |
| Latency | p95 interaction < 300 ms; ingestion → assignment < 10 s | Vercel `bom1` + Supabase Mumbai, keyset pagination, materialised dashboards |
| Availability | 99.5% in business hours; RPO ≤ 5 min; RTO ≤ 4 h | Managed services, PITR, nightly dumps, runbooks |
| Operability for one developer | Minimal vendor set, one language | TypeScript monorepo, managed services, strong CI |
| AI safety | No unsafe customer message; no cost leak to agents | Narrow tools, output filters, autonomy levels, agent principals |

## 2. System landscape
```
 Browsers (all roles)             Android Field App (Expo)
        │ HTTPS                           │ HTTPS + offline sync (/api/v1)
        ▼                                 ▼
 ┌────────────── Vercel bom1: Next.js App Router (apps/web) ───────────────────────┐
 │ (public) site │ (bos) app: server actions │ /api/v1: mobile, ingest, webhooks   │
 │                     └──────── Domain Command Layer (packages/domain) ─────┘      │
 └──────────┬──────────────────────────────┬──────────────────────────────────────┘
            │ Drizzle: withRequestContext() │ outbox_events
            ▼                              ▼
 Supabase Postgres (Mumbai)         Upstash QStash + Workflow ──► Workers (Vercel functions):
  RLS · pgvector · pg_trgm            Upstash Redis (locks,        PDFs · imports · agents ·
  partitions · pg_cron                rate limits, round-robin)    STT · embeddings · reminders
            │ Realtime (private channels, BOS-signed JWT)            │
            ▼                                                        ▼
 Live in-app updates                     Claude API · Voyage · speech vendor · Meta · Exotel · SES · FCM

 Voice: Browser/App ⇄ WebRTC ⇄ LiveKit Cloud (India) ⇄ apps/voice-agent (LiveKit Cloud Agents) ⇄ /api/v1 as the user
 On-prem: Tally Prime ◄─ apps/tally-connector (Windows service) ─► /api/v1/connector (signed, outbound only)
 Files: S3 ap-south-1 (SSE-KMS) via 15-minute pre-signed URLs; malware scan + OCR masking workers
```

### Runtime components and hosting
| Component | Runtime | Host |
|---|---|---|
| `apps/web` | Next.js server actions, route handlers, QStash-triggered workers | Vercel `bom1` |
| `apps/field` | Expo Android app | Google Play (EAS Build/Update) |
| `apps/voice-agent` | LiveKit Agents worker (Node) | LiveKit Cloud Agents hosting, India region |
| `apps/tally-connector` | Node Windows service | Client PC beside Tally |
| Database | Postgres 17 with RLS, pgvector, pg_trgm, pg_cron, partitions | Supabase Mumbai (dev, staging, prod projects) |
| Queue and cache | QStash, Workflow, Redis | Upstash (nearest region to Mumbai) |
| Object storage | S3 with KMS, lifecycle rules, backup bucket | AWS ap-south-1 |

## 3. Monorepo and dependency rules
```
apps/web ─┬─► packages/domain ─► packages/contracts, packages/db (schema and types, never the client)
apps/field ─┤   packages/ui ─► packages/tokens
apps/voice-agent ─┴─► packages/contracts
apps/tally-connector ─► packages/contracts
```
- `packages/domain` has no framework imports. It is testable with Vitest against a real Postgres.
- `packages/contracts` is the only shared surface between apps; it holds Zod schemas, DTO types, error codes and event names.
- `packages/db` owns schema, migrations, RLS SQL, seeds and the `withRequestContext()` helper.
- Turborepo tasks: `build`, `typecheck`, `test`, `test:security` (`lint`, `format:check` and `copy-lint` run at the root; `db:*` scripts call the db workspace directly; `test:e2e` arrives with Playwright in Phase 1).

## 4. Request lifecycle (web)
1. **Edge:** Vercel routes the request; the proxy (`apps/web/src/proxy.ts`) gives every page request a fresh nonce and the Content-Security-Policy that trusts it (JSON routes get a fixed policy from `next.config.ts`, which also sets the other security headers). The `(bos)` layout redirects a request without a usable session; the app shell in week 4 moves the session check into the proxy.
2. **Server action or route handler** validates the input with the Zod contract from `packages/contracts`.
3. **`withRequestContext(principal, entityScope, fn)`** opens a transaction and calls `set_config` for `app.user_id`, `app.entity_ids`, `app.role`, `app.permissions`, `app.request_id` (all transaction-local).
4. **Command** runs inside the transaction: permission guard → state machine → business logic → writes → `ctx.emit()` appends `outbox_events` rows in the same transaction.
5. **Commit.** After commit, the outbox publisher (an immediate nudge from the action, plus a QStash schedule every minute as the safety net, since QStash schedules are minute-granular) pushes pending events to QStash.
6. **Response** is the command's DTO. Server components re-render; Realtime broadcasts refresh other users' screens.

Every read also runs inside `withRequestContext()`, so RLS applies to reads and writes alike. The connections without a request context are named and fenced: the auth module's `auth_service` connection (identity tables only), the migrator, seed and bootstrap scripts (table owner, never in a request), the readiness probe (`select 1`), and `app.user_grants()`, a definer function that resolves the signed-in user's own grants. ESLint keeps every other module off them.

## 5. Domain command layer
- **Definition:** `defineCommand({ name, permission, minScope?, input, output, constraintReasons?, handler })`. The registry is the single list of things the system can do; UI, `/api/v1`, agents, voice and imports call commands by name.
- **Context:** `{ principal, entityIds, activeEntityId, tx, emit, now, requestId }`. `principal` is a user, an agent service principal or a voice session acting as a user.
- **Permission guard:** checks `permission` against `app.permissions` with the scope rule (own / team / entity / all). Denied calls return `DomainError('forbidden')` and are audited as `outcome = denied`.
- **State machines** (specified in week 5, built with each module): `packages/domain/src/state-machines/*` define states, transitions, guards, side effects and permitted actors for opportunity, quote, sales order, dispatch, project flows, subsidy gates, loan, warranty claim, document filing, expense claim, Playbook directive and Tally voucher. Commands call `transition(machine, record, event, ctx)`.
- **Calculators:** TDH, kW sizing, kit availability, credit check, job-cost roll-up, incentive rules and the tax engine are pure functions with fixture-based tests.
- **DTOs:** each command declares an output schema. Cost fields exist only in DTOs of commands whose permission is `finance.cost.read` or `procurement.rate.read`.
- **Audit:** the command runner writes `audit_logs` in the command's own transaction (command, actor, entity, aggregate, redacted input, before/after, IP, device, request ID), one row per changed aggregate; `executeCommand` records denied and failed calls in a short transaction after the rollback; the auth module records sign-in and account events (docs/design/backend-weeks-3-5.md §3).

## 6. Events and workers
- **Outbox:** `outbox_events(id, sequence, entity_id, type, aggregate_type, aggregate_id, payload_json, created_at, published_at, attempts, last_error, dead_lettered_at)` written in the command's transaction; delivery columns are updated only by the `outbox_publisher` role.
- **Publisher:** claims unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes to QStash topics by event type, marks them published. At-least-once delivery.
- **Workers:** route handlers under `/api/v1/workers/*` verify the QStash signature and process idempotently, keyed by event ID in Redis. Long or multi-day flows (nurture cadences, document chasing, subsidy gate follow-ups) run as Upstash Workflows with named steps.
- **Failure:** retries with backoff, then the dead-letter queue, surfaced on the Integration Health page with replay.
- **Scheduled jobs:** pg_cron for materialised-view refresh, retention and reminders that are pure SQL; QStash schedules for jobs that call external services.

## 7. Integration patterns
| Integration | Pattern |
|---|---|
| Inbound webhooks (Meta WhatsApp, Lead Ads, Exotel) | Verify signature → insert raw payload in `webhook_inbox` → return 200 → QStash worker processes idempotently by provider event ID → commands. |
| Website forms | Signed ingest API per entity with Turnstile; same normalisation and dedupe as other sources. |
| Tally connector | Reads by AlterID, pushes signed batches to `/api/v1/connector/tally/*` with `Idempotency-Key`; daily GUID snapshot for tombstones; heartbeat every 5 minutes; self-updates from signed releases. |
| Outbound WhatsApp | Commands emit `message.requested`; the messaging worker checks window, opt-out, template approval, tier budget and the deterministic output filter, then sends and records status webhooks. |
| Exotel | Click-to-dial from the caller workspace calls the Exotel API with the entity's 140/160-series caller ID; status and recording webhooks update `calls`; recordings copied to S3 and transcribed by a worker. |
| Claude, Voyage, speech vendor | Provider wrappers with timeouts, retries, prompt caching, budgets, PII masking and structured outputs. |
| LiveKit | The voice worker joins the room, streams STT → Claude → TTS, and calls `/api/v1` with a short-lived token minted for the speaking user. |

## 8. Realtime
- Supabase Realtime private broadcast channels per user (`user:{id}`) and per entity topic (`entity:{id}:queue`, `entity:{id}:board`).
- The BOS signs a short-lived ES256 JWT (`sub`, `entity_ids`, `bos_role`, `aud: shakti-realtime`, `role: authenticated`, `exp` ≤ 15 min, as ADR 0003 fixes them; `RealtimeClaims` in `packages/contracts/src/api/realtime.ts`) from its own key pair and exposes an OIDC discovery document on `shaktiprime.com`. Supabase is configured to trust it as a third-party auth provider. Realtime authorization policies on `realtime.messages` read those claims.
- The token grants Realtime only; it carries no Data API role. All data still flows through commands.
- Server-side commands broadcast after commit through the outbox → a small "notify" worker, so a broadcast never precedes a committed write.

## 9. Files, masking and print
- **Upload:** the client requests a pre-signed PUT (15 min, content-type and size constrained). The object key is written to `files` with `status = pending`.
- **Scan and mask:** a worker downloads the object, runs the malware scan and, for customer documents, OCR masking (Aadhaar and bank numbers). The masked object replaces the original; the original is deleted. Only then does `status` become `ready`.
- **Read:** pre-signed GET for 15 minutes; views of sensitive documents are audited.
- **Print and PDF:** HTML templates in `apps/web/src/print/*` rendered by headless Chromium in a worker with Inter embedded; output stored in S3 and linked to the record. The same templates serve the on-screen print view.

## 10. Field app sync
- Records created offline get client-generated UUIDv7 IDs, so uploads are idempotent.
- **Pull:** `/api/v1/sync/pull?since=<cursor>` returns the engineer's schedule, jobs, checklists and reference data with a server cursor.
- **Push:** `/api/v1/sync/push` sends a batch of commands with an `Idempotency-Key` per command. The server applies them in order through the command layer; status transitions are server-authoritative, survey fields merge per field by timestamp, stock and expense commands are idempotent.
- **Conflicts** are returned as a list and shown in the conflict review screen.
- Photos upload in the background with on-device compression; the record references the object key and is marked complete when the upload lands.
- A minimum-version gate blocks pushes from clients below the supported API version.

## 11. AI runtime
- **Trigger:** outbox events (lead created, message received, call ended, gate due) start an Upstash Workflow per agent run.
- **Run:** the workflow builds the context (masked), calls Claude through the tool runner with typed tools that wrap commands, and records every step in `agent_runs` and `agent_actions`.
- **Principal:** each agent runs as its own service principal (`agent:<name>`) inside `withRequestContext()`, so RLS and permissions apply. No agent principal holds a cost permission.
- **Autonomy:** the action's autonomy level (Suggest / Needs approval / Automatic) is read from `agent_configs` per agent × action type. Suggest and Needs approval create Agent Inbox items; Automatic executes and notifies.
- **Guardrails in code:** tier prices only; out-of-bounds engineering results go to review; WhatsApp window and opt-out; TRAI hours and number series; consent; output filters on every outbound message; per-agent daily spend caps; kill switches (global, per agent, per entity).
- **Ask service:** Ask the Business and voice Ask run as the user through the same retrieval and tool set, so the answer respects the user's permissions.
- **Evals:** `agent_evals` store prompt versions, eval sets and scores; a prompt or model change cannot ship without a passing eval run.

## 12. Cross-cutting
- **Configuration:** environment variables in Vercel, EAS and the connector's encrypted local config; typed with Zod at startup.
- **Feature flags:** `feature_flags` table with per-entity and per-role overrides, read through one helper.
- **Observability:** Sentry in every app; structured JSON logs with request ID, no PII; metrics for queue depth, DLQ size, connector heartbeat, WhatsApp quality, AI spend; uptime checks on the public site, the BOS and the ingest API.
- **Environments:** `dev`, `staging`, `prod` as separate Supabase projects and Vercel environments; Supabase branching for pull-request previews; staging holds synthetic data only.
- **Deployments:** GitHub Actions run lint, format, copy lint, typecheck, unit tests, the production build, a secret scan and dependency audit, and the security suite (contract tests join with the first `/api/v1` routes); a merge-on-green workflow merges a PR once that run passes and runs CI again on `main`; Vercel deploys previews per PR and production from `main`; migrations run in a pre-deploy step with expand/contract; the field app ships via EAS with staged rollouts.

## 13. Architecture decision records
ADRs live in `docs/adr/` as `NNNN-title.md` (context, decision, consequences). Phase 0 records:
1. Monorepo with pnpm and Turborepo.
2. Supabase Postgres in Mumbai with RLS as the isolation boundary.
3. Better Auth over Supabase Auth, with BOS-signed JWTs for Realtime.
4. Domain command layer as the single mutation path.
5. Transactional outbox with Upstash QStash and Workflow.
6. UUIDv7 primary keys generated by clients and server.
7. Deterministic tax engine with effective-dated rates and composite-supply valuation. Drafted: [ADR 0007](adr/0007-deterministic-tax-engine.md).
8. One customer record for the group with a relationship per selling entity. Accepted: [ADR 0008](adr/0008-shared-customer-master.md).
9. Chromium-rendered HTML for PDFs and print. Proposed: [ADR 0009](adr/0009-chromium-html-pdf-and-print.md).
10. LiveKit Cloud with a TypeScript agent worker for live voice. Proposed: [ADR 0010](adr/0010-livekit-cloud-typescript-voice-agent.md).
11. Claude Haiku 4.5 and Sonnet 5 behind a provider wrapper; Voyage embeddings in pgvector. Proposed: [ADR 0011](adr/0011-claude-provider-wrapper-voyage-pgvector.md).
12. Expo with WatermelonDB for the offline field app. Proposed: [ADR 0012](adr/0012-expo-watermelondb-offline-field-app.md).
13. Read-only Tally connector with AlterID reads and deletion tombstones. Proposed: [ADR 0013](adr/0013-read-only-tally-connector.md).
14. English interface, with Roman-script Hinglish only for caller scripts, voice agent speech and training. Accepted: [ADR 0014](adr/0014-english-interface-hinglish-speech.md).
