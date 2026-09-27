# Shakti Prime BOS

Business operating system for the Shakti group (Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub, RCREF). The approved blueprint is [docs/BLUEPRINT.md](docs/BLUEPRINT.md); working conventions are in [AGENTS.md](AGENTS.md); Claude Code guidance is in [CLAUDE.md](CLAUDE.md).

## Repository

pnpm + Turborepo monorepo.

| Path                 | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router: public site, BOS app, `/api/v1`                                |
| `packages/contracts` | Zod schemas, DTOs, error codes, permission catalogue                               |
| `packages/db`        | Drizzle schema, migrations, RLS SQL, `withRequestContext()`, seeds, security suite |
| `packages/domain`    | Commands, command runner, state machines, calculators                              |
| `packages/tokens`    | Design tokens from `DESIGN.md` for web and Android                                 |
| `tools/copy-lint`    | CI check over message catalogues and templates (`DESIGN.md` §11)                   |

## Setup

1. Node 24 and Corepack: `corepack enable` (pnpm is pinned in `package.json`).
2. Docker Desktop, then `docker compose up -d --wait` for local Postgres on port 54322.
3. `cp .env.example .env` (local Postgres, the auth module's connection, Better Auth, Cloudflare's Turnstile test keys; Upstash left empty uses an in-memory store; `MAILER=console` prints invite links to the terminal)
4. `pnpm install`
5. `pnpm db:migrate` then `pnpm db:seed`
6. First sign-in: `pnpm --filter web invite-executive -- --email <you> --name "<name>"` prints the set-password link (add `--force` when the suites have already created Executive users), then `pnpm --filter web dev` and open the link.

## Commands

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm lint`             | ESLint over the whole repo, warnings fail                           |
| `pnpm format:check`     | Prettier check                                                      |
| `pnpm typecheck`        | `tsc --noEmit` per workspace                                        |
| `pnpm test`             | Unit tests (Vitest) per workspace                                   |
| `pnpm test:security`    | Security suite and command tests against real Postgres              |
| `pnpm copy-lint`        | Banned words, placeholder text and Devanagari in the catalogue      |
| `pnpm db:generate`      | Drizzle migration from the schema                                   |
| `pnpm db:migrate`       | Apply migrations (add `--rotate-passwords` to reset role passwords) |
| `pnpm db:seed`          | Seed org and reference data; safe to re-run                         |
| `pnpm db:verify`        | Check applied migrations against the journal hashes                 |
| `pnpm coverage`         | Unit test coverage summary per workspace (report only)              |
| `pnpm build`            | Production build of every workspace                                 |
| `pnpm format`           | Prettier write                                                      |
| `pnpm --filter web dev` | Run the web app locally                                             |

CI runs lint, format, copy lint, typecheck, unit tests, a check that generated files are committed, the production build, a secret scan, a dependency audit at moderate severity, the migration hash check and the security suite on every pull request and every push to `main`. A pull request merges itself once CI passes on its latest commit (`.github/workflows/automerge.yml`, `AGENTS.md` §8); the `hold` label stops that. Deploying to a hosted environment follows `docs/runbooks/DEPLOY.md`.
