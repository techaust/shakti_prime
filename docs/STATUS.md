# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [DECISIONS.md](DECISIONS.md); open follow-ups have their single home here.

**05-10-2026, evening.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](ROADMAP.md#2-phase-0--discovery--foundations-68-weeks)). Wave 2 is complete with P2b (#105); wave 3 is under way (AI0 integrating, S1 reviewed and waiting for AI0, D1 built, T1 part built). The owner chose to go hybrid on 05-10-2026. Migrations on `main`: 0000 to 0106. Tests: security suite 1,839 (database 965, domain 632, web 242) and unit tests 2,771, from P2b's integration run on 05-10-2026.

## Phase 1
- **Design:** [docs/design/phase1.md](design/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](design/phase1.md#3-slices).
- **Merged (10 of the 23 slices):** set-up #79, #80; wave 1: #81 P3, #82 P1, #84 CI economy, #85 P2; wave 2: #87 C1, #88 X1, #89 C2, #99 P4, #100 C4, #103 C3, #105 P2b; documents #83, #86, #90 to #96, #97, #98, #104.
- **Next:** AI0's pull request, then S1 (it takes `main` after AI0), D1 and T1 in wave 3; then waves 4 to 6 (N1, T2, S2, K1; L1, R1, A1; M1, G1).
- **Work split:** cloud-first (owner, 05-10-2026): slices are built and reviewed in cloud sessions of the environment `shakti_prime` (at most two at once), and from S1 on, taking `main`, the integration run (in parts, `INTEGRATE_STEPS`) and the Linux baselines run there too, S1 being the trial; the lead session on the PC writes the briefs, opens the pull requests and runs the hosted steps ([hybrid §1](runbooks/hybrid.md#1-what-runs-where)). The owner starts each cloud session on claude.ai/code with the message the lead gives (the PC's terminal cannot start one).

### In progress
| Slice | Branch | Run file | Runs on | State | Next step |
|---|---|---|---|---|---|
| AI0 agent runtime and Inbox | `feat/ai0-agent-runtime` | on its branch | PC, slot 12 | `main` taken (migrations 0107, 0108); integration run passed but for timeouts under load, each file passing alone; one real gap fixed (the agent commands in `main`'s people-only refusal list) | Linux baselines on a fresh database (the Agent Inbox, Admin › Agents, and the screens the new menu items change), then the pull request |
| S1 quotes | `feat/s1-quotes` | on its branch | PC, slot 13 | reviewed and re-reviewed, every finding fixed (1 high: quote PDFs unreadable below GM) | take `main` after AI0 merges, then integration |
| D1 duplicates | `feat/d1-duplicates` | on its branch | cloud from 05-10-2026 | built; the whole security suite not yet green in one run (timeouts on the PC) | a cloud builder runs the suite and lint, then the first cloud review |
| T1 cold caller workspace | `feat/t1-calling` | on its branch | cloud from 05-10-2026 | part built (table, command, reads, `/calling`, tests); the owner's retry and nurture defaults applied | a cloud builder continues from its handover section |

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0106 on 05-10-2026 (107 migrations applied) | through 0106 on 05-10-2026 (107 migrations applied) |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| QStash schedules | none yet: `outbox-publish-dev`, `lead-rescore-dev` and `files-sweep-dev` wait for the owner (Waiting on the owner) | the outbox schedule made by hand with a generated id; `lead-rescore-staging` and `files-sweep-staging` wait for the owner |

Upstash Redis per environment, QStash and Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). The AWS files stack is not yet created ([files-setup](runbooks/files-setup.md)), so hosted uploads, imports from files and PDFs answer unavailable.

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](phase0/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](phase0/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
Every item below, with step-by-step guides and shared ticks, is on the private checklist page https://claude.ai/artifact/336awY1Qoox3338gyU1Xgu (05-10-2026); share it from its Share menu, as Contributor for anyone who should tick items.
- **QStash schedules** in the Upstash console (region EU), since the Upstash connection is read-only: `outbox-publish-dev` (`https://shakti-prime-dev.vercel.app/api/v1/workers/outbox/publish`, `* * * * *`), `lead-rescore-dev` and `lead-rescore-staging` (`https://shakti-prime-<env>.vercel.app/api/v1/workers/crm/rescore`, `30 21 * * *`), each with body `{}`; and `files-sweep-dev` and `files-sweep-staging` (`https://shakti-prime-<env>.vercel.app/api/v1/workers/files/sweep`, `17 * * * *`, retries 0, body `{}`).
- **The AWS files stack** for dev, then staging ([files-setup](runbooks/files-setup.md), about 20 minutes each); then the proof page's render is measured on dev.
- **Sentry privacy settings:** Data Scrubber, the default scrubbers and *Prevent Storing of IP Addresses*.
- **Share the screen mock-up** (https://claude.ai/artifact/RHcRKwSryk9nyxzmVMZRPU) with the screen-review people.
- **After AI0 merges:** the Anthropic and Voyage keys on dev and staging, and a spending limit on Admin › Agents.
- **Confirm ₹104 per US dollar** from the card statement.
- **Approve the vendor quote letters** once the development team prepares them.
- **Hand the workshop pack to the client** and set dates for its "Blocking work now" box.
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.
- **Now:** the Claude GitHub App on the repository and the cloud environment `shakti_prime` ([hybrid §3](runbooks/hybrid.md#3-the-cloud-environment-once)).
- **Optional, for the PC's speed:** a Windows Defender exclusion for `D:\shakti-wt` and the project folder (a security setting, so the owner's own step).
- **Before the client's customer file:** add the PIN code list, or every site with a PIN shows that its PIN is not in the list.
- At T2: should a round-robin handover move the customer relationship as a person's handover does ([DECISIONS](DECISIONS.md)).

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| The add-partner form: a referral partner made as a customer of the kind Referral partner with no lead (owner, 05-10-2026) | 1 / after C3 |
| Referral codes in the import mapping | 1 / after P2b |
| The walk-in form's PIN box gets P2b's PIN lookup | 1 / after P2b |
| `apps/web/scripts/qstash-schedule.ts` names each schedule id with its environment (one QStash account serves dev and staging) | 1 / D1 (built on its branch) |
| `import-kinds.test.ts` "adds the different site of a repeated row" passes only on a fresh database: it matches the customer its previous run made | 1 / any slice |
| The PIN code journey's axe check can catch the success toast while it fades in; wait for the toast first | 1 / any slice |
| `reader-parity.test.ts`'s Executive case takes about 12 seconds alone, close to its 20-second limit | 1 / any slice |
| Admin › Agents: the per-action autonomy select cuts its text short on desktop | 1 / N1 or any slice |
| `tools/integration/renumber-migrations.mjs` stops with an error when its `drizzle-kit` run writes nothing | 1 / any slice |
| The proof page's render measured on dev and recorded in `docs/spikes/print.md` | 1 / after the AWS files stack |
| A company's earlier proof pages keep a replaced bank account readable: remove them when a new one is printed (P4 review L10) | 1 / S1 or G1 |
| A rasterised check of a real PDF's first page beside the HTML baselines (P4 review L7) | 1 / S1 |
| An index on open leads by company for the nightly rescore, if the hosted volume needs it (C3 review L8) | 1 / G1 |
| `enum-sync.test.ts` "a site point is on the globe" depends on another file creating an account first | 1 / any slice |
| The demo data loader for the screen review: a small, clearly labelled set and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| Account 360's final measure on a quiet machine and on the hosted stack ([design §6.5](design/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports measured on the hosted stack (concurrent batch workers only if 50,000 rows miss five minutes) | 1 / after P2b and the AWS files stack |
| The caller workspace (the mic comes with voice in Phase 2) | 1 / T1 |
| Sales-order tables and commands | 1 / S2 |
| Top-bar notifications; routing a lead refused as `customer_held_by_colleague` to the colleague through the Agent Inbox | 1 / N1 |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th; per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| The voice spike (`apps/web/src/integrations/voice/claude-stream.ts`) names a model the documents do not | 2 / voice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
