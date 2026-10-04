# ADR 0001 — Monorepo with pnpm and Turborepo

**Status:** Accepted (owner, 26-09-2026, with the blueprint) · **Date:** 26-09-2026 · **Deciders:** Owner · **Blueprint:** §5, §6.1 · **Architecture:** §3

## Context
Shakti Prime BOS is one product delivered as four runtimes (web app, Android field app, Tally connector, voice agent) that share contracts, domain logic, design tokens and database types. A single developer maintains all of them. Separate repositories would duplicate configuration, drift on shared schemas and multiply CI setups.

## Decision
One repository managed with **pnpm workspaces** and **Turborepo**.

- Workspaces: `apps/web`, `apps/field`, `apps/tally-connector`, `apps/voice-agent`, `packages/domain`, `packages/db`, `packages/contracts`, `packages/ui`, `packages/tokens`.
- Dependency direction is one-way: `apps/*` → `packages/*`. `packages/domain` depends only on `packages/contracts` and the `packages/db` schema and types (never its client) and never imports Next.js, React or Expo. `packages/contracts` depends only on Zod and the UUIDv7 generator.
- Turborepo pipelines: `build`, `typecheck`, `test`, `test:security`; lint, format and copy lint run at the root; `test:e2e` joins in Phase 1; remote caching once the Vercel project exists.
- One TypeScript strict base config, one ESLint config and one Prettier config at the root, extended by every workspace.
- A pinned `pnpm-lock.yaml`; `packageManager` field in the root `package.json` so Corepack selects the same pnpm version everywhere.

## Consequences
- Shared code changes are atomic: a contract change and every consumer ship in one commit and one CI run.
- The dependency direction is enforced by lint rules and by `package.json` boundaries, which keeps the domain layer free of framework code and testable in isolation.
- Expo and Next.js each need workspace-aware bundler settings (Metro `watchFolders`, `transpilePackages`), which the scaffold configures once.
- Turborepo task graphs let CI run lint, typecheck, unit and security tests only for affected workspaces, keeping pull-request feedback under a few minutes.
