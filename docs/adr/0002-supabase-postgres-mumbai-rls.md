# ADR 0002 — Supabase Postgres in Mumbai with RLS as the isolation boundary

**Status:** Accepted (owner, 26-09-2026, with the blueprint); no database branching is used (ARCHITECTURE §12) · **Date:** 26-09-2026 · **Deciders:** Owner · **Blueprint:** §1, §5, §6.1, §7.2, §12 · **Database:** §1, §3, §4 · **Security:** §4

## Context
Four selling entities with separate GSTINs share one team, so the system is one database with entity-tagged rows rather than one tenant per company. Users can see several entities; supplier rates, costs and margins must be invisible to most roles even when they can see the rest of the record. The users are in Jaipur, so latency to the database matters, and a single developer needs managed operations.

## Decision
**Supabase Postgres 17 in the Mumbai region** is the system of record, with **row-level security as the isolation boundary** for entity scope and cost data.

- Three Supabase projects: `dev`, `staging`, `prod`, with no database branching: a pull request's CI makes its own database. Vercel functions are pinned to `bom1` beside it.
- Every business table carries `entity_id`, has RLS enabled and **forced**, and uses the fail-closed policy template from `docs/05-database.md` §4.2: policies read `current_setting('app.entity_ids', true)` inside a subselect and deny when the setting is null or empty.
- The application connects as the non-superuser **`app_user`**, which does not own the tables and has no `BYPASSRLS`. Migrations run as the owner role. The Supabase service role is never used in request paths.
- All access runs inside a transaction opened by the single `withRequestContext()` helper, which sets `app.user_id`, `app.entity_ids`, `app.role`, `app.permissions`, `app.team_id` and `app.request_id` with `set_config(..., true)`. Transaction-scoped settings are safe behind Supavisor in transaction mode.
- Cost data lives in side tables (`item_costs`, `stock_movement_costs`, `job_cost_entries`, `vendor_quotes`, `tally_purchase_vouchers`) gated by an additional RLS policy on `finance.cost.read` or `procurement.rate.read`.
- Extensions: `pgvector`, `pg_trgm`, `pg_cron`, `pgcrypto`. Monthly partitions for activities, WhatsApp messages and audit logs.
- Backups: PITR plus a nightly logical dump to S3; quarterly restore drills.

## Consequences
- A query that runs outside a request context returns no rows, so a coding mistake fails closed rather than leaking across entities.
- The security suite can prove isolation with real SQL: for every table and every role × entity pair, only that entity's rows are visible and no context yields zero rows.
- Prepared statements are disabled in the driver because of transaction-mode pooling; Drizzle is configured accordingly.
- Cost isolation does not depend on application code remembering to filter; even a raw `select *` by a General Manager returns no cost rows.
- Supabase Auth is not used for staff identity (see ADR 0003); Supabase is used for Postgres and Realtime only.
