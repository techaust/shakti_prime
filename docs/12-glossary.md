# Glossary — Shakti Prime BOS

The words the documents, the code and the group use, each in one or two plain sentences. `docs/01-blueprint.md` governs on any conflict; where a term names something in the code, the code's name is given in backticks. Business terms marked *to confirm* are written from general knowledge, with the blueprint section that uses them; the group confirms or corrects them in the workshop (workshop TERM-1).

**Contents:** [Business terms](#business-terms) · [Product terms](#product-terms) · [How the work is run](#how-the-work-is-run) · [Roles](#roles) · [People](#people) · [Phase and slice codes](#phase-and-slice-codes) · [Requirement and question IDs](#requirement-and-question-ids)

## Business terms
| Term | Meaning |
|---|---|
| ALMM | The government's Approved List of Models and Manufacturers for solar modules; an item records its ALMM reference (`items.almm_ref`). *To confirm* (BLUEPRINT §6.3, §8.5). |
| Buyer Order No. | A field on a Tally voucher. Accounts fills it with the BOS proforma or sales order number, so the connector can match the voucher to its order (BLUEPRINT §8.8). |
| CC and LC callers | The two kinds of tele-caller. A Cold Calling (CC) caller works the calling queue and qualifies leads; a Lead Conversion (LC) caller takes qualified leads to a sale: WhatsApp, sizing, quotes and orders. |
| Challan | A delivery challan: the document that travels with goods sent without a tax invoice, for example to a project site. |
| CMC | Comprehensive Maintenance Contract: the maintenance contract recorded for each PM Surya Ghar installation, with its start and end dates; the CMC register reminds the General Manager each year. *To confirm* (BLUEPRINT §8.5). |
| Composite supply (70:30) | Solar EPC and rooftop contracts are valued as 70% goods and 30% services, each taxed at its own GST rate. The system applies it to works-contract lines in the Residential Rooftop and Commercial EPC segments, with dated shares and rates (ADR 0007). |
| DBT | Direct Benefit Transfer: the PM Surya Ghar subsidy paid into the customer's bank account, tracked as the last step of the subsidy flow. *To confirm* (BLUEPRINT §8.5). |
| DCR | Domestic Content Requirement: solar modules with Indian-made cells, which the PM Surya Ghar subsidy requires. An item carries a DCR flag (`items.is_dcr`), and a subsidy dispatch checks its serials. *To confirm* (BLUEPRINT §8.3, §8.5). |
| Dealer credit | Each dealer's credit limit and credit days, per company. A dealer order is held when outstanding plus the order passes the limit, or an invoice is overdue beyond the credit days; only an Executive releases it. |
| DISCOM | The electricity distribution company. DISCOM packs are the documents a rooftop project files with it. *To confirm* (BLUEPRINT §8.5). |
| Disposition | The outcome of a call (for example "call back later" or "wrong number"), recorded with one number key. The list per segment is a workshop answer (workshop CALL-1). |
| DLT, 140 and 160 series | DLT is the registration platform the telecom regulator requires for business calls and messages. Promotional calls go out from 140-series numbers; service calls from 160-series numbers, and only to people with recorded consent. |
| DND | The national Do Not Disturb register. A promotional call to a number on it is refused. *To confirm* (BLUEPRINT §7.7). |
| EPC | Engineering, Procurement and Construction: a turnkey project where the seller designs, supplies and installs the system. Commercial EPC is one of the four segments. |
| E-way bill | The GST document for moving goods above a value threshold (₹50,000, configurable). A dispatch above it cannot leave "ready" without the e-way bill number, validity and vehicle. |
| Financial year | April to March, written as 2026-27. Quotes, orders, proformas and challans are numbered per company and financial year, with no gaps. |
| GSTIN | The 15-character GST registration number of a business. Each company has its own; a business customer may have one, and its state code can decide the place of supply. |
| GST, CGST, SGST, IGST | Goods and Services Tax. A sale within Rajasthan is taxed as CGST plus SGST; a sale to another state as IGST, decided by the place of supply. |
| Golden set | Five to ten real past invoices, names removed, that the CA confirms and the tax engine must reproduce exactly (workshop PRICE-5, ADR 0007). |
| HSN | The Harmonised System of Nomenclature code that classifies goods for GST. Each item has one of 4, 6 or 8 digits; GST rates are set per HSN. |
| Hinglish | Hindi and English mixed, written in Roman letters. Used only where people speak to customers: caller scripts, the voice assistant's speech and training videos; every screen and document is in English (ADR 0014). |
| JIR | The joint inspection after net metering in the PM Surya Ghar flow, the step before the subsidy is paid. *To confirm* (BLUEPRINT §8.5). |
| K-number | The consumer number on a Rajasthan electricity bill, asked for when qualifying a rooftop lead. *To confirm* (BLUEPRINT §9.3). |
| Kit | A bundle of items sold as one line, for example a solar pump set (`kits`, `kit_components`). Whether its price is fixed or the sum of its parts is a workshop answer (workshop PRICE-3). |
| Lakh, crore | Indian number units: one lakh is 1,00,000 and one crore is 1,00,00,000. Amounts are shown this way. |
| Nurture | The slower follow-up for a lead that is not ready to buy, made of scheduled follow-up tasks. The schedule is a workshop answer (workshop CALL-5). |
| PIN | The six-digit postal code. The PIN master (`pin_codes`, built with the imports upgrade, slice P2b) resolves a PIN to its post-office localities, tehsil and district. |
| Place of supply | The state a sale is taxed in: the site's state, else the state in the customer's GSTIN, else the company's own state, until the CA confirms it (workshop PRICE-5). |
| PM Surya Ghar | The central government's rooftop solar subsidy scheme. Its projects follow a gated flow from survey to subsidy payment (BLUEPRINT §8.5). |
| Price Master tiers | The fixed price lists a quote takes its prices from: Retail, Dealer and Commercial, extensible. There are no discounts anywhere. A tier is one of these lists' kinds; which customer type gets which tier is a workshop answer (workshop PRICE-1). |
| Proforma | A proforma invoice: the BOS's payment request before the tax invoice, which Tally issues. |
| RMA | A return to the supplier under its warranty, raised after a failed unit is replaced for the customer. |
| Sanctioned load | The electrical load the DISCOM has sanctioned for a connection. A rooftop system is sized against it, and it locks when feasibility is approved. |
| Segment | One of the four lines of business, each with its own pipeline: Farmer Pumps, Residential Rooftop, Commercial EPC, Dealer and Wholesale. |
| Subsidy gate | One step of the PM Surya Ghar flow that needs its documents before it closes, with rejection and resubmission. |
| Tally voucher, GUID, AlterID | Tally records each transaction as a voucher. Its GUID never changes, so the connector applies a voucher once; its AlterID rises with every change, so the connector reads only what changed. A voucher deleted in Tally becomes a tombstone in the BOS. |
| TDH | Total Dynamic Head: the total height a pump must lift water, from the static head, the drawdown, pipe friction and fitting losses. The sizing functions compute it. |
| SLA | Service level agreement: here, the time within which a new lead must get its first call, set per pipeline; a breach is escalated to the General Manager. |
| Tehsil, taluk | The sub-district a village belongs to. The PIN master (`pin_codes`, P2b) stores it as `taluk`; screens say tehsil. |
| TRAI hours | Calls to customers are allowed only from 9 AM to 9 PM IST. |
| UPI | India's instant payment system; payment reminders carry a UPI link or QR code. |
| WhatsApp 24-hour window | A business may send a free-form message only within 24 hours of the customer's last message; outside it, only approved templates. |

## Product terms
| Term | Meaning |
|---|---|
| Account 360 | The customer page (`/customers/<customer>`): contacts, sites, leads, timeline, tasks, tags and consents on one page, with its quotes; orders, projects and payments join in their phases. |
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
| Kill switch | A setting that stops an agent: one for all agents, one per agent and one per company, the most specific applying first (`agents.killswitch.set`, Admin › Agents). |
| Knowledge Vault, Playbook | The Vault holds the files leadership uploads, tagged by sensitivity and searchable; the Playbook holds the directives drawn from them, which take effect only after an Executive approves them. |
| Lead, opportunity | A customer's enquiry in one segment, moving through its pipeline's stages. Screens say lead; the code says opportunity (`opportunities`). "Lead" also names the Sales Team Lead role and the lead engineer ([People](#people)). |
| MVP | Minimum viable product: the first version the group runs its daily work on, made of Phases 0 and 1. |
| Lock period | How long a lead stays with the converter it was handed to before another caller may take it; 48 hours until the workshop answers (workshop CALL-4). |
| Pipeline, stage, exit rule | Each segment's pipeline has ordered stages; an exit rule names the details a lead must have before it leaves a stage. |
| Principal | Whoever acts: a person, an agent or the system's own workers (`system:workers`). Every change records its principal. |
| Scope | How far a permission reaches: own (my records), team, entity (the whole company) or all (every company). |
| Shadow mode | An agent records what it would do without doing it, so its proposals can be compared with what people did. |
| Sizing | The pump or rooftop calculation a quote relies on, from pure tested functions; only a person records the sizing a quote uses. |
| UAT | User acceptance testing: people of each role check the system against a written checklist and sign it off before it goes live for them. |
| Workshop default | A value the system uses until the workshop answers its question, kept in one place in the code (`packages/domain/src/workshop-defaults.ts`). |

## How the work is run
| Term | Meaning |
|---|---|
| Baseline (screenshot) | The stored image a journey's screenshot is compared with. It is made only in the pinned Linux Playwright image, on a fresh database, so the check gives the same answer in CI (`pnpm --filter web e2e:snap`, `docs/09-testing.md` §5). |
| Brief | The written instructions for one session that builds or reviews a slice, kept with its report and review in `docs/runs/phase1/<slice>.md`. |
| Builder, reviewer | The two agents a slice goes through: the builder (`slice-builder`, on Sonnet) builds it from its run file; the reviewer (`slice-reviewer`, on Opus) reads the branch with fresh context and reports ranked findings. Neither opens a pull request or touches a hosted service (`.claude/agents/`); the effort of each follows the slice's tier ([models-and-usage](runbooks/models-and-usage.md)). |
| Dead letter | An event that could not be delivered after its attempts. It waits on Integration health until someone sends it again (`integrations.dlq.replay`). |
| Definer | A database function that runs with its owner's rights (`security definer`) to answer one narrow question the caller's own rights cannot, checking a permission itself (`docs/05-database.md`). |
| Gate item | One line of a phase's exit-gate checklist in `docs/03-roadmap.md`. A phase closes when every item is met or the owner defers it. |
| Start the day, end the day | The owner's two phrases: "start the day" opens a new lead conversation with the `start-session` skill (status, checks, the next item); "end the day" closes it with the `end-session` skill (STATUS, CHANGELOG, DECISIONS, the documents pull request). |
| Heavy-command lock | The lock `bash tools/integration/heavy.sh <command>` takes, so only one heavy command (whole-repository lint, typecheck, build, the security suite, journeys) runs at a time on the PC; a lock older than 90 minutes is cleared. |
| Idempotency key | A unique value a form or client sends with a command so that a repeat of the same call (a double click, a retry) returns the first answer instead of doing the work twice. |
| Outbox | The table (`outbox_events`) where a change records the events it causes, in the same transaction; the publisher then sends them through QStash to the workers. |
| Reader pool | The read-only database connections (role `app_reader`) that run reads under the same row rules as everything else (ADR 0018). |
| Run file | The file `docs/runs/phase1/<slice>.md` that holds one slice's brief, builder reports, review findings and integration notes, and is where its state and next step are recorded (`docs/runs/phase1/readme.md`). |
| Slice | A vertical piece of a phase, from contract and schema to screen and tests, built on its own branch and merged by one pull request (`docs/03-roadmap-appendix/phase1.md` §3). |
| Spike | A short, measured experiment that answers one technical question before the build relies on it; each has its note in `docs/04-architecture-appendix/`. |
| Standing go-ahead | The owner's standing permission for the hosted steps after a green merge: migrate dev then staging, redeploy, check health and readiness, and the few settings listed in `docs/11-decisions.md`. Anything else on a hosted service asks the owner first. |
| Wave | A tier of slices that depend only on earlier waves, so the slices of one wave can be built side by side. |
| Worktree | A second working copy of the repository (`git worktree`), where one slice is built on its own branch beside the others. |

## Roles
The roles are fixed; an Executive can change what each staff role may do (`packages/db/seeds/roles.ts`).

| Role | Kind |
|---|---|
| Executive, General Manager, Sales Team Lead, Tele-Caller (Cold Calling), Tele-Caller (Lead Conversion), Store Manager, Inventory Manager, Project Manager, Field Engineer, Accounts, HR Admin | Staff (eleven) |
| Intake & Triage agent, WhatsApp Concierge agent, Caller Co-pilot agent, Sizing & Quote agent, Project Orchestrator agent, Chief of Staff agent | Agents (`agent:triage`, `agent:concierge`, `agent:copilot`, `agent:sizing`, `agent:orchestrator`, `agent:chief`) |
| Event workers | The system's own background jobs (`system:workers`), held to an agent's customer rules |

The **Executive** is the highest authority: price changes, credit releases, role permissions and agent autonomy are theirs. The **General Manager** runs operations and sees no cost figures. The authenticator app is mandatory for the Executive, the General Manager and Accounts.

## People
| Term | Meaning |
|---|---|
| Client | The Shakti group: its four companies and the people they name. The client gives the workshop answers, signs off the design and holds the service accounts. |
| Owner | In the project's records (`docs/11-decisions.md`, `docs/10-status.md`): the person who runs this development project and takes its decisions. In the client packs, "Owner" in the "Who answers" lists means an owner (Executive) of the Shakti group. |
| Lead engineer, lead session | The engineering lead of the build: the session that plans each slice, reviews its work and merges it with `main` (`docs/runbooks/slice-integration.md`). Not a sales lead and not the Sales Team Lead. |
| Development team | The owner and the lead engineer, with the build and review sessions they run. |

"Lead" therefore has three meanings: a sales lead (a customer's enquiry), the Sales Team Lead (a role), and the lead engineer (the build's lead). Documents say which one where it could be read either way.

<a id="slice-codes"></a>

## Phase and slice codes
**Phases 0 to 7** are the delivery phases of `docs/03-roadmap.md`: 0 discovery and foundations, 1 the MVP, 2 communications and live voice, 3 inventory, 4 projects and the field app, 5 finance and HR, 6 AI autonomy, 7 hardening and rollout.

**Slices** are the vertical pieces Phase 1 is built in (`docs/03-roadmap-appendix/phase1.md` §3); the letter groups them:

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
- **PRD requirements** have two digits: PRD CRM-05 is the requirement for pipelines in `docs/02-prd.md`. Their areas are CRM, TEL, SAL, INV, PRJ, WA, FLD, FIN, HR, RPT, IMP and AI.
- **Workshop questions** have one digit: workshop CRM-5 is the question on referral commissions in `docs/13-client-packs/workshop-pack.md`. Their areas are CRM, CALL, PRICE, SALE, STOCK, PROJ, FIN, HR, LAW and ACC.

Where both could be confused, documents and code comments name the family ("PRD CRM-02", "workshop CALL-1"). The PRD's non-functional requirements are NFR-01 to NFR-13; the workshop's areas also include ENG (engineering values) and TERM (these words).

**Look-alike codes.** AI0 is a slice (agent runtime and Inbox), A1 is a slice (Triage in shadow), PRD AI-04 is a requirement (the agents), and workshop A1.1 to A1.5 are decisions in Part A of the workshop pack. They are four different things.

**Audit findings** have their own codes: C, H, M and L numbers (for example M45) are the findings of `docs/14-reviews/2026-09-audit.md`, by severity.
