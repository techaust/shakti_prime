# Product Requirements — Shakti Prime BOS

Blueprint reference: §0–§2, §8, §9, §15, §16. This document turns the blueprint's scope into requirements with acceptance criteria. Requirement IDs are stable and referenced by tests and pull requests. `docs/BLUEPRINT.md` governs on any conflict.

## 1. Vision and goals
Shakti Prime is the single business operating system for the four Shakti group entities. It runs lead → sale → fulfilment → installation → cash, with AI agents doing the routine lead work and leadership teaching the system through uploads and voice.

**Success metrics (measured in the Executive dashboard):**
| Metric | Target after full rollout |
|---|---|
| WhatsApp first response | < 60 s for 95% of inbound |
| Lead ingestion → assignment | < 10 s |
| Lead → qualified rate | Baseline from migration, +20% within 6 months |
| Quote → order conversion | Baseline, +15% |
| Project cycle time (survey → handover) | −25% |
| Dealer overdue outstanding | −30% |
| Staff adoption | 100% of leads, quotes and orders created in the BOS after cutover; legacy sheets retired |
| AI actions promoted to Automatic | ≥ 95% unedited over ≥ 200 cases per action type |

## 2. Users and roles
| Role | Primary job in the BOS |
|---|---|
| Executive | Direction, approvals, Price Master, Playbook, agent autonomy, P&L and margins |
| General Manager | Operations, SLAs, escalations; no cost data |
| Sales Team Lead | Caller supervision, reassignment, targets |
| Tele-Caller CC | Cold-calling queue, qualification |
| Tele-Caller LC | Conversion: WhatsApp thread, sizing, quotes, orders |
| Store Manager | Walk-ins and own records |
| Inventory Manager | Stock, procurement, vendors, dispatch, RMAs |
| Project Manager | Projects, subsidy gates, scheduling, QC |
| Field Engineer | Surveys, installs, QC, attendance, expenses in the Android app |
| Accounts | Proforma, payments, reconciliation, job costing, tax rates, expenses |
| HR Admin | Employees, attendance, leave, incentives |
| Customer (via WhatsApp) | Receives updates, sends documents, accepts quotes, checks STATUS |
| AI agents | Intake & Triage, WhatsApp Concierge, Caller Co-pilot, Sizing & Quote, Project Orchestrator, Chief of Staff |

## 3. Scope
**In scope:** everything in blueprint §2, delivered in the phases of `docs/ROADMAP.md`.

**Outside scope:** manufacturing; dealer and customer self-service portals; marketing automation; fleet management; tender management; AI outbound voice calling; contractor work-order management; service ticketing and CMC visit scheduling; creating CRM leads from Tally.

## 4. Functional requirements

### 4.1 Lead ingestion and CRM (CRM)
- **CRM-01 Ingestion channels.** Leads arrive from Meta and Google Lead Ads, entity website forms, WhatsApp inbound, Exotel IVR and missed calls, the walk-in form, referral codes, CSV/Excel import and manual entry. *AC:* each channel creates a lead with source, entity, campaign attributes and a consent record within 10 s of receipt; duplicates from the same provider event are ignored.
- **CRM-02 Normalisation.** Phones stored in E.164; PIN code resolves village, tehsil and district. *AC:* an invalid phone is rejected with a clear message; a PIN outside the master is flagged for review.
- **CRM-03 Deduplication.** A matching phone suggests a link or merge with a confidence score; a repeat enquiry with the same intent within 30 days attaches to the open opportunity. *AC:* suggestions appear as cards; merges and unmerges are audited and reversible.
- **CRM-04 Customer model.** Contacts, accounts, sites and opportunities as defined in blueprint §6.2. *AC:* one account can hold several sites and several opportunities across entities.
- **CRM-05 Pipelines.** Four configurable pipelines with stage-exit rules for required fields. *AC:* a stage move that violates a rule is blocked with the missing fields listed; Executives edit stages without code changes.
- **CRM-06 Lead scoring.** Rules-based score, adjustable within bounds by the Triage agent. *AC:* score, reasons and the last change are visible on the lead.
- **CRM-07 Account 360.** Contacts, sites, deals, timeline, tasks, orders, projects, payments, loans and warranty claims on one page. *AC:* loads in < 300 ms p95 for accounts with 1,000 activities.
- **CRM-08 Customer loans.** Applied → sanctioned → disbursed with optional gates on milestones and dispatch. *AC:* a gated dispatch cannot be released until the loan reaches the configured state.
- **CRM-09 Referral partners.** Partner codes attribute leads and accrue commissions. *AC:* accrual appears only on confirmed events.
- **CRM-10 Consent.** Consent per channel and purpose with source and timestamp; opt-out honoured across humans and agents. *AC:* an opted-out contact cannot be messaged or dialled by any path.

### 4.2 Tele-calling (TEL)
- **TEL-01 CC queue** ordered by score, callback due and SLA, with click-to-dial, script cards, one-key dispositions, automatic re-attempts and nurture. *AC:* a caller can work a lead without touching the mouse.
- **TEL-02 Handover.** "Qualified" assigns an LC by weighted round-robin (presence, capacity, language and segment skills) and locks ownership for a configurable period. *AC:* assignment within 10 s; the Sales Team Lead can reassign.
- **TEL-03 LC workspace** with board, WhatsApp thread and Co-pilot, sizing calculators, quote builder and next-best-action on one screen.
- **TEL-04 Telephony compliance.** Calls go out on the entity's 140-series (promotional) or 160-series (service) number according to consent; TRAI hours and DND scrubbing enforced; recording notice on every call. *AC:* a dial outside 9 AM–9 PM or to a DND number without consent is blocked with the reason.
- **TEL-05 Inbound screen-pop** on the matching account, or a new-lead form.
- **TEL-06 Targets and leaderboards** per caller and team for calls, qualified leads, conversions and kW; live progress; the same targets feed incentives.

### 4.3 Price Master, quotes and sales orders (SAL)
- **SAL-01 Price Master.** Executive-only edits; tiers (Retail, Dealer, Commercial, extensible), optional per-entity lists, effective dates, scheduled changes, full change log.
- **SAL-02 Tax tables.** Effective-dated GST rates per HSN or item and composite-supply rules, maintained by Accounts. *AC:* a rate change on a date changes only documents created on or after it.
- **SAL-03 Quote creation.** Tier from account type; prices from the Price Master, not editable; tax from the tax engine; snapshot per line with the rate version; 15-day validity; one-click re-quote. *AC:* any attempt to post an edited price is rejected by the command layer.
- **SAL-04 Quote validations.** Sizing complete (TDH, kW); pump-curve bounds; sanctioned-load and DCR rules; stock availability shown. *AC:* an out-of-bounds sizing result blocks the quote and routes to review.
- **SAL-05 Quote dispatch and acceptance.** Branded PDF sent on WhatsApp; acceptance by reply (optionally OTP) or signed upload. *AC:* acceptance after expiry triggers a re-quote instead of an order.
- **SAL-06 Sales orders.** Accepted quote → order; dealers may order without a quote; states draft → confirmed → partially dispatched → dispatched → invoiced → closed / cancelled; partial dispatch and backorders. *AC:* every transition follows the state machine and is audited.
- **SAL-07 Dealer credit control.** Block when outstanding + order exceeds the limit or any invoice is overdue beyond credit days; audited Executive release. *AC:* the block reason names the invoice or the limit.

### 4.4 Inventory, procurement and logistics (INV)
- **INV-01 Item master** with SKU, specs, DCR/ALMM flag, HSN, unit, serial tracking, pump curves.
- **INV-02 Stock ledger.** Append-only movements with reason codes; balances per warehouse and bin; the BOS is the stock authority.
- **INV-03 Kits and availability-to-promise.** Deterministic, tested; reservations against order lines, released on cancellation or expiry.
- **INV-04 Procurement.** Vendor master, quote comparison, PO drafting from reorder alerts, goods receipt with serial capture by camera or scanner. Supplier rates visible only with `procurement.rate.read`.
- **INV-05 Dispatch.** Split dispatch, delivery challans, vehicle and driver, in-transit status, "materials arrived" with photo. **E-way bill gate:** a dispatch above the threshold cannot leave "ready" without an e-way bill number, validity and vehicle. *AC:* the gate is enforced in the state machine; validity expiry in transit raises an alert.
- **INV-06 Surplus pool** for leftovers, suggested for reuse.
- **INV-07 Labels.** QR/barcode labels for serials, bins and packages, printed from the shared templates.
- **INV-08 Warranty claims and supplier returns** following the five-step flow in blueprint §8.4 with the cost impact recorded in job costing.

### 4.5 Projects, EPC and subsidy (PRJ)
- **PRJ-01 Standard install flow** with a configurable milestone checklist editable by Executives.
- **PRJ-02 PM Surya Ghar flow** with the gate sequence in blueprint §8.5 and a state machine per gate, including sanctioned-load lock, DCR/ALMM serial validation before dispatch and rejection loops.
- **PRJ-03 Document vault.** Requirement templates, completeness gates, generated DISCOM packs. *AC:* a gate cannot close with a missing required document.
- **PRJ-04 Scheduling board.** Day/week calendar by engineer or crew, map, drag-and-drop with conflict detection (double booking, leave, travel time), unassigned queue, Orchestrator suggestions confirmed by a person, automatic WhatsApp confirmation and day-before reminder.
- **PRJ-05 Labour and contractor cost lines** on the project.
- **PRJ-06 Handover kit** on WhatsApp; warranty registered per serial.
- **PRJ-07 CMC register** with yearly GM reminder and status report.

### 4.6 Customer WhatsApp communication (WA)
- **WA-01 Milestone templates** in Hindi and English for quote sent, order confirmed, dispatched, visit booked, installed, payment due with UPI, handover.
- **WA-02 Document collection.** Requests for missing documents; incoming files malware-scanned, masked, classified and filed against the right requirement; low-confidence classifications confirmed by a person. *AC:* a file is only ever filed against the sending customer.
- **WA-03 STATUS self-service** returning an instant order and project summary.
- **WA-04 Channel rules.** 24-hour window, approved templates, opt-out, per-entity number, portfolio messaging-limit awareness with service messages prioritised.

### 4.7 Android field app (FLD)
- **FLD-01 Offline-first** schedule, jobs, surveys, checklists, geo- and time-stamped photos, signatures, material arrival, leftovers, QC, attendance and expense capture.
- **FLD-02 Sync** with server-authoritative transitions, field-level merge for surveys, idempotent stock and expense commands, a conflict review screen. *AC:* a device offline for 5 days syncs without data loss or duplicate movements.
- **FLD-03 Background uploads** with compression, FCM push, maps navigation, minimum-version gate.

### 4.8 Finance and job costing (FIN)
- **FIN-01 Proformas and challans** per entity with financial-year numbering from templates; payment milestones with optional loan gates.
- **FIN-02 Tally connector** per blueprint §8.8: AlterID reads, GUID idempotency, daily snapshot with tombstones, heartbeat, self-update, purchase vouchers restricted.
- **FIN-03 Reconciliation** by Buyer Order No., then GSTIN or phone; review queue; receipts update milestones; credit notes adjust balances; dealer outstanding refreshed; tombstones reverse effects.
- **FIN-04 Collections.** WhatsApp reminders with UPI link or QR; ageing per entity.
- **FIN-05 Job costing.** Material at moving-average cost, labour, approved expenses, warranty replacements, other direct costs vs Tally-linked revenue; budget vs actual; margin by project, segment, entity and engineer; visible only with `finance.cost.read`.
- **FIN-06 Stock valuation reconciliation** with Tally closing stock monthly.
- **FIN-07 Expenses.** Claims with receipts, categories, policy limits, manager → Accounts approval, project or overhead allocation, monthly export.

### 4.9 HR (HR)
- **HR-01** Employee directory; office attendance by geofence and selfie; field check-in; shifts; regularisation.
- **HR-02** Leave types, balances, approvals, holiday calendar.
- **HR-03** Incentive engine tied to targets; accruals released on confirmed events; covers staff and referral partners.
- **HR-04** Monthly salary, incentive and reimbursement export for the CA.

### 4.10 Dashboards, reports, search, notifications (RPT)
- **RPT-01** Role home pages as in blueprint §8.10; the Executive page shows margins only through report queries under the viewer's permissions.
- **RPT-02** Report library with audited, permission-gated exports.
- **RPT-03** ⌘K search across phone, name, village, document numbers and serials, transliteration-aware.
- **RPT-04** Notification centre, browser push and FCM with preferences and quiet hours; SLA breaches escalate to the GM.

### 4.11 Migration and imports (IMP)
- **IMP-01** Import framework: upload → mapping templates → validation preview → dedupe suggestions → chunked commit → batch rollback. *AC:* 50k rows in < 5 min; a failed batch leaves no partial data.
- **IMP-02** Cutover runbook with staging dry run, count reconciliation, cutover weekend and a parallel run of 1–2 weeks.

### 4.12 AI (AI)
- **AI-01 Knowledge Brain.** Vault with sensitivity tags, embeddings with RLS, Playbook directives approved by Executives, extraction per input type.
- **AI-02 Ask the Business** and voice Ask run as the user with citations.
- **AI-03 Live voice** Teach, Ask and Command with barge-in, captions, push-to-talk and text fallback; p50 latency < 1.5 s; consent and spend caps.
- **AI-04 Agents.** Six agents with autonomy per action type, Agent Inbox, traces, kill switches, budgets, rollout via shadow → approval → automatic.
- **AI-05 Guardrails.** Untrusted-input labelling, narrow Concierge tools, deterministic output filters, PII masking, no cost access, injection test set passing.
- **AI-06 Disclosure.** The Concierge introduces itself as an AI and offers a human on request.

## 5. Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | p95 interaction < 300 ms; ingestion → assignment < 10 s; WhatsApp first response < 60 s; 50k-row import < 5 min; low-end Android over 3G/4G within the JS budget per route |
| Scale | 100+ concurrent users; 2,000+ leads/day; load-tested at 10k leads/day |
| Availability | 99.5% in business hours (8 AM–10 PM IST); RPO ≤ 5 min; RTO ≤ 4 h; Sunday-night maintenance windows |
| Security | As in `docs/SECURITY.md`: RLS fail-closed, two cost permissions, 2FA for Executive/GM/Accounts, audit of every mutation |
| Privacy | DPDP Act 2023 and Rules 2025; Aadhaar never stored; masking before LLM calls; retention schedule in blueprint §7.9 |
| Telecom | DLT registration; 140/160-series numbers; TRAI hours; DND; WhatsApp policy |
| Tax | Effective-dated GST rates; place-of-supply split; solar 70:30 composite supply; rupee rounding; e-way bill gate |
| Localisation | Hindi and English UI; Devanagari everywhere including PDFs; lakh/crore, DD-MM-YYYY, IST |
| Product copy | Plain language for non-technical users in both languages; no technical words, codes or internal names shown to users; no placeholder, sample or dummy text anywhere a user can see; every string final and product-specific; copy lint in CI; copy review in UAT per role (`DESIGN.md` §11) |
| Accessibility | WCAG AA in both themes; keyboard-first caller screens |
| Offline | Field app fully usable offline for multiple days |
| Observability | Sentry, structured logs without PII, integration health page, spend dashboards |
| Ownership | All vendor accounts owned by the client; ADRs, runbooks, onboarding guide |

## 6. Release plan
Delivered in Phases 0–7 as in `docs/ROADMAP.md`. The MVP (Phases 0–1) covers CRM-01 to CRM-10 (without integration channels), TEL-01 to TEL-06 (manual call logging), SAL-01 to SAL-07 (manual dealer outstanding), IMP-01 and IMP-02, AI-01 uploads and the Triage agent in shadow mode.

## 7. Discovery workshop inputs
Pipeline stages, required fields, dispositions and scripts per segment; tier assignment rules, per-entity pricing, kit pricing, HSN and tax per item; dealer terms; incentive, target, expense and attendance policies; Tally companies, version, Buyer Order No. usage, stock and e-way bill practice; the existing CRM's export format; call volumes and caller headcount; WhatsApp and calling numbers per entity and DLT status; numbering formats, letterheads, bank/UPI details; required documents per project type and gate; loan partners.
