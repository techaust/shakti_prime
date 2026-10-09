# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**09-10-2026, afternoon.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). Waves 1 to 3 are merged; in wave 4, S2 (#133), N1 (#134) and K1 (#135) are merged and on dev and staging, and T2 is in its last fixes; in wave 5, R1 is in its last fixes beside it (the owner allowed two builders for this run). An alignment check for every journey screen waits on its branch. Migrations on `main`: 0000 to 0123. Tests: security suite 2,294 (database 1,147, domain 850, web 297) and unit tests 3,232, from K1's integration on 09-10-2026. The GitHub repository is public for now, since the free Actions minutes of that month were used up ([DECISIONS](11-decisions.md#standing-rules-in-force)).

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (17 of the 23 slices):** set-up #79, #80; wave 1: #81 P3, #82 P1, #84 CI economy, #85 P2; wave 2: #87 C1, #88 X1, #89 C2, #99 P4, #100 C4, #103 C3, #105 P2b; wave 3: #108 AI0, #115 S1, #118 D1, #119 T1; wave 4: #133 S2, #134 N1, #135 K1; tooling #107, #109, #111, #112, #113, #116, #117; dependency bumps #101, #102, #127, #128; documents #83, #86, #90 to #98, #104, #106, #110, #114, #120 to #126, #129 to #132 ([CHANGELOG](../CHANGELOG.md)).
- **Next, in order, today:** T2 integrated, merged and migrated on dev and staging; the alignment branch audited (a full journey run with the check), fixed, its screenshots reviewed and the menu baselines remade, merged; R1 merged with `main` (its migrations after T2's, "Save target" on `Field`'s actions), integrated, merged and migrated; then the end-of-day documents. L1 and A1 wait for Monday's usage reset (the week passed 84 % on 09-10-2026). The models-and-usage review after S2, N1 and K1 is due (Waiting on the owner).
- **Work split:** the PC only, heavy commands one at a time through the lock, the watchdog under a monitor while any agent runs, the lead owning the slots' containers ([CLAUDE.md](../CLAUDE.md#session-routine)); how many agents run at once, and on which model and effort, follows [models-and-usage](runbooks/models-and-usage.md). Cloud sessions are paused; S1, D1 and T1 showed the cloud procedure works ([hybrid §10](runbooks/hybrid.md#10-the-trial)).

### In progress
Each slice's run file is `docs/runs/phase1/<slug>.md` on its branch and reaches `main` with the slice.

| Slice | Branch | Run file | Where | State | Next step |
|---|---|---|---|---|---|
| T2 Handover | `feat/t2-handover` | `t2-handover.md` | PC worktree `D:/shakti-wt/t2-handover`, slot 19 (Postgres 54349, app 3049) | Built; reviewed (Opus, medium: 4 medium, 5 low), fixed, re-checked (one high: a lock kept a non-converter's lead; fixed); final checks running | The lead reads the last fix, then integration, pull request and `migrate-hosted` (0124–0125 on `main` after the merge) |
| R1 Targets and home pages | `feat/r1-targets` | `r1-targets.md` | PC worktree `D:/shakti-wt/r1-targets`, slot 20 (Postgres 54350, app 3050) | Built; reviewed (3 medium, 8 low), fixed, re-checked (1 medium: home actions took a company list from the browser; being fixed with 3 lows) | Merge with `main` after T2 and the alignment branch, renumber its migrations, integration, pull request, `migrate-hosted` |
| Alignment check | `fix/search-button-align` | — | the main checkout | `Field`'s `actions` row, `expectAligned` in every journey's accessibility check, the rule in the design system and the agents' rules; unit-tested | A full journey run with the check, fixes, a by-eye review of every Linux screenshot, the menu baselines remade, pull request |

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0123 on 09-10-2026 (124 migrations; pgvector 0.8.2) | through 0123 on 09-10-2026 (124 migrations; pgvector 0.8.2) |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| First Executive | made on 06-10-2026 | made earlier |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev`; `notification-scan-dev` waits on the owner | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging`; `notification-scan-staging` waits on the owner |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel |

S2's 0116–0117 and N1's 0118–0120 were applied to both on 08-10-2026, K1's 0121–0123 on 09-10-2026, each after `main`'s CI passed, with the count checked against the files on disk. The notification scan's worker answers 401 to an unsigned call on both sites; until its schedules exist, due-call, lapsing-quote and late-first-call notices are not written (the event notices are). Browser alerts need the VAPID keys in each site's Vercel values; until then notices reach the centre only. The Knowledge Vault takes Word and text files on both sites and refuses PDFs and photos plainly, since the OCR model is not bundled with the hosted worker (`OCR_LANG_PATH`). Dev's database passwords and its `BETTER_AUTH_SECRET` were replaced on 06-10-2026 after they appeared in a chat ([DEPLOY §5](runbooks/deploy.md#5-rotating-a-secret)); dev's Vercel values are all marked Sensitive, staging's mostly are not. Upstash Redis per environment, Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). Neither site has the Anthropic or Voyage key yet, so agent runs and the Vault's reading and search are recorded as unavailable.

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
- **The notification scan's QStash schedules** (Upstash console › QStash › Schedules › Create): `notification-scan-dev` to `https://shakti-prime-dev.vercel.app/api/v1/workers/notifications/scan` and `notification-scan-staging` to `https://shakti-prime-staging.vercel.app/api/v1/workers/notifications/scan`, cron `*/5 * * * *`, body `{}`, retries 0, timeout 60 s.
- **The VAPID keys for browser alerts** in each site's Vercel values (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; [DEPLOY §1](runbooks/deploy.md#1-before-the-first-deploy-once-per-environment)); the lead gives the steps as a hidden-prompt script.
- **The models-and-usage review** ([§7](runbooks/models-and-usage.md#7-measuring)): measured from the run files' Usage rows, S2 (Tier A: finishing, review, fixes, re-check, integration) about 2 % of the week; N1 (Tier B: merge, review, two fix rounds, integration) about 2 %; K1 (Tier B: four fix rounds and three re-checks after its review found unmasked PDFs) about 5 %; the week stood at 75 % on 09-10-2026 against a pace of 14 % a day. The lead proposes at most two adjustments for the owner's choice.
- **Switch the lead to Opus at high** only when the lead asks for one task, and back to medium after it ([models-and-usage §3](runbooks/models-and-usage.md#3-who-runs-what)).

Every item below, with step-by-step guides and shared ticks, is on the private checklist page https://claude.ai/artifact/336awY1Qoox3338gyU1Xgu (5 of 29 ticked on 06-10-2026); share it from its Share menu, as Contributor for anyone who should tick items.
- **Before the repository goes private again:** set a GitHub Actions budget (Settings › Billing and plans; Linux minutes at $0.006, about $5 on a busy day) or wait for the 1 November reset; private with neither, no check runs and nothing merges. Confirm with Shakti that the code being public for now is acceptable under the agreement.
- **After cloud sessions resume ([hybrid §10](runbooks/hybrid.md#10-the-trial)):** decide whether to keep everything but the briefs, pull requests and hosted steps in the cloud (fully cloud), as S1, D1 and T1 ran.
- **The Anthropic and Voyage keys** on dev and staging, and a spending limit on Admin › Agents.
- **Confirm the Knowledge Vault's daily AI caps** (₹500 for reading documents, ₹100 for search, ₹20 of it for each person; named defaults in design §8.4 and [DECISIONS](11-decisions.md)).
- **Confirm ₹104 per US dollar** from the card statement.
- **Approve the vendor quote letters** once the development team prepares them.
- **An upload on each site** (Settings › Companies › logo) to prove the AWS files stack end to end; then the proof page's render is measured on dev.
- **Mark staging's Vercel values Sensitive** as dev's are (Vercel flags them as readable).
- **Hand the workshop pack to the client** and set dates for its "Blocking work now" box; the calling scripts (CALL-2) and the confirmation of the calling defaults (CALL-3, CALL-4's 48-hour lock, CALL-5) are among its questions.
- **Before the client's customer file:** add the PIN code list, or every site with a PIN shows that its PIN is not in the list.
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| `main`'s Linux baselines that show the menu lack the items and top-bar changes of S2 (Orders, Dealer credit), N1 (the bell) and K1 (Knowledge): they pass under the 1 % allowance, but [slice-integration §10](runbooks/slice-integration.md#10-lessons) asks for every desktop staff baseline showing the menu to be remade when a menu item is added; remake them on a fresh database, one spec at a time with `--update-snapshots=all --grep`, and check each | 1 / the alignment branch, 09-10-2026 |
| The OCR model bundled with the hosted worker (`OCR_LANG_PATH`), so the Vault takes PDFs and photos on dev and staging; masking timed on a Vercel function | 1 / any slice |
| A Vault page whose turn begins late (25 s) can outrun the route's 60 s with its own 45 s once; bound the page's time by what is left of the delivery (K1) | 1 / any slice |
| Read again on a file waiting six minutes can race QStash's redelivery and read it twice (K1 review #13) | 1 / any slice |
| `commission_accruals.measure` (`numeric(14,3)`) cannot hold the measure of an order of ₹1e11 or more (S2 review #8) | 1 / any slice |
| A passed-on enquiry carries no note and drops a consent captured on the walk-in form (N1 review L2) | 1 / any slice |
| `app.claim_push_subscription()` lets someone who knows another person's browser address re-claim it (N1 review L4) | 1 / any slice |
| `notifications_entity_dedupe_idx` is read by nothing since the per-person check (N1 re-check L6): drop it in a new migration | 1 / any slice |
| The notification centre has no screenshot (its list depends on other journeys); a stable one needs seeded notices of its own | 1 / any slice |
| `calling.spec.ts` chooses its calling-hours branch at the start, so a run crossing 21:00 IST fails once; fix the clock for the run | 1 / any slice |
| The orders snapshot journey's page load can pass 60 s on a loaded PC (passed on retry, 09-10-2026) | 1 / any slice |
| The whole-repository lint needed a 6 GB heap after N1 (`package.json`); watch it as the repository grows | 1 / any slice |
| `drizzle-kit generate` needs a terminal for a column rename, so a builder patches the snapshot by script; a non-interactive way to answer its prompt | 1 / any slice |
| `tools/integration/setup-worktree.sh` placed T2 beside the checkout before `wt_root()` preferred `D:/shakti-wt`; R1's worktree landed in `D:/shakti-wt` on 09-10-2026 | 1 / any slice |
| `pipelines.lock_hours` is `not null default 48`, so `WORKSHOP_DEFAULTS.opportunity.handoverLockHours` is never reached; the lock length has two copies of 48 (the column default and the workshop default) | 1 / any slice |
| The handover's state-machine check runs on a made-up lead record and can never refuse; the database function holds the real check (T2 review #9) | 1 / any slice |
| The R1 journey seed logs the caller's calls at seed time; a seed and journey that straddle midnight IST fail the progress check (R1 review #11) | 1 / any slice |
| `orders.test.ts` timed out once in a full domain run and passed alone; `mask-pdf-pages.test.ts`'s timing case failed once in a full unit run and passed alone (09-10-2026, two builders sharing the PC) | 1 / any slice |
| A per-phase list of what the client must give for Phases 2 to 7 (WhatsApp templates, Exotel, the catalogue and opening stock, project and DISCOM papers, the chart of accounts, HR rules, agent autonomy, go-live sign-off), beside `13-client-packs/client-actions.md` | owner / documents |
| A nurtured lead's owner and nurture calls on reassignment (`crm.opportunity.assign` runs only from open), and the handover tested with a callback open: as `system:workers`, which holds no `crm.lead.write`, `moveCallTasks` moves nothing | 1 / T2 |
| The journeys are not repeatable on a used database: a run leaves the shared Executive's selected company on another company and the pipelines journey's stages behind, so a second run fails in other journeys (N1 and K1, 07-10-2026); reset that state in the journeys' set-up | 1 / any slice |
| `/settings/profile` is at 192.3 kB against its 200 kB budget (186.0 on 29-09-2026; the bell is part of the growth) | 1 / any slice |
| Account 360 marks a withdrawn call consent beside the number and drops its `tel:` link | 1 / any slice |
| The Activity log reads a duplicate card set aside as "Dismissed", the agent action's word (states are looked up by value alone) | 1 / any slice |
| `files.spec.ts`'s logo journey: axe can run on `/settings/companies` before the page has its title | 1 / any slice |
| CI's minutes: about 500 a day while slices merge; trim the journeys or the Lighthouse run if a budget is set | 1 / any slice |
| The add-partner form: a referral partner made as a customer of the kind Referral partner with no lead (owner, 05-10-2026) | 1 / after C3 |
| Referral codes in the import mapping | 1 / after P2b |
| The walk-in form's PIN box gets P2b's PIN lookup | 1 / after P2b |
| The server logs "The destination stream closed early" as an error when a browser leaves a page while it loads, on existing screens too | 1 / any slice |
| `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database: it matches the customer its previous run made | 1 / any slice |
| The PIN code journey's axe check can catch the success toast while it fades in; wait for the toast first | 1 / any slice |
| `reader-parity.test.ts`'s Executive case takes about 12 seconds alone, close to its 20-second limit | 1 / any slice |
| Admin › Agents: the per-action autonomy select cuts its text short on desktop | 1 / any slice |
| `tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/04-architecture-appendix/print.md` | 1 / after the owner's upload check |
| A company's earlier proof pages keep a replaced bank account readable: remove them when a new one is printed (P4 review L10) | 1 / G1 |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / any slice |
| An index on open leads by company for the nightly rescore, if the hosted volume needs it (C3 review L8) | 1 / G1 |
| `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first | 1 / any slice |
| The demo data loader for the screen review: a small, clearly labelled set and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](03-roadmap-appendix/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th; per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
