# Accounts and services

Every outside service the system uses: what exists, on which plan and in which region, what it is for, where its bill is seen, and what changes before production. This page is the one record of the hosted inventory; other documents link here rather than repeat it. Updated 15-10-2026 from the services' read-only pages and the owner's account work; the state of each hosted environment (migrations, schedules, files stacks) is in [STATUS](../10-status.md#hosted-environments), so this page holds only what each service is. A cell marked *confirm* is one only the account holder can see, and it names where the holder reads it. Monthly amounts are read from each billing page, never estimated here; the commercial estimate is BLUEPRINT §13.

Every account is held in the group's name, and the owner has full access to each (workshop ACC-2, [client actions](../13-client-packs/client-actions.md) item 13; [DECISIONS](../11-decisions.md), 15-10-2026). Secrets for these services never go in the repository or a chat; [DEPLOY](deploy.md) says where each one is set and how it is rotated.

## In use

| Service | What exists | Plan | Used for | Bill and settings | Before production |
|---|---|---|---|---|---|
| GitHub | Repository `techaust/shakti_prime`, public while development continues | Free: free minutes and branch rules while public; no environments on a free private repository ([ADR 0017](../adr/0017-github-free-plan-trimmed-ci.md)) | Code, CI, the merge-on-green and migrate workflows, the repository secrets for migrations | github.com → Settings → Billing and plans | The environment `production` and a branch rule on `main` (G1); GitHub Pro from the moment the repository is made private (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45) |
| Vercel | Team *Shakti Prime* (`shakti-prime`); projects `shakti-prime-dev`, `shakti-prime-staging` and `shakti-prime-production` (domain `shaktiprime.com`), functions in `bom1` | Pro, with a $50 spend limit | Hosting the web app; deploys `main` to dev and staging; production only through an approved release (G1) | vercel.com → team → Settings → Billing | The production project's variables and release (G1) |
| Supabase | Organisation *Shakti Prime*; projects `shakti-prime-dev`, `shakti-prime-staging` and `shakti-prime-production` (ref `ifnoytyhnedgiyhxxhhu`) in Mumbai (`ap-south-1`), Postgres 17 | Pro; production on Micro compute, without point-in-time recovery | The database, row-level security, pg_cron | supabase.com → organisation → Billing | Production's first migration through a release, and its 6-hourly backup to S3 (G1, DATABASE §10) |
| Upstash Redis | `shakti-prime-dev`, `shakti-prime-staging` and `shakti-prime-production`, primary region Mumbai, eviction off | Pay as You Go | Rate limits, sign-in lockouts, short-lived keys | console.upstash.com → Redis → the database → Usage | Production's values in Vercel (G1) |
| Upstash QStash | One QStash account, EU region, serving every environment; schedules on dev and staging ([STATUS](../10-status.md#hosted-environments)); URL groups `evt-<type>` made by the publisher | Pay as You Go | Delivering outbox events to the workers | console.upstash.com → QStash → Usage | Production's schedules and signing keys (G1) |
| Cloudflare Turnstile | Widgets for the dev and staging hostnames and for `shaktiprime.com` | Free | The robot check on sign-in and forgotten password | dash.cloudflare.com → Turnstile | Production's keys in Vercel (G1) |
| Sentry | Organisation `shakti-supreme` (US region, the group's existing organisation), project `shakti-prime-web` with its privacy settings on, the alert "Message queue failing (outbox)" | Free (Developer): 5,000 errors a month, one cron monitor, one uptime monitor | Error reports with personal data removed ([ADR 0015](../adr/0015-sentry-us-region-scrubbed.md)) | shakti-supreme.sentry.io → Settings → Subscription | The cron monitor on `outbox-publish` and the uptime monitor on production, dev and staging errors sampled (G1) |
| AWS | Account 199476069348, region `ap-south-1`, serving every environment; the read-only IAM user `claude-shakti` for the development tools; the files stack of dev and staging (`infra/aws/files.yaml`: bucket, KMS key, malware scan, one app user); the SES domain identity `shaktiprime.com`, verified, with production access; a $25 monthly cost budget | *confirm*: console.aws.amazon.com → Billing and Cost Management → Bills | File storage, field encryption, and mail through Amazon SES | console.aws.amazon.com → Billing and Cost Management | The production files stack ([files-setup](files-setup.md), after G1) |
| Claude Code and Context7 | The owner's own accounts | Claude Code on the owner's Max plan (5x); Context7 on its own plan | Building the system; not part of the running product | — | Nothing |
| Domain and DNS | `shaktiprime.com` on Cloudflare: the `A` records for Vercel and the SES records (DKIM, MAIL FROM, DMARC), all DNS only | The group's registration | The site address and mail sending | dash.cloudflare.com → `shaktiprime.com` | Nothing |
| Anthropic (Claude API) and Voyage | Keys for dev, staging and production, each environment its own; dev and staging agents limited to ₹100 a day each | Prepaid, with a spend limit on each Anthropic workspace | Agents, document reading, embeddings | console.anthropic.com and dash.voyageai.com → Billing | Production's daily limits on Admin › Agents after the first release |

## Planned, not yet opened

| Service | Phase | Used for | Who opens it |
|---|---|---|---|
| Browser push keys (VAPID) | 1 (N1) | Notifications | Made by a script; no account |
| Exotel, DLT registration | 2 | Calling with 140 and 160 series numbers | The group ([client actions](../13-client-packs/client-actions.md) items 13 and 17) |
| Meta (WhatsApp Business) | 2 | Customer messages and quote acceptance | The group (item 18) |
| LiveKit Cloud and a speech vendor | 2 | The voice assistant | The group, after the voice spike |
| Expo (EAS) and Google Play | 4 | The field app | The group |
| Tally connector machine | 5 | Reading Tally | The group's Accounts team |

The vendor quote requests for these are in [vendor-quotes](../13-client-packs/vendor-quotes.md).
