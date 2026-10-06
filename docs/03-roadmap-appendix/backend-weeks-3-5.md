# Backend design: Phase 0 weeks 3 to 5

> **Design record for Phase 0 weeks 3 to 5, built and merged** (the merges are listed in [CHANGELOG.md](../../CHANGELOG.md)). It records why the backend took its shape; the code, [05-database.md](../05-database.md) and [04-architecture.md](../04-architecture.md) govern how it works. What is planned beyond it is in [phase1.md](phase1.md), and the items built since carry their pull request there and in the CHANGELOG. Where a later decision changed a line, the line says so with its date.

Date: 2026-09-27. Governing documents: BLUEPRINT §5 to §8, ARCHITECTURE §4 to §8, SECURITY §2 to §4, DATABASE §2 to §7, API §1 to §3, ADR 0003 to 0007, ROADMAP §2. Where this design settles something the documents left open, the section says so.

**Built from this design:**
- slice 1, identity (§2), and ADR 0008, both reviewed;
- slice 2, the audit trail (§3);
- slice 3, the outbox and its publisher (§4), with dead-letter replay (§4.4);
- slice 4, idempotency keys (§5);
- slice 1b part 1, `admin.user.two_factor.reset` (§2.6);
- slice 1b part 2, the Realtime token route, the signing-key documents and the spike script (§2.5);
- the tax engine and the tax commands (§6);
- the state-machine runtime, its machines (listed in [state-machines/README.md](../state-machines/README.md)) and the six opportunity commands (§7);
- the import framework for leads (§8).

**Later, as each section records:**
- the mobile tokens and the Redis front for idempotency keys (slice 1b part 3), with the field app in Phase 4;
- the Realtime spike run on the production site (`docs/04-architecture-appendix/realtime.md`);
- the Phase 1 items named in §3, §4, §7, §8 and §9, planned in [`docs/03-roadmap-appendix/phase1.md`](phase1.md).

Decisions taken with the client on 2026-09-27:
- **Mixed roles in "All entities" view:** the narrowest role wins. The request carries only the grants every one of the user's roles holds; the user switches to a single entity to use a wider role there.
- **Imports permission:** the key `imports.write`, Executive `all`, General Manager `entity` (SECURITY §3.2).
- **Shared customer master:** one contact and account record for the group, with `account_entities` holding the relationship and its owner per entity (ADR 0008, built 2026-09-27). An accounts import creates one relationship per row's entity and folds a repeated customer into one record.

## 1. Scope by week

A record of the plan of 27-09-2026; what was built is in the "Built" notes of each section and in [STATUS](../10-status.md).

| Week | Deliverable | Sections |
|---|---|---|
| 3 | Better Auth with Argon2id, sessions, TOTP, Turnstile, lockouts; `users`, `sessions`, `user_entity_roles`, mobile devices; principal resolution; Realtime JWT spike; `audit_logs` written by the runner; `outbox_events` and the QStash publisher; idempotency keys | §2, §3, §4, §5 |
| 5 | Tax engine with tests; state-machine specifications and the `transition()` runtime for opportunity, quote and sales order; import framework | §6, §7, §8 |

Week 4 (tokens, UI base, app shell) is front-end and is not in this document.

## 2. Identity and authentication (week 3)

### 2.1 Tables
All under RLS, forced; among these tables the one delete grant to `app_user` is on `user_entity_roles`, as the policies below say. Auth tables are touched by the auth module through a dedicated Postgres role `auth_service` (login, `nobypassrls`, grants on these tables only, no business table). `app_user` reads them for principal resolution and admin screens and writes them only through admin commands.

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` (= `principals.id`), `name`, `email` unique (lower-cased), `email_verified`, `image`, `phone`, `theme`, `contrast` (`standard`, `high`; migration 0046), `status` (`invited`, `active`, `suspended`, `offboarded`), `two_factor_enabled`, `last_login_at`, timestamps, actors | One row per staff user; the principal row carries `kind = 'user'`. Built (slice 1): the columns follow Better Auth's user model so its adapter needs only the table name mapped; the password hash lives in `auth_accounts`. |
| `sessions` | `id`, `user_id`, `token`, `ip_address`, `user_agent`, `last_seen_at`, `expires_at`, `revoked_at`, `revoked_reason`, timestamps | Better Auth session store. Built: the token is stored as issued and the column is granted to `auth_service` only, so no request path can read it; Better Auth's idle window gives the 12 h limit and the 7 d absolute limit is enforced from `created_at` by `session-principal.ts` and by the global hook in `create-auth.ts` on every auth route. No `totp_verified_at`: Better Auth creates no session until the second factor is verified. |
| `auth_accounts` | Better Auth `account`: `user_id`, `provider_id` (`credential`), `account_id`, `password` (Argon2id hash), token columns unused | Built. `auth_service` only. |
| `user_two_factor` | Better Auth `twoFactor`: `user_id`, `secret` (encrypted), `backup_codes` (encrypted), `verified`, `failed_verification_count`, `locked_until` | Built. Backup codes live here, stored encrypted by the plugin rather than hashed (accepted). `auth_service` only. |
| `user_entity_roles` | `user_id`, `entity_id`, `role_id`, `team_id`, unique `(user_id, entity_id)` | The user's allowed entities are the rows here. |
| `mobile_devices` | `id`, `user_id`, `device_id`, `name`, `refresh_token_hash`, `refresh_family_id`, `refresh_expires_at`, `push_token`, `last_seen_at`, `revoked_at` | One row per installed field app; per-device revocation. Not built: it arrives with the mobile tokens (§2.4) and the field app in Phase 4; its policies are specified here and are not yet in a migration. |
| `auth_verifications` | Better Auth's verification store (`identifier`, `value`, `expires_at`) for set-password and reset links | Built. Rows expire; `auth_service` only. |

Policies (migrations 0014, 0024, 0049, 0056 and 0059, as DATABASE §6.1): `auth_service` has full access to `users` (select, update), `sessions`, `auth_accounts`, `auth_verifications` and `user_two_factor`, and nothing on any business table. `app_user` reads its own `users` row, or every row with `admin.users.write:all` (0024); reads the `user_entity_roles` rows of the request's companies and its own rows (0049; `readonly_reporter` reads under the same rule, 0059); reads its own `sessions` rows or all of them with `admin.users.write:all` (column-level select, never `token`); adds users with `admin.users.write:all`; writes `user_entity_roles` with `admin.users.write:all` for the request's companies only (0049; `user_entity_roles` alone grants delete, because the access list is replaced as a set); and updates a `users` row or revokes a session (by updating `revoked_at` and `revoked_reason`) with `admin.users.write:all` only for a person who holds no role outside the request's companies, apart from the caller's own row and sessions (0056). `auth_accounts`, `auth_verifications` and `user_two_factor` are invisible to `app_user`, and `mobile_devices` will be too when its migration arrives with the field app (Phase 4). Principal resolution reads through `app.user_grants(user_id)`, a security-definer function executable by `app_user` only that returns status, preferences and one row per (entity, role, grant) and no secret column.

### 2.2 Better Auth configuration
- Email and password with Argon2id (m = 64 MiB, t = 3, p = 1), minimum 12 characters, breached-password check against the Have I Been Pwned range API (k-anonymity, no password leaves the server).
- Cloudflare Turnstile token verified server-side on login and the password-reset request (built), and on the public lead form, which arrives with the signed ingest route (`POST /api/v1/ingest/leads`) in Phase 2 with the other integration sources.
- Lockouts in Upstash Redis, per account-and-address pair: after 5 failures of one account from one address the next attempt waits 1 minute, doubling per further failure, capped at 60 minutes; the response is `rate_limited` with the catalogue sentence and `Retry-After`. Counters reset on success. An account-wide count across all addresses never locks; it emails the owner at every tenth failure (SECURITY §2).
- Sessions: idle 12 h (Better Auth `expiresIn` with a 5-minute `updateAge`), absolute 7 d (checked from `created_at` by `session-principal.ts` and the global hook in `create-auth.ts`, revoking the row with reason `absolute_expiry`), cookie `__Host-shakti-session` in production (`shakti.session_token` locally, where cookies cannot be Secure), HttpOnly, Secure, SameSite=Lax, origin checked on server actions. Rotation on privilege change: a role change, TOTP enrolment or password change revokes every other session of the user and re-issues the current one. Admins revoke sessions with `admin.session.revoke`.
- TOTP (Better Auth two-factor plugin) is mandatory for `executive`, `general_manager` and `accounts`. Enrolment is forced at first login; until `users.two_factor_enabled` is set, `currentPrincipal()` answers `unauthorized` with reason `totp_required` and the app routes to the enrolment screen; once enabled, Better Auth issues no session until the code is verified. Recovery codes as above; recovery mail through SES only.
- Password reset and invitations go by SES (the `Mailer` port: `sesMailer` where `MAILER=ses`, the console mailer, which prints the link, locally and in CI); the invite creates `users` in `invited` status through `admin.user.invite`, the set-password link is Better Auth's reset flow, and the first password set moves the user to `active`. The first Executive of an environment comes from `pnpm --filter web invite-executive`. Lockouts and the principal cache use the `KeyValue` port: Upstash Redis when configured, an in-memory store locally and in CI.

### 2.3 Principal resolution
`resolvePrincipalFromGrants(userId, rows, activeEntityId?)` in `packages/domain/src/auth/resolve-principal.ts` builds the principal from the rows of `app.user_grants()`; `apps/web/src/auth/session-principal.ts` loads the session, checks it and caches the result:
1. Load the session (cookie token, or mobile access token claims), reject if revoked, idle-expired or absolute-expired; bump `last_seen_at` at most once a minute.
2. Load `user_entity_roles` with roles and grants.
3. Single-entity mode: `entityIds = [active]`, `roleKey` and grants from that row, `teamId` from that row.
4. All-entities mode: `entityIds` = every row's entity; grants = the intersection across rows, keeping the narrowest scope per key; `roleKey` = the role of the row with the fewest grants (display only); `teamId` null (team scope needs one entity).
5. Cache the result in Redis for 60 s keyed by session id, entity and a per-user version counter; a role change, suspension or revocation bumps the user's counter, so every cached principal of that user is left behind at once (`apps/web/src/auth/principal-cache.ts`).

Principal resolution is tested in `resolve-principal.test.ts` and the web suite: mixed roles yield the intersection, a suspended user resolves to nothing, a revoked session resolves to nothing.

### 2.4 Mobile tokens (`/api/v1/auth/mobile/*`)
- Access token: ES256 JWT signed with the BOS key pair (same pair as the Realtime token, `kid` in the header), 15 minutes, claims `sub` (user), `sid` (device), `entity_ids`, `bos_role`, `aud: shakti-mobile`, `exp` (ADR 0003: no BOS token puts an application role in `role`; `MobileAccessClaims` in `packages/contracts/src/api/mobile-auth.ts`). Verified statelessly; device revocation checked from a 60 s Redis cache of `mobile_devices.revoked_at`.
- Refresh token: opaque 256-bit random, stored hashed, 30-day lifetime, rotated on every refresh within a `refresh_family_id`. A rotated token presented again revokes the whole family (reuse detection) and the device must sign in again.
- Minimum app version gate from `GET /me`, which arrives with the field app in Phase 4.

### 2.5 Realtime JWT spike
`POST /api/v1/realtime/token` mints the ES256 JWT (`sub`, `entity_ids`, `bos_role`, `aud: shakti-realtime`, `role: authenticated`, `exp` ≤ 15 min; ADR 0003, `RealtimeClaims` in `packages/contracts/src/api/realtime.ts`). The BOS serves `/.well-known/openid-configuration` and `/.well-known/jwks.json` with the current and next key. Supabase's third-party auth accepts named vendors only, so the project verifies the token with the BOS public key imported into its JWT signing keys as a standby key (ADR 0003, [realtime.md §6](../04-architecture-appendix/realtime.md)). Pass criteria: a user subscribes to `user:{id}` and `entity:{id}:queue` for an entity in scope; a subscription to another user's or entity's channel is refused; the token is rejected by the Data API. Fallback if it fails: the notification centre polls every 15 seconds while its tab is visible (blueprint risk 15; [phase1.md §2](phase1.md#2-decisions-taken-with-the-owner-on-29-09-2026)), recorded in the spike note.

Built (slice 1b part 2, branch `spike/realtime-and-harnesses`): `POST /api/v1/realtime/token` on the published `RealtimeTokenRequest`, `RealtimeTokenResponse` and `RealtimeClaims`, signed with `jose` from `BOS_JWT_CURRENT_KEY` (and `BOS_JWT_NEXT_KEY` during a rotation), the key list `/.well-known/jwks.json` and the discovery document `/.well-known/openid-configuration`, the channel policies and the spike script in `docs/04-architecture-appendix/realtime.md`; the spike run itself waits for the production site on the client's domain ([realtime.md](../04-architecture-appendix/realtime.md)).

### 2.6 Commands (week 3)
Domain commands:
- slice 1: `admin.user.invite`, `admin.user.role.set`, `admin.user.suspend`, `admin.user.reactivate`, `admin.session.revoke`; built with the final Phase 0 audit: `admin.user.lock.clear`, which lifts a sign-in lock with an audit row;
- Better Auth endpoints are called from server actions, because their state lives in tables `app_user` cannot write: sign-in, sign-out, set and reset password, change password, authenticator enrolment and verification; the lockout, Turnstile and audit rules (built in slice 2) run in Better Auth hooks; the before hook finds the person behind a request (the session, the pending second factor, or the set-password link while it is still unused) and the after hook writes the event with the request's address and browser, keyed by the request headers both hooks share;
- slice 1b: `auth.mobile.token`, `auth.mobile.refresh`, `auth.mobile.revoke` (with the field app), `realtime.token.issue` (built: a registered command that writes one audit row for each token the route signs) and `admin.user.two_factor.reset` from review 3;
- slice 1b part 1 (migrations 0038 and 0039): `admin.user.two_factor.reset`, `admin.users.write` at `all`, never the caller's own account; it removes the authenticator app through the definer `app.reset_two_factor()`, revokes every session with reason `totp_reset`, writes one audit row and the event `admin.user.two_factor_reset`, and the server action emails the user; a user whose role requires the app enrols a new one at the next sign-in;
- the user set the order of the rest on 2026-09-27: part 2 is the Realtime spike (§2.5) with the shared ES256 key signed through `jose`, on a hosted Supabase dev project; part 3 is the mobile tokens (§2.4) and the Redis front for idempotency keys, built when the field app work starts in Phase 4, with their contracts in weeks 7 and 8.

## 3. Audit log (week 3)

### 3.1 Table
Built (slice 2, migrations 0032 and 0033). `audit_logs`, partitioned by month on `created_at` with the key `(id, created_at)`, append-only. The partitions live in the schema `audit_partitions`, which no request role may use, so no row is reachable around the policies on the parent; a default partition takes any row whose month has no partition, so a missing partition never fails a command. `app.ensure_audit_partitions(3)` (migrator only) makes this month and the next three, and pg_cron runs it on the 25th (job `audit-logs-partitions`); `app.detach_audit_partitions()` (P1, [phase1.md §5.2](phase1.md#52-p1-observability-and-workers)) detaches partitions past retention, with the runs logged in `retention_runs`. The columns:

`id`, `entity_id` (null for cross-entity admin commands), `actor_principal_id`, `actor_kind` (`user`, `agent`, `voice_session`), `on_behalf_of_user_id` (set when a voice session acts for a user), `command`, `aggregate_type`, `aggregate_id`, `outcome` (`ok`, `denied`, `failed`), `error_code`, `input_json`, `before_json`, `after_json`, `ip`, `device`, `request_id`, `created_at`.

Grants: `app_user` may insert (policy: `actor_principal_id = app.user_id()`, an entity in the request scope or none, never an `auth.*` event) and select with `audit.read` at entity scope (`entity_id` null rows need `audit.read:all`, and an empty scope reads nothing). `auth_service` may insert `auth.*` events of no entity and read nothing. `actor_principal_id` may be null only on an `auth.*` event (a failed sign-in for an unknown address). No update or delete; `app.raise_append_only()` trigger.

### 3.2 What the runner writes
`runCommand` requires an `AuditSink`; `executeCommand` passes `databaseAuditSink`, which writes through `ctx.tx`, so the audit row commits with the change or not at all. The web actions pass the caller's address and browser as `client`:
- one row per changed aggregate with `outcome = ok`, or one row for the call when the handler names none; `entity_id` is the aggregate's entity, or the request's single entity when the handler leaves it out;
- one row with `outcome = denied` when the permission guard, the request scope or a row policy refuses (written by `executeCommand` in its own short transaction after the rollback);
- one row with `outcome = failed` and the `DomainError` code when the handler, the DTO check or the audit and outbox writes throw (written after the rollback in its own transaction, without before/after);
- nothing for input that does not parse, since nothing ran; a failure to write a denied or failed row is logged and never replaces the original error.
- `before_json` and `after_json` come from the handler through `ctx.audit({ aggregateType, aggregateId, before, after })`; commands that touch several aggregates call it once per aggregate.

### 3.3 Redaction
`redactAuthEvent()` records an allow-list of fields per auth event (the email, the sign-in step, the second-factor method), so the one-time `code`, the password and the link token are never read; `redactForAudit()` applies a deny-by-pattern pass to command input and before/after (AUDIT M16), built from the real column and body names: `password`, `secret`, `backup_codes`, `token`, `identifier`, `newPassword`, `currentPassword`, `bank_json`, `api_key`, the identity-number fields `aadhaar`, `aadhaar_number`, `uid`, `pan`, `pan_number`, `account_number`, `bank_account_number`, `ifsc` and `ifsc_code` (compared without case or separators), and any name containing password, secret, token, api key or backup code are removed at any depth; a value in an id or code field (`isCodeKey()`: ids, `code`, `sku`, `hsn`, `gstin`, `pin`, `barcode` and the named document numbers) is kept whole only when it also has a code's shape and holds no Aadhaar-like or phone-like run (`keepsAsCode()`), since input that failed to parse is recorded too; every other text value is scrubbed as a log line is, and a number of ten digits or more given as a number is hidden unless its field holds a time or an amount (`isMeasureKey()`: `*At`, `exp`, `iat`, `expires`, `*Paise`, `*Amount`, `*Total`); phone numbers and emails keep only the last four characters; `input_json` is the parsed command input after the same pass. Aadhaar never exists in any table (BLUEPRINT §7.5), so nothing about it can reach the audit. The suite asserts the deny list on a synthetic before/after that contains every listed field.

### 3.4 Reading
`queryAudit(ctx, { entityId?, aggregateType?, aggregateId?, actorPrincipalId?, command?, outcome?, from, to, cursor?, limit? })` (built; server action `listAuditLog`) with keyset pagination on `(created_at, id)` (text-form cursor, as in `listLeads`); the window is required and at most 93 days, so only its months' partitions are read. The Admin audit screen is built at `/admin/activity`. Views of sensitive documents (Phase 1) and exports are recorded through the same runner path as commands with an empty change set.

## 4. Outbox, publisher and workers (week 3)

### 4.1 Table
Built (slice 3, migrations 0034 and 0035; backoff, lease and retention in 0053 and 0054). `outbox_events`, append-only for `app_user`: `id` (UUIDv7), `sequence` (identity, ordering key), `entity_id`, `type`, `aggregate_type`, `aggregate_id`, `payload_json` (with `v: 1`), `created_at`, `published_at`, `attempts`, `last_error`, `dead_lettered_at`, `next_attempt_at` (when a failed event is due again after its backoff) and `claimed_until` (the lease of the publisher run sending it). Partial indexes `outbox_events_pending_idx` on `sequence` where `published_at is null and dead_lettered_at is null`, and `outbox_events_dead_letters_idx` on `dead_lettered_at` where it is set. Column names follow ADR 0005, DATABASE §6.10 and ARCHITECTURE §6.

Append-only reconciled with delivery bookkeeping: a second role `outbox_publisher` (login, `nobypassrls`) holds `select` and column-level `update (published_at, attempts, last_error, dead_lettered_at, next_attempt_at, claimed_until)` on the table, with its own policies `outbox_events_publisher_read` and `outbox_events_publisher_update` (`to outbox_publisher using (true)`, since the table forces RLS and has no request context on that connection); the append-only trigger raises on any update that changes another column, and on every delete except the retention purge: the procedure `app.purge_outbox_events()`, which the pg_cron job `outbox-events-purge` runs daily at 02:45 UTC as the table owner (`call app.purge_outbox_events()`), records its run in `retention_runs` and commits, sets `app.outbox_retention = 'purge'` and deletes events published more than 30 days ago, never a pending or dead-lettered one; a failure is recorded on the run, committed and raised, so pg_cron reports the run failed (0059). A dead letter changes only by a replay, which the trigger accepts only as the owner of `app.replay_dead_letter()` (§4.4). `app_user` inserts only. The same pattern serves `webhook_inbox.processed_at` and `error` for the webhook worker in Phase 2.

### 4.2 Publisher
Built (slice 3, migrations 0034 and 0035). A route `POST /api/v1/workers/outbox/publish`, connected as `outbox_publisher`, nudged immediately after each command commits (`executeCommand`'s `onCommitted`: the server action publishes a QStash message to the same route; failures of the nudge are logged and harmless) and triggered by a QStash schedule every minute (`pnpm --filter web qstash-schedule`; QStash schedules are minute-granular). Without QStash (local development and CI) the nudge runs the publisher in the same process and nothing is sent. Each run has three steps, so no transaction stays open while the queue is called.
- **Lease:** one short statement takes up to 100 due rows (`published_at` and `dead_lettered_at` null, `next_attempt_at` null or past, `claimed_until` null or past) in `sequence` order `for update skip locked`, dead-letters those that have already had ten attempts (`last_error = 'no_outcome'`), counts one attempt on each of the others, sets their `claimed_until` two minutes ahead and commits.
- **Publish:** with no transaction open, one QStash batch call (answered or abandoned within 5 seconds) sends each event to the URL group `evt-<type>` with `Upstash-Deduplication-Id = id` and the payload `{ id, sequence, type, entityId, aggregateType, aggregateId, payload }`.
- **Record:** a second short transaction writes each outcome, only on rows still under this run's lease: success sets `published_at`; a failure keeps the attempt the lease counted, stores `last_error` and sets `next_attempt_at` 1, 2, 4, 8, 16 or 32 minutes ahead, then an hour for each later failure, each wait moved by up to a fifth either way and never past an hour, so the hourly waits only shorten, to between 48 and 60 minutes (`packages/domain/src/outbox/backoff.ts`), and the tenth attempt comes about four hours after the first; the tenth failure sets `dead_lettered_at`.
  - A row the delivery gave no outcome is released at once and its attempt given back, and so is every row of the run when the delivery throws; only the rows of a run that dies before it records anything wait for its lease to run out, with that attempt used, so an event whose runs keep dying is dead-lettered by a later lease, which answers its id: the run counts it in `deadLettered` and logs `outbox.no_outcome_dead_lettered` with the run's request id, the count and at most 20 of the ids.
- The route's `maxDuration` of 60 seconds keeps a live run inside its lease.
- An event type no worker listens to yet (`subscribed: false` in the catalogue) is marked published without being sent, because a URL group with no endpoint refuses messages; a row that does not fit the catalogue is dead-lettered at once.
- Metrics: every run logs its counts; `/api/v1/health/ready` turns down (its `health.not_ready` log line names `outbox`) only when a due event has waited more than five minutes since it became due, which means no publisher is running, while events waiting out their backoff and dead letters are logged as `outbox.backlog`; dead-letter alerts go to Sentry (P1, [phase1.md §5.2](phase1.md#52-p1-observability-and-workers)).

Ordering: QStash does not order across messages. Consumers that care (state notifications, agents) keep the last processed `sequence` per aggregate in Redis and drop older events. Idempotency: each event worker checks `evt:{id}` in Redis (TTL 7 days) before running and sets it after; the check is in `apps/web/src/workers/events` (P1, [phase1.md §5.2](phase1.md#52-p1-observability-and-workers)).

### 4.3 Event catalogue
`packages/contracts/src/events/`: names are `<aggregate>.<verb_past>` (`crm.lead.created`, `pricing.price.changed`, `org.entity.updated`, `auth.session.revoked`, `imports.job.committed`; later phases add types such as `sales.quote.sent` and `sales.order.confirmed` with their commands), each with a Zod payload schema and `v: 1`. `ctx.emit()` validates against the catalogue at emit time; an unknown type is an `internal` error in tests and CI.

### 4.4 Workers
`/api/v1/workers/*` per API §3.6: verify the QStash signature with the current and next keys, check the event id, run the command as the right principal (a named agent principal or the system principal `system:workers` with the permissions the job needs, never a cost permission), return 200 or a retryable 5xx. Dead letters and replay on the Integration Health page (`integrations.dlq.replay`, `admin.integrations.write`). The `system:workers` principal and the workers' event-id check in Redis are built (P1, [phase1.md §5.2](phase1.md#52-p1-observability-and-workers)); the worker routes are listed in [06-api.md §3.6](../06-api.md).

Built (2026-09-28, branch `feat/week5-commands`, migration 0044): the command `integrations.dlq.replay` (Executive, both permissions at scope all) calls the definer `app.replay_dead_letter()`, which checks `integrations.dlq.replay:all` in its body and resets `dead_lettered_at`, `attempts`, `last_error`, `next_attempt_at` and `claimed_until` on one dead-lettered row, so it is due at once, the one change the append-only trigger allows on a dead letter, and only when it runs as the owner of `app.replay_dead_letter()` with `app.dlq_replay` naming the event (0059); an event that is not dead-lettered answers `conflict` (`not_dead_lettered`), an unknown one or one of a company outside the request answers `not_found` (`dead_letter_missing`); one audit row with no company; the server action `replayDeadLetter` answers the result envelope. The Integration Health page and its route are built in P1 ([phase1.md §5.2](phase1.md#52-p1-observability-and-workers)).

## 5. Idempotency keys (week 3)

Built (slice 4, migrations 0036 and 0037), in one transaction: `idempotency_keys(principal_id, key, command, input_hash, response_json, created_at, expires_at)`, primary key `(principal_id, key)`, each caller reading and writing its own keys only, purged daily by pg_cron after 7 days. The runner claims the key after the guard and before the handler, inside the command's transaction, and stores the DTO there: a repeat with the same command and input hash (SHA-256 of the canonical parsed input) replays the stored answer with no audit row or event; other input answers `conflict` with reason `idempotency_mismatch`; a concurrent repeat waits on the row and replays, or answers `concurrent_change` past the lock timeout; a refused or failed call leaves no key, so a retry runs again. Keeping the claim and the answer in the command's own transaction needs no status column and leaves no key behind a crashed call. API §1 requires an `Idempotency-Key` on mobile and connector calls, and FLD-02 allows five days offline, so the store is Postgres; Redis in front arrives with the mobile API in Phase 4. The runner takes `idempotencyKey` in `RunOptions`; web server actions take the form's key, one per form submission, as their optional second argument; ingest uses the provider event id.

## 6. Tax engine (week 5)

Full decision record in ADR 0007. Summary of the engine surface in `packages/domain/src/tax`:

| Function | Input | Output |
|---|---|---|
| `resolveRate(rates, { hsn, itemId, on })` | effective-dated rows, document date (IST) | the row (`tax_rate_id`, `rate_pct`) or `validation_failed` reason `tax_rate_missing` |
| `placeOfSupply({ siteStateCode, accountGstin, entityStateCode })` | | `{ stateCode, kind: 'intra' \| 'inter' }` |
| `compositeSplit(rule, taxablePaise)` | effective rule, taxable value | goods and services parts with their rates |
| `computeLine({ qty, unitPrice, rate, composite?, supply })` | | `taxable_value`, `goods_taxable`, `services_taxable`, `cgst`, `sgst`, `igst`, `line_total`, ids |
| `computeDocument(lines)` | computed lines | subtotal, tax totals, `round_off`, grand total |

Rules: integer paise inside; half-up rounding to the paisa per line and per tax amount; CGST and SGST rounded independently from the half rate; document total rounded to the rupee with `round_off`; item rate overrides HSN rate; composite supply only for lines flagged as works contract in `residential_rooftop` and `commercial_epc` with an effective rule; every line snapshots `tax_rate_id` and `composite_rule_id`. Place of supply: site state, else account GSTIN state, else entity state, which needs `customer_sites.state_code` and `accounts.billing_state_code` (DATABASE §6.2). The CA confirms the method at the workshop against a golden set of worked examples that becomes the fixture file.

Built (2026-09-27, branch `feat/tax-and-machines`): the engine in `packages/domain/src/tax` with its boundary shapes in `packages/contracts/src/tax/engine.ts`, integer paise in `packages/domain/src/money/paise.ts`, fixture tables in `tax.test.ts` and the golden set in `golden.test.ts`, which awaits the CA (§11 q1); the defaults the workshop may change live in `packages/domain/src/workshop-defaults.ts` only; the quote commands (S1, [phase1.md §7.3](phase1.md#73-s1-quotes)) load the rows and call the engine.

Built (2026-09-28, branch `feat/week5-commands`, migrations 0043 and 0044): `tax.rate.set` and `tax.composite.set` (`tax.rates.write`, Accounts and Executive) record a rate or a goods and services split from a date, end the open row before it, refuse an overlapping period (`tax_rate_overlap`, `composite_rule_overlap`) and shares that do not add up to 100, and are audited for no one company; `customer_sites.state_code` and `accounts.billing_state_code` hold the two-digit GST state codes for place of supply; server actions in `apps/web/src/actions/tax.ts`.

## 7. State machines (week 5 specifications and runtime)

### 7.1 Runtime
`packages/domain/src/state-machines/define-machine.ts`: `defineMachine({ name, states, initial, transitions: [{ from, event, to, permission, guard?, effects? }] })` and `transition(machine, record, event, ctx)` which checks the permission through `checkPermission`, runs the guard (pure, may use preloaded data), returns `{ to, effects }`; the command persists `state` and `state_changed_at`, applies effects, calls `ctx.audit()` and emits `<aggregate>.<event>`. Illegal transitions answer `conflict` with reason `<machine>_transition_not_allowed`. Machines are data and are rendered into the state-machine specification documents for review.

### 7.2 Opportunity
States: `open`, `nurture`, `won`, `lost`. Stage moves happen inside `open`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `stage.move` | open → open | `crm.lead.write` | stage exit rules of the current stage satisfied (`stage_exit_rules_json`: required fields present); target stage belongs to the pipeline | update `stage_id`; if the target stage is `qualified`, request the handover in the event |
| `assign` | open → open | `crm.lead.assign` | `locked_until` in the past, or caller holds `crm.lead.assign:team` or wider; the new owner is active and holds a role in the lead's company that works on leads (`app.user_is_active()`, 0059) | set `owner_id`, `team_id`, `locked_until = now + lock period` (default 48 h, configurable per pipeline); the customer relationship in that company moves to the new owner when the previous owner held it (`app.hand_over_customer()`, one `account_entity` audit row), except when an agent hands the lead over, which never moves the relationship (0059); the previous owner keeps reading the customer through any lead they still hold |
| `nurture` | open → nurture | `crm.lead.write` | reason given | create the nurture follow-up tasks (follow-up tasks, with no Workflow engine, [phase1.md §2](phase1.md#2-decisions-taken-with-the-owner-on-29-09-2026)) |
| `reopen` | nurture, lost → open | `crm.lead.write` | lost within the last 30 days for `lost` | stage = first open stage |
| `win` | open → won | `crm.lead.write` | an accepted quote or a confirmed order references the opportunity | none |
| `lose` | open, nurture → lost | `crm.lead.write` | reason code given | none |

Handover on `qualified`: `crm.opportunity.stage.move` requests it with `handover: true` in the `crm.opportunity.stage_moved` event, and the worker that runs it is T2's ([phase1.md §8.2](phase1.md#82-t2-handover)). The worker is a weighted round-robin over Lead Converters of the entity by presence, capacity and language and segment skills (TEL-02), assignment within 10 s, lock as above. A repeat enquiry with the same intent within 30 days attaches to the open opportunity (CRM-03) in `crm.lead.create` (D1, [phase1.md §7.4](phase1.md#74-d1-duplicates)).

### 7.3 Quote
States: `draft`, `sent`, `accepted`, `expired`, `superseded`, `withdrawn`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `create` | → draft | `sales.quote.create` | the customer's own price tier (the map from customer type is empty until PRICE-1); a current price list for the tier and entity; sizing complete for pump and rooftop segments; pump-curve bounds; DCR rule | lines priced from the list, tax computed, `valid_until = created date + 15 calendar days, end of day IST`, `quote_no` from the series |
| `send` | draft → sent | `sales.quote.send` | PDF rendered; `now ≤ valid_until` | WhatsApp dispatch, event |
| `accept` | sent → accepted | system or `sales.quote.send` | `now ≤ valid_until`, `accepted_via` recorded (WhatsApp reply, OTP, signed upload) | create sales order draft |
| `expire` | draft, sent → expired | system | `now > valid_until` | daily job plus lazy check on read |
| `requote` | draft, sent, expired → superseded | `sales.quote.create` | | new quote with current prices, `quote_versions` snapshot of the old |
| `withdraw` | draft, sent → withdrawn | `sales.quote.send` | reason | |

Acceptance after expiry answers `conflict` reason `quote_expired` and the app offers re-quote (SAL-05). Prices on lines are never accepted from input (SAL-03).

### 7.4 Sales order
States: `draft`, `confirmed`, `partially_dispatched`, `dispatched`, `invoiced`, `closed`, `cancelled`.

| Event | From → To | Permission | Guard | Effects |
|---|---|---|---|---|
| `create` | → draft | `sales.order.create` | from an accepted quote, or a dealer account without a quote | lines copied with their tax snapshot; `so_no` from the series |
| `confirm` | draft → confirmed | `sales.order.confirm` | credit check for dealer accounts: block when outstanding + confirmed-unpaid orders + this order > `credit_limit`, or `oldest_overdue_days > credit_days`; the block names the limit or the invoice; bypass only with `credit_release_by` set by an Executive with a reason (audited) | reservations requested (Phase 3), event |
| `dispatch.partial`, `dispatch.complete` | confirmed → partially_dispatched → dispatched | driven by the dispatch machine (Phase 3) | e-way bill gate | |
| `invoice` | dispatched → invoiced | Tally sync (Phase 5) | voucher linked | |
| `close` | invoiced → closed | `sales.order.confirm` | payments settled | |
| `cancel` | draft, confirmed → cancelled | `sales.order.cancel` | reason; nothing dispatched | release reservations |

Exposure is per entity (`dealer_outstanding` is keyed by account and entity). Until Tally sync, outstanding is entered manually (Phase 1 note in the blueprint).

Built (2026-09-27, branch `feat/tax-and-machines`): the runtime in `packages/domain/src/state-machines/define-machine.ts`; the machines of BLUEPRINT §19 item 2 (listed in [state-machines/README.md](../state-machines/README.md)) as data in `packages/domain/src/state-machines/machines` (opportunity, quote and sales order as §7.2 to §7.4, plus a proposed `credit.release` event that sets `credit_release_by`; the others with every state or event the documents do not name marked proposed); the dealer credit check in `packages/domain/src/sales/credit-check.ts`; the specifications generated into `docs/state-machines/` by `pnpm --filter @shakti/domain machines:docs` and checked for staleness by a unit test. The quote tables and commands are S1's and the sales order's are S2's ([phase1.md §7.3 and §8.3](phase1.md)).

Built (2026-09-28, branch `feat/week5-commands`, migrations 0043 and 0044): `nurture` in the `opportunities.state` check and `OpportunityStateSchema`, `opportunities.state_changed_at` and `pipelines.lock_hours` (default 48); the six opportunity commands `crm.opportunity.stage.move`, `assign`, `nurture`, `reopen`, `win` and `lose` run every change through the opportunity machine, record `state_changed_at`, audit and emit `crm.opportunity.*`, with server actions in `apps/web/src/actions/crm.ts`; `win` answers `conflict` (`win_needs_order`) until orders exist (S2); the warranty and expense machines use the catalogue permissions `inventory.warranty.write`, `finance.expense.submit` and `finance.expense.verify`.

## 8. Import framework (week 5)

- Tables: `import_mapping_templates(id, kind, name, mapping_json, created_by)`; `import_jobs(id, entity_id, kind (`leads`, `accounts`, `items`, `tally_masters`), file_id, template_id, mapping_json, state (`uploaded`, `mapped`, `previewed`, `committing`, `committed`, `rolled_back`, `failed`), total_rows, valid_rows, committed_rows, batch_count, created_by)`; `import_rows(job_id, row_no, raw_json, normalised_json, errors_json, dedupe_json, state (`pending`, `valid`, `invalid`, `committed`, `skipped`, `rolled_back`), created_type, created_id, committed_batch)`.
- Flow: upload through the pre-signed file path → mapping (saved templates) → validation preview through the same Zod inputs the commands use, with dedupe suggestions by phone and name → commit as a QStash worker in batches of 500 rows, each batch one transaction of commands with idempotency key `import:{job}:{row}`, numbered from `import_jobs.batch_count` (0058); a failed batch rolls back whole and the job stops at that batch (IMP-01), while a row whose number belongs to a customer a colleague looks after is marked invalid (`customer_held_by_colleague`) and the batch goes on (0055) → rollback archives every `created_id` of the job in reverse order (masters and leads only in Phase 0 and 1; ledgers are not import targets).
- Performance target 50k rows in 5 minutes, met locally by one worker running a job's batches one after another (`docs/04-architecture-appendix/import-scale.md`); the hosted stack's measure is still to take ([phase1.md §6.3](phase1.md#63-p2b-imports-upgrade)), and concurrent batch workers are built only if it misses the target. One audit row per batch with the row range, per-row audit only for rows that changed existing records.
- Permission `imports.write` (Executive all, GM entity); every job is audited with counts and filter like exports.

Built (2026-09-27, branch `feat/imports`, migrations 0040 to 0042):
- the four tables with fail-closed RLS on `imports.write`; `imports.job.create`, `map`, `preview`, `commit`, `commit_batch` and `rollback` with the job state table;
- the CSV and XLSX parser (papaparse, exceljs) with header detection and the limits in `IMPORT_LIMITS`; a workbook's ZIP directory is checked by `checkZipArchive` (`packages/domain/src/imports/zip-guard.ts`) before the reader unpacks it: at most 100 MB unpacked over all its parts, at most 100 times its packed size for a part over 1 MB unpacked, at most 32 MB for the shared strings and 5 MB for each of the workbook's own small parts, and a ZIP64, damaged or otherwise unusual directory refused;
- lead rows validated through the `crm.lead.create` input, with dedupe suggestions by phone and by name and village;
- each batch committed set-based inside `ctx.savepoint()` (`commitLeadBatch` in `packages/domain/src/imports/commit-leads.ts`: the rows `crm.lead.create` would make, in a few multi-row statements, each row claiming the key `import:{job}:{row}`);
- row by row through `ctx.run(createLead)` with the same keys when the batch holds anything but plain new leads or the database refuses a row, the savepoint dropping the batch's rows, audit changes and events when a row fails; the measured numbers in `docs/04-architecture-appendix/import-scale.md`;
- one audit row per batch with the job, row range and counts (and `refusedRows` when a row whose number belongs to a colleague's customer is marked invalid with `customer_held_by_colleague` while the rest of the batch goes on, 0055), and none per lead;
- the server actions in `apps/web/src/actions/imports.ts` answering the result envelope, and the worker route `POST /api/v1/workers/imports/commit` (API §3.6);
- rollback archives the leads and leaves the customers in the shared master (ADR 0008).

Deviations from the design above:
- batches of one job run one after another (the job row is locked per batch), not as concurrent workers; each QStash call starts batches for 30 seconds (`IMPORT_RUN_BUDGET_MS`), and each batch keeps to 20 seconds from its start, a wait for the job's row included (`IMPORT_BATCH_BUDGET_MS`);
- a batch's set-based try has one deadline across its statements, `ROW_BY_ROW_SLICE_MS` (3 seconds) before the batch's 20, each statement's time limit being the time left (docs/03-roadmap-appendix/phase1.md §6.3); when the try is given up or not made, a row-by-row slice stops between rows after 3 seconds or once the batch's time is spent, doing at least one row, and keeps the rows done as that batch;
- no number lock on either path (`crm.lead.create` leaves its lock out for a row an import batch runs), so the lead form never waits on an import and batches of different jobs never wait on each other, while batches of one job still take turns on the job row; an import committing a brand-new number at the same moment as a form or another import can make a second customer, which the duplicate cards (D1, CRM-03) catch;
- each statement of a set-based try is cut off at the budget left (`statement_timeout`, at least one second), after which the batch goes row by row; a lock wait that runs out or a statement cut off anywhere else commits nothing of the batch, fails nothing, and the route answers a retryable `503` logged as a warning;
- the log line `imports.batch_row_by_row` records the request id and why the batch went row by row (a fixed reason or code, never a value from the file); a new message, whose deduplication id names the job and its committed rows, carries the rest of the job; locally four batches run per call, with the rest carried on in the dev server.

Resolved by P2b ([phase1.md §6.3](phase1.md#63-p2b-imports-upgrade)):
- the kinds `accounts` and `pin_codes` import beside leads;
- the file arrives by the pre-signed upload and the S3 store, so no server action takes it as a form;
- the job reads the `ready` file back from the store; a failed read answers `integration_unavailable` with `import_store_failed` and records nothing, and the same file's content cannot start a second job in a company.

Not built: the import kinds `items` (Phase 3) and `tally_masters` (Phase 5); the import measured on the dev deployment (§8, import-scale.md).

## 9. Command list for weeks 3 to 5

A record of the plan of 27-09-2026; the commands built are named in the "Built" note below and in [ARCHITECTURE](../04-architecture.md).

Week 3: the eleven auth and admin commands in §2.6 (five built in slice 1, `admin.user.lock.clear` built with the final audit, `admin.user.two_factor.reset` built in slice 1b part 1, `realtime.token.issue` built, and `auth.mobile.token`, `auth.mobile.refresh` and `auth.mobile.revoke` with the field app); `integrations.dlq.replay`. The audit read and the publisher are not commands: the audit read is the query `queryAudit`, and the publisher is `runOutboxPublisher` behind the worker route `POST /api/v1/workers/outbox/publish`.
Week 5: `tax.rate.set`, `tax.composite.set` (Accounts); `crm.opportunity.stage.move`, `crm.opportunity.assign`, `crm.opportunity.nurture`, `crm.opportunity.reopen`, `crm.opportunity.win`, `crm.opportunity.lose`; `sales.quote.create`, `sales.quote.send`, `sales.quote.accept`, `sales.quote.requote`, `sales.quote.withdraw`; `sales.order.create`, `sales.order.confirm`, `sales.order.cancel`; `imports.job.create`, `imports.job.map`, `imports.job.preview`, `imports.job.commit`, `imports.job.commit_batch`, `imports.job.rollback`.

Every command follows the existing pattern: strict input and DTO in contracts, `defineCommand`, registry entry, tests for denied, wrong entity and happy path, server action.

Built (2026-09-28, branch `feat/week5-commands`): `integrations.dlq.replay` (§4.4), `tax.rate.set` and `tax.composite.set` (§6), and the six `crm.opportunity.*` commands (§7.2); the import commands (§8) on `feat/imports`. The quote commands are S1's (`sales.quote.create`, `send`, `requote`, `withdraw`) and the sales order commands and `sales.quote.accept` are S2's ([phase1.md §7.3 and §8.3](phase1.md)).

## 10. Test plan

- Security suite: every new table in `SHARED_TABLES` or `ENTITY_TABLES` (an entity table also with its fixture rows in `entity-matrix-fixture.ts` and its read rule in `role-entity-matrix.test.ts`), or, outside the generic loops, in `AUTH_TABLES`, `OUTBOX_TABLES`, `PRINCIPAL_TABLES` or `PLATFORM_TABLES` with its own test file; `auth_service` and `outbox_publisher` cannot read business tables; `app_user` cannot see `user_two_factor` and its backup codes, nor `mobile_devices` once it exists (Phase 4); audit insert only by the actor; audit read by `audit.read` scope; outbox append-only for `app_user` and column-limited for the publisher; idempotency replay and mismatch; principal resolution for mixed roles, suspended users and revoked sessions.
- Domain unit tests: lockout schedule, session timeouts, refresh reuse detection, redaction deny list, tax engine fixture tables and golden set, every state-machine transition and every illegal one, credit check cases (limit, overdue, release), import validation and batch rollback.
- Spike notes: Realtime JWT with latency and pass or fail.

## 11. Open questions for the discovery workshop

Each is asked in the workshop pack under the ID in brackets ([workshop-pack.md](../13-client-packs/workshop-pack.md)).

1. CA: place of supply rule and rounding method in §6 (ADR 0007), plus the golden examples (PRICE-5).
2. Handover lock period per pipeline (default 48 h) and the nurture cadence (CALL-4, CALL-5).
3. Whether dealer exposure counts confirmed but undispatched orders (this design says yes) (SALE-5).
4. TOTP for the General Manager when the GM role is held only at one small entity (this design: still mandatory) (ACC-1).
5. Numbering format for quotes, orders, proformas and challans (one function to change) (SALE-1).
