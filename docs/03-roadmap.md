# Roadmap — Shakti Prime BOS

Blueprint reference: §14, §15, §19, §20. A single full-time developer working with Claude; every phase has an exit gate; effort figures include a 20% contingency. `docs/01-blueprint.md` governs on any conflict. What is built so far is in [STATUS](10-status.md); terms and slice codes are explained in the [glossary](12-glossary.md).

**Contents:** [1. Phase summary](#1-phase-summary) ([1.1 Milestones](#11-milestones)) · [2. Phase 0](#2-phase-0--discovery--foundations-68-weeks) · [3. Phase 1](#3-phase-1--mvp-1214-weeks) · [4. Phase 2](#4-phase-2--communications--live-voice-911-weeks) · [5. Phase 3](#5-phase-3--inventory--procurement-78-weeks) · [6. Phase 4](#6-phase-4--projects--field-1113-weeks) · [7. Phase 5](#7-phase-5--finance-costing--hr-911-weeks) · [8. Phase 6](#8-phase-6--ai-brain--autonomy-79-weeks) · [9. Phase 7](#9-phase-7--hardening--rollout-45-weeks) · [10. Parallel workstreams](#10-parallel-workstreams-started-in-phase-0) · [11. Rollout](#11-rollout-and-change-management)

## 1. Phase summary
The phases, their scope, effort and exit gates are in [BLUEPRINT §14](01-blueprint.md#14-roadmap--effort); §2 to §9 below hold each phase's scope and exit-gate checklist. The full scope is 65–79 weeks (about 15–18 months) and the MVP (Phases 0 and 1, 18–22 weeks) is live after about 4–5 months; a second developer on the Android app in Phase 4 shortens the total by 2–3 months.

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
| 05-10-2026 | Print and letterhead P4 (#99), sizing C4 (#100), pipelines and scoring C3 (#103), imports P2b (#105): wave 2 complete; agent runtime and Agent Inbox AI0 (#108) |
| 06-10-2026 | Quotes S1 (#115), duplicates D1 (#118), cold caller workspace T1 (#119): wave 3 complete; the AWS files stack created on dev and staging |

Ahead (no date is set until what it depends on is in hand):

| Milestone | Depends on |
|---|---|
| Wave 4 complete (N1, T2, S2, K1) | The builds, reviews and merges of each slice ([STATUS](10-status.md)) |
| Quotes and calling with the client's own values (S1, T1 are merged with the built-in defaults) | Workshop SALE-1 (number format), PRICE-1 (tier per customer type), PRICE-4 (HSN and GST rates) with the CA's golden set, the price lists, CALL-1 (dispositions), CALL-2 (scripts), CALL-3 (retries) |
| Agents and the Knowledge Vault running (AI0 is merged; K1, A1) | Anthropic and Voyage keys for each environment |
| Data migration and UAT (M1) | The client's export of the current CRM and sheets (workshop CRM-4) |
| Production readiness (G1) | A paid production Supabase project, Vercel Pro, the client's domain with Amazon SES production access, a GitHub plan with environments |
| Phase 1 exit gate | The two-week parallel run, reconciled migration counts and UAT sign-off per role |
| Phase 2 start | DLT registration and numbers, Meta Business verification, the Exotel and WhatsApp sandboxes, the voice samples (§10) |

## 2. Phase 0 — Discovery & foundations (6–8 weeks)
**Deliverables (blueprint §19):** ERD and data dictionary; state-machine specifications; permission matrix; API contracts; clickable wireframes; `docs/08-design-system.md` and preview page; ADRs; integration spikes; test strategy and security-suite skeleton; vendor quotes; Claude Code tooling.

**Week plan** (the plan of 26-09-2026; Phase 0 took four days, 26 to 29-09-2026, and what it built is in [CHANGELOG.md](../CHANGELOG.md)):
| Week | Work |
|---|---|
| 1 | Discovery workshop (inputs in `docs/02-prd.md` §7); ADRs 1–6; repo scaffold (pnpm, Turborepo, TypeScript, ESLint, Prettier, Vitest, GitHub Actions); Supabase dev/staging projects; Vercel project pinned to `bom1` |
| 2 | Core schema for org, CRM, catalogue, pricing, tax; `withRequestContext()`; RLS templates; security-suite skeleton green on the first tables; document sequences |
| 3 | Better Auth with Argon2id, sessions, TOTP, Turnstile, lockouts; Realtime JWT spike; audit logging; outbox and QStash publisher; command runner and first commands |
| 4 | `packages/tokens`, `packages/ui` base, app shell, theme behaviour, `/design` preview page; wireframe review with real users |
| 5 | Import framework (upload → mapping → preview → commit → rollback); tax engine with tests; state-machine specs for opportunity, quote, sales order |
| 6 | Integration spikes: Tally AlterID read + deletion detection + push; Exotel click-to-dial on 140/160 numbers; WhatsApp sandbox send/receive; LiveKit + speech-vendor latency and Roman-Hinglish pronunciation; Chromium A4 PDF and QR label rendering; OCR masking on real document photos |
| 7–8 | Remaining state-machine specs, API contracts for mobile/connector/webhooks/ingest, vendor quotes, ADRs 9–13, contingency |

**Exit gate checklist:**
- [x] Security suite green for every table in the core schema, including fail-closed and cost-gate tests
- [ ] `docs/08-design-system.md` and preview page signed off by the client
- [ ] All seven spikes (Tally, Exotel, WhatsApp, voice, Realtime, PDF and labels, OCR) passed with written results and latency numbers
- [ ] ERD, data dictionary, state machines, permission matrix and API contracts reviewed
- [ ] Vendor quotes confirm the §13 cost figures
- [x] Phase 0 tooling installed and verified; `currentPhase` set to 1 in `.claude/tooling.json`

**Closed on 29-09-2026 by the owner's decision**, with the hosted dev and staging environments in place (their state is in [STATUS](10-status.md)). The unticked items above are deferred, not met, and run alongside Phase 1:
- the client's sign-off of `docs/08-design-system.md` and `/design`, and the screen review;
- the Tally, Exotel, WhatsApp and voice spikes once their sandboxes exist; the Realtime spike on the production site with the client's domain; OCR on real document photos; the phone and scanner check of printed labels;
- the review of the ERD, data dictionary, state machines, permission matrix and contracts, with ADRs 0007 and 0010 to 0013 (ADR 0009 is accepted);
- the vendor quotes;
- the workshop answers and the CA's tax golden set.

Each keeps its next step in [`docs/13-client-packs/exit-gate-actions.md`](13-client-packs/exit-gate-actions.md); what the client's people do is in [`docs/13-client-packs/client-actions.md`](13-client-packs/client-actions.md). The client packs are indexed in [docs/13-client-packs/README.md](13-client-packs/README.md), the spikes in [docs/04-architecture-appendix/README.md](04-architecture-appendix/README.md) and the reviews in [docs/14-reviews/README.md](14-reviews/README.md).

## 3. Phase 1 — MVP (12–14 weeks)
**Scope:** non-integration ingestion (walk-in, import, manual, referral codes); dedupe; four pipelines with stage-exit rules; CC and LC workspaces with manual call logging; round-robin handover; targets and leaderboards; Price Master tiers with the minimal catalogue (items, HSN, tax rates, kits as saleable bundles, pump curves); sizing calculators; quotes with PDF; sales orders; dealer credit with manual outstanding; notifications; Knowledge Vault uploads with embeddings; data migration; Triage agent in shadow mode.

**Plan:** 23 slices in six waves, in [`docs/03-roadmap-appendix/phase1.md`](03-roadmap-appendix/phase1.md) §3. Progress is in [STATUS](10-status.md).

**Carried from Phase 0:** the items Phase 0 left for Phase 1 are part of the slices above; each open one, with its slice, is in [STATUS, Open follow-ups](10-status.md#open-follow-ups), their single list.

**Exit gate:**
- [ ] 2-week parallel run with legacy sheets
- [ ] Migration counts reconciled
- [ ] UAT sign-off per role
- [ ] Playwright E2E for the CC, LC, Store Manager and Executive paths
- [x] Phase 1 tooling (Playwright, Sentry, AWS) installed and confirmed with a live call (28-09-2026)

## 4. Phase 2 — Communications & live voice (9–11 weeks)
**Scope:** WhatsApp Cloud API with one number per entity; Lead Ads webhooks; Exotel click-to-dial and recordings on DLT-registered numbers; Concierge and Caller Co-pilot from shadow to approval; WhatsApp quote acceptance and milestone messages; speech-vendor benchmark and selection; Playbook directive review; Ask the Business; live voice Teach and Ask.

**Exit gate:** webhook idempotency and contract tests green; DLT numbers live and consent routing verified; shadow reports reviewed with the Executive; voice p50 latency < 1.5 s; speech-to-text accuracy met on real samples, against a target set from the voice spike's measurements before Phase 2 starts (`docs/04-architecture-appendix/voice.md`).

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
Pilots, training, UAT and feedback are as in [BLUEPRINT §15](01-blueprint.md#15-rollout--change-management); releases follow the change management of [BLUEPRINT §12](01-blueprint.md#12-reliability--operations) (expand/contract migrations, feature flags, Sunday-night maintenance windows). Each phase's exit sets `currentPhase` in `.claude/tooling.json`, and the tooling check runs before the next phase begins.
