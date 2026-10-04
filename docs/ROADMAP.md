# Roadmap — Shakti Prime BOS

Blueprint reference: §14, §15, §19, §20. A single full-time developer working with Claude; every phase has an exit gate; effort figures include a 20% contingency. `docs/BLUEPRINT.md` governs on any conflict. What is built so far is in [STATUS](STATUS.md); terms and slice codes are explained in the [glossary](GLOSSARY.md).

**Contents:** [1. Phase summary](#1-phase-summary) ([1.1 Milestones](#11-milestones)) · [2. Phase 0](#2-phase-0--discovery--foundations-68-weeks) · [3. Phase 1](#3-phase-1--mvp-1214-weeks) · [4. Phase 2](#4-phase-2--communications--live-voice-911-weeks) · [5. Phase 3](#5-phase-3--inventory--procurement-78-weeks) · [6. Phase 4](#6-phase-4--projects--field-1113-weeks) · [7. Phase 5](#7-phase-5--finance-costing--hr-911-weeks) · [8. Phase 6](#8-phase-6--ai-brain--autonomy-79-weeks) · [9. Phase 7](#9-phase-7--hardening--rollout-45-weeks) · [10. Parallel workstreams](#10-parallel-workstreams-started-in-phase-0) · [11. Rollout](#11-rollout-and-change-management)

## 1. Phase summary
| Phase | Weeks | Outcome |
|---|---|---|
| 0 — Discovery & foundations | 6–8 | Secure, tested platform skeleton and signed-off design system |
| 1 — MVP | 12–14 | CRM, tele-calling, quotes and sales orders live for all entities |
| 2 — Communications & live voice | 9–11 | WhatsApp, Lead Ads, Exotel, Concierge and Co-pilot in approval mode, voice Teach/Ask |
| 3 — Inventory & procurement | 7–8 | Stock authority in the BOS with dispatch and e-way gate |
| 4 — Projects & field | 11–13 | Project flows, subsidy gates, scheduling, Android app in the field |
| 5 — Finance, costing & HR | 9–11 | Tally reconciliation, job costing, expenses, HR |
| 6 — AI brain & autonomy | 7–9 | Remaining agents, voice Command, autonomy promotions |
| 7 — Hardening & rollout | 4–5 | Load, security, DR, training, go-live |
| **Total** | **65–79 (≈ 15–18 months)** | MVP after Phases 0–1 (≈ 5–6 months) |

A second developer on the Android app in Phase 4 shortens the total by 2–3 months.

### 1.1 Milestones
Reached (dates from the merges on `main`; the full list is in [CHANGELOG.md](../CHANGELOG.md)):

| Date | Milestone |
|---|---|
| 26-09-2026 | Blueprint, module documents and the monorepo scaffold committed; Phase 0 starts |
| 27-09-2026 | Phase 0 foundations merged: identity, audit trail, outbox, idempotency keys, app shell and first screens, tax engine and state machines, import framework, print and OCR spikes, contracts, ERD and ADRs, client packs (#5 to #47) |
| 28-09-2026 | Phase 0 completeness and audit fixes merged (#48 to #72) |
| 29-09-2026 | Hosted dev and staging environments live (#74 to #76); Phase 0 closed by the owner's decision (#77); Phase 1 design approved (#80); Phase 1 starts |
| 30-09-2026 | Wave 1: quality harness P3 (#81), observability and workers P1 (#82) |
| 03-10-2026 | Files and storage P2 (#85); catalogue and tax C1 (#87) |
| 04-10-2026 | Role editor X1 (#88); customer timeline and Account 360 C2 (#89) |

Ahead (no date is set until what it depends on is in hand):

| Milestone | Depends on |
|---|---|
| Wave 2 complete (P4, C3, C4, P2b) | Static Inter font files for P4; the AWS files stack on dev and staging for imports through pre-signed uploads (`docs/runbooks/files-setup.md`) |
| Quotes with real prices and numbers (S1) | Workshop SALE-1 (number format), PRICE-1 (tier per customer type), PRICE-4 (HSN and GST rates) with the CA's golden set, and the price lists |
| Cold Caller workspace in daily use (T1) | Workshop CALL-1 (dispositions), CALL-2 (scripts), CALL-3 (retries) |
| Agent Inbox, Knowledge Vault and Triage in shadow (AI0, K1, A1) | Anthropic and Voyage keys for each environment |
| Data migration and UAT (M1) | The client's export of the current CRM and sheets (workshop CRM-4) |
| Production readiness (G1) | A paid production Supabase project, Vercel Pro, the client's domain with Amazon SES production access, a GitHub plan with environments |
| Phase 1 exit gate | The two-week parallel run, reconciled migration counts and UAT sign-off per role |
| Phase 2 start | DLT registration and numbers, Meta Business verification, the Exotel and WhatsApp sandboxes, the voice samples (§10) |

## 2. Phase 0 — Discovery & foundations (6–8 weeks)
**Deliverables (blueprint §19):** ERD and data dictionary; state-machine specifications; permission matrix; API contracts; clickable wireframes; `DESIGN.md` and preview page; ADRs; integration spikes; test strategy and security-suite skeleton; vendor quotes; Claude Code tooling.

**Week plan:**
| Week | Work |
|---|---|
| 1 | Discovery workshop (inputs in `docs/PRD.md` §7); ADRs 1–6; repo scaffold (pnpm, Turborepo, TypeScript, ESLint, Prettier, Vitest, GitHub Actions); Supabase dev/staging projects; Vercel project pinned to `bom1` |
| 2 | Core schema for org, CRM, catalogue, pricing, tax; `withRequestContext()`; RLS templates; security-suite skeleton green on the first tables; document sequences |
| 3 | Better Auth with Argon2id, sessions, TOTP, Turnstile, lockouts; Realtime JWT spike; audit logging; outbox and QStash publisher; command runner and first commands |
| 4 | `packages/tokens`, `packages/ui` base, app shell, theme behaviour, `/design` preview page; wireframe review with real users |
| 5 | Import framework (upload → mapping → preview → commit → rollback); tax engine with tests; state-machine specs for opportunity, quote, sales order |
| 6 | Integration spikes: Tally AlterID read + deletion detection + push; Exotel click-to-dial on 140/160 numbers; WhatsApp sandbox send/receive; LiveKit + speech-vendor latency and Roman-Hinglish pronunciation; Chromium A4 PDF and QR label rendering; OCR masking on real document photos |
| 7–8 | Remaining state-machine specs, API contracts for mobile/connector/webhooks/ingest, vendor quotes, ADRs 9–13, contingency |

**Exit gate checklist:**
- [x] Security suite green for every table in the core schema, including fail-closed and cost-gate tests
- [ ] `DESIGN.md` and preview page signed off by the client
- [ ] All seven spikes (Tally, Exotel, WhatsApp, voice, Realtime, PDF and labels, OCR) passed with written results and latency numbers
- [ ] ERD, data dictionary, state machines, permission matrix and API contracts reviewed
- [ ] Vendor quotes confirm the §13 cost figures
- [x] Phase 0 tooling installed and verified; `currentPhase` set to 1 in `.claude/tooling.json`

**Closed on 29-09-2026 by the owner's decision**, with the hosted dev and staging environments in place (their state is in [STATUS](STATUS.md)). The unticked items above are deferred, not met, and run alongside Phase 1:
- the client's sign-off of `DESIGN.md` and `/design`, and the screen review;
- the Tally, Exotel, WhatsApp and voice spikes once their sandboxes exist; the Realtime spike on the production site with the client's domain; OCR on real document photos; the phone and scanner check of printed labels;
- the review of the ERD, data dictionary, state machines, permission matrix and contracts, with ADRs 0007 and 0009 to 0013;
- the vendor quotes;
- the workshop answers and the CA's tax golden set.

Each keeps its next step in [`docs/phase0/exit-gate-actions.md`](phase0/exit-gate-actions.md); what the client's people do is in [`docs/phase0/client-actions.md`](phase0/client-actions.md).

## 3. Phase 1 — MVP (12–14 weeks)
**Scope:** non-integration ingestion (walk-in, import, manual, referral codes); dedupe; four pipelines with stage-exit rules; CC and LC workspaces with manual call logging; round-robin handover; targets and leaderboards; Price Master tiers with the minimal catalogue (items, HSN, tax rates, kits as saleable bundles, pump curves); sizing calculators; quotes with PDF; sales orders; dealer credit with manual outstanding; notifications; Knowledge Vault uploads with embeddings; data migration; Triage agent in shadow mode.

**Plan:** 23 slices in six waves, in [`docs/design/phase1.md`](design/phase1.md) §3. Progress is in [STATUS](STATUS.md).

**Carried from Phase 0** (each recorded in `DESIGN.md`, `docs/design/backend-weeks-3-5.md`, `docs/API.md` §3 or ADR 0009), with the slice that delivers it:

| Item | Slice |
|---|---|
| The `system:workers` principal and the workers' event-id check in Redis, before any event type is subscribed | P1, built (#82) |
| An alert through Sentry when the outbox publisher keeps failing, beside the readiness check | P1, built (#82) |
| Sentry, in the group's existing US-region organisation, with personal data removed before an event is sent | P1, built (#82) |
| A read-only login role (`app_reader`) with its own connection pool for `executeQuery()` | P1, built (#82) |
| Audit partition detach, logged in `retention_runs` | P1, built (#82) |
| The Integration Health page and the replay route | P1, built (#82) |
| The purge behind `outbox-events-purge` confirmed on the hosted pg_cron (`docs/runbooks/DEPLOY.md` §2) | P1, confirmed on dev and staging on 30-09-2026 |
| Playwright visual snapshots and Lighthouse checks in CI (the JavaScript budget per page runs in CI from Phase 0) | P3, built (#81) |
| The grid pages under the 250 kB JavaScript aim (`DESIGN.md` §10) | P3, built (#81) |
| The S3 store with pre-signed uploads | P2, built (#85) |
| The Amazon SES mailer behind the `Mailer` port | P2, built (#85); switched on for production in G1 |
| The screen where an Executive edits a role's permissions | X1, built (#88) |
| The per-entity logos with the letterhead, and the print snapshot tests with the ADR 0009 hosting decision | P4 |
| Imports of customers with the PIN code master that resolves village, tehsil and district (PRD CRM-02) | P2b |
| A streaming workbook reader in place of ExcelJS's whole-file load, and the server-action body limit (11 MB for the import form) brought back down | P2b |
| The import measured on the hosted stack, with the batch budgets tuned to it: one deadline across the set-based try, a short row-by-row slice after a set-based cut-off, a job marked failed after its last queue retry; concurrent batch workers only if it misses the five-minute target | P2b |
| The Agent Inbox | AI0 |
| The caller workspace | T1 |
| The quote tables and commands; time in stage and the kW or HP on board cards | S1 |
| The duplicate cards (PRD CRM-03), which also catch a second customer made when an import commits a brand-new number at the same moment as a lead form or another import (imports take no number lock) | D1 |
| The top-bar notifications, and the notification that routes a lead refused as `customer_held_by_colleague` to the colleague or team lead through the Agent Inbox | N1 |
| The sales-order tables and commands | S2 |
| ⌘K search measured again on the client's imported leads: three letters of a very common surname pass 300 ms for an Executive or a General Manager on the spike's made-up names (`docs/spikes/lists.md`) | M1 and G1 |

**Exit gate:** 2-week parallel run with legacy sheets; migration counts reconciled; UAT sign-off per role; Playwright E2E for the CC, LC, Store Manager and Executive paths; Phase 1 tooling (Playwright, Sentry, AWS) confirmed.

## 4. Phase 2 — Communications & live voice (9–11 weeks)
**Scope:** WhatsApp Cloud API with one number per entity; Lead Ads webhooks; Exotel click-to-dial and recordings on DLT-registered numbers; Concierge and Caller Co-pilot from shadow to approval; WhatsApp quote acceptance and milestone messages; speech-vendor benchmark and selection; Playbook directive review; Ask the Business; live voice Teach and Ask.

**Exit gate:** webhook idempotency and contract tests green; DLT numbers live and consent routing verified; shadow reports reviewed with the Executive; voice p50 latency < 1.5 s; speech-to-text accuracy met on real samples, against a target set from the voice spike's measurements before Phase 2 starts (`docs/spikes/voice.md`).

## 5. Phase 3 — Inventory & procurement (7–8 weeks)
**Scope:** full catalogue; stock ledger and balances; kit availability-to-promise; reservations; vendors and quote comparison; POs and goods receipt with serial capture; dispatch and challans with the e-way bill gate; labels; warranty claims and RMA; surplus pool.

**Exit gate:** physical stock audit at both sites reconciles with the ledger; supplier-rate isolation verified in the security suite.

## 6. Phase 4 — Projects & field (11–13 weeks)
**Scope:** standard and PM Surya Ghar flows; subsidy gates; document vault with masked WhatsApp filing; DISCOM packs; QC; scheduling board with Concierge site-visit booking; handover kit; CMC register; customer loans; Android app with offline sync, attendance and expense capture (Expo tooling confirmed at phase start).

**Exit gate:** pilot with 2–3 engineers on live jobs for two weeks; sync conflict cases exercised; staged rollout via EAS.

## 7. Phase 5 — Finance, costing & HR (9–11 weeks)
**Scope:** proformas and payment milestones; Tally connector with AlterID reads and tombstones; reconciliation and review queue; dealer outstanding sync; stock valuation reconciliation; payment reminders; job costing and project profit; expense approval; attendance, leave, incentives, salary export.

**Exit gate:** one full month reconciled with Tally by Accounts for all four companies; connector catch-up test after a simulated 3-day outage.

## 8. Phase 6 — AI brain & autonomy (7–9 weeks)
**Scope:** Sizing & Quote, Project Orchestrator and Chief of Staff agents; voice Command mode; autonomy promotions per action type with eval thresholds.

**Exit gate:** eval thresholds met per action type; ≥ 95% unedited over ≥ 200 cases before any Automatic promotion; Executive sign-off recorded.

## 9. Phase 7 — Hardening & rollout (4–5 weeks)
**Scope:** load test at 10k leads/day and 100 concurrent users; external security review and pentest; DR restore drill; DPDP readiness review; runbooks and onboarding guide; role-wise training and in-app help; go-live.

**Exit gate:** go-live sign-off by the Executives; open findings closed or accepted in writing.

## 10. Parallel workstreams (started in Phase 0)
| Workstream | Owner | Needed by |
|---|---|---|
| DLT registration of all four entities; 140/160-series numbers with Exotel | Client + developer | Phase 2 |
| Meta Business verification, WABA, one number per entity, template approval | Client + developer | Phase 2 |
| Meta App Review for Lead Ads access; Google Lead Form setup | Developer | Phase 2 |
| Tally discovery visit (companies, version, Buyer Order No., stock, e-way practice) | Developer + Accounts | The Tally spike, deferred from Phase 0; before Phase 5 |
| 20–30 executive voice samples for the speech benchmark | Client | The voice spike, deferred from Phase 0; before Phase 2 |
| Privacy notice, consent texts, recording notice | Client + developer | Phase 1 go-live |
| Vendor accounts registered to the client (domain, Vercel, Supabase, AWS, Meta, Exotel, Anthropic, Google Play, GitHub, LiveKit, Upstash, Sentry) | Client | Production readiness (G1) |

## 11. Rollout and change management
- Pilot groups per module: 2 callers → full calling team; 2–3 engineers → all field staff.
- Role-wise training: short live sessions and videos in Hinglish, a one-page guide per role in English.
- UAT checklist and sign-off per role before each go-live; in-app feedback with weekly triage for 8 weeks.
- Feature flags for risky releases; expand/contract migrations; Sunday-night maintenance windows.
- Phase exit updates `currentPhase` in `.claude/tooling.json` and the tooling check runs before the next phase begins.
