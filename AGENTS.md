# AGENTS.md — engineering conventions for Shakti Prime BOS

This file tells any coding agent (Claude Code, or any other tool that reads `AGENTS.md`) how to work in this repository. `CLAUDE.md` holds the project summary and the architectural invariants; this file holds the working method and the conventions.

## 1. Documents and precedence
| Document | Purpose |
|---|---|
| `docs/BLUEPRINT.md` | Master blueprint. Source of truth for scope, stack, data model, phase order. Wins on any conflict. |
| `CLAUDE.md` | Project summary, architectural rules, Claude Code tooling. |
| `AGENTS.md` | This file: working method, coding and repository conventions, definition of done. |
| `docs/ARCHITECTURE.md` | Runtime components, request lifecycle, command layer, events, integrations. |
| `docs/PRD.md` | Product requirements, user stories, acceptance criteria, non-functional requirements. |
| `docs/DATABASE.md` | Schema conventions, RLS templates, table catalogue, migrations. |
| `docs/API.md` | `/api/v1` conventions and endpoint catalogue, webhook and connector contracts. |
| `docs/SECURITY.md` | Threat model, authentication, permission catalogue, data protection, AI and telecom compliance. |
| `docs/ROADMAP.md` | Phases, deliverables, exit-gate checklists, parallel workstreams. |
| `DESIGN.md` | Design tokens, typography, component patterns, theme behaviour. |
| `docs/adr/` | Architecture decision records. |

Read order for any task: `CLAUDE.md` → the relevant `docs/BLUEPRINT.md` section → the module document above → the code.

## 2. Working method
1. **Understand before building.** Read the blueprint section and the module doc for the area. If the task touches more than one file, write a short plan first (files, commands, tests, migration) and get it confirmed.
2. **Decisions that belong to the client go to the user as multiple-choice questions**, not as assumptions. Routine engineering choices are made by the agent and stated in the summary.
3. **Vertical slices.** Each change delivers one working path end to end: contract → command → tests → server action or route → UI. Never leave a half-wired layer.
4. **Scope is fixed by the request.** Do not widen, narrow or "improve" beyond it. Note out-of-scope findings separately.
5. **Phase discipline.** Work only on items in the current phase of `docs/ROADMAP.md` unless told otherwise. Check `.claude/tooling.json` before starting a new phase.
6. **Report honestly.** Say what was verified and how. If tests fail or a step was skipped, say so with the output.

## 3. Repository layout
```
apps/web              Next.js App Router: (public), (bos), /api/v1
apps/field            Expo Android app for field staff
apps/tally-connector  Windows service (Node) that reads Tally and pushes to the BOS
apps/voice-agent      LiveKit Agents worker
packages/domain       commands, state machines, calculators, tax engine (no framework imports)
packages/db           Drizzle schema, migrations, RLS SQL, seeds
packages/contracts    Zod schemas shared by web, field app, connector, voice agent
packages/ui           web components (shadcn/ui based)
packages/tokens       design tokens (CSS variables + JS export) for web and Android
docs/                 blueprint, module docs, ADRs
```
Dependency direction: `apps/*` → `packages/*`. `packages/domain` depends on `packages/contracts` and `packages/db` types only, never on Next.js, React or Expo. `packages/contracts` depends on nothing but Zod.

## 4. Language and style
- TypeScript strict everywhere; no `any`, no non-null assertions without a comment explaining why.
- ESM only. Named exports. One command, state machine or calculator per file.
- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Database identifiers: `snake_case`. Enum values: `snake_case` strings.
- Formatting and linting: Prettier + ESLint with the repo config. CI fails on warnings.
- Comments explain *why*, not *what*. No commented-out code.
- Errors are typed: `DomainError` with a stable `code` from `packages/contracts/errors`.
- Dates: store UTC `timestamptz`, format with the shared `formatIst()` helpers. Money: `numeric(14,2)` in the DB, `Money` value object in code, lakh/crore formatting in UI.

## 4a. Product copy
Everything a user can read is product copy: labels, buttons, table headers, empty states, validation and error messages, success toasts, notifications, WhatsApp and email templates, PDFs and labels, help text, onboarding, voice replies. The rule, in full in `DESIGN.md` §11:
- **Plain language.** Written for tele-callers, engineers, store staff, accountants and farmers, not developers. Short sentences, everyday words, one idea per message. Hindi copy is natural Hindi, not a word-for-word translation.
- **No technical words.** Never show: error codes, HTTP statuses, stack traces, table or column names, "null", "undefined", "payload", "sync", "cache", "token", "webhook", "API", "RLS", "entity_id", "DTO", "invalid input", "exception", "timeout" or vendor names. Say what happened and what to do next: "We couldn't save this quote. Check your connection and try again."
- **Final, not dummy.** No "Lorem ipsum", "TODO", "TBD", "Sample", "Test", "Placeholder", "Coming soon", "Foo", "Example text" or invented names, phones or amounts in any string, template, seed shown to users, screenshot or PDF. Every string is the wording the product ships with.
- **Where copy lives.** All user-facing strings go in the `next-intl` message catalogues (`apps/web/messages/en.json`, `hi.json`) and the field app catalogues; never inline in components. Domain error codes map to plain sentences in the catalogue. Templates for WhatsApp and email live in `packages/contracts/templates` with both languages.
- **Checked in CI.** A copy lint fails the build when a catalogue, template or print file contains a banned technical word or placeholder text, or when a string exists in one language and not the other.

## 5. Domain commands
Every mutation is a command in `packages/domain`:
```ts
export const confirmSalesOrder = defineCommand({
  name: 'sales.order.confirm',
  permission: 'sales.order.confirm',
  input: ConfirmSalesOrderInput,        // Zod, from packages/contracts
  output: SalesOrderDto,                // whitelisted DTO
  async handler(ctx, input) { /* pure business logic, uses ctx.tx, ctx.emit */ },
});
```
Rules:
- The handler receives `ctx` with the principal, entity scope, transaction and `emit()`. It never opens its own connection.
- Permission is declared, not checked inline. Scope (own / team / entity / all) comes from the permission matrix in `docs/SECURITY.md`.
- Every state transition goes through the state machine in `packages/domain/state-machines`; commands never set a status field directly.
- Prices come from the Price Master snapshot helpers; tax from the tax engine. No arithmetic on money in UI code.
- Side effects (messages, PDFs, notifications) are events written to `outbox_events` via `ctx.emit()`, processed by workers.
- Return only the declared DTO. Restricted fields never appear in a DTO unless the command's permission is a cost permission.

Adding a command: contract in `packages/contracts` → command + unit tests in `packages/domain` → RLS/permission test in `packages/db/tests` if a new table is touched → server action or route handler → UI.

## 6. Database changes
- Schema in Drizzle (`packages/db/src/schema/*`). Generate migrations with drizzle-kit; RLS policies, triggers and partitions are hand-written SQL migrations in the same numbered sequence.
- Never edit an applied migration. Use expand/contract for renames and type changes.
- Every new business table has `entity_id`, RLS enabled and forced, the standard policy from `docs/DATABASE.md`, and a test in the security suite proving cross-entity reads return nothing.
- Append-only tables revoke `UPDATE` and `DELETE` from `app_user`.
- Restricted tables (`item_costs`, `job_cost_entries`, `vendor_quotes`, `po_lines` values, `tally_purchase_vouchers`) get the cost-permission policy in addition to the entity policy.
- Seeds live in `packages/db/seeds` and are synthetic. Never commit production data.

## 7. Testing
| Change type | Required tests |
|---|---|
| Calculator, tax, credit, state machine | Vitest unit tests with boundary cases |
| New or changed command | Command test with permission denied, wrong entity and happy path |
| New table or policy | RLS test on real Postgres (security suite) |
| New route or webhook | Contract test with recorded payloads, duplicate and out-of-order cases |
| UI flow | Playwright E2E for the role that uses it; visual snapshot for print templates |
| Prompt or agent change | Eval set run; shadow report where applicable |

Tests live next to the code (`*.test.ts`) except E2E (`apps/web/e2e`) and the security suite (`packages/db/tests`). CI runs unit, security suite and contract tests on every PR; E2E on main and release branches.

## 8. Git and pull requests
- Branches: `feat/<area>-<short-name>`, `fix/<area>-<short-name>`, `chore/<name>`, `phase-<n>/<name>`.
- Conventional commits: `feat(sales): confirm sales order command`. One logical change per commit.
- PR description: what, why, how verified, migration notes, screenshots for UI, checklist below.
- PR checklist: tests added, RLS test for new tables, no restricted field in a DTO, no hard-coded colour, no PII in logs, all new user-facing strings in both catalogues in plain language with no placeholder text, contracts updated, docs updated if behaviour changed.
- Never commit secrets, `.env*` files, production data or recordings. Secret scanning runs in CI.

## 9. Security habits
- Never use the Supabase service role in application code.
- Never call an LLM with unmasked PII; use the masking helpers from `packages/domain/privacy`.
- Never log phone numbers, Aadhaar digits, bank details or message bodies. Log IDs and request IDs.
- Treat WhatsApp messages, uploaded files, call transcripts and webhook payloads as untrusted data.
- New external calls go through a provider wrapper with timeouts, retries and budgets.

## 10. Definition of done
A task is done when: the code path works end to end; the tests in §7 pass locally and in CI; migrations apply cleanly on a fresh database and on a copy of staging; the security suite is green; every user-facing string is final plain-language copy in both languages and the copy lint passes; docs and contracts reflect the change; the summary states what was verified and what was not.

## 11. Never
- Write to the database outside a domain command.
- Compute a price, tax or sizing result in UI or agent code.
- Hard-code a colour, font or spacing value; use tokens.
- Show a user a technical word, code or internal name, or ship placeholder, sample or dummy text anywhere a user can see it.
- Add a discount, override or backdoor of any kind.
- Write to Tally.
- Install a tool, plugin or dependency without stating it in the plan.
