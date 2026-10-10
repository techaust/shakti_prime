# Test strategy — Shakti Prime BOS

Blueprint reference: §17 (verification strategy) and §19 item 9. This document brings together what the blueprint asks to be verified, the required tests per change in AGENTS.md §7, the security suite in 07-security.md §11 and the suites as they sit in the repository. `docs/01-blueprint.md` governs on any conflict.

## Contents
1. [Principles](#1-principles) · 2. [Layers](#2-layers) · 3. [The security suite](#3-the-security-suite) · 4. [Generated files](#4-generated-files) · 5. [End-to-end and later layers](#5-end-to-end-and-later-layers) · 6. [What CI runs](#6-what-ci-runs) · 7. [Running tests locally](#7-running-tests-locally) · 8. [Required tests per change](#8-required-tests-per-change)

## 1. Principles
- **The deterministic core is proven by unit tests.** Tax, sizing, kit availability, credit checks, job-cost roll-up, incentive rules and every state machine are pure functions in `packages/domain`, tested with fixture tables and boundary cases (BLUEPRINT §17). LLMs never do this math, so no test depends on a model.
- **Access rules are proven on real Postgres.** Row-level security, grants, definer functions and append-only triggers are tested against the same Supabase Postgres 17 image the hosted projects run, connected as the roles the application uses (`app_user`, `app_reader`, `auth_service`, `outbox_publisher`), never as a superuser that would bypass the policies.
- **Every contract parses a recorded example.** Each `/api/v1` route and each provider webhook has a fixture that its Zod schema must accept, so a contract change that breaks a caller fails the build, not production (API §7).
- **Generated files are checked, never trusted.** A document or file generated from code fails a test when it does not match its source.
- **A test that reads shared state filters by what it wrote.** The suites never clean `audit_logs`, `idempotency_keys` or the CRM tables, so a test reads back by its own request id, actor, random name or key.

## 2. Layers
| Layer | Where | Runs with | Proves |
|---|---|---|---|
| Unit tests | Beside the code in every workspace (below) | `pnpm test` (Vitest, no database) | Calculators, tax engine, state machines, redaction, the command runner with memory sinks, token generation, copy rules, contract schemas, the JavaScript budget's measuring rules, the import fences (below) |
| AWS clients and the storage stack | `apps/web/src/files/s3-store.test.ts`, `src/mail/ses-mailer.test.ts`, `src/crypto/kms-cipher.test.ts`, `src/files/infra-template.test.ts` | `pnpm test` | The S3, KMS and SES calls with no network, and the storage template's rules (below) |
| Property tests | Beside the code as `*.property.test.ts` (`fast-check`) | `pnpm test` | Invariants over generated input, such as phone normalisation to E.164 |
| Contract fixture tests | `packages/contracts/src/api/*.test.ts` with `fixtures.ts` | `pnpm test` | Every route in `API_ENDPOINTS` parses its recorded request and response; the catalogue equals the routes API §3.1 to §3.5 and §3.7 list, and §3.6 names every worker route of the catalogue; every error code and reason API §3 names for a route exists in the contracts and is one the route lists; provider webhooks keep unknown keys and require the fields the workers use |
| Security suite | `packages/db/tests/security`, `packages/domain/tests`, `apps/web/tests`, each with `vitest.security.config.ts` and a global setup that migrates and seeds | `pnpm test:security` against Docker Postgres | SECURITY §11: fail-closed RLS for every table, role × entity visibility, cost and rate gates, grants, append-only tables, audit and outbox rules, idempotency replay, commands (denied, wrong entity, happy path), queries and their scope, auth flows and routes |
| Generated-file tests | See §4 | `pnpm test`, plus a CI step | Committed documents and generated code match their sources |
| Spike scripts | `apps/web/scripts/spike/*.ts`, `apps/web/scripts/realtime-spike.ts` and `packages/domain/tests/spike/*.ts` (the commands are below) | By hand, outside CI | Integration and performance questions with measured numbers, recorded in `docs/04-architecture-appendix/` |
| End-to-end tests | `apps/web/e2e/*.spec.ts`, helpers in `e2e/support`, the seed in `e2e/setup` | `pnpm --filter web e2e` (Playwright against the production build) | Every screen's journey for the roles that use it, WCAG 2.1 A and AA through axe on every screen, and screenshots compared in the Linux image (§5) |

Notes on the layers:
- **Where unit tests live:** `src/**/*.test.ts` in every workspace (`web`, `@shakti/db`, `@shakti/domain`, `@shakti/contracts`, `@shakti/tokens`, `@shakti/ui`, `@shakti/copy-lint`), also `src/**/*.test.tsx` in `web` and `@shakti/ui`, and `apps/web/scripts/**/*.test.ts`.
- **The import fences** of `eslint.config.mjs` are proven by `apps/web/src/lint-fences.test.ts`, which lints source text under paths that do not exist; `web#test` lists `eslint.config.mjs` among its Turbo inputs, so it runs again when the config changes.
- **AWS clients:** the S3, KMS and SES calls run through `aws-sdk-client-mock` with fixed test credentials and no network; a signed upload's bound headers are read from its address.
- **The storage template:** `infra/aws/files.yaml`, parsed as JSON, keeps its bucket private, versioned, encrypted and TLS-only, its CORS headers equal to the ones the store signs, the malware plan tagging, and each IAM statement to its bucket, key and sender.
- **Spike commands:** `pnpm spike:print` and `pnpm spike:ocr` (`apps/web/scripts/spike`); `pnpm spike:import` (`import-scale.ts`), `pnpm spike:lists` (`lists.ts`), `pnpm spike:account360` (`account360.ts`), `pnpm spike:calling` (`calling.ts`, the Cold Caller queue's latency and query plans) and `pnpm --filter @shakti/domain spike:catalogue` (`catalogue-explain.ts`, the catalogue grid's and the price change log's query plans at 5,000 items) and `pnpm --filter @shakti/domain spike:quotes` (`quotes-explain.ts`, the quote list's, its search's, Account 360's and the board cards' query plans at 20,000 quotes) and `pnpm --filter @shakti/domain spike:notifications` (`notifications-explain.ts`, the notification centre's, the bell's and the notification scan's query plans at 200,000 notices), `pnpm --filter @shakti/domain spike:shadow` (`shadow-explain.ts`, the Triage agent's shadow report's and the AI spend's query plans at 12,000 shadowed proposals) and `pnpm --filter @shakti/domain spike:converting` (`converting-explain.ts`, the Lead Converter board's query plans at 20,000 leads), all in `packages/domain/tests/spike` on the local database; and through `pnpm --filter web`: `spike:exotel`, `spike:whatsapp`, `spike:voice`, `spike:tally` and `realtime-spike`.

## 3. The security suite
The suite is the skeleton BLUEPRINT §19 item 9 asks for and grows with every table and command.

- **Database** (`packages/db/tests/security`), one file per rule. A table outside the generic loops has its own file: principal-scoped (`PRINCIPAL_TABLES`), insert-only (`OUTBOX_TABLES`), auth-owned (`AUTH_TABLES`), written only by a database job (`PLATFORM_TABLES`) or CRM set-up that starts empty until the workshop answers (`CONFIG_TABLES`).

  | File | What it proves |
  |---|---|
  | `fail-closed` | A connection with no request context reads nothing from any table of `SHARED_TABLES` and `ENTITY_TABLES` (`packages/db/src/testing`); the helpers answer null outside a context; a request cannot widen its scope; only the Executive updates a company, and never moves one out of scope |
  | `role-entity-matrix` | Each of the 18 seeded roles (staff, agents and `system:workers`) in each of the 4 companies sees its own company's rows as its read permission allows and never another company's, over `entityMatrixFixture` (`packages/db/src/testing/entity-matrix-fixture.ts`: one row per company in every table of `ENTITY_TABLES`, the group-wide rows of the shared tables that allow them, one customer shared by two companies through `account_entities`, and in `files` one file of each purpose, each read by its own rule) |
  | `crm-scope`, `catalogue-scope`, `identity-scope` | Each role and company pair sees only its rows: own, team and company scope on leads and customers, child tables reading by the parent's read scope and writing by its write scope; the cost gate on `item_costs`, catalogue masters, price lists, `price_change_log` append-only; the `auth_service` role, and what `app_user` may read and write of the identity tables (never a session token, hash or secret; user roles only in the request's companies) |
  | `cost-permissions` | `role_permissions` holds exactly the seeded matrix; who holds `finance.cost.read`, `procurement.rate.read` and `catalogue.write`; the General Manager holds neither cost permission |
  | `grants` | Every table's grants for `app_user` against the `NARROWER` map; every definer revoked from `public` and the hosted API roles; `app_reader` selects exactly what `app_user` selects, is named by every policy that lets `app_user` select, and may call only the definers a read needs |
  | `app-reader` | The reader pool reads the same counts as `app_user` for several roles and companies, and refuses a write for want of the privilege (SQLSTATE 42501) and, in its request context, as read-only (25006) |
  | `write-policies` | Only the Executive writes the tables that hold access, and no agent does |
  | `role-editor` | Platform-only permissions held only by a system role; a role's grants written only for every company at once; who may hold a permission (BLUEPRINT §7.1 to §7.3, `app.role_may_hold()`); the Executive keeping its admin grants in every transaction |
  | `user-company-scope` | Users and sessions written only for the request's companies (0056); a person with no role, and reporting's read of role rows (0059) |
  | `two-factor-reset` | `app.reset_two_factor()` is the only request path to the two-factor store: the Executive only, never the caller's own account, kept to the request's companies |
  | `customer-read-through-leads` | A person reads a customer through a readable lead that is not archived, in that company only, and gains no write by it; an agent never, and `system:workers` is held to an agent's rule by its role key or its principal row |
  | `lead-guard` | `app.lead_phone_status()` (held only when the caller may not act for the holder), `app.hand_over_customer()` (never for an agent or `system:workers`) and `app.user_is_active()` |
  | `lead-search-candidates`, `customer-search-candidates` | `app.lead_search_ids()` and `app.customer_search_ids()`: who may call them, and only the leads and customers the caller may read; never a customer through a lead for an agent or `system:workers` |
  | `activities` | The timeline read with its lead or customer, never a colleague's lead; an agent reads no note and no customer's rows through a lead; writes only on a lead or customer the caller reads, free text only in a note |
  | `audit-logs` | Reading the audit trail needs `audit.read`; the application writes its own rows only and never changes or removes one |
  | `outbox` | `app_user` inserts events in its scope and nothing else; the `outbox_publisher` role reads events and marks their delivery only; an event is never rewritten, even by the table owner; the one way a delivered event comes back (a dead letter from its worker, by the publisher only) |
  | `dead-letter-replay` | `app.replay_dead_letter()` needs `integrations.dlq.replay`, and a dead letter is reset only through it |
  | `outbox-health` | `app.outbox_health()`: who may call it, the counts by type with due by backoff and lease, the request's companies only, error codes and never a payload, the keyset paging |
  | `retention` | The outbox purge (30 days, logged in `retention_runs`, run nightly by pg_cron, refusing any other delete) and the monthly detach of audit partitions past eight years into `audit_archive`, with a synthetic old partition |
  | `idempotency-keys` | Keys belong to their caller; expired keys are removed by pg_cron only |
  | `saved-views` | Saved views belong to the person who saved them |
  | `agents` | The agent runtime's tables: an agent writes its own runs, actions and inbox items and reads none back; people read the inbox at their `agents.inbox.act` scope and decide once; the agent controls read the runs and set autonomy, caps and switches |
  | `crm-config` | The tables that start empty until the workshop answers (`CONFIG_TABLES`) and the write rules of pipelines, stages, call outcomes, score rules and referral partners, checked under RLS without the commands |
  | `pin-codes` | The PIN code master: shared by every company, read by every request, written only by an Executive acting for every company; a site's PIN filled from it; an import file that must arrive by the pre-signed upload |
  | `sizings` | A sizing is a child of the lead, read with it, recorded with the lead's write scope as the caller and never changed |
  | `calls` | A call is a child of the lead, read with it, logged by a person whose `calls.log` scope covers the lead with an outcome in use of the group or the company, and never changed |
  | `quotes` | Quotes, their lines and their versions are children of the lead, read with it; made with `sales.quote.create` over the lead's owner and team; lines written only in the transaction that made their quote, then only the state and the withdrawal reason change; lines and versions append-only; the expiry and the printer reach quotes only through their definers |
  | `duplicates` | A candidate is read only by someone who sees both its customers or both its leads; a request inserts only a lead pair and only with `crm.lead.merge`; merges are written by their definers alone, for people; the timeline stays append-only outside a merge; the facts definer answers a person only about a customer they may change |
  | `imports` | Imports seen and written only with `imports.write` in their company, as the caller; a job keeps its rows and file in its company; an import file changed only by the file checks; the batch count of jobs committed before 0058 |
  | `files` | Who creates and reads a file of each purpose, by role and company; a person's upload starts pending and only its status changes; the worker's checks; the column grants |
  | `enum-sync` | Every list-valued check constraint equals its contract enum |
  | `seeds` | Re-running the seed keeps what Executives changed and restores untouched roles |
- **Domain** (`packages/domain/tests`):
  - `commands/`: a file per command or command group with the denied, wrong-entity and happy-path cases; the audit trail, the outbox, idempotency and database-error translation; `commands/files.test.ts`, which also compares `app.file_purpose_grant()` with `files/purposes.ts` purpose by purpose; `commands/run-probe.test.ts` (the delivery check).
  - `commands/import-lead-parity.test.ts` makes the same leads through the set-based import batch and through `crm.lead.create` and compares every row they write.
  - `numbering/`: the numbering function.
  - `queries/`: each query's scope; `reader-parity.test.ts` runs every exported query on the `app_reader` pool and on `app_user` for staff, agent and system callers and requires the same answer or the same refusal; `read-only.test.ts` proves `executeQuery()` refuses every write (SQLSTATE 25006) and a write after a commit the query issues itself, and leaves no pooled connection read-only.
  - `security/agent-refusals.test.ts` reads the command registry and refuses every agent principal and `system:workers` on every admin, cost, audit, integrations, tax, price, catalogue and CRM set-up command and on every command for people only (`peopleOnly`); refuses the agent principals on the customer-master writes, on an upload of any purpose and on the platform's own work (the file checks, the nightly rescoring and the quote expiry); and checks that no seeded agent or system role holds a restricted permission, and no agent a platform-only one.
- **Web** (`apps/web/tests`). The files run one at a time (`fileParallelism: false`): with no queue configured, every command a server action runs nudges the outbox publisher in process, which would deliver another file's pending events.

  | File | What it proves |
  |---|---|
  | `auth.test.ts` | Better Auth flows on the `auth_service` connection, including a forgotten-password request answered once the per-address cap and the Turnstile check pass, before the account is looked up, with a failure after the answer logged as `auth.reset_failed` or `auth.mail_failed` |
  | `actions.test.ts`, `auth-actions.test.ts`, `saved-views.test.ts`, `list-actions.test.ts` | Server actions; the sign-in and account form actions; the saved-view actions; the list actions |
  | `imports.test.ts` | The import actions and the import commit worker route |
  | `realtime-token.test.ts`, `ready.test.ts` | The Realtime token route with a real session; the readiness route |
  | `outbox-route.test.ts` | The outbox publisher route |
  | `outbox-event-route.test.ts` | The event worker route, its failure callback and the publisher's delivery in process without a queue: the signature, the 4 KiB body, a duplicate id, a delivery while another holds the id, every event run once for an `every` worker and an older one skipped for a `latest-only` worker, a type no worker handles, each worker error code and which are retried, and the failure callback holding the event back once |
  | `integration-health.test.ts` | Integration Health's routes and actions |
  | `pdf-render.test.ts` | The render worker route with the real loader, commands and database and a stand-in for Chromium |
  | `files-sweep.test.ts` | The sweep of abandoned uploads, with a stand-in file store and the real upload command, query and database |
  | `lead-rescore.test.ts`, `duplicate-scan.test.ts`, `quote-expiry.test.ts` | The nightly rescoring, the nightly duplicate search and the daily quote expiry routes, with the real signature check, commands and database (and a stand-in queue client for the two that hand work on) |
  | `duplicate-actions.test.ts` | The duplicate actions, each run for every company the caller works for |
  | `files.test.ts` | The upload actions on the development store end to end, the file checks with a store that answers GuardDuty's tag, a PDF with a script, a masked vault photo, and the upload routes |
- **Hosted build:** CI builds without `SENTRY_AUTH_TOKEN`, so the build Sentry wraps is budget-checked once by hand on dev ([DEPLOY §1](runbooks/deploy.md#1-before-the-first-deploy-once-per-environment) step 11).
- **Still to come**, each with its feature:
  - voice tokens act only as the issuing user (Phase 2);
  - Realtime channel policies refuse one user's token on another user's or another entity's channels: the token route's tests exist; the channel-policy check waits for the Realtime spike, `pnpm --filter web realtime-spike`, on the production site with the client's domain (`docs/04-architecture-appendix/realtime.md`);
  - vector retrieval by sensitivity (Phase 1, Knowledge Vault);
  - WhatsApp documents filed only against the sender (Phase 4, document vault);
  - Aadhaar digits never in storage, logs or LLM payloads, with assertions on captured requests (Phase 4, document vault, over the OCR worker whose masking rules are unit-tested today);
  - webhook signatures and duplicates, and the dial command's TRAI hours, DND and number-series rules (Phase 2);
  - agent principals refused on the sensitive-document commands, which the agent-refusal sweep picks up once they are registered (Phase 4).

## 4. Generated files
| File | Source | Test | Regenerate with |
|---|---|---|---|
| `docs/data/erd.md`, `docs/data/data-dictionary.md` | Drizzle snapshot, SQL migrations, DATABASE §6 | `packages/db/src/docs/data-docs.test.ts` | `pnpm db:docs` |
| `docs/data/events.md` | `packages/contracts/src/events/catalogue.ts` | `packages/db/src/docs/events-docs.test.ts` | `pnpm db:docs` |
| `docs/state-machines/*.md` | `packages/domain/src/state-machines` (`registry.test.ts` checks which machines the commands drive) | `render.test.ts` | `pnpm --filter @shakti/domain machines:docs` |
| `packages/tokens/src/*.css` | `packages/tokens/src/tokens.ts` | `css.test.ts`, and the CI step below | `pnpm --filter @shakti/tokens build` |
| `apps/web/src/app/icon.svg` | `packages/tokens/src/icon.ts` | `icon.test.ts`, and the CI step below | `pnpm --filter @shakti/tokens build` |
| `packages/db/migrations` | `packages/db/src/schema` | The CI step below; `journal.test.ts` checks the journal order | `pnpm db:generate` |
| Seeded permission matrix | `packages/db/seeds` | `permission-matrix.test.ts` against SECURITY §3.2 | Edit the seed and SECURITY §3.2 together |
| API catalogue | `packages/contracts/src/api/endpoints.ts` | `endpoints.test.ts` against API §3 (the routes outside §3.6 match exactly; §3.6 names each worker route) | Edit the catalogue and API §3 together |
| Message catalogue | `apps/web/messages/en.json` | `errors-catalogue.test.ts` (every error reason in the source has a sentence), `pnpm copy-lint` | Edit the catalogue |

CI also rebuilds the token CSS and runs `pnpm db:generate`, then fails when either changed a committed file.

## 5. End-to-end and later layers
- **Playwright E2E** in `apps/web/e2e`, run by `pnpm --filter web e2e` (also the uncached Turbo task `test:e2e`; CI calls the steps one by one, see §6):
  - `e2e:seed` (`e2e/setup/seed.ts`, on the host) migrates and seeds the database of `.env`, then, idempotently:
    - makes the people of `e2e/support/users.ts`, one per role the journeys use (Executive in every company, GM, Accounts, tele-caller CC, Sales Team Lead in two companies, Store Manager), sets their password to the low-entropy test phrase and enrols a fresh authenticator app for Executive, GM and Accounts through Better Auth's own API;
    - makes per project an invited person with a set-password link, a GM with no app yet and two Accounts people with one (the code screen and the profile journey), and adds the fixed leads the journeys look for;
    - fills the snapshot company (Agro Solar Hub, `SNAPSHOT_COMPANY` in `users.ts`: a tele-caller with three leads, one import and one update held back with a fixed id, which no journey touches, so the lists' and Integration health's screenshots show real rows);
    - gives the snapshot company a team of its own for the screenshots of the home pages, Targets and the notification centre (`SNAPSHOT_TEAM` in `users.ts`: a team lead, a caller with a daily target and two calls logged today, a General Manager and an Executive of that company alone, and three unread notices of the snapshot caller), and logs the two calls of the tele-caller of company 1 for today and tomorrow of the Indian calendar, so a run that crosses midnight finds them;
    - puts the stages `pipelines.spec.ts` adds or renames back, through the stage commands (`e2e/setup/pipelines.ts`);
    - holds back one update per project in RCREF (`SEND_AGAIN_COMPANY`) for the Send again journey of `integrations.spec.ts` (`customers.spec.ts` makes its own customers through the lead form and pictures the snapshot company's);
    - writes what the specs need to the ignored `e2e/.auth/users.json`.
  - `playwright.config.ts` starts the production build (`next start` with `BOS_ENVIRONMENT=local`, the local production run of `apps/web/src/auth/deps.ts`) on the port of `E2E_BASE_URL`, read from the environment or the root `.env`. Unset, it is `http://localhost:3031`.
    - `E2E_BASE_URL` names the same address as `BETTER_AUTH_URL`: the seed's set-password links and the app's own links are built from `BETTER_AUTH_URL`, so the journeys run on that address; `e2e:snap` takes its port from `BETTER_AUTH_URL`.
    - A slice worktree's `.env` sets both to its own app port (`tools/integration/setup-worktree.sh`). The main checkout's app runs on 3000 (`BETTER_AUTH_URL` in `.env.example`), so there add `E2E_BASE_URL=http://localhost:3000` to `.env` and stop the dev server first, since the run refuses a server that is not serving the build (below). CI sets both to `http://localhost:3000`.
  - `calling.spec.ts` runs the inside and the outside of the TRAI hours on any wall clock: it sets the `bos-test-clock` cookie (`e2e/support/clock.ts`), milliseconds the server adds to its own clock for the calling-hours rule. `apps/web/src/test-clock.ts` honours it only on a runtime that carries the local marker (`BOS_ENVIRONMENT=local` with a localhost `BETTER_AUTH_URL`, not on Vercel), ignores it elsewhere and refuses a request that carries it on a hosted runtime.
  - The project `setup` (`e2e/auth.setup.ts`) signs each role in once through the real screens, the code screen included, and saves its session under `e2e/.auth/`; the projects `desktop-light`, `desktop-dark` (`colorScheme`) and `phone` (400 px wide) run every spec. Each run signs in from its own address (`x-forwarded-for`), so the per-address caps count one run's attempts.
  - `test` from `e2e/support/fixtures.ts` serves a stand-in for Cloudflare's Turnstile script in every browser context (`e2e/support/turnstile.ts`): it fills the hidden answer field as the real widget does, and the server still checks the answer with Cloudflare under the published test secret. Cloudflare's own frames held a page's load event on a slow link. A run against real keys (staging) sets `E2E_REAL_TURNSTILE=1` to keep the real widget.
  - Helpers, from `e2e/support/fixtures.ts`: `signedInAs(role)` for `test.use`, `signedOut`, `projectName()`, `dataGrid(page, caption)` (the table on wider screens, the card list on a phone), `showCompany(page, name)` (the company switcher), and:
    - `expectNoAxeViolations(page, options?)`: WCAG 2.1 A and AA; an exclusion or a removed frame carries its reason at the call site; Cloudflare's bot-check frame is always left out;
    - `hydrated(locator)`: waits until React has taken over an element, so the first click or typed text after a page load is not lost; `E2E_CPU_THROTTLE=6` slows the browser six times, which reproduces a journey that fails only on a loaded machine;
    - `snap(page, name, { mask, fullPage })`, which masks what the markup marks `data-dynamic` (the bot-check widget), every `time` element (grid dates and card ages are marked up as times) and frames, plus what the call names (generated codes).
  - The journeys judge the production build: run `pnpm build` first. The project `setup` stops the run when the server on the port does not serve that build's own manifest (a dev server, or one left running from an older build).
  - One journey: `pnpm --filter web exec playwright test e2e/leads.spec.ts --project=desktop-light` after `pnpm --filter web e2e:seed` (the set-password links are single-use, so seed again before a rerun); `-g "<title>"` narrows to one test, and `--no-deps` skips the sign-in project once `e2e/.auth/` holds fresh sessions.
  - Screenshots are compared only on Linux: on Windows and macOS `snap` returns without comparing, so no baseline is ever written from them. `pnpm --filter web e2e:snap` seeds on the host, starts the production build on the host when it is not answering, and runs the same specs inside `mcr.microsoft.com/playwright:v1.63.0-noble` against it (the specs and the runner import nothing native, and a forwarder in the container keeps the address `localhost`).
  - `pnpm --filter web e2e:snap -- --update-snapshots` makes the baselines, committed under `e2e/__screenshots__/<project>/`; make them only on a fresh database, never one the security suite has used. CI compares them in the same image.
  - The business journeys of BLUEPRINT §17 (lead → qualify → round-robin → quote → sales order → reservation → schedule → survey → dispatch with e-way bill → install → JIR → Tally invoice reconciled → payment → job-cost margin, and a dealer credit-block path) join as each step's screens are built.
- **Lighthouse** on the production build, from `treosh/lighthouse-ci-action` pinned by commit, over the public landing and sign-in pages on a mobile profile, with the assertions in `apps/web/lighthouserc.json`: performance at least 0.9, accessibility and best practices at least 0.95. A signed-in page is left out, because the session cookie would have to sit in the Lighthouse settings and so in the uploaded results.
- **Provider contract tests** with recorded Meta, Exotel, Google and Tally payloads, including duplicates, out-of-order events and Tally deletions, join each integration as its worker is built.
- **Print snapshots**: every template's page with fixed data (the quotation and the proof page with a letterhead, logo and bank account, and both label sizes) is compared with its baseline in the pinned Linux Playwright image, light only, by `apps/web/e2e/print.spec.ts`; the seed writes the pages to `e2e/.print/` (`e2e/setup/print-pages.ts`), since the templates read the message catalogue and font files the Playwright runner does not load (ADR 0009). `apps/web/src/print/templates.test.ts` checks their structure in the default run, and the print spike checks page counts, fonts and QR codes in the PDFs.
- **Prompt-injection set and AI evals** per agent, with shadow reports and spend-cap tests, from the first agent. The Triage agent's (A1) are recorded-answer cases in `packages/domain/tests/fixtures/triage-sets.ts`, run in CI through the real prompt, masking and output filter on the fake transport (`src/ai/triage/triage-sets.test.ts`), and by hand against the live model with `pnpm --filter @shakti/domain eval:triage` when `ANTHROPIC_API_KEY` is set (never in CI; under a ₹50 cap a run).
- **Load tests** (10k leads a day, 100 concurrent users, 50k-row imports), the voice latency and accuracy checks, the restore drill (DATABASE §10) and the Tally connector catch-up test, before go-live in Phase 7.

## 6. What CI runs
`.github/workflows/ci.yml` on every push to `main`, every pull request and every automatic merge: a first job, *What changed*, lets a pull request that changes only documents (`docs/` and the Markdown files at the root) run the lint, unit-test and supply-chain jobs alone; the end-to-end and Lighthouse jobs run on pull requests only, since the run on `main` after an automatic merge repeats the tree its pull request already passed; every other job runs on every code change and on `main`.

| Job | Steps |
|---|---|
| Lint, format and copy | `pnpm lint`, `pnpm format:check`, `pnpm copy-lint`, the generated-files check |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` (unit, property, contract fixture and generated-file tests) |
| Production build | `pnpm build`, with no `.env` present, then `pnpm --filter web js-budget`, which fails when a page's first-load JavaScript (gzip) passes its budget in `apps/web/js-budget.json` |
| Secrets and advisories | gitleaks over the whole history; `pnpm audit --audit-level=moderate` |
| Security suite | `pnpm test:security` on a fresh `supabase/postgres` service, then `pnpm db:verify` |
| End-to-end journeys, accessibility and screenshots | One job per project (desktop light, desktop dark, phone) in `mcr.microsoft.com/playwright:v1.63.0-noble`, each with its own fresh `supabase/postgres` service and 25 minutes (the steps are below) |
| Lighthouse | The production build with a seeded `supabase/postgres` service, `next start`, then Lighthouse on the public pages against `apps/web/lighthouserc.json` |

The end-to-end job's steps, each with its own time limit and output as it happens:
- the build;
- the service forwarded to `localhost` (`e2e/setup/forward.mjs`), so the seed and the app treat it as a local database;
- `e2e:seed`, which prints each stage and stops after five minutes;
- `next start` with `BOS_ENVIRONMENT=local`, waited for by `e2e/setup/wait-for-app.mjs`;
- `playwright test --project=<project>`, the sign-in setup included, two workers, a 20-minute cap on the run.

The app's log, the report and the screenshot differences are kept when a job fails.

Each page's budget in [`apps/web/js-budget.json`](../apps/web/js-budget.json) is its measured size plus 5 %, rounded up, with its reason and the date it was measured written beside it; a page not named there gets the file's `defaultKb`, the aim of `docs/08-design-system.md` §10. What the framework and the shared app shell add to a page is in each route's reason.

`.github/workflows/audit.yml` repeats the dependency audit weekly.

`.github/workflows/automerge.yml` (*Merge on green*) starts when CI succeeds on a pull request: it merges the owner's pull requests and Dependabot's minor and patch bumps, deletes the branch and runs CI again on `main`; a pull request labelled `hold` is skipped (ADR 0017, [AGENTS §8](../AGENTS.md#8-git-and-pull-requests)). `.github/workflows/migrate.yml` (*Migrate a hosted database*) is started by hand for dev or staging: it migrates from a commit on `main`, seeds when asked and checks that every migration is applied as it is on disk ([DEPLOY §2](runbooks/deploy.md#2-every-deploy)).

Spike scripts and coverage (`pnpm coverage`, report only) do not run in CI.

## 7. Running tests locally
- Everything without a database: `pnpm test`. Turbo caches results; a task that prints "cache hit, replaying logs" did not run, so force it with `pnpm exec turbo run test --force` (`pnpm test -- --force` hands the flag to vitest, which rejects it). Current test counts are in [STATUS](10-status.md).
- One unit test file: `pnpm --filter <workspace> exec vitest run <path>`, for example `pnpm --filter @shakti/domain exec vitest run src/tax/tax.test.ts`; add `-t "<name>"` for one case.
- The security suite: `docker compose up -d --wait` (Postgres on `127.0.0.1:54322`), `.env` from `.env.example`, then `pnpm test:security`, which migrates and seeds first. One file: `pnpm --filter @shakti/domain exec vitest run --config vitest.security.config.ts tests/commands/create-lead.test.ts -t "denied"`. The suite is never cached.
- **Only a local database.** The suites, the end-to-end seed and the spikes migrate, seed and leave test users behind, so they refuse a database whose address is not `localhost`, `127.0.0.1` or `[::1]` (`assertLocalDatabase()` in `packages/db/src/testing/local-database.ts`; CI's service container is forwarded to `localhost`). `ALLOW_REMOTE_TEST_DB=1` turns that refusal off; it is empty in `.env.example`, never set by any script or workflow, and never set against a hosted database.
- After editing a test, run `pnpm typecheck` as well as `pnpm lint`.
- A spike: `pnpm spike:print` (install `chromium-headless-shell` once with `pnpm --filter web exec playwright-core install chromium-headless-shell`) or `pnpm spike:ocr`; results go to `docs/04-architecture-appendix/results/` and the outputs to the ignored `apps/web/.spike-output/`.

### In a cloud session
A Claude Code cloud session is an Ubuntu machine with Docker; its environment and setup script are in [hybrid](runbooks/hybrid.md), which also says which steps stay on the owner's PC.
- The unit tests, the security suite and the build run as on the PC: the session start brings up the local Postgres from `compose.yaml`, and each suite migrates and seeds it itself.
- **Journeys and screenshots:** run `pnpm --filter web e2e:snap`, which runs the journeys in the same Playwright image as CI, so the screenshots compare against the committed baselines. A plain `pnpm --filter web e2e` there runs the browser on the session's own machine: Linux, so it compares screenshots too, but against fonts that differ from the image's, and it writes a missing baseline from them. Never commit a baseline from it; baselines come from `e2e:snap -- --update-snapshots` on a fresh database.
- The browsers and images come from the hosts the cloud environment allows ([DECISIONS](11-decisions.md), 04-10-2026: `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` for Playwright's browsers, `challenges.cloudflare.com` for the bot check, `api.pwnedpasswords.com` for the breached-password check); the setup script pulls the Postgres and Playwright images.

## 8. Required tests per change
[AGENTS §7](../AGENTS.md#7-testing) lists the tests each kind of change needs. The security suite and every migration run against the local Docker Postgres before anything reaches a hosted project.
