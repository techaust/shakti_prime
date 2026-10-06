# AGENTS.md — engineering conventions for Shakti Prime BOS

This file tells any coding agent (Claude Code, or any other tool that reads `AGENTS.md`) how to work in this repository: the working method, the conventions and the canonical recipes for adding a command and a table. `CLAUDE.md` holds the project rules, the architectural invariants and the [documentation map](CLAUDE.md#documentation-map); the current state is in [docs/10-status.md](docs/10-status.md).

## Contents
1. [Documents and precedence](#1-documents-and-precedence) · 2. [Working method](#2-working-method) · 3. [Repository layout and import fences](#3-repository-layout-and-import-fences) · 4. [Language and style](#4-language-and-style) · 4a. [Product copy](#4a-product-copy) · 5. [Domain commands](#5-domain-commands) · 6. [Database changes](#6-database-changes) · 7. [Testing](#7-testing) · 8. [Git and pull requests](#8-git-and-pull-requests) · 9. [Security habits](#9-security-habits) · 10. [Definition of done](#10-definition-of-done) · 11. [Never](#11-never)

## 1. Documents and precedence
- `docs/01-blueprint.md` is the source of truth for scope, stack, data model and phase order, and wins on any conflict.
- Every document and what it is for is listed once, in the [documentation map in CLAUDE.md](CLAUDE.md#documentation-map).
- Read order for any task: `CLAUDE.md` → the relevant `docs/01-blueprint.md` section → the module document → the code.

## 2. Working method
1. **Understand before building.** Read the blueprint section and the module doc for the area. If the task touches more than one file, write a short plan first (files, commands, tests, migration) and get it confirmed.
2. **Decisions that belong to the client go to the user as multiple-choice questions**, not as assumptions. Routine engineering choices are made by the agent and stated in the summary. A decision the owner takes is recorded in [docs/11-decisions.md](docs/11-decisions.md).
3. **Vertical slices.** Each change delivers one working path end to end: contract → command → tests → server action or route → UI. Never leave a half-wired layer.
4. **Scope is fixed by the request.** Do not widen, narrow or "improve" beyond it. Note out-of-scope findings separately.
5. **Phase discipline.** Work only on items in the current phase of `docs/03-roadmap.md` unless told otherwise. Check `.claude/tooling.json` before starting a new phase.
6. **Report honestly.** Say what was verified and how. If tests fail or a step was skipped, say so with the output.

## 3. Repository layout and import fences
The planned layout (blueprint §5); the apps marked planned are created in the phase that needs them.
```
apps/web              Next.js App Router: (public), (bos), /api/v1
apps/field            Expo Android app for field staff (planned, Phase 4)
apps/tally-connector  Windows service (Node) that reads Tally and pushes to the BOS (planned, Phase 5)
apps/voice-agent      LiveKit Agents worker (planned, Phase 2)
packages/domain       commands, state machines, calculators, tax engine (no framework imports)
packages/db           Drizzle schema, migrations, RLS SQL, seeds
packages/contracts    Zod schemas shared by web, field app, connector, voice agent
packages/ui           web components (shadcn/ui based)
packages/tokens       design tokens (CSS variables + JS export) for web and Android
tools/copy-lint       the product-copy lint run in CI
tools/integration     slice integration scripts, the cloud setup script and the document link check
infra/aws             the AWS file storage stack (CloudFormation)
docs/                 the numbered documents (docs/00-start-here.md is the guide), ADRs, runbooks, the Phase 1 run files
.claude/              the project's skills, agents, session-start hooks and tooling list
.github/              CI, merge-on-green, migrate and audit workflows; the pull-request template
```
Dependency direction: `apps/*` → `packages/*`. `packages/domain` depends on `packages/contracts` and on the `packages/db` schema and types (never its client), and never on Next.js, React or Expo. `packages/contracts` depends on nothing but Zod and the UUIDv7 generator. `apps/web` reaches the database only through `executeCommand()` and `executeQuery()` from `packages/domain`; `executeQuery()` runs in a read-only transaction, so a write through it fails (SQLSTATE 25006).

**Import fences.** ESLint (`eslint.config.mjs`) enforces each of these; `apps/web/src/lint-fences.test.ts` proves them by linting source text under paths that do not exist.
- The raw database client (`@shakti/db/client`) is importable only inside `packages/db`; everything else uses `withRequestContext()`. `postgres` and `drizzle-orm/postgres-js` are importable only inside `packages/db`.
- `apps/web` names none of `withRequestContext`, `schema` and `entityIdsLiteral` (from `@shakti/db`, from `@shakti/db/schema` or by a dynamic `import()`), nor any file of `packages/db/src` by a relative path.
- The five restricted entry points of `@shakti/db`, enforced through static imports, dynamic `import()` and `require()` alike:

  | Entry point | What it opens | Importable only from |
  |---|---|---|
  | `@shakti/db/auth` | the `auth_service` connection | `apps/web/src/auth`, `apps/web/scripts`, the end-to-end seed `apps/web/e2e/setup` |
  | `@shakti/db/grants` | `app.user_grants()`, a person's grants before a request context exists | `apps/web/src/auth`, `apps/web/src/workers/imports.ts` |
  | `@shakti/db/outbox` | the `outbox_publisher` connection | `apps/web/src/workers` |
  | `@shakti/db/bootstrap` | writes as the table owner | `apps/web/scripts` |
  | `@shakti/db/testing` | owner and context-free connections | tests and `apps/web/e2e/setup` |

  `@shakti/domain/testing` (settings that change how every request runs) is for tests only.

- Outside tests, a dynamic `import()` names its module as a plain string literal, since a built specifier would pass around the fences; `require` under any name (called or copied), `createRequire` and the `module` package are errors, since each builds a `require()` that passes around them.
- Relative imports have no `.js` extension (Turbopack does not resolve them).
- `packages/domain` and `packages/contracts` import no framework.
- **Browser code** takes only types from `@shakti/contracts` (rule `shakti/browser-contract-types`), because every module of it, subpaths included, loads Zod. Browser code is every `'use client'` file and every file of `apps/web/src/components`, `apps/web/src/screens` (except `access.ts` and `menu-access.ts`), `apps/web/src/nav.ts`, `apps/web/src/theme.ts` and `packages/ui/src`. The values it needs live in `apps/web/src/screens/contract-values.ts`, which `contract-values.test.ts` keeps equal to the contracts.

## 4. Language and style
- TypeScript strict everywhere; no `any`, no non-null assertions without a comment explaining why.
- ESM only. Named exports. One command, state machine or calculator per file.
- Files: `kebab-case.ts`, and `kebab-case.tsx` for React components, whose exports are `PascalCase`. Database identifiers: `snake_case`. Enum values: `snake_case` strings.
- Formatting and linting: Prettier + ESLint with the repo config. CI fails on warnings.
- Comments explain *why*, not *what*. No commented-out code.
- Errors are typed: `DomainError` with a stable `code` from `packages/contracts/src/errors.ts`.
- Dates: store UTC `timestamptz`, displayed in IST. Money: `numeric(14,2)` in the DB and a two-decimal string in DTOs (`MoneySchema`).
- Formatting helpers:
  - `apps/web/src/print/format.ts`: lakh/crore grouping and DD-MM-YYYY dates in IST (`formatRupees()`, `formatAmount()`, `formatDate()`, used by the print templates);
  - `apps/web/src/screens/format.ts`: the screens' formats, `formatDate()` and `formatRupees()` from the print module plus `formatDateTime()`, `formatPhone()`, `formatCount()` and `moneyFromTyped()`;
  - `packages/ui/src/date.ts`: the DD-MM-YYYY date input (`parseDmy()`, `formatDmy()`, `maskDmy()`);
  - `packages/domain/src/money/paise.ts`: integer-paise arithmetic.

## 4a. Product copy
Everything a user can read or hear is product copy: labels, buttons, table headers, empty states, validation and error messages, success toasts, notifications, WhatsApp and email templates, PDFs and labels, help text, onboarding, caller scripts, voice replies. The rule, in full in `docs/08-design-system.md` §11:
- **Plain language.** Written for tele-callers, engineers, store staff, accountants and farmers, not developers. Short sentences, everyday words, one idea per message.
- **English on every surface.** Screens, messages, emails and documents are English. Roman-script Hinglish is used only for caller scripts, voice agent speech and training (`docs/08-design-system.md` §11.5); no Devanagari in any catalogue, template or print file.
- **No technical words.** Never show error codes, HTTP statuses, stack traces, table or column names, internal names or vendor names; the banned words are listed in [`docs/08-design-system.md` §11.2](docs/08-design-system.md#112-banned-words-on-screen), and `tools/copy-lint/src/rules.ts` is the check. Say what happened and what to do next: "We couldn't save this quote. Check your connection and try again."
- **Final, not dummy.** No "Lorem ipsum", "TODO", "TBD", "Sample", "Test", "Placeholder", "Coming soon", "Foo", "Example text" or invented names, phones or amounts in any string, template, seed shown to users, screenshot or PDF. Every string is the wording the product ships with.
- **Where copy lives.** All user-facing strings go in the `next-intl` message catalogue (`apps/web/messages/en.json`) and the field app catalogue; never inline in components. Domain error codes map to plain sentences in the catalogue. Templates for WhatsApp and email will live in `packages/contracts/src/templates` in English, and caller scripts and voice prompts beside them in `hinglish` and `en` variants.
- **Checked in CI.** A copy lint fails the build when the catalogue, a template, a caller script, a voice prompt or a print file contains a banned technical word, placeholder text or a Devanagari character.

## 5. Domain commands
Every mutation is a command in `packages/domain`, declared with `defineCommand()` (`packages/domain/src/command/define-command.ts`). This example is `crm.tag.create`, abridged from `packages/domain/src/commands/crm/tags.ts` (the real one also checks that the company belongs to the request and maps the row through `TagDto.parse`):
```ts
import { CreateTagInput, DomainError, newId, TagDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { defineCommand } from '../../command/define-command';

export const createTag = defineCommand({
  name: 'crm.tag.create', // module.resource.action
  permission: 'crm.lead.assign', // declared, never checked inline
  minScope: 'own', // the narrowest scope that satisfies the guard; RLS decides the rows
  peopleOnly: true, // an agent principal is refused at the guard, whatever it holds
  input: CreateTagInput, // Zod, from packages/contracts
  output: TagDto, // a strict DTO: anything beyond it is an error, never a leak
  auditFields: ['name'], // every key ctx.audit() records besides ids; [] when none
  constraintReasons: { tags_entity_name_unique: 'tag_name_taken' },
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .insert(schema.tags)
      .values({ id: newId(), entityId: input.entityId, name: input.name, createdBy: ctx.principal.id })
      .returning();
    if (!row) throw new DomainError('internal', 'tag insert returned no row');
    ctx.audit({
      aggregateType: 'tag',
      aggregateId: row.id,
      entityId: row.entityId,
      after: { name: row.name },
    });
    return { id: row.id, entityId: row.entityId, name: row.name, archivedAt: null };
  },
});
```

**The declaration.**
- `permission` is a key, or a `PermissionByInput` for a command of several kinds (one upload command for every file purpose); scope (own / team / entity / all) comes from the permission matrix in `docs/07-security.md`.
- `alsoRequires` lists further grants the guard checks, each at its own narrowest scope.
- `peopleOnly` refuses an agent principal (kind `agent` or a role `agent:*`) at the guard, before the handler runs: a customer note, a tag of the company, a role edit.
- `auditFields` is required: each key needs an Activity log label in `apps/web/src/screens/audit.ts` (checked by `audit.test.ts`), and outside production the runner refuses an undeclared key. `auditInput` says what the audit row records of the input when the input is too large or holds customer data in shapes the redaction cannot recognise (an import file's rows).
- `constraintReasons` names the catalogue reasons of the unique or check constraints the handler may race against.

**The handler.**
- `ctx` carries the principal, the request's companies, the transaction `ctx.tx`, `ctx.now` and `ctx.requestId`. It never opens its own connection.
- Every state transition goes through `transition()` of its machine in `packages/domain/src/state-machines`; commands never set a status field directly.
- Prices come from the Price Master snapshot helpers; tax from the tax engine. No arithmetic on money in UI code.
- `ctx.run()` runs another command inside the same transaction; `ctx.savepoint()` runs a part that may fail on its own; `ctx.activity()` writes a timeline row.
- Return only the declared DTO. Restricted fields never appear in a DTO unless the command's permission is a cost permission.

**What the runner does.** `runCommand` validates the input, guards the permission, claims the idempotency key, runs the handler, translates database errors to domain codes (unique or lock failures → `conflict`, constraint violations → `validation_failed`, policy refusals → `forbidden`), parses the output through the strict DTO, and writes the audit rows, the events and the key's answer in the command's transaction. It requires an `audit` and an `outbox` sink; `RunOptions.idempotencyKey` is optional.

**Audit trail.**
- Call `ctx.audit({ aggregateType, aggregateId, entityId?, before?, after? })` once per changed aggregate, with before and after. `entityId: null` marks a change that belongs to no one company (users, sessions, a shared price list); leaving it out uses the request's single company.
- `executeCommand` passes `databaseAuditSink`; tests on real Postgres pass it too; pure runner tests pass `memoryAuditSink()`. Denied and failed calls are recorded by `executeCommand` after the rollback.
- Redaction: `redactForAudit()` for commands (deny by pattern, phones and emails to their last four) and `redactAuthEvent()` for auth events (an allow-list per event in `packages/domain/src/audit/redact.ts`).
- Sign-in and account events are written in the Better Auth hooks through `recordAuthEvent()` (`apps/web/src/auth/audit-events.ts`): the before hook finds the person and keys them by the request headers, the after hook writes the row. A new auth endpoint that changes account state gets an entry in `SESSION_EVENTS` in `create-auth.ts`, an event in `AUTH_AUDIT_EVENTS` and its allow-list.
- An audit-only field never uses the key `reason`: `errors-catalogue.test.ts` reads every `reason: '…'` in the source as a user-facing error reason.
- `audit_logs` is append-only and the suites never clean it, so a test that reads it back filters by its own request id, actor or a random address, never by a fixed value an earlier run also wrote.

**Events and the outbox.**
- Side effects (messages, PDFs, notifications) are events: `ctx.emit({ type, entityId, aggregateType, aggregateId, payload })`, written to `outbox_events` in the command's transaction and delivered by workers.
- A new event type gets an entry in `packages/contracts/src/events/catalogue.ts` with a strict payload of ids, codes and counts only (it leaves the database for QStash); `ctx.emit()` refuses anything else.
- Pure runner tests pass `memoryOutboxSink()`, tests on real Postgres `databaseOutboxSink`. `app_user` cannot read `outbox_events`, so a test reads events back with `asOutboxPublisher()` from the testing module.
- A type is switched to `subscribed: true` only when its worker and the QStash URL group `evt-<type>` exist; until then the publisher marks it delivered without sending.
- Server actions pass `commandOptions(meta, idempotencyKey)` so the publisher is nudged after the commit; locally, with no QStash variables, the nudge runs the publisher in the dev server, and `prepareDatabase()` marks the suites' pending events delivered so readiness stays `ok`.

**Idempotency keys.**
- A command action takes the form's key as its optional second argument and passes it through `commandOptions(meta, idempotencyKey)`. The runner claims it after the guard, so a test of a replay must use the same principal, command and input.
- A replay writes no audit row and no event. A test that counts the effect of a repeat filters by its own random name or key, since the suites never clean `idempotency_keys` or the CRM tables.

**Adding a command, step by step.**
1. Input and strict DTO in `packages/contracts`; a new error reason gets a sentence in the `errors.*` catalogue of `apps/web/messages/en.json`.
2. `defineCommand` in `packages/domain/src/commands/<module>/`, registered in `packages/domain/src/command/registry.ts`.
3. Tests under `packages/domain/tests/commands` on real Postgres: permission denied, wrong company, happy path; an RLS test in `packages/db/tests/security` when a table is new or touched.
   - The agent refusal sweep (`packages/domain/tests/security/agent-refusals.test.ts`) picks commands from the registry by permission: `isRestricted()` marks the cost and other agent-forbidden permissions, every `admin.*`, `audit.*` and `integrations.*` permission, `tax.rates.write`, `pricing.write` and `catalogue.write`.
   - A command that needs one of them fails the sweep's first test until it has a valid input in `INPUTS`; a command that needs `crm.account.write` fails the customer-write test until it has one in `CUSTOMER_INPUTS`. Add the input with the command.
4. A server action in `apps/web/src/actions`, modelled on `createTag` in `apps/web/src/actions/crm.ts`:
   - the caller from `signedIn()` (`actions/support.ts`, which uses `currentPrincipal()`), the input through `parseInput()`, `requestMeta()` for the request id and the caller's address;
   - `executeCommand(principal, { entityIds, requestId }, command, input, commandOptions(meta, idempotencyKey))`, wrapped in `toResult('<action name>', …)` (`actions/result.ts`) so it answers an `ActionResult`;
   - a read calls `executeQuery()` with `{ name: '<action name>' }`, in a read-only transaction (`withRequestContext(..., { readOnly: true })`), so a write through it fails with SQLSTATE 25006.
5. The screen. A BOS menu page calls `screenAccess(navRequires('<menu id>'))` (`apps/web/src/screens/access.ts`; the profile page, outside the menu, calls `screenAccess()`) and names itself through `screenTitle()`, so a page the caller may not open shows the not-found screen and an unnamed tab.

**Auth flows.**
- `currentPrincipal()` (`apps/web/src/auth/current-principal.ts`) answers undefined with no session and throws `unauthorized` with reason `totp_required` until a mandatory authenticator app is enrolled.
- Better Auth's own flows (sign-in, passwords, TOTP, backup codes) are called from `actions/auth.ts`, not through commands; they return a `{ error }` state keyed to the catalogue rather than throwing, because Next.js masks thrown errors in production. A `'use server'` file may export only async functions, so shared constants live in `src/auth`.
- Better Auth error codes map to catalogue reasons in `src/auth/errors.ts`, which `errors.test.ts` checks against the installed plugin's codes and the catalogue.
- A session the app has revoked is refused by a global hook in `create-auth.ts` on every auth route, not only in `currentPrincipal()`; keep that hook when changing the auth configuration.

## 6. Database changes
- Schema in Drizzle (`packages/db/src/schema/*`). Generate migrations with drizzle-kit; RLS policies, triggers and partitions are hand-written SQL migrations in the same numbered sequence.
- Never edit an applied migration. Use expand/contract for renames and type changes.
- Every new business table has `entity_id`, RLS enabled and forced, the standard policy from `docs/05-database.md`, and a test in the security suite proving cross-entity reads return nothing.
- Append-only tables revoke `UPDATE` and `DELETE` from `app_user`.
- Restricted tables (`item_costs`, `job_cost_entries`, `vendor_quotes`, `po_lines` values, `tally_purchase_vouchers`) get the cost-permission policy in addition to the entity policy.
- Seeds live in `packages/db/seeds` and are synthetic. Never commit production data.

**Adding a table, step by step.**
1. The Drizzle schema in `packages/db/src/schema`, then `pnpm db:generate`, then a sibling custom migration (`drizzle-kit generate --custom`) with the RLS, triggers and grants.
2. Add the table to the right list in `packages/db/src/testing/index.ts` so the security suite covers it: `SHARED_TABLES` or `ENTITY_TABLES` for the generic fail-closed loop; `OUTBOX_TABLES` for an insert-only platform table, `PRINCIPAL_TABLES` for a table scoped to the calling principal, `PLATFORM_TABLES` for a table only a database job writes and only a scope-`all` permission reads, `CONFIG_TABLES` for a set-up table that starts empty until the workshop answers (the score and commission rules), each with its own test file (the generic loops read with select and by company). `AUTH_TABLES` lists the identity tables outside the loops.
3. A table in `ENTITY_TABLES` also gets a fixture row per company in `packages/db/src/testing/entity-matrix-fixture.ts` and a read rule in `packages/db/tests/security/role-entity-matrix.test.ts`, then scope tests.
4. Grants: a new select (or every-command) policy that names `app_user` names `app_reader` too, and the table's select grant and any definer a read calls are granted to `app_reader` (`grants.test.ts` checks both). A table whose app grants differ from select, insert and update goes in the `NARROWER` map of `grants.test.ts`. Every list-valued check constraint is paired with its contract enum in `enum-sync.test.ts`.
5. Index every foreign key that is joined or filtered on.

**Policy patterns** (in full in [DATABASE](docs/05-database.md)):
- Company scope: `entity_id = any ((select app.entity_ids())::int[])`; the cast outside the parentheses is required.
- Scope roots use `app.scope_ok(perm, owner_id, team_id)`. Child tables read with `exists (select 1 from <parent> ...)`, write with the same `exists` plus `app.scope_ok('<perm>.write', p.owner_id, p.team_id)` on the parent, and carry a composite foreign key `(parent_id, entity_id)` to the parent's `(id, entity_id)`.
- Customer tables are the exception (ADR 0008): `contacts` and `accounts` carry no company; `account_entities` is their scope root.
  - Their read policies use `exists (select 1 from account_entities ae where ae.account_id = …)` (or `account_contacts` for contacts), which the planner can index; their write policies use `app.account_in_scope()` or `app.contact_in_scope()`.
  - An insert of a root row must not use `returning` (the row is not yet visible).
  - A direct write to `account_entities` or `account_contacts` may link a new row or one the caller already sees; any other attach goes through `app.attach_account_entity()` (review 3, finding M).
- A `security definer` function revokes execute from `public` and `readonly_reporter` and checks a permission in its body, unless DATABASE lists it as an exception with its reason. A definer written from here on sets `search_path = ''` and names every object with its schema; the older migrations set `pg_catalog, public, app, pg_temp` or `public, app`, and an applied migration is never edited.
- The identity tables are the exception to the `app_user` pattern: the auth module writes them as `auth_service` through `@shakti/db/auth`.

**A partitioned table.** drizzle-kit cannot emit `PARTITION BY`, so add it by hand to the generated `create table` before the migration is ever applied (the snapshot does not record it, so `db:generate` shows no drift). The primary key includes the partition column, and the partitions live in a schema no request role may use (`audit_partitions` is the pattern), with a default partition and a pg_cron job that makes the next months.

**A new login role** (as `auth_service`, `outbox_publisher` and `app_reader` are): create it in `ensureRoles()` in `packages/db/src/migrate.ts`; add its password and connection variables to `requireEnv()` in `packages/db/src/env.ts`, to the `test:security` list in `turbo.json`, to `ci.yml`, `migrate.yml`, `.env.example` and `docs/runbooks/DEPLOY.md`; `prepareDatabase()` checks its URL is local.

## 7. Testing
| Change type | Required tests |
|---|---|
| Calculator, tax, credit, state machine | Vitest unit tests with boundary cases |
| New or changed command | Command test with permission denied, wrong entity and happy path |
| New table or policy | RLS test on real Postgres (security suite) |
| New route or webhook | Contract test with recorded payloads, duplicate and out-of-order cases |
| UI flow | Playwright E2E for the role that uses it; visual snapshot for print templates |
| Prompt or agent change | Eval set run; shadow report where applicable |

Tests live next to the code (`*.test.ts`, `*.test.tsx` for components) except the end-to-end journeys (`apps/web/e2e`) and the suites on real Postgres (`packages/db/tests`, `packages/domain/tests`, `apps/web/tests`). What CI runs, and when, is in [TESTING §6](docs/09-testing.md#6-what-ci-runs): the end-to-end journeys and Lighthouse run on pull requests only (`ci.yml`: `github.event_name == 'pull_request'`). The suite layout, the generated-file checks and how to run one test are in `docs/09-testing.md`. On the owner's PC, heavy commands (whole-repository lint, typecheck, build, the security suite, journeys) run one at a time through `bash tools/integration/heavy.sh <command>`, and at most two builders run at once ([slice-integration §1](docs/runbooks/slice-integration.md#1-machines-and-ports)).

## 8. Git and pull requests
- Branches: `feat/<area>-<short-name>`, `fix/<area>-<short-name>`, `docs/<name>`, `spike/<name>`, `chore/<name>`, `phase-<n>/<name>`.
- Conventional commits: `feat(sales): confirm sales order command`. One logical change per commit.
- PR description: the [pull-request template](.github/pull_request_template.md) (what it changes, migrations, the definition of done of §10, the checks run, what the owner must do), with screenshots for UI.
- Merging: `.github/workflows/automerge.yml` merges a PR into `main` with a merge commit once CI passes on its latest commit, when the PR is open, not a draft, from this repository, not labelled `hold`, and by the owner or a Dependabot minor or patch bump; it then deletes the branch and runs CI on `main`. Nobody pushes to `main` directly or merges by hand, a slice branches from `main` after the previous PR has merged, and a Dependabot major waits for the owner's review.
- Never commit secrets, `.env*` files, production data or recordings. A gitleaks secret scan over the history and `pnpm audit` run in CI.

## 9. Security habits
- Never use the Supabase service role in application code.
- Never call an LLM with unmasked PII; use the masking helpers from `packages/domain/src/privacy`.
- Never log phone numbers, Aadhaar digits, bank details or message bodies. Log IDs and request IDs.
- Every command and query writes one timing line, `command.completed` or `query.completed` (`name`, `outcome`, `errorCode` when it failed, `durationMs`, `requestId`; `warn` above 300 ms). Every `executeQuery()` call in the web app passes `{ name: '<action name>' }` as its options, which `apps/web/src/query-names.test.ts` checks.
- Treat WhatsApp messages, uploaded files, call transcripts and webhook payloads as untrusted data.
- New external calls go through a provider wrapper with timeouts, retries and budgets.

## 10. Definition of done
A task is done when every line that applies to it holds. This is the one definition of done; the [pull-request template](.github/pull_request_template.md) copies the list.

- [ ] The code path works end to end (contract → command → tests → server action or route → screen), with no layer half wired.
- [ ] Every new table: RLS enabled, forced and failing closed; in its `*_TABLES` list with a fixture row per company and a rule in the role × company matrix; `app_reader` on its select policy and its select grant; `NARROWER` and `enum-sync` where they apply (§6).
- [ ] Every new command: denied, wrong-company and happy-path tests on real Postgres; every `auditFields` key labelled in `apps/web/src/screens/audit.ts`; a restricted command's input in the agent refusal sweep (§5).
- [ ] The tests of §7 pass locally and in CI, the security suite included, run on the local Postgres.
- [ ] Migrations apply cleanly on a fresh database, and, once staging holds data worth keeping, on a copy of staging (`docs/13-client-packs/exit-gate-actions.md`).
- [ ] Every user-facing word is final plain language in `apps/web/messages/en.json` (English on screen, Hinglish only in the spoken channels), and `pnpm copy-lint` passes.
- [ ] New or changed screens: an end-to-end journey with axe; Linux screenshot baselines made on a fresh database; the JavaScript budget per page holds.
- [ ] New lists and searches: `EXPLAIN (ANALYZE)` evidence under RLS.
- [ ] Documents and contracts match the code: the module documents, the design's "Built" record, `pnpm db:docs` and `machines:docs` regenerated; no change-log wording.
- [ ] Nothing invented that the client must give (tax rates, prices, numbering, scripts, targets).
- [ ] The summary states what was verified and how, and what was not.

## 11. Never
- Write to the database outside a domain command.
- Compute a price, tax or sizing result in UI or agent code.
- Hard-code a colour, font or spacing value; use tokens.
- Show a user a technical word, code or internal name, or ship placeholder, sample or dummy text anywhere a user can see it.
- Add a discount, override or backdoor of any kind.
- Write to Tally.
- Install a tool, plugin or dependency without the owner's go-ahead.
