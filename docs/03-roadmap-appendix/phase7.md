# Backend and product design: Phase 7 (Hardening and rollout)

Date: 27-11-2026. Status: approved by the owner on 27-11-2026, with every question of §2 decided as the recommended option. In the push's scope (DECISIONS, 27-11-2026) its engineering is built in the second push; its rollout needs the client's people. Governing documents: BLUEPRINT §7.5, §12, §15, §17, §18; ROADMAP §9 and §11; PRD NFR-01 to NFR-03; DATABASE §7 and §10; SECURITY §5, §9 and §11; `docs/runbooks/cutover.md`, `incidents.md`; `docs/13-client-packs/parallel-run.md`, `exit-gate-actions.md`.

**Contents:** [1. Scope](#1-scope) · [2. Decisions for the owner](#2-decisions-for-the-owner) · [3. Slices](#3-slices) · [4. Slices in detail](#4-slices-in-detail) · [5. The rollout](#5-the-rollout) · [6. Gaps and conflicts](#6-gaps-and-conflicts-in-the-governing-documents)

## 1. Scope
**What exists:** single-process spikes for lists, imports and hot reads (`docs/04-architecture-appendix/lists.md`, `hot-reads.md`), with the hosted stack and concurrent users still to measure; the audits of September and October in `docs/14-reviews/`; 6-hourly `pg_dump` copies to an object-locked bucket by CodeBuild (no copy yet: the CodeBuild limit is 0) and Supabase's daily backups, with a seven-step restore drill never run; consent recording and withdrawal, the retention anonymisation and Aadhaar masking; the cutover runbook and the parallel-run pack; UAT checklists per role.

**In Phase 7:** a load test at 10,000 leads a day and 100 concurrent users (5× the expected volume) on staging; an internal security review to OWASP ASVS level 2 with its fixes, and the scope pack for an external pentest; the restore drill as a tested script; the DPDP rights requests (access, correction, erasure), the privacy incident register and the grievance contact; in-app help, a feedback button and a one-page guide per role; the go-live pack (cutover rehearsal, go/no-go).

**Needs the client's people or the owner:** the external pentest; the training videos; the cutover weekend; the two-week parallel run; UAT sign-off per role; the go-live sign-off (the exit gate); every live item earlier phases moved here.

## 2. Decisions for the owner
1. **Load testing** (LT1). **Decided: (a)** k6 (open source) in a workflow started by hand against staging, with a seeded staging copy at the target volume; staging's Supabase compute raised to production's size for the run and lowered after (a cost for the hours it runs: the owner's yes before each run). (b) Locally only.
2. **The recovery point** (DR1). The PRD (NFR-03) and BLUEPRINT §12 promise RPO ≤ 5 minutes; DATABASE §10 records production without point-in-time recovery, about 6 hours. **Decided: (a)** buy Supabase's point-in-time recovery for production before go-live (a monthly cost, the owner's), and the drill covers both paths. (b) Accept about 6 hours, and amend NFR-03 and BLUEPRINT §12 by the owner's decision.
3. **The external pentest** (SR1). **Decided: (a)** a CERT-In empanelled auditor, chosen and paid by the owner, after SR1's fixes merge; the lead writes the scope pack and answers findings in a slice of their own.
4. **DPDP rights** (DP1). **Decided: (a)** a rights request register (kind, person, received, due by a named default pending legal advice, state); access answered by an export of the person's data, correction through the existing commands, erasure by the anonymisation path where no law requires keeping the record; the grievance officer named by the client and shown on the privacy notice and the landing page.
5. **Help** (HP1). **Decided: (a)** a help panel per screen from Markdown in the repository (English, the §11 copy rules, linted), a feedback button filing to the Executive's inbox, and a printable one-page guide per role; the Hinglish training videos are the client's with the developer's script.

## 3. Slices
| Slice | Needs | Tier | Requirements |
|---|---|---|---|
| LT1 Load test harness and the staging run | — | B | NFR-01, NFR-02 |
| SR1 Internal security review (ASVS L2) and fixes, pentest scope pack | — | A | BLUEPRINT §17, SECURITY §9, §11 |
| DR1 The restore drill as a script, and its first run | the CodeBuild limit, question 2 | A | NFR-03, DATABASE §10 |
| DP1 DPDP rights requests, incidents and the grievance contact | — | A | BLUEPRINT §7.5, SECURITY §5 |
| HP1 In-app help, feedback and the guides per role | — | C | BLUEPRINT §15 |
| CL1 The client's answers applied | the answers | A | the checklist answers' slice (DECISIONS, 02-11-2026) |
| G7 The go-live pack | all | B | ROADMAP §9's exit gate |

## 4. Slices in detail
- **LT1:** scenarios for ingestion (10,000 leads a day with bursts), callers working queues (100 users), quote and order creation, imports, ⌘K; thresholds from NFR-01 as k6 checks; results recorded in `docs/04-architecture-appendix/` per run; regressions found become fixes in this slice or follow-ups.
- **SR1:** the ASVS L2 checklist walked over every route, command and worker with evidence; the deferred items of SECURITY §9 and §11; dependency and secret scans; findings fixed by severity; the pentest scope pack (environments, roles, test accounts on staging, out-of-scope, rules of engagement).
- **DR1:** a script `restore-drill.sh` in `tools/ops/` restoring the newest copy into a scratch Supabase project or a local Postgres, verifying row counts and `db:verify`, timing it against RTO; run once per quarter by a scheduled reminder; INCIDENTS §6 updated from the first run.
- **DP1:** `privacy_requests` and `privacy_incidents` (planned in DATABASE §7), commands to log, export, correct and erase, each audited, with due dates; the data export as a ZIP of the person's records masked as the screens mask; the grievance contact in Settings, the privacy notice and the landing page.
- **HP1:** a help registry per route; the panel; the feedback command; the guides rendered by the print templates.
- **CL1:** each answered checklist question applied as its own change to the workshop defaults or data, with its record.
- **G7:** a cutover rehearsal on staging from the client's export (`cutover.md` §2), the count reconciliation, the go/no-go checklist with each live item of Phases 1 to 6, and `currentPhase` closed.

## 5. The rollout
As BLUEPRINT §15 and ROADMAP §11: pilots per role, training, UAT per role, the cutover weekend, the two-week parallel run with the legacy sheets (`parallel-run.md`), go-live sign-off by the Executives, and production releases only by the owner (`release.yml`).

## 6. Gaps and conflicts in the governing documents
The recovery point (question 2); the grievance officer is named nowhere; NFR-02 has no test in the traceability table; the training plan exists only as BLUEPRINT §15's lines.
