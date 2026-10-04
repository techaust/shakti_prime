# Incidents: what to do when something goes wrong

Plain steps for the owner or the developer on duty, one section per kind of trouble. Each step names the screen or the page to open. The hosted environments are listed in [STATUS](../STATUS.md#hosted-environments); how they are set up is in [DEPLOY](DEPLOY.md). Nothing here changes a hosted environment without the owner's go-ahead.

## Contents
1. [The site is down](#1-the-site-is-down)
2. [Updates are stuck or failing](#2-updates-are-stuck-or-failing)
3. [A migration failed](#3-a-migration-failed)
4. [Roll back a bad deploy](#4-roll-back-a-bad-deploy)
5. [A secret leaked](#5-a-secret-leaked)
6. [Restore from a backup](#6-restore-from-a-backup)

## 1. The site is down
1. Open `<site>/api/v1/health`. A 200 means the app is running; no answer means the deployment itself is down (go to step 3).
2. Open `<site>/api/v1/health/ready`. A 200 with `status: ok` means every dependency answers. A 503 means one is down: the database, the auth database, the key-value store (Upstash Redis), the configuration, or the outbox (an update has waited more than five minutes past its time, so the publisher is not running). The page never names which.
3. In Vercel, open the project (`shakti-prime-dev` or `shakti-prime-staging`) › **Deployments**: the latest deployment of `main` must be **Ready**. A failed build shows its log there; a deployment that refuses to start lists the missing or unsafe variables in its runtime log (`productionConfigProblems()`, [DEPLOY §1](DEPLOY.md#1-before-the-first-deploy-once-per-environment)).
4. In Vercel › **Logs**, search for `health.not_ready` with the request id the readiness page returned (header `x-request-id`): the line names the check that is down.
5. Check the provider of that check: the Supabase project's dashboard and status page for the database, the Upstash console for Redis and QStash, Cloudflare for Turnstile. A provider outage is waited out; a changed or expired value is fixed in Vercel's variables, then the deployment is redeployed.
6. When the deployment itself is at fault (it broke after a merge), roll it back (§4).

## 2. Updates are stuck or failing
Background updates (events) leave each change through the outbox and QStash. An Executive sees them on **Admin › Integration health** (`/admin/integrations`).
1. **Updates waiting to go out** lists what is waiting by kind. A count that keeps growing with an old *Waiting since* means the publisher is not running: check that the QStash schedule calls `<site>/api/v1/workers/outbox/publish` every minute (Upstash console › QStash › Schedules) and that `/api/v1/health/ready` answers 200.
2. **Delivery speed** › **Check delivery speed** sends one update through the system and times it. It should arrive within seconds; handing a lead over depends on it staying under 10 seconds.
3. **Held-back updates** lists updates held back after ten tries, or refused for good by the step that handles them, with *What went wrong*. Fix the cause first (a missing variable, a provider outage, a fault in a worker), then press **Send again** on each: the update goes back in the queue with its tries reset, and the replay is recorded in the Activity log. Only the Executive holds this permission (`integrations.dlq.replay`).
4. **Files waiting for their checks** lists uploads still unchecked after ten minutes; **Check files again** runs their checks from where each stopped ([files-setup §3](files-setup.md#3-put-the-values-in-vercel)).
5. Sentry's alert rule *Message queue failing (outbox)* emails the owner when the publisher holds an update back (`outbox.dead_lettered`) or when a third sending round in a row fails to deliver anything it tried (`outbox.publisher_failing`). The alert carries counts and ids only; the page above shows the detail.

## 3. A migration failed
Migrations reach a hosted database only through GitHub › **Actions** › *Migrate a hosted database*, run from `main` ([DEPLOY §2](DEPLOY.md#2-every-deploy)).
1. Open the failed run and read the first failing step:
   - *Only from main* or *Secrets present and for this project*: the run was started from another branch, a secret is missing, or the address names another Supabase project. Fix the secret in GitHub › Settings › Secrets and variables › Actions, then run again.
   - `pnpm db:migrate`: the database's own error is in the log. The migrator applies every pending migration in one transaction under an advisory lock, so a failure leaves the database as it was. A table lock held by live traffic for more than 10 seconds also stops it; run again at a quiet moment.
   - `pnpm db:verify`: a migration on disk is not applied exactly as written (a changed file, or one the journal skipped because its time is older than the last one applied).
   - *Seed*: the migrations are in; rerun the workflow with the same choice, since the seed is safe to repeat.
2. **Never edit a migration that a hosted database has applied.** A fix is a new migration after the last one, merged through a pull request, then the workflow is run again.
3. A migration that builds an index concurrently cannot run in the migrator's transaction: build the index by hand first ([DEPLOY §3](DEPLOY.md#3-a-migration-that-builds-an-index-concurrently)).
4. After a successful run, check `/api/v1/health/ready` on the environment's site.

## 4. Roll back a bad deploy
1. In Vercel, open the project › **Deployments**, find the last deployment that worked, open its menu (three dots) and choose **Instant Rollback** (or **Promote** on an older deployment; the Hobby plan may offer only the previous production deployment). It serves the production address within a minute; check `/api/v1/health` and `/api/v1/health/ready`.
2. Vercel deploys every merge to `main` to both projects, so the next merge replaces the rollback: fix the fault in a pull request before anything else merges, or add the `hold` label to the open pull requests meanwhile.
3. Migrations only go forward. Rolling the app back does not undo a migration; a schema fix is a new migration (§3). An older deployment keeps working on a newer schema only while the migration was additive, which is the rule for every migration (expand, then contract, [AGENTS §6](../../AGENTS.md#6-database-changes)).

## 5. A secret leaked
Replace it at once, following [DEPLOY §5](DEPLOY.md#5-rotating-a-secret) for the kind of secret; for the AWS access key, [files-setup §5](files-setup.md#5-rotating-the-access-key). A secret committed to the repository stays in its history, which is never rewritten on GitHub: replace the secret, then add the scan's fingerprint of the old value to `.gitleaksignore` in a pull request. Never replace `BETTER_AUTH_SECRET` outright: follow SECURITY §10.

## 6. Restore from a backup
The backups, the recovery targets and the restore drill are in [DATABASE §10](../DATABASE.md#10-backups-and-recovery). Restore into a new scratch project first, check it as the drill describes, and only then decide with the owner how to bring the data back.
