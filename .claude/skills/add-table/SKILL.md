---
name: add-table
description: Add a database table to Shakti Prime BOS with fail-closed row-level security, grants and its security tests. Use whenever a schema change adds a table or a partitioned table.
---

# Add a table

The recipe is `AGENTS.md` §6; follow it step by step, and load the `supabase-postgres-best-practices` skill before writing SQL. Before calling the table done, check each line:

- [ ] Drizzle schema in `packages/db/src/schema`, then `pnpm db:generate`, then a custom migration (`drizzle-kit generate --custom`) with RLS enabled and forced, policies, grants and triggers.
- [ ] Policies follow the templates: `entity_id = any ((select app.entity_ids())::int[])` with the cast outside the parentheses; scope roots through `app.scope_ok()`; child tables through `exists` on the parent, with a composite foreign key `(parent_id, entity_id)`; customer tables through `account_entities` (ADR 0008).
- [ ] A select policy naming `app_user` names `app_reader` too; the select grant and any definer a read calls are granted to `app_reader`.
- [ ] Every joined or filtered foreign key is indexed. A definer revokes execute from `public` and `readonly_reporter`, checks its permission in its body and sets `search_path = ''`.
- [ ] The table is in its list in `packages/db/src/testing/index.ts` (`ENTITY_TABLES`, `SHARED_TABLES`, `PRINCIPAL_TABLES`, `PLATFORM_TABLES`, `OUTBOX_TABLES`), an `ENTITY_TABLES` table has a fixture row per company in `entity-matrix-fixture.ts` and a rule in `role-entity-matrix.test.ts`.
- [ ] Narrower grants in `NARROWER` (`grants.test.ts`); every list-valued check constraint paired with its contract enum in `enum-sync.test.ts`.
- [ ] A partitioned table: `PARTITION BY` added by hand before the migration is ever applied, the partitions in a schema no request role may use, a default partition and a pg_cron job for the next months.
- [ ] `pnpm db:docs` re-run; DATABASE §6 catalogue line written; the security suite passes on the local Postgres.
