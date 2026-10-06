# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It holds rules only; status, history and decisions live in the documents linked below.

**Contents:** [Project](#project) · [Session routine](#session-routine) · [Where things live](#where-things-live) · [Working in this repo](#working-in-this-repo) · [Documentation map](#documentation-map) · [Architectural rules](#architectural-rules-that-span-the-codebase) · [Claude Code tooling](#claude-code-tooling)

## Project
Shakti Prime BOS is the business operating system for the Shakti group. Four selling entities (Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub, RCREF) share one team. It covers CRM with tele-calling, sales orders, inventory, projects/subsidy, finance with read-only Tally sync, HR and AI agents.

The approved master blueprint is [docs/01-blueprint.md](docs/01-blueprint.md). It is the source of truth for scope, stack, data model and phase order. Read the relevant section before building a module.

## Session routine
- Where the project stands (phase, work merged and next, hosted environments, test counts, deferred items, follow-ups): [docs/10-status.md](docs/10-status.md).
- What the client's people must do: [docs/13-client-packs/client-actions.md](docs/13-client-packs/client-actions.md); the developer's and owner's checklist for the deferred gate items: [docs/13-client-packs/exit-gate-actions.md](docs/13-client-packs/exit-gate-actions.md).
- What each merged pull request did: [CHANGELOG.md](CHANGELOG.md). Every owner decision, and the standing rules in force: [docs/11-decisions.md](docs/11-decisions.md).
- The owner starts each day in a new conversation with "start the day" (the `start-session` skill, also typed as `/start-session`) and ends it with "end the day" (the `end-session` skill).
- At the start of a session, follow the `start-session` skill: confirm the latest CI run on `main` is green (the merge workflow's own runs may send no email), then build from ROADMAP §3, the Phase 1 design first.
- Record a deferred gate item as it closes where its document says (the workshop answers in the workshop pack, the CA's golden set in ADR 0007, each spike's numbers in `docs/04-architecture-appendix/`).
- At the end of a session, follow the `end-session` skill: replace 10-status.md and add one CHANGELOG entry per merged pull request; never append status or history to this file.
- A slice goes from its run file (`docs/runs/phase1/<slug>.md`) to `main` and the hosted environments as [docs/runbooks/slice-integration.md](docs/runbooks/slice-integration.md) says, with the `integrate-slice` and `migrate-hosted` skills and the `slice-builder` and `slice-reviewer` agents.
- **Where work runs: the PC only.** Cloud sessions are paused ([DECISIONS](docs/11-decisions.md#standing-rules-in-force)).
  - Every slice is built, reviewed, merged with `main`, integrated and given its Linux baselines on the PC. Docker Desktop runs only the slices' databases and the Playwright image.
  - The lead session opens the pull requests and runs the hosted steps.
  - At most two slice builders run at once.
  - Every heavy command (whole-repository lint, typecheck, build, the security suite, journeys) waits its turn through the PC-wide lock `bash tools/integration/heavy.sh <command>`, because the PC has 8 GB of memory.
  - A whole-repository lint runs once, as a builder's final check.
  - The cloud procedure waits in [docs/runbooks/hybrid.md](docs/runbooks/hybrid.md) for when cloud sessions resume; a cloud session has `CLAUDE_CODE_REMOTE=true` and none of the PC's plugins or MCP servers.
- **Models and usage:** the `slice-builder` agent runs on Sonnet and the `slice-reviewer` on Opus at high effort (set in their files); the lead session runs on Opus at medium effort, chosen by the owner in the app.
  - The lead reports on running builders only when one finishes, stalls 20 minutes with the heavy-command lock free, or the PC runs low on memory, with no progress check-ins between.

## Where things live
| Area | Path |
|---|---|
| Commands (one file each), the registry, the runner | `packages/domain/src/commands/<module>`, `src/command/registry.ts`, `src/command` |
| Queries; state machines; tax engine; workshop defaults | `packages/domain/src/queries`; `src/state-machines`; `src/tax`; `src/workshop-defaults.ts` |
| Imports, file purposes, audit redaction, masking, telecom and Tally rules | `packages/domain/src/imports`, `src/files`, `src/audit`, `src/privacy`, `src/telecom`, `src/tally` |
| Inputs, DTOs, errors, permissions, event catalogue, `/api/v1` contracts | `packages/contracts/src` (`errors.ts`, `permissions.ts`, `events/catalogue.ts`, `api/`) |
| Schema, migrations, seeds, the testing lists | `packages/db/src/schema`, `packages/db/migrations`, `packages/db/seeds`, `packages/db/src/testing` |
| Suites on real Postgres | `packages/db/tests/security`, `packages/domain/tests`, `apps/web/tests` |
| Pages and routes | `apps/web/src/app/(public)`, `(bos)`, `api/v1`; the menu `apps/web/src/nav.ts`; page helpers `apps/web/src/screens` |
| Server actions; auth; the proxy | `apps/web/src/actions`; `apps/web/src/auth`; `apps/web/src/proxy.ts` |
| Workers (outbox publisher, event workers, file checks, imports, OCR) | `apps/web/src/workers` |
| Files, mail, field encryption, Sentry, print, Realtime, vendor harnesses | `apps/web/src/files`, `src/mail`, `src/crypto`, `src/observability`, `src/print`, `src/realtime`, `src/integrations` |
| Message catalogue; end-to-end journeys | `apps/web/messages/en.json`; `apps/web/e2e` |
| UI kit; tokens; copy lint | `packages/ui/src`; `packages/tokens/src`; `tools/copy-lint` |
| AWS stack; CI and merge workflows | `infra/aws/files.yaml`; `.github/workflows` |

Planned apps (blueprint §5), each created in its phase: `apps/field` (Expo Android app for field staff), `apps/tally-connector` (Windows service that reads Tally and pushes outbound), `apps/voice-agent` (LiveKit Agents worker); see [AGENTS §3](AGENTS.md#3-repository-layout-and-import-fences).

## Working in this repo

### Commands
- The full command list and setup are in [README](README.md#commands). In the desktop app on the PC (not in a cloud session), the browser pane starts the dev server as the `web` entry of `.claude/launch.json` (port 3000) and the clickable prototype as the `prototype` entry (port 4100; the pane cannot open it as a file).
- `pnpm --filter web js-budget` and `pnpm --filter web e2e` run after `pnpm build`; the journeys seed first and refuse a server that runs another build ([TESTING §5](docs/09-testing.md#5-end-to-end-and-later-layers)); `e2e:snap` runs them in the Linux Playwright image.
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` regenerate `docs/data/` and `docs/state-machines/`; a test fails when either is stale. The `spike:*` scripts run locally, never in CI.
- `pnpm build` must pass with no `.env`: `next build` loads every route module, so nothing may open a database connection or read a secret at import time (the auth instance is created on first use for this reason).

### CI, branches and merging
- What CI runs and when: [TESTING §6](docs/09-testing.md#6-what-ci-runs). How a pull request merges itself: [AGENTS §8](AGENTS.md#8-git-and-pull-requests). The `hold` label stops a merge; the merge workflow runs from `main` only, so a change to it takes effect after it merges.
- Never push to `main` directly: a private repository on the free plan cannot block it, and branch rules need a public repository, the client's organisation or a paid plan (the audit ([2026-09-audit](docs/14-reviews/2026-09-audit.md)) M45).
- Branch the next slice from `main` after the previous pull request has merged; never stack. A slice built while others merged takes `main` by a merge commit, never a rebase, and its migrations move after `main`'s last one with journal times after `main`'s, because the migrator skips a migration older than the last one applied.
- Taking `main` into a slice, check every function, check constraint and foreign key the slice's migrations redefine against `main`'s latest version: a moved migration that redefines `app.platform_only_permissions()` or the `activities` type check drops what `main` added, and a merge that the conflicts do not show is still a clash ([slice-integration §10](docs/runbooks/slice-integration.md#10-lessons)).
- CI is trimmed because GitHub's free plan allows 2,000 Actions minutes a month ([DECISIONS](docs/11-decisions.md)). When they run out, GitHub starts no job: the run fails with no log, and the check run's annotation names billing. The repository is public for now, so its minutes are free; before it goes private, an Actions budget is set.

### Tests
- How to run everything, one file or one case: [TESTING §7](docs/09-testing.md#7-running-tests-locally). Workspace names are `web`, `@shakti/db`, `@shakti/domain`, `@shakti/contracts`, `@shakti/tokens`, `@shakti/ui` and `@shakti/copy-lint`.
- After every test edit, run `pnpm typecheck` and lint the folder you edited (`pnpm exec eslint --max-warnings 0 <folder>`, for example `packages/domain`); the whole-repository `pnpm lint` is the final check, through the heavy-command lock.
- Turbo caches every task except the three set to `cache: false` in `turbo.json` (`test:security`, `test:e2e` and `db:generate`): a task that prints "cache hit, replaying logs" did not run; force it with `pnpm exec turbo run <task> --force` (`pnpm test -- --force` hands the flag to vitest, which rejects it).
- Never report the security suite as verified without running it against the local Docker Postgres.

### Local database
- `docker compose up -d --wait` starts the Supabase Postgres 17 image on `127.0.0.1:54322`; `.env` comes from `.env.example`. An older `.env` lacks later lines: without `DATABASE_URL_OUTBOX` and `OUTBOX_PUBLISHER_PASSWORD` `pnpm db:migrate` stops, and the reader tests need `DATABASE_URL_READER` and `APP_READER_PASSWORD`; copy them across.
- `pnpm test:security` migrates and seeds first, then runs the db, domain and web suites (each suite prepares the database itself).
- `pnpm db:migrate` sets the role passwords only when it creates the roles; `--rotate-passwords` re-applies them locally. On a hosted database the rotation goes through the migrate workflow's `rotate_passwords` input ([DEPLOY §5](docs/runbooks/DEPLOY.md#5-rotating-a-secret)).
- `pnpm db:seed` is safe to re-run after any Admin edit: it writes only code-owned columns (keys, codes, kinds, segments, channels), adds missing rows (a new stage goes last when its position is taken), restores the grants of roles no Executive has customised (`roles.customised_at` null), gives a customised role only permissions created after its customisation, and never overwrites an entity.
- First sign-in locally: `pnpm --filter web invite-executive -- --email <you> --name <name>` prints the set-password link (add `--force` when the suites have already created Executive users).
- To check a flow in the browser without an authenticator app, use a person in a role outside Executive, GM and Accounts.
  - Make one as the first Executive: Admin › Team members › Invite a person (a tele-caller of Shakti Supreme is enough). The console mailer prints the set-password link in the dev server log (on the PC, read it with the desktop app's preview logs); the forgotten-password screen sends a new link the same way.
  - The local Turnstile test keys always pass.

### Adding a table or a command
- A table: follow [AGENTS §6](AGENTS.md#6-database-changes) step by step (schema, generated and custom migrations, the testing lists, the role × company fixture, `app_reader` grants, `NARROWER`, `enum-sync`, partitions, a new login role).
- A command: follow [AGENTS §5](AGENTS.md#5-domain-commands) (contract, `defineCommand` with `auditFields` and `peopleOnly`, registry, the denied, wrong-company and happy-path tests, server action through `executeCommand()` or `executeQuery()`, `screenAccess()` on the page). It also holds the audit trail, events and outbox, and idempotency-key rules.
- Import fences (which module may import which): [AGENTS §3](AGENTS.md#3-repository-layout-and-import-fences). The raw database client is importable only inside `packages/db`; everything else uses `withRequestContext()`; relative imports have no `.js` extension (Turbopack does not resolve them).

### Environment variables
- Every variable a task reads must be listed for that task in `turbo.json`: Turbo runs in strict env mode and CI has no `.env`, so a variable that works locally and is "not set" in CI is missing from that list.
- Adding a package that is a peer of `drizzle-orm` (as `@upstash/redis` is) splits `drizzle-orm` into two instances and breaks typecheck across packages; `pnpm dedupe` repairs it.
- A production runtime counts as hosted unless `BOS_ENVIRONMENT=local` with a `BETTER_AUTH_URL` on localhost, 127.0.0.1 or [::1] and not on Vercel (the `next start` of the end-to-end journeys and Lighthouse; never set on a hosted environment).
- A hosted runtime refuses to start with a missing or unsafe value: a missing required variable, a published or short secret, Cloudflare's Turnstile test keys, a non-https URL, or any `FIELD_ENCRYPTION_KEY` (a hosted environment seals fields with its KMS key). The list is [DEPLOY §1](docs/runbooks/DEPLOY.md#1-before-the-first-deploy-once-per-environment) step 12 (`productionConfigProblems()` in `apps/web/src/auth/deps.ts`, run from `instrumentation.ts`).
- `MAILER` is `ses` (Amazon SES, which needs `SES_FROM`) or `log`; production starts only with `ses`, so it waits for the client's verified domain ([DEPLOY §1](docs/runbooks/DEPLOY.md#1-before-the-first-deploy-once-per-environment)). Locally and in CI the in-memory store and the console mailer are used, and with no QStash variables the outbox nudge runs the publisher in process.

### Copy
- Every user-facing string goes in `apps/web/messages/en.json`, in English; Roman-script Hinglish is written only in caller scripts and voice prompts (`docs/08-design-system.md` §11.5, ADR 0014). The full rule is [AGENTS §4a](AGENTS.md#4a-product-copy) and `docs/08-design-system.md` §11.
- `pnpm copy-lint` fails on banned words, placeholder text, exclamation marks, any Devanagari character, keys ending in `title` or `Title` over 60 characters, `app.name` over 30 characters and button labels over 24 characters (the button key names are listed in `tools/copy-lint/copy-lint.config.json`; add a new button key there).
- "request", "token" and the other words in `docs/08-design-system.md` §11 are banned in copy, so an error sentence says what happened and what to do next.
- Domain errors carry a `details.reason` that maps to an `errors.*` catalogue key; a command may name catalogue reasons for the constraints it can race against through `constraintReasons`.

### Secret scan and dependencies
- CI runs gitleaks over the whole git history of every branch on GitHub, so a key-like literal fails the build even after it is removed from the tree, and a pushed backup branch is scanned too. `.gitleaksignore` lists the accepted historic fingerprints.
- Never force-push or delete a remote branch: the free plan does not enforce it, so it is a rule. Rewritten work goes up under a fresh branch name; the merge workflow deletes merged branches.
- A secret used only by tests must be a low-entropy phrase (the `TEST_AUTH_SECRET` in `apps/web/tests/auth.test.ts` is the pattern), never a random string.
- Reproduce the scan from the repository root with `. tools/integration/lib.sh && MSYS_NO_PATHCONV=1 docker run --rm -v "$(docker_path "$PWD"):/repo" "$GITLEAKS_IMAGE" git /repo --redact --exit-code 1` (`docker_path` gives the Windows form of the folder in Git Bash and the path itself on Linux); `tools/integration/integrate.sh` runs the same scan over a branch's own commits.
- Dependabot opens grouped minor and patch bumps for production and development dependencies, one pull request per GitHub Actions bump (they are pinned by commit SHA), and holds TypeScript, ESLint and `@types/node` majors; merge a bump when its CI run is green.

### Approved documents
`docs/`, `docs/08-design-system.md`, `CLAUDE.md` and `AGENTS.md` are excluded from Prettier; edit them by hand only, in single targeted lines. They state how things are, with no change-log wording; history goes to `CHANGELOG.md`.

## Documentation map
[docs/00-start-here.md](docs/00-start-here.md) is the guide: what each document is for, who reads it and in what order.

| Document | Use it for |
|---|---|
| [docs/00-start-here.md](docs/00-start-here.md) | The guide to the documents, the read order and the generated files. |
| [docs/01-blueprint.md](docs/01-blueprint.md) | Scope, stack, data model, phase order. Governs on conflict. |
| [docs/02-prd.md](docs/02-prd.md) | Requirements with IDs and acceptance criteria; non-functional requirements. |
| [docs/03-roadmap.md](docs/03-roadmap.md) | Phases, week plan for Phase 0, exit-gate checklists, parallel workstreams. |
| [docs/03-roadmap-appendix/](docs/03-roadmap-appendix/) | The Phase 1 design (`phase1.md`) and the backend weeks 3 to 5 design; read the design before building what it covers. |
| [docs/04-architecture.md](docs/04-architecture.md) | Runtime components, request lifecycle, command layer, events, integrations, ADR index. |
| [docs/04-architecture-appendix/](docs/04-architecture-appendix/) | Spike notes with measured numbers. |
| [docs/05-database.md](docs/05-database.md) | Schema conventions, RLS templates, table catalogue, migrations, backups. |
| [docs/06-api.md](docs/06-api.md) | `/api/v1` conventions, endpoint catalogue, webhook and connector contracts. |
| [docs/07-security.md](docs/07-security.md) | Threat model, auth, permission catalogue, data protection, AI and telecom compliance. |
| [docs/08-design-system.md](docs/08-design-system.md) | Design tokens, typography, component patterns, theme behaviour, copy rules. |
| [docs/09-testing.md](docs/09-testing.md) | Test layers, the security suite, generated files, what CI runs, running tests locally. |
| [docs/10-status.md](docs/10-status.md) | Where the project stands: the only place for status and counts. |
| [docs/11-decisions.md](docs/11-decisions.md) | Every owner decision, with its date and where it is applied, and the standing rules in force. |
| [docs/12-glossary.md](docs/12-glossary.md) | The business and technical terms the documents use, and the [slice codes](docs/12-glossary.md#slice-codes) (P3, C1, X1 and the rest). |
| [docs/13-client-packs/](docs/13-client-packs/README.md) | The client packs for the exit gate, including [client-actions](docs/13-client-packs/client-actions.md) (what the client's people must do) and [exit-gate-actions](docs/13-client-packs/exit-gate-actions.md) (the developer's and owner's checklist for the deferred gate items). |
| [docs/14-reviews/](docs/14-reviews/README.md) | Dated review notes, including the production-readiness audit of 27-09-2026 and its resolution record ([2026-09-audit](docs/14-reviews/2026-09-audit.md)). |
| [docs/adr/](docs/adr/) | Architecture decision records. |
| [README.md](README.md) | Setup, the repository's parts and every command. |
| [CHANGELOG.md](CHANGELOG.md) | One entry per merged pull request, by phase and wave. |
| [AGENTS.md](AGENTS.md) | Working method, conventions, the command and table recipes, import fences, definition of done. |
| [docs/runs/phase1/](docs/runs/phase1/README.md) | One run file per slice in flight: brief, report, review findings, integration notes. |
| [docs/runbooks/DEPLOY.md](docs/runbooks/DEPLOY.md) | Hosted environments: secrets, migrations, the first Executive, secret rotation. |
| [docs/runbooks/slice-integration.md](docs/runbooks/slice-integration.md) | How a slice is built, reviewed, merged with `main`, checked and taken to the hosted environments. |
| [docs/runbooks/hybrid.md](docs/runbooks/hybrid.md) | What runs in a cloud session and what on the PC; the cloud environment; moving a session between them. |
| [docs/runbooks/accounts.md](docs/runbooks/accounts.md) | Every outside service and account: plan, use, where its bill is, what changes before production. |
| [docs/runbooks/INCIDENTS.md](docs/runbooks/INCIDENTS.md) | What to do when the site is down, updates are stuck, a migration fails, a deploy is bad or a secret leaks. |
| [docs/runbooks/files-setup.md](docs/runbooks/files-setup.md) | The owner's steps for the AWS file storage stack per environment. |
| [docs/runbooks/tooling.md](docs/runbooks/tooling.md) | How each Claude Code plugin and MCP server is connected. |
| [docs/data/](docs/data/), [docs/data/EVENTS.md](docs/data/EVENTS.md), [docs/state-machines/](docs/state-machines/) | Generated: the ERD and data dictionary, the event catalogue, the state-machine specifications. Never edited by hand. |
| `tools/integration/` | The scripts those runbooks use: worktree set-up, the heavy-command lock, the integration run, the merge helpers, the migration renumbering, the cloud setup and the document link check (`check-doc-links.py`). |
| Skills in `.claude/skills/` | [start-session](.claude/skills/start-session/SKILL.md) and [end-session](.claude/skills/end-session/SKILL.md) (a session's start and close), [integrate-slice](.claude/skills/integrate-slice/SKILL.md) and [migrate-hosted](.claude/skills/migrate-hosted/SKILL.md) (a slice onto `main` and the hosted environments), [add-command](.claude/skills/add-command/SKILL.md) and [add-table](.claude/skills/add-table/SKILL.md) (the two recipes' checklists). |
| Agents in `.claude/agents/` | [slice-builder](.claude/agents/slice-builder.md) (builds a slice from its run file) and [slice-reviewer](.claude/agents/slice-reviewer.md) (reviews a slice before it merges). |

Read order for any task: this file → the relevant blueprint section → the module document → the code.

## Architectural rules that span the codebase
- **One command layer.** UI (server actions), `/api/v1`, AI agents, the voice agent, imports and webhooks all mutate data only through typed domain commands in `packages/domain`. Never write to the DB from anywhere else. `apps/web` reaches the database only through `executeCommand()` and `executeQuery()`.
- **Entity isolation via RLS.** Every business table has `entity_id`.
  - Each request runs inside a transaction opened by the single `withRequestContext()` helper, which calls `set_config('app.entity_ids', ..., true)` and related settings (transaction-scoped, safe with connection pooling). Importing the raw DB client anywhere else is a lint error.
  - Policies read the setting with `current_setting(..., true)` inside a subselect and deny when it is null, so RLS fails closed. Business tables use `FORCE ROW LEVEL SECURITY`.
  - The app connects as the non-superuser `app_user`, which does not own the tables; queries may read on the read-only `app_reader` pool. The Supabase service role is never used in request paths.
  - Customers are shared across the companies through `account_entities` (ADR 0008).
- **Cost data isolation, two permissions.** `procurement.rate.read` gates supplier rates (`vendor_quotes`, PO values, `tally_purchase_vouchers`). `finance.cost.read` gates `item_costs`, `job_cost_entries` and margins. Both are enforced by RLS on the tables and by whitelisted response DTOs. No AI agent principal holds either; cost figures shown to Executives come from report queries run under the viewer's own permissions.
- **Prices come only from Price Master tiers.** There are no discounts anywhere. Quote lines snapshot prices and the tax-rate version when the quote is created.
- **Deterministic core.** TDH, kW sizing, kit availability, the tax engine (effective-dated GST rates, place of supply, solar 70:30 composite supply, rupee rounding) and credit checks are pure, tested functions in `packages/domain`. LLMs never do this math. Tax rate values and the number format are workshop inputs, not seeded.
- **Identity documents.** Aadhaar numbers are never stored or logged. Documents pass through the OCR masking step before storage and before any LLM call; only the last four digits and the masked copy are kept.
- **Dispatch gate.** A dispatch above the e-way bill threshold cannot leave "ready" without an e-way bill number recorded on it.
- **Append-only ledgers:** stock movements, payments, audit logs, price history.
- **Events via outbox.** State changes write `outbox_events` in the same transaction; Upstash QStash/Workflow delivers them to workers and agents.
- **The workers principal holds platform-only permissions.** `system:workers` holds only permissions no person's role holds (`files.process`, `crm.score.refresh`), never a person's `crm.*` or `sales.*` grant, and its jobs read and write through narrow definers that check that permission, so the agents' customer rules keep applying to it (ADR 0020).
- **AI agents are least-privilege service principals** (subject to RLS). They act only through commands, with an autonomy level of Suggest / Needs approval / Automatic. Customer WhatsApp content is untrusted input.
- **Webhooks:** verify signature → store in `webhook_inbox` → return 200 → process idempotently in a QStash worker.
- **Tally is read-only.** The connector pushes outbound to the BOS; the BOS never writes to Tally. Vouchers missing from the daily GUID snapshot become tombstones. The BOS is the operational stock authority; Tally holds statutory valuation.
- **Telecom compliance.** Outbound calls use DLT-registered numbers: 140-series for promotional, 160-series for service calls to leads with recorded consent. TRAI hours and DND scrubbing are enforced in code.
- **Money and time:** `numeric(14,2)` INR; timestamps as UTC `timestamptz`, displayed in IST; GST split by the entity's state code vs the place of supply.
- **Theming and print:** semantic CSS-variable tokens only (no hard-coded colours). The default theme is "System", with a Light/Dark override. PDFs and labels are HTML templates rendered by headless Chromium and always render light. Design tokens come from `docs/08-design-system.md`.
- **Deployment region:** Vercel functions are pinned to `bom1` (Mumbai), next to Supabase Mumbai. The voice-agent worker runs on LiveKit Cloud Agents hosting in the India region.
- **Product copy is plain language and final.** Every word a user can read is written for non-technical staff and customers in plain English; Roman-script Hinglish is used only for caller scripts, the voice agent's speech and training videos (ADR 0014). No technical terms, codes, stack traces or internal names ever reach a user; error codes map to plain sentences in the message catalogue. No placeholder, sample or dummy text ships anywhere. The full rule and word list are in `docs/08-design-system.md` §11, and CI fails on placeholder text.

## Claude Code tooling
Required plugins, MCP servers and skills per phase are defined in `.claude/tooling.json` (blueprint §20). The SessionStart hook `.claude/hooks/tooling-check.mjs` prints a `[tooling-check]` block at the start of each session. How each tool is connected, and how to sign one in again, is in [docs/runbooks/tooling.md](docs/runbooks/tooling.md).

- **At session start on the PC:** for entries marked "Plugins to confirm", check installed plugins with the plugin listing tool. In a cloud session the hook prints a cloud note instead: the plugins and MCP servers exist only on the PC, and nothing is installed there.
  - Then tell the user in one short message what is missing, with the install step and any sign-in needed.
  - Stay silent if everything is in place.
- **Before starting a new phase:** list and confirm the tools due in that phase. Flag a missing tool before doing work that depends on it.
- **Never** install plugins, add MCP servers or run install commands without the user's explicit go-ahead.
- **At a phase's exit gate:** update `currentPhase` in `.claude/tooling.json`.
- **Credentials** stay in local config or environment variables, never in `tooling.json`, `.mcp.json` or the repo.
- **Hosted services:** the security suite and every migration run against the local Docker Postgres first. Nothing is applied to a hosted Supabase project, and no Upstash or Vercel resource is created, without the owner's go-ahead. The standing go-ahead and its scope are one row of [DECISIONS](docs/11-decisions.md); ask before anything outside it. Hosted steps run from the PC ([hybrid](docs/runbooks/hybrid.md#8-what-stays-on-the-pc-and-why)).
