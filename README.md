# Shakti Prime BOS

Business operating system for the Shakti group (Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub, RCREF). Repository: `github.com/techaust/shakti_prime`. The approved blueprint is [docs/BLUEPRINT.md](docs/BLUEPRINT.md); working conventions are in [AGENTS.md](AGENTS.md); Claude Code guidance and the documentation map are in [CLAUDE.md](CLAUDE.md). Where the project stands is in [docs/STATUS.md](docs/STATUS.md), its history in [CHANGELOG.md](CHANGELOG.md) and the owner's decisions in [docs/DECISIONS.md](docs/DECISIONS.md).

## Repository

pnpm + Turborepo monorepo.

| Path                 | Purpose                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router: public site, BOS app, `/api/v1`                                                                                                                   |
| `apps/web/e2e`       | Playwright journeys with axe, their seed and the Linux screenshot baselines ([docs/TESTING.md §5](docs/TESTING.md#5-end-to-end-and-later-layers))                     |
| `packages/contracts` | Zod schemas, DTOs, error codes, permission catalogue                                                                                                                  |
| `packages/db`        | Drizzle schema, migrations, RLS SQL, `withRequestContext()`, seeds, security suite                                                                                    |
| `packages/domain`    | Commands, command runner, state machines, calculators                                                                                                                 |
| `packages/tokens`    | Design tokens from `DESIGN.md` for web and Android                                                                                                                    |
| `packages/ui`        | Web components on the design tokens (shadcn/ui based)                                                                                                                 |
| `tools/copy-lint`    | CI check over message catalogues and templates (`DESIGN.md` §11)                                                                                                      |
| `tools/integration`  | Scripts for slice worktrees, the integration run and the document link check ([docs/runbooks/slice-integration.md](docs/runbooks/slice-integration.md))               |
| `infra/aws`          | The CloudFormation template of each environment's file storage ([docs/runbooks/files-setup.md](docs/runbooks/files-setup.md))                                         |
| `.claude`            | Claude Code settings, hooks, skills, agent definitions and the tooling list per phase                                                                                 |
| `.github`            | CI, the merge-on-green, migrate and weekly audit workflows, Dependabot and the pull-request template                                                                  |
| `docs`               | The blueprint, the module documents, ADRs, designs, runbooks, reviews, spikes and the generated data and state-machine documents ([CLAUDE.md](CLAUDE.md) has the map) |

## Setup

1. Node 24 and Corepack: `corepack enable` (pnpm is pinned in `package.json`).
2. Docker Desktop, then `docker compose up -d --wait` for local Postgres on port 54322.
3. `cp .env.example .env` (local Postgres, the auth module's connection, Better Auth, Cloudflare's Turnstile test keys; Upstash left empty uses an in-memory store; locally the console mailer prints invite links to the terminal)
4. `pnpm install`
5. `pnpm db:migrate` then `pnpm db:seed`
6. First sign-in: `pnpm --filter web invite-executive -- --email <you> --name "<name>"` prints the set-password link (add `--force` when the suites have already created Executive users), then `pnpm --filter web dev` and open the link.

## Working in a cloud session

Slices are built and reviewed in Claude Code cloud sessions; merging with `main` and the hosted steps run on the owner's PC. What runs where, the cloud environment and its setup script (`tools/integration/cloud-setup.sh`), and how a session moves between the cloud and the PC: [docs/runbooks/hybrid.md](docs/runbooks/hybrid.md).

## Commands

| Command                                        | What it does                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                    | ESLint over the whole repo, warnings fail                                                                                                                                                                            |
| `pnpm format:check`                            | Prettier check                                                                                                                                                                                                       |
| `pnpm typecheck`                               | `tsc --noEmit` per workspace                                                                                                                                                                                         |
| `pnpm test`                                    | Unit tests (Vitest) per workspace                                                                                                                                                                                    |
| `pnpm test:security`                           | Security suite and command tests against real Postgres                                                                                                                                                               |
| `pnpm test:e2e`                                | Builds, then the end-to-end journeys (`pnpm --filter web e2e`) through Turbo, never cached                                                                                                                           |
| `pnpm --filter web e2e`                        | After `pnpm build`: seeds, then the Playwright journeys with axe against the production build (`docs/TESTING.md` §5)                                                                                                 |
| `pnpm --filter web e2e:snap`                   | The same journeys with the screenshot comparisons, in the Linux Playwright image (`-- --update-snapshots` makes the baselines)                                                                                       |
| `pnpm --filter web e2e:seed`                   | Seeds the people and rows the journeys use (set-password links are single-use, so seed again before a rerun)                                                                                                         |
| `pnpm copy-lint`                               | Banned words, placeholder text, exclamation marks, Devanagari and the length limits of buttons and titles in the catalogue                                                                                           |
| `pnpm db:generate`                             | Drizzle migration from the schema                                                                                                                                                                                    |
| `pnpm db:migrate`                              | Apply migrations to the database of `.env` (add `--rotate-passwords` to set the role passwords again; a hosted database only through the migrate workflow, [DEPLOY §5](docs/runbooks/DEPLOY.md#5-rotating-a-secret)) |
| `pnpm db:seed`                                 | Seed org and reference data; safe to re-run                                                                                                                                                                          |
| `pnpm db:verify`                               | Check applied migrations against the journal hashes                                                                                                                                                                  |
| `pnpm coverage`                                | Unit test coverage summary per workspace (report only)                                                                                                                                                               |
| `pnpm build`                                   | Production build of the workspaces with a build step (`web`, `@shakti/tokens`)                                                                                                                                       |
| `pnpm --filter web js-budget`                  | After `pnpm build`: first-load JavaScript per page against `apps/web/js-budget.json`                                                                                                                                 |
| `pnpm format`                                  | Prettier write                                                                                                                                                                                                       |
| `pnpm --filter web dev`                        | Run the web app locally                                                                                                                                                                                              |
| `pnpm --filter web start`                      | After `pnpm build`: serve the production build; with `BOS_ENVIRONMENT=local` it runs as a local production run (the journeys and Lighthouse)                                                                         |
| `pnpm db:docs`                                 | Regenerate the ERD, the data dictionary and the event catalogue in `docs/data`                                                                                                                                       |
| `pnpm --filter @shakti/domain machines:docs`   | Regenerate the state-machine specifications in `docs/state-machines`                                                                                                                                                 |
| `pnpm --filter @shakti/tokens build`           | Regenerate the token CSS and the app icon from `packages/tokens/src`                                                                                                                                                 |
| `pnpm spike:print`                             | Print spike: A4 PDFs and QR label sheets with headless Chromium (`docs/spikes/print.md`)                                                                                                                             |
| `pnpm spike:ocr`                               | OCR masking spike on document photos (`docs/spikes/ocr.md`)                                                                                                                                                          |
| `pnpm spike:import`                            | Import scale spike: 50,000 lead rows uploaded, previewed and committed (`docs/spikes/import-scale.md`)                                                                                                               |
| `pnpm spike:lists`                             | List, board, search and Activity log latency at 50,000 leads (`docs/spikes/lists.md`)                                                                                                                                |
| `pnpm spike:account360`                        | Account 360, timeline and customers list latency (PRD CRM-07, `docs/spikes/account360.md`)                                                                                                                           |
| `pnpm --filter @shakti/domain spike:catalogue` | Query plans of the catalogue grid and the price change log at 5,000 items                                                                                                                                            |
| `pnpm --filter @shakti/domain spike:quotes`    | Query plans of the quote list, its search, Account 360's quotes and the board cards at 20,000 quotes                                                                                                                 |
| `pnpm --filter web spike:exotel`               | Exotel click-to-dial spike (`docs/spikes/exotel.md`)                                                                                                                                                                 |
| `pnpm --filter web spike:whatsapp`             | WhatsApp sandbox send and receive spike (`docs/spikes/whatsapp.md`)                                                                                                                                                  |
| `pnpm --filter web spike:voice`                | Speech latency and pronunciation spike (`docs/spikes/voice.md`)                                                                                                                                                      |
| `pnpm --filter web spike:tally`                | Tally AlterID read spike (`docs/spikes/tally.md`)                                                                                                                                                                    |
| `pnpm --filter web realtime-spike`             | Realtime spike against a hosted Supabase project (`docs/spikes/realtime.md`)                                                                                                                                         |
| `pnpm --silent --filter web realtime-keys`     | Print a new ES256 signing key for Realtime tokens (`docs/runbooks/DEPLOY.md`)                                                                                                                                        |
| `pnpm --filter web qstash-schedule`            | Create or update the schedules: the outbox publisher each minute, the lead rescoring each night                                                                                                                      |
| `pnpm --filter web invite-executive`           | Print a set-password link for the first Executive                                                                                                                                                                    |

What CI runs, and when, is in [docs/TESTING.md §6](docs/TESTING.md#6-what-ci-runs); a pull request merges itself once CI passes on its latest commit ([AGENTS.md §8](AGENTS.md#8-git-and-pull-requests)), and the `hold` label stops that. Deploying to a hosted environment follows [docs/runbooks/DEPLOY.md](docs/runbooks/DEPLOY.md); when something goes wrong, [docs/runbooks/INCIDENTS.md](docs/runbooks/INCIDENTS.md).
