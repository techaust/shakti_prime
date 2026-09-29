# Deploying to a hosted environment

How the BOS reaches staging and production: the database, its secrets, the first sign-in and the web app. Nothing here runs until the hosted projects exist (ROADMAP §2); each step names who does it.

## 1. Before the first deploy (once per environment)
1. **Supabase project** in Mumbai, on the paid tier for production. In the project settings, switch the Data API off (or expose no schema): the BOS never uses it, and the API roles hold nothing on application objects (DATABASE §3). Never enable `pg_trgm` from the dashboard's extensions page: the migrations create it in `public` (0003), the lead search (`app.lead_search_ids()`, 0052) calls it there, and the dashboard would place it in the `extensions` schema.
2. **Database roles.** The migrator connects as the project's `postgres` role. Choose long random passwords for `app_user`, `auth_service` and `outbox_publisher`; the migrator creates the roles on its first run.
3. **CA certificate.** Download the Supabase root certificate from the project's database settings and store its PEM text as the secret `DATABASE_CA_CERT`. Every pool refuses a hosted connection without it.
4. **GitHub secrets.** A private repository on GitHub's free plan has no environments, so each database's migration secrets are repository secrets (Settings › Secrets and variables › Actions) named with its suffix, `_DEV` or `_STAGING`: `DATABASE_URL_MIGRATOR_<ENV>`, `APP_USER_PASSWORD_<ENV>`, `AUTH_SERVICE_PASSWORD_<ENV>`, `OUTBOX_PUBLISHER_PASSWORD_<ENV>`, `DATABASE_CA_CERT_<ENV>`. `DATABASE_URL_MIGRATOR_<ENV>` is the project's **session pooler** address for `postgres` (GitHub's runners reach no IPv6-only direct address); the workflow stops when a secret is missing or its address names another project. Production is migrated only after the repository moves to a plan with environments (AUDIT M45): a `production` environment holding the same five secrets without a suffix, with a required reviewer, and `production` added back to the workflow's choices.
5. **Vercel project** pinned to `bom1`, with automatic production deploys switched off until the repository can require a green CI run before merging (AUDIT M45). Set the runtime variables:
   - `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_OUTBOX`: the transaction pooler URLs for `app_user`, `auth_service` and `outbox_publisher`;
   - `DATABASE_CA_CERT`;
   - `BETTER_AUTH_SECRET`: at least 32 random characters, never a value from the repository;
   - `BETTER_AUTH_URL`: the https address of the environment;
   - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: real keys for the environment's hostname, never Cloudflare's test keys;
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`;
   - `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (and `QSTASH_URL` when the QStash region is not the default);
   - `BOS_JWT_CURRENT_KEY` (and `BOS_JWT_NEXT_KEY` during a rotation) once Realtime is switched on: a private key from `pnpm --silent --filter web realtime-keys`, never stored anywhere else; without it `/api/v1/realtime/token` and `/.well-known/jwks.json` answer unavailable and nothing else changes;
   - `MAILER=log` on staging. Production needs the Amazon SES mailer first (the client's domain verified, production access granted, a send-only IAM user): it refuses to start with `log`.

   A deployment with a missing or unsafe value refuses to start (`productionConfigProblems()` in `apps/web/src/auth/deps.ts`, which requires every variable of its `PRODUCTION_ENV` list: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MAILER`, `DATABASE_URL_OUTBOX`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`), and `/api/v1/health/ready` answers 503 while a dependency is down, naming it only in the `health.not_ready` log line.

## 2. Every deploy
1. Merge to `main` only on a green CI run; the merge-on-green workflow (`.github/workflows/automerge.yml`) merges a pull request only after CI passes on its latest commit, and runs CI again on `main`.
2. **Migrate** from GitHub: Actions › *Migrate a hosted database* › Run workflow › choose `dev` or `staging`. It runs only from `main`, applies the migrations under an advisory lock, then runs `pnpm db:verify`, which fails when a migration on disk is not applied exactly as written. After it, `select jobname from cron.job` lists the three scheduled jobs: `audit-logs-partitions`, `idempotency-keys-purge` and `outbox-events-purge` (DATABASE §7). After the first migration of a project, and after any migration that changes the purge, confirm the next run of `outbox-events-purge` (02:45 UTC) succeeded on the hosted project's pg_cron background workers: its latest row in `cron.job_run_details` has `status = 'succeeded'` for the command `call app.purge_outbox_events()`, and its latest `retention_runs` row has a `finished_at` and no `error`.
3. **Seed** when the permission catalogue, roles, pipelines, tiers or lead sources changed: run `pnpm db:seed` with the environment's `DATABASE_URL_MIGRATOR` and `DATABASE_CA_CERT`. It keeps every Admin edit (DATABASE §9).
4. **Promote** the Vercel deployment of that commit, then open `/api/v1/health/ready` and confirm it answers 200 with `status: ok`; on a 503, the `health.not_ready` log line with the same request id names the check that is down.
5. **Outbox schedule** (first deploy of an environment, and whenever `BETTER_AUTH_URL` changes): run `pnpm --filter web qstash-schedule` with the environment's QStash variables and `BETTER_AUTH_URL`. It creates or updates the schedule `outbox-publish`, which calls the publisher every minute.

## 3. A migration that builds an index concurrently
`create index concurrently` cannot run inside the migrator's transaction. Write the migration with a plain `create index if not exists`, and before running the workflow, build the same index by hand on the hosted database with `create index concurrently if not exists …` under the same name. The migration then finds it and does nothing, without locking the table.

## 4. The first Executive
With `DATABASE_URL_MIGRATOR`, `DATABASE_URL_AUTH`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` and the CA certificate of the environment set, run:

```
pnpm --filter web invite-executive -- --email <address> --name "<name>"
```

It prints the set-password link to the terminal of the person running it; the link lasts 24 hours. The Executive sets a password, then enrols an authenticator app at first sign-in.

## 5. Rotating a secret
- **Database passwords:** set the new values in the environment's GitHub secrets, run `pnpm db:migrate -- --rotate-passwords` with them, then update `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_OUTBOX` in Vercel and redeploy.
- **QStash signing keys:** roll them in the Upstash console; the publisher route accepts the current and the next key, so update both variables in Vercel and redeploy after each roll.
- **BOS signing keys (`BOS_JWT_CURRENT_KEY`, `BOS_JWT_NEXT_KEY`, every 6 months, ADR 0003):** make a key with `pnpm --silent --filter web realtime-keys` straight into Vercel as `BOS_JWT_NEXT_KEY` and redeploy; after at least 10 minutes (the key list's cache and Supabase's), swap the two values so the new key signs and the old one stays published, and redeploy; after another 30 minutes (the longest token life twice over), clear `BOS_JWT_NEXT_KEY` and redeploy. The steps and their checks are in `docs/spikes/realtime.md` §5.
- **`BETTER_AUTH_SECRET`:** never replace it outright; it also encrypts stored authenticator secrets. Follow SECURITY §10.
