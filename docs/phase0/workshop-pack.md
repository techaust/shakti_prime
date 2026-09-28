# Discovery workshop pack — Shakti Prime BOS

Date: 27-09-2026. For: the Shakti group owners, the sales head, Accounts and the group's CA. Prepared by the development team.

This pack lists every question the system needs the group to answer before or during Phase 1, in one place. Each question says why it matters, the choices, what the system does today until you decide, and who should answer. Part A lists what is already decided, so everyone sees the full picture. Part B is the open questions, grouped by area of the business. Part C is a record sheet for the answers.

**How to use it:** read Part A before the workshop and tell us if anything there is wrong. In the workshop, go through Part B in order; for each question pick an option or write your own. Where the answer needs data (a price list, a document list, a policy), bring the file or send it within a week.

**Who answers:**
- **Owner:** an Executive of the group, for business rules and approvals.
- **Sales head:** for pipelines, calling, scripts and targets.
- **Accounts:** for invoices, credit, Tally and document numbers.
- **CA:** for GST, record keeping and retention.
- **Project manager** and **HR admin:** for their own areas where named.

---

## Part A — Decisions already taken

These are settled. They are listed so the group can see them; each can still be changed, and the note says how much work a change would be. Built today: A1.1 to A1.5 (the call language is stored on each contact; the scripts and voice it steers come in Phases 1 and 2), A2.1, A2.2, A2.4 (in the assistants' permissions; the first assistant, lead sorting, starts in Phase 1) and A2.5, and in A2.3 the fixed set of roles and the updates that keep an edited role's changes (the screen where an Executive edits a role is not built yet). In A3, the mandatory authenticator app is built, the price lists and tiers are built, and the masking of card photos is built while the document store that keeps them arrives with projects in Phase 4; the quote validity and re-quote, the credit release and a repeat enquiry joining the open lead are settled but arrive with quotes, orders and duplicate checks in Phase 1; Tally is read by the connector in Phase 5.

### A1. Taken by the group on 27-09-2026
| # | Decision | What it means day to day |
|---|---|---|
| A1.1 | **One customer record for the whole group.** A customer who buys from two companies is one record, with a separate relationship and owner in each company. | A farmer who bought a pump from Shakti Motor Pumps and asks Agro Solar Hub about solar appears once, with both histories on one page. Each company's team sees the customer only through its own relationship. |
| A1.2 | **"All companies" view uses the narrowest role.** A person who holds different roles in different companies sees, in the "All companies" view, only what every one of those roles allows. | To use a wider role in one company, switch to that company in the top bar. |
| A1.3 | **Who may run imports.** Executives in all companies; the General Manager in the companies where they hold that role. | Other roles cannot upload lead or customer files. |
| A1.4 | **English on every screen; Hinglish only where people speak to customers.** Screens, messages, emails and documents are in English. Caller scripts, the voice assistant's speech and training videos are in Hinglish written in Roman letters. | Each customer has a call language: Hinglish (default) or English. It changes only the caller script and the voice assistant, never screens or documents. |
| A1.5 | **Design direction.** A calm, dense design in the style of Linear, with one indigo accent colour, light and dark themes, and the Inter typeface. | The design is shown for sign-off in `design-signoff.md`. |

### A2. Taken by the development team, open to the group's review
These were needed to finish the security work. Each is a small change if the group prefers otherwise.

| # | Decision | Alternative if the group prefers |
|---|---|---|
| A2.1 | **A customer looked after by a colleague is routed to that colleague.** If a tele-caller tries to create a lead for a customer another caller in the same company already looks after, the system stops and asks them to have their team lead pass the enquiry to the colleague who owns the relationship. | The lead owner could see the customer, or the relationship could move with the lead. |
| A2.2 | **One owner contact per customer.** A farm or household has exactly one owner contact; family members are added as "family" contacts. | Allow two owner contacts (for example husband and wife). This can create duplicate leads. |
| A2.3 | **Roles are fixed; their permissions are editable.** The eleven roles stay; an Executive can change what each role may do, and an edited role keeps its changes after every update. | Allow new custom roles. |
| A2.4 | **AI assistants for lead sorting and caller help work without customer names and phone numbers.** | Let them see names and phones, which makes their suggestions easier to read but widens who sees personal data. |
| A2.5 | **Sign-in lockout.** Repeated wrong passwords lock that person on that network address, with growing delays; the account owner gets an email on every tenth failure. A stranger cannot lock an Executive out from another place. | Lock the whole account after repeated failures, which is stricter but lets anyone lock out a known person. |

### A3. From the approved blueprint
- **Fixed prices from the Price Master, with no discounts anywhere.** Prices come from tiers (Retail, Dealer, Commercial); a quote cannot change a price.
- **A quote is valid for 15 days.** After that it can be re-quoted at current prices in one click.
- **Tally stays the statutory ledger and is only read.** The system never writes to Tally.
- **The authenticator app is mandatory** for Executives, the General Manager and Accounts.
- **Aadhaar numbers are never stored.** Only the last four digits and a masked copy of the card are kept.
- **Only an Executive can release a dealer order held for credit**, and every release is recorded.
- **A repeat enquiry for the same need within 30 days joins the open lead** instead of creating a new one.

---

## Part B — Open questions

Numbering: the letters say the area (CRM for leads and customers, CALL for tele-calling, PRICE for pricing and tax, SALE for quotes, orders and credit, STOCK, PROJ, FIN, HR, LAW for privacy and telecom law, ACC for accounts and ownership).

### B1. Leads and customers (CRM)

**CRM-1 · Pipeline stages per segment** — Sales head, Owner
- *Context:* each segment (Farmer Pumps, Residential Rooftop, Commercial EPC, Dealer and Wholesale) has its own pipeline. Stages drive the board, reports and targets.
- *Options:* keep the same six stages for all four; or give each segment its own stages (for example "Site survey booked" for rooftop, "Sample order" for dealers).
- *Today:* all four pipelines have New, Contacted, Qualified, Quoted, Won and Lost. Executives can change stages later from Admin.
- *Bring:* the stages each team uses today, in order.

**CRM-2 · Required details before a lead can move stage** — Sales head
- *Context:* a lead can be stopped from moving forward until key details are filled in, for example the village and pump depth before "Qualified".
- *Options:* list the required details per stage and segment; or keep it open and rely on managers.
- *Today:* no stage requires any detail.
- *Bring:* per segment, the details a caller must have before Qualified, before Quoted and before Won.

**CRM-3 · Lead priority rules** — Sales head
- *Context:* the calling queue is ordered by a lead score, callbacks due and response time. The score starts from simple rules.
- *Options:* weight by source (for example walk-in and missed call first), by segment, by district, by pump size or system size, by age of the lead.
- *Today:* not set.

**CRM-4 · The current CRM and sheets** — Sales head
- *Context:* the move from the current CRM and sheets needs to know what they hold and in what format.
- *Needed:* the current CRM's name, an export file of a few hundred rows (any fields), and the list of sheets in use.

**CRM-5 · Referral partner commissions** — Owner
- *Context:* referral partners get a code; leads with the code are credited to them, and commission is recorded once the sale is confirmed.
- *Options:* a fixed amount per sale, a percentage of order value, or a rate per kW or per HP; paid on order, on payment received, or on installation.
- *Today:* partners can be recorded as a customer type; no commission rule exists.

**CRM-6 · Loan partners and banks** — Owner, Accounts
- *Context:* customer loans (bank or scheme loans, including the PM Surya Ghar loan route) are tracked from applied to sanctioned to disbursed, and can hold a payment step or a dispatch until the money arrives.
- *Needed:* the banks and loan partners in use, and whether dispatch should wait for disbursement for each.

### B2. Tele-calling (CALL)

**CALL-1 · Call outcomes (dispositions) per segment** — Sales head
- *Context:* the caller presses one number key to record how a call went. The list must be short (nine at most) and the same for every caller in a segment.
- *Options:* a common list, for example Interested, Call back later, Not reachable, Switched off, Wrong number, Not interested, Already bought, Qualified; or a list per segment.
- *Today:* none set.
- *Bring:* the outcomes callers write in the sheets today.

**CALL-2 · Call scripts** — Sales head
- *Context:* scripts are shown on the caller's screen in Hinglish (Roman letters), or English for a customer who prefers it. One opening, the qualification questions, and the answers to common objections, per segment.
- *Needed:* the scripts callers use today, or a recording of a good call per segment. The development team writes them in the agreed style for the sales head to approve, and a caller reads each one aloud before it goes live.

**CALL-3 · Retry rule for unanswered leads** — Sales head
- *Context:* an unanswered lead is dialled again automatically, then moved to nurture (a slower follow-up).
- *Options:* how many attempts (for example 3 or 5), the gap between them (same day, next day), and what happens after the last attempt.
- *Today:* not set.

**CALL-4 · Handover from cold caller to lead converter** — Sales head
- *Context:* when a cold caller marks a lead "Qualified", it goes to a lead converter by turn, weighted by who is present, their current load, their languages and segments. The lead then stays with that converter for a fixed time before it can be moved.
- *Options:* the lock period per pipeline (24 h, 48 h, 72 h); whether converters specialise by segment or by language; the maximum open leads per converter.
- *Today:* 48 hours, the same for every pipeline.

**CALL-5 · Nurture follow-up** — Sales head
- *Context:* a lead that is not ready to buy moves to nurture and is followed up on a schedule.
- *Options:* for example day 7, day 30 and day 90, by call or WhatsApp message.
- *Today:* not set.

**CALL-6 · Targets and leaderboards** — Sales head, Owner
- *Context:* each caller and team sees live progress against daily, weekly and monthly targets. The same targets later drive incentives.
- *Needed:* the measures (calls made, leads qualified, orders, kW sold) and the numbers per caller level and team.

**CALL-7 · Call volumes and team size** — Sales head
- *Context:* the running-cost estimate assumes about 45 callers making about 4,500 dial attempts a day, about 2,500 of them answered, averaging 3 minutes.
- *Needed:* today's real numbers: callers (cold and converters), dials a day, answered calls, average call length, and the number of seats needed.

### B3. Pricing and tax (PRICE)

**PRICE-1 · Price tiers and who gets which** — Owner, Sales head
- *Context:* every quote takes its prices from one tier, chosen by the customer type (household, farm, business, dealer, referral partner).
- *Options:* keep Retail, Dealer and Commercial, or add tiers (for example a large-dealer tier); map each customer type to a tier.
- *Today:* Retail, Dealer and Commercial exist; no mapping from customer type to tier is set.

**PRICE-2 · One price list for the group, or one per company** — Owner
- *Context:* a price list can be shared by all four companies or set for one company.
- *Options:* shared lists for all; per-company lists for some products; per-company lists for all.
- *Today:* a price list can be either; none is loaded.
- *Bring:* the current price lists.

**PRICE-3 · Kit prices** — Owner
- *Context:* a kit (for example a 5 HP solar pump set) is sold as one line.
- *Options:* a fixed kit price set in the Price Master; or the sum of its parts' prices.
- *Today:* kits are recorded with their parts; the pricing method is not set.

**PRICE-4 · HSN code and GST rate per item** — CA, Accounts
- *Context:* every item needs its HSN code and GST rate, with the date each rate starts. A rate change applies only to documents made on or after its date; issued quotes keep the rate they were made with.
- *Today:* no tax rates are loaded; the system will not price a line without one.
- *Bring:* the item list with HSN and current GST rate, from Tally or the CA.

**PRICE-5 · Place of supply and rounding** — CA
- *Context:* GST is split into CGST and SGST inside Rajasthan, and charged as IGST outside it. The system needs one rule for the state of supply and one rounding method.
- *Proposed method:* the state of the customer's site; if there is no site, the state in the customer's GSTIN; if neither, the company's own state. Each tax amount rounds to the paisa on every line; CGST and SGST are rounded separately; the document total rounds to the rupee with the difference shown as round-off.
- *Needed:* the CA's agreement or changes, and five to ten worked examples (real past invoices with the names removed) that the system must reproduce exactly. These become the tax engine's test cases.

**PRICE-6 · Solar composite supply (70:30)** — CA
- *Context:* solar EPC and rooftop contracts are valued as 70% goods and 30% services, each taxed at its own rate.
- *Proposed:* applied only to lines marked as works contract in the Residential Rooftop and Commercial EPC segments, with the shares and rates dated so a change applies from its date.
- *Needed:* confirmation of the shares, the rates for each part, and which products or contracts use it.

### B4. Quotes, sales orders and dealer credit (SALE)

**SALE-1 · Document number format** — Accounts, Owner
- *Context:* quotes, sales orders, proformas, challans and purchase orders are numbered per company and per financial year (for example 2026-27), with no gaps.
- *Options:* for example `ASH/Q/2026-27/0001`, `SMP-SO-26-27-0001`, or the formats used today.
- *Today:* numbering by company, document type and financial year works; the format is not set, and no document can be numbered until it is.
- *Bring:* a sample of each document as issued today.

**SALE-2 · Letterheads, logos and bank details** — Accounts
- *Needed:* for each company: the letterhead, logo (with a version for dark backgrounds), GSTIN, registered address, bank account for payments and the UPI ID. These are entered in Admin by an Executive and never stored in the code.

**SALE-3 · How a customer accepts a quote** — Owner
- *Options:* a WhatsApp reply ("YES"); a WhatsApp reply confirmed with a one-time code; a signed copy uploaded by staff. Any combination can be allowed.
- *Today:* all three are planned; the default for each segment is not set.

**SALE-4 · Dealer credit limits and days** — Accounts, Owner
- *Context:* a new dealer order is held when the dealer's outstanding plus the new order is above their limit, or when any invoice is overdue beyond their credit days.
- *Needed:* each dealer's credit limit and credit days, per company.

**SALE-5 · Do confirmed but undelivered orders count against the credit limit?** — Accounts
- *Options:* yes, count them (safer); or count only invoiced amounts.
- *Today:* yes, they count.

**SALE-6 · Dealer outstanding before the Tally link** — Accounts
- *Context:* until the Tally link is live (Phase 5), dealer outstanding is entered by hand.
- *Needed:* who enters it and how often (daily or weekly).

### B5. Stock and dispatch (STOCK) — needed before Phase 3

**STOCK-1 · Stock in Tally and valuation practice** — Accounts, CA
- *Needed:* whether stock is kept in Tally for each company, how it is valued today, and who does the month-end count.

**STOCK-2 · Negative average cost** — Accounts, CA
- *Context:* stock cost is worked out as a moving average. After a return while the stock count is below zero, the average can come out negative.
- *Options:* allow it and correct it at the next purchase; or stop the movement until stock is corrected; or hold the last positive average.
- *Today:* the cost fields accept any value, including a negative one, until this is decided.

**STOCK-3 · E-way bill practice and threshold** — Accounts
- *Context:* a dispatch above the e-way bill threshold cannot leave "ready" until the e-way bill number, validity and vehicle are entered.
- *Today:* the threshold is ₹50,000 and can be changed.
- *Needed:* confirmation of the threshold, who generates e-way bills (in Tally or on the portal), and whether e-invoicing applies to any company.

### B6. Projects and subsidy (PROJ) — needed before Phase 4

**PROJ-1 · Documents per project type and subsidy step** — Project manager
- *Needed:* for the standard install and for each PM Surya Ghar step, the list of documents the customer and the team must provide, and which are mandatory before the step can close.

**PROJ-2 · Standard install steps** — Project manager
- *Today:* survey, dispatch, install, commission, handover. Executives can change the steps later.
- *Needed:* confirmation, or the steps used today.

### B7. Finance and Tally (FIN) — the Tally visit is needed in Phase 0

**FIN-1 · Tally set-up** — Accounts
- *Needed:* the Tally companies for each of the four companies, the Tally version, whether the "Buyer Order No." field is filled today, and a time for the Tally discovery visit.

**FIN-2 · Record retention periods** — CA
- *Proposed (from the blueprint):* financial records, proformas, sales orders and audit records 8 years; customer identity copies and subsidy documents the life of the project plus 8 years; call recordings 12 months (the written summary is kept); WhatsApp media 3 years; leads with no sale 24 months after the last contact, then anonymised; field photos the life of the project plus 5 years.
- *Needed:* the CA's confirmation or changes.

### B8. People (HR) — needed before Phase 5

**HR-1 · Attendance rules** — HR admin
- *Needed:* office hours and shifts per site, the office geofence radius, late and half-day rules, and how field staff mark attendance.

**HR-2 · Leave and holidays** — HR admin
- *Needed:* leave types with yearly balances, who approves, and the holiday calendar for 2026-27.

**HR-3 · Incentives and expenses** — Owner, HR admin, Accounts
- *Needed:* the incentive rules per role (and for referral partners), and the expense policy: categories, daily limits, who approves, and the monthly reimbursement date.

### B9. Privacy, consent and telecom law (LAW)

**LAW-1 · Which consent a caller may record** — Owner, with legal advice
- *Context:* consent decides which number a lead may be called from (service numbers only with recorded consent) and is the evidence under the data protection law and the telecom registration. Once recorded, a consent cannot be edited; it can only be withdrawn.
- *Options:*
  1. Callers may record consent from a signed walk-in form and from a spoken "yes" on a recorded call, each tied to the exact consent wording shown or read.
  2. Callers may record only the signed walk-in form; spoken consent is not accepted.
  3. Callers record no consent; only web forms, WhatsApp opt-in and imports with evidence count.
- *Also needed:* whether each version of the consent wording must be stored and linked to every consent (recommended).
- *Today:* any of the five sources (web form, WhatsApp opt-in, walk-in form, spoken, import) can be recorded when a lead is created; after that, only a withdrawal can change it.

**LAW-2 · Consent per company or for the whole group** — Owner, with legal advice
- *Context:* a customer who agreed to hear from Agro Solar Hub may or may not have agreed to hear from Shakti Motor Pumps. The telecom registration and the data protection law look at each company separately.
- *Options:* consent per company; or one consent for the group, with the privacy notice naming all four companies.
- *Today:* one consent for the group.

**LAW-3 · Privacy notice, consent wording and call-recording notice** — Owner, with legal advice
- *Needed:* approved texts for the four company websites, the walk-in form, WhatsApp opt-in and the call-recording notice, covering AI processing by overseas providers. Due before Phase 1 go-live.

**LAW-4 · Telecom registration and numbers** — Owner
- *Needed:* the WhatsApp and calling numbers in use for each company, and the status of each company's registration on the telecom consent platform (DLT). Registration of all four companies and the promotional (140-series) and service (160-series) numbers should start now; they are needed in Phase 2.

**LAW-5 · Voice samples** — Owner
- *Needed:* 20 to 30 short recordings of Executives speaking as they would to the assistant, in Hindi, Hinglish and English, for the speech test in Phase 0.

### B10. Accounts and ownership (ACC)

**ACC-1 · Authenticator app for a General Manager of one small company** — Owner
- *Context:* the authenticator app is mandatory for the General Manager role.
- *Options:* mandatory whenever a person holds the GM role in any company; or only when they hold it in more than one company.
- *Today:* mandatory in every case.

**ACC-2 · Service accounts in the group's name** — Owner
- *Context:* every service account (domain, hosting, database, file storage, messaging, calling, AI, app store, code repository) must be registered to the group, with the development team as members, so the group owns its system.
- *Needed:* who in the group holds these accounts, the company card or billing account for them, and a decision on the code repository plan: move it to a group organisation on a plan that can enforce review rules before changes reach the live system. The vendor list is in `vendor-quotes.md`.

---

## Part C — Answer record

Fill one row per question during the workshop. Items marked "bring" can be sent within a week.

| Question | Decision | Decided by | Date | Data to follow (who, by when) |
|---|---|---|---|---|
| CRM-1 | | | | |
| CRM-2 | | | | |
| CRM-3 | | | | |
| CRM-4 | | | | |
| CRM-5 | | | | |
| CRM-6 | | | | |
| CALL-1 | | | | |
| CALL-2 | | | | |
| CALL-3 | | | | |
| CALL-4 | | | | |
| CALL-5 | | | | |
| CALL-6 | | | | |
| CALL-7 | | | | |
| PRICE-1 | | | | |
| PRICE-2 | | | | |
| PRICE-3 | | | | |
| PRICE-4 | | | | |
| PRICE-5 | | | | |
| PRICE-6 | | | | |
| SALE-1 | | | | |
| SALE-2 | | | | |
| SALE-3 | | | | |
| SALE-4 | | | | |
| SALE-5 | | | | |
| SALE-6 | | | | |
| STOCK-1 | | | | |
| STOCK-2 | | | | |
| STOCK-3 | | | | |
| PROJ-1 | | | | |
| PROJ-2 | | | | |
| FIN-1 | | | | |
| FIN-2 | | | | |
| HR-1 | | | | |
| HR-2 | | | | |
| HR-3 | | | | |
| LAW-1 | | | | |
| LAW-2 | | | | |
| LAW-3 | | | | |
| LAW-4 | | | | |
| LAW-5 | | | | |
| ACC-1 | | | | |
| ACC-2 | | | | |
| Part A changes, if any | | | | |

**Where each question comes from** (for the development team): CRM-1 to CRM-6, CALL-1 to CALL-7, PRICE-1 to PRICE-4, SALE-2 to SALE-4, SALE-6, STOCK-1, STOCK-3, PROJ-1, FIN-1, HR-1 to HR-3 and LAW-4 are the discovery inputs of BLUEPRINT §19 and PRD §7; PRICE-5 and SALE-5 are design §12 items 1 and 3, CALL-4 and CALL-5 item 2, ACC-1 item 4, SALE-1 item 5 with DATABASE §9; LAW-1 and STOCK-2 are AUDIT §7 items 6 and 7; LAW-2 is review 3; PRICE-6 is ADR 0007; FIN-2 is BLUEPRINT §7.9; LAW-3, LAW-5 and ACC-2 are ROADMAP §10; Part A1 is the design document header, ADR 0008 and ADR 0014; Part A2 is AUDIT §8.
