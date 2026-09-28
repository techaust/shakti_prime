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
| `packages/ui`        | Web components on the design tokens (shadcn/ui based)                              |
| `tools/copy-lint`    | CI check over message catalogues and templates (`DESIGN.md` §11)                   |

## Setup

1. Node 24 and Corepack: `corepack enable` (pnpm is pinned in `package.json`).
2. Docker Desktop, then `docker compose up -d --wait` for local Postgres on port 54322.
3. `cp .env.example .env` (local Postgres, the auth module's connection, Better Auth, Cloudflare's Turnstile test keys; Upstash left empty uses an in-memory store; locally the console mailer prints invite links to the terminal)
4. `pnpm install`
5. `pnpm db:migrate` then `pnpm db:seed`
6. First sign-in: `pnpm --filter web invite-executive -- --email <you> --name "<name>"` prints the set-password link (add `--force` when the suites have already created Executive users), then `pnpm --filter web dev` and open the link.

## Commands

| Command                                      | What it does                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm lint`                                  | ESLint over the whole repo, warnings fail                                                |
| `pnpm format:check`                          | Prettier check                                                                           |
| `pnpm typecheck`                             | `tsc --noEmit` per workspace                                                             |
| `pnpm test`                                  | Unit tests (Vitest) per workspace                                                        |
| `pnpm test:security`                         | Security suite and command tests against real Postgres                                   |
| `pnpm copy-lint`                             | Banned words, placeholder text and Devanagari in the catalogue                           |
| `pnpm db:generate`                           | Drizzle migration from the schema                                                        |
| `pnpm db:migrate`                            | Apply migrations (add `--rotate-passwords` to reset role passwords)                      |
| `pnpm db:seed`                               | Seed org and reference data; safe to re-run                                              |
| `pnpm db:verify`                             | Check applied migrations against the journal hashes                                      |
| `pnpm coverage`                              | Unit test coverage summary per workspace (report only)                                   |
| `pnpm build`                                 | Production build of the workspaces with a build step (`web`, `@shakti/tokens`)           |
| `pnpm format`                                | Prettier write                                                                           |
| `pnpm --filter web dev`                      | Run the web app locally                                                                  |
| `pnpm db:docs`                               | Regenerate the ERD and data dictionary in `docs/data`                                    |
| `pnpm --filter @shakti/domain machines:docs` | Regenerate the state-machine specifications in `docs/state-machines`                     |
| `pnpm spike:print`                           | Print spike: A4 PDFs and QR label sheets with headless Chromium (`docs/spikes/print.md`) |
| `pnpm spike:ocr`                             | OCR masking spike on document photos (`docs/spikes/ocr.md`)                              |
| `pnpm --filter web spike:exotel`             | Exotel click-to-dial spike (`docs/spikes/exotel.md`)                                     |
| `pnpm --filter web spike:whatsapp`           | WhatsApp sandbox send and receive spike (`docs/spikes/whatsapp.md`)                      |
| `pnpm --filter web spike:voice`              | Speech latency and pronunciation spike (`docs/spikes/voice.md`)                          |
| `pnpm --filter web spike:tally`              | Tally AlterID read spike (`docs/spikes/tally.md`)                                        |
| `pnpm --filter web realtime-spike`           | Realtime spike against a hosted Supabase project (`docs/spikes/realtime.md`)             |
| `pnpm --silent --filter web realtime-keys`   | Print a new ES256 signing key for Realtime tokens (`docs/runbooks/DEPLOY.md`)            |
| `pnpm --filter web qstash-schedule`          | Create or update the minute schedule of the outbox publisher                             |
| `pnpm --filter web invite-executive`         | Print a set-password link for the first Executive                                        |

CI runs lint, format, copy lint, typecheck, unit tests, a check that generated files are committed, the production build, a secret scan, a dependency audit at moderate severity, the migration hash check and the security suite on every pull request and every push to `main`. A pull request merges itself once CI passes on its latest commit (`.github/workflows/automerge.yml`, `AGENTS.md` §8); the `hold` label stops that. Deploying to a hosted environment follows `docs/runbooks/DEPLOY.md`.
