# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [11-decisions.md](11-decisions.md); open follow-ups have their single home here.

**07-10-2026.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](03-roadmap.md#2-phase-0--discovery--foundations-68-weeks)). Waves 1 to 3 are merged; in wave 4, N1 and K1 are built and wait for review, S2 waits for a builder place, and T2 follows N1. Migrations on `main`: 0000 to 0115. Tests: security suite 2,098 (database 1,060, domain 774, web 264) and unit tests 3,070, from T1's integration run on 06-10-2026. The GitHub repository is public for now, since the free Actions minutes of that month were used up ([DECISIONS](11-decisions.md#standing-rules-in-force)).

## Phase 1
- **Design:** [docs/03-roadmap-appendix/phase1.md](03-roadmap-appendix/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](03-roadmap-appendix/phase1.md#3-slices).
- **Merged (14 of the 23 slices):** set-up #79, #80; wave 1: #81 P3, #82 P1, #84 CI economy, #85 P2; wave 2: #87 C1, #88 X1, #89 C2, #99 P4, #100 C4, #103 C3, #105 P2b; wave 3: #108 AI0, #115 S1, #118 D1, #119 T1; tooling #107, #109, #111, #112, #113, #116, #117; dependency bumps #101, #102, #127, #128; documents #83, #86, #90 to #98, #104, #106, #110, #114, #120 to #126, #129 ([CHANGELOG](../CHANGELOG.md)).
- **Next:** review N1 and K1 (the reviewer on Opus), S2's builder finishes its journeys, then each slice is integrated and merged in turn; T2 after N1; then then waves 5 and 6 (L1, R1, A1; M1, G1).
- **Work split:** the PC only, at most two builders at once, heavy commands one at a time through the lock; the rule is in [CLAUDE.md](../CLAUDE.md#session-routine). Cloud sessions are paused; S1, D1 and T1 showed the cloud procedure works ([hybrid §10](runbooks/hybrid.md#10-the-trial)).

### In progress
Wave 4 started from `main` at #121. Each slice's run file is `docs/runs/phase1/<slug>.md` on its branch and reaches `main` with the slice.

| Slice | Branch | Run file | Where | State | Next step |
|---|---|---|---|---|---|
| N1 Notifications | `feat/n1-notifications` | `n1-notifications.md` | PC worktree `n1-notifications`, slot 16 (Postgres 54346, app 3046; stopped) | Built 07-10-2026: its own journeys pass; typecheck, unit tests, build and budgets pass | Review; the whole journey set on a fresh database at integration |
| K1 Knowledge Vault | `feat/k1-knowledge` | `k1-knowledge.md` | PC worktree `k1-knowledge`, slot 18 (Postgres 54348, app 3048; stopped) | Built 07-10-2026: security suite, unit tests, build, budgets and the whole-repository lint pass; its journeys pass | Review; the whole journey set on a fresh database at integration |
| S2 Orders, acceptance and credit | `feat/s2-orders` | `s2-orders.md` | PC worktree `s2-orders`, slot 17 (Postgres 54347, app 3047; stopped) | Built up to its final checks; its builder stopped at the usage limit | A builder (Sonnet) finishes its checks and report, then review |
| T2 Handover | not started | not written | | Starts after N1 merges | The lead writes the brief |

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0115 on 06-10-2026 (116 migrations) | through 0115 on 06-10-2026 (116 migrations) |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| First Executive | made on 06-10-2026 | made earlier |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev`, `quote-expire-dev`, `duplicate-scan-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging`, `quote-expire-staging`, `duplicate-scan-staging` |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel |

The outbox, lead-rescore and files-sweep schedules of both environments last ran successfully on 06-10-2026. `quote-expire-*` (18:35 UTC, 00:05 IST) and `duplicate-scan-*` (22:00 UTC, 03:30 IST) were made on 06-10-2026 and first run that night; their worker routes answer 401 to an unsigned call on both sites. Dev's database passwords and its `BETTER_AUTH_SECRET` were replaced on 06-10-2026 after they appeared in a chat ([DEPLOY §5](runbooks/deploy.md#5-rotating-a-secret)); dev's Vercel values are all marked Sensitive, staging's mostly are not. Upstash Redis per environment, Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). Neither site has the Anthropic or Voyage key yet, so agent runs are recorded as unavailable.

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](13-client-packs/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](13-client-packs/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
Every item below, with step-by-step guides and shared ticks, is on the private checklist page https://claude.ai/artifact/336awY1Qoox3338gyU1Xgu (5 of 29 ticked on 06-10-2026); share it from its Share menu, as Contributor for anyone who should tick items.
- **Before the repository goes private again:** set a GitHub Actions budget (Settings › Billing and plans; Linux minutes at $0.006, about $5 on a busy day) or wait for the 1 November reset; private with neither, no check runs and nothing merges. Confirm with Shakti that the code being public for now is acceptable under the agreement.
- **After cloud sessions resume ([hybrid §10](runbooks/hybrid.md#10-the-trial)):** decide whether to keep everything but the briefs, pull requests and hosted steps in the cloud (fully cloud), as S1, D1 and T1 ran.
- **The Anthropic and Voyage keys** on dev and staging, and a spending limit on Admin › Agents.
- **Confirm the Knowledge Vault's daily AI caps** (₹500 for reading documents, ₹100 for search; named defaults K1 set, in design §8.4).
- **Confirm ₹104 per US dollar** from the card statement.
- **Approve the vendor quote letters** once the development team prepares them.
- **An upload on each site** (Settings › Companies › logo) to prove the AWS files stack end to end; then the proof page's render is measured on dev.
- **Mark staging's Vercel values Sensitive** as dev's are (Vercel flags them as readable).
- **Hand the workshop pack to the client** and set dates for its "Blocking work now" box; the calling scripts (CALL-2) and the confirmation of the calling defaults (CALL-3, CALL-5) are among its questions.
- **Before the client's customer file:** add the PIN code list, or every site with a PIN shows that its PIN is not in the list.
- At T2: should a round-robin handover move the customer relationship as a person's handover does ([DECISIONS](11-decisions.md)).
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| A nurtured lead's owner and nurture calls on reassignment (`crm.opportunity.assign` runs only from open), and the handover tested with a callback open: as `system:workers`, which holds no `crm.lead.write`, `moveCallTasks` moves nothing | 1 / T2 |
| Winning a lead ends its open callbacks, as losing does | 1 / S2 (the first slice that lets a lead be won) |
| The journeys are not repeatable on a used database: a run leaves the shared Executive's selected company on another company and the pipelines journey's stages behind, so a second run fails in other journeys (N1 and K1, 07-10-2026); reset that state in the journeys' set-up | 1 / any slice |
| `/settings/profile` is at 192.3 kB against its 200 kB budget (186.0 on 29-09-2026; the bell is part of the growth) | 1 / N1 integration |
| Account 360 marks a withdrawn call consent beside the number and drops its `tel:` link | 1 / any slice |
| The Activity log reads a duplicate card set aside as "Dismissed", the agent action's word (states are looked up by value alone) | 1 / any slice |
| `files.spec.ts`'s logo journey: axe can run on `/settings/companies` before the page has its title | 1 / any slice |
| `main`'s phone baselines lack the Agent Inbox icon in the top bar (they pass under the 1 % allowance) | 1 / any slice |
| CI's minutes: about 500 a day while slices merge; trim the journeys or the Lighthouse run if a budget is set | 1 / any slice |
| The add-partner form: a referral partner made as a customer of the kind Referral partner with no lead (owner, 05-10-2026) | 1 / after C3 |
| Referral codes in the import mapping | 1 / after P2b |
| The walk-in form's PIN box gets P2b's PIN lookup | 1 / after P2b |
| The server logs "The destination stream closed early" as an error when a browser leaves a page while it loads, on existing screens too | 1 / any slice |
| `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database: it matches the customer its previous run made | 1 / any slice |
| The PIN code journey's axe check can catch the success toast while it fades in; wait for the toast first | 1 / any slice |
| `reader-parity.test.ts`'s Executive case takes about 12 seconds alone, close to its 20-second limit | 1 / any slice |
| Admin › Agents: the per-action autonomy select cuts its text short on desktop | 1 / N1 or any slice |
| `tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/04-architecture-appendix/print.md` | 1 / after the owner's upload check |
| A company's earlier proof pages keep a replaced bank account readable: remove them when a new one is printed (P4 review L10) | 1 / G1 |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / any slice |
| An index on open leads by company for the nightly rescore, if the hosted volume needs it (C3 review L8) | 1 / G1 |
| `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first | 1 / any slice |
| The demo data loader for the screen review: a small, clearly labelled set and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](03-roadmap-appendix/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| Sales-order tables and commands | 1 / S2 |
| Top-bar notifications; routing a lead refused as `customer_held_by_colleague` to the colleague through the Agent Inbox | 1 / N1 |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th; per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
