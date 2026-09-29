# Roadmap — Shakti Prime BOS

Blueprint reference: §14, §15, §19, §20. A single full-time developer working with Claude; every phase has an exit gate; effort figures include a 20% contingency. `docs/BLUEPRINT.md` governs on any conflict.

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
- [ ] Phase 0 tooling installed and verified; `currentPhase` set to 1 in `.claude/tooling.json` (met apart from `currentPhase`: every tool installed and verified on 28-09-2026; `currentPhase` moves to 1 as the gate's last step)

## 3. Phase 1 — MVP (12–14 weeks)
**Scope:** non-integration ingestion (walk-in, import, manual, referral codes); dedupe; four pipelines with stage-exit rules; CC and LC workspaces with manual call logging; round-robin handover; targets and leaderboards; Price Master tiers with the minimal catalogue (items, HSN, tax rates, kits as saleable bundles, pump curves); sizing calculators; quotes with PDF; sales orders; dealer credit with manual outstanding; notifications; Knowledge Vault uploads with embeddings; data migration; Triage agent in shadow mode.

**Carried from Phase 0** (each recorded in `DESIGN.md`, `docs/design/backend-weeks-3-5.md`, `docs/API.md` §3, ADR 0009 or the Phase 1 follow-ups in `CLAUDE.md`): the top-bar notifications and the Agent Inbox; the caller workspace; the quote and sales-order tables and commands; imports of customers with the PIN code master that resolves village, tehsil and district (PRD CRM-02), the S3 store with pre-signed uploads, and the import measured on the hosted stack (concurrent batch workers only if it misses the five-minute target), with the batch budgets tuned to those numbers: a deadline across the whole set-based try rather than per statement, a short row-by-row slice after a set-based cut-off, and a job marked failed after its last queue retry; the `system:workers` principal and the workers' event-id check in Redis, before any event type is subscribed; the notification that routes a lead refused as `customer_held_by_colleague` to the colleague or team lead, through the Agent Inbox; a streaming workbook reader in place of ExcelJS's whole-file load, with the S3 store; the global server-action body limit (11 MB for the import form) brought back down once uploads are pre-signed; an alert through Sentry when the outbox publisher keeps failing, beside the readiness check; the option of a read-only login role (`app_reader`) with its own connection pool for `executeQuery()`, on top of the read-only transaction; the duplicate cards (CRM-03) for a known limitation: imports take no number lock, so an import committing a brand-new number at the same moment as a lead form or another import can create a second customer; the purge procedure behind `outbox-events-purge` confirmed on the hosted project's pg_cron (`docs/runbooks/DEPLOY.md` §2); audit partition detach, logged in `retention_runs`; the Integration Health page and replay route; time-in-stage and the kW or HP on board cards; the per-entity logos with the letterhead; the screen where an Executive edits a role's permissions (the seed already keeps an edited role's changes); Playwright visual snapshots and Lighthouse checks in CI (the JavaScript budget per page runs in CI from Phase 0), and the print snapshot tests with the ADR 0009 hosting decision; ⌘K search measured again on the client's imported leads, since three letters of a very common surname pass 300 ms for an Executive or a General Manager on the spike's made-up names (`Kan` at 631 ms and 575 ms at the 95th percentile, `docs/spikes/lists.md`); the grid pages brought under the 250 kB JavaScript aim with a smaller app shell or grid (`DESIGN.md` §10); Sentry, in the group's existing US-region organisation with personal data removed before an event is sent; the Amazon SES mailer behind the `Mailer` port before the first production release.

**Exit gate:** 2-week parallel run with legacy sheets; migration counts reconciled; UAT sign-off per role; Playwright E2E for the CC, LC, Store Manager and Executive paths; Phase 1 tooling (Playwright, Sentry, AWS) confirmed.

## 4. Phase 2 — Communications & live voice (9–11 weeks)
**Scope:** WhatsApp Cloud API with one number per entity; Lead Ads webhooks; Exotel click-to-dial and recordings on DLT-registered numbers; Concierge and Caller Co-pilot from shadow to approval; WhatsApp quote acceptance and milestone messages; speech-vendor benchmark and selection; Playbook directive review; Ask the Business; live voice Teach and Ask.

**Exit gate:** webhook idempotency and contract tests green; DLT numbers live and consent routing verified; shadow reports reviewed with the Executive; voice p50 latency < 1.5 s and STT accuracy target met on real samples.

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

## 10. Parallel workstreams (start in Phase 0)
| Workstream | Owner | Needed by |
|---|---|---|
| DLT registration of all four entities; 140/160-series numbers with Exotel | Client + developer | Phase 2 |
| Meta Business verification, WABA, one number per entity, template approval | Client + developer | Phase 2 |
| Meta App Review for Lead Ads access; Google Lead Form setup | Developer | Phase 2 |
| Tally discovery visit (companies, version, Buyer Order No., stock, e-way practice) | Developer + Accounts | Phase 0 spike |
| 20–30 executive voice samples for the speech benchmark | Client | Phase 0 spike |
| Privacy notice, consent texts, recording notice | Client + developer | Phase 1 |
| Vendor accounts registered to the client (domain, Vercel, Supabase, AWS, Meta, Exotel, Anthropic, Google Play, GitHub, LiveKit, Upstash, Sentry) | Client | Phase 0 |

## 11. Rollout and change management
- Pilot groups per module: 2 callers → full calling team; 2–3 engineers → all field staff.
- Role-wise training: short live sessions and videos in Hinglish, a one-page guide per role in English.
- UAT checklist and sign-off per role before each go-live; in-app feedback with weekly triage for 8 weeks.
- Feature flags for risky releases; expand/contract migrations; Sunday-night maintenance windows.
- Phase exit updates `currentPhase` in `.claude/tooling.json` and the tooling check runs before the next phase begins.
