---
name: migrate-hosted
description: Migrate and check the hosted dev and staging environments of Shakti Prime BOS after a pull request with migrations merged and CI on main is green. Runs on the PC. Covered by the owner's standing go-ahead; anything else on a hosted service needs the owner's yes first.
---

# Migrate dev, then staging

**PC by default** ([hybrid §1](../../../docs/runbooks/hybrid.md#1-what-runs-where)): the count in step 4 needs the Supabase connection, which exists only on the PC. The procedure and its checks are [DEPLOY §2](../../../docs/runbooks/DEPLOY.md#2-every-deploy); this skill runs it from the command line. The scope of the owner's standing go-ahead is its row in `docs/DECISIONS.md`; every other hosted change asks the owner first.

Only after the merged pull request's CI run on `main` is green.

1. **Dev:** `gh workflow run migrate.yml -f environment=dev -f seed=true`; a few seconds later take the run's id with `gh run list --workflow=migrate.yml --limit 1 --json databaseId -q '.[0].databaseId'`, then `gh run watch <id> --exit-status`. It must succeed before staging; its own `pnpm db:verify` step fails when a migration on disk is not applied exactly as written.
2. **Staging:** the same with `environment=staging`.
3. **Deploys and health:** Vercel deploys `main` to both projects by itself: wait until both deployments of the merge commit are ready. Then `curl -s -o /dev/null -w '%{http_code}'` on `https://shakti-prime-dev.vercel.app/api/v1/health` and `/api/v1/health/ready`, and the same on `https://shakti-prime-staging.vercel.app`: all four answer 200.
4. **Count, where the Supabase tools exist:** `select count(*) from drizzle.__drizzle_migrations` on each project (read-only SQL through the Supabase connection) equals the number of `.sql` files in `packages/db/migrations`; a new pg_cron job shows in `select jobname, schedule from cron.job`. Without the Supabase tools, the workflow's `db:verify` step is the check; say so in the record.
5. **Record** the result for `docs/STATUS.md` (migrated through NNNN on DD-MM-YYYY, health 200) and tell the owner in one line.

If a step fails, stop and follow `docs/runbooks/INCIDENTS.md`; never edit an applied migration (a fix is a new migration).
