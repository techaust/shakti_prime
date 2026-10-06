# ADR 0018 — A read-only login role, `app_reader`, with its own pool for queries

**Status:** Accepted: approved by the owner within the Phase 1 design, 29-09-2026 (`docs/03-roadmap-appendix/phase1.md` §5.2); built in #82 (migrations 0062 and 0063) · **Date:** 29-09-2026 · **Deciders:** Owner, within the Phase 1 design · **Blueprint:** §5, §6.1, §7.2 · **Database:** §3, §4.1 · **Architecture:** §4 · **ADR:** 0002, 0004

## Context
Every page read runs through `executeQuery()` in `withRequestContext()`, as `app_user`, under the same row-level security as commands (ADR 0002, 0004). The read runs in a read-only transaction (`withRequestContext(..., { readOnly: true })`), so a write sent through a query by mistake fails with SQLSTATE 25006. That protects against mistakes, not against a query that sets its transaction back to read-write: `app_user` still holds `insert` and `update` on most tables. Reads are also most of the load, and a slow report on the same pool as commands can hold connections a command needs.

## Decision
**Queries run as a separate login role that can only read, on a pool of their own, under exactly the policies `app_user` reads under.**

- `app_reader` is created by `ensureRoles()` in `packages/db/src/migrate.ts` with `login`, no superuser, no `BYPASSRLS`, owning nothing, the same three timeouts as `app_user` and `default_transaction_read_only = on`. It is created whether or not `APP_READER_PASSWORD` is set; without the password no one can sign in as it.
- Migration 0062 grants it `select` on exactly what `app_user` may select, table by table and column by column, adds it to every policy that names `app_user` for select or for every command, and grants it execute on the definers a read calls, and on no definer that writes. The definers it holds are listed in [DATABASE §3](../05-database.md#3-roles-and-connections).
- A later table or select policy for `app_user` names `app_reader` in the same migration; `grants.test.ts` checks both the grants and the policies.
- `executeQuery()` runs on the reader pool (`readerDb()`, `DATABASE_URL_READER`) when that variable is set, and otherwise on `app_user` in a read-only transaction. `packages/domain/tests/queries/reader-parity.test.ts` runs the queries on both and compares the answers.

## Consequences
- A query cannot write even if its code tries: the role lacks the privilege, the role's default makes every transaction read-only, and the policies still apply.
- Reads and commands do not compete for one pool's connections.
- Every new table, select policy and read definer carries one more grant; forgetting it fails `grants.test.ts`, and a screen that reads through a definer the reader lacks fails its parity test or its journey.
- Each hosted environment needs `APP_READER_PASSWORD` for the migrator and `DATABASE_URL_READER` for the app (`docs/runbooks/DEPLOY.md`); without them the app runs on `app_user` alone, safely but without the second guard.
