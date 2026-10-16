# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**15-10-2026, end of a PC day** (no slice built and no pull request merged; the day went to the production accounts with the owner). Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; its gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). The deep audit of Phases 0–1 ([14-reviews/2026-10-audit.md](14-reviews/2026-10-audit.md)) is closed in code; what is left waits on people (below). Every account G1 needs is open except SES production access, which production does not wait for ([DECISIONS](11-decisions.md), 15-10-2026): the system will live at `https://shaktiprime.com`, deployed by releases the owner approves. Usage at the day's end: week 80 % (resets 19-10-2026), so G1's builder starts after the reset. Migrations on `main`: 0000 to 0155. The last security-suite run (the PC on the local Postgres, 14-10-2026, after `pnpm typecheck` passed): db 1,261, domain 1,019, web 326, all passed; unit tests (the sales batch's integration, 14-10-2026): domain 2,241, web 847 (1 skipped), db 137, contracts 182, ui 107, tokens 146, copy-lint 17.

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (22 of the 23 slices)** as listed in [CHANGELOG](../CHANGELOG.md); M1 merged on 14-10-2026 (#172).
- **Next:** G1 Production readiness ([design §10](03-roadmap-appendix/phase1.md#10-wave-6)). Its part 1, the owner's accounts, is done and read back ([g1-production](runs/phase1/g1-production.md)); its part 2 holds the owner's decisions of 15-10-2026 (the production files stack, the 6-hourly backup in place of point-in-time recovery, Sentry's free plan, going live with SES in the sandbox). The builder (Tier A) starts after the weekly reset on 19-10-2026. Going live after G1 waits on the client's inputs and Phase 1's exit gate ([client-actions](13-client-packs/client-actions.md), [ROADMAP §3](03-roadmap.md#3-phase-1--mvp-1214-weeks)).
- **Work split:** each session wholly on the PC or wholly in a cloud session ([hybrid](runbooks/hybrid.md)); models and efforts: [models-and-usage](runbooks/models-and-usage.md).

### In progress
| Slice | Branch | Run file | Runs on | State | Next step |
|---|---|---|---|---|---|
| G1 Production readiness | `feat/g1-production` (not made yet) | [g1-production](runs/phase1/g1-production.md) | PC | brief; part 1 done | the lead starts the builder (Tier A) after the weekly reset on 19-10-2026 |

## Hosted environments
| | Dev | Staging | Production |
|---|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` | `shakti-prime-production` (ref `ifnoytyhnedgiyhxxhhu`), Pro, no point-in-time recovery |
| Migrated and seeded | through 0155 on 14-10-2026 (156 migrations), `db:verify` passed | through 0155 on 14-10-2026 (156 migrations), `db:verify` passed | empty; the first migration comes through G1's release |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app | https://shaktiprime.com (project `shakti-prime-production`; builds skipped until G1, nothing deployed) |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answered 200 on 15-10-2026, after the redeploy with the AI keys | the same | none yet |
| First Executive | made on 06-10-2026 | made earlier | after the first release |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev`, `notification-scan-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging`, `notification-scan-staging` | in G1 |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel | after G1 lets the template take `production` |
| AI keys | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`; ₹100 a day on each of the six agents | the same | the keys; daily limits after the first release |
| Redis and Turnstile | per environment | per environment | `shakti-prime-production` (Mumbai) and a widget for `shaktiprime.com`, not yet in Vercel |

Read back from the PC on 14-10-2026, both databases: 156 rows in `drizzle.__drizzle_migrations`, and the same five pg_cron jobs as the migrations define: `activities-partitions` (`5 3 25 * *`), `audit-logs-detach` (`30 3 1 * *`), `audit-logs-partitions` (`0 3 * * *`, daily since #168's 0133), `idempotency-keys-purge` (`30 2 * * *`) and `outbox-events-purge` (`45 2 * * *`). Everything else in this section is as on 12-10-2026: browser alerts with VAPID keys on dev and staging, the Vault refusing PDFs and photos on the hosted worker (`OCR_LANG_PATH`), every Vercel secret marked Sensitive, Sentry project `shakti-prime-web` (free plan, privacy settings on) with the outbox alert. SES: `shaktiprime.com` verified in Mumbai on 15-10-2026; production access refused on the first, automated review (case 179200499200682), so mail stays in the sandbox. Plans, regions and bills: [accounts](runbooks/accounts.md).

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet.

## Waiting on the owner
- **The client's inputs that go-live waits on** ([client-actions](13-client-packs/client-actions.md)): the workshop answers (item 1), the CA's GST confirmation and invoices (2), the item list, HSN codes, rates and prices (3), the engineering values (4), the letterheads and bank details (7), the CRM export (8), dealer credit (9), targets (10), the privacy and consent wording with legal advice (11), and the people for acceptance testing and the parallel run (12); the design sign-off and the screen review (5, 6).
- **SES:** follow case 179200499200682 in AWS Support Center; after G1's first release, ask again with the live sign-in page and verify the first people's addresses in SES meanwhile.
- **Validate the six checks added `NOT VALID`** on dev, then staging: the read-only pre-check of [DEPLOY §2](runbooks/deploy.md#2-every-deploy) step 8 first, then the six statements of [exit-gate-actions](13-client-packs/exit-gate-actions.md) row 18.
- **Monitoring from the audit batches:** the QStash schedules `jobs-check-<env>`, and `lead-anonymise-<env>` once the CA confirms the retention period. Sentry's free plan holds one cron monitor and one uptime monitor; G1 says which.
- **With the CA:** the two import retention periods of workshop FIN-3 (7 days for files, 30 days for rows), and FIN-2's consent evidence and anonymised audit rows.
- **Accounts for later phases, slow to open:** approve the vendor quote letters (client-actions 14); DLT registration of the four companies with 140- and 160-series numbers (17); Meta business verification and a WhatsApp number per company (18); a Google Play developer account for the field app.
- **On the PC:** delete the leftover `node_modules` shells of the 20 removed slot worktrees in `D:/shakti-wt`; say whether the local branches `backup/c3-before-rebase-2` and `p2-backup-before-rebase` (pre-rebase copies, commits not on GitHub) may go.
- **The environment's network list:** add `productionresultssa10.blob.core.windows.net`, so a cloud session can read CI logs and reports.
- **Confirm the Triage agent's named defaults** in `AGENT_DEFAULTS.triage` when convenient.
- **Confirm with Shakti** that the code being public while development continues is acceptable.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| The merge workflow's catch-up commits (main taken into a branch by its token) can hold their `pull_request` CI run for a person's approval, and the held run makes the workflow skip the pull request; #175 and #177 needed "Approve and run" and a look started by hand (`run_state()` in `.github/workflows/automerge.yml`) | 1 / any slice |
| The main menu shows Converting for the Executive in some runs and not others; every screenshot now leaves the menu out (#174), the cause is not found | 1 / any slice |
| The Aadhaar-column upload journey once took more than 45 s to open its job on CI's desktop-dark run and passed on the retry; six local runs took about 8 s (#175) | 1 / any slice |
| `orders.test.ts` timed out once in a full domain run and passed alone (09-10-2026) | 1 / any slice |
| CI's desktop journeys failed once on #167 and passed on the re-run; the cause is unread because the environment's network policy blocks GitHub's log storage (`productionresultssa10.blob.core.windows.net`) | 1 / any slice |
| `search.test.ts` "puts the exact name first…" failed once on `main` after #168 and passed on the re-run: another test's person can match the fuzzy name search | 1 / any slice |
| `pipelines.spec.ts` "lists the referral partners…" was flaky once in the Linux screenshot run (12-10-2026) | 1 / any slice |
| `customers.test.ts` reused a random tag name of an earlier run on the same database (M1's run, 13-10-2026) | 1 / any slice |
| The push toggle tells a second person at a browser held by another that alerts are on (#168 review L4, from N1) | 1 / any slice |
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
| Dependabot #178 (`@hyzyla/pdfium` 2 to 3, a major version, CI green): check the PDF masking path against its breaking changes before it merges | 1 / any slice |
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
