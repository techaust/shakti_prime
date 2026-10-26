# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**26-10-2026, end of a PC day** (tooling and usage only; nothing in flight): the Claude tooling on the owner's claude.ai Team plan, with AWS through the user-scope `aws-mcp` server in place of the aws-core plugin and the tools this project does not use switched off on the PC only (#205); the budget gate for the Team plan's Premium seat, which has no weekly limit: new agents start while the 5-hour window is at or under 80 %, nothing new at 90 % or more (DECISIONS, 26-10-2026); the production dependency patch group (#202). TypeScript 7, ESLint 10 and `@types/node` 26 stay held (DECISIONS, 20-10-2026). Phase 1 (`currentPhase` 1 in `.claude/tooling.json`); all 23 of its slices are merged, and of its exit gate the journeys for the CC, LC, Store Manager and Executive paths are met; the parallel run, the migration counts and the sign-off per role wait on the client ([ROADMAP §3](03-roadmap.md#3-phase-1--mvp-1214-weeks)). Phase 0 closed on 29-09-2026 by the owner's decision; its gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). Production is built and waits on the owner's steps before its first release (below); going live with the client's data waits on the client's inputs and Phase 1's exit gate. Usage at the day's end: 5-hour window 12 %, Fable bar 0 %. Migrations on `main`: 0000 to 0159. The last security-suite run (#199's integration on the PC, fresh database, 20-10-2026): db 1,272, domain 1,041, web 342, all passed; unit tests (20-10-2026): domain 2,251, web 969 (1 skipped); db 137, contracts 182, ui 107, tokens 146, copy-lint 17 (17-10-2026).

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (all 23 slices)** as listed in [CHANGELOG](../CHANGELOG.md); G1 merged on 17-10-2026 (#187), with hardening batches 1 (#186), 2 (#189) and 3 (#191); on 20-10-2026 the updates (#197, #198, #201) and the demo data loader (#199); on 26-10-2026 the production dependency patches (#202) and the tooling on the Team plan (#205).
- **Next:** the owner's production steps and the first release (Waiting on the owner); then the client's inputs, the data move and the parallel run on production ([client-actions](13-client-packs/client-actions.md), [ROADMAP §3](03-roadmap.md#3-phase-1--mvp-1214-weeks)).
- **Work split:** each session wholly on the PC or wholly in a cloud session ([hybrid](runbooks/hybrid.md)); models and efforts: [models-and-usage](runbooks/models-and-usage.md).

### In progress
| Slice | Branch | Run file | Runs on | State | Next step |
|---|---|---|---|---|---|
| None | | | | | |

## Hosted environments
| | Dev | Staging | Production |
|---|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` | `shakti-prime-production` (ref `ifnoytyhnedgiyhxxhhu`), Pro, no point-in-time recovery |
| Migrated and seeded | through 0159 on 18-10-2026 (160 migrations), `db:verify` passed | through 0159 on 18-10-2026 (160 migrations), `db:verify` passed | empty; the first migration comes through the first release |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app | https://shaktiprime.com (project `shakti-prime-production`; builds only a release's tagged commit, nothing deployed yet) |
| Checks | `/api/v1/health` (naming `main`'s 75fadce3) and `/api/v1/health/ready` answered 200 on 20-10-2026 | the same | none yet |
| First Executive | made on 06-10-2026 | made earlier | after the first release |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev`, `notification-scan-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging`, `notification-scan-staging` | the eight `-production` ids of DEPLOY §2 step 6, after the first release |
| AWS files and backup stacks | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel | `shakti-prime-production-files` and the backup stack (`infra/aws/backups.yaml`), both by the owner (DEPLOY §1 step 9) |
| AI keys | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`; ₹100 a day on each of the six agents | the same | the keys; daily limits after the first release |
| Redis and Turnstile | per environment | per environment | `shakti-prime-production` (Mumbai) and a widget for `shaktiprime.com`, not yet in Vercel |

Read back from the PC on 18-10-2026, both databases: 160 rows, every pipeline with its lock hours in `drizzle.__drizzle_migrations`; `app_backup` can log in, bypasses RLS, holds at most two sessions, is no superuser and has no password (only the owner's script gives production's one); and the same five pg_cron jobs as the migrations define: `activities-partitions` (`5 3 25 * *`), `audit-logs-detach` (`30 3 1 * *`), `audit-logs-partitions` (`0 3 * * *`, daily since #168's 0133), `idempotency-keys-purge` (`30 2 * * *`) and `outbox-events-purge` (`45 2 * * *`). Everything else in this section is as on 12-10-2026: browser alerts with VAPID keys on dev and staging, the Vault refusing PDFs and photos on the hosted worker (`OCR_LANG_PATH`), every Vercel secret marked Sensitive, Sentry project `shakti-prime-web` (free plan, privacy settings on) with the outbox alert. SES: `shaktiprime.com` verified in Mumbai on 15-10-2026; production access granted on 17-10-2026 (case 179200499200682; read back: transactional, 50,000 mails a day, 14 a second). Plans, regions and bills: [accounts](runbooks/accounts.md).

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet.

## Waiting on the owner
- **The client's inputs that go-live waits on** ([client-actions](13-client-packs/client-actions.md)): the workshop answers (item 1), the CA's GST confirmation and invoices (2), the item list, HSN codes, rates and prices (3), the engineering values (4), the letterheads and bank details (7), the CRM export (8), dealer credit (9), targets (10), the privacy and consent wording with legal advice (11), and the people for acceptance testing and the parallel run (12); the design sign-off and the screen review (5, 6).
- **Production's steps before the first release** (G1, [DEPLOY §1](runbooks/deploy.md#1-before-the-first-deploy-once-per-environment); the `production` environment's reviewer and branch rule are made and read back, 17-10-2026): step 4 d, the environment's six secrets and `VERCEL_DEPLOY_HOOK_PRODUCTION`, through the lead's hidden-prompt script under the owner's own sign-in; 4 e, the lead's narrower token; 4 f, the `main` ruleset; step 9, the files stack `shakti-prime-production-files` and the backup stack with `tools/secrets/set-backup-login.ps1`; step 10, the deploy hook; production's variables in Vercel (Redis, Turnstile, the files stack's values, Sentry, `BACKUP_BUCKET`); then the first release, which the owner approves, the first Executive and the production schedules. Read back on 20-10-2026: the `production` environment holds no secret yet, no ruleset exists, and the production Vercel project holds only `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`.
- **The screen review's demo data** (#199, [wireframe-review §1a](13-client-packs/wireframe-review.md#1a-before-the-sessions)): the owner's yes to load it on staging; a decision on what `remove` leaves (the five "(demo)" customers stay listed with their leads Lost, since no command archives a customer or a lead: accept, or a customer and lead archive command in a slice of its own), and on what reviewers make in the sessions, which `remove` does not reach; the demo Team Lead's team made in the app (no command makes a team); GST rates and pump curves for the demo HSN codes, entered on staging, for task L2.
- **Validate the six checks added `NOT VALID`** on dev, then staging: the read-only pre-check of [DEPLOY §2](runbooks/deploy.md#2-every-deploy) step 8 first, then the six statements of [exit-gate-actions](13-client-packs/exit-gate-actions.md) row 18.
- **Monitoring from the audit batches:** the QStash schedules `jobs-check-<env>`, and `lead-anonymise-<env>` once the CA confirms the retention period. Sentry's free plan holds one cron monitor (production's `outbox-publish`) and one uptime monitor (production's `/api/v1/health/ready`), set up after the first release.
- **With the CA:** the two import retention periods of workshop FIN-3 (7 days for files, 30 days for rows), and FIN-2's consent evidence and anonymised audit rows.
- **Accounts for later phases, slow to open:** approve the vendor quote letters (client-actions 14); DLT registration of the four companies with 140- and 160-series numbers (17); Meta business verification and a WhatsApp number per company (18); a Google Play developer account for the field app.
- **Claude tooling, in the next session on the PC** ([tooling](runbooks/tooling.md)): sign in to Sentry (organisation `shakti-supreme`) when asked; in `/mcp`, switch off the Supabase and Upstash plugins' own servers so each runs once from the user-scope servers.
- **On the PC:** install Node 24.22 (LTS; CI already runs the latest 24) and restart the app; delete the leftover `node_modules` shells of the 20 removed slot worktrees in `D:/shakti-wt` (and, when wanted, the worktrees `deps-a11y` and `demo-data`, whose branches merged); say whether the local branches `backup/c3-before-rebase-2` and `p2-backup-before-rebase` (pre-rebase copies, commits not on GitHub) may go.
- **The environment's network list:** add `productionresultssa10.blob.core.windows.net`, so a cloud session can read CI logs and reports.
- **Confirm the Triage agent's named defaults** in `AGENT_DEFAULTS.triage` when convenient.
- **Confirm with Shakti** that the code being public while development continues is acceptable.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| The merge workflow's catch-up commits (main taken into a branch by its token) can hold their `pull_request` CI run for a person's approval, and the held run makes the workflow skip the pull request; #175, #177 and #198 needed "Approve and run" and a look started by hand (`run_state()` in `.github/workflows/automerge.yml`) | 1 / any slice |
| Dependabot's #204, `@anthropic-ai/sdk` 0.135.0 to 1.1.0, is a major bump the merge workflow does not merge: the lead takes it into a pull request of its own after reading the SDK's changes, and Dependabot then closes #204; #203 (the development group) merges itself on green | 1 / any slice |
| TypeScript 7, ESLint 10 and `@types/node` 26 held (DECISIONS, 20-10-2026): TypeScript when `typescript-eslint` supports it (today below 6.1), ESLint when the plugins inside `eslint-config-next` declare 10, `@types/node` with the move to Node 26 | 1 / any slice |
| The phone journey `imports.spec.ts` "uploads a list with an Aadhaar column" passed only on its retry once in CI (#198), which fails the run; its cause is not read | 1 / any slice |
| The main menu shows Converting for the Executive in some runs and not others; every screenshot now leaves the menu out (#174), the cause is not found | 1 / any slice |
| CI's desktop journeys failed once on #167 and passed on the re-run; the cause is unread because the environment's network policy blocks GitHub's log storage (`productionresultssa10.blob.core.windows.net`) | 1 / any slice |
| The OCR model bundled with the hosted worker (`OCR_LANG_PATH`), so the Vault takes PDFs and photos on dev and staging; masking timed on a Vercel function | 1 / any slice |
| The whole-repository lint needed a 6 GB heap after N1 (`package.json`); watch it as the repository grows | 1 / any slice |
| `drizzle-kit generate` needs a terminal for a column rename, so a builder patches the snapshot by script; a non-interactive way to answer its prompt | 1 / any slice |
| `shakti/field-button-alignment` reads only a button beside a `Field` or in a wrapper of buttons; a button two wrappers away, or an action beside a bare `Input`, is left to the journeys' `expectAligned` | 1 / any slice |
| The production copy and its restore drill have never run: watch the first CodeBuild copy after the backup stack is made, list it (the `start-session` skill's line), and run the drill of DATABASE §10 once | 1 / after the first release |
| A retired proof page whose bytes fail to delete stays rejected and is never served, but its bytes stay in the private bucket until removed by hand (G1) | 1 / any slice |
| Every push to `main` starts a production deployment that the build gate cancels; and if the repository becomes private, the gate's anonymous `git ls-remote` fails and every production build is skipped until it has a read-only token (G1) | 1 / when the repository goes private |
| `/settings/profile` is at 189.5 kB against its 200 kB budget; the last 3.5 kB is the menu icons in the shell's script, on every page (a design choice for the owner) | 1 / any slice |
| `pipelines.spec.ts` with two local workers: its three projects share one database and the stage test's `nth(3)` collides (CI runs each project on its own database) | 1 / any slice |
| CI's minutes: about 500 a day while slices merge; trim the journeys or the Lighthouse run if a budget is set | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/04-architecture-appendix/print.md` (the owner's upload check passed on both sites) | 1 / any slice |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / any slice |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](03-roadmap-appendix/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
