# Accounts and services

Every outside service the system uses: what exists, on which plan and in which region, what it is for, where its bill is seen, and what changes before production. This page is the one record of the hosted inventory; other documents link here rather than repeat it. Updated 07-10-2026 from the services' read-only pages; the state of each hosted environment (migrations, schedules, files stacks) is in [STATUS](../10-status.md#hosted-environments), so this page holds only what each service is. A cell marked *confirm* is one only the account holder can see, and it names where the holder reads it. Monthly amounts are read from each billing page, never estimated here; the commercial estimate is BLUEPRINT §13.

Workshop item ACC-2 asks the group to hold every account in its own name, with the development team as members ([client actions](../13-client-packs/client-actions.md) item 13). Secrets for these services never go in the repository or a chat; [DEPLOY](DEPLOY.md) says where each one is set and how it is rotated.

## In use

| Service | What exists | Plan | Used for | Bill and settings | Before production |
|---|---|---|---|---|---|
| GitHub | Repository `techaust/shakti_prime` (public for now, owner 06-10-2026; private before) | Free: 2,000 Actions minutes a month for a private repository (used up on 06-10-2026), free minutes and branch rules while public; no environments ([ADR 0017](../adr/0017-github-free-plan-trimmed-ci.md)) | Code, CI, the merge-on-green and migrate workflows, the repository secrets for migrations | github.com → Settings → Billing and plans | A plan with environments and branch rules, or the group's organisation (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45) |
| Vercel | Team *Shakti Prime* (`shakti-prime`); projects `shakti-prime-dev` and `shakti-prime-staging`, functions in `bom1` | Hobby (see the risk below) | Hosting the web app; deploys `main` to both projects | vercel.com → team → Settings → Billing | Pro, or the group's Pro team ([DECISIONS](../11-decisions.md)) |
| Supabase | Organisation *Shakti Prime*; projects `shakti-prime-dev` and `shakti-prime-staging` in Mumbai (`ap-south-1`), Postgres 17 | Free | The database, row-level security, pg_cron | supabase.com → organisation → Billing | A production project on a paid plan with point-in-time recovery (DATABASE §10). The free plan may pause a project that sees no activity for a while; a paused project is restored from its dashboard ([INCIDENTS §7](INCIDENTS.md#7-a-paused-supabase-project)) |
| Upstash Redis | `shakti-prime-dev` and `shakti-prime-staging`, primary region Mumbai, eviction off | Pay as You Go | Rate limits, sign-in lockouts, short-lived keys | console.upstash.com → Redis → the database → Usage | A production database the same way |
| Upstash QStash | One QStash account, EU region; schedules on dev and staging ([STATUS](../10-status.md#hosted-environments)); URL groups `evt-<type>` made by the publisher | *confirm*: console.upstash.com → QStash → the plan shown on its page | Delivering outbox events to the workers | console.upstash.com → QStash → Usage | Production signing keys and URL groups |
| Cloudflare Turnstile | Widgets for both hostnames | Free | The robot check on sign-in and forgotten password | dash.cloudflare.com → Turnstile | A widget for the group's domain |
| Sentry | Organisation `shakti-supreme` (US region, the group's existing organisation), project `shakti-prime-web`, the alert "Message queue failing (outbox)" | *confirm*: shakti-supreme.sentry.io → Settings → Subscription | Error reports with personal data removed ([ADR 0015](../adr/0015-sentry-us-region-scrubbed.md)) | shakti-supreme.sentry.io → Settings → Subscription | The owner switches on the project's privacy settings ([STATUS](../10-status.md#waiting-on-the-owner)) |
| AWS | Region `ap-south-1`; the read-only IAM user `claude-shakti` for the development tools; the files stack of each environment (`infra/aws/files.yaml`: bucket, KMS key, malware scan, one app user) | *confirm*: console.aws.amazon.com → Billing and Cost Management → Bills | File storage, field encryption, and mail through Amazon SES | console.aws.amazon.com → Billing and Cost Management | A files stack for production ([files-setup](files-setup.md)); SES production access with the group's domain verified |
| Claude Code and Context7 | The owner's own accounts | Claude Code on the owner's Max plan (5x); Context7 on its own plan | Building the system; not part of the running product | — | Nothing |

**Risk: Vercel Hobby.** Vercel's terms limit the Hobby plan to non-commercial, personal use, and a client's business system is commercial use. While dev and staging stay on Hobby, Vercel may limit or stop the projects. The owner accepted Hobby for dev and staging at their own risk ([DECISIONS](../11-decisions.md), 29-09-2026); production runs only on Pro or the group's Pro team.

## Planned, not yet opened

| Service | Phase | Used for | Who opens it |
|---|---|---|---|
| The group's domain and its DNS | Before production (G1) | The site address and mail sending (DKIM, SPF, DMARC) | The group |
| Anthropic (Claude API) and Voyage | 1 (AI0, K1) | Agents, document reading, embeddings, with a monthly limit | The group, keys set by the development team |
| Browser push keys (VAPID) | 1 (N1) | Notifications | Made by a script; no account |
| Exotel, DLT registration | 2 | Calling with 140 and 160 series numbers | The group ([client actions](../13-client-packs/client-actions.md) items 13 and 17) |
| Meta (WhatsApp Business) | 2 | Customer messages and quote acceptance | The group (item 18) |
| LiveKit Cloud and a speech vendor | 2 | The voice assistant | The group, after the voice spike |
| Expo (EAS) and Google Play | 4 | The field app | The group |
| Tally connector machine | 5 | Reading Tally | The group's Accounts team |

The vendor quote requests for these are in [vendor-quotes](../13-client-packs/vendor-quotes.md).
