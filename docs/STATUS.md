# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [DECISIONS.md](DECISIONS.md); open follow-ups have their single home here.

**06-10-2026, early morning.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](ROADMAP.md#2-phase-0--discovery--foundations-68-weeks)). Wave 2 is complete; in wave 3 AI0 is merged (#108), S1 waits for its integration, D1 is in its re-review and T1 waits for calling hours to finish. The PC runs no Docker: every database, suite, integration run and screenshot run happens in cloud sessions (owner, 05-10-2026). Migrations on `main`: 0000 to 0108. Tests: security suite 1,839 (database 965, domain 632, web 242) and unit tests 2,771, from P2b's integration run on 05-10-2026; AI0's integration run added to them and is not recounted here.

## Phase 1
- **Design:** [docs/design/phase1.md](design/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](design/phase1.md#3-slices).
- **Merged (11 of the 23 slices):** set-up #79, #80; wave 1: #81 P3, #82 P1, #84 CI economy, #85 P2; wave 2: #87 C1, #88 X1, #89 C2, #99 P4, #100 C4, #103 C3, #105 P2b; wave 3: #108 AI0; tooling #107, #109, #111, #112, #113; documents #83, #86, #90 to #98, #104, #106, #110.
- **Next:** S1's integration in a cloud session (the trial of [hybrid §10](runbooks/hybrid.md#10-the-trial)), D1's re-review and integration, T1's in-hours journey, report and review; then waves 4 to 6 (N1, T2, S2, K1; L1, R1, A1; M1, G1).
- **Work split:** cloud-first with no Docker on the PC (owner, 05-10-2026): slices are built, reviewed, merged with `main`, integrated (in parts, `INTEGRATE_STEPS`) and given their Linux baselines in cloud sessions of the environment `shakti_prime`, at most two at once; a step that fails there runs again in a new cloud session. The lead session on the PC writes the briefs, opens the pull requests and runs the hosted steps through the PC's connections (Supabase, Vercel, Upstash, AWS, GitHub) ([hybrid §1](runbooks/hybrid.md#1-what-runs-where)). The owner starts each cloud session on claude.ai/code with the first message the lead writes. Every slice's migrations move after `main`'s last one when it takes `main`: S1, D1 and T1 each carry migrations numbered from 0101 or 0107 and are renumbered in the order they merge.

### In progress
| Slice | Branch | Run file | Runs on | State | Next step |
|---|---|---|---|---|---|
| S1 quotes | `feat/s1-quotes` | on its branch (its header still says "built; review": update it in the trial's brief) | cloud | reviewed and re-reviewed; every finding fixed (H1, M1 to M3, L1 to L7, R1 to R6) | the cloud integration trial: take `main` (with AI0), move 0101 to 0103 after 0108, `integrate.sh` in parts, Linux baselines on a fresh database, then the pull request from the PC |
| D1 duplicates | `feat/d1-duplicates` | on its branch | cloud | reviewed (1 high, 3 medium, 7 low); every fix made at `86128a8a`, with the owner's two decisions of 06-10-2026 (L6) | the re-review running in a cloud session (06-10-2026); then take `main`, delete turbo's block from `AGENTS.md`, move 0101 and 0102 after `main`'s last, baselines (`duplicates` and every staff screen with the new menu item) |
| T1 cold caller workspace | `feat/t1-calling` | on its branch | cloud | built; the security suite, lint, typecheck, unit tests, build, budget and spike done in the cloud (queue p95 under 300 ms at 2,000 leads for 10 callers); the in-hours journey not yet run | after 03:35 UTC (09:05 IST) the owner tells its session to run `e2e/calling.spec.ts` on all three projects and write the final report; then the review; its 0107 and 0108 move after `main`'s last |

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0108 on 06-10-2026 (109 migrations; the run that rotated the passwords) | through 0108 on 05-10-2026 (109 migrations) |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| First Executive | made on 06-10-2026 | made earlier |
| QStash schedules (region EU) | `outbox-publish-dev`, `lead-rescore-dev`, `files-sweep-dev` | the outbox schedule (generated id), `lead-rescore-staging`, `files-sweep-staging` |
| AWS files stack | `shakti-prime-dev-files` created; its four values in Vercel | `shakti-prime-staging-files` created; its four values in Vercel |

Every schedule's last run succeeded on 06-10-2026, the nightly rescore's first run included. Dev's database passwords (`postgres`, `auth_service`) and its `BETTER_AUTH_SECRET` were replaced on 06-10-2026 after they appeared in a chat ([DEPLOY §5](runbooks/DEPLOY.md#5-rotating-a-secret)); dev's Vercel values are all marked Sensitive, staging's mostly are not. Upstash Redis per environment, Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). Neither site has the Anthropic or Voyage key yet, so agent runs are recorded as unavailable.

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](phase0/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](phase0/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
Every item below, with step-by-step guides and shared ticks, is on the private checklist page https://claude.ai/artifact/336awY1Qoox3338gyU1Xgu (5 of 29 ticked on 06-10-2026); share it from its Share menu, as Contributor for anyone who should tick items.
- **The Anthropic and Voyage keys** on dev and staging, and a spending limit on Admin › Agents.
- **Confirm ₹104 per US dollar** from the card statement.
- **Approve the vendor quote letters** once the development team prepares them.
- **An upload on each site** (Settings › Companies › logo) to prove the AWS files stack end to end; then the proof page's render is measured on dev.
- **Mark staging's Vercel values Sensitive** as dev's are (Vercel flags them as readable).
- **Hand the workshop pack to the client** and set dates for its "Blocking work now" box.
- **Before the client's customer file:** add the PIN code list, or every site with a PIN shows that its PIN is not in the list.
- At T2: should a round-robin handover move the customer relationship as a person's handover does ([DECISIONS](DECISIONS.md)).
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| The add-partner form: a referral partner made as a customer of the kind Referral partner with no lead (owner, 05-10-2026) | 1 / after C3 |
| Referral codes in the import mapping | 1 / after P2b |
| The walk-in form's PIN box gets P2b's PIN lookup | 1 / after P2b |
| `apps/web/scripts/qstash-schedule.ts` names each schedule id with its environment (one QStash account serves dev and staging) | 1 / D1 (built on its branch) |
| The server logs "The destination stream closed early" as an error when a browser leaves a page while it loads, on existing screens too (D1's cloud run) | 1 / any slice |
| `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database: it matches the customer its previous run made | 1 / any slice |
| The PIN code journey's axe check can catch the success toast while it fades in; wait for the toast first | 1 / any slice |
| `reader-parity.test.ts`'s Executive case takes about 12 seconds alone, close to its 20-second limit | 1 / any slice |
| Admin › Agents: the per-action autonomy select cuts its text short on desktop | 1 / N1 or any slice |
| `tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/spikes/print.md` | 1 / after the owner's upload check |
| A company's earlier proof pages keep a replaced bank account readable: remove them when a new one is printed (P4 review L10) | 1 / S1 or G1 |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / S1 |
| An index on open leads by company for the nightly rescore, if the hosted volume needs it (C3 review L8) | 1 / G1 |
| `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first | 1 / any slice |
| The demo data loader for the screen review: a small, clearly labelled set and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](design/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| Sales-order tables and commands | 1 / S2 |
| Top-bar notifications; routing a lead refused as `customer_held_by_colleague` to the colleague through the Agent Inbox | 1 / N1 |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th; per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
