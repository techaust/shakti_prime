# Glossary — Shakti Prime BOS

The words the documents, the code and the group use, each in one or two plain sentences. `docs/BLUEPRINT.md` governs on any conflict; where a term names something in the code, the code's name is given in backticks.

**Contents:** [Business terms](#business-terms) · [Product terms](#product-terms) · [Roles](#roles) · [Phase and slice codes](#slice-codes) · [Requirement and question IDs](#requirement-and-question-ids)

## Business terms
| Term | Meaning |
|---|---|
| ALMM | The government's Approved List of Models and Manufacturers for solar modules; an item records its ALMM reference (`items.almm_ref`). |
| Buyer Order No. | A field on a Tally voucher. Accounts fills it with the BOS proforma or sales order number, so the connector can match the voucher to its order (BLUEPRINT §8.8). |
| CC and LC callers | The two kinds of tele-caller. A Cold Calling (CC) caller works the calling queue and qualifies leads; a Lead Conversion (LC) caller takes qualified leads to a sale: WhatsApp, sizing, quotes and orders. |
| Challan | A delivery challan: the document that travels with goods sent without a tax invoice, for example to a project site. |
| CMC | The maintenance contract recorded for each PM Surya Ghar installation, with its start and end dates; the CMC register reminds the General Manager each year (BLUEPRINT §8.5). |
| Composite supply (70:30) | Solar EPC and rooftop contracts are valued as 70% goods and 30% services, each taxed at its own GST rate. The system applies it to works-contract lines in the Residential Rooftop and Commercial EPC segments, with dated shares and rates (ADR 0007). |
| DBT | Direct Benefit Transfer: the PM Surya Ghar subsidy paid into the customer's bank account, tracked as the last step of the subsidy flow. |
| DCR | Domestic Content Requirement: solar modules with Indian-made cells, which the PM Surya Ghar subsidy requires. An item carries a DCR flag (`items.is_dcr`), and a subsidy dispatch checks its serials. |
| Dealer credit | Each dealer's credit limit and credit days, per company. A dealer order is held when outstanding plus the order passes the limit, or an invoice is overdue beyond the credit days; only an Executive releases it. |
| DISCOM | The electricity distribution company. DISCOM packs are the documents a rooftop project files with it. |
| Disposition | The outcome of a call (for example "call back later" or "wrong number"), recorded with one number key. The list per segment is a workshop answer (workshop CALL-1). |
| DLT, 140 and 160 series | DLT is the registration platform the telecom regulator requires for business calls and messages. Promotional calls go out from 140-series numbers; service calls from 160-series numbers, and only to people with recorded consent. |
| DND | The national Do Not Disturb register. A promotional call to a number on it is refused. |
| E-way bill | The GST document for moving goods above a value threshold (₹50,000, configurable). A dispatch above it cannot leave "ready" without the e-way bill number, validity and vehicle. |
| Financial year | April to March, written as 2026-27. Quotes, orders, proformas and challans are numbered per company and financial year, with no gaps. |
| GST, CGST, SGST, IGST | Goods and Services Tax. A sale within Rajasthan is taxed as CGST plus SGST; a sale to another state as IGST, decided by the place of supply. |
| Golden set | Five to ten real past invoices, names removed, that the CA confirms and the tax engine must reproduce exactly (workshop PRICE-5, ADR 0007). |
| HSN | The Harmonised System of Nomenclature code that classifies goods for GST. Each item has one of 4, 6 or 8 digits; GST rates are set per HSN. |
| JIR | The joint inspection after net metering in the PM Surya Ghar flow, the step before the subsidy is paid. |
| K-number | The consumer number on a Rajasthan electricity bill, asked for when qualifying a rooftop lead. |
| Kit | A bundle of items sold as one line, for example a solar pump set (`kits`, `kit_components`). Whether its price is fixed or the sum of its parts is a workshop answer (workshop PRICE-3). |
| Lakh, crore | Indian number units: one lakh is 1,00,000 and one crore is 1,00,00,000. Amounts are shown this way. |
| Nurture | The slower follow-up for a lead that is not ready to buy, made of scheduled follow-up tasks. The schedule is a workshop answer (workshop CALL-5). |
| PIN | The six-digit postal code. The PIN master resolves a PIN to its post-office localities, tehsil and district. |
| Place of supply | The state a sale is taxed in: the site's state, else the state in the customer's GSTIN, else the company's own state, until the CA confirms it (workshop PRICE-5). |
| PM Surya Ghar | The central government's rooftop solar subsidy scheme. Its projects follow a gated flow from survey to subsidy payment (BLUEPRINT §8.5). |
| Price Master tiers | The fixed price lists a quote takes its prices from: Retail, Dealer and Commercial, extensible. There are no discounts anywhere. |
| Proforma | A proforma invoice: the BOS's payment request before the tax invoice, which Tally issues. |
| RMA | A return to the supplier under its warranty, raised after a failed unit is replaced for the customer. |
| Sanctioned load | The electrical load the DISCOM has sanctioned for a connection. A rooftop system is sized against it, and it locks when feasibility is approved. |
| Segment | One of the four lines of business, each with its own pipeline: Farmer Pumps, Residential Rooftop, Commercial EPC, Dealer and Wholesale. |
| Subsidy gate | One step of the PM Surya Ghar flow that needs its documents before it closes, with rejection and resubmission. |
| Tally voucher, GUID, AlterID | Tally records each transaction as a voucher. Its GUID never changes, so the connector applies a voucher once; its AlterID rises with every change, so the connector reads only what changed. A voucher deleted in Tally becomes a tombstone in the BOS. |
| TDH | Total Dynamic Head: the total height a pump must lift water, from the static head, the drawdown, pipe friction and fitting losses. The sizing functions compute it. |
| Tehsil, taluk | The sub-district a village belongs to. The PIN master stores it as `taluk`; screens say tehsil. |
| TRAI hours | Calls to customers are allowed only from 9 AM to 9 PM IST. |
| UPI | India's instant payment system; payment reminders carry a UPI link or QR code. |
| WhatsApp 24-hour window | A business may send a free-form message only within 24 hours of the customer's last message; outside it, only approved templates. |

## Product terms
| Term | Meaning |
|---|---|
| Account 360 | The customer page (`/customers/<customer>`): contacts, sites, leads, timeline, tasks, tags and consents on one page, with quotes, orders, projects and payments joining in their phases. |
| Activity log | The screen of the audit trail: who changed what and when (`/admin/activity`). |
| Agent | An AI assistant that acts as its own principal with narrow permissions, only through commands. There are six: Intake & Triage, WhatsApp Concierge, Caller Co-pilot, Sizing & Quote, Project Orchestrator and Chief of Staff. |
| Agent Inbox | Where an agent's suggestions and routed work wait for a person to approve, edit or reject (slice AI0). |
| "All companies" view | The company switcher's choice that acts for every company at once. A person sees there only what every one of their roles allows (the narrowest role wins); some changes, such as GST rates, catalogue items and role permissions, are allowed only there. |
| Autonomy levels | What an agent may do per action type: Suggest (appears in the Agent Inbox), Needs approval (runs after one tap) and Automatic (runs, then notifies). Every agent starts in shadow mode. |
| BOS | Business Operating System: Shakti Prime itself. |
| Company, entity | One of the four selling companies: Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub and RCREF. Screens say company; the code and the technical documents say entity (`entities`, `entity_id`). |
| Consent | A customer's agreement to be contacted, per channel and purpose, with its source, time and optional proof. It is never edited, only withdrawn. |
| Cost permissions | `finance.cost.read` (item costs, job costs, margins) and `procurement.rate.read` (supplier rates, PO values, purchase vouchers). No agent holds either. |
| Customer, account | One record per customer for the whole group (`accounts`), with one relationship and owner in each company that deals with them (`account_entities`, ADR 0008). |
| Integration health | The Executive's screen of messages waiting or held back between parts of the system, with Send again and the delivery check (`/admin/integrations`). |
| Knowledge Vault, Playbook | The Vault holds the files leadership uploads, tagged by sensitivity and searchable; the Playbook holds the directives drawn from them, which take effect only after an Executive approves them. |
| Lead, opportunity | A customer's enquiry in one segment, moving through its pipeline's stages. Screens say lead; the code says opportunity (`opportunities`). |
| Lock period | How long a lead stays with the converter it was handed to before another caller may take it; 48 hours until the workshop answers (workshop CALL-4). |
| Pipeline, stage, exit rule | Each segment's pipeline has ordered stages; an exit rule names the details a lead must have before it leaves a stage. |
| Principal | Whoever acts: a person, an agent or the system's own workers (`system:workers`). Every change records its principal. |
| Scope | How far a permission reaches: own (my records), team, entity (the whole company) or all (every company). |
| Shadow mode | An agent records what it would do without doing it, so its proposals can be compared with what people did. |
| Sizing | The pump or rooftop calculation a quote relies on, from pure tested functions; only a person records the sizing a quote uses. |
| Workshop default | A value the system uses until the workshop answers its question, kept in one place in the code (`packages/domain/src/workshop-defaults.ts`). |

## Roles
The roles are fixed; an Executive can change what each staff role may do (`packages/db/seeds/roles.ts`).

| Role | Kind |
|---|---|
| Executive, General Manager, Sales Team Lead, Tele-Caller (Cold Calling), Tele-Caller (Lead Conversion), Store Manager, Inventory Manager, Project Manager, Field Engineer, Accounts, HR Admin | Staff (eleven) |
| Intake & Triage agent, WhatsApp Concierge agent, Caller Co-pilot agent, Sizing & Quote agent, Project Orchestrator agent, Chief of Staff agent | Agents (`agent:triage`, `agent:concierge`, `agent:copilot`, `agent:sizing`, `agent:orchestrator`, `agent:chief`) |
| Event workers | The system's own background jobs (`system:workers`), held to an agent's customer rules |

The **Executive** is the highest authority: price changes, credit releases, role permissions and agent autonomy are theirs. The **General Manager** runs operations and sees no cost figures. The authenticator app is mandatory for the Executive, the General Manager and Accounts.

## Slice codes
**Phases 0 to 7** are the delivery phases of `docs/ROADMAP.md`: 0 discovery and foundations, 1 the MVP, 2 communications and live voice, 3 inventory, 4 projects and the field app, 5 finance and HR, 6 AI autonomy, 7 hardening and rollout.

**Slices** are the vertical pieces Phase 1 is built in (`docs/design/phase1.md` §3); the letter groups them:

| Code | Slice | Code | Slice |
|---|---|---|---|
| P1 | Observability and workers | S1 | Quotes |
| P2 | Files and storage | S2 | Orders, acceptance and credit |
| P2b | Imports upgrade | T1 | Cold Caller workspace |
| P3 | Quality harness | T2 | Handover |
| P4 | Print and letterhead | N1 | Notifications |
| C1 | Catalogue and tax | K1 | Knowledge Vault |
| C2 | Customer timeline | L1 | Lead Converter workspace |
| C3 | Pipelines, scoring and referrals | R1 | Targets and home pages |
| C4 | Sizing | A1 | Triage in shadow |
| X1 | Role permission editor | M1 | Migration and UAT packs |
| AI0 | Agent runtime and Inbox | G1 | Production readiness |
| D1 | Duplicates | | |

## Requirement and question IDs
Two families of IDs look alike:
- **PRD requirements** have two digits: PRD CRM-05 is the requirement for pipelines in `docs/PRD.md`. Their areas are CRM, TEL, SAL, INV, PRJ, WA, FLD, FIN, HR, RPT, IMP and AI.
- **Workshop questions** have one digit: workshop CRM-5 is the question on referral commissions in `docs/phase0/workshop-pack.md`. Their areas are CRM, CALL, PRICE, SALE, STOCK, PROJ, FIN, HR, LAW and ACC.

Where both could be confused, documents and code comments name the family ("PRD CRM-02", "workshop CALL-1").

**Audit findings** have their own codes: C, H, M and L numbers (for example M45) are the findings of `AUDIT.md`, by severity.
