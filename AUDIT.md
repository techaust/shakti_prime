# Shakti Prime BOS — production-readiness audit

Date: 2026-09-27 · Commit audited: `87b3536` (`main`); line references are to that commit · Scope: everything built to date (Phase 0, weeks 1–3 slice 1): `packages/db`, `packages/domain`, `packages/contracts`, `packages/tokens`, `apps/web`, `tools/copy-lint`, CI and every document.

## 1. Executive summary

**Verdict: a strong foundation that is not yet production-ready.** The parts that are hardest to retrofit are genuinely good. Forced, fail-closed RLS covers all 35 tables. The cost gate holds. The command runner validates, guards, translates database errors and returns strict DTOs. Authentication uses Argon2id, a `__Host-` cookie, mandatory TOTP and revocation enforced on every route. CI runs a real-Postgres security suite of 376 tests, an env-free production build and a full-history secret scan. No auditor could break entity isolation as `app_user` through a normal code path.

What stands between this code and production:

1. **One critical defect that only production would hit.** The Upstash adapter turns every cached JSON value into `"[object Object]"`. The day Upstash is configured (production requires it), every signed-in page crashes on a principal-cache hit and the sign-in lockout silently switches off. The tests use the in-memory store, so all 376 pass (C1).
2. **Two high defects on real paths.** A revoked or expired session cookie locks a user out of sign-in until the cookie expires, which every daily user reaches after 7 days (H1). A role at `all` scope held in one company acts group-wide on users, sessions and shared price lists (H2).
3. **The CRM read path collapses at realistic volume.** The lead list takes 6.6 s at 12k leads and passes the 30 s statement timeout at 50k; a name search takes 12.2 s over 50k contacts (M31–M33). The PRD volume (2,000+ leads a day) reaches this in the first weeks. It must be fixed before the lead list ships.
4. **Error handling and observability are close to absent.** There is no logger and no error pages, failures are swallowed into a generic sentence, and a database outage looks like being signed out (M35–M38).
5. **Pre-hosting gaps.**
   - Supabase's API roles hold full grants on every table (M1).
   - Database connections do not require TLS (M11).
   - The production config guard accepts the sample secret and Cloudflare's always-pass keys (M8).
   - The only allowed hosted mailer prints set-password links to the logs (M9).
   - CI reports but cannot block `main` (M45).
6. **Test trust.**
   - CI turns red on the first push after 2026-09-28 10:01 UTC because of a hard-coded test clock (M39).
   - RLS coverage depends on hand-kept table lists that nothing checks (H3).

108 findings in total: 1 critical, 3 high, 53 medium, 51 low. Most fixes are small: 86 of the 108 are effort S (under half a day), 20 are M and 2 are L. The plan in §6 groups them into 15 batches, critical first.

## 2. How the audit was run

| Step         | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline     | `pnpm lint`, `format:check`, `copy-lint`, `typecheck`: pass. Unit tests: 125 pass. Production build with no `.env`: pass (9 routes). Security suite on the Supabase Postgres 17 image: 376 pass (db 329, domain 37, web 10). Drizzle schema vs migration snapshots: no drift. `pnpm audit`: 1 moderate (esbuild through `better-auth → drizzle-kit`, dev-only in practice). Hosted services: none provisioned (Supabase, Vercel and Upstash listings are empty). |
| Review       | 11 read-only auditors, one per dimension: database access control, data layer and query plans, domain correctness and invariants, testing, documentation vs code, authentication and supply chain, web app, architecture and code quality, observability and performance, DevOps, UX and accessibility. Database claims were reproduced live as `app_user` inside rolled-back transactions; query plans were measured with synthetic volume.                     |
| Verification | Every finding was re-checked by an independent skeptic told to refute it. Critical and high findings got a second skeptic focused on reachability and compensating controls, and a tie-breaker when the two disagreed. 179 raw findings: 177 confirmed, 2 refuted; severities were lowered on 32 and raised on 2. Duplicates across auditors were then merged into the 108 findings below.                                                                       |
| Lead checks  | I re-verified the critical defect against the `@upstash/redis` 1.39 source and the test time bomb by arithmetic. I ran a live UI pass (Playwright signed-out; the browser pane signed-in, read-only) in both themes and at 375 px.                                                                                                                                                                                                                               |
| Not covered  | Hosted infrastructure (none exists), load tests beyond `EXPLAIN ANALYZE` on synthetic data, a penetration test of a deployed system, the field app, connector and voice agent (not built).                                                                                                                                                                                                                                                                       |

Refuted during the audit, so not listed below:

- TOTP brute force through the in-process server actions (Better Auth 1.7.6 locks the account after 10 failed codes inside the handler, and the schema has the columns).
- A request for a `defineQuery` layer (a design note for Phase 1, not a defect).
- A style-only split of `create-auth.ts`.

## 3. Scores per area

| Area                             | Score | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness                      | 5/10  | The runner, numbering, keyset paging and principal resolution are careful and tested. But C1 breaks every signed-in page in production, H1 locks weekly users out, and several flows dead-end: an expired invite cannot be re-sent, a known customer cannot be attached when a colleague owns the relationship, and leads written in "All companies" lose their team.                                                                                                              |
| Security                         | 6/10  | Isolation is strong: forced RLS, fail-closed helpers, enum-validated grants, column-level grants on identity secrets, a separate `auth_service` role, and a cost gate tested from several directions. It is held back by C1 (lockout silently off), H2 (cross-company admin), Supabase role grants, definer `search_path`, staff PII readable by agents, TOTP replay, plaintext reset tokens, a presence-only config guard, links and SQL parameters in logs, and no database TLS. |
| Architecture                     | 7/10  | The dependency direction is clean, there is one command layer with declared guards, strict DTOs, ports for key-value and mail, and a thoughtful shared-customer model (ADR 0008). The weakness is that the absolute rules are conventions: the lint fences can be bypassed, `withRequestContext` is exported to every workspace, enums are typed twice, and the registry is unused.                                                                                                |
| Data layer                       | 6/10  | Types and constraints are disciplined: numeric money, timestamptz, text-plus-CHECK enums, gist exclusions on tax rates, gapless numbering proven under contention. But the evidence ledgers are weak (consents editable, price history forgeable and racy), price lists can overlap, accounts can have several owners, seeds overwrite admin edits, and the migrator skips out-of-order files silently.                                                                            |
| Testing                          | 6/10  | The security suite on real Postgres is well above average for this stage. Against that: over-mocking the key-value store hid C1, a hard-coded clock breaks CI tomorrow, coverage depends on hand-kept lists, privilege-table write policies and server actions are untested, and there is no coverage measurement.                                                                                                                                                                 |
| Performance                      | 5/10  | The client side is lean: route chunks of 4–14 KB and no heavy client modules. The database pool settings suit Supavisor. The CRM read path does not scale (per-row security-definer calls, plan flips, unused own/team indexes), and each page resolves the session twice with about 12 auth queries.                                                                                                                                                                              |
| Error handling and observability | 3/10  | Error codes and catalogue keys are well designed, but there is no logger, no `onRequestError`, no error boundaries and no reference number. Unexpected failures become a silent generic sentence, an outage looks like a sign-out, and readiness ignores Upstash and the auth connection.                                                                                                                                                                                          |
| Code quality                     | 7/10  | Strict TypeScript everywhere, almost no escape hatches, small modules and useful comments. It is marked down for C1 (an untyped adapter coercing with `String()`), untyped message keys, free-string error reasons, duplicated magic values and inputs parsed twice.                                                                                                                                                                                                               |
| UX / UI                          | 5/10  | Good bones: labelled fields, `aria-invalid` and `aria-describedby`, token-only colours, no theme flash, correct autocomplete. But the 14 px root shrinks every control, input borders sit at 1.5:1, there are no error or 404 pages, focus is lost after submit, the email clears on a failed sign-in, every page has the same title, and several screens are dead ends.                                                                                                           |
| DevOps                           | 5/10  | CI is broad, least-privilege and fast, with strict Turbo env lists and an env-free build. But it is advisory: `main` has no protection on the current plan and all 42 commits went straight to it. Dependabot alerts are off, generated artefacts are not checked, the migrator has no safety checks, there is no deployment runbook, and some working notes contradict the configuration.                                                                                         |

## 4. Decisions taken during the audit

These were decided in this session. The documents are already updated (on branch `docs/english-hinglish-linear-design`, to be applied with this report), and the code follows in its own batches (§6):

- **Language (ADR 0014):** every screen, message, email and document is English. Roman-script Hinglish is used only for caller scripts, voice agent speech and training videos, chosen per customer (`preferred_language`: `hinglish` or `en`). Hindi columns and the Hindi catalogue are removed.
- **Design profile (`DESIGN.md`):** Linear's default app design, with the indigo accent `#5E6AD2`. Light and dark themes are generated from base, accent and contrast in LCH; Inter is self-hosted; the root font stays at the browser default; there is a `/design` preview page.
- **Landing page:** the root stays public and gains a "Staff sign in" button to `/sign-in`, with no session check on the landing page.

Findings these batches resolve are marked **→ language batch** or **→ design batch** below.

## 5. Findings by severity

Each finding gives the location, what is wrong, why it matters and the fix. **Effort:** S is under half a day, M is one to two days, L is longer. The refs in brackets name the auditor findings merged into each item.

### 5.1 Critical

#### C1 · The Upstash key-value adapter returns `"[object Object]"` for every JSON value

**Area:** correctness, security · **Where:** `apps/web/src/auth/deps.ts:54-58`, `packages/domain/src/auth/lockout.ts:25-36`, `apps/web/src/auth/session-principal.ts` (cache read) · **Effort:** S · [arch-quality-1, obs-perf-1, testing-1, obs-perf-2]

- **What:** `new Redis({ url, token })` keeps `@upstash/redis`'s default `automaticDeserialization`. `GET` returns the parsed object, and the adapter's `String(value)` turns it into `"[object Object]"`.
  - `resolveSessionPrincipal` then calls `JSON.parse` on it with no guard, so every authenticated request throws within 60 s of a successful resolution.
  - The lockout's `parse()` swallows the error and reads zero failures, so the counter never passes 1 and sign-in lockout never engages.
- **Why:** production refuses to start without Upstash, so this breaks every BOS page and disables brute-force protection on day one. It is invisible to CI because every test uses the in-memory store. Verified against the library source; reproduced by two auditors with the real SDK.
- **Fix:**
  - Construct the client with `automaticDeserialization: false`.
  - Treat an unparsable cache entry as a miss.
  - Log, rather than silently reset, an unparsable lockout record. Do not make it fail closed, which would lock everyone.
  - Add one KeyValue contract test suite that runs against both the memory store and the Upstash adapter over a stubbed fetch.

### 5.2 High

#### H1 · A revoked or expired session cookie blocks sign-in and set-password

**Area:** correctness · **Where:** `apps/web/src/auth/create-auth.ts:120-145` (`refuseRevokedSession`), `:229-231` · **Effort:** S · [correct-web-1]

- **What:** fix O (review 3) refuses every auth route except `/sign-out` when the cookie names a revoked or over-age session. Sign-in and reset do not need the old session, yet they are refused while the browser still sends it. Nothing expires the cookie, and no screen the user can reach signs them out.
- **Why:** every user who signs in daily hits the 7-day absolute limit. The session is then revoked, the BOS redirects to sign-in, and sign-in answers 401 until the cookie's 12 h idle window lapses. Admin revocation, suspension and password change trigger the same trap.
- **Fix:** exempt `/sign-in/email`, `/request-password-reset`, `/reset-password` and `/reset-password/:token` from the hook, and expire the session cookie on the refusal path. Add a test: revoke, then sign in with the stale cookie.

#### H2 · A role at `all` scope held in one company acts group-wide

**Area:** security · **Where:** `packages/domain/src/commands/admin/user-status.ts:21,56`, `admin/revoke-session.ts:15`, `pricing/set-price.ts:15`; policies `0014_identity_rls.sql:36,52`, `0008_catalogue_core_rls.sql:131` · **Effort:** M · [correct-domain-2, testing-10]

- **What:** `admin.user.suspend`, `admin.user.reactivate` and `admin.session.revoke` never compare the target's entities with the request scope. `admin.user.role.set` does (fix P). `pricing.price.set` lets `pricing.write:entity` change a group-wide (shared) price list. Reproduced at database level.
- **Why:** an Executive role granted for one company (which `inviteUser` allows) becomes group-wide admin power. That person can suspend staff of other companies, end the group Executive's sessions, reactivate someone the group suspended, and change retail prices for all four entities. This is the same class as fix P.
- **Fix:**
  - Add an `assertUserInScope(ctx, userId)` helper in `commands/admin/shared.ts` and use it in suspend, reactivate and revoke (for revoke, check the session owner).
  - Require `pricing.write:all` for shared lists, in the command and in the `price_lists` and `price_list_items` policies.
  - Add wrong-entity tests for all three admin commands.

#### H3 · RLS coverage depends on hand-maintained table lists that nothing checks

**Area:** testing, security · **Where:** `packages/db/src/testing/index.ts:140-191`; `grants.test.ts:15,42`; `fail-closed.test.ts:18,23` · **Effort:** S · [testing-3, docs-drift-7]

- **What:** the fail-closed, forced-RLS, no-owner and no-delete checks iterate `SHARED_TABLES`, `ENTITY_TABLES` and `AUTH_TABLES`. A new table left off the lists gets zero coverage, and CI stays green even if its migration forgets `force row level security`. Nothing asserts that security-definer functions pin a safe `search_path` and ACL, or that `anon` and `authenticated` hold nothing. The lists are complete today (35 = 31 + 4, verified live).
- **Why:** the entity boundary is the product's core promise, and CLAUDE.md, DATABASE §4 and SECURITY claim "every table" is covered. One forgotten list entry silently removes the protection the security suite exists to guarantee.
- **Fix:** add three tests:
  - The public tables (relkind `r`/`p`, not partitions) equal `RLS_TABLES ∪ AUTH_TABLES`, each with `relrowsecurity` and `relforcerowsecurity`.
  - Every `prosecdef` function in `app` and `public` (excluding trigger functions) has an empty or `pg_temp`-terminated `search_path` and no execute for `public` or `readonly_reporter`.
  - `anon`, `authenticated` and `service_role` hold no privilege on application tables.

### 5.3 Medium

**Security**

#### M1 · Supabase API roles hold every privilege on every application table

**Where:** `packages/db/migrations/0002_org_core_rls.sql:98` and every RLS migration; `docs/DATABASE.md:25` · **Effort:** S · [sec-db-1, docs-drift-5]

- **What:** `anon`, `authenticated` and `service_role` hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on all 35 tables, including `sessions`, `auth_accounts` and `user_two_factor`. Postgres default privileges re-grant them on every new table. Policies carry no `TO` clause, TRUNCATE is not checked by RLS, and PUBLIC receives execute on new `app` functions by default.
- **Why:** on a hosted project with the Data API on, fail-closed policies are the only barrier between the internet and the data. The first policy written as `using (true)` for a lookup table, or a leaked `service_role` key, exposes data over HTTPS.
- **Fix:**
  - Add a migration that revokes all on tables, sequences and functions in `public` and `app` from these roles.
  - Alter the default privileges of `postgres` so new objects are not granted to them.
  - Disable the Data API (or expose no schema) on each hosted project.
  - The H3 tests cover it.

#### M2 · Security-definer functions resolve tables through the caller's temporary schema first

**Where:** seven definer functions, e.g. `0018_review3_customer_link_scope.sql:11,16,70`, `0016_shared_customer_master_rls.sql:10-58`, `0012_review2_privileges.sql:19`, `0014_identity_rls.sql:136` · **Effort:** S · [sec-db-2]

- **What:** `search_path = public, app` without a trailing `pg_temp`, while PUBLIC may create temporary objects. A session that creates `temp table account_entities` steers owner-privileged code onto it. This was reproduced: `app.account_unclaimed()` flipped its answer, and `attach_account_entity()` inserted into the temp table as `postgres`.
- **Why:** the precondition is SQL access as `app_user`, which already grants a lot. But the PostgreSQL docs require this pin for definer functions, and pooled sessions let a temp object outlive its transaction.
- **Fix:** `revoke temporary on database postgres from public` (the application roles never need it), and redefine the functions with `set search_path = ''` and schema-qualified names.

#### M3 · Every request context, including AI agents, can read all staff email, phone and 2FA state

**Where:** `packages/db/migrations/0014_identity_rls.sql:31` · **Effort:** S · [sec-db-3, arch-quality-12]

- **What:** `users_read` admits any context, and `app_user` holds a table-level SELECT. Reproduced as the concierge agent: 169 emails, 10 phones, 2FA and last-login state for every staff member in every entity.
- **Why:** agents act on untrusted WhatsApp content. This conflicts with least privilege for agents (SECURITY §3.3) and DPDP data minimisation. Owner display names already come from `principals`.
- **Fix:** narrow `users_read` to the caller's own row or `admin.users.write:all`. Add an identity-scope test asserting an agent context sees no email or phone.

#### M4 · Better Auth endpoints the product never uses are publicly reachable

**Where:** `apps/web/src/app/api/auth/[...all]/route.ts:7`, `apps/web/src/auth/create-auth.ts:147-316` · **Effort:** S · [sec-auth-5]

- **What:** `/update-user`, `/update-session`, `/revoke-session(s)`, `/two-factor/disable`, `/two-factor/get-totp-uri`, `/change-email` and others are mounted. `rememberMe: false` yields a 24 h non-sliding session.
- **Why:** any signed-in user, even one in the `totp_required` state, can rewrite their profile outside the admin commands, hard-delete session rows the design keeps for the sessions screen, or remove a mandatory authenticator.
- **Fix:** set `disabledPaths` for every endpoint no screen uses. It applies to HTTP only, so the in-process calls keep working.

#### M5 · TOTP accepts replayed codes, and its attempt budget never escalates

**Where:** `apps/web/src/auth/create-auth.ts:309-312`, `:287-305` · **Effort:** M · [sec-auth-1]

- **What:** the same 6-digit code verifies more than once within its window. Guessing is capped at Better Auth's default (10 failures per 15 min), and the cap resets indefinitely. A correct password alone clears the app's sign-in lockout and stamps `last_login_at` before the second factor is done.
- **Why:** TOTP protects the three roles that see costs and administer the system.
- **Fix:**
  - Set `twoFactor({ accountLockout: { maxFailedAttempts: 5, durationSeconds: 3600 } })`.
  - Refuse a code already used in the current window (a before hook keyed on user and time step).
  - Move the lockout reset and `last_login_at` to after the second factor.

#### M6 · Sign-in lockout enables targeted denial of service and punishes shared office addresses

**Where:** `apps/web/src/auth/create-auth.ts:64-69,258-270`; `packages/domain/src/auth/lockout.ts:12-17,59-66` · **Effort:** M · [sec-auth-2, correct-domain-8]

- **What:** the `acct:` key locks the real owner too. After 11 failures, one wrong attempt an hour keeps the account locked, and the 24 h TTL refreshes every time. The `ip:` key locks every caller behind one office NAT or CGNAT address. An attacker can reset the IP counter by signing in to their own account.
- **Why:** anyone who knows an Executive's email can keep them out for one Turnstile solve an hour, and a tele-calling floor can lock itself out with five typos.
- **Fix:**
  - Lock on the (account, address) pair.
  - Use the account-wide counter only to escalate: interactive challenge, delay, notify the user.
  - Replace the IP hard lock with the request caps.
  - Add an admin "clear sign-in lock".
  - Record the trade-off in SECURITY §2. This is a policy choice; see §7.

#### M7 · Invite and reset links are stored in plaintext and live 24 hours

**Where:** `apps/web/src/auth/create-auth.ts:173,180` · **Effort:** S · [sec-auth-3]

- **What:** `auth_verifications` holds usable tokens in plaintext. Invites and forgot-password share one 24 h lifetime, and a new link does not invalidate old ones.
- **Why:** anyone with read access to that table or a backup can set a user's password.
- **Fix:**
  - Add `verification: { storeIdentifier: 'hashed' }`; outstanding rows keep working.
  - Give reset links about 1 h and invites 24 h.
  - Delete the user's earlier reset rows when issuing a new one.

#### M8 · The production config guard checks presence only, and only on first sign-in

**Where:** `apps/web/src/auth/deps.ts:26-45,77`; `apps/web/src/app/api/v1/health/ready/route.ts:14` · **Effort:** S · [sec-auth-4, devops-5, docs-drift-10, obs-perf-7]

- **What:**
  - The `.env.example` secret, the CI secret, Cloudflare's always-pass Turnstile keys and an `http` base URL all pass.
  - The check runs lazily on the first auth request, not at start.
  - Readiness checks only the app database: not the auth connection, Upstash or the config.
- **Why:** a deployment configured from the example file starts with bot protection off and a secret that sits in git history, and reports ready.
- **Fix:**
  - Reject the known sample values and Turnstile test keys (`/^[123]x0+AA$/`), a secret under 32 characters, and a non-https URL.
  - Call the guard from `instrumentation.ts`.
  - Add `auth_database`, `key_value` (set and get a probe key, which would also have caught C1) and `config` checks to readiness.

#### M9 · Hosted runtimes must use the console mailer, which prints set-password links to the log

**Where:** `apps/web/src/auth/deps.ts:31-44,80`, `packages/domain/src/ports/mailer.ts:14-21` · **Effort:** S · [correct-domain-10, obs-perf-4]

- **What:** `assertProductionConfig` refuses every mailer except `console`, which logs the link (a bearer credential) and the recipient.
- **Why:** anyone with Vercel log access can request a reset for any non-TOTP staff member and set their password. The code comment claims the opposite.
- **Fix:**
  - Refuse `MAILER=console` when `VERCEL_ENV=production`.
  - On hosted non-production runtimes, print the recipient and subject only.
  - Land the SES wrapper before any environment holds real staff.
  - Correct the comment.

#### M10 · Database errors write bound parameters (reset tokens, session tokens, emails) to the logs

**Where:** `apps/web/src/auth/create-auth.ts:147` (Better Auth default logger), `packages/db` (DrizzleQueryError) · **Effort:** S · [obs-perf-12]

- **What:** a database fault inside a Better Auth query logs the SQL and its params, including `reset-password:<token>`. Next logs raw DrizzleQueryErrors the same way.
- **Why:** usable credentials end up in logs and log drains.
- **Fix:** route Better Auth's `logger` and `onAPIError` through a redacting logger (strip `params:` and the query and params properties), and use the same redaction in `onRequestError` (see M35).

#### M11 · Database connections do not require TLS

**Where:** `packages/db/src/client.ts:12-18`, `packages/db/src/auth-client.ts:21-26` · **Effort:** S · [devops-4, obs-perf-10]

- **What:** postgres.js defaults to `ssl: false`. `sslmode=require` encrypts but does not verify the server, and Supabase certificates chain to Supabase's own root CA.
- **Why:** hosted traffic, including the `auth_service` connection, would depend on someone remembering a URL parameter.
- **Fix:** for any non-local host, pass `ssl: { ca: <Supabase root CA>, rejectUnauthorized: true }`, and have the config guard refuse non-TLS database URLs. Set `application_name` per pool.

#### M12 · The one-command-layer rule and the connection fences are conventions that can be bypassed

**Where:** `eslint.config.mjs:97`, `packages/db/src/index.ts:1,5` · **Effort:** M · [arch-quality-3, arch-quality-4]

- **What:**
  - `await import('@shakti/db/auth')`, a fresh `drizzle(process.env.DATABASE_URL_AUTH)`, or any file under a `tests/` folder passes lint.
  - `withRequestContext` and `schema` are exported to every workspace, so any web module can write without `runCommand`: no guard, no DTO, and later no audit row or outbox event.
- **Why:** audit logging, outbox and idempotency all hang off the runner. A write that skips it is invisible to them.
- **Fix:**
  - Add `no-restricted-syntax` for `ImportExpression` and `require`.
  - Restrict `postgres` and `drizzle-orm/postgres-js` outside `packages/db`, and narrow the test exemption to `packages/*/tests` and `*.test.ts`.
  - Give `apps/web` an `executeCommand`/`executeQuery` entry point in `packages/domain` and restrict `withRequestContext` to the domain package.

#### M13 · The Chief of Staff agent is seeded with the human approval permission

**Where:** `packages/db/seeds/role-permissions.ts:272-278` · **Effort:** S · [docs-drift-1]

- **What:** `agent:chief` holds `agents.inbox.act`, which staff use to approve Agent Inbox items. The forbidden-for-agents list does not cover autonomy-control permissions, so the suite cannot catch it.
- **Why:** an agent could approve its own "Needs approval" actions.
- **Fix:**
  - Remove the grant and give the agent a create-suggestion permission.
  - Add `agents.inbox.act`, `agents.autonomy.write`, `agents.killswitch`, `knowledge.playbook.approve` and `sales.credit.release` to `AGENT_FORBIDDEN_PERMISSIONS`.

#### M14 · The security suites will migrate, seed and mutate any database `.env` points at

**Where:** `packages/db/src/testing/index.ts:33-46,102-117` · **Effort:** S · [devops-3, testing-14]

- **What:** there is no host guard. The fixtures disable an append-only trigger and leave active test users with a committed password.
- **Why:** the documented hosted bootstrap reads the same root `.env`, so a hosted owner URL there is a realistic state.
- **Fix:** refuse any host other than `localhost`, `127.0.0.1` or `::1` unless `ALLOW_REMOTE_TEST_DB=1`, and log the target host at suite start.

#### M15 · The Realtime and mobile JWT design collides with Supabase's `role` claim (planned, slice 1b)

**Where:** `docs/adr/0003-better-auth-and-bos-signed-realtime-jwt.md:14`, ARCHITECTURE §8 · **Effort:** S (design) · [docs-drift-4]

- **What:** any token Supabase accepts selects a Postgres role for the Data API too. A BOS role key in `role` names a role that does not exist; `authenticated` inherits M1's grants. "Realtime only" cannot hold as designed.
- **Fix:**
  - Rename the claim (`bos_role`) and set `role: 'authenticated'` deliberately.
  - Disable the Data API (M1).
  - Give each token type its own `aud`.
  - Update the ADR before slice 1b.

#### M16 · The planned audit redaction list names columns that do not exist (planned, slice 2)

**Where:** `docs/design/backend-weeks-3-5.md:82` · **Effort:** S (design) · [docs-drift-6]

- **What:** the deny list predates Better Auth's schema. It misses `password`, `secret`, `backup_codes` and the request-body fields (`newPassword`, `code`, `token`).
- **Fix:** before slice 2, switch to an allow-list per endpoint for auth hooks and deny-by-pattern for commands, and build the redaction test from the real names.

**Data**

#### M17 · Consent evidence is editable and self-asserted

**Where:** `0016_shared_customer_master_rls.sql:159-167`, `packages/domain/src/commands/crm/create-lead.ts:184-195`, `packages/contracts/src/commands/crm/create-lead.ts:53` · **Effort:** S now, M later · [data-7, correct-domain-6]

- **What:**
  - Any customer writer can rewrite `purpose`, `channel`, `source` and `given_at` (reproduced: a service consent turned promotional and backdated).
  - A cold-calling tele-caller can claim `web_form` or `whatsapp_opt_in`.
  - The record is not bound to the number that consented.
  - `given_at` is always "now".
- **Why:** consent rows decide 160-series dialling and are the DPDP and DLT evidence. Evidence its creator can rewrite is worthless in a dispute.
- **Fix:**
  - Now: column grant `update (withdrawn_at, updated_at, updated_by)` only, plus a trigger refusing other changes and a security test.
  - With imports and ingest: bind `e164`, restrict which sources human callers may assert, accept a bounded `givenAt` from import principals, and add a `consent_texts` table (see §7).

#### M18 · Price history can be forged and records the wrong old price under concurrency

**Where:** `0008_catalogue_core_rls.sql:167`, `packages/domain/src/commands/pricing/set-price.ts:87-120` · **Effort:** S · [sec-db-4, data-12, correct-domain-5]

- **What:**
  - A pricing writer can insert arbitrary `price_change_log` rows, or update `price_list_items.price` with no log row.
  - Two Executives editing one price both read the old price; the second update waits, then applies without error, and both log rows carry the same `old_price`.
  - This challenges review 1's accepted item, whose `conflict` outcome only covers the insert path.
- **Why:** price history is the audit trail for the no-discount rule (SAL-01).
- **Fix:** write the log from an `after insert or update of price` trigger on `price_list_items` (definer, pinned `search_path`, reason passed through a transaction-local setting) and revoke INSERT on the log from `app_user`. Add `.for('update')` to the read.

#### M19 · Price lists can overlap in time, and `effective_to` is read two ways

**Where:** `packages/db/src/schema/pricing.ts:52-58`, `set-price.ts:39` · **Effort:** S · [data-8, correct-domain-17]

- **What:** tax tables forbid overlapping periods; price lists do not (reproduced: three lists effective on one date). `set-price` treats `effective_to` as inclusive while the check constraint and tax tables imply exclusive.
- **Why:** the quote engine must pick "the" price. With overlaps, two quotes on the same day can price the same pump differently.
- **Fix:**
  - Add `exclude using gist (tier_id with =, coalesce(entity_id,0) with =, daterange(effective_from, effective_to,'[)') with &&) where (archived_at is null)`.
  - Document `effective_to` as exclusive and fix `set-price`.
  - The version command closes the previous list.

#### M20 · An account can have several owner contacts, which duplicates leads

**Where:** `packages/db/src/schema/accounts.ts:92-97`, `packages/domain/src/queries/crm/list-leads.ts:70-72`, `create-lead.ts:108` · **Effort:** S · [data-6, correct-domain-12]

- **What:** the same class as fix V, one join earlier. A second `owner` link (the role defaults to `owner`) returns each lead twice with different names. An account whose owner has no primary phone drops out of the list while `countLeads` still counts it.
- **Fix:**
  - Decide whether co-owners are legitimate (§7).
  - If not, add a partial unique index on `account_contacts(account_id) where role = 'owner'` and remove the default.
  - Either way, pick the owner deterministically in `listLeads` with a lateral join.

#### M21 · Seeds overwrite admin edits, and a stage reorder makes the whole seed fail

**Where:** `packages/db/seeds/index.ts:47-137` · **Effort:** M · [data-10, docs-drift-8]

- **What:**
  - Stage, tier and lead-source names are upserted back to the seed text.
  - Swapping stage positions makes the seed abort on `pipeline_stages_pipeline_position_unique`, rolling back the permission update the deploy needed.
  - System-role grants are replaced on every run, while BLUEPRINT §7.1 says roles are editable.
- **Why:** reseeding is required whenever the permission catalogue changes. The first deploy after an Executive reshapes a pipeline either reverts their work or blocks a feature.
- **Fix:**
  - Upsert only code-owned columns.
  - Insert missing reference rows with `onConflictDoNothing`, placing new stages at `max(position)+1`.
  - Decide whether system roles are read-only in Admin (§7), and correct the "safe to re-run" wording.

#### M22 · The migration runner silently skips out-of-order migrations and never verifies applied ones

**Where:** `packages/db/src/migrate.ts:80` · **Effort:** S–M · [data-11, devops-2]

- **What:**
  - drizzle-orm 0.45 applies an entry only if its `when` is newer than the last applied row.
  - A rebased migration with an older timestamp is skipped on every existing database while CI (fresh database) passes.
  - Edited files are not detected.
  - There is no advisory lock or `lock_timeout`, and everything runs in one transaction, which rules out `CREATE INDEX CONCURRENTLY`.
- **Why:** review fixes land as RLS migrations. A skipped one leaves a closed hole open in staging or production with every check green.
- **Fix:**
  - A unit test on `_journal.json` (contiguous `idx`, strictly increasing `when`, a file per tag).
  - A pre-deploy hash comparison against `drizzle.__drizzle_migrations`.
  - `pg_advisory_lock` and `lock_timeout` in the runner.
  - A documented step for concurrent index builds.

#### M23 · Phone normalisation accepts malformed `+91` numbers

**Where:** `packages/contracts/src/crm/phone.ts:14-20` · **Effort:** S · [correct-domain-7, testing-12]

- **What:** any `+`-prefixed input skips the Indian rules: `+91 (0)141 2345678` → `+9101412345678`, `+91 98765 4321` (9 digits) is accepted, `+9198765432101` (11 digits) is accepted.
- **Why:** the phone is the key for dedupe, dialling, WhatsApp and consent. The same line stored two ways creates duplicates and undiallable numbers.
- **Fix:**
  - Map `00` to `+`.
  - For `+91`, drop an optional trunk `0` and require exactly 10 digits starting 1–9.
  - Accept other `+` numbers only for other country codes.
  - Add the cases (and a property test) to `phone.test.ts`.

**Correctness**

#### M24 · Leads created in the default "All companies" view get no team

**Where:** `packages/domain/src/auth/resolve-principal.ts:139-140`, `apps/web/src/actions/crm.ts:13`, `create-lead.ts:79`, `0016_shared_customer_master_rls.sql:93` · **Effort:** M · [correct-domain-1, correct-web-2]

- **What:** a user holding roles in several companies has no `teamId` in All-companies mode. The action narrows the scope to one entity but keeps that principal, so `opportunities.team_id` and `account_entities.team_id` are written as NULL (reproduced).
- **Why:** the four companies share one team, so this becomes the normal path when the week 4 lead form arrives. Team leads never see those leads, and the NULL is permanent. It is not reachable today because no page uses the action.
- **Fix:** carry a per-entity team map on the principal and set `app.team_id` from it when the request scope is one entity, or re-resolve the principal for the target entity. Add a multi-entity test.

#### M25 · Lead ownership and customer-relationship ownership can diverge

**Where:** `list-leads.ts:69`, `create-lead.ts:89-129`, `0016_shared_customer_master_rls.sql:28-45` · **Effort:** M · [data-4, correct-domain-4]

- **What:** `opportunities.owner_id` decides whether a lead is readable, and `account_entities.owner_id` decides whether its customer is readable. `attach_account_entity` answers `true` when a colleague already owns the relationship, then the account is invisible and the command fails with `account_missing` (reproduced). Its copy tells staff to create a new customer. A reassigned lead would be counted but never listed.
- **Why:** repeat enquiries from known customers are the normal case under ADR 0008, and the copy pushes staff to create the duplicate records ADR 0008 exists to prevent.
- **Fix:**
  - Decide the rule (§7).
  - Make `attach_account_entity` report `attached`, `already_yours` or `held_by_other`.
  - Answer a dedicated reason routed to the owner or team lead.
  - Add two-caller tests.

#### M26 · An invite that expires or whose mail fails can never be re-issued

**Where:** `packages/domain/src/commands/admin/invite-user.ts:22-31`, `apps/web/src/actions/admin.ts:27-37`, `create-auth.ts:26`, `apps/web/messages/en.json:27` · **Effort:** M · [correct-domain-3, correct-web-3, arch-quality-10, obs-perf-11, sec-auth-10]

- **What:**
  - Re-inviting answers "email taken".
  - No resend command or forgot-password screen exists.
  - The link is requested after the user row commits, and Better Auth swallows mail failures in the background.
  - The expired-link copy promises "ask your manager to send a new one".
- **Why:** any invitee who misses the 24 h window, and every forgotten password, needs a developer to edit the database.
- **Fix:**
  - Make `admin.user.invite` idempotent for a user still `invited` (re-issue the link), or add `admin.user.invite.resend`.
  - Add a Turnstile-guarded "Forgot password" screen.
  - Surface mail failure to the admin (and move the send to the outbox in slice 3).
  - Align the copy.

#### M27 · The set-password cap (5 per 15 min per address) blocks group onboarding

**Where:** `apps/web/src/auth/create-auth.ts:48,106-117` · **Effort:** S · [sec-auth-11]

- **What / why:** onboarding a team from one office or a CGNAT address fails on the sixth person with "Too many attempts".
- **Fix:** key the `/reset-password` cap on `sha256(token)`, keep a generous per-address ceiling (about 30 per 15 min), and add a test with six invitees from one address.

#### M28 · Upstash `incr` sets the TTL in a separate call; a lost EXPIRE creates a permanent cap

**Where:** `apps/web/src/auth/deps.ts:66-69` · **Effort:** S · [arch-quality-2, correct-domain-9, obs-perf-15]

- **What:** INCR and EXPIRE are two REST calls. If EXPIRE fails after its retries, or the function is frozen between them, the key never expires. Reproduced with an injected failure.
- **Why:** a request cap (`cap:<path>:<ip>`) or Better Auth's rate-limit key becomes a permanent block for a whole office.
- **Fix:** `redis.multi().incr(key).expire(key, ttl, 'NX').exec()`, covered by the C1 contract test.

#### M29 · `crm.lead.create` silently discards a new contact sent with `existingAccountId`

**Where:** `packages/contracts/src/commands/crm/create-lead.ts:65-69`, `create-lead.ts:86-132` · **Effort:** S · [arch-quality-13, correct-domain-13]

- **What / why:** both shapes pass validation, and the typed name and phone are stored nowhere. A consent given with them attaches to a different person.
- **Fix:** make the two customer shapes mutually exclusive in the contract, and add a contract test.

#### M30 · The runner's database-error reasons are missing from the catalogue, so users see "internal"

**Where:** `packages/domain/src/command/run-command.ts:82-88`, `apps/web/src/components/form.tsx:62` · **Effort:** S · [correct-web-4, arch-quality-6, correct-domain-15, obs-perf-14]

- **What:** `concurrent_change` and `database_rejected` have no sentence, so a retryable conflict reads "Something went wrong on our side". Policy refusals (42501) also render as internal. Connection errors are labelled as SQLSTATEs. Reasons are free strings, and no test ties them to the catalogue.
- **Fix:**
  - Add the two keys.
  - Fall back from an unknown reason to the error code before `internal`.
  - Accept only 5-character SQLSTATEs.
  - Export a `REASONS` constant and test that every reason has copy.

**Performance**

#### M31 · The lead list flips to a full join and sort at modest volume

**Where:** `packages/domain/src/queries/crm/list-leads.ts:52-85` · **Effort:** M · [data-1]

- **What:** four RLS-filtered joins run before `LIMIT`. When the page exceeds the planner's estimate (from default selectivities of opaque definer functions), Postgres joins and sorts every visible lead: 6.6 s for a page of 50 at 12k leads, and 44.6 s (past the 30 s timeout) for a page of 200 at 50k.
- **Why:** this is the core daily screen with a 300 ms p95 target. Not reachable today; a blocker for the lead list.
- **Fix:** page on `opportunities` first (a materialised CTE with the keyset and `limit n+1`), then attach the customer with lateral joins. Measured at 33–126 ms. This needs M25's ownership rule so a readable lead always has a readable customer.

#### M32 · Customer-table RLS calls a security-definer function per row, so search cannot use an index

**Where:** `packages/db/migrations/0016_shared_customer_master_rls.sql:103-167` · **Effort:** L · [data-2]

- **What:** every read of `accounts`, `contacts` and their children runs `account_in_scope`/`contact_in_scope` per row. Non-leakproof predicates (trigram, ILIKE) run after it, so the four trigram indexes are never used by `app_user`: 12.2 s for a name search over 50k contacts, and minutes at one year's volume.
- **Why:** customer search, dedupe and the account list all read these tables.
- **Fix:** rewrite the read policies as set-based predicates through `account_entities` (`id in (select ae.account_id from account_entities ae)`), which inline and hash once per query (measured at 14 ms). Keep the definer helpers only for writes that must see past visibility. Needs the full security suite plus a volume regression check.

#### M33 · `scope_ok()` is evaluated per row, so the own and team indexes from fix E are never used

**Where:** `packages/db/migrations/0003_crm_extensions.sql:11-16` · **Effort:** M · [data-3]

- **What / why:** three `position()` searches over the permission string run per row, inside an OR that cannot become an index condition. A tele-caller with no leads walks the whole index: about 1.3 s per page at one year's volume.
- **Fix:**
  - Add `owner_id = $me` or `team_id = $team` to `listLeads` and `countLeads` when the caller's widest scope is own or team, backed by an `(entity_id, owner_id, updated_at desc, id desc)` index.
  - Optionally expand `scope_ok` into initplan-wrapped policy terms generated from one template.

#### M34 · Each page resolves the session twice, at about 12 auth queries and 4 Redis calls

**Where:** `apps/web/src/auth/current-principal.ts:22`, `create-auth.ts:124-132`, `session-principal.ts:47-72`, `(bos)/layout.tsx:11` · **Effort:** S · [arch-quality-11, obs-perf-5, correct-web-11, sec-auth-16]

- **What:** `currentSession()` is not memoised, so layout and page each run it. Each run reads the same session row three times: Better Auth, the revoked hook and `loadSession`.
- **Fix:** wrap `currentSession` in React `cache()`, read `revokedAt` and `createdAt` from the session Better Auth already returns (they are additional fields), and drop the duplicate select.

**Error handling and observability**

#### M35 · No logger, no error reporting, and failures swallowed without a trace

**Where:** `apps/web/src/actions/auth.ts:48,77,99,114,128,170`, `apps/web/src/auth/errors.ts:46`, `packages/domain/src/command/run-command.ts:84`, `packages/db/src/context.ts:43` · **Effort:** M · [obs-perf-3, correct-web-7, correct-domain-18, obs-perf-13]

- **What:**
  - Every unexpected failure on the auth actions becomes `{ error: 'internal' }` with a 200 and no log.
  - Translated database errors drop the original error, and sink failures bypass translation.
  - There is no `instrumentation.ts`/`onRequestError`.
  - The request id is minted per transaction and never logged or shown, and DESIGN §11's reference number does not exist.
- **Why:** the first Upstash, Cloudflare or database incident will leave nothing to diagnose, and Sentry will not see handled errors either.
- **Fix:**
  - A small structured logger port (JSON lines with level, requestId, event and a redacted error; M10's redaction).
  - `onRequestError`.
  - `cause` on `DomainError`, and sink calls wrapped in the translation.
  - One request id per incoming request, passed to `withRequestContext`, logged and returned as the reference on `internal`.

#### M36 · A database or auth outage looks like a sign-out, and a Redis error breaks the sign-in page

**Where:** `apps/web/src/auth/session-principal.ts:47`, `current-principal.ts:22-29` · **Effort:** S · [obs-perf-8, sec-auth-15]

- **What / why:** `getSession(...).catch(() => null)` turns any failure into "no session", so users loop to sign-in. Any Upstash error throws from `currentSession()` although the principal cache is only an optimisation.
- **Fix:** catch only 401/403 `APIError`s and rethrow the rest to the error boundary (M38). Treat cache read and write errors as a miss (with a warning), keeping lockout checks fail-closed.

#### M37 · Upstash and Turnstile calls have no timeout, and a Turnstile outage reads as a failed bot check

**Where:** `apps/web/src/auth/turnstile.ts:22-28`, `deps.ts:54` · **Effort:** S · [obs-perf-6, sec-auth-14]

- **What:**
  - A slow Cloudflare holds every sign-in until the function times out.
  - An unreachable Upstash spends about 4.3 s in retries per call.
  - A network failure shows "We couldn't confirm you're a person".
  - Turnstile's hostname and action are not checked.
- **Fix:**
  - Turnstile: `signal: AbortSignal.timeout(3000)`, log non-success error codes, map network failures to `integration_unavailable`, verify hostname and action.
  - Upstash: `retry: { retries: 1 }` and `signal: () => AbortSignal.timeout(800)`.

#### M38 · No `error.tsx`, `global-error.tsx` or `not-found.tsx`

**Where:** `apps/web/src/app/` · **Effort:** S · [correct-web-6, obs-perf-9, ux-5; live pass]

- **What / why:** unhandled errors and unknown URLs show Next's English defaults, with "404", "server" and "ERROR <digest>" (banned words under DESIGN §11), no reference and no way back. The live pass saw this on a Hindi page.
- **Fix:** add all three with catalogue copy. `global-error.tsx` renders its own `<html>` and reads messages statically. Show the reference number (M35) and a retry button, and link to `/home` or `/sign-in`.

**Testing**

#### M39 · The web auth suite fails from 2026-09-28 10:01 UTC and will turn CI red

**Where:** `apps/web/tests/auth.test.ts:17,404` · **Effort:** S · [testing-2] · **Urgent**

- **What:** the test clock is fixed at `2026-09-27T10:00:00Z` (+61 s), while the session row is aged with Postgres `now() - interval '8 days'`. The absolute-limit assertion holds only while real time is less than the fake clock plus one day.
- **Why:** the first push after about 15:31 IST tomorrow fails "session limits" for a reason unrelated to the change. Verified by arithmetic.
- **Fix:** age the row relative to the fake clock (`created_at = ${new Date(clock.getTime() - 8 * 86_400_000)}`).

#### M40 · Write policies on privilege and link tables are not tested

**Where:** `packages/db/tests/security/grants.test.ts:42`, `crm-scope.test.ts`, `catalogue-scope.test.ts:85-115` · **Effort:** M · [testing-4, testing-5, testing-6]

- **What:** the policies exist and work, but nothing pins them:
  - no test that a non-holder cannot write `role_permissions`, `roles`, `permissions`, `principals`, `teams` or `entities`, or update or delete `user_entity_roles`;
  - fixes M and N are proven for insert only;
  - the entity term of the `item_costs` write checks, `price_list_items` inserts and the customer-child inserts have no isolating test.
- **Fix:** one table-driven write-policy test (table, insert and update SQL, holder, non-holders) over the shared and entity tables, plus the update cases for the link tables.

#### M41 · Server actions, page guards, HTTP auth routes and several guards have no tests

**Where:** `apps/web/tests/`, `packages/domain/src/command/run-command.ts:108`, `apps/web/tests/auth.test.ts:242-282` · **Effort:** M–L · [correct-web-8, testing-8, sec-auth-7, testing-9, testing-11, testing-13, correct-domain-19]

- **What:** untested:
  - session-before-parse order, scope narrowing, `forgetPrincipal` after admin changes, `switchEntity`;
  - ending other sessions at TOTP enrolment (the test sets it up and asserts nothing, and the revocation is not atomic);
  - the absolute-limit branch of the hook;
  - `minScope` wiring;
  - Better Auth's origin (CSRF) check and HTTP limiter;
  - the readiness 503;
  - multi-entity principals;
  - two-connection races.
- **Fix:**
  - Security-suite tests calling actions with a mocked `next/headers`.
  - An enrolment helper moved into `src/auth` and asserted, or a `second_factor_at` session field.
  - A runner unit test for `minScope`.
  - `auth.handler(new Request(...))` tests.
  - A multi-entity fixture and a two-connection helper.

#### M42 · The "seeded matrix equals SECURITY §3.2" test compares the seed with itself

**Where:** `packages/db/tests/security/cost-permissions.test.ts:32-38` · **Effort:** S · [testing-7, docs-drift-20]

- **What / why:** the oracle is `STAFF_MATRIX`, the same source `db:seed` writes, so a wrong cell passes. They match today: 60 keys by 11 roles, 0 differences.
- **Fix:** generate the §3.2 table from the matrix and fail CI on a diff (sturdier than parsing Markdown), and rename the test.

**Architecture and code quality**

#### M43 · Twenty enum lists are typed twice, as SQL checks and as `z.enum`, with no sync check

**Where:** e.g. `packages/db/src/schema/accounts.ts:41` · **Effort:** S · [arch-quality-8]

- **Fix:** build the Drizzle checks from the contracts arrays, so `db:generate` emits a migration when an enum changes, or add a test comparing `pg_get_constraintdef` with `Schema.options`.

#### M44 · Message keys are untyped, so a typo shows a raw key path on screen

**Where:** `apps/web/src/i18n/request.ts:13-18` · **Effort:** S · [ux-11]

- **Fix:** add the `next-intl` `AppConfig` augmentation (`Messages: typeof en`), a neutral `getMessageFallback`, and an `onError` that reports.

**DevOps**

#### M45 · CI cannot block `main`

**Where:** `.github/workflows/ci.yml:3-6` · **Effort:** S · [devops-1, sec-auth-9]

- **What:** branch protection and rulesets are unavailable for a private personal repository on the free plan. All 42 commits went straight to `main`, and CLAUDE.md says a slip "blocks main".
- **Why:** once Vercel is connected, a red commit on `main` deploys.
- **Fix:**
  - Move the repository to the client's organisation (ROADMAP §10) on a plan with rulesets (PR required, six checks, no force-push), or upgrade to Pro.
  - Meanwhile, turn off Vercel's automatic production deploys and promote from a CI job that `needs:` every check.
  - Correct CLAUDE.md. This needs your action; see §7.

#### M46 · Dependabot alerts are off, and the audit runs only on push at level high

**Where:** `.github/workflows/ci.yml:99`, repository settings · **Effort:** S · [devops-8, sec-auth-8]

- **Fix:**
  - Enable Dependabot alerts and security updates (free on private repositories; your action).
  - Add a scheduled audit at `--audit-level=moderate`.
  - Record the esbuild path in `auditConfig.ignoreGhsas` with its reason: drizzle-kit is an optional peer linked from the workspace, not shipped.

#### M47 · CI never checks that generated artefacts are committed, and the tokens drift test races the build

**Where:** `turbo.json:13-15`, `packages/tokens/src/css.test.ts:12` · **Effort:** S · [devops-9, testing-18]

- **Fix:** in the lint job, regenerate (`pnpm --filter @shakti/tokens build && pnpm db:generate`) and run `git diff --exit-code -- packages/tokens/src packages/db/migrations`.

**UX / UI**

#### M48 · A 14 px root font shrinks every control and overrides the user's text size → design batch

**Where:** `apps/web/src/app/globals.css:7`, `packages/tokens/src/tokens.css:81` · **Effort:** S · [ux-1; live pass]

- **What:** `html { font-size: 14px }` makes 1rem 14 px, so `h-9` controls render at 31.5 px (DESIGN: 36 px desktop, 44 px phone), and a browser font-size preference is ignored.
- **Fix:** leave the root at the browser default and set the body size on `body` (specified in the new DESIGN §3).

#### M49 · Input and secondary-button borders are about 1.5:1, below the 3:1 for UI components → design batch

**Where:** `packages/tokens/src/tokens.ts:17`, `contrast.test.ts` · **Effort:** S · [ux-3]

- **Fix:** add an input-border token that reaches 3:1 against surface and background in both themes, and add border pairs to the contrast test.

#### M50 · Focus is lost after every submit, and a repeated error is not re-announced

**Where:** `apps/web/src/components/form.tsx:49-67` · **Effort:** M · [ux-6]

- **Fix:** keep the submit button focusable while pending (`aria-disabled`), focus the first invalid field on error, and keep a mounted live region whose text changes with an attempt counter.

#### M51 · Backup-code sign-in is fragile

**Where:** `apps/web/src/components/auth/two-factor-forms.tsx:71` · **Effort:** M · [ux-8]

- **What:** 10-character mixed-case codes with look-alike characters, compared exactly, with mobile auto-capitalisation on and no copy or download at enrolment. Every miss counts toward the two-factor lockout.
- **Fix:**
  - `autoCapitalize="none" autoCorrect="off" spellCheck={false}`.
  - A lower-case unambiguous alphabet through `customBackupCodesGenerate`.
  - Server-side normalisation.
  - Copy and download buttons.

#### M52 · A failed sign-in clears the email field

**Where:** `apps/web/src/components/auth/sign-in-form.tsx:50` · **Effort:** S · [ux-9]

- **What / why:** React 19 resets uncontrolled fields of function-action forms after every submit, including failures.
- **Fix:** make the email input controlled; let the password clear.

#### M53 · Every page has the same title, so route changes are not announced

**Where:** `apps/web/src/app/layout.tsx:9-14` and the four pages · **Effort:** S · [ux-12, correct-web-14; live pass]

- **Fix:** add `generateMetadata` on each page from the existing catalogue title keys. `/two-factor` picks enrol or verify.

### 5.4 Low

| ID  | Finding                                                                                                                                                                                             | Where                                                           | Fix                                                                                                                | Refs                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| L1  | `account_in_scope` and `contact_in_scope` accept any permission name, so they act as a yes/no oracle wider than the policies they serve                                                             | `0016_shared_customer_master_rls.sql:9-22,51-58`                | Raise unless the permission is `crm.account.read` or `.write`; document the ACL                                    | sec-db-5                             |
| L2  | An opportunity can point at a stage of a different pipeline                                                                                                                                         | `packages/db/src/schema/opportunities.ts:37-42`                 | `unique (id, pipeline_id)` on stages and a composite FK, with the week 5 state-machine migration                   | data-5                               |
| L3  | CHECK gaps: composite-supply shares and rates accept negatives and >100; costs accept values the DTO rejects; no lat/lng range                                                                      | `packages/db/src/schema/tax.ts:55`, `items.ts:82`               | Range checks; first decide whether a negative moving average is legitimate (§7)                                    | data-9                               |
| L4  | `attach_account_entity` writes UUIDv4 ids that `IdSchema` rejects (ADR 0006)                                                                                                                        | `0016_shared_customer_master_rls.sql:40-41`                     | Take the id as a parameter from `newId()`                                                                          | data-13, docs-drift-13               |
| L5  | `next_document_no()` accepts any FY label and never reads the stored prefix                                                                                                                         | `0012_review2_privileges.sql:39-45`, `document-sequences.ts:29` | Check consecutive years; format from the prefix or drop it                                                         | data-14                              |
| L6  | `user_two_factor` has no `unique(user_id)`                                                                                                                                                          | `packages/db/src/schema/identity.ts:136`                        | Unique index in place of the plain one                                                                             | data-15                              |
| L7  | Two Executives demoting or suspending each other at once leave no Executive                                                                                                                         | `set-user-roles.ts:13`, `user-status.ts:16`                     | Advisory lock and a `last_executive` refusal                                                                       | correct-domain-14                    |
| L8  | Suspending an already-suspended user answers "We couldn't find this team member"                                                                                                                    | `user-status.ts:21-32`                                          | Answer success or a specific reason                                                                                | correct-domain-16                    |
| L9  | `crm.lead.create` guards one permission while ADR 0008 needs `crm.account.*` too; the triage and copilot agents read zero leads through `listLeads`                                                 | `create-lead.ts:16`, `role-permissions.ts:243-259`              | Allow several permissions per command; decide agent access to customer contact data (§7)                           | correct-domain-11                    |
| L10 | The company-switcher cookie survives sign-out and narrows the next user                                                                                                                             | `apps/web/src/actions/auth.ts:54-61`                            | Delete it on sign-out and sign-in                                                                                  | correct-web-9                        |
| L11 | Readiness throws a 500 (no envelope) when `DATABASE_URL` is missing; the 503 path is untested                                                                                                       | `packages/db/src/ready.ts:6,14`                                 | Create the probe inside the `try`; add a 503 test                                                                  | correct-web-10                       |
| L12 | The whole message catalogue, mail templates included, ships in every page                                                                                                                           | `apps/web/src/app/layout.tsx:30`                                | `pick()` the namespaces client components use                                                                      | correct-web-12, obs-perf-16, ux-20   |
| L13 | Server actions re-parse input and throw a raw `ZodError`, shown as an internal failure                                                                                                              | `apps/web/src/actions/crm.ts:12` and siblings                   | Parse once in the runner, or through one `safeParse` helper                                                        | correct-web-13, arch-quality-5       |
| L14 | `next-intl` has no `timeZone`, so dates would render in the server's zone                                                                                                                           | `apps/web/src/i18n/request.ts`                                  | `timeZone: 'Asia/Kolkata'` (locale detection itself goes in the language batch)                                    | correct-web-5, ux-4                  |
| L15 | Errors attach to the wrong fields; the sign-in page renders two `id="form-error"` elements                                                                                                          | `apps/web/src/components/form.tsx:18,29`, `sign-in/page.tsx:25` | `useId()` per form; actions return an optional `field`                                                             | ux-7, correct-web-14                 |
| L16 | The command registry is unused and unchecked (plain string names, silent overwrite)                                                                                                                 | `packages/domain/src/command/registry.ts:12`                    | Unit test for unique names and full registration                                                                   | arch-quality-7                       |
| L17 | Roles are data (custom roles possible) but role keys are a closed enum, so a custom role silently loses access or throws                                                                            | `resolve-principal.ts:44`, `user-dto.ts:38`                     | Decide whether custom roles exist (§7)                                                                             | arch-quality-9                       |
| L18 | Duplicated magic values (password minimum 12 in four places), redundant casts, dead exports                                                                                                         | `actions/auth.ts:70,157`, `set-password-form.tsx:31`            | Use `PASSWORD_MIN_LENGTH`; remove dead exports                                                                     | arch-quality-16, sec-auth-19         |
| L19 | Rotating `BETTER_AUTH_SECRET` as SECURITY §10 requires would make TOTP secrets undecryptable; the cited runbook does not exist                                                                      | `docs/SECURITY.md:149`                                          | Document rotation through `BETTER_AUTH_SECRETS` with the old key kept                                              | sec-auth-6                           |
| L20 | Client address: the `advanced.ipAddressHeaders` option is ignored (wrong key); IPv6 is not grouped by /64; the lockout relies on Vercel overwriting `X-Forwarded-For`                               | `create-auth.ts:55-62,226`                                      | One resolver reused everywhere; move or delete the option; comment the Vercel dependency                           | sec-auth-12                          |
| L21 | User status is checked only at the password step: suspended accounts never lock (enumerable), and a pending second factor still creates a session after suspension                                  | `create-auth.ts:278-283`                                        | Record the failure in the inactive branch; refuse inactive users in a session-create hook                          | sec-auth-13                          |
| L22 | Actions, the gitleaks image and `npx shadcn@latest` (in `.mcp.json`) are pinned by mutable tags; no minimum release age                                                                             | `ci.yml:26`, `.mcp.json:5`                                      | Pin by SHA or digest; exact shadcn version; `minimumReleaseAge`                                                    | sec-auth-17, devops-10               |
| L23 | `invite-executive` does not validate the email, and `--force` mints further all-entity Executives without warning                                                                                   | `apps/web/scripts/invite-executive.ts:35`                       | Parse with `EmailSchema`; print a warning on `--force`                                                             | sec-auth-18                          |
| L24 | No path or runbook for migrations, secrets and bootstrap on hosted environments (planned with staging)                                                                                              | `docs/DATABASE.md:288`                                          | `docs/runbooks/DEPLOY.md` and a `workflow_dispatch` migration job, written with staging provisioning               | devops-6                             |
| L25 | Dependabot groups majors with minors, so the dev-dependency PR stays red (TypeScript 7, ESLint 10)                                                                                                  | `.github/dependabot.yml:12-16`                                  | `update-types: [minor, patch]`; ignore those majors and `@types/node` majors                                       | devops-7                             |
| L26 | CI concurrency cancels in-progress runs on `main`                                                                                                                                                   | `ci.yml:11-13`                                                  | Cancel only for pull requests                                                                                      | devops-11                            |
| L27 | The Node version is not pinned where Vercel reads it                                                                                                                                                | `apps/web/package.json`                                         | `"engines": { "node": "24.x" }`                                                                                    | devops-12                            |
| L28 | Numbering tests pick a random FY from 800 values and expect `1`, so they fail intermittently on a reused database                                                                                   | `catalogue-scope.test.ts:290`                                   | Unique FY per run, or relative assertions                                                                          | testing-15                           |
| L29 | The fail-closed test expects zero teams, which holds only because no shared team exists                                                                                                             | `fail-closed.test.ts:31`                                        | Count `entity_id is not null` for teams                                                                            | testing-16                           |
| L30 | The update-entity test mutates seeded entity 1 and hard-codes its GSTIN as null                                                                                                                     | `update-entity.test.ts:48-74`                                   | Restore in `finally`; assert on the changed field                                                                  | testing-17                           |
| L31 | No coverage measurement or property-based testing                                                                                                                                                   | `package.json`                                                  | `@vitest/coverage-v8` report-only, then thresholds; `fast-check` for phones, FY and tax (new dev dependencies, §7) | testing-20                           |
| L32 | The copy lint cannot see inline JSX literals and misses most title-length limits                                                                                                                    | `tools/copy-lint/src/rules.ts`                                  | `react/jsx-no-literals` in app code; explicit limit keys (Devanagari handled by the language batch)                | ux-13                                |
| L33 | English copy: the sign-in intro says the manager set the password (the user chooses it); the backup-code sentence reads as if codes work only after losing the phone                                | `apps/web/messages/en.json`                                     | Rewrite both lines (the Hindi defects go with the language batch)                                                  | ux-14                                |
| L34 | Native browser validation messages bypass the catalogue                                                                                                                                             | `two-factor-forms.tsx:37`, `sign-in-form.tsx:55`                | `setCustomValidity` with catalogue text                                                                            | ux-15                                |
| L35 | The Turnstile widget reserves no space (the button jumps 65 px), has no error callback and overflows at 320 px                                                                                      | `sign-in-form.tsx:30,75`                                        | `min-h-[65px]`, error and timeout callbacks, `size: 'flexible'`                                                    | ux-16                                |
| L36 | Dead ends: `/two-factor` and the expired-link screen have no way back, and `/two-factor` shows its form to signed-out visitors                                                                      | `(public)/two-factor/page.tsx:25-29`                            | "Back to sign in" links; redirect signed-out visitors                                                              | ux-17; live pass                     |
| L37 | The 52-character manual TOTP key is one unbroken string that overflows the card                                                                                                                     | `two-factor-forms.tsx:132`                                      | Group in fours; copy button                                                                                        | ux-18                                |
| L38 | Pending feedback and hover states are inconsistent (Sign out and Switch give none)                                                                                                                  | `home-forms.tsx:11-48`                                          | A shared `SubmitButton` on `useFormStatus` (week 4 `packages/ui`)                                                  | ux-19                                |
| L39 | Touch targets are below 44 px on phones → design batch                                                                                                                                              | `form.tsx:51`                                                   | Phone control size below `md`                                                                                      | ux-2                                 |
| L40 | Inter and Noto Sans Devanagari are named but never loaded → design batch (Inter only)                                                                                                               | `packages/tokens/src/tokens.ts:97`                              | Self-host Inter through `next/font`                                                                                | ux-10, docs-drift-19; live pass      |
| L41 | shadcn aliases in `tailwind.css` generate no Tailwind utilities, and `accent` collides with shadcn's neutral `accent` → design batch                                                                | `packages/tokens/src/tailwind.css:66`                           | Emit `--color-*` keys in `@theme`; rename the brand key                                                            | docs-drift-2                         |
| L42 | `favicon.ico` answers 404 on every page                                                                                                                                                             | `apps/web/src/app/`                                             | Add icons with the design batch                                                                                    | live pass                            |
| L43 | The CSP blocks `eval` in development (a React dev error on every page) and allows `'unsafe-inline'` scripts until nonces arrive with the week 4 proxy                                               | `apps/web/next.config.ts`                                       | Allow `'unsafe-eval'` in development only; nonces in `proxy.ts`                                                    | live pass                            |
| L44 | CLAUDE.md working notes contradict the configuration: `test:security` is never cached, the config check runs on first request not at start, Actions bumps are not grouped, CI does not block `main` | `CLAUDE.md:17,18,23,25`                                         | Hand-edit the four lines                                                                                           | devops-13, docs-drift-9, testing-19  |
| L45 | DATABASE §4.2 templates use dropped columns (one throws for team-scoped callers); §9 describes seeds that do not exist; RLS cost claims are overstated                                              | `docs/DATABASE.md:78-107,279,292`                               | Replace with the live forms and the real seed list                                                                 | data-16, docs-drift-3, docs-drift-15 |
| L46 | ARCHITECTURE and AGENTS state invariants and helpers the code does not have: context-free paths exist; `formatIst`, `Money`, `state-machines` and `privacy` are future; component naming            | `docs/ARCHITECTURE.md:70`, `AGENTS.md:47-52`                    | Name the exceptions; mark future items; align the naming rule                                                      | arch-quality-15, docs-drift-12       |
| L47 | Outbox documents contradict each other on the publisher trigger and columns; the planned publisher role has no RLS policy                                                                           | `docs/adr/0005-…:12,17`, ARCHITECTURE §4                        | Align before slice 3; add the policy to the design                                                                 | docs-drift-14                        |
| L48 | BLUEPRINT names Renovate and CodeQL; ROADMAP says "ADRs 7–12"                                                                                                                                       | `docs/BLUEPRINT.md:279`, `docs/ROADMAP.md:32`                   | One-line edits                                                                                                     | docs-drift-16                        |
| L49 | API.md sends page queries to a non-existent `apps/web/src/queries`                                                                                                                                  | `docs/API.md:101`                                               | Point at `packages/domain/src/queries`                                                                             | docs-drift-17                        |
| L50 | The documented template folder is not the one the copy lint scans, and the copy lint silently skips a missing folder                                                                                | `AGENTS.md:59`, `tools/copy-lint/src/index.ts:21-27`            | Correct the path; fail on a missing configured folder                                                              | docs-drift-11                        |
| L51 | DESIGN used the accent for link text, which fails AA; the hover label was held to 3:1 → resolved in the new DESIGN.md (links use `--accent-text`)                                                   | `DESIGN.md:28`                                                  | Enforced by the generated-token contrast test                                                                      | docs-drift-18                        |

## 6. Fix plan

Each batch can ship on its own, and each ends with lint, format, copy lint, typecheck, unit tests, an env-free build and the security suite, plus tests for what it fixes. Batches marked **migration** change the schema on the local and CI databases only (nothing is hosted), and I will confirm before running any that drop data. Order: critical first, then the two batches you already scheduled, then pre-hosting hardening, then the work that must land before the week 4 screens.

| #   | Batch                                        | Findings                                                              | Effort | Notes                                                                                                                                                              |
| --- | -------------------------------------------- | --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Keep CI green                                | M39                                                                   | S      | Must land before 2026-09-28 10:01 UTC; test-only.                                                                                                                  |
| 1   | Production key-value store                   | C1, M28, M36 (cache half), M37 (Upstash half)                         | S–M    | Adapter fix, atomic incr, cache miss on error, timeouts, and a KeyValue contract test against memory and Upstash (stubbed fetch).                                  |
| 2   | Sign-in lockout trap and cross-company admin | H1, H2, L7, L8                                                        | M      | **Migration** (shared price-list policies need `pricing.write:all`). Wrong-entity tests for suspend, reactivate and revoke.                                        |
| 3   | Security-suite completeness                  | H3, M40, M42, M14, L28, L29, L30                                      | M      | Tests and the testing module only; no product behaviour changes.                                                                                                   |
| 4   | Language batch (ADR 0014)                    | L14, L32, L33 and the Hindi parts of ux-4/13/14                       | M      | **Migration** that drops `name_hi` and `users.locale`. Already specified in the documents.                                                                         |
| 5   | Design batch (Linear profile)                | M48, M49, L39, L40, L41, L42, L51; landing "Staff sign in"            | M      | Already specified in `DESIGN.md`; includes the `/design` page and the theme switch with its preference command.                                                    |
| 6   | Database hardening before hosting            | M1, M2, M3, M13, M17 (now), M18, M19, L1, L4, L6                      | M      | **Migration**: revokes, pinned `search_path`, narrower `users_read`, consent column grant and trigger, price-log trigger, price-list exclusion constraint.         |
| 7   | Authentication hardening                     | M4, M5, M6, M7, M8, M9, M27, L19, L20, L21, L23                       | M      | Config-sized except M5 and M6. M6 needs your policy choice (§7).                                                                                                   |
| 8   | Error handling and observability             | M10, M35, M36 (outage half), M37 (Turnstile half), M38, M30, L11, L13 | M      | Logger with redaction, `onRequestError`, reference number, error and 404 pages. Adds catalogue copy, which is why it follows the language batch.                   |
| 9   | Onboarding and lead flows                    | M26, M29, M23, M24, M20, M25, L9, L10                                 | M      | M20, M25 and L9 need decisions (§7). Adds `admin.user.invite.resend` and a "Forgot password" screen.                                                               |
| 10  | CRM read performance                         | M31, M32, M33, M34, L12                                               | L      | **Migration** (customer read policies rewritten as set-based). Must land before the lead list and search ship. Full security suite plus a volume regression check. |
| 11  | Architecture guardrails                      | M12, M43, M44, L16, L17, L18                                          | M      | `executeCommand`/`executeQuery`, fence rules, enum single source, typed message keys. L17 needs a decision.                                                        |
| 12  | Pre-hosting DevOps                           | M11, M22, M45, M46, M47, L22, L24, L25, L26, L27, M15, M16            | M      | M45 and M46 need your action on GitHub. L24 is written together with staging provisioning.                                                                         |
| 13  | UX polish on the auth screens                | M50, M51, M52, M53, L15, L34, L35, L36, L37, L38, L43                 | M      | After the design batch, so the new tokens apply.                                                                                                                   |
| 14  | Documentation drift                          | L44–L50                                                               | S      | Hand edits to approved documents, one line each where possible.                                                                                                    |

L2, L3, L5 and L31 fold into the week 5 migrations (state machines, tax engine) or wait for your approval of new dev dependencies.

## 7. Decisions needed

From you or the client, before the batch that depends on them:

1. **Lead vs customer ownership (M25, batch 9):** when one tele-caller owns a lead and a colleague owns that customer's relationship in the same company, should the lead owner see the customer, should the relationship move with the lead, or should the request be routed to the owner?
2. **Co-owner contacts (M20):** can a farm or household have two owner contacts (husband and wife), or exactly one?
3. **System roles and custom roles (M21, L17):** are the 11 seeded roles read-only in Admin (Executives clone to customise), and are custom roles supported at all?
4. **Agent access to customer contact data (L9):** should the Triage and Co-pilot agents see customer names and phones, or work only on masked opportunity data?
5. **Lockout policy (M6):** I recommend locking on account plus address, with the account-wide counter used only to escalate (challenge, delay, notify). This trades a little brute-force resistance for no targeted lockout of Executives.
6. **Consent sources (M17):** which consent sources may a human caller record (walk-in form, verbal), and is a stored consent text per version required? This is a legal and DLT question for the client.
7. **Negative moving-average cost (L3):** is it legitimate after returns with negative stock?
8. **GitHub plan (M45, M46):** move the repository to the client's organisation on a plan with rulesets (or upgrade to Pro); this is an action only you can take. Dependabot alerts are enabled in the repository settings (the vulnerability-alerts API answers 204).
9. **New dev dependencies (L31):** `@vitest/coverage-v8` and `fast-check`.

## 8. Resolution

Every finding is fixed, apart from the three actions only you can take (below). Each batch landed as its own pull request after lint, format, copy lint, typecheck, unit tests, the production build with no `.env`, and the security suite on a long-lived and a fresh database.

| Batch | Findings                                                                 | Pull request |
| ----- | ------------------------------------------------------------------------ | ------------ |
| 0     | M39, L26                                                                 | #5           |
| 1     | C1, M28, M36 (cache half), M37 (Upstash half)                            | #7           |
| 2     | H1, H2, L7, L8                                                           | #8           |
| 3     | H3 (tables), M40, M42, M14, L28, L29, L30                                | #10          |
| 4     | L14, L32, L33, ADR 0014                                                  | #11          |
| 5     | M48, M49, L39, L40, L41, L42, L51                                        | #12          |
| 6     | M1, M2, M3, M13, M17, M18, M19, L1, L4, L6, H3 (functions and API roles) | #13          |
| 7     | M4, M5, M6, M7, M8, M9, M27, L19, L20, L21, L23                          | #14          |
| 8     | M10, M30, M35, M36, M37, M38, L11, L13                                   | #15          |
| 9     | M20, M23, M24, M25, M26, M29, L9, L10                                    | #16          |
| 10    | M31, M32, M33, M34, L12                                                  | #17          |
| 11    | M12, M21, M43, M44, L16, L17, L18                                        | #18          |
| 12    | M11, M15, M16, M22, M45 (wording), M46, M47, L22, L24, L25, L27          | #19          |
| 13    | M50, M51, M52, M53, L15, L34, L35, L36, L37, L38, L43                    | #20          |
| 14    | L44, L45, L46, L47, L48, L49, L50                                        | #24          |
| 15    | M41, L2, L3 (ranges), L5, L31                                            | #25          |

M21 and M41 were not assigned in §6; they were fixed in batch 11 and batch 15. L2, L3, L5 and L31, which §6 left for week 5 or for your approval, were fixed in batch 15 on your instruction to proceed.

**Decisions taken on your instruction to proceed (§7):**

- **Item 1 (M25):** a customer a colleague looks after is routed to them.
- **Item 2 (M20):** one owner contact per customer.
- **Item 3 (M21, L17):** roles stay editable, the set of roles is fixed, and edited roles are marked customised.
- **Item 4 (L9):** agents work without customer names and phones.
- **Item 5 (M6):** the recommended lockout policy.

Each is recorded in its pull request and in SECURITY or DATABASE, and each can be reversed by a small change if the client decides otherwise.

**Still open:**

- **Consent sources (item 6, M17 later part):** a legal and DLT question for the client, due with imports and ingest.
- **Negative moving-average cost (item 7, L3):** the percentage and map-point ranges are checked; the cost columns stay unconstrained until the client decides, with inventory in Phase 1.

**Actions only you can take:**

1. Branch rules (M45): move the repository to the client's organisation on a plan with rulesets, or upgrade to Pro. Until then the merge-on-green workflow (`.github/workflows/automerge.yml`, #32) merges a pull request only after CI passes on it, a direct push to `main` is still possible, and Vercel's automatic production deploys stay off.
2. Hosted provisioning (`docs/runbooks/DEPLOY.md`): Supabase projects with the Data API off, the CA certificate, GitHub environments with their secrets, the Vercel project, Upstash.
3. A mail provider before production: production refuses to start with `MAILER=log`.
