# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [DECISIONS.md](DECISIONS.md); open follow-ups have their single home here.

**04-10-2026.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](ROADMAP.md#2-phase-0--discovery--foundations-68-weeks)). After C2 the owner paused the slice work for two passes over the documents (#91 to #95, then the work for cloud sessions and the PC). Migrations on `main`: 0000 to 0089. Tests after #93: security suite 1,605 (database 897, domain 502, web 206), unit tests 2,461.

## Phase 1
- **Design:** [docs/design/phase1.md](design/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](design/phase1.md#3-slices).
- **Merged:** set-up before wave 1: #79 (packages), #80 (design); wave 1: #81 P3 quality harness, #82 P1 observability and workers, #84 CI economy, #85 P2 files and storage; wave 2: #87 C1 catalogue and tax, #88 X1 role editor, #89 C2 customer timeline; status documents #83, #86, #90; documents rebuilt #91 to #93, their CHANGELOG lines #94; the project's know-how (scripts, skills, agents, runbooks) in the repository #95.
- **Next:** the slices in progress below, then waves 3 to 6 (AI0, T1, S1, D1; N1, T2, S2, K1; L1, R1, A1; M1, G1).
- **Work split:** slices are built and reviewed in cloud sessions and integrated on the PC ([hybrid](runbooks/hybrid.md)); the cloud trial of [hybrid §10](runbooks/hybrid.md#10-the-trial) has not started.

### In progress
| Slice | Branch | Run file | Runs on | State | Next step |
|---|---|---|---|---|---|
| P4 print and letterhead | `feat/p4-print-letterhead` | [p4-print](runs/phase1/p4-print.md) | review: cloud; the rest: PC | built, review pending | the review, then the static fonts, `main`, integration |
| C3 pipelines, scoring and referrals | `feat/c3-pipelines-r2` | [c3-pipelines](runs/phase1/c3-pipelines.md) | PC for the merge; integration list: cloud or PC | reviewed, fixes done | take `main`, renumber, then the integration list |
| C4 sizing | `feat/c4-sizing-r2` | [c4-sizing](runs/phase1/c4-sizing.md) | PC for the merge; integration list: cloud or PC | reviewed, fixes done | take `main`, renumber, then the integration list |
| P2b imports upgrade | `feat/p2b-imports` (not yet made) | [p2b-imports](runs/phase1/p2b-imports.md) | build and review: cloud | brief | push the branch with the run file, start a builder |

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase project | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0089 on 04-10-2026 | through 0089 on 04-10-2026 |
| Site | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |
| Outbox minute schedule | to be checked | made by hand in the Upstash console (QStash › Schedules) with a generated id, not `outbox-publish`: delete it there before running `pnpm --filter web qstash-schedule` for staging, or two schedules call the publisher each minute ([DEPLOY §2](runbooks/DEPLOY.md#2-every-deploy)) |

Upstash Redis per environment, QStash and Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. Plans, regions and where each bill is: [accounts](runbooks/accounts.md). The AWS files stack is not yet created ([files-setup](runbooks/files-setup.md)).

## Deferred Phase 0 gate items
Two of the six exit-gate items are met (the security suite and the tooling); the rest are deferred, not met, and run alongside Phase 1. Each item, its state and who acts next: [exit-gate-actions](phase0/exit-gate-actions.md). What Shakti's people must do, in business words: [client-actions](phase0/client-actions.md). Nothing from the client has arrived yet: no workshop answers, no CA golden set, no design sign-off, no vendor quotes.

## Waiting on the owner
- Decide when the slice work resumes.
- The cloud environment, once: install the Claude GitHub App on the repository and create the environment `shakti-prime` ([hybrid §3](runbooks/hybrid.md#3-the-cloud-environment-once)).
- Sentry privacy settings: Data Scrubber, the default scrubbers and *Prevent Storing of IP Addresses* in the project's security settings.
- The AWS files stack for dev, then staging ([files-setup](runbooks/files-setup.md), about 20 minutes each); `FILES_BUCKET` and the other variables are set only as the owner directs.
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.
- Later: the Anthropic and Voyage keys, the browser-push keys, the optional `app_reader` password, the workshop answers, the client's data.
- At T2: should a round-robin handover move the customer relationship as a person's handover does ([DECISIONS](DECISIONS.md)).

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| The cloud trial: a review, then a build, then a merge with `main` and integration in a cloud session ([hybrid §10](runbooks/hybrid.md#10-the-trial)) | 1 / P4's review first |
| The demo data loader for the screen review: a small, clearly labelled set (items, kits, prices, a few customers) and one account per role, on staging only, removed after the reviews | 1 / before the screen review |
| The updated mock-up (built screens marked built) published as a private link for the reviewers | 1 / before the screen review |
| Account 360's final measure on a quiet machine at integration and on the hosted stack ([design §6.5](design/phase1.md#65-c2-customer-timeline)) | 1 / the next integration |
| Imports on the pre-signed uploads with a streaming workbook reader, the server-action body limit brought back down; the sweep of abandoned pending uploads; customer imports with the PIN code master (PRD CRM-02); the import measured on the hosted stack (concurrent batch workers only if it misses five minutes); the slow import dedupe query on large data | 1 / P2b |
| Per-company logos with the letterhead; print snapshot tests with the ADR 0009 hosting | 1 / P4 |
| The Agent Inbox; the caller workspace (the mic comes with voice in Phase 2) | 1 / AI0, T1 |
| Quote tables and commands; time in stage and the kW or HP on board cards | 1 / S1 |
| Sales-order tables and commands | 1 / S2 |
| Duplicate cards (CRM-03) for the second customer an import can make beside a lead form or another import (imports take no number lock) | 1 / D1 |
| Top-bar notifications; routing a lead refused as `customer_held_by_colleague` to the colleague through the Agent Inbox | 1 / N1 |
| ⌘K search measured again on the client's imported leads | 1 / M1, G1 |
| The SES mailer switched on for production | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th (a long-lived local database fails the partition test from the 1st to the 25th); per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
