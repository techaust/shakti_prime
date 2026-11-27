# Backend and product design: Phase 5 (Finance, costing and HR)

Date: 27-11-2026.

**Status:** approved by the owner on 27-11-2026, with every question of §2 decided as the recommended option.

**How it is built:** slice by slice in the order of §3. Each slice records what it built here in the same pull request. Progress is in [STATUS](../10-status.md).

**Governing documents:**
- BLUEPRINT §1, §4, §7.2, §8.8, §8.9, §9.3 (deterministic automations), §10, §12, §16 and §17
- ROADMAP §7
- PRD FIN-01 to FIN-07, HR-01 to HR-04, RPT-01 and RPT-02
- DATABASE §6.7 and §6.8
- API §2 and §3.5
- SECURITY §2, §3.2 and §3.4
- ADR 0013
- `docs/04-architecture-appendix/tally.md`
- the machines `tally-voucher`, `sales-order` and `expense-claim` in `docs/state-machines/`
- the workshop items FIN-1 to FIN-3, HR-1 to HR-3, SALE-2, SALE-4 to SALE-6 and STOCK-1
- [the Phase 4 design](phase4.md)

**Contents:** [1. Scope](#1-scope) · [2. Decisions for the owner](#2-decisions-for-the-owner) · [3. Slices](#3-slices) · [4. New permissions](#4-new-permissions) · [5. The money model](#5-the-money-model) · [6. Wave 1](#6-wave-1) · [7. Wave 2](#7-wave-2) · [8. Wave 3](#8-wave-3) · [9. Wave 4](#9-wave-4) · [10. Workshop defaults](#10-workshop-defaults) · [11. Final-phase verification](#11-final-phase-verification) · [12. Questions for the client](#12-questions-for-the-client-final-phase) · [13. Tests per slice](#13-tests-per-slice) · [14. Gaps and conflicts in the governing documents](#14-gaps-and-conflicts-in-the-governing-documents)

## 1. Scope
**What earlier phases left for this phase:**
- The Tally rules on the BOS side are built and tested with fixtures (`packages/domain/src/tally/sync-rules.ts`):
  - the forward-only AlterID cursor and newest-GUID-wins;
  - the snapshot diff into tombstones, with its 10 % and 20-voucher limit;
  - the heartbeat's states;
  - request signing (`apps/web/src/integrations/tally/signature.ts`);
  - payload parsing;
  - a spike reader of Tally's XML.
- The connector's contracts and endpoints are written (`packages/contracts/src/api/connector.ts`, `endpoints.ts`, all `connector_hmac`). No route, no table and no `apps/tally-connector` exist.
- The `tally-voucher` machine is specified and not in use. The sales order's `invoice` and `close` wait on a linked voucher.
- Dealer credit and the manual outstanding are built (S2: `dealer_terms`, `dealer_outstanding`, the credit check). So is `commission_accruals`, whose release on payment is this phase's.
- The stock valuation report is built (`readStockValuation`, H1).
- The proforma document type, its series code `PI` and `finance.proforma.write` exist, with no loader and no command.
- `entities.upi_id` exists. The bank details are sealed (`app.entity_bank_envelope()`). The `payment_due` milestone is listed with no values.
- Phase 4 brings:
  - attendance capture and expense claims up to `submit` (F4);
  - labour and contractor cost lines (J6);
  - customer loans with `app.order_loan_gate()` (J2);
  - projects (J1);
  - `unavailability` (J5);
  - warranty replacement costs on restricted columns (R3).

**In Phase 5:**
- **Proformas** per company with financial-year numbering on the letterhead. **Payment milestones** from templates per segment, with loan gates.
- **The Tally connector**, a Windows service reading each Tally company by AlterID:
  - local SQLite outbox, signed batches, heartbeat and daily snapshots;
  - signed self-update;
  - the BOS's routes and tables behind it;
  - purchase vouchers restricted by `procurement.rate.read`.
- **Reconciliation:**
  - Buyer Order No., then GSTIN, then phone; a review queue;
  - receipts paying milestones; credit notes adjusting balances;
  - dealer outstanding refreshed from Tally;
  - tombstones reversing their effects;
  - orders invoiced and closed through their linked vouchers.
- **Collections:** WhatsApp reminders with a UPI link or QR, and ageing per company.
- **The monthly stock valuation reconciliation** with Tally's closing stock.
- **Job costing:** material at moving average, labour and contractor lines, approved expenses, warranty replacements and other direct costs, against Tally-linked revenue. Budget against actual. Margin by project, segment, company and engineer.
- **Expenses:** the manager's and Accounts' approval, policy limits, project or overhead allocation, and the monthly reimbursement export.
- **HR:**
  - the employee directory, shifts and holidays;
  - the attendance review and regularisation;
  - leave types, balances and approvals;
  - the incentive engine tied to targets and released on confirmed events, for staff and referral partners;
  - the monthly salary, incentive and reimbursement export for the CA.

**In later phases:** the Chief of Staff's briefing over these figures (Phase 6), always from report queries under the viewer's permissions, never in an agent's narrative.

**In the final phase** (the owner's decision of 13-11-2026):
- the Tally discovery visit and a copy of a company (client-actions 20);
- the connector installed on the office PC with its key;
- each company mapped;
- the first month reconciled by Accounts for all four companies (the exit gate);
- the 3-day outage rehearsed on the real PC;
- the CA's retention periods;
- HR-1 to HR-3's rules.

## 2. Decisions for the owner
The owner decided all eleven on 27-11-2026, each the recommended option (a).

1. **The connector's runtime** (TC1). **Decided: (a).**
   - (a) *Recommended:* Node 24 packaged as a single executable, run as a Windows service by WinSW under a least-privilege local account. Its settings and key are encrypted with Windows DPAPI.
   - A CI job on `windows-latest` builds it and runs its tests. That is free while the repository is public, and it is a checks change.
   - (b) A plain Node install with a scheduled task.
2. **Signed updates** (TC4). **Decided: (a).**
   - (a) *Recommended:* each release is built by CI and signed with an Ed25519 key held as a GitHub secret. The connector verifies it against the public key it ships with before swapping, and keeps the last good version to roll back. An Authenticode certificate (about $200–400 a year) can be added later by the owner.
   - (b) Buy the certificate now.
3. **What the BOS issues** (FN1). **Decided: (a).**
   - (a) *Recommended:* proformas only. Tax invoices, receipts and credit notes stay in Tally (BLUEPRINT §1).
   - Numbering is `<company code>/PI/<financial year>/<number>`, per company and financial year with no gaps. This is the SALE-1 default shape, replaced by the answer.
4. **Payments** (TC3, FN3). **Decided: (a).**
   - (a) *Recommended:* a payment exists only from a Tally receipt voucher. A UPI link or QR in a reminder only invites payment. There is no payment gateway, and the `upi` source of `payments` stays unused.
   - (b) Record UPI payments by hand in the BOS too.
5. **Auto-linking a voucher** (TC3). **Decided: (a).**
   - (a) *Recommended:* a voucher links on its own only to a unique match: Buyer Order No. equal to a proforma or order number, else one open order of that customer by GSTIN, else by phone. A receipt also needs an amount at or below the open balance. Anything else waits in the review queue for Accounts (`finance.recon.write`).
6. **Milestone templates** (FN1). **Decided: (a).**
   - (a) *Recommended:* per company and segment, edited by an Executive and versioned like Phase 4's steps.
   - The named defaults are an advance and a balance, 50 % on confirmation and 50 % before dispatch, matching the order journey recorded on 02-11-2026.
   - A milestone may carry a loan gate read from `app.order_loan_gate()`.
7. **The attendance selfie** (HR1, F4). **Decided: (a).**
   - (a) *Recommended:* kept 90 days, never used for face matching (DPDP). Phase 4 decided it.
   - (b) No selfie, geofence only.
8. **Incentives** (HR3). **Decided: (a).**
   - (a) *Recommended:* rules as data: slabs per role and metric (R1's targets), and per referral partner. An accrual is made on the event and released only on its confirming event, such as a Tally receipt fully paying the order.
   - The engine ships with no rules until HR-3. The open ₹1 a watt commission question (checklist answers, question 5) becomes the first rule once answered.
9. **The salary export** (HR4). **Decided: (a).**
   - (a) *Recommended:* inputs only: days, leave, overtime, released incentives and approved reimbursements, per employee and month. PF, ESI, TDS and pay are the CA's.
   - The export is an `.xlsx` through the existing export path, audited.
10. **Job costing's revenue** (FN6). **Decided: (a).**
    - (a) *Recommended:* the taxable value of the Tally sales vouchers linked to the order or project, without GST. A credit note reduces it.
    - Margin shows only with `finance.cost.read`.
11. **Dealer outstanding** (TC3). **Decided: (a).**
    - (a) *Recommended:* once a company's connector has synced, Tally's ledger balance replaces the manual entry for that company. The manual command is refused there with a reason naming the sync, and stays open for a company without a connector.

## 3. Slices
| Wave | Slice | Needs | Tier | Requirements |
|---|---|---|---|---|
| 1 | FN1 Proformas and payment milestones | J2 | A | FIN-01 |
| 1 | TC1 The Tally connector | — | A | FIN-02 (reads, outbox, heartbeat, snapshot) |
| 1 | TC2 Tally ingest on the BOS | — | A | FIN-02 (routes, tables, tombstones, purchase vouchers) |
| 1 | HR1 Employees, shifts, holidays and leave | J5 | B | HR-01 (directory, shifts), HR-02 |
| 2 | TC3 Reconciliation | TC2, FN1 | A | FIN-03, FIN-01 (receipts pay milestones), SAL dealer outstanding |
| 2 | FN3 Collections | FN1 | A | FIN-04, WA-01 (`payment_due`) |
| 2 | FN4 Stock valuation reconciliation | TC2 | A | FIN-06 |
| 2 | HR2 Attendance review and regularisation | HR1, F4 | B | HR-01 |
| 3 | FN5 Expense approval and reimbursement | F4 | A | FIN-07 |
| 3 | FN6 Job costing and project profit | J6, TC3, FN5 | A | FIN-05, RPT-01 (margins) |
| 3 | HR3 Incentive engine | TC3 | A | HR-03 |
| 4 | HR4 The monthly export for the CA | HR2, HR3, FN5 | A | HR-04 |
| 4 | TC4 Self-update, Integration health and the outage test | TC1, TC2 | A | FIN-02 (self-update, alert, catch-up) |
| 4 | G5 Phase 5 exit pack | all | A | the exit gate's engineering items |

**Shared registration points** take one line each, as in Phases 3 and 4:
- the event catalogue and worker registry
- the permission catalogue and seed
- `MACHINES_IN_USE`
- `en.json` and `nav.ts`
- `turbo.json` and `.env.example`
- the testing lists and the retention list
- `WORKSHOP_DEFAULTS`
- the print registry
- the WhatsApp milestone values
- the import kinds

**Files owned where two could meet:**
- TC1 owns `apps/tally-connector`.
- TC2 owns `/api/v1/connector/tally/*` and the `tally_*` tables.
- TC3 owns `reconciliation_links`, `payments` and the review queue.
- FN1 owns `proformas`, `payment_milestones` and their templates.

## 4. New permissions
`finance.proforma.write`, `finance.payment.write`, `finance.recon.write`, `finance.cost.read`, `finance.expense.*` and `hr.*` are in the catalogue and the seed. This phase's slices are their first users. Each slice adds the SECURITY §3.2 row, the seed and the oracle case for anything new.

| Permission | Executive | GM | Accounts | HR | Others | Agents | Slice |
|---|---|---|---|---|---|---|---|
| `finance.read` (proformas, milestones, payments, ageing; no cost) | all | entity | entity | – | Sales Lead team, LC own (their orders) | – | FN1 |
| `hr.attendance.read` (a team's attendance) | all | entity | – | all | Sales Lead team, Project Mgr entity | – | HR2 |

**Platform-only grants** (ADR 0020):
- `finance.recon.match`: auto-link vouchers, apply receipts, credit notes and tombstones (TC3).
- `finance.reminders.process`: due-payment reminders (FN3).
- `hr.incentives.process`: accrue and release incentives (HR3).

**Connector principals:** each connector is a principal `connector:tally:<id>` holding nothing but its routes, mapped to the companies it serves. It reads nothing.

**Agents:** none gains a grant. No agent holds `finance.cost.read`, `procurement.rate.read` or `finance.expense.verify`. The refusal sweep covers every Phase 5 command.

## 5. The money model
- **Proformas and milestones:**
  - `proformas`: company, number, order, lines and tax snapshotted as quotes are, PDF.
  - `payment_milestone_templates` (versioned).
  - `payment_milestones`: order or project, sequence, amount, due rule, `loan_gate`, state `pending`, `due`, `part_paid`, `paid` or `waived`.
- **Tally:**
  - `tally_connectors`: id, the companies mapped (Tally company name to `entity_id`), two key hashes for rotation, version, last heartbeat.
  - `tally_cursors`: per connector and company, the AlterID accepted.
  - `tally_vouchers`: GUID unique, company, type, number, date, party, GSTIN, Buyer Order No., amounts, AlterID, state by the `tally-voucher` machine.
  - `tally_purchase_vouchers`: restricted by `procurement.rate.read`.
  - `tally_ledgers`: party balances for dealer outstanding.
  - `tally_voucher_tombstones`: append-only.
  - `tally_snapshots`: the daily GUID lists' summary.
- **Reconciliation:**
  - `reconciliation_links`: a voucher to a proforma, order or project, who or what linked it, reversible.
  - `payments`: append-only, from a receipt voucher, applied to milestones in order.
  - `unlinked_vouchers`: the review queue, a view.
- **Costs:** `job_cost_entries`, restricted by `finance.cost.read`: `type` `material`, `labour`, `expense`, `warranty` or `other`, project or order, amount, source reference.
  - Each is written by a definer from its source: a ledger issue at moving average, J6's lines, FN5's approved expenses, R3's replacements, and other direct costs entered by Accounts.
  - Never written by hand twice.
- **HR:**
  - `employees`: person or not, manager, shift, office, joining date, active.
  - `shifts`, `holidays`, `leave_types`, `leave_balances`, `leave_requests`.
  - `regularisations`.
  - `incentive_rules` and `incentive_accruals` (append-only, `released_on_event`).
  - `salary_sheets` (period, file).

## 6. Wave 1

### 6.1 FN1 Proformas and payment milestones
- **Commands:**
  - `finance.proforma.issue`: from a confirmed order, prices and the tax-rate version snapshotted from the order (never recomputed), PDF on the letterhead in the print registry.
  - `.cancel`: with a reason; the number stays used.
- **Milestones:** `finance.milestone.plan` (from the template on confirmation, or by hand) and `.waive` (Executive, with a reason).
- **Due:** a milestone becomes due by its rule, such as on confirmation or before dispatch.
- **The loan gate:** a loan-gated milestone stays pending until `app.order_loan_gate()` answers met.
- **The dispatch guard:** "before dispatch" milestones unpaid make D2's `depart` refuse with `payment_milestone_open` where the template says so. This is one guard added to the dispatch machine with its test.
- **Screens:** the order page's Payments tab (milestones, proformas, payments as they arrive); Settings › Payment terms (Executive).
- **Acceptance:** FIN-01's criteria.

### 6.2 TC1 The Tally connector
- **`apps/tally-connector`**, in Node 24 and TypeScript:
  - reads Tally's XML server (port 9000) per mapped company, using the spike reader as its start;
  - one company and one request at a time, small pages, a pause between;
  - fetches vouchers and ledgers above the cursor the BOS answers (`GET /connector/tally/cursor`);
  - writes each page to a local SQLite outbox before sending;
  - sends signed batches with an idempotency key;
  - sends a heartbeat every 5 minutes;
  - sends the daily GUID snapshot.
- **Packaging:**
  - packaged as a single executable with WinSW as a Windows service (question 1);
  - settings and its key in a DPAPI-encrypted file, written by a setup command run once by the owner;
  - logs rotated, with no voucher contents beyond ids.
- **Tests:**
  - against a Tally XML fixture server in the repository (recorded shapes from the spike and Tally's documented format);
  - the outbox surviving a kill mid-batch;
  - a resend after a lost answer applied once;
  - a 3-day outage caught up in order.
- **The Windows CI job** builds and tests it. This is a checks change (`checks-ok`).
- **Packages:** one SQLite package for Node (`node:sqlite` if stable in Node 24 at the time, else `better-sqlite3`) and WinSW's release. Each is named with its exact version for the owner's yes in the slice's brief.

### 6.3 TC2 Tally ingest on the BOS
- **Routes** under `/api/v1/connector/tally/`:
  - `cursor`, `batches`, `snapshot`, `heartbeat` and `release`, per the contracts;
  - authenticated by the connector's HMAC (two keys during rotation, 5-minute skew);
  - every write through commands run as the connector's principal.
- **Tables:** those of §5's Tally group.
- **The `tally-voucher` machine** comes into use: `ingest`, `alter` and `tombstone` here; matching in TC3.
- **The batch path:**
  - `checkBatch` and `diffSnapshot` are the rules.
  - A snapshot over the limits waits for a person (Accounts) to confirm.
  - Purchase vouchers land in the restricted table.
- **Admin › Integrations › Tally:**
  - register a connector, show its one-time key, map companies, rotate and revoke keys (`admin.integrations.write`);
  - Integration health's connector row: last heartbeat, version, lag.
- **The silence alert** at 30 minutes, once, through the jobs check and Sentry.

**Built (TC2):**
- Tables `tally_connectors`, `tally_connector_companies`, `tally_cursors`, `tally_vouchers`, `tally_purchase_vouchers`, `tally_ledgers`, `tally_snapshots`, `tally_voucher_tombstones` and `tally_refused_rows` (DATABASE §6.7), row security forced: request roles only read, a company's mirror with `finance.read`, purchase vouchers with `procurement.rate.read` as well, the connectors by an Executive (`admin.integrations.write`), never their sealed keys; every write through the definers of the TC2 migration; tombstones append-only.
- The connector principal: a `principals` row per connector in the role `system:tally_connector`, holding only the platform-only `tally.connector.sync`, built by the routes after the HMAC verified, scoped to its mapped companies; it reads no table.
- Keys made on the server and shown once, kept only sealed by the field cipher (KMS on a hosted environment, as a company's bank account is); the connector signs with the key as shown; a rotation keeps both sealed keys until the old is retired.
- Routes `cursor`, `batches`, `snapshot`, `heartbeat` and `release` (no release until TC4) under `/api/v1/connector/tally/`; the commands `tally.batch.ingest`, `tally.snapshot.record`, `tally.snapshot.confirm`, `tally.heartbeat.record`, `tally.connector.register`, `.map`, `.unmap`, `.rotate`, `.retire_key`, `.revoke` and `.record_alert`; the `tally-voucher` machine in use (`ingest`, `alter`, `tombstone`).
- Snapshots: a snapshot over `diffSnapshot`'s limits held for Accounts; one too large for a function (4.5 MB) sent in parts under one id, kept until the last and compared then, dropped a day later if incomplete; ledger balances stored with their date; GUIDs the BOS lacks and rows the connector refused kept for TC3's review queue.
- Screens: Admin › Integrations › Tally (`/admin/integrations/tally`), Tally checks for Accounts (`/tally-checks`), and the Tally section of Integration health (health, lag, records waiting and set aside); the silence and held-rows alerts in the hourly jobs check through Sentry; the journeys in `apps/web/e2e/tally.spec.ts`.
- Decisions the design left open, taken by the builder: a group company may map several Tally companies (one per financial year), a Tally company one connector; the cursor is per company and Tally name; a snapshot compares only the vouchers dated from its `fromDate`; a tombstoned voucher sent again keeps its state; the heartbeat leaves an unmapped name out; the release route sits under `connector/tally/` (the contract's endpoint names `/connector/release`, for TC4 to settle).

## 7. Wave 2

### 7.1 TC3 Reconciliation
- **Matching:** `finance.recon.match` (platform-only) runs on each ingested voucher and links by question 5.
  - A receipt creates a `payment` applied to the order's milestones in sequence.
  - A sales voucher marks the order `invoiced` (the sales-order machine's `invoice`).
  - Fully paid and invoiced orders `close`.
  - A credit note reduces the order's balance.
  - A tombstone or an altered voucher reverses its effects and returns to the queue.
- **The review queue:** `/finance/reconciliation`, the unlinked vouchers with candidates. Link and unlink go through `finance.recon.write`, audited.
- **Dealer outstanding:** dealer outstanding is refreshed from `tally_ledgers` (question 11). The credit check reads the synced figure. Accruals of `commission_accruals` are released on full payment (HR3 takes them over).
- **Acceptance:** FIN-03's criteria; FIN-02's "a voucher sent twice is applied once" and "a tombstone reverses its effects".

### 7.2 FN3 Collections
- **Reminders:** the platform-only `finance.reminders.process` sends `payment_due` reminders, each with the company's UPI intent link and a QR from `entities.upi_id`.
  - When: on the due date, after 3 days and after 7 days (named defaults).
  - Within the WhatsApp rules (template, opt-out), never twice a day.
  - The milestone gets its values and shape.
- **The ageing view:** `/finance/ageing`, outstanding per company bucketed 0–30, 31–60, 61–90 and 90+ days, per customer and dealer, with exports audited.
- **Acceptance:** FIN-04's criteria.

### 7.3 FN4 Stock valuation reconciliation
- **The monthly check:** Accounts enters Tally's closing stock value per company, or it is read from Tally's stock summary when the connector sends it. It is set beside `readStockValuation` at month end, with the difference and a note.
- **Adjustments:** they are recorded in Tally, as BLUEPRINT §8.8 says. The BOS keeps the record.
- **Access:** `finance.cost.read` only.
- **Acceptance:** FIN-06's criterion.

### 7.4 HR2 Attendance review and regularisation
- **The review:** attendance from F4's `attendance_events` per day against the shift: present, late, half day or absent by HR-1's rules (named defaults). Check-ins outside the geofence wait for review.
- **Regularisation:** a request with a reason, approved by the manager (`hr.attendance.manage` or the manager by team), changes the day only once approved (HR-01's criterion).
- **Screens:** My attendance, and Team attendance (`hr.attendance.read`).

## 8. Wave 3

### 8.1 FN5 Expense approval and reimbursement
- **The rest of the `expense-claim` machine:** `manager.approve` (team scope, never one's own), `accounts.approve` (`finance.expense.verify`, effect `cost_entry` into `job_cost_entries` for a project or into overhead), `reject` with a reason, and `reimburse` (`finance.payment.write`, effect `export_line`).
- **Policy limits:** per category and role (HR-3; none until given) set `over_limit` and show to the approver.
- **The monthly reimbursement export:** each approved claim once (FIN-07).

### 8.2 FN6 Job costing and project profit
- **The roll-up:** `rollupJobCost()` is pure and tested. It sums material at moving average (ledger issues to the project's or order's dispatches, less returns), labour and contractor lines, approved expenses, warranty replacements and other direct costs. Budget is the quote's bill of materials at cost.
- **Revenue:** per question 10.
- **Margin:** by project, segment, company and engineer, in `/finance/job-costs` and on the project page's Costs tab, with `finance.cost.read`.
- **Reports:** report queries run under the viewer's permissions, ready for the Executive home (RPT-01).
- **Acceptance:** FIN-05's criteria; no cost or margin reaches anyone without `finance.cost.read`.

### 8.3 HR3 Incentive engine
- **The rules:** `incentive_rules` as data (question 8).
- **The work:** the platform-only `hr.incentives.process` accrues on the rule's event and releases on its confirming event, such as TC3's full payment.
- **Statements:** per person and month.
- **Who sees what:** referral partners are payees by name and phone, held under the existing referral codes. A person sees their own statement. HR and the Executive see all.
- **Acceptance:** HR-03's criterion.

## 9. Wave 4

### 9.1 HR4 The monthly export for the CA
- **The sheet:** per employee and month, the days present, leave, holidays, overtime, released incentives and approved reimbursements, each once (HR-04).
- **Access:** an `.xlsx` through the audited export path, with `hr.export`.
- **Storage:** a `salary_sheets` row keeps the file.

### 9.2 TC4 Self-update, Integration health and the outage test
- **Updates:** the connector checks `GET /connector/release` daily, verifies the Ed25519 signature, swaps and keeps the last good version (question 2). CI builds and signs each connector release on a tag (a release workflow change: the owner's `checks-ok`, and the signing key as a GitHub secret, the owner's action).
- **Integration health:** the version, the last sync per company, the lag and the outbox depth.
- **The outage test:** a scripted 3-day outage against the fixture server and the local BOS. The connector catches up in order with nothing twice and nothing lost (the exit gate's second item, rehearsed now and run on the office PC in the final phase).

### 9.3 G5 Phase 5 exit pack
- **The isolation sweep:** every Phase 5 table, view, definer, route, export and event as every role, agent principal and connector principal. `procurement.rate.read` on purchase vouchers, `finance.cost.read` on costs and margins, and a connector reading nothing.
- **Runbooks:**
  - the connector silent;
  - a voucher deleted in Tally;
  - a snapshot over the limit;
  - a wrong link;
  - a key leaked;
  - the month-end valuation;
  - Tally restored from a backup, where AlterIDs go back.
- **Alerts in Sentry:** connector silence, the review queue over its age, reminders failing, and the outbox depth.
- **Measures** in a new record `finance.md` in `docs/04-architecture-appendix/`: batch ingest of 5,000 vouchers, the roll-up for 1,000 projects, and ageing at volume.
- **The final-phase checklist** of §11 in `exit-gate-actions.md`, and `currentPhase` moved by the exit gate.

## 10. Workshop defaults
- **`finance`:**
  - milestones 50 % on confirmation and 50 % before dispatch;
  - reminders on the due date, after 3 days and after 7 days;
  - ageing buckets 30, 60 and 90 days;
  - the snapshot limits of `DEFAULT_SNAPSHOT_LIMITS`;
  - silence after 30 minutes.
- **`hr`:**
  - the working day 09:30 to 18:00 with 30 minutes for lunch and 26 working days a month (HR-1's answer of 02-11-2026);
  - 10 minutes' grace;
  - half day under 4 hours;
  - leave types, balances and the holiday list empty until HR-2.
- **`expenses`:** no limits until HR-3.

## 11. Final-phase verification
| Slice | Live step | Needs |
|---|---|---|
| TC1, TC2 | The connector installed on the office PC, each Tally company mapped, the first sync | the Tally visit and data (client-actions 20), FIN-1 |
| TC3 | **One full month reconciled with Tally by Accounts for all four companies** (the exit gate) | a month of live data, Accounts |
| TC4 | The 3-day outage rehearsed on the office PC | the office PC |
| FN1, FN3 | Real proformas on each letterhead; one reminder with each company's UPI | letterheads, UPI IDs (SALE-2), approved templates |
| FN4 | The first month-end valuation set beside Tally | STOCK-1, the CA |
| HR1–HR4 | The staff list, shifts, leave, holidays and incentive rules entered; one month's export to the CA | HR-1 to HR-3 |

## 12. Questions for the client (final phase)
1. FIN-1: the Tally companies per entity, the version, and whether Buyer Order No. is filled.
2. FIN-2: the retention periods with the CA.
3. The payment terms per segment (advance, balance), and which payments must be in before dispatch.
4. SALE-2: each company's UPI ID and bank details.
5. HR-1 to HR-3: shifts, geofence, late and half-day rules, leave, holidays, incentive rules (who earns ₹1 a watt, and on what event) and the expense policy.
6. Who in Accounts works the review queue and signs off the month.

## 13. Tests per slice
Every slice gets the base of Phases 1 to 4 (§13 there). Beside it:

| Slice | Tests of its own |
|---|---|
| FN1 | Numbering with no gaps under concurrency; snapshots never recomputed; loan-gated milestones; the dispatch guard |
| TC1 | The outbox across a kill; signing; throttling; the fixture server's paging; the outage catch-up |
| TC2 | HMAC with two keys and skew; a resend applied once; the snapshot limit; purchase vouchers per role; a connector principal reading nothing |
| TC3 | Every match path and the queue; receipts across milestones; credit notes; tombstone reversal; dealer outstanding from Tally |
| FN3 | Reminders once per rule, inside the WhatsApp rules; ageing buckets |
| FN4 | Valuation against an entered figure; access by grant |
| HR1, HR2 | Shifts and lateness; regularisation only once approved; leave balances and approvers |
| FN5 | The approval chain, never one's own; over-limit flags; each claim once in the export |
| FN6 | The roll-up's property test against hand sums; margin by grant only |
| HR3 | Accrual and release on events; statements per person |
| HR4 | Each employee once; each claim and incentive once |
| TC4 | The signature refusal of a tampered release; rollback |
| G5 | The isolation sweep |

## 14. Gaps and conflicts in the governing documents
- **Connector tables:** DATABASE §6.7 names no table for the connector, its keys or its cursors. TC2 adds `tally_connectors`, `tally_cursors` and `tally_snapshots`.
- **Credit notes and the valuation check:** no table is planned for either. Credit notes are `tally_vouchers` of their type with their effects in `reconciliation_links`. FN4 adds `stock_valuation_checks`.
- **`payments.source`:** the planned `upi` value has no writer under question 4 (a).
- **The order journey:** the 02-11-2026 answers name an advance and a final payment, which question 6's default follows. The CA and Accounts confirm the terms.
- **Leave and the board:** Phase 4's `unavailability` gets approved leave from HR1.
