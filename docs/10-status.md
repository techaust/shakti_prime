# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**09-10-2026, night.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). Waves 1 to 4 are merged, wave 4's T2 (#138) the last; wave 5's R1 (#140) is merged; buttons sit level with their box on every screen, kept so by lint and the journeys (#139). Migrations on `main`: 0000 to 0127, and dev and staging are migrated through 0127. Tests: security suite 2,397 (database 1,192, domain 905, web 300) from R1's run on a fresh database, and unit tests 3,256 from T2's integration, both on 09-10-2026; R1's unit tests passed in its CI run. The GitHub repository is public for now, since the free Actions minutes of that month were used up ([DECISIONS](11-decisions.md#standing-rules-in-force)).

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (19 of the 23 slices):** set-up #79, #80; wave 1: #81 P3, #82 P1, #84 CI economy, #85 P2; wave 2: #87 C1, #88 X1, #89 C2, #99 P4, #100 C4, #103 C3, #105 P2b; wave 3: #108 AI0, #115 S1, #118 D1, #119 T1; wave 4: #133 S2, #134 N1, #135 K1, #138 T2; wave 5: #140 R1; fixes #139 (alignment); tooling #107, #109, #111, #112, #113, #116, #117; dependency bumps #101, #102, #127, #128; documents #83, #86, #90 to #98, #104, #106, #110, #114, #120 to #126, #129 to #132, #136, #137 ([CHANGELOG](../CHANGELOG.md)).
- **Next:** the owner replaced the models-and-usage plan on 09-10-2026 ([DECISIONS](11-decisions.md)), so the review it was waiting for is done. First a one-off fix of the known flaky journeys (the Customers consent and task timeouts, `calling.spec.ts` across 21:00 IST) and seeded figures for the home pages' screenshots, then wave 5's L1 and A1 under the budget gate; the week passed 84 % on 09-10-2026 and resets on Monday 12-10-2026 at 15:30 IST, so a new slice waits for the reset unless the gate allows it ([models-and-usage §5](runbooks/models-and-usage.md#5-the-budget-gate)).
- **Work split:** each session wholly on the PC or wholly in a cloud session, as the owner chooses ([DECISIONS](11-decisions.md)); the next session continues Phase 1 in the cloud, following [hybrid](runbooks/hybrid.md) from start to end. Models and efforts: [models-and-usage](runbooks/models-and-usage.md).

### In progress
No slice is in flight. Each slice's run file is `docs/runs/phase1/<slug>.md` on its branch and reaches `main` with the slice.

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0127 on 09-10-2026 (128 migrations; pgvector 0.8.2) | through 0127 on 09-10-2026 (128 migrations; pgvector 0.8.2) |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| First Executive | made on 06-10-2026 | made earlier |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev`, `notification-scan-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging`, `notification-scan-staging` |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel |

S2's 0116–0117 and N1's 0118–0120 were applied to both on 08-10-2026; K1's 0121–0123, T2's 0124–0125 and R1's 0126–0127 on 09-10-2026, each after `main`'s CI passed, through the migrate workflow's `db:verify`. The notification scan runs every five minutes on both sites (the owner made its schedules on 09-10-2026; their first runs answered). Browser alerts have their VAPID keys on both sites (09-10-2026, a key pair per site). The Knowledge Vault takes Word and text files on both sites and refuses PDFs and photos plainly, since the OCR model is not bundled with the hosted worker (`OCR_LANG_PATH`). Dev's database passwords and its `BETTER_AUTH_SECRET` were replaced on 06-10-2026 after they appeared in a chat ([DEPLOY §5](runbooks/deploy.md#5-rotating-a-secret)); every secret in both sites' Vercel values is marked Sensitive (staging's on 09-10-2026), and both sites took a logo upload end to end. Upstash Redis per environment, Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). Neither site has the Anthropic or Voyage key yet, so agent runs and the Vault's reading and search are recorded as unavailable.

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
- **Switch the lead to Opus at high** only when the lead asks for one task, and back to medium after it ([models-and-usage §3](runbooks/models-and-usage.md#3-who-runs-what)).

The owner's remaining items follow. What the client must give, with why and how, is the shared page https://claude.ai/artifact/PaR6v9vKUF6cLH2TVuRmTr (source [client-checklist.html](13-client-packs/client-checklist.html), 09-10-2026); the owner shares it with the client's people from its Share menu, as Editor for those who tick and write answers.
- **Before the repository goes private again:** set a GitHub Actions budget (Settings › Billing and plans; Linux minutes at $0.006, about $5 on a busy day) or wait for the 1 November reset; private with neither, no check runs and nothing merges. Confirm with Shakti that the code being public for now is acceptable under the agreement.
- **After cloud sessions resume ([hybrid §10](runbooks/hybrid.md#10-the-trial)):** decide whether to keep everything but the briefs, pull requests and hosted steps in the cloud (fully cloud), as S1, D1 and T1 ran.
- **The Anthropic and Voyage keys** on dev and staging, and a spending limit on Admin › Agents.
- **Approve the vendor quote letters** once the development team prepares them.
- **Hand the workshop pack to the client** and set dates for its "Blocking work now" box; the calling scripts (CALL-2) and the confirmation of the calling defaults (CALL-3, CALL-4's 48-hour lock, CALL-5) are among its questions.
- **Before the client's customer file:** add the PIN code list, or every site with a PIN shows that its PIN is not in the list.
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
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
| `pipelines.lock_hours` is `not null default 48`, so `WORKSHOP_DEFAULTS.opportunity.handoverLockHours` is never reached; the lock length has two copies of 48 (the column default and the workshop default) | 1 / any slice |
| The handover's state-machine check runs on a made-up lead record and can never refuse; the database function holds the real check (T2 review #9) | 1 / any slice |
| The Customers journeys "records a consent with its proof" and "adds a task" time out in a full run on the loaded PC (the consent dialog does not open within 45 s) and pass alone; seen in every full run on 09-10-2026 | 1 / any slice |
| The tele-caller's, the GM's and the Executive's home pages and Targets have no screenshot, like the notification centre: they show figures other journeys make, in an order CI does not fix; a stable picture needs seeded figures of their own (R1, 09-10-2026) | 1 / any slice |
| `shakti/field-button-alignment` reads only a button beside a `Field` or in a wrapper of buttons; a button two wrappers away, or an action beside a bare `Input`, is left to the journeys' `expectAligned` | 1 / any slice |
| The R1 journey seed logs the caller's calls at seed time; a seed and journey that straddle midnight IST fail the progress check (R1 review #11) | 1 / any slice |
| `orders.test.ts` timed out once in a full domain run and passed alone; `mask-pdf-pages.test.ts`'s timing case failed once in a full unit run and passed alone (09-10-2026, two builders sharing the PC) | 1 / any slice |
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
| The proof page's render measured on dev and recorded in `docs/04-architecture-appendix/print.md` (the owner's upload check passed on both sites) | 1 / any slice |
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
