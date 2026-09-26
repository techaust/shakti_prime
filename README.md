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
2. Docker Desktop, then `docker compose up -d` for local Postgres on port 54322.
3. `cp .env.example .env` (local Postgres, the auth module's connection, Better Auth, Cloudflare's Turnstile test keys; Upstash left empty uses an in-memory store)
4. `pnpm install`
5. `pnpm db:migrate` then `pnpm db:seed`

## Commands

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `pnpm lint`             | ESLint over the whole repo, warnings fail                        |
| `pnpm format:check`     | Prettier check                                                   |
| `pnpm typecheck`        | `tsc --noEmit` per workspace                                     |
| `pnpm test`             | Unit tests (Vitest) per workspace                                |
| `pnpm test:security`    | Security suite and command tests against real Postgres           |
| `pnpm copy-lint`        | Banned words, placeholder text and language parity in catalogues |
| `pnpm db:generate`      | Drizzle migration from the schema                                |
| `pnpm --filter web dev` | Run the web app locally                                          |

CI runs lint, typecheck, test, the security suite and the copy lint on every pull request.
