---
name: migrate-hosted
description: Migrate and check the hosted dev and staging environments of Shakti Prime BOS after a pull request with migrations merged and CI on main is green. Covered by the owner's standing go-ahead; anything else on a hosted service needs the owner's yes first.
---

# Migrate dev, then staging

Only after the merged pull request's CI run on `main` is green. This is the owner's standing go-ahead (`docs/DECISIONS.md`, 29-09-2026); it covers migrating, seeding, redeploying and checking dev and staging, creating QStash URL groups for subscribed events, non-secret Vercel settings and synthetic staging test users. Every other hosted change (new resources, settings, plans, deletions, production) asks the owner first.

1. `gh workflow run migrate.yml -f environment=dev -f seed=true`, then `gh run watch` on that run. It must succeed before staging.
2. `gh workflow run migrate.yml -f environment=staging -f seed=true`, then watch it.
3. Vercel deploys `main` to both projects by itself: wait until both deployments of the merge commit are ready.
4. Health: `curl -s -o /dev/null -w '%{http_code}'` on `https://shakti-prime-dev.vercel.app/api/v1/health` and `/api/v1/health/ready`, and the same on `https://shakti-prime-staging.vercel.app`: all four answer 200.
5. Count: `select count(*) from drizzle.__drizzle_migrations` on each project (read-only SQL through the Supabase connection) equals the number of `.sql` files in `packages/db/migrations`. A new pg_cron job shows in `select jobname, schedule from cron.job`.
6. Record the result for `docs/STATUS.md` (migrated through NNNN on DD-MM-YYYY, health 200) and tell the owner in one line.

If a step fails, stop and follow `docs/runbooks/INCIDENTS.md`; never edit an applied migration (a fix is a new migration).
