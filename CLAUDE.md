# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
Shakti Prime BOS is the business operating system for the Shakti group. Four selling entities (Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub, RCREF) share one team. It covers CRM with tele-calling, sales orders, inventory, projects/subsidy, finance with read-only Tally sync, HR and AI agents.

The approved master blueprint is [docs/BLUEPRINT.md](docs/BLUEPRINT.md). It is the source of truth for scope, stack, data model and phase order. Read the relevant section before building a module.

**Status:** Phase 0 in progress (ROADMAP §2, week 2 complete, week 3 next). In place: the monorepo scaffold and CI, design tokens, contracts, the org core (`entities`, `principals`, `roles`, `permissions`, `role_permissions`) and the CRM core (`teams`, `lead_sources`, `pipelines`, `pipeline_stages`, `contacts`, `contact_phones`, `accounts`, `account_contacts`, `customer_sites`, `opportunities`, `consents`) with fail-closed RLS and own/team/entity scope, the catalogue, pricing, tax and numbering tables (`items`, `pump_curves`, `item_costs` with the cost-gate policy proven, `kits`, `kit_components`, `price_tiers`, `price_lists`, `price_list_items`, `price_change_log` append-only, `tax_rates`, `composite_supply_rules`, `document_sequences` with `app.next_document_no()`), the command runner with `org.entity.update`, `crm.lead.create` and `pricing.price.set`, and the health routes. Tax rate values and the number format are workshop inputs, not seeded. Weeks 1 and 2 were reviewed twice (findings A to L fixed, see `docs/reviews/`), and the weeks 3 to 5 backend is designed in `docs/design/backend-weeks-3-5.md` with ADR 0007 drafted; build week 3 from that design (Better Auth, sessions, TOTP, `users`, audit logging, outbox and QStash publisher, idempotency keys). Repository: `github.com/techaust/shakti_prime`, CI on every push to `main`; the security suite stands at 321 tests.

## Working in this repo
- **Commands:** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm copy-lint`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:security`, `pnpm --filter web dev`. Setup is in `README.md`.
- **Real Postgres for the security suite:** `docker compose up -d --wait` starts the Supabase Postgres 17 image on `127.0.0.1:54322`; `.env` comes from `.env.example`. `pnpm test:security` migrates and seeds first, then runs the db, domain and web suites. Never report the suite as verified without running it.
- **Adding a table:** Drizzle schema in `packages/db/src/schema` → `pnpm db:generate` → a sibling custom migration (`drizzle-kit generate --custom`) with RLS, triggers and grants → add the table to `SHARED_TABLES` or `ENTITY_TABLES` in `packages/db/src/testing/index.ts` so the fail-closed loop covers it → scope tests. Policies use `entity_id = any ((select app.entity_ids())::int[])`; the cast outside the parentheses is required. Scope roots use `app.scope_ok(perm, owner_id, team_id)`; child tables read with `exists (select 1 from <parent> ...)`, write with the same `exists` plus `app.scope_ok('<perm>.write', p.owner_id, p.team_id)` on the parent, and carry a composite foreign key `(parent_id, entity_id)` to the parent's `(id, entity_id)`. Index every foreign key that is joined or filtered on. A `security definer` function revokes execute from `public` and `readonly_reporter` and checks a permission in its body.
- **Adding a command:** input and strict DTO in `packages/contracts` → `defineCommand` in `packages/domain/src/commands` → register in `command/registry.ts` → tests under `packages/domain/tests` (denied, wrong entity, happy path) → server action in `apps/web/src/actions`. `runCommand` validates, guards the permission, translates database errors to domain codes (unique or lock failures → `conflict`, constraint violations → `validation_failed`, policy refusals → `forbidden`), parses the output through the strict DTO, and calls the audit and emit hooks; the `audit_logs` and `outbox_events` tables arrive in week 3.
- **Imports:** relative imports have no `.js` extension (Turbopack does not resolve them). The raw database client is importable only inside `packages/db`; everything else uses `withRequestContext()`.
- **Copy:** every user-facing string goes in `apps/web/messages/en.json` and `hi.json`; `pnpm copy-lint` fails on banned words, placeholder text, exclamation marks and keys missing in one language. Domain errors carry a `details.reason` that maps to an `errors.*` catalogue key.
- **Approved documents** (`docs/`, `DESIGN.md`, `CLAUDE.md`, `AGENTS.md`) are excluded from Prettier; edit them by hand only, in single targeted lines.

## Documentation map
| Document | Use it for |
|---|---|
| [docs/BLUEPRINT.md](docs/BLUEPRINT.md) | Scope, stack, data model, phase order. Governs on conflict. |
| [AGENTS.md](AGENTS.md) | Working method, coding and repo conventions, definition of done. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Runtime components, request lifecycle, command layer, events, integrations, ADR index. |
| [docs/PRD.md](docs/PRD.md) | Requirements with IDs and acceptance criteria; non-functional requirements. |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema conventions, RLS templates, table catalogue, migrations. |
| [docs/API.md](docs/API.md) | `/api/v1` conventions, endpoint catalogue, webhook and connector contracts. |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, auth, permission catalogue, data protection, AI and telecom compliance. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, week plan for Phase 0, exit-gate checklists, parallel workstreams. |
| [DESIGN.md](DESIGN.md) | Design tokens, typography, component patterns, theme behaviour. |
| [docs/KICKOFF-PROMPT.md](docs/KICKOFF-PROMPT.md) | First message for a fresh session. |
| [docs/design/](docs/design/) and [docs/reviews/](docs/reviews/) | Backend designs for upcoming weeks and dated review notes; read the design before building the week it covers. |

Read order for any task: this file → the relevant blueprint section → the module document → the code.

## Planned structure (blueprint §5)
pnpm + Turborepo monorepo:
- `apps/web`: Next.js App Router. Route groups `(public)` and `(bos)`, plus `/api/v1` for mobile, webhooks and ingest.
- `apps/field`: Expo Android app for field staff.
- `apps/tally-connector`: Windows service that reads Tally and pushes data outbound.
- `apps/voice-agent`: LiveKit Agents worker for live voice.
- `packages/domain`: commands, state machines, calculators, tax engine.
- `packages/db`: Drizzle schema, migrations, RLS SQL.
- `packages/ui`: web components.
- `packages/tokens`: design tokens shared by web and Android.
- `packages/contracts`: shared Zod API schemas.

## Architectural rules that span the codebase
- **One command layer.** UI (server actions), `/api/v1`, AI agents, the voice agent, imports and webhooks all mutate data only through typed domain commands in `packages/domain`. Never write to the DB from anywhere else.
- **Entity isolation via RLS.** Every business table has `entity_id`.
  - Each request runs inside a transaction opened by the single `withRequestContext()` helper, which calls `set_config('app.entity_ids', ..., true)` and related settings (transaction-scoped, safe with connection pooling). Importing the raw DB client anywhere else is a lint error.
  - Policies read the setting with `current_setting(..., true)` inside a subselect and deny when it is null, so RLS fails closed. Business tables use `FORCE ROW LEVEL SECURITY`.
  - The app connects as the non-superuser `app_user`, which does not own the tables. The Supabase service role is never used in request paths.
- **Cost data isolation, two permissions.** `procurement.rate.read` gates supplier rates (`vendor_quotes`, PO values, `tally_purchase_vouchers`). `finance.cost.read` gates `item_costs`, `job_cost_entries` and margins. Both are enforced by RLS on the tables and by whitelisted response DTOs. No AI agent principal holds either; cost figures shown to Executives come from report queries run under the viewer's own permissions.
- **Prices come only from Price Master tiers.** There are no discounts anywhere. Quote lines snapshot prices and the tax-rate version when the quote is created.
- **Deterministic core.** TDH, kW sizing, kit availability, the tax engine (effective-dated GST rates, place of supply, solar 70:30 composite supply, rupee rounding) and credit checks are pure, tested functions in `packages/domain`. LLMs never do this math.
- **Identity documents.** Aadhaar numbers are never stored or logged. Documents pass through the OCR masking step before storage and before any LLM call; only the last four digits and the masked copy are kept.
- **Dispatch gate.** A dispatch above the e-way bill threshold cannot leave "ready" without an e-way bill number recorded on it.
- **Append-only ledgers:** stock movements, payments, audit logs, price history.
- **Events via outbox.** State changes write `outbox_events` in the same transaction; Upstash QStash/Workflow delivers them to workers and agents.
- **AI agents are least-privilege service principals** (subject to RLS). They act only through commands, with an autonomy level of Suggest / Needs approval / Automatic. Customer WhatsApp content is untrusted input.
- **Webhooks:** verify signature → store in `webhook_inbox` → return 200 → process idempotently in a QStash worker.
- **Tally is read-only.** The connector pushes outbound to the BOS; the BOS never writes to Tally. Vouchers missing from the daily GUID snapshot become tombstones. The BOS is the operational stock authority; Tally holds statutory valuation.
- **Telecom compliance.** Outbound calls use DLT-registered numbers: 140-series for promotional, 160-series for service calls to leads with recorded consent. TRAI hours and DND scrubbing are enforced in code.
- **Money and time:** `numeric(14,2)` INR; timestamps as UTC `timestamptz`, displayed in IST; GST split by the entity's state code vs the place of supply.
- **Theming and print:** semantic CSS-variable tokens only (no hard-coded colours). The default theme is "System", with a Light/Dark override. PDFs and labels are HTML templates rendered by headless Chromium and always render light. Design tokens come from `DESIGN.md` (Phase 0 deliverable).
- **Deployment region:** Vercel functions are pinned to `bom1` (Mumbai), next to Supabase Mumbai. The voice-agent worker runs on LiveKit Cloud Agents hosting in the India region.
- **Product copy is plain language and final.** Every word a user can read (screen labels, buttons, empty states, error and success messages, notifications, WhatsApp and email templates, PDFs, labels, help text, voice replies) is written for non-technical staff and customers in plain English and plain Hindi. No technical terms, codes, stack traces or internal names ever reach a user; error codes map to plain sentences in the message catalogue. No placeholder, sample or dummy text ships anywhere; every string is the final, product-specific wording. The full rule and word list are in `DESIGN.md` §11, and CI fails on placeholder text.

## Claude Code tooling
Required plugins, MCP servers and skills per phase are defined in `.claude/tooling.json` (blueprint §20). The SessionStart hook `.claude/hooks/tooling-check.mjs` prints a `[tooling-check]` block at the start of each session.

- **At session start:** for entries marked "Plugins to confirm", check installed plugins with the plugin listing tool.
  - Then tell the user in one short message what is missing, with the install step and any sign-in needed.
  - Stay silent if everything is in place.
- **Before starting a new phase:** list and confirm the tools due in that phase. Flag a missing tool before doing work that depends on it.
- **Never** install plugins, add MCP servers or run install commands without the user's explicit go-ahead.
- **At a phase's exit gate:** update `currentPhase` in `.claude/tooling.json`.
- **Credentials** stay in local config or environment variables, never in `tooling.json`, `.mcp.json` or the repo.
- **Connection state (2026-09-27):** all ten directory plugins are enabled on the user's account; the Vercel and shadcn MCP servers live in `.mcp.json`; Supabase and Upstash are also registered at user scope and are connected (Upstash read-only by the user's choice); Sentry, Expo, AWS and GitHub MCP are not connected yet and are not needed before their phases (`gh` covers GitHub). The desktop chat cannot run an OAuth sign-in; the user authorises a server from the CLI (`claude`, then `/mcp`, Authenticate) or on claude.ai, and the session is reopened afterwards.
- **Hosted services:** the security suite and every migration run against the local Docker Postgres first; nothing is applied to a hosted Supabase project, and no Upstash or Vercel resource is created, without the user's go-ahead in that conversation.
