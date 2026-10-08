# Deploying to a hosted environment

How the BOS reaches dev, staging and production: the outside services, the database and its secrets, every deploy, the first sign-in and secret rotation. Each step names who does it.
- Which environments exist and their addresses: [STATUS](../STATUS.md#hosted-environments). Plans, regions and bills of every service: [accounts](accounts.md).
- What to do when something breaks: [INCIDENTS](INCIDENTS.md). File storage and mail on AWS: [files-setup](files-setup.md).
- Production waits for the items in the *Before production* column of [accounts](accounts.md#in-use), among them a GitHub plan with environments; no workflow migrates it until then.

## Contents
1. [Before the first deploy](#1-before-the-first-deploy-once-per-environment) · 2. [Every deploy](#2-every-deploy) · 3. [A migration that builds an index concurrently](#3-a-migration-that-builds-an-index-concurrently) · 4. [The first Executive](#4-the-first-executive) · 5. [Rotating a secret](#5-rotating-a-secret)

## 1. Before the first deploy (once per environment)
The owner does these steps, once for `dev`, once for `staging`, and once for `production` when it is opened. `<env>` is the environment's name.

1. **Supabase project** `shakti-prime-<env>` in Mumbai (`ap-south-1`), on the paid tier for production. Keep the database password chosen at creation with the other passwords of this section; the dashboard never shows it again.
   - In the project settings, switch the Data API off (or expose no schema): the BOS never uses it, and the API roles hold nothing on application objects (DATABASE §3).
   - Never enable `pg_trgm` from the dashboard's extensions page: the migrations create it in `public` (0003), the lead search (`app.lead_search_ids()`, 0052) calls it there, and the dashboard would place it in the `extensions` schema.
   - Never enable `vector` (pgvector) from the dashboard either: the Knowledge Vault's migration creates it in `public`, where the vault's passages and their search use it, and the dashboard would place it in the `extensions` schema.
2. **Database roles.** The migrator connects as the project's `postgres` role. Choose long random passwords for `app_user`, `auth_service`, `outbox_publisher` and `app_reader`; the migrator creates the roles on its first run and sets each password then.
   - `app_reader` is the queries' read-only pool. Without its password the role exists with none, no one can sign in as it, and the app reads on `app_user` in read-only transactions.
   - A password set or changed later reaches its role only through a rotation run (§5).
3. **CA certificate.** In the Supabase dashboard, open Project Settings › Database › SSL Configuration and download the certificate. Its PEM text (the whole file, `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`) is the secret `DATABASE_CA_CERT`. Every pool refuses a hosted connection without it.
4. **GitHub secrets.** A private repository on GitHub's free plan has no environments, so each database's migration secrets are repository secrets (Settings › Secrets and variables › Actions) named with its suffix, `_DEV` or `_STAGING`:
   - `DATABASE_URL_MIGRATOR_<ENV>`, `APP_USER_PASSWORD_<ENV>`, `AUTH_SERVICE_PASSWORD_<ENV>`, `OUTBOX_PUBLISHER_PASSWORD_<ENV>`, `DATABASE_CA_CERT_<ENV>`, and, optional, `APP_READER_PASSWORD_<ENV>`;
   - `DATABASE_URL_MIGRATOR_<ENV>` is the project's **session pooler** address for `postgres` (dashboard › **Connect** › Session pooler), with the database password in place of `[YOUR-PASSWORD]`; GitHub's runners reach no IPv6-only direct address. The workflow stops when a secret is missing or its address names another project;
   - a secret cannot be read back from GitHub once saved, so the owner keeps every password of this section in their own password store;
   - production is migrated only after the repository moves to a plan with environments (the audit ([2026-09-audit](../reviews/2026-09-audit.md)) M45): a `production` environment holding the same six secrets without a suffix (the reader's password optional), with a required reviewer, and `production` added to the workflow's choices.
5. **Upstash Redis** (console.upstash.com › Redis › **Create database**): name `shakti-prime-<env>`, primary region Mumbai, the Pay as You Go plan, eviction off. On the database's page, the REST API section shows the address and the read-write key: they are `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (never the read-only key).
6. **Upstash QStash** (console.upstash.com › QStash): one QStash account serves every environment. Its page shows `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`; `QSTASH_URL` is set only when the account's region is not QStash's default endpoint. The schedule and the URL groups are made later (§2, steps 6 and 7).
7. **Cloudflare Turnstile** (dash.cloudflare.com › Turnstile › **Add widget**): name `shakti-prime-<env>`, the hostname of `BETTER_AUTH_URL` (for example `shakti-prime-dev.vercel.app`), widget mode Managed. The widget's site key and secret key are `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; the app checks each answer against that hostname.
8. **Sentry**, in the group's US-region organisation (project `shakti-prime-web`):
   - in the project's settings, switch on *Prevent storing of IP addresses* and server-side data scrubbing (the default and the additional sensitive fields), a second guard behind the app's own scrubber;
   - create one alert rule per environment: when an event's message is `outbox.dead_lettered` or `outbox.publisher_failing`, notify the owner. The publisher sends the first when a run dead-letters any event, or when QStash's failure callback holds an event back, and the second on the third run in a row that delivers nothing, each with counts and event ids only.
9. **AWS files stack and mail:** [files-setup](files-setup.md) §1 to §3 for the bucket, the key and the app user; [files-setup §7](files-setup.md#7-verifying-the-clients-domain-for-mail) for the client's domain in Amazon SES (DKIM, SPF, DMARC, production access and the sender address).
10. **Vercel project** `shakti-prime-<env>`, connected to the repository, with its functions pinned to `bom1`. Vercel builds every push to `main` and serves it on the production target of every project within minutes. The repository cannot require a green CI run before merging (the audit ([2026-09-audit](../reviews/2026-09-audit.md)) M45), so only the merge-on-green workflow merges into `main`. Set the runtime variables of step 11 on the **Production** target.
11. **Vercel variables** (project › Settings › Environment Variables; mark each password, key and secret **Sensitive**):
    - `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_OUTBOX`: the **transaction pooler** addresses (dashboard › **Connect** › Transaction pooler) for `app_user`, `auth_service` and `outbox_publisher`: the user `postgres.<project ref>` becomes `<role>.<project ref>`, with that role's own password;
    - `DATABASE_URL_READER` (optional): the transaction pooler address for `app_reader`, once its password is set; with it every query reads on that pool;
    - `DATABASE_CA_CERT`: the PEM text of step 3;
    - `BETTER_AUTH_SECRET`: at least 32 random characters, never a value from the repository; `BETTER_AUTH_URL`: the https address of the environment;
    - `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (step 7), never Cloudflare's test keys;
    - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (step 5);
    - `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`, and `QSTASH_URL` when step 6 needs it;
    - Sentry: `SENTRY_DSN` (server and edge errors) and `NEXT_PUBLIC_SENTRY_DSN` (the same DSN, browser errors, read at build time) switch reporting on; without them nothing is started. The page's Content-Security-Policy lets the browser reach the DSN's ingest host only when `NEXT_PUBLIC_SENTRY_DSN` is set. Events carry `release` (`VERCEL_GIT_COMMIT_SHA`) and `environment` (`BOS_ENVIRONMENT`);
    - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` upload source maps at build time, named by the commit like the events; without the token the build skips Sentry. CI builds without the token, so the first hosted build with it is checked once against the JavaScript budget (`pnpm --filter web js-budget` on that build);
    - `BOS_JWT_CURRENT_KEY` (and `BOS_JWT_NEXT_KEY` during a rotation) once Realtime is switched on: a private key from `pnpm --silent --filter web realtime-keys`, never stored anywhere else; without it `/api/v1/realtime/token` and `/.well-known/jwks.json` answer unavailable and nothing else changes;
    - `BOS_ENVIRONMENT`: `dev`, `staging` or `production`, the project's name for itself (each environment's `main` deployments are Vercel's production target). Never `local` on a hosted environment: `local` marks a production build started on a developer's machine or a CI runner, counts only with a `BETTER_AUTH_URL` on localhost, 127.0.0.1 or [::1], and on Vercel makes the deployment refuse to start;
    - `MAILER`: `ses` sends through Amazon SES in Mumbai from `SES_FROM`, the verified sender; dev and staging may set `log` until the client's domain is verified. Production refuses to start with anything but `ses`, or with `ses` and no `SES_FROM`;
    - `FILES_BUCKET`, `FILES_KMS_KEY_ID`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (`AWS_REGION` only when not `ap-south-1`) from the files stack ([files-setup §3](files-setup.md#3-put-the-values-in-vercel)). None is needed to start; without the bucket and key, uploads answer unavailable;
    - `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` (optional, ADR 0011): the agents' model and the Knowledge Vault's embeddings, through the provider wrapper. None is needed to start; until the owner sets a key every agent run is recorded as unavailable and nothing calls out, and Admin › Agents says the AI service is not connected. A key is set only after the vendor's data terms are confirmed (SECURITY §5), and an agent also needs a daily spending limit on Admin › Agents before it makes any call. Without `VOYAGE_API_KEY` the Knowledge Vault records every file as waiting for search and its search says search is not switched on yet; without `ANTHROPIC_API_KEY` PDFs and photos wait the same way while Word documents and workbooks are read; once a key is set, an Executive or GM chooses Read again on each waiting file. The vault's reading and its search have their own daily limits (`AGENT_DEFAULTS.knowledge`). Vault photos and every page of a vault PDF are masked before they are kept or sent to a model, so their file checks need the English OCR model in the folder `OCR_LANG_PATH` names (docs/spikes/ocr.md); until it is set they wait and are delivered again. `AI_TRANSPORT` is never set on a hosted environment, which refuses to start with it;
    - nothing for printing (ADR 0009): the render route `/api/v1/workers/pdf/render` declares a `maxDuration` of 60 seconds and runs with the plan's default memory (2 GB under Fluid compute, enough for Chromium), and `next.config.ts` keeps `playwright-core` and `@sparticuz/chromium` out of the bundle and ships the serverless Chromium and the print fonts with that route alone. QStash calls the route directly, with no URL group. It prints with the file store above and, for a company with a bank account, the KMS key; without the store a render answers unavailable and QStash retries it. The first render after a cold start takes a few seconds more while Chromium unpacks;
    - never `FIELD_ENCRYPTION_KEY`: it is the development key, and a hosted deployment refuses to start with it (it seals with the KMS key instead).
12. **Check the configuration.** A deployment with a missing or unsafe value refuses to start and lists the problems in its runtime log (`productionConfigProblems()` in `apps/web/src/auth/deps.ts`).
    - It requires every variable of its `PRODUCTION_ENV` list: `BOS_ENVIRONMENT`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MAILER`, `DATABASE_URL_OUTBOX`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.
    - `/api/v1/health/ready` answers 503 while a dependency is down, naming it only in the `health.not_ready` log line.
13. Then follow §2 (the first migration and seed, the scheduled jobs and the outbox schedule), then §4 for the first Executive.

## 2. Every deploy
This is the one procedure for bringing a hosted database and site up to `main`; the `migrate-hosted` skill and [slice-integration](slice-integration.md) follow it. The lead session runs it from the owner's PC under the owner's standing go-ahead for dev and staging ([DECISIONS](../DECISIONS.md)), or the owner runs it. Always dev first, then staging.

1. **Merge.** A pull request reaches `main` only through the merge-on-green workflow (`.github/workflows/automerge.yml`), after CI passes on its latest commit; CI runs again on `main`. Vercel deploys the merge commit to every project within minutes, so run the migration straight after: until it has run, a screen that needs a table the merge adds fails.
2. **Migrate dev.** GitHub › **Actions** › *Migrate a hosted database* › **Run workflow**: branch `main`, environment `dev`, *Seed the reference data* ticked, *Set the login roles' passwords again* unticked. From a terminal signed in to `gh`, the same run and its watch:

   ```
   gh workflow run migrate.yml --ref main -f environment=dev -f seed=true
   gh run list --workflow=migrate.yml --limit 1 --json databaseId -q '.[0].databaseId'
   gh run watch <run id> --exit-status
   ```

   - The run checks the secrets, applies the migrations under an advisory lock, then runs `pnpm db:verify`, which fails when a migration on disk is not applied exactly as written, then `pnpm db:seed`.
   - Seeding is safe on every run and keeps every Admin edit (DATABASE §9); it is needed on a project's first migration and whenever the permission catalogue, roles, pipelines, tiers or lead sources change. Untick it only for a run that changes nothing in them.
   - A red run: [INCIDENTS §3](INCIDENTS.md#3-a-migration-failed). Never go on to staging after a red dev run.
3. **Check dev.** In the Vercel project, the deployment of the merge commit is **Ready** and serves the production address. Open `<site>/api/v1/health` and `<site>/api/v1/health/ready`: both answer 200 with `status: ok`. On a 503, the `health.not_ready` log line with the same request id names the check that is down ([INCIDENTS §1](INCIDENTS.md#1-the-site-is-down)).
4. **Migrate and check staging:** steps 2 and 3 with `staging`.
5. **Scheduled jobs** (after a project's first migration, and after any migration that changes a job): `select jobname from cron.job` in the project's SQL editor lists the five jobs `audit-logs-partitions`, `audit-logs-detach`, `activities-partitions`, `idempotency-keys-purge` and `outbox-events-purge` (DATABASE §7). After the next run of `outbox-events-purge` (02:45 UTC), its latest row in `cron.job_run_details` has `status = 'succeeded'` for the command `call app.purge_outbox_events()`, and the latest `retention_runs` row has a `finished_at` and no `error`.
6. **Outbox schedule** (first deploy of an environment, whenever `BETTER_AUTH_URL` changes, and when a slice adds a schedule): with the environment's `QSTASH_TOKEN`, signing keys, `QSTASH_URL` when set, `BOS_ENVIRONMENT` and `BETTER_AUTH_URL` exported, run `pnpm --filter web qstash-schedule`; it refuses to run without `BOS_ENVIRONMENT`. It creates or updates, each named for the environment, the schedule `outbox-publish-<environment>`, which calls `<BETTER_AUTH_URL>/api/v1/workers/outbox/publish` every minute, `files-sweep-<environment>`, which calls `<BETTER_AUTH_URL>/api/v1/workers/files/sweep` at 17 minutes past every hour to clear uploads that never finished, `lead-rescore-<environment>`, which calls `<BETTER_AUTH_URL>/api/v1/workers/crm/rescore` at 21:30 UTC (03:00 IST) each night, `duplicate-scan-<environment>`, which calls `<BETTER_AUTH_URL>/api/v1/workers/crm/duplicates` at 22:00 UTC (03:30 IST) each night, and `quote-expire-<environment>`, which calls `<BETTER_AUTH_URL>/api/v1/workers/quotes/expire` at 18:35 UTC (00:05 IST) each day.
   - A schedule calling that address under any other id (one made by hand in the Upstash console › QStash › Schedules) is deleted there first, or two schedules call the publisher each minute.
   - One QStash account serves dev and staging, so every schedule id carries its environment (`<id>-${BOS_ENVIRONMENT}`) and one environment's run never overwrites the other's. The schedules made by hand in the console before the script named its ids (`outbox-publish-dev`, `lead-rescore-dev`, `lead-rescore-staging`) already carry these ids, so the script updates them in place; a schedule still named without its environment (`outbox-publish`, `files-sweep`, `lead-rescore`) is deleted in the console after the run, or it keeps calling its worker beside the new one.
7. **Event workers:** nothing to do by hand.
   - The app makes each subscribed type's QStash URL group itself: before the first event of a type a process publishes, it adds the endpoint `<BETTER_AUTH_URL>/api/v1/workers/outbox/<type>` to the group `evt-<type>` (creating the group, or leaving it as it is), once per process. A failed attempt is logged as `outbox.url_group_failed` and tried again on the next run, while the events wait under the usual backoff. So `BETTER_AUTH_URL` must be the environment's public address before the first event goes out.
   - Every event is published with the failure callback `<BETTER_AUTH_URL>/api/v1/workers/outbox/failed`, which needs no setting in the console either: an event its worker refuses for good, or that still fails after QStash's retries, comes back there and is held back with `worker_refused` or `worker_failed`.
   - After a deploy that switches on a worker, open Admin › Integration health and press **Check delivery speed**: the check arrives within seconds.
8. Record the environment's last migration and the date in [STATUS](../STATUS.md#hosted-environments).

## 3. A migration that builds an index concurrently
`create index concurrently` cannot run inside the migrator's transaction. Write the migration with a plain `create index if not exists`, and before running the workflow, build the same index by hand on the hosted database with `create index concurrently if not exists …` under the same name. The migration then finds it and does nothing, without locking the table.

## 4. The first Executive
Once per environment, after its first migration, from the owner's PC in Git Bash at the repository root. The script writes with the migrator connection, so it runs only on a machine the owner controls, never in CI or a cloud session.

1. Gather the five values; none can be read back from GitHub, so they come from the services:
   - `DATABASE_URL_MIGRATOR`: Supabase dashboard › **Connect** › Session pooler, with the database password of §1 step 1;
   - `DATABASE_URL_AUTH`: the same page's Transaction pooler address with the user `auth_service.<project ref>` and its password, the value of Vercel's `DATABASE_URL_AUTH`;
   - `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`: the environment's values in Vercel (a value marked Sensitive cannot be shown again, so take it from where the owner stored it);
   - `DATABASE_CA_CERT`: the certificate file downloaded in §1 step 3.
2. Export them in the same terminal. Single quotes keep a `$` or `!` in a password as it is, and `$(cat …)` keeps the certificate's line breaks:

   ```
   export DATABASE_URL_MIGRATOR='<session pooler address>'
   export DATABASE_URL_AUTH='<transaction pooler address for auth_service>'
   export BETTER_AUTH_URL='https://shakti-prime-<env>.vercel.app'
   export BETTER_AUTH_SECRET='<the environment's secret>'
   export DATABASE_CA_CERT="$(cat ~/Downloads/<certificate file>)"
   ```

   An exported value wins over the same name in the local `.env`, which the scripts also load (`packages/db/src/env.ts`; dotenv never replaces a variable already set).
3. Run `pnpm --filter web invite-executive -- --email <address> --name "<name>"`. It refuses when an Executive exists already (`--force` adds another, with access to every company). It prints the set-password link to this terminal; the link lasts 24 hours.
4. Close the terminal, so the values leave the machine's memory. The Executive opens the link, sets a password, then enrols an authenticator app at first sign-in.

## 5. Rotating a secret
- **Database passwords** (`APP_USER_PASSWORD`, `AUTH_SERVICE_PASSWORD`, `OUTBOX_PUBLISHER_PASSWORD` and the optional `APP_READER_PASSWORD`), at a quiet time, since the site cannot reach the database between steps 2 and 4:
  1. replace the values in the environment's GitHub secrets (`<NAME>_<ENV>`);
  2. run *Migrate a hosted database* for that environment with *Set the login roles' passwords again* ticked (`-f rotate_passwords=true` with `gh`): the run sets each login role's password from its secret (`app_reader` only when its secret is set), then migrates and verifies as usual;
  3. update the passwords inside `DATABASE_URL`, `DATABASE_URL_AUTH`, `DATABASE_URL_OUTBOX` and, when it is set, `DATABASE_URL_READER` in Vercel;
  4. redeploy, then check `/api/v1/health/ready` answers 200.
- **QStash signing keys:** roll them in the Upstash console; the publisher route accepts the current and the next key, so update both variables in Vercel and redeploy after each roll.
- **BOS signing keys (`BOS_JWT_CURRENT_KEY`, `BOS_JWT_NEXT_KEY`, every 6 months, ADR 0003):**
  1. make a key with `pnpm --silent --filter web realtime-keys` straight into Vercel as `BOS_JWT_NEXT_KEY` and redeploy;
  2. after at least 10 minutes (the key list's cache and Supabase's), swap the two values so the new key signs and the old one stays published, and redeploy;
  3. after another 30 minutes (the longest token life twice over), clear `BOS_JWT_NEXT_KEY` and redeploy. The steps and their checks are in `docs/spikes/realtime.md` §5.
- **AWS access key** of the app user: [files-setup §5](files-setup.md#5-rotating-the-access-key).
- **`BETTER_AUTH_SECRET`:** never replace it outright; it also encrypts stored authenticator secrets. Follow SECURITY §10.
