# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**13-10-2026, 13:30 IST, cloud day in progress.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; its gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). Waves 1 to 5 are merged; in wave 6, M1 is in its fix round and G1 waits on the owner's accounts. On 12-10-2026 the owner asked for a deep audit of Phases 0–1 with every code-fixable finding fixed ("10/10"): the report is [14-reviews/2026-10-audit.md](14-reviews/2026-10-audit.md) (no critical, three high: DOM-1, SEC-1, DATA-1) and its fixes run as four batches. Merged today: #167 (tooling and test stability), #168 (database follow-ups, migrations 0130 to 0133), #169 (a stable PDF masking test), #170 (the audit's web batch, migrations 0134 and 0135), #171 (the audit's events and jobs batch, migrations 0136 to 0140). Migrations on `main`: 0000 to 0140; dev and staging are migrated through 0140. The owner set the weekly part of the budget gate aside for this work (reading 06:24 IST: 5-hour 11 %, week 21 %); three builders run at once, the cloud-day limit. The plan's 5-hour limit stopped every agent once (12-10-2026, about 22:30 UTC) and the container restarted three times; no work was lost (every branch pushed every 10 minutes).

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (21 of the 23 slices)** as listed in [CHANGELOG](../CHANGELOG.md), and today #167, #168, #169.
- **Next:** finish the slices and batches in flight (below), then the privacy and CI batches; G1 when the owner's accounts exist.
- **Work split:** each session wholly on the PC or wholly in a cloud session ([hybrid](runbooks/hybrid.md)); models and efforts: [models-and-usage](runbooks/models-and-usage.md).

### In progress
Each run file is `docs/runs/phase1/<slug>.md` on its branch; worktrees under `/home/user/shakti-wt/` on this cloud day.

| Work | Branch, slot | State | Next |
|---|---|---|---|
| M1 Migration and UAT packs (Tier A) | `feat/m1-migration-uat`, slot 1 (54331) | review found 3 high, 4 medium, 6 low; fix round building, the lead's decisions in the run file's Review section and the owner's audit-row decision (DECISIONS 13-10-2026) | re-review the fix diff (a high was found), merge `main`, renumber after 0133, integrate, pull request; then QStash schedule `lead-anonymise-<env>` by the owner |
| Audit: sales integrity (Tier A) | `fix/audit-sales`, slot 5 (54335) | early check passed; screens, journeys and documents building | review at xhigh, integrate (migrations 0134 to 0136 renumber; check dev and staging for a lead with two accepted quotes before migrating) |
| Audit: web (Tier B) | `fix/audit-web`, slot 4 (54334) | built (17 items), review running | fix round, integrate (every desktop-dark baseline and the phone card screens remade in Linux) |
| Audit: events, jobs and observability (Tier A) | `fix/audit-data`, slot 7 (54337) | items 1 to 5 early-checked; items 6 to 8 building (the hot reads under RLS with statistics) | review at xhigh, integrate; owner: Sentry rules for `job.failing` and `job.problem`, QStash `jobs-check-<env>` |
| Audit: privacy (Tier A) | to branch after M1 merges, slot 6 | brief written (SEC-1, SEC-2, SEC-3, OPS-5) | build |
| Audit: CI, merging, tests and documents (Tier A) | to branch, slot 8 | brief written, with the owner's `checks-ok` label rule (OPS-2) | build |

The two waiting briefs are [audit-privacy](runs/phase1/audit-privacy.md) and [audit-ci](runs/phase1/audit-ci.md); each moves to its branch when it is made. The audit's evidence and verdicts are in [14-reviews/2026-10-audit/](14-reviews/2026-10-audit/).

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0140 on 14-10-2026 (141 migrations), `db:verify` passed | through 0140 on 14-10-2026 (141 migrations), `db:verify` passed |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answered 200 on 13-10-2026 | the same |
| First Executive | made on 06-10-2026 | made earlier |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev`, `notification-scan-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging`, `notification-scan-staging` |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel |

#168's 0133 moved the pg_cron job `audit-logs-partitions` to daily at 03:00 UTC (not read back from the cloud session: `select jobname, schedule from cron.job` on a PC day). Everything else in this section is as on 12-10-2026: browser alerts with VAPID keys on both sites, the Vault refusing PDFs and photos on the hosted worker (`OCR_LANG_PATH`), every Vercel secret marked Sensitive, Upstash Redis per environment, Turnstile for both hostnames, Sentry project `shakti-prime-web` with the outbox alert, no Anthropic or Voyage key yet. Plans, regions and bills: [accounts](runbooks/accounts.md).

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet.

## Waiting on the owner
- **A usage reading** (`usage: 5h N, week N`) before the next builder starts; the last was 06:24 IST.
- **G1's accounts, which take days:** a paid production Supabase project, Vercel Pro (or the client's Pro team), the client's domain verified for Amazon SES and SES production access, and a GitHub plan with environments.
- **The environment's network list:** add `productionresultssa10.blob.core.windows.net`, so a cloud session can read CI logs and reports.
- **Before the sales batch is migrated:** on dev and staging, `select opportunity_id from quotes where state = 'accepted' group by 1 having count(*) > 1` returns nothing (its new unique index cannot build otherwise).
- **After M1 and the events batch merge:** the QStash schedules `lead-anonymise-<env>` and `jobs-check-<env>`, and Sentry alert rules for `job.failing` and `job.problem`.
- **On the PC:** delete `D:/shakti-wt/heavy.sh` if it exists.
- **Confirm the Triage agent's named defaults** in `AGENT_DEFAULTS.triage` when convenient.
- **Before the repository goes private again:** a GitHub Actions budget or the 1 November reset; confirm with Shakti that the code being public for now is acceptable.
- **The Anthropic and Voyage keys** on dev and staging, and a spending limit on Admin › Agents.
- **Hand the workshop pack to the client** (CALL-2 to CALL-5 among its questions; M1 adds to FIN-2 the CA's word on consent evidence and on anonymised audit rows); **approve the vendor quote letters**; **add the PIN code list** before the client's customer file.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| `orders.test.ts` timed out once in a full domain run and passed alone (09-10-2026) | 1 / any slice |
| CI's desktop journeys failed once on #167 and passed on the re-run; the cause is unread because the environment's network policy blocks GitHub's log storage (`productionresultssa10.blob.core.windows.net`) | 1 / any slice |
| `search.test.ts` "puts the exact name first…" failed once on `main` after #168 and passed on the re-run: another test's person can match the fuzzy name search (in the CI batch, `fix/audit-ci`) | 1 / any slice |
| `pipelines.spec.ts` "lists the referral partners…" was flaky once in the Linux screenshot run (12-10-2026) | 1 / any slice |
| `customers.test.ts` reused a random tag name of an earlier run on the same database (M1's run, 13-10-2026) | 1 / any slice |
| On the PC, an older copy of the lock script at `D:/shakti-wt/heavy.sh` skips the queue of #167: delete it (#167 review #4) | 1 / any slice |
| The push toggle tells a second person at a browser held by another that alerts are on (#168 review L4, from N1) | 1 / any slice |
| This session's checkout predates #167, so the lock it serves is the old one; a fresh session takes `main` | 1 / any slice |
| Playwright 1.64 by hand: `@playwright/test` and `playwright-core` together, the image `mcr.microsoft.com/playwright:v1.64.0-noble` in `.github/workflows/ci.yml`, `apps/web/e2e/setup/snap-in-linux.ts` and [TESTING](09-testing.md), and every screenshot baseline compared and remade where the new browser draws differently (Dependabot leaves Playwright alone, #162) | 1 / any slice |
| `orders.spec.ts` "dealer credit" failed once in a screenshot run and passed on retry (10-10-2026) | 1 / any slice |
| A Triage event redelivered after a partial run calls the model again for the steps left; keep the answer under the event id in the key-value store (A1 review #7) | 1 / any slice |
| The OCR model bundled with the hosted worker (`OCR_LANG_PATH`), so the Vault takes PDFs and photos on dev and staging; masking timed on a Vercel function | 1 / any slice |
| A Vault page whose turn begins late (25 s) can outrun the route's 60 s with its own 45 s once; bound the page's time by what is left of the delivery (K1) | 1 / any slice |
| Read again on a file waiting six minutes can race QStash's redelivery and read it twice (K1 review #13) | 1 / any slice |
| A passed-on enquiry carries no note and drops a consent captured on the walk-in form (N1 review L2) | 1 / any slice |
| The orders snapshot journey's page load can pass 60 s on a loaded PC (passed on retry, 09-10-2026) | 1 / any slice |
| The whole-repository lint needed a 6 GB heap after N1 (`package.json`); watch it as the repository grows | 1 / any slice |
| `drizzle-kit generate` needs a terminal for a column rename, so a builder patches the snapshot by script; a non-interactive way to answer its prompt | 1 / any slice |
| `pipelines.lock_hours` is `not null default 48`, so `WORKSHOP_DEFAULTS.opportunity.handoverLockHours` is never reached; the lock length has two copies of 48 (the column default and the workshop default) | 1 / any slice |
| The handover's state-machine check runs on a made-up lead record and can never refuse; the database function holds the real check (T2 review #9) | 1 / any slice |
| `shakti/field-button-alignment` reads only a button beside a `Field` or in a wrapper of buttons; a button two wrappers away, or an action beside a bare `Input`, is left to the journeys' `expectAligned` | 1 / any slice |
| A nurtured lead's owner and nurture calls on reassignment (`crm.opportunity.assign` runs only from open), and the handover tested with a callback open: as `system:workers`, which holds no `crm.lead.write`, `moveCallTasks` moves nothing | 1 / T2 |
| `/settings/profile` is at 192.3 kB against its 200 kB budget (186.0 on 29-09-2026; the bell is part of the growth) | 1 / any slice |
| Account 360 marks a withdrawn call consent beside the number and drops its `tel:` link | 1 / any slice |
| The Activity log reads a duplicate card set aside as "Dismissed", the agent action's word (states are looked up by value alone) | 1 / any slice |
| CI's minutes: about 500 a day while slices merge; trim the journeys or the Lighthouse run if a budget is set | 1 / any slice |
| The add-partner form: a referral partner made as a customer of the kind Referral partner with no lead (owner, 05-10-2026) | 1 / after C3 |
| Referral codes in the import mapping | 1 / after P2b |
| The walk-in form's PIN box gets P2b's PIN lookup | 1 / after P2b |
| The server logs "The destination stream closed early" as an error when a browser leaves a page while it loads, on existing screens too | 1 / any slice |
| Admin › Agents: the per-action autonomy select cuts its text short on desktop | 1 / any slice |
| `tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/04-architecture-appendix/print.md` (the owner's upload check passed on both sites) | 1 / any slice |
| A company's earlier proof pages keep a replaced bank account readable: remove them when a new one is printed (P4 review L10) | 1 / G1 |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / any slice |
| An index on open leads by company for the nightly rescore, if the hosted volume needs it (C3 review L8) | 1 / G1 |
| The demo data loader for the screen review: a small, clearly labelled set and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](03-roadmap-appendix/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
