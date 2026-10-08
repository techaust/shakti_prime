---
name: migrate-hosted
description: Migrate and check the hosted dev and staging environments of Shakti Prime BOS after a pull request with migrations merged and CI on main is green. Runs on the PC. Covered by the owner's standing go-ahead; anything else on a hosted service needs the owner's yes first.
---

# Migrate dev, then staging

**PC by default** ([hybrid §1](../../../docs/runbooks/hybrid.md#1-what-runs-where)): the migration count below needs the Supabase connection, which exists only on the PC. The scope of the owner's standing go-ahead is its row in `docs/11-decisions.md`; every other hosted change asks the owner first.

1. **Only after** the merged pull request's CI run on `main` is green.
2. **Run the procedure in [DEPLOY §2](../../../docs/runbooks/deploy.md#2-every-deploy)** exactly as written: dev, then staging, each through the *Migrate a hosted database* workflow from the command line (`gh workflow run`, the run's id from `gh run list`, `gh run watch <id> --exit-status`), then the deployments, health and readiness on both sites. Its `pnpm db:verify` step fails when a migration on disk is not applied exactly as written.
3. **The count, where the Supabase tools exist:** `select count(*) from drizzle.__drizzle_migrations` on each project (read-only SQL through the Supabase connection) equals the number of `.sql` files in `packages/db/migrations`; a new pg_cron job shows in `select jobname, schedule from cron.job`. Without the Supabase tools, the workflow's `db:verify` step is the check; say so in the record.
4. **Record** the result in `docs/10-status.md` (migrated through NNNN on DD-MM-YYYY, health 200) as DEPLOY §2 says, and tell the owner in one line.

If a step fails, stop and follow `docs/runbooks/incidents.md`; never edit an applied migration (a fix is a new migration).
