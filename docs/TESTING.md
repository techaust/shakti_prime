# Test strategy — Shakti Prime BOS

Blueprint reference: §17 (verification strategy) and §19 item 9. This document brings together what the blueprint asks to be verified, the required tests per change in AGENTS.md §7, the security suite in SECURITY.md §11 and the suites as they sit in the repository. `docs/BLUEPRINT.md` governs on any conflict.

## 1. Principles
- **The deterministic core is proven by unit tests.** Tax, sizing, kit availability, credit checks, job-cost roll-up, incentive rules and every state machine are pure functions in `packages/domain`, tested with fixture tables and boundary cases (BLUEPRINT §17). LLMs never do this math, so no test depends on a model.
- **Access rules are proven on real Postgres.** Row-level security, grants, definer functions and append-only triggers are tested against the same Supabase Postgres 17 image the hosted projects run, connected as the roles the application uses (`app_user`, `auth_service`, `outbox_publisher`), never as a superuser that would bypass the policies.
- **Every contract parses a recorded example.** Each `/api/v1` route and each provider webhook has a fixture that its Zod schema must accept, so a contract change that breaks a caller fails the build, not production (API §7).
- **Generated files are checked, never trusted.** A document or file generated from code fails a test when it no longer matches its source.
- **A test that reads shared state filters by what it wrote.** The suites never clean `audit_logs`, `idempotency_keys` or the CRM tables, so a test reads back by its own request id, actor, random name or key.

## 2. Layers
| Layer | Where | Runs with | Proves |
|---|---|---|---|
| Unit tests | Beside the code as `src/**/*.test.ts` in every workspace (`web`, `@shakti/db`, `@shakti/domain`, `@shakti/contracts`, `@shakti/tokens`, `@shakti/ui`, `@shakti/copy-lint`), and `apps/web/scripts/*.test.ts` | `pnpm test` (Vitest, no database) | Calculators, tax engine, state machines, redaction, the command runner with memory sinks, token generation, copy rules, contract schemas, the JavaScript budget's measuring rules |
| Property tests | Beside the code as `*.property.test.ts` (`fast-check`) | `pnpm test` | Invariants over generated input, such as phone normalisation to E.164 |
| Contract fixture tests | `packages/contracts/src/api/*.test.ts` with `fixtures.ts` | `pnpm test` | Every route in `API_ENDPOINTS` parses its recorded request and response; the catalogue equals the routes in API §3; every error code and reason API §3 names exists in the contracts; provider webhooks keep unknown keys and require the fields the workers use |
| Security suite | `packages/db/tests/security`, `packages/domain/tests`, `apps/web/tests`, each with `vitest.security.config.ts` and a global setup that migrates and seeds | `pnpm test:security` against Docker Postgres | SECURITY §11: fail-closed RLS for every table, role × entity visibility, cost and rate gates, grants, append-only tables, audit and outbox rules, idempotency replay, commands (denied, wrong entity, happy path), queries and their scope, auth flows and routes |
| Generated-file tests | See §4 | `pnpm test`, plus a CI step | Committed documents and generated code match their sources |
| Spike scripts | `apps/web/scripts/spike/*.ts` and `apps/web/scripts/realtime-spike.ts` (`pnpm spike:print`, `pnpm spike:ocr`, `pnpm spike:import` from `packages/domain/tests/spike/import-scale.ts`, `pnpm spike:lists` from `packages/domain/tests/spike/lists.ts`, and through `pnpm --filter web`: `spike:exotel`, `spike:whatsapp`, `spike:voice`, `spike:tally`, `realtime-spike`) | By hand, outside CI | Integration questions with measured numbers, recorded in `docs/spikes/` |
| End-to-end tests | `apps/web/e2e`, from Phase 1 | Playwright | The role journeys in §5 |

## 3. The security suite
The suite is the skeleton BLUEPRINT §19 item 9 asks for and grows with every table and command.

- **Database** (`packages/db/tests/security`): `fail-closed.test.ts` loops over `SHARED_TABLES` and `ENTITY_TABLES` from `packages/db/src/testing` and asserts that a connection with no request context reads nothing; `role-entity-matrix.test.ts` acts as each of the 17 roles in each of the 4 companies over the fixture `entityMatrixFixture` (`packages/db/src/testing/entity-matrix-fixture.ts`: one row per company in every table of `ENTITY_TABLES`, the group-wide rows of the shared tables that allow them, and one customer shared by two companies through `account_entities`) and asserts that each sees its own company's rows as its read permission allows and never another company's; the scope files (`crm-scope`, `catalogue-scope`, `identity-scope`) assert each role and entity pair sees only its rows; `cost-permissions` covers the `finance.cost.read` and `procurement.rate.read` gates; `grants` checks every table's grants against the `NARROWER` map; `enum-sync` pairs every list-valued check constraint with its contract enum; `write-policies`, `audit-logs`, `outbox`, `dead-letter-replay`, `idempotency-keys`, `two-factor-reset`, `imports`, `lead-search-candidates`, `saved-views`, `retention` and `seeds` cover the rest. A table outside the generic loops has its own file: principal-scoped (`PRINCIPAL_TABLES`), insert-only (`OUTBOX_TABLES`), auth-owned (`AUTH_TABLES`) or written only by a database job (`PLATFORM_TABLES`).
- **Domain** (`packages/domain/tests`): a file per command or command group with the denied, wrong-entity and happy-path cases; the audit trail, the outbox, idempotency and database-error translation; `import-lead-parity.test.ts`, which makes the same leads through the set-based import batch and through `crm.lead.create` and compares every row they write; the numbering function; each query's scope; `security/agent-refusals.test.ts`, which reads the command registry, refuses every agent principal on every admin, cost, audit, integrations, tax, price and catalogue command, and checks that no seeded agent role holds any of those permissions.
- **Web** (`apps/web/tests`): Better Auth flows on the `auth_service` connection (`auth.test.ts`), server actions (`actions.test.ts`), the sign-in and account form actions (`auth-actions.test.ts`), the saved-view actions (`saved-views.test.ts`), the import actions and the import commit worker route (`imports.test.ts`), the Realtime token route with a real session (`realtime-token.test.ts`), the readiness route (`ready.test.ts`), the outbox publisher route (`outbox-route.test.ts`) and the list actions (`list-actions.test.ts`). The files run one at a time (`fileParallelism: false`): with no queue configured, every command a server action runs nudges the outbox publisher in process, which would deliver another file's pending events.
- **Still to come**, each with its feature: voice tokens act only as the issuing user (Phase 2); Realtime channel policies refuse one user's token on another user's or another entity's channels (the token route's tests exist; the channel-policy check waits for the hosted Supabase dev project and `pnpm --filter web realtime-spike`); vector retrieval by sensitivity (Phase 1, Knowledge Vault); WhatsApp documents filed only against the sender (Phase 4, document vault); Aadhaar digits never in storage, logs or LLM payloads, with assertions on captured requests (Phase 4, document vault, over the OCR worker whose masking rules are unit-tested today); webhook signatures and duplicates (Phase 2); the dial command's TRAI hours, DND and number-series rules (Phase 2); agent principals refused on the sensitive-document commands, which the agent-refusal sweep picks up once they are registered (Phase 4).

## 4. Generated files
| File | Source | Test | Regenerate with |
|---|---|---|---|
| `docs/data/ERD.md`, `docs/data/DATA-DICTIONARY.md` | Drizzle snapshot, SQL migrations, DATABASE §6 | `packages/db/src/docs/data-docs.test.ts` | `pnpm db:docs` |
| `docs/state-machines/*.md` | `packages/domain/src/state-machines` | `render.test.ts` | `pnpm --filter @shakti/domain machines:docs` |
| `packages/tokens/src/*.css` | `packages/tokens/src/tokens.ts` | `css.test.ts`, and the CI step below | `pnpm --filter @shakti/tokens build` |
| `apps/web/src/app/icon.svg` | `packages/tokens/src/icon.ts` | `icon.test.ts`, and the CI step below | `pnpm --filter @shakti/tokens build` |
| `packages/db/migrations` | `packages/db/src/schema` | The CI step below; `journal.test.ts` checks the journal order | `pnpm db:generate` |
| Seeded permission matrix | `packages/db/seeds` | `permission-matrix.test.ts` against SECURITY §3.2 | Edit the seed and SECURITY §3.2 together |
| API catalogue | `packages/contracts/src/api/endpoints.ts` | `endpoints.test.ts` against API §3 | Edit the catalogue and API §3 together |
| Message catalogue | `apps/web/messages/en.json` | `errors-catalogue.test.ts` (every error reason in the source has a sentence), `pnpm copy-lint` | Edit the catalogue |

CI also rebuilds the token CSS and runs `pnpm db:generate`, then fails when either changed a committed file.

## 5. End-to-end and later layers
- **Playwright E2E** from Phase 1, in `apps/web/e2e`, one journey per role against a seeded preview: lead → qualify → round-robin → quote → sales order → reservation → schedule → survey (app) → dispatch with e-way bill → install → JIR → Tally invoice reconciled → payment → job-cost margin, plus a dealer credit-block path (BLUEPRINT §17). E2E joins CI on `main` and release branches.
- **Provider contract tests** with recorded Meta, Exotel, Google and Tally payloads, including duplicates, out-of-order events and Tally deletions, join each integration as its worker is built.
- **Print snapshots**: quotes, proformas, challans and labels render to page images compared with committed snapshots, with a pinned Chromium, set up with the production print module in Phase 1 (ADR 0009). Until then `apps/web/src/print/templates.test.ts` checks structure and the print spike checks page counts, fonts and QR codes.
- **Prompt-injection set and AI evals** per agent, with shadow reports and spend-cap tests, from the first agent (the Triage agent in shadow mode, Phase 1).
- **Load tests** (10k leads a day, 100 concurrent users, 50k-row imports), the voice latency and accuracy checks, the restore drill (DATABASE §10) and the Tally connector catch-up test, before go-live in Phase 7.

## 6. What CI runs
`.github/workflows/ci.yml` on every push to `main`, every pull request and every automatic merge:

| Job | Steps |
|---|---|
| Lint, format and copy | `pnpm lint`, `pnpm format:check`, `pnpm copy-lint`, the generated-files check |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` (unit, property, contract fixture and generated-file tests) |
| Production build | `pnpm build`, with no `.env` present, then `pnpm --filter web js-budget`, which fails when a page's first-load JavaScript (gzip) passes its budget in `apps/web/js-budget.json` |
| Secrets and advisories | gitleaks over the whole history; `pnpm audit --audit-level=moderate` |
| Security suite | `pnpm test:security` on a fresh `supabase/postgres` service, then `pnpm db:verify` |

Each page's budget in `apps/web/js-budget.json` is its measured size plus 5 %, rounded up to a multiple of 5 kB, with its reason written beside it: public pages measure 176 to 184 kB (gzip) and staff pages 243 to 261 kB, of which the framework is about 176 kB and the shared app shell about 67 kB; 5 of the 13 staff pages meet the 250 kB aim, and the grid pages need a smaller shell or grid to reach it (Phase 1, `DESIGN.md` §10).

`.github/workflows/audit.yml` repeats the dependency audit weekly. Spike scripts and coverage (`pnpm coverage`, report only) do not run in CI; Lighthouse checks and E2E join CI with Playwright in Phase 1.

## 7. Running tests locally
- Everything without a database: `pnpm test`. Turbo caches results; a task that prints "cache hit, replaying logs" did not run, so force it with `pnpm exec turbo run test --force`.
- One unit test file: `pnpm --filter <workspace> exec vitest run <path>`, for example `pnpm --filter @shakti/domain exec vitest run src/tax/tax.test.ts`; add `-t "<name>"` for one case.
- The security suite: `docker compose up -d --wait` (Postgres on `127.0.0.1:54322`), `.env` from `.env.example`, then `pnpm test:security`, which migrates and seeds first. One file: `pnpm --filter @shakti/domain exec vitest run --config vitest.security.config.ts tests/commands/create-lead.test.ts -t "denied"`. The suite is never cached.
- After editing a test, run `pnpm typecheck` as well as `pnpm lint`.
- A spike: `pnpm spike:print` (install `chromium-headless-shell` once with `pnpm --filter web exec playwright-core install chromium-headless-shell`) or `pnpm spike:ocr`; results go to `docs/spikes/results/` and the outputs to the ignored `apps/web/.spike-output/`.

## 8. Required tests per change
AGENTS.md §7 is the rule: a calculator, tax rule, credit check or state machine gets unit tests with boundary cases; a command gets the denied, wrong-entity and happy-path tests on real Postgres; a table or policy gets its place in the fail-closed loop and a scope test; a route or webhook gets a recorded fixture with duplicate and out-of-order cases; a UI flow gets a Playwright journey for the role that uses it (from Phase 1) and a print template a snapshot; a prompt or agent change gets an eval run. The security suite and every migration run against local Docker Postgres before anything reaches a hosted project.
