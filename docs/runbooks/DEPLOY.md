# Deploying to a hosted environment

How the BOS reaches staging and production: the database, its secrets, the first sign-in and the web app. Nothing here runs until the hosted projects exist (ROADMAP §2); each step names who does it.

## 1. Before the first deploy (once per environment)
1. **Supabase project** in Mumbai, on the paid tier for production. In the project settings, switch the Data API off (or expose no schema): the BOS never uses it, and the API roles hold nothing on application objects (DATABASE §3).
2. **Database roles.** The migrator connects as the project's `postgres` role. Choose long random passwords for `app_user`, `auth_service` and `outbox_publisher`; the migrator creates the roles on its first run.
3. **CA certificate.** Download the Supabase root certificate from the project's database settings and store its PEM text as the secret `DATABASE_CA_CERT`. Every pool refuses a hosted connection without it.
4. **GitHub environment** (`staging`, `production`) with these secrets: `DATABASE_URL_MIGRATOR`, `APP_USER_PASSWORD`, `AUTH_SERVICE_PASSWORD`, `OUTBOX_PUBLISHER_PASSWORD`, `DATABASE_CA_CERT`. For `production`, require a reviewer in the environment's protection rules.
5. **Vercel project** pinned to `bom1`, with automatic production deploys switched off until the repository can require a green CI run before merging (AUDIT M45). Set the runtime variables:
   - `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_OUTBOX`: the transaction pooler URLs for `app_user`, `auth_service` and `outbox_publisher`;
   - `DATABASE_CA_CERT`;
   - `BETTER_AUTH_SECRET`: at least 32 random characters, never a value from the repository;
   - `BETTER_AUTH_URL`: the https address of the environment;
   - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: real keys for the environment's hostname, never Cloudflare's test keys;
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`;
   - `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (and `QSTASH_URL` when the QStash region is not the default);
   - `MAILER=log` on staging. Production needs the mail provider first: it refuses to start with `log`.

   A deployment with a missing or unsafe value refuses to start (`productionConfigProblems()`), and `/api/v1/health/ready` reports which dependency is down.

## 2. Every deploy
1. Merge to `main` only on a green CI run.
2. **Migrate** from GitHub: Actions › *Migrate a hosted database* › Run workflow › choose the environment. It runs only from `main`, applies the migrations under an advisory lock, then runs `pnpm db:verify`, which fails when a migration on disk is not applied exactly as written.
3. **Seed** when the permission catalogue, roles, pipelines, tiers or lead sources changed: run `pnpm db:seed` with the environment's `DATABASE_URL_MIGRATOR` and `DATABASE_CA_CERT`. It keeps every Admin edit (DATABASE §9).
4. **Promote** the Vercel deployment of that commit, then open `/api/v1/health/ready` and confirm every check reads `ok`.
5. **Outbox schedule** (first deploy of an environment, and whenever `BETTER_AUTH_URL` changes): run `pnpm --filter web qstash-schedule` with the environment's QStash variables and `BETTER_AUTH_URL`. It creates or updates the schedule `outbox-publish`, which calls the publisher every minute.

## 3. A migration that builds an index concurrently
`create index concurrently` cannot run inside the migrator's transaction. Write the migration with a plain `create index if not exists`, and before running the workflow, build the same index by hand on the hosted database with `create index concurrently if not exists …` under the same name. The migration then finds it and does nothing, without locking the table.

## 4. The first Executive
With the migrator's URL and the CA certificate in the environment, run:

```
pnpm --filter web invite-executive -- --email <address> --name "<name>"
```

It prints the set-password link to the terminal of the person running it; the link lasts 24 hours. The Executive sets a password, then enrols an authenticator app at first sign-in.

## 5. Rotating a secret
- **Database passwords:** set the new values in the GitHub environment, run `pnpm db:migrate -- --rotate-passwords` with them, then update `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_OUTBOX` in Vercel and redeploy.
- **QStash signing keys:** roll them in the Upstash console; the publisher route accepts the current and the next key, so update both variables in Vercel and redeploy after each roll.
- **`BETTER_AUTH_SECRET`:** never replace it outright; it also encrypts stored authenticator secrets. Follow SECURITY §10.
