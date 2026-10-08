# Product Requirements — Shakti Prime BOS

Blueprint reference: §0–§2, §8, §9, §15, §16. This document turns the blueprint's scope into requirements with acceptance criteria. Requirement IDs are stable; §8 traces each one to the slice that delivers it and the tests that check it. `docs/01-blueprint.md` governs on any conflict.

**Status:** approved with the blueprint on 26-09-2026 · last updated 07-10-2026. Whether a requirement is built is in [STATUS](10-status.md).

**Two ID families.** Requirements here have two digits (PRD CRM-05). The discovery workshop's questions in `docs/13-client-packs/workshop-pack.md` use one digit (workshop CRM-5); where both could be confused, documents name the family. Client values that the workshop has not given are written as "the workshop value" with the question's ID; this document never sets them. Terms are explained in the [glossary](12-glossary.md).

**Contents:** [1. Vision and goals](#1-vision-and-goals) · [2. Users and roles](#2-users-and-roles) · [3. Scope](#3-scope) · [4. Functional requirements](#4-functional-requirements) ([CRM](#41-lead-ingestion-and-crm-crm), [TEL](#42-tele-calling-tel), [SAL](#43-price-master-quotes-and-sales-orders-sal), [INV](#44-inventory-procurement-and-logistics-inv), [PRJ](#45-projects-epc-and-subsidy-prj), [WA](#46-customer-whatsapp-communication-wa), [FLD](#47-android-field-app-fld), [FIN](#48-finance-and-job-costing-fin), [HR](#49-hr-hr), [RPT](#410-dashboards-reports-search-notifications-rpt), [IMP](#411-migration-and-imports-imp), [AI](#412-ai-ai)) · [5. Non-functional requirements](#5-non-functional-requirements) · [6. Release plan](#6-release-plan) · [7. Discovery workshop inputs](#7-discovery-workshop-inputs) · [8. Traceability](#8-traceability)

## 1. Vision and goals
Shakti Prime is the single business operating system for the four Shakti group entities. It runs lead → sale → fulfilment → installation → cash, with AI agents doing the routine lead work and leadership teaching the system through uploads and voice.

**Goals (measured in the Executive dashboard).** The business goals are stated in words; their targets are the client's to set, and none is set until the client gives them. The two time limits in the table, first reply and lead routing, are operating limits from BLUEPRINT §6.4 (NFR-01), not client targets.

| Goal | Measure |
|---|---|
| Fast WhatsApp replies | First response in < 60 s for 95% of inbound |
| Fast lead routing | Lead ingestion → assignment in < 10 s |
| More leads qualified | The lead → qualified rate, against the baseline from the migrated data |
| More quotes won | The quote → order conversion rate, against the same baseline |
| Shorter projects | Project cycle time from survey to handover |
| Less dealer money overdue | Dealer overdue outstanding |
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
**In scope:** everything in blueprint §2, delivered in the phases of `docs/03-roadmap.md`.

**Outside scope:** manufacturing; dealer and customer self-service portals; marketing automation; fleet management; tender management; AI outbound voice calling; contractor work-order management; service ticketing and CMC visit scheduling; creating CRM leads from Tally.

## 4. Functional requirements
Each requirement states what the product does, then its acceptance criteria (*AC*), each one a check a test or a UAT step can pass or fail. §6 says which parts of each requirement are in Phase 1.

### 4.1 Lead ingestion and CRM (CRM)
- **CRM-01 Ingestion channels.** Leads arrive from Meta and Google Lead Ads, entity website forms, WhatsApp inbound, Exotel IVR and missed calls, the walk-in form, referral codes, CSV/Excel import and manual entry.
  - *AC:* a lead made by manual entry, the walk-in form, an import or with a referral code carries its source, its company and, when consent was given, a consent record.
  - *AC:* a Store Manager completes the walk-in form (name, phone, village or PIN, interest, consent) in under 30 seconds in the UAT timing.
  - *AC:* each integration channel creates a lead with source, company, campaign attributes (UTM, campaign, ad ID) and a consent record within 10 s of receipt; a repeated provider event creates nothing new.
- **CRM-02 Normalisation.** Phones stored in E.164; PIN code resolves village, tehsil and district.
  - *AC:* an invalid phone is rejected with a message naming the field, and a valid one is stored in E.164.
  - *AC:* a PIN in the master fills tehsil and district and offers its post-office localities for the village; a PIN outside the master saves the lead and flags it for review.
- **CRM-03 Deduplication.** A matching phone suggests a link or merge with a confidence score; a repeat enquiry with the same intent within 30 days attaches to the open opportunity.
  - *AC:* duplicate candidates (by phone, or by name and village) appear as cards on the lead and on the duplicates list, each with its reason and confidence, found when a lead is made and by a nightly pass.
  - *AC:* a merge and an unmerge each write an audit row, and an unmerge restores what the merge moved.
  - *AC:* a repeat enquiry for the same segment within 30 days of the last activity on an open lead attaches to that lead instead of creating one.
  - *AC:* the cards also surface a second customer made when an import committed a brand-new number at the same moment as a lead form or another import.
- **CRM-04 Customer model.** Contacts, accounts, sites and opportunities as defined in blueprint §6.2.
  - *AC:* one account holds several sites and several opportunities across companies, as one customer record for the group with one relationship per company (ADR 0008).
  - *AC:* a customer has exactly one owner contact; family members are added as family contacts (workshop pack A2.2).
  - *AC:* a company's staff read a customer only through that company's relationship or a lead they can read there.
- **CRM-05 Pipelines.** Four configurable pipelines with stage-exit rules for required fields.
  - *AC:* the four pipelines are Farmer Pumps, Residential Rooftop, Commercial EPC and Dealer/Wholesale; their stages and exit rules are the workshop values (CRM-1, CRM-2).
  - *AC:* a stage move that violates a rule is blocked with the missing fields listed.
  - *AC:* an Executive adds, renames, reorders and archives stages and sets exit rules, lock hours and the first-contact SLA from the settings screen, without code changes.
- **CRM-06 Lead scoring.** Rules-based score, adjustable within bounds by the Triage agent.
  - *AC:* the score is computed from rules on source, segment, district, system size and age, whose points are the workshop value (CRM-3); with no rules every lead starts level.
  - *AC:* score, reasons and the last change (when and by whom) are visible on the lead.
  - *AC:* an agent's adjustment outside the bounds is refused; the bounds are the workshop value (CRM-7).
- **CRM-07 Account 360.** Contacts, sites, deals, timeline, tasks, orders, projects, payments, loans and warranty claims on one page.
  - *AC:* loads in < 300 ms p95 for accounts with 1,000 activities.
  - *AC:* each part joins the page with the module that owns it: contacts, sites, leads, timeline, tasks, tags and consents, then quotes and orders, in Phase 1; projects, loans, payments and warranty claims in their phases.
- **CRM-08 Customer loans.** Applied → sanctioned → disbursed with optional gates on milestones and dispatch.
  - *AC:* a gated dispatch or milestone cannot be released until the loan reaches the configured state.
  - *AC:* every loan transition follows the `customer-loan` state machine and is audited; a rejection tells the opportunity owner.
- **CRM-09 Referral partners.** Partner codes attribute leads and accrue commissions.
  - *AC:* a lead made with an active partner code is attributed to that partner; an unknown or inactive code is refused with a message.
  - *AC:* accrual appears only on confirmed events (an order confirmed), at the partner's rule, which is the workshop value (CRM-5); release on payment follows in Phase 5.
- **CRM-10 Consent.** Consent per channel and purpose with source and timestamp; opt-out honoured across humans and agents.
  - *AC:* each consent records channel, purpose, source, time and, when given, a proof file that has passed its checks; a recorded consent is never edited, only withdrawn.
  - *AC:* an opted-out contact cannot be messaged or dialled by any path: a call to a contact who withdrew consent cannot be logged (Phase 1), and dialling and messaging refuse it (Phase 2).

### 4.2 Tele-calling (TEL)
- **TEL-01 CC queue** ordered by score, callback due and SLA, with click-to-dial, script cards, one-key dispositions, automatic re-attempts and nurture. Script cards are in Roman-script Hinglish, or English for a customer whose language preference is English.
  - *AC:* a caller can work a lead without touching the mouse: next lead, the dispositions on keys 1 to 9, the number to dial and search each have a key.
  - *AC:* the queue lists the caller's open leads in their first stages, ordered by due callbacks, SLA breach, score and age.
  - *AC:* each logged call records its disposition, its activity and its next action; after the workshop number of attempts (CALL-3) the lead moves to nurture with its follow-up tasks (CALL-5).
  - *AC:* the script card shown matches the lead's segment and the contact's call language.
- **TEL-02 Handover.** "Qualified" assigns an LC by weighted round-robin (presence, capacity, language and segment skills) and locks ownership for a configurable period.
  - *AC:* assignment within 10 s, to a converter who is present, under capacity and matches language and segment, with the fewest open leads; with no such converter, the lead goes to the Sales Team Lead.
  - *AC:* during the lock (the workshop value, CALL-4) no other caller takes the lead; the Sales Team Lead can reassign, and can move all of a leaving caller's leads at once.
- **TEL-03 LC workspace** with board, WhatsApp thread and Co-pilot, sizing calculators, quote builder and next-best-action on one screen.
  - *AC:* the converter's board, the selected lead's sizing, the quote builder and the next-best-action list are on one screen, worked from the keyboard.
  - *AC:* the next-best-action list names callbacks due, quotes about to expire, missing sizing and blocked orders.
  - *AC:* the WhatsApp thread and the Co-pilot join the screen in Phase 2.
- **TEL-04 Telephony compliance.** Calls go out on the entity's 140-series (promotional) or 160-series (service) number according to consent; TRAI hours and DND scrubbing enforced; recording notice on every call.
  - *AC:* a dial outside 9 AM–9 PM IST or to a DND number without consent is blocked with the reason.
  - *AC:* a service call goes out only from a 160-series number with recorded consent, a promotional call only from a 140-series number to a number off DND; a refusal lists every rule broken.
  - *AC:* every connected call plays the recording notice.
- **TEL-05 Inbound screen-pop** on the matching account, or a new-lead form.
  - *AC:* an inbound call from a known number opens the matching customer's page for the answering caller while it rings; a number shared by several customers lists them.
  - *AC:* an unknown number opens the new-lead form with the number filled in.
- **TEL-06 Targets and leaderboards** per caller and team for calls, qualified leads, conversions and kW; live progress; the same targets feed incentives.
  - *AC:* a person with `sales.targets.write` sets a target per caller or team, per metric (calls, qualified, orders, kW) and per day, week or month; the values are the workshop value (CALL-6).
  - *AC:* a caller's home shows progress against each target, counting every logged call, qualification and confirmed order as soon as the page refreshes; the team leaderboard ranks the team's callers.
  - *AC:* the incentive engine (HR-03) reads the same targets.

### 4.3 Price Master, quotes and sales orders (SAL)
- **SAL-01 Price Master.** Executive-only edits; tiers (Retail, Dealer, Commercial, extensible), optional per-entity lists, effective dates, scheduled changes, full change log.
  - *AC:* a price change by anyone but an Executive is refused.
  - *AC:* a list belongs to a tier and, optionally, one company, and starts on a date; a draft prices nothing until approved, and one approved list is live per tier and company on any date.
  - *AC:* a list scheduled for a future date takes effect on that date with no further action.
  - *AC:* every price change is in the change log with the old and new price, who and when, and the log cannot be edited.
- **SAL-02 Tax tables.** Effective-dated GST rates per HSN or item and composite-supply rules, maintained by Accounts.
  - *AC:* a rate change on a date changes only documents created on or after it.
  - *AC:* only a holder of `tax.rates.write` (Executive, Accounts) working in the All companies view changes a rate or a composite-supply rule.
  - *AC:* the tax engine reproduces the CA's golden set exactly (ADR 0007; the set is the workshop value, PRICE-5).
- **SAL-03 Quote creation.** Tier from account type; prices from the Price Master, not editable; tax from the tax engine; snapshot per line with the rate version; 15-day validity; one-click re-quote.
  - *AC:* any attempt to post an edited price is rejected by the command layer.
  - *AC:* the tier follows the customer type (the workshop value, PRICE-1); each line snapshots price, HSN and tax-rate version, and a later rate change leaves the quote unchanged.
  - *AC:* the quote is valid for 15 days, to the end of the day in IST; afterwards it reads as expired, and a re-quote supersedes it at current prices.
  - *AC:* the quote number comes from the company's series for the financial year in the workshop format (SALE-1), with no gaps; the total rounds to the rupee with the round-off shown.
- **SAL-04 Quote validations.** Sizing complete (TDH, kW); pump-curve bounds; sanctioned-load and DCR rules; stock availability shown.
  - *AC:* an out-of-bounds sizing result blocks the quote and routes to review: a review task goes to the team lead.
  - *AC:* a quote without a recorded sizing is refused; only a person records the sizing a quote relies on.
  - *AC:* sizing results come from the pure, tested functions in `packages/domain`, never from a model.
  - *AC:* stock availability per line is shown once the stock ledger exists (Phase 3).
- **SAL-05 Quote dispatch and acceptance.** Branded PDF sent on WhatsApp; acceptance by reply (optionally OTP) or signed upload.
  - *AC:* acceptance after expiry triggers a re-quote instead of an order.
  - *AC:* the PDF prints the selling company's letterhead, logo and bank details, always in the light style.
  - *AC:* a signed copy uploaded by staff accepts the quote and creates the order draft (Phase 1); the WhatsApp send and the reply, with the optional OTP, follow in Phase 2.
- **SAL-06 Sales orders.** Accepted quote → order; dealers may order without a quote; states draft → confirmed → partially dispatched → dispatched → invoiced → closed / cancelled; partial dispatch and backorders.
  - *AC:* every transition follows the state machine and is audited.
  - *AC:* an order from a quote copies its prices and tax snapshot; a dealer order without a quote takes its prices from the Price Master for the dealer's tier.
  - *AC:* confirming runs the credit check (SAL-07) and wins the lead; cancelling is limited to the General Manager and the Executive.
  - *AC:* the dispatch states and backorders work with the stock ledger (Phase 3); invoiced and closed work with the Tally link (Phase 5).
- **SAL-07 Dealer credit control.** Block when outstanding + order exceeds the limit or any invoice is overdue beyond credit days; audited Executive release.
  - *AC:* the block reason names the invoice or the limit.
  - *AC:* limits and credit days are the workshop values (SALE-4), and a dealer with no limit set is held; outstanding is entered by Accounts with its as-of date until the Tally sync (Phase 5); confirmed unpaid orders count toward the limit unless workshop SALE-5 says otherwise.
  - *AC:* only an Executive releases a block, with a reason, and the release is audited.

### 4.4 Inventory, procurement and logistics (INV)
- **INV-01 Item master** with SKU, specs, DCR/ALMM flag, HSN, unit, serial tracking, pump curves.
  - *AC:* an item has a unique SKU, a category with its own specifications, an HSN of 4, 6 or 8 digits, a unit, a serial-tracking flag and the DCR flag with its ALMM reference.
  - *AC:* a pump curve is a set of points whose head falls as flow rises; one that does not is refused.
  - *AC:* a catalogue change is made only in the All companies view.
- **INV-02 Stock ledger.** Append-only movements with reason codes; balances per warehouse and bin; the BOS is the stock authority.
  - *AC:* a movement is never edited or deleted; a correction is a new movement with its reason code.
  - *AC:* the balance per warehouse and bin equals the sum of its movements.
  - *AC:* the physical stock audit at both sites reconciles with the ledger (the Phase 3 exit gate).
- **INV-03 Kits and availability-to-promise.** Deterministic, tested; reservations against order lines, released on cancellation or expiry.
  - *AC:* a kit's availability comes from a pure, tested function of its components' free stock and quantities.
  - *AC:* a reservation holds stock for an order line and is released when the order is cancelled or the reservation expires; how long it holds is the workshop value (STOCK-4).
- **INV-04 Procurement.** Vendor master, quote comparison, PO drafting from reorder alerts, goods receipt with serial capture by camera or scanner. Supplier rates visible only with `procurement.rate.read`.
  - *AC:* a person or agent without `procurement.rate.read` sees no supplier rate or PO value in any screen, export or API answer.
  - *AC:* a reorder alert drafts a PO that a person approves; a goods receipt of a serial-tracked item requires every serial.
- **INV-05 Dispatch.** Split dispatch, delivery challans, vehicle and driver, in-transit status, "materials arrived" with photo. **E-way bill gate:** a dispatch above the threshold cannot leave "ready" without an e-way bill number, validity and vehicle.
  - *AC:* the gate is enforced in the state machine; validity expiry in transit raises an alert.
  - *AC:* the threshold is ₹50,000 and configurable (workshop STOCK-3 confirms it).
- **INV-06 Surplus pool** for leftovers, suggested for reuse.
  - *AC:* leftover material logged from the field enters the pool at zero value and is suggested when a later order needs the same item.
- **INV-07 Labels.** QR/barcode labels for serials, bins and packages, printed from the shared templates.
  - *AC:* a printed QR label scans back to its payload on the phones and scanners staff use, on the label printer and stock the supplier names.
- **INV-08 Warranty claims and supplier returns** following the five-step flow in blueprint §8.4 with the cost impact recorded in job costing.
  - *AC:* a claim follows the `warranty-claim` state machine from raised to closed, through the replacement issued from stock and the supplier RMA.
  - *AC:* the replacement's cost appears on the project's job cost.

### 4.5 Projects, EPC and subsidy (PRJ)
- **PRJ-01 Standard install flow** with a configurable milestone checklist editable by Executives.
  - *AC:* the default steps are survey, dispatch, install, commission and handover (workshop PROJ-2 confirms them); an Executive changes them without code changes.
- **PRJ-02 PM Surya Ghar flow** with the gate sequence in blueprint §8.5 and a state machine per gate, including sanctioned-load lock, DCR/ALMM serial validation before dispatch and rejection loops.
  - *AC:* a dispatch to a subsidy project with a serial that is not DCR-valid is refused.
  - *AC:* the sanctioned load locks when feasibility is approved; a rejected gate returns for resubmission with its reason.
- **PRJ-03 Document vault.** Requirement templates, completeness gates, generated DISCOM packs.
  - *AC:* a gate cannot close with a missing required document; the required documents are the workshop value (PROJ-1).
  - *AC:* a DISCOM pack is generated from the project's records with no field typed again.
- **PRJ-04 Scheduling board.** Day/week calendar by engineer or crew, map, drag-and-drop with conflict detection (double booking, leave, travel time), unassigned queue, Orchestrator suggestions confirmed by a person, automatic WhatsApp confirmation and day-before reminder.
  - *AC:* a drop that double-books, falls on leave or leaves less than the travel time between visits (the workshop value, PROJ-4) is flagged before it is saved.
  - *AC:* an Orchestrator suggestion changes nothing until a person confirms it; a confirmed visit sends the customer a confirmation and a reminder the day before.
- **PRJ-05 Labour and contractor cost lines** on the project.
  - *AC:* each labour or contractor charge is a cost line on the project, visible only with `finance.cost.read`, and counts in job costing (FIN-05).
- **PRJ-06 Handover kit** on WhatsApp; warranty registered per serial.
  - *AC:* at handover the customer receives the kit on WhatsApp, and each installed serial has its warranty start date.
- **PRJ-07 CMC register** with yearly GM reminder and status report.
  - *AC:* each PM Surya Ghar installation has a CMC start and end; the GM is reminded each year, and the status report lists every installation by CMC state.

### 4.6 Customer WhatsApp communication (WA)
- **WA-01 Milestone templates** in English for quote sent, order confirmed, dispatched, visit booked, installed, payment due with UPI, handover.
  - *AC:* each milestone sends its approved template once, in English, from the selling company's number; a template not yet approved is held, not sent.
- **WA-02 Document collection.** Requests for missing documents; incoming files malware-scanned, masked, classified and filed against the right requirement; low-confidence classifications confirmed by a person.
  - *AC:* a file is only ever filed against the sending customer.
  - *AC:* no Aadhaar number survives in storage, logs or any model call; only the last four digits and the masked copy are kept.
  - *AC:* a classification below the confidence threshold (the workshop value, PROJ-3) waits for a person.
- **WA-03 STATUS self-service** returning an instant order and project summary.
  - *AC:* a customer who sends STATUS receives a summary of their own orders and projects only.
- **WA-04 Channel rules.** 24-hour window, approved templates, opt-out, per-entity number, portfolio messaging-limit awareness with service messages prioritised.
  - *AC:* a session message outside the 24-hour window is refused; an opted-out customer receives nothing.
  - *AC:* near the messaging limit, service messages go first and promotional ones queue.

### 4.7 Android field app (FLD)
- **FLD-01 Offline-first** schedule, jobs, surveys, checklists, geo- and time-stamped photos, signatures, material arrival, leftovers, QC, attendance and expense capture.
  - *AC:* every listed task can be completed with no network, and each photo carries its place and time.
- **FLD-02 Sync** with server-authoritative transitions, field-level merge for surveys, idempotent stock and expense commands, a conflict review screen.
  - *AC:* a device offline for 5 days (proposed in ADR 0012; the workshop value, PROJ-4, confirms it) syncs without data loss or duplicate movements.
  - *AC:* a transition the server refuses shows on the conflict review screen; a survey edited on two devices merges field by field.
- **FLD-03 Background uploads** with compression, FCM push, maps navigation, minimum-version gate.
  - *AC:* an app below the minimum version blocks new work and asks for the update; sync answers that the app must be updated.

### 4.8 Finance and job costing (FIN)
- **FIN-01 Proformas and challans** per entity with financial-year numbering from templates; payment milestones with optional loan gates.
  - *AC:* numbers are per company and financial year with no gaps, in the workshop format (SALE-1); a loan-gated milestone waits for the loan state (CRM-08).
- **FIN-02 Tally connector** per blueprint §8.8: AlterID reads, GUID idempotency, daily snapshot with tombstones, heartbeat, self-update, purchase vouchers restricted.
  - *AC:* a voucher sent twice is applied once; a voucher deleted in Tally becomes a tombstone that reverses its effects and appears in the review queue.
  - *AC:* 30 minutes without a heartbeat raises an alert; after a simulated 3-day outage (the test ADR 0013 proposes) the connector catches up (the Phase 5 exit gate).
  - *AC:* purchase vouchers are readable only with `procurement.rate.read`.
- **FIN-03 Reconciliation** by Buyer Order No., then GSTIN or phone; review queue; receipts update milestones; credit notes adjust balances; dealer outstanding refreshed; tombstones reverse effects.
  - *AC:* a voucher whose Buyer Order No. matches a proforma or order number links to it; failing that, a unique GSTIN or phone match; otherwise it waits in the review queue.
  - *AC:* one full month reconciles with Tally for all four companies (the Phase 5 exit gate).
- **FIN-04 Collections.** WhatsApp reminders with UPI link or QR; ageing per entity.
  - *AC:* a payment milestone past due sends its reminder with the UPI link or QR; the ageing view buckets outstanding per company.
- **FIN-05 Job costing.** Material at moving-average cost, labour, approved expenses, warranty replacements, other direct costs vs Tally-linked revenue; budget vs actual; margin by project, segment, entity and engineer; visible only with `finance.cost.read`.
  - *AC:* a project's cost is the sum of its material at moving-average cost, labour, approved expenses, warranty replacements and other direct costs, from a pure tested roll-up.
  - *AC:* no cost or margin figure reaches a person or agent without `finance.cost.read`.
- **FIN-06 Stock valuation reconciliation** with Tally closing stock monthly.
  - *AC:* each month Accounts sees the BOS valuation beside Tally's closing stock per company, with the difference.
- **FIN-07 Expenses.** Claims with receipts, categories, policy limits, manager → Accounts approval, project or overhead allocation, monthly export.
  - *AC:* a line over its policy limit (the workshop value, HR-3) is flagged; a claim is paid only after the manager's and Accounts' approval; the monthly export lists every approved claim once.

### 4.9 HR (HR)
- **HR-01** Employee directory; office attendance by geofence and selfie; field check-in; shifts; regularisation.
  - *AC:* a check-in outside the geofence (its radius is the workshop value, HR-1) is recorded with its distance and marked for review; a regularisation request changes attendance only once approved.
- **HR-02** Leave types, balances, approvals, holiday calendar.
  - *AC:* an approved leave reduces its balance, and only an approver named in the policy approves it; the types, balances, approvers and calendar are the workshop value (HR-2).
- **HR-03** Incentive engine tied to targets; accruals released on confirmed events; covers staff and referral partners.
  - *AC:* an accrual is released only on its confirming event (such as a Tally receipt); the rules are the workshop value (HR-3).
- **HR-04** Monthly salary, incentive and reimbursement export for the CA.
  - *AC:* the export for a month lists each employee once with salary inputs, released incentives and approved reimbursements.

### 4.10 Dashboards, reports, search, notifications (RPT)
- **RPT-01** Role home pages as in blueprint §8.10; the Executive page shows margins only through report queries under the viewer's permissions.
  - *AC:* each role's home shows its own cards: callers their queue and targets, the Sales Team Lead the team's progress and queues, the GM SLAs and pipeline, Accounts dealer credit, the Executive pipeline, quotes and orders.
  - *AC:* a margin figure appears only for a viewer with `finance.cost.read`, from a report run under that viewer's permissions; no agent narrative contains one.
- **RPT-02** Report library with audited, permission-gated exports.
  - *AC:* every export writes an audit row with the report, its filters and the row count; an export is refused without the report's permission.
- **RPT-03** ⌘K search across phone, name, village, document numbers and serials, tolerant of spelling variants of Indian names.
  - *AC:* search starts at two characters; from three letters it also matches spelling variants of names and villages; digits match phone numbers, and no phone number is shown in the results.
  - *AC:* results hold only records the caller may read; lead search answers within 300 ms p95 at 50,000 leads (`docs/04-architecture-appendix/lists.md`).
  - *AC:* quote and order numbers are found once they exist (Phase 1), serials once the stock ledger exists (Phase 3).
- **RPT-04** Notification centre, browser push and FCM with preferences and quiet hours; SLA breaches escalate to the GM.
  - *AC:* an assignment, a due callback, an expiring quote, a blocked order or a duplicate found notifies the person who acts on it; nothing is pushed in their quiet hours.
  - *AC:* a first-contact SLA breach escalates to the GM; a lead refused because a colleague looks after its customer reaches that colleague.
  - *AC:* the centre refreshes at least every 15 seconds while its tab is visible.
- **RPT-05 Activity log.** The screen of the audit trail: who changed what and when, from which address and device, for every command, sign-in event and event type.
  - *AC:* only a holder of `audit.read` opens it, and it lists entries only for the companies the viewer works in, filtered by time window, person, action and record.
  - *AC:* each entry names the action and the changed fields in words, with phone numbers and emails shortened and identity numbers removed; refused and failed attempts are listed too.

### 4.11 Migration and imports (IMP)
- **IMP-01** Import framework: upload → mapping templates → validation preview → dedupe suggestions → chunked commit → batch rollback.
  - *AC:* 50k rows in < 5 min; a failed batch leaves no partial data.
  - *AC:* the preview lists every row's problems before anything is committed, and a mapping can be saved and reused.
  - *AC:* imports of customers and PIN codes join imports of leads (Phase 1).
- **IMP-02** Cutover runbook with staging dry run, count reconciliation, cutover weekend and a parallel run of 1–2 weeks.
  - *AC:* each import job has a reconciliation report: rows in, created, attached, skipped and refused, by reason.
  - *AC:* the dry run on staging and the cutover reconcile their counts; the parallel run lasts two weeks with the legacy sheets (the Phase 1 exit gate).

### 4.12 AI (AI)
- **AI-01 Knowledge Brain.** Vault with sensitivity tags, embeddings with RLS, Playbook directives approved by Executives, extraction per input type.
  - *AC:* only `knowledge.vault.write` uploads; a file is tagged `exec_only`, `management` or `staff_ai_ok`, and retrieval returns only chunks the caller's role and company may read (proved per role in the security suite).
  - *AC:* PDFs (masked page by page first) and masked photos are read by Claude, Word and Excel files are parsed on the server (Phase 1), audio by the speech vendor (Phase 2).
  - *AC:* a Playbook directive takes effect only after an Executive approves it, and a conflict with an existing directive is flagged (Phase 2).
- **AI-02 Ask the Business** and voice Ask run as the user with citations.
  - *AC:* each answer cites its sources; a question asked by a user without a permission gets no data that permission guards.
- **AI-03 Live voice** Teach, Ask and Command with barge-in, captions, push-to-talk and text fallback; p50 latency < 1.5 s; consent and spend caps.
  - *AC:* p50 latency < 1.5 s; speech-to-text accuracy on real samples meets a target set from the voice spike before Phase 2 starts.
  - *AC:* a session starts only after recording consent and stops at the user's minute and spend cap; a dropped network falls back to push-to-talk or text.
- **AI-04 Agents.** Six agents with autonomy per action type, Agent Inbox, traces, kill switches, budgets, rollout via shadow → approval → automatic.
  - *AC:* a suggestion appears in the Agent Inbox and changes nothing until a person approves it; a kill switch (global, per agent, per company) stops the agent's next action.
  - *AC:* an agent stops at its daily spend cap; every run keeps its trace.
  - *AC:* an action type reaches Automatic only at ≥ 95% unedited over ≥ 200 cases, with Executive sign-off.
- **AI-05 Guardrails.** Untrusted-input labelling, narrow Concierge tools, deterministic output filters, PII masking, no cost access, injection test set passing.
  - *AC:* no agent principal holds a cost or supplier-rate permission, and every agent is refused tax, price and catalogue changes (the agent refusal sweep).
  - *AC:* the prompt-injection set fails safely in every case; model calls carry no unmasked identity number.
- **AI-06 Disclosure.** The Concierge introduces itself as an AI and offers a human on request.
  - *AC:* the first reply of every conversation says it is an AI; a request for a person hands the thread to staff.

## 5. Non-functional requirements
Each requirement states what holds across the product, then its acceptance criteria, as in §4. §8 traces each one.

- **NFR-01 Performance.** p95 interaction < 300 ms; ingestion → assignment < 10 s; WhatsApp first response < 60 s; 50k-row import < 5 min; low-end Android over 3G/4G within the JavaScript budget per route (BLUEPRINT §6.4).
  - *AC:* every list and search a slice adds answers within 300 ms p95 at its spike volume, with the plan recorded: in the spike notes of `docs/04-architecture-appendix/`, or for a slice with no note of its own in its run file (the plans of the quote list and search, from `pnpm --filter @shakti/domain spike:quotes`, are in [s1-quotes.md](runs/phase1/s1-quotes.md); the catalogue grid's are printed by `spike:catalogue`).
  - *AC:* each staff page's first-load JavaScript stays within its budget in `apps/web/js-budget.json`, checked in CI.
  - *AC:* the delivery check on Integration health shows the time from a change to its worker, the measure the 10-second handover rests on.
- **NFR-02 Scale.** 100+ users; 2,000+ leads/day (BLUEPRINT §1).
  - *AC:* a load test at 10k leads/day and 100 concurrent users meets NFR-01 (BLUEPRINT §17; the Phase 7 exit gate).
- **NFR-03 Availability.** 99.5% in business hours (8 AM–10 PM IST); RPO ≤ 5 min; RTO ≤ 4 h; Sunday-night maintenance windows (BLUEPRINT §12).
  - *AC:* the health and readiness checks answer for monitoring on every environment.
  - *AC:* a restore drill meets the RPO and RTO (the Phase 7 exit gate).
- **NFR-04 Security.** As in `docs/07-security.md`: RLS fail-closed, two cost permissions, 2FA for Executive, GM and Accounts, audit of every mutation, and the permission matrix an Executive edits (BLUEPRINT §7.1).
  - *AC:* the security suite proves, for every table and in CI, that a request with no company sees nothing and each role reads only its own scope in each company.
  - *AC:* an Executive, GM or Accounts user cannot reach any screen until an authenticator app is enrolled; every command writes its audit row.
  - *AC:* an Executive changes a staff role's permissions only within the holder rules (an agent role is never editable, the Executive keeps the admin grants), and every holder of the changed role is signed out.
- **NFR-05 Privacy.** DPDP Act 2023 and Rules 2025; Aadhaar never stored; masking before model calls; retention schedule in BLUEPRINT §7.9.
  - *AC:* no identity number reaches storage, logs, the audit trail, error reports or a model call; each retention job records its run.
- **NFR-06 Telecom.** DLT registration; 140/160-series numbers; TRAI hours; DND; WhatsApp policy.
  - *AC:* as TEL-04 and WA-04.
- **NFR-07 Tax.** Effective-dated GST rates; place-of-supply split; solar 70:30 composite supply; rupee rounding; e-way bill gate.
  - *AC:* as SAL-02 and INV-05.
- **NFR-08 Localisation.** English UI, messages, emails and documents; Roman-script Hinglish for caller scripts, voice agent speech and training videos, chosen per customer for calls (`docs/08-design-system.md` §11.5); lakh/crore, DD-MM-YYYY, IST.
  - *AC:* the copy lint refuses any Devanagari character; amounts show Indian grouping, dates DD-MM-YYYY and times IST on every screen and document.
- **NFR-09 Product copy.** Plain language for non-technical users, in English on every screen and document; no technical words, codes or internal names shown to users; no placeholder, sample or dummy text anywhere a user can see; every string final and product-specific (`docs/08-design-system.md` §11).
  - *AC:* the copy lint passes in CI; the copy review in UAT is signed per role.
- **NFR-10 Accessibility and themes.** WCAG AA in both themes; keyboard-first caller screens; each person chooses System, Light or Dark and a higher-contrast variant.
  - *AC:* the axe checks find no WCAG 2.1 AA violation on any journey, in light and dark.
  - *AC:* a person's theme and higher-contrast choice is kept on their profile and follows them to every device.
- **NFR-11 Offline.** The field app is fully usable offline for at least 5 days (proposed in ADR 0012; the workshop value, PROJ-4, confirms it).
  - *AC:* as FLD-01 and FLD-02.
- **NFR-12 Observability.** Sentry, structured logs without personal data, the Integration health page, spend dashboards.
  - *AC:* server and browser errors reach Sentry with personal data removed; a dead-lettered event or repeated publisher failures alert the owner.
  - *AC:* Integration health shows waiting and held-back events by type, with Send again for a held-back one; AI spend per agent joins it with the Triage agent.
- **NFR-13 Ownership.** All vendor accounts owned by the client; ADRs, runbooks and an onboarding guide.
  - *AC:* every service account is held in the client's name with the development team as members before go-live (the production readiness slice, G1).

## 6. Release plan
Delivered in Phases 0–7 as in `docs/03-roadmap.md`. The MVP is Phases 0–1, delivered by the slices of `docs/03-roadmap-appendix/phase1.md`. It covers exactly these parts:

| Requirement | In the MVP | Later |
|---|---|---|
| CRM-01 | Manual entry, the walk-in form, imports and referral codes | Lead Ads, WhatsApp inbound and Exotel IVR and missed calls (Phase 2), with the website forms |
| CRM-02 to CRM-07, CRM-10 | All, with consent enforced on calls logged by hand | Consent enforced on dialling and messaging (Phase 2) |
| CRM-08 | — | Customer loans (Phase 4) |
| CRM-09 | Codes, attribution and accrual on a confirmed order | Release on payment (Phase 5) |
| TEL-01 | All, with manual call logging and the number shown to dial | Click-to-dial (Phase 2) |
| TEL-02, TEL-06 | All | — |
| TEL-03 | Board, sizing, quote builder and next-best-action | WhatsApp thread and Co-pilot (Phase 2) |
| TEL-04, TEL-05 | — | With Exotel (Phase 2); the dial rules are written and tested as pure functions |
| SAL-01, SAL-02, SAL-03, SAL-07 | All, with dealer outstanding entered by hand | Outstanding from the Tally sync (Phase 5) |
| SAL-04 | Sizing, pump-curve bounds, sanctioned-load and DCR rules | Stock availability (Phase 3) |
| SAL-05 | The branded PDF and acceptance by a signed copy | WhatsApp dispatch and acceptance (Phase 2) |
| SAL-06 | Draft, confirmed and cancelled orders, from quotes and for dealers | Dispatch states and backorders (Phase 3); invoiced and closed (Phase 5) |
| INV-01 | The minimal catalogue: items, HSN, kits sold as bundles, pump curves | The full catalogue (Phase 3) |
| RPT-01 | Home pages for callers, the Sales Team Lead, the GM, Accounts and the Executive | Inventory home and margins (Phases 3 and 5) |
| RPT-03 | Phone, name, village, quote and order numbers | Serials (Phase 3) |
| RPT-04 | Notification centre, browser push, preferences, quiet hours, SLA escalation | FCM on the field app (Phase 4) |
| IMP-01, IMP-02 | All | — |
| AI-01 | Vault uploads, extraction of documents and embeddings | Audio, Playbook directive review (Phase 2) |
| AI-04 | Agent runtime, Agent Inbox and the Triage agent in shadow | Concierge and Co-pilot (Phase 2), the other agents and promotions (Phase 6) |
| AI-05 | The guardrails the Triage agent needs | The Concierge's tools and filters (Phase 2) |

Every other requirement is outside the MVP; §8 gives its phase.

## 7. Discovery workshop inputs
The questions are in `docs/13-client-packs/workshop-pack.md`, with the ones that block the next slices first. Inputs: pipeline stages, required fields, dispositions and scripts per segment; tier assignment rules, per-entity pricing, kit pricing, HSN and tax per item; dealer terms; incentive, target, expense and attendance policies; Tally companies, version, Buyer Order No. usage, stock and e-way bill practice; the existing CRM's export format; call volumes and caller headcount; WhatsApp and calling numbers per entity and DLT status; numbering formats, letterheads, bank/UPI details; required documents per project type and gate; loan partners.

## 8. Traceability
Each requirement, the phase and slice that deliver it (slice codes in `docs/03-roadmap-appendix/phase1.md` §3), and where it is tested today. Paths are test files in the repository; a requirement with no test yet is marked "—". Whether a slice is built is in [STATUS](10-status.md).

| ID | Phase | Slice | Tested in |
|---|---|---|---|
| CRM-01 | 0, 1, 2 | C3 (walk-in form and referral codes; manual entry and lead imports built in Phase 0) | `packages/domain/tests/commands/create-lead.test.ts`, `packages/domain/tests/commands/imports.test.ts`, `packages/domain/tests/commands/crm-scoring-referrals.test.ts` (a lead made with a referral code), `apps/web/src/screens/walk-in.test.ts`, `apps/web/e2e/leads.spec.ts`, `apps/web/e2e/walk-in.spec.ts`, `apps/web/e2e/imports.spec.ts`; ingest contract `packages/contracts/src/api/ingest.test.ts` |
| CRM-02 | 1 | P2b | `packages/contracts/src/crm/phone.test.ts`, `packages/contracts/src/crm/phone.property.test.ts`; the PIN code master and the site's PIN: `packages/db/tests/security/pin-codes.test.ts`, `packages/domain/tests/commands/import-kinds.test.ts`, `apps/web/e2e/imports.spec.ts` |
| CRM-03 | 1 | D1 | The cards, repeat enquiries and merges: `packages/domain/tests/commands/duplicates.test.ts`, `packages/domain/src/crm/duplicate-confidence.test.ts`, `packages/db/tests/security/duplicates.test.ts`, `apps/web/tests/duplicate-actions.test.ts`, `apps/web/tests/duplicate-scan.test.ts`, `apps/web/e2e/duplicates.spec.ts`; the colleague's-customer guard: `packages/domain/tests/commands/lead-guard.test.ts`, `packages/db/tests/security/lead-guard.test.ts` |
| CRM-04 | 1 | C2 | `packages/db/tests/security/crm-scope.test.ts`, `packages/db/tests/security/customer-read-through-leads.test.ts`, `packages/domain/tests/commands/customer-edits.test.ts`, `packages/domain/tests/queries/customers.test.ts` |
| CRM-05 | 1 | C3 | Pipelines, stages and exit rules: `packages/domain/tests/commands/crm-pipelines.test.ts`, `packages/db/tests/security/crm-config.test.ts`, `apps/web/src/screens/pipeline-settings.test.ts`, `apps/web/e2e/pipelines.spec.ts`; stage moves: `packages/domain/tests/commands/opportunity.test.ts`, `packages/domain/tests/queries/lead-board.test.ts` |
| CRM-06 | 1 | C3 | `packages/domain/src/crm/score.test.ts`, `packages/domain/tests/commands/crm-scoring-referrals.test.ts`, `packages/db/tests/security/crm-config.test.ts`; the nightly rescoring `apps/web/tests/lead-rescore.test.ts` |
| CRM-07 | 1 | C2 | `packages/domain/tests/queries/customers.test.ts`, `packages/domain/tests/commands/timeline.test.ts`, `apps/web/e2e/customers.spec.ts`; timing `pnpm --filter @shakti/domain spike:account360` (`docs/04-architecture-appendix/account360.md`) |
| CRM-08 | 4 | — | State machine: `packages/domain/src/state-machines/machines.test.ts` |
| CRM-09 | 1, 5 | C3, S2 | The accrual by its rule, its rule bases and its cancel: `packages/domain/src/sales/commission.test.ts`, `packages/domain/tests/commands/orders.test.ts` |
| CRM-10 | 1, 2 | C2 | `packages/domain/tests/commands/consent.test.ts`, `apps/web/e2e/customers.spec.ts` |
| TEL-01 | 1 | T1 | `packages/domain/tests/commands/calls.test.ts`, `packages/domain/tests/queries/call-queue.test.ts`, `packages/db/tests/security/calls.test.ts`, `apps/web/e2e/calling.spec.ts` |
| TEL-02 | 1 | T2 | The handover request and the lock cases of `crm.opportunity.assign`: `packages/domain/tests/commands/opportunity.test.ts`; the `assign` lock cases: `packages/domain/src/state-machines/machines.test.ts` |
| TEL-03 | 1, 2 | L1 | — |
| TEL-04 | 2 | — | `packages/domain/src/telecom/dial-policy.test.ts`, `apps/web/src/integrations/exotel/exotel.test.ts` |
| TEL-05 | 2 | — | — |
| TEL-06 | 1 | R1 | — |
| SAL-01 | 1 | C1 | `packages/domain/tests/commands/set-price.test.ts`, `packages/domain/tests/commands/price-lists.test.ts`, `packages/db/tests/security/catalogue-scope.test.ts`, `apps/web/e2e/price-master.spec.ts` |
| SAL-02 | 1 | C1 | `packages/domain/src/tax/tax.test.ts`, `packages/domain/src/tax/golden.test.ts`, `packages/domain/tests/commands/tax.test.ts`, `apps/web/e2e/catalogue.spec.ts` |
| SAL-03 | 1 | S1 | Quote machine: `packages/domain/src/state-machines/machines/quote.test.ts`; numbering `packages/domain/tests/numbering/next-document-no.test.ts`; prices from the list and a price in the input refused: `packages/domain/tests/commands/quotes.test.ts`, `packages/domain/src/sales/quote-pricing.test.ts`; policies `packages/db/tests/security/quotes.test.ts`; journey `apps/web/e2e/quotes.spec.ts` |
| SAL-04 | 1, 3 | C4, S1 | Sizing facts `packages/domain/src/sizing/quote-facts.test.ts`; a quote refused for missing or out-of-bounds sizing, the pump curve or the DCR and sanctioned-load rules: `packages/domain/tests/commands/quotes.test.ts` |
| SAL-05 | 1, 2 | P4, S1, S2 | Print templates: `apps/web/src/print/templates.test.ts`; a quote printed, recorded and attached: `apps/web/tests/pdf-render.test.ts`; sent only with its PDF: `packages/domain/tests/commands/quotes.test.ts`; the quotation of a real quote and a quote sent with its PDF: `apps/web/e2e/print.spec.ts`, `apps/web/e2e/quotes.spec.ts`; acceptance by a signed copy: `packages/domain/tests/commands/orders.test.ts`, `apps/web/e2e/orders.spec.ts` |
| SAL-06 | 1, 3, 5 | S2 | State machine: `packages/domain/src/state-machines/machines.test.ts`; orders from a quote and for dealers, confirm, cancel: `packages/domain/tests/commands/orders.test.ts`, `packages/db/tests/security/sales-orders.test.ts`; journeys: `apps/web/e2e/orders.spec.ts` |
| SAL-07 | 1, 5 | S2 | `packages/domain/src/sales/credit-check.test.ts`; the hold, the release and the exposure: `packages/domain/tests/commands/orders.test.ts`; journeys: `apps/web/e2e/orders.spec.ts` |
| INV-01 | 1, 3 | C1 | `packages/domain/tests/commands/catalogue.test.ts`, `packages/domain/tests/queries/catalogue-queries.test.ts`, `packages/domain/tests/queries/list-items.test.ts`, `apps/web/e2e/catalogue.spec.ts` |
| INV-02, INV-03, INV-04, INV-06 | 3 | — | Cost and rate gates: `packages/db/tests/security/cost-permissions.test.ts` |
| INV-05 | 3 | — | Dispatch machine: `packages/domain/src/state-machines/machines.test.ts` |
| INV-07 | 3 | — | `apps/web/src/print/templates.test.ts`; `pnpm spike:print` |
| INV-08 | 3 | — | Warranty-claim machine: `packages/domain/src/state-machines/machines.test.ts` |
| PRJ-01, PRJ-02, PRJ-03 | 4 | — | Project and subsidy-gate machines: `packages/domain/src/state-machines/machines.test.ts` |
| PRJ-04 to PRJ-07 | 4 | — | — |
| WA-01, WA-03, WA-04 | 2 | — | `apps/web/src/integrations/whatsapp/whatsapp.test.ts`, `packages/contracts/src/api/webhooks.test.ts` |
| WA-02 | 4 | — | Masking: `apps/web/src/workers/ocr/plan-masks.test.ts`, `apps/web/src/workers/ocr/qr-cover.test.ts`, `packages/domain/src/privacy/identity-numbers.test.ts` |
| FLD-01 to FLD-03 | 4 | — | Contracts: `packages/contracts/src/api/sync.test.ts`, `packages/contracts/src/api/field.test.ts`, `packages/contracts/src/api/mobile-auth.test.ts` |
| FIN-01 | 5 | — | Numbering: `packages/domain/tests/numbering/next-document-no.test.ts` |
| FIN-02, FIN-03 | 5 | — | `apps/web/src/integrations/tally/tally.test.ts`, `packages/contracts/src/api/connector.test.ts` |
| FIN-04 to FIN-06 | 5 | — | Cost gate: `packages/db/tests/security/cost-permissions.test.ts` |
| FIN-07 | 5 | — | Expense-claim machine: `packages/domain/src/state-machines/machines.test.ts` |
| HR-01 to HR-04 | 5 | — | — |
| RPT-01 | 1, 5 | R1 | — |
| RPT-02 | With each module's reports | — | — (no export exists) |
| RPT-03 | 0, 1, 3 | S1 | `packages/domain/tests/queries/search.test.ts`, `packages/domain/tests/queries/search-equivalence.test.ts`, `packages/db/tests/security/lead-search-candidates.test.ts`; quote numbers `packages/domain/tests/commands/quotes.test.ts`, `packages/db/tests/security/quotes.test.ts`, `apps/web/e2e/quotes.spec.ts`; timing `pnpm spike:lists`, `pnpm --filter @shakti/domain spike:quotes` |
| RPT-04 | 1, 4 | N1 | — |
| RPT-05 | 0, 1 | — | `packages/domain/tests/queries/query-audit.test.ts`, `apps/web/e2e/admin.spec.ts` |
| IMP-01 | 0, 1 | P2b | `packages/domain/tests/commands/imports.test.ts`, `packages/domain/tests/commands/import-lead-parity.test.ts`, `packages/db/tests/security/imports.test.ts`, `apps/web/tests/imports.test.ts`, `apps/web/e2e/imports.spec.ts`; timing `pnpm spike:import` |
| IMP-02 | 1 | M1 | — |
| AI-01 | 1, 2 | P2, K1 | Upload purposes: `packages/db/tests/security/files.test.ts` |
| AI-02 | 2 | — | — |
| AI-03 | 2, 6 | — | — (harness only: `apps/web/src/integrations/voice/voice.test.ts`) |
| AI-04 | 1, 2, 6 | AI0, A1 | `packages/domain/tests/commands/agents.test.ts`, `packages/domain/tests/commands/agent-runtime.test.ts`, `packages/db/tests/security/agents.test.ts`, `packages/domain/src/ai/provider.test.ts`, `apps/web/e2e/agents.spec.ts` |
| AI-05 | 1, 2 | A1 | `packages/domain/tests/security/agent-refusals.test.ts`, `packages/domain/src/privacy/identity-numbers.test.ts` |
| AI-06 | 2 | — | — |
| NFR-01 | 0, 1 | P3, P1, P2b | `apps/web/scripts/js-budget.test.ts` with `pnpm --filter web js-budget`; `packages/domain/tests/commands/run-probe.test.ts` (the delivery check); timings `pnpm spike:lists`, `pnpm --filter @shakti/domain spike:account360`, `pnpm spike:import` |
| NFR-02 | 7 | — | — |
| NFR-03 | 0, 7 | G1 | `apps/web/tests/ready.test.ts` |
| NFR-04 | 0, 1 | X1 | `packages/db/tests/security/role-entity-matrix.test.ts` and the rest of `packages/db/tests/security/`; `packages/db/tests/security/role-editor.test.ts`, `packages/domain/tests/commands/admin-roles.test.ts`, `apps/web/e2e/roles.spec.ts` |
| NFR-05 | 0, 1 | P1 | `packages/domain/src/privacy/identity-numbers.test.ts`, `apps/web/src/observability/sentry-scrub.test.ts` |
| NFR-06 | 2 | — | As TEL-04 and WA-04 |
| NFR-07 | 0, 1, 3 | C1 | As SAL-02 and INV-05 |
| NFR-08, NFR-09 | 0 | — | `tools/copy-lint/src/rules.test.ts` with `pnpm copy-lint` |
| NFR-10 | 0, 1 | P3 | The axe checks in every `apps/web/e2e/*.spec.ts`; `packages/domain/tests/commands/set-theme.test.ts`, `packages/domain/tests/commands/set-contrast.test.ts`, `apps/web/e2e/profile.spec.ts` |
| NFR-11 | 4 | — | Contracts: `packages/contracts/src/api/sync.test.ts` |
| NFR-12 | 1 | P1 | `apps/web/src/observability/sentry-scrub.test.ts`, `apps/web/src/observability/alerts.test.ts`, `apps/web/tests/integration-health.test.ts`, `apps/web/e2e/integrations.spec.ts` |
| NFR-13 | 1 | G1 | — |
