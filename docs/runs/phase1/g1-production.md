# G1 Production readiness (wave 6)

| | |
|---|---|
| Branch | `feat/g1-production`, from `main` once the owner's account items below are done |
| PC worktree | `g1-production`, slot 1: Postgres 54331 (container `shakti-pg-g1-production`), app 3031 |
| Runs on | PC (owner, 14-10-2026); the hosted steps from the lead session |
| Tier | A (a miss reaches production): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | not started; 15-10-2026: 5h 4, week 80 (the week resets on 19-10-2026, and a new slice starts only under 70 %) |
| State | brief; part 1 done on 15-10-2026 except SES production access, which production does not wait for |
| Next step | the lead starts the builder on part 2 after the weekly reset (19-10-2026) |

## Brief
Design: [`docs/03-roadmap-appendix/phase1.md`](../../03-roadmap-appendix/phase1.md) §10 (G1). Runbooks: [deploy](../../runbooks/deploy.md) §1 and §2, [files-setup](../../runbooks/files-setup.md) §1 to §4 and §7, [accounts](../../runbooks/accounts.md), [cutover](../../runbooks/cutover.md), [incidents](../../runbooks/incidents.md). Exit-gate actions 2, 3, 7, 8 and 9 ([exit-gate-actions](../../13-client-packs/exit-gate-actions.md)); the 2026-09 audit's M45; ADR 0003, 0015 and 0017.

G1 opens a third hosted environment, `production`, on the group's own domain, beside dev and staging, and makes every way into it reviewed: no deploy, migration or secret reaches production without the owner's approval. Staging keeps synthetic data only; the client's real file, the parallel run, the reconciliation and the ⌘K measurement happen on production after G1.

### Part 1. The owner's account items (before any build)
Done on 15-10-2026 and read back by the lead where its tools reach (the owner's decisions are rows of [DECISIONS](../../11-decisions.md)):
- the domain `shaktiprime.com`, on Cloudflare DNS; the system lives at the bare domain, whose two `A` records point at Vercel (`216.150.1.1`, `216.150.16.1`), DNS only;
- SES in Mumbai: the domain identity `shaktiprime.com` verified (Easy DKIM, MAIL FROM `mail.shaktiprime.com`, DMARC `p=none`); production access asked for and refused on the first, automated review (case 179200499200682); the AWS account 199476069348 also serves production, with a $25 monthly cost budget;
- Supabase on Pro; the project `shakti-prime-production` (ref `ifnoytyhnedgiyhxxhhu`), Mumbai, Postgres 17, Data API off, new tables not exposed, no automatic-RLS trigger, SSL enforced, Micro compute, empty; no point-in-time recovery;
- Vercel Pro with a $50 spend limit; the project `shakti-prime-production` (root `apps/web`, functions in `bom1`, Vercel's login on its own addresses, Ignored Build Step `exit 0` so nothing deploys), with `shaktiprime.com` added and configured; `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` its only variables;
- Sentry on the free Developer plan for good, the project's privacy settings on;
- the repository stays `techaust/shakti_prime`, public;
- Upstash Redis `shakti-prime-production` (Mumbai, Pay as You Go, eviction off); QStash on the same account, Pay as You Go;
- a Turnstile widget for `shaktiprime.com`;
- the Anthropic and Voyage keys of each environment, checked by the owner's script against both vendors;
- production deploys by an approved release.

What each item asked for:

The lead's tools see none of the production accounts yet (read-only check, 14-10-2026): the Supabase organisation *Shakti Prime* is on the Free plan with dev and staging only; the Vercel team `shakti-prime` has dev and staging only and no domain; the repository `techaust/shakti_prime` is a personal, public repository; the AWS account of `claude-shakti` has SES in the sandbox (200 mails a day, production access off) with no verified identity, and only the dev and staging files stacks. Each item below says what the owner gives; secrets never go in a chat, only into GitHub or Vercel through the hidden-prompt scripts the lead writes.

1. **The domain.** The domain's name; the address the BOS lives at (recommended: a subdomain such as `bos.<domain>`, so the group's website is untouched); who changes its DNS records and where (registrar or Cloudflare), so the lead can hand them the exact records.
2. **Supabase production project.** Which organisation holds it (the paid organisation's name). If it is not *Shakti Prime*, invite the Supabase login the PC's Supabase connection uses to that organisation as Developer (read-only use), or sign the connection in again so it sees it. The project: `shakti-prime-production`, Mumbai (`ap-south-1`), Postgres 17, on Pro with point-in-time recovery; Data API off; SSL enforced; the database password kept in the owner's password store. The lead never applies anything to it outside the migrate workflow.
3. **Vercel Pro.** Whether the Pro plan is on the team `shakti-prime` or on a group team; for a group team, an invitation to it for the account the Vercel connection uses. The owner's go-ahead for the lead to create the project `shakti-prime-production` (root `apps/web`, functions in `bom1`) and add the domain to it, or the owner creates it.
4. **Amazon SES and the production AWS files stack.** Which AWS account production uses (the same account, 199476069348, or a group account; for a group account, a read-only IAM user like `claude-shakti` there). With the administrator login, the owner creates the SES domain identity and asks for production access ([files-setup §7](../../runbooks/files-setup.md#7-verifying-the-clients-domain-for-mail)) and creates the stack `shakti-prime-production-files` from `infra/aws/files.yaml` with the verified sender `no-reply@<domain>` ([files-setup](../../runbooks/files-setup.md) §1 to §4). The DNS records SES lists go to the person of item 1: three DKIM `CNAME`s, the MAIL FROM `MX` and SPF `TXT`, and the `_dmarc` `TXT`.
5. **Sentry production.** The organisation `shakti-supreme`'s plan (Settings › Subscription), since eight cron monitors and the uptime monitor go past the free allowance; production is the environment `production` of the project `shakti-prime-web` (the events already carry `BOS_ENVIRONMENT`). The owner switches on the project's privacy settings (exit-gate action 2) and makes the alert rules, monitors and uptime check of [deploy §1](../../runbooks/deploy.md#1-before-the-first-deploy-once-per-environment) step 8 for production.
6. **GitHub plan with environments.** Where the repository lives for production: stay `techaust/shakti_prime` (public, where environments with a required reviewer and branch rules are free) or move to the group's organisation on a plan with them; for a move, a new GitHub token for the PC's GitHub connection. Then an environment `production` with the owner as required reviewer, holding the six migration secrets without a suffix (`DATABASE_URL_MIGRATOR`, `APP_USER_PASSWORD`, `AUTH_SERVICE_PASSWORD`, `OUTBOX_PUBLISHER_PASSWORD`, `DATABASE_CA_CERT`, `APP_READER_PASSWORD`), set by the lead's script; and a branch rule on `main` (no direct push, no force push, no deletion, the CI checks required) that the merge-on-green workflow still passes.
7. **The services the owner did not list, also needed:** an Upstash Redis database `shakti-prime-production` (Mumbai, Pay as You Go, eviction off); a Cloudflare Turnstile widget for the BOS hostname; the QStash schedules for production (the lead gives each id, address and cron); and, when the owner chooses, the Anthropic and Voyage keys with a spending limit (exit-gate action 6).

### Part 2. What the builder builds (after part 1)
1. **Production in the migrate workflow** (`.github/workflows/migrate.yml`): `production` among the choices, bound to the GitHub environment `production` (so a run waits for the owner's approval), reading the unsuffixed secrets, refusing any ref but `main` and any address that does not name the production project's ref; `rotate_passwords` works the same way. The workflow is a gate file, so its pull request waits for the owner's `checks-ok` label.
2. **The production deploy is a release, not a push** (the owner's choice, asked at the start; the recommended option): Vercel builds `main` for production only when a release asks for it. A `release.yml` workflow (manual, environment `production`) checks that CI on the chosen `main` commit is green and that staging serves that commit, migrates production with `db:verify` and the seed, then triggers the production project's deploy hook (`VERCEL_DEPLOY_HOOK_PRODUCTION`, an environment secret) and checks `/api/v1/health/ready`. The production project skips the builds Vercel would start on each push (`ignoreCommand` keyed to `BOS_ENVIRONMENT=production`, so dev and staging still deploy on every merge).
3. **The configuration for production:** `productionConfigProblems()` already refuses a missing `SENTRY_DSN`, `MAILER` other than `ses` and an unsafe value; add a test that a `production` configuration with every required value starts, and one per missing value. `apps/web/scripts/qstash-schedule.ts` makes the production schedules under `-production` ids; the schedule list in [deploy §2](../../runbooks/deploy.md#2-every-deploy) names them.
4. **From the owner's decisions of 15-10-2026:**
   - the files stack: `infra/aws/files.yaml` accepts `EnvironmentName` `production` and lets the browser upload from `https://shaktiprime.com` for it (it allows only `dev` and `staging` and their `vercel.app` addresses today); the owner then creates `shakti-prime-production-files` with `SesIdentity` `shaktiprime.com` and `SesFromAddress` `no-reply@shaktiprime.com`;
   - backups without point-in-time recovery: a workflow (environment `production`) runs `pg_dump` of production every 6 hours into an S3 backup bucket in Mumbai, encrypted, kept 30 days, and the restore drill of DATABASE §10 reads from it; DATABASE §10 and ARCHITECTURE's availability row state a loss of at most about 6 hours;
   - Sentry on the free plan: dev and staging send a sample of their errors (production all of them); one cron monitor, on `outbox-publish`, the other jobs left to the in-app `jobs-check` alerts; one uptime monitor, on production's `/api/v1/health/ready`; deploy §1 step 8 says so;
   - SES in the sandbox: production starts with `MAILER=ses` and `SES_FROM`; deploy says to verify each first person's address in SES until production access is granted, and to ask again once the sign-in page is live.
5. **The follow-ups tagged G1** in [STATUS](../../10-status.md#open-follow-ups): a company's earlier proof pages removed when a new one is printed (P4 review L10); the open-leads index for the nightly rescore only if `EXPLAIN` on a production-sized seed shows the need (C3 review L8), with the evidence in the report either way; the SES mailer switched on for production (configuration only, item 3).
6. **Documents:** deploy §1 and §2 for production (the release, the approval, the schedules), accounts (production in every row, the Hobby risk row gone once dev and staging are on Pro), ADR 0017 and the 2026-09 audit's M45 resolution, incidents (a release to roll back: Vercel's instant rollback, and a migration is never rolled back, a fix goes forward), cutover's first steps pointing at production, exit-gate actions 2, 3, 7, 8 and 9, design §10 "Built (G1)", client-actions.

Done when: the checks of AGENTS §10 pass on the branch; the security suite passes on the slot's Postgres; a release run on a test commit is shown waiting for approval and refusing a ref other than `main` (proven on a copy of the workflow pointed at staging, never at production before the owner's go); the documents name no step the owner cannot follow.

Not in G1's build: creating any hosted resource or setting any secret (the owner, or the lead with the owner's yes for each); the client's data, the parallel run and UAT (they follow G1 on production); any change to tax, price or credit logic.

**Early check:** when items 1 to 3 are committed with their tests, commit, report and stop; the lead reads the workflows before the documents.

**Then the lead, with the owner:** the first production migration and seed through the release; the first Executive ([deploy §4](../../runbooks/deploy.md)); the production QStash schedules; the eight Sentry cron monitors seen; the health checks; the Realtime spike on the production domain (exit-gate action 5); STATUS's Hosted environments gains a Production column.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
- The pull request changes `.github/`, so it merges only after the owner adds `checks-ok` (DECISIONS, 13-10-2026).
- Nothing is applied to production by the merge: the first release is a separate, approved run.
