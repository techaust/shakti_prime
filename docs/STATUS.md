# Status — Shakti Prime BOS

Replace this page, never append to it, at the end of each working session. History is in [CHANGELOG.md](../CHANGELOG.md); the owner's decisions are in [DECISIONS.md](DECISIONS.md).

**04-10-2026.** Phase 1 (`currentPhase` 1 in `.claude/tooling.json`). Phase 0 closed on 29-09-2026 by the owner's decision; the gate items that wait on people are deferred, not met ([ROADMAP §2](ROADMAP.md#2-phase-0--discovery--foundations-68-weeks)). After C2 the owner paused the slice work for a rebuild of the documents (#91 to #93). Migrations on `main`: 0000 to 0089. Tests after #93: security suite 1,605 (database 897, domain 502, web 206), unit tests 2,461.

## Phase 1
- **Design:** [docs/design/phase1.md](design/phase1.md), 23 slices in six waves, approved 29-09-2026; the order is its [§3](design/phase1.md#3-slices).
- **Merged:** wave 0 #79 (packages), #80 (design); wave 1 #81 P3 quality harness, #82 P1 observability and workers, #84 CI economy, #85 P2 files and storage; wave 2 #87 C1 catalogue and tax, #88 X1 role editor, #89 C2 customer timeline; status documents #83, #86, #90; documents rebuilt #91 to #93.
- **Built, waiting its turn:** P4 print and letterhead on `feat/p4-print-letterhead`: bank details sealed with `FieldCipher`, the PDF render worker with `@sparticuz/chromium`, the company proof page (needs a review, the static Inter fonts, `main` merged in with its migrations renumbered, Linux baselines); C3 pipelines, scoring and referrals on `feat/c3-pipelines-r2` and C4 sizing on `feat/c4-sizing-r2` (reviewed and fixed; each takes `main`, renumbers, then its integration list).
- **Next:** P2b imports upgrade (can start: C2 is merged), then waves 3 to 6 (AI0, T1, S1, D1; N1, T2, S2, K1; L1, R1, A1; M1, G1).

## Hosted environments
| | Dev | Staging |
|---|---|---|
| Supabase (Mumbai) | `shakti-prime-dev` | `shakti-prime-staging` |
| Migrated and seeded | through 0089 on 04-10-2026 | through 0089 on 04-10-2026 |
| Site (Vercel `bom1`, Hobby) | https://shakti-prime-dev.vercel.app | https://shakti-prime-staging.vercel.app |
| Checks | `/api/v1/health` and `/api/v1/health/ready` answer 200 | the same |

Upstash Redis per environment in Mumbai; QStash in the EU region with the minute schedule on staging; Turnstile for both hostnames; Sentry project `shakti-prime-web` with the outbox alert. The AWS files stack is not yet created ([files-setup](runbooks/files-setup.md)).

## Deferred Phase 0 gate items
What Shakti's people must do is on one page, [client-actions](phase0/client-actions.md); the developer's and owner's checklist is [exit-gate-actions](phase0/exit-gate-actions.md).

| Item | Who | Tracked in |
|---|---|---|
| Workshop answers (42 questions: nurture cadence, lock period, numbering format and more) | Client | [workshop-pack](phase0/workshop-pack.md) |
| The CA's confirmation of the tax golden set | CA | [ADR 0007](adr/0007-deterministic-tax-engine.md) |
| Sign-off of `DESIGN.md` and `/design`; wireframe sessions with 1–2 users per role | Client | [design-signoff](phase0/design-signoff.md), [wireframe-review](phase0/wireframe-review.md) |
| Review of the ERD, data dictionary, permission matrix, contracts and the proposed state-machine items ([docs/state-machines](state-machines/README.md)); acceptance of ADRs 0007 and 0009 to 0013 | Owner, client | [exit-gate-actions](phase0/exit-gate-actions.md) |
| Vendor quote requests sent and quotes recorded | Owner | [vendor-quotes](phase0/vendor-quotes.md) |
| Realtime spike on the production site with the client's domain; Exotel, WhatsApp, voice and Tally spikes once sandboxes, the Tally visit and 20–30 voice samples exist | Owner, vendors, client | [docs/spikes/](spikes/) |
| Real document photos for OCR; a phone and scanner check of printed QR labels | Client | [ocr](spikes/ocr.md), [print](spikes/print.md) |
| Production: a paid Supabase project, Vercel Pro (or the client's Pro team), Amazon SES in Mumbai with the client's domain verified (DKIM, SPF, DMARC), production access and a send-only IAM user per environment | Owner, client | [DEPLOY](runbooks/DEPLOY.md), BLUEPRINT §5, ADR 0003 |
| A GitHub plan that allows branch rules on `main` (AUDIT M45) | Owner | [AUDIT.md](../AUDIT.md) |
| Vendor accounts in the client's name, DLT registration, Meta Business verification and App Review, the Google Lead Form | Client | [ROADMAP §10](ROADMAP.md#10-parallel-workstreams-started-in-phase-0), [client-actions](phase0/client-actions.md) |
| Open with the client (AUDIT §7): recorded sources of consent, consent per company, a negative moving-average cost | Client | [AUDIT.md](../AUDIT.md) |

## Waiting on the owner
- Sentry privacy settings: Data Scrubber, the default scrubbers and *Prevent Storing of IP Addresses* in the project's security settings.
- The AWS files stack for dev, then staging ([files-setup](runbooks/files-setup.md), about 20 minutes each); `FILES_BUCKET` and the other variables are set only as the owner directs.
- Optional: delete the superseded remote branches `feat/p2-files-storage`, `feat/c3-pipelines-scoring`, `feat/c4-sizing` and the local backup branches.
- Later: the Anthropic and Voyage keys, the browser-push keys, the optional `app_reader` password, the workshop answers, the client's data.
- At T2: should a round-robin handover move the customer relationship as a person's handover does ([DECISIONS](DECISIONS.md)).

## Open follow-ups
| Follow-up | Phase / slice |
|---|---|
| Imports on the pre-signed uploads with a streaming workbook reader, the server-action body limit brought back down; the sweep of abandoned pending uploads; customer imports with the PIN code master (PRD CRM-02); the import measured on the hosted stack (concurrent batch workers only if it misses five minutes); the slow import dedupe query on large data | 1 / P2b |
| Per-company logos with the letterhead; print snapshot tests with the ADR 0009 hosting | 1 / P4 |
| The Agent Inbox; the caller workspace (the mic comes with voice in Phase 2) | 1 / AI0, T1 |
| Quote and sales-order tables and commands; time in stage and the kW or HP on board cards | 1 / S1, S2 |
| Duplicate cards (CRM-03) for the second customer an import can make beside a lead form or another import (imports take no number lock) | 1 / D1 |
| Top-bar notifications; routing a lead refused as `customer_held_by_colleague` to the colleague through the Agent Inbox | 1 / N1 |
| The SES mailer switched on for production; ⌘K search measured again on real imported leads | 1 / G1 |
| The `audit-logs-partitions` job run daily, not on the 25th (a long-lived local database fails the partition test from the 1st to the 25th); per-month error handling in `app.ensure_audit_partitions()` like `app.ensure_activity_partitions()` | 1 / any slice |
| Mobile tokens and the Redis front for idempotency keys | 4 / field app |
