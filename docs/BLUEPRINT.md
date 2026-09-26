# Shakti Prime BOS — Master Architecture & Product Blueprint

## 0. Context
The Shakti group has four companies (Shakti Supreme, Shakti Motor Pumps, Agro Solar Hub, RCREF). They sell solar and pump products under separate brands and GSTINs, and share one team based in Jaipur. Operations are currently spread across Excel/Sheets, a CRM, Tally and manual entry.

Shakti Prime is a single **Business Operating System** on `shaktiprime.com` that runs the business end to end: lead → sale → fulfilment → installation → cash. **AI agents run the lead lifecycle on autopilot**, and leadership shapes their behaviour by teaching the AI through uploads and live voice conversation.

This document is the architecture and product blueprint. Implementation begins after approval, starting with Phase 0.

## 1. Key decisions
| Area | Decision |
|---|---|
| MVP | CRM + tele-calling + quotes + sales orders + Knowledge Vault uploads |
| Delivery | Quality first; each phase is gated by acceptance criteria |
| Hosting | Supabase Postgres (Mumbai) + Vercel (functions in `bom1`, Mumbai); AWS S3 (ap-south-1) |
| Scale | 100+ users, 2,000+ leads/day, 2 physical sites (Jaipur godown/office + EPC factory) |
| Segments | Farmers (solar/AC pumps), residential rooftop (PM Surya Ghar), commercial/industrial EPC, dealers/wholesale |
| Entities | Shared staff across all four companies; every record is tagged to its selling entity |
| UI | One unified Shakti Prime interface; the entity name, logo and letterhead appear on customer documents |
| Devices | Responsive web app for all roles (desktop, Android, iOS browsers); native Android app for field staff |
| Pricing | Fixed prices from Price Master **tiers** (Retail, Dealer, Commercial); no discounting |
| Accounting | Tally is the statutory ledger; the BOS handles operational finance, proforma and job costing, and reconciles with Tally |
| HR | Attendance, leave, incentives/commissions, expenses; salary sheet exported for the CA |
| Access | No bypass or backdoor access of any kind; Executives are the highest authority |
| AI | Haiku 4.5 / Sonnet 5 routing (lowest cost that meets quality); Executive Knowledge Brain; 6 agents with a 3-level autonomy control; customer-facing WhatsApp AI with disclosure and human handoff; live voice conversation ("Talk to Shakti") |
| Alerts | In-app notification centre + browser push; FCM push on the Android app |
| Migration | From Excel/Sheets, the existing CRM, Tally masters and manual entry, through a reusable import framework |
| Channels | One Meta business portfolio with one WhatsApp number per entity; DLT-registered 140-series (promotional) and 160-series (service) calling numbers per entity on one Exotel account |
| Stock | The BOS is the operational stock authority; Tally holds statutory stock valuation and is reconciled monthly |
| Tax | A deterministic tax engine with effective-dated GST rates, place-of-supply split and the solar 70:30 composite-supply valuation; every line snapshots the rate version used |
| Identity documents | Aadhaar numbers are never stored; only the last four digits and a masked copy are kept |
| Estimates | Effort figures include a 20% contingency; cost figures are confirmed by vendor quotes in Phase 0 |

## 2. Feature scope
**Lead sources:**
- Meta/Google Lead Ads, website enquiry forms, WhatsApp inbound, Exotel IVR and missed calls;
- walk-in quick form, referral partners with commissions;
- CSV/Excel import, manual entry.

**CRM:** smart duplicate detection, lead scoring and priority, customer loan tracking, multi-site customer profiles.

**Tele-calling:** automatic CC → LC handover, click-to-dial with recording, call scripts with automatic re-attempts, targets and leaderboards.

**Sales:** price tiers, tax engine (effective-dated GST, composite-supply split), WhatsApp quote dispatch and acceptance, sales orders, dealer credit control.

**Inventory and procurement:**
- solar kits with availability, serial tracking, rack/bin locations, leftover/surplus pool;
- vendor quote comparison, purchase orders and goods receipt;
- dispatch with challans, e-way bill gate and in-transit tracking, warranty claims and supplier returns;
- barcode/QR scanning, label printing, reorder alerts, stock adjustments with reasons.

**Projects:**
- PM Surya Ghar subsidy workflow, standard install flow;
- document vault with completeness gates, DISCOM document generation;
- field scheduling board, CMC register.

**Android field app:** offline surveys with geo-tagged photos, material arrival and leftover logging, field attendance, expense capture.

**Customer communication on WhatsApp:** milestone updates, visit confirmations and reminders, payment reminders with UPI, handover kit, document collection, "STATUS" self-service.

**Finance:** proforma invoices and challans, payment milestones, Tally sync and reconciliation, job costing and project profit.

**HR:** office attendance, leave management, incentive engine, expense claims.

**Reports:** Executive P&L, ad ROI and source attribution, role dashboards, report library with exports.

**Platform:** public Shakti Prime website (the four entity websites post enquiries through the signed ingest API), Hindi/English interface, ⌘K global search, in-app help and training videos.

**AI:**
- Intake & Triage, WhatsApp Concierge, Caller Co-pilot, Sizing & Quote, Project Orchestrator, Chief of Staff;
- call transcription, Agent Inbox with autonomy control;
- Knowledge Vault, Business Playbook, Ask the Business, staff knowledge search;
- live voice Teach, Ask and Command modes.

**Outside the system's scope:**
- manufacturing;
- dealer and customer self-service portals;
- marketing automation, fleet management, tender management;
- AI outbound voice calling;
- contractor work-order management;
- service ticketing, CMC visit scheduling;
- creating CRM leads from Tally.

## 3. Guiding principles
1. **Deterministic core, AI at the edges.** State machines, prices and calculations live in code. AI acts only through validated domain commands.
2. **One command layer.** UI, agents, voice, integrations and imports all call the same typed commands. There are no side doors to the database.
3. **Security in the database.** RLS for entity scope. Sensitive financial data sits in separate permission-gated tables, and the browser never receives data its role can't see.
4. **Append-only where money or stock moves:** stock ledger, payments, audit, price history.
5. **Everything is an event.** An outbox table feeds workflows, agents, notifications and analytics.
6. **Low-ops for a small team.** Managed services, a minimal vendor set, one language (TypeScript), strong automated tests.
7. **Role-shaped UX.** Each role lands in a workspace built for its job.

## 4. System architecture
```
 Browsers (all roles)          Android Field App (Expo)
        │ HTTPS                        │ HTTPS + offline sync
        ▼                              ▼
 ┌───────────── Vercel (bom1): Next.js App Router ──────────────────────────────┐
 │ (public) site │ (bos) app │ /api/v1 (mobile, webhooks, ingest)               │
 │            Server Actions / Route Handlers → Domain Command Layer              │
 └──────┬────────────────────────────┬──────────────────────────────────────────┘
        │ Drizzle (txn + set_config)  │ publish
        ▼                             ▼
 Supabase Postgres (RLS, pgvector,  Upstash QStash + Workflow ─► Workers: PDFs, imports,
 partitions, outbox, pg_cron)       Upstash Redis (locks,        agents, STT, embeddings,
        │ Realtime broadcast         rate limits, round-robin)    reminders
        ▼                                                          ▼
 Live in-app updates                          Claude API · Voyage embeddings · Speech vendor

 Live voice: Browser/App ⇄ WebRTC ⇄ LiveKit Cloud ⇄ Voice Agent worker (LiveKit Cloud Agents hosting) ⇄ BOS command API (as the user)
 External: Meta WhatsApp Cloud API · Meta/Google Lead Ads · Exotel · AWS S3 (KMS) · FCM / Web Push · Amazon SES
 On-prem: Tally Prime ◄─ Tally Connector (Windows service) ─► signed ingest API (outbound only)
```

## 5. Technology stack
| Layer | Choice |
|---|---|
| Monorepo | pnpm + Turborepo: `apps/web`, `apps/field` (Expo), `apps/tally-connector`, `apps/voice-agent`, `packages/domain` (commands, state machines, calculators, tax engine), `packages/db` (Drizzle schema, migrations, RLS SQL), `packages/ui` (web components), `packages/tokens` (design tokens shared by web and Android), `packages/contracts` (shared Zod API schemas) |
| Web | Next.js (latest stable), React 19, TypeScript strict; Vercel region `bom1` |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide, TanStack Table, React Hook Form + Zod, dnd-kit, Recharts, cmdk (⌘K), next-intl (English/Hindi), next-themes, calendar/scheduler component + MapLibre |
| Android app | Expo (React Native) with a development build, NativeWind styled from `packages/tokens`, WatermelonDB on expo-sqlite as the offline store, background S3 uploads, FCM, minimum-version update gate |
| Database | Supabase Postgres 16+: RLS, pgvector, pg_trgm, native monthly partitions, pg_cron |
| ORM / migrations | Drizzle ORM + drizzle-kit; RLS policies as versioned SQL migrations; expand/contract strategy |
| Auth | Better Auth: Argon2id, DB sessions, TOTP 2FA for Executive/GM/Accounts, Cloudflare Turnstile, Redis rate limits |
| Jobs / workflows | Upstash QStash + Upstash Workflow (durable multi-step, multi-day flows), dead-letter queue |
| Cache / locks | Upstash Redis |
| Realtime | Supabase Realtime (private broadcast channels). The BOS signs short-lived ES256 JWTs with its own key pair and is registered in Supabase as a third-party auth provider (OIDC discovery on `shaktiprime.com`), so Realtime authorization policies see the user id and entity ids; the token never grants Data API access |
| Files | S3 ap-south-1, SSE-KMS, 15-minute pre-signed URLs; type and size validation; malware scan for externally sourced files |
| PDFs and print | HTML templates rendered by headless Chromium in workers, with Noto Sans Devanagari embedded; the same templates drive print views and labels |
| Document masking | Server-side OCR (tesseract.js in workers) detects Aadhaar and bank account numbers; images and extracted text are masked before storage and before any LLM call |
| Tax engine | Pure functions in `packages/domain`: effective-dated GST rates per HSN, place-of-supply split, solar composite-supply (70:30) valuation, rupee rounding |
| AI | `@anthropic-ai/sdk` behind a provider wrapper; Claude Haiku 4.5 + Sonnet 5; Voyage embeddings |
| Speech (STT + TTS) | One vendor selected by benchmark (lead candidate: Sarvam AI for Hindi/Hinglish), behind a swappable adapter |
| Live voice | LiveKit Cloud (WebRTC, India region) + LiveKit Agents worker (TypeScript) deployed with LiveKit Cloud Agents hosting from a CI-built image; AWS ECS Fargate in ap-south-1 if Mumbai placement is not offered |
| Transactional email | Amazon SES, for password reset, 2FA recovery and security alerts only |
| Customer OTP | WhatsApp authentication templates |
| Observability | Sentry (web, mobile, connector, voice agent) + Vercel logs/analytics + uptime checks |
| Feature flags | DB-backed flags table |
| Testing | Vitest, Playwright (E2E per role), RLS/permission suite on real Postgres, webhook contract tests, AI eval sets |
| CI/CD | GitHub Actions + Vercel previews + Supabase branching; EAS Build/Update for Android |

## 6. Multi-entity model & data architecture

### 6.1 Tenancy
- There is one database. The four companies are **selling entities**, not isolated tenants, because staff are shared.
- Users have `allowed_entity_ids` and a role per entity. The entity switcher offers "All entities" or a single entity. Every lead, quote, order and document carries a selling entity.
- RLS uses `entity_id = ANY((select current_setting('app.entity_ids', true))::int[])`, set per transaction with `set_config(..., true)`, which is safe with connection poolers. The subselect runs once per query as an initplan, and the policy denies when the setting is null or empty, so a query that runs outside the request transaction returns nothing.
- Business tables carry `FORCE ROW LEVEL SECURITY`. The app connects as a non-superuser `app_user` that does not own the tables; migrations run as a separate role. The service role is never used in request paths.
- All data access goes through one `withRequestContext()` helper that opens the transaction and sets `app.user_id`, `app.entity_ids`, `app.role` and `app.permissions`. An ESLint rule forbids importing the raw database client anywhere else.

### 6.2 Customer identity
Phone numbers are often shared within families, and one farmer can have several borewells or fields. The model is:
- **Contact:** a person, with phones (E.164) and email.
- **Account:** a household, farm, business, dealer or referral partner. It links to contacts through roles.
- **Site:** a physical location (borewell, rooftop, factory) with geography and technical data.
- **Opportunity:** a sale on a pipeline and entity, for an account and site.

Deduplication:
- A matching phone number *suggests* a link or merge, shown as a confidence-scored card.
- A repeat enquiry with the same intent within 30 days attaches to the open deal automatically.
- Merges and unmerges are audited.

### 6.3 Core schema outline
- **Org:** `entities` (GSTIN, state code, letterhead, bank/UPI, numbering series), `entity_channels` (WhatsApp number, 140/160-series calling numbers, caller IDs per entity), `org_locations`, `users`, `roles`, `permissions`, `role_permissions`, `user_entity_roles`, `sessions`, `teams`, `business_calendar`.
- **CRM:** `contacts`, `contact_phones`, `accounts`, `account_contacts`, `customer_sites`, `opportunities`, `pipelines`, `pipeline_stages`, `activities` (partitioned), `tasks`, `calls`, `call_dispositions`, `whatsapp_threads`, `whatsapp_messages` (partitioned), `lead_sources`, `consents` (channel, purpose, source, timestamp), `tags`, `customer_loans`, `identity_documents` (type, last four digits, masked file reference).
- **Catalogue & pricing:** `items` (SKU, specs, DCR/ALMM, HSN, unit, serial-tracked), `item_costs` (restricted), `pump_curves`, `kits`, `kit_components`, `price_tiers`, `price_lists` (per tier, optionally per entity; versioned and effective-dated), `price_list_items`, `price_change_log`, `tax_rates` (per HSN or item, effective-dated), `composite_supply_rules` (goods/services split per segment, effective-dated).
- **Sales:** `quotes`, `quote_lines` (price and tax snapshot with rate version), `quote_versions`, `sales_orders`, `sales_order_lines`, `dealer_terms` (tier, credit limit, credit days), `targets`.
- **Inventory:** `warehouses`, `bins`, `stock_movements` (append-only), `stock_balances`, `reservations`, `serials`, `surplus_pool`, `vendors`, `vendor_quotes` (restricted), `purchase_orders`, `po_lines` (values restricted), `goods_receipts`, `dispatches`, `dispatch_lines`, `delivery_challans`, `eway_bills` (number, validity, vehicle, linked invoice or challan), `warranty_claims`.
- **Projects & field:** `projects`, `project_flow_templates`, `project_milestones`, `subsidy_applications`, `subsidy_gates`, `surveys`, `survey_photos`, `checklists`, `qc_inspections`, `schedule_slots`, `documents`, `document_requirements`, `cmc_register`.
- **Finance & costing:** `proformas`, `payment_milestones`, `tally_vouchers` (sales, receipts, credit notes), `tally_purchase_vouchers` (restricted), `tally_voucher_tombstones`, `tally_ledgers`, `reconciliation_links`, `unlinked_vouchers`, `dealer_outstanding`, `job_cost_entries` (restricted), `expense_claims`, `expense_lines`, `commission_accruals`.
- **HR:** `employees`, `attendance_events`, `shifts`, `leave_types`, `leave_requests`, `holidays`, `incentive_rules`, `incentive_accruals`, `salary_sheets`.
- **AI & voice:** `knowledge_files`, `knowledge_chunks` (pgvector, sensitivity, entity), `playbook_directives`, `agent_configs`, `agent_runs`, `agent_actions`, `agent_evals`, `voice_sessions`.
- **Platform:** `outbox_events`, `webhook_inbox`, `audit_logs` (partitioned, append-only), `notifications`, `import_jobs`, `import_rows`, `files`, `feature_flags`, `privacy_incidents`.
- **Money:** `numeric(14,2)` INR. GST per line comes from the effective-dated tax tables and is split by the entity's state code vs the place of supply (CGST+SGST or IGST). Solar EPC and rooftop contracts use the 70:30 goods/services composite-supply valuation. Every quote, order and proforma line stores the rate version it was computed with, and document totals round to the rupee.
- **Time:** stored as UTC `timestamptz`, displayed in IST.

### 6.4 Scale & performance
- Expected volume: about 750k leads a year and tens of millions of activity rows. Activities, WhatsApp messages and audit logs are partitioned monthly.
- Key indexes:
  - `contact_phones(e164)`;
  - trigram indexes on names and villages;
  - `(entity_id, stage_id, owner_id, updated_at)` on opportunities.
- Keyset pagination on all lists. Dashboards run from materialized views refreshed by pg_cron.
- Targets:
  - p95 interaction < 300 ms;
  - ingestion → assignment < 10 s;
  - WhatsApp first response < 60 s;
  - 50k-row import < 5 min.

## 7. Security, access & compliance

### 7.1 Roles
Roles are permission templates that Executives can edit:
- **Executive:** full access, including supplier rates, costs and margins.
- **General Manager:** all operations; no supplier rates, costs or margins.
- **Sales Team Lead:** caller supervision, queue and ownership reassignment, targets and leaderboards for their team.
- **Accounts:** proforma, payments, reconciliation, job-cost review, purchase-voucher review, expense approval, HR exports.
- **HR Admin:** employees, attendance, leave, incentives.
- **Inventory Manager:** stock, procurement, vendors and supplier rates; no margins or job costs.
- **Project Manager:** EPC and subsidy projects, scheduling board, document vault, QC sign-off.
- **Store Manager:** walk-ins and own records.
- **Tele-Caller CC:** cold-calling queue.
- **Tele-Caller LC:** conversion pipeline, quotes, orders.
- **Field Engineer:** assigned jobs in the Android app.
- **Agent service roles:** least privilege, one per agent.

### 7.2 Enforcement layers
1. Permission guards on every domain command.
2. RLS for entity scope and record ownership.
3. Sensitive-table isolation with two separate permissions, each enforced by RLS on the tables themselves and by DTO whitelists:
   - `procurement.rate.read` covers `vendor_quotes`, purchase-order values and `tally_purchase_vouchers`. Held by Executive, Inventory Manager and Accounts.
   - `finance.cost.read` covers `item_costs`, `job_cost_entries` and every margin figure. Held by Executive and Accounts.
   The General Manager, all other roles and every agent principal hold neither.

Response DTOs are whitelisted, so restricted fields are never fetched for roles that can't see them.

### 7.3 Authentication
- Argon2id password hashing, Turnstile, exponential lockout per IP and account.
- DB sessions with rotation and idle (12 h) / absolute (7 d) timeouts. Admins can force logout; a role change revokes sessions.
- Cookies are HttpOnly, Secure and SameSite=Lax. TOTP 2FA is required for Executive, GM and Accounts.
- Mobile: short-lived access tokens + refresh tokens in the Android Keystore; per-device revocation.

### 7.4 Audit
Append-only and partitioned monthly. It records the actor (user, agent or voice session), before/after state, IP, device and request ID. Views of sensitive documents are logged.

### 7.5 Data protection (DPDP Act 2023)
- Consent is captured per channel, purpose and source with a timestamp; opt-out is honoured across humans and agents.
- Data-principal export and deletion, subject to legal retention.
- **Aadhaar is never stored.** At capture, OCR locates the number, the first eight digits are masked on the image and in the extracted text, the original file is discarded, and only the last four digits and the masked copy are kept. Bank account numbers and IFSC codes are field-level encrypted.
- **PII masking before any LLM call.** Phone numbers, Aadhaar digits, bank details and street addresses are replaced by placeholders in text, and documents pass through the masking step before Claude vision sees them.
- The privacy notice covers AI processing by overseas vendors. Vendor data-retention terms are confirmed, including zero-retention options where available.
- **Breach handling:** a `privacy_incidents` register and a runbook to notify the Data Protection Board and the affected data principals in plain language within the timelines set by the DPDP Rules 2025.
- **Compliance calendar:** the DPDP Rules 2025 phase in until 14 May 2027. Consent notices, data-principal rights and breach handling are live before that date, ahead of the go-live in §14.

### 7.6 Disclosures
- The WhatsApp AI introduces itself as an AI assistant and offers "reply HUMAN to talk to our team".
- The IVR plays a call-recording notice.
- The privacy notices on all four entity websites cover AI use and recording.

### 7.7 Telecom
- Each entity is registered on the DLT platform as a Principal Entity, with its headers and consent templates.
- Outbound calls go out on DLT-registered numbers: the 140-series for promotional calls (imported or purchased lists, campaign outreach) and the 160-series for service calls (existing customers, requested callbacks, order and visit updates). Inbound IVR and missed-call numbers are standard virtual numbers.
- A lead is called on the 160-series only when it has a recorded consent (form submission, WhatsApp opt-in, walk-in form); every other outbound call uses the 140-series.
- TRAI calling hours (9 AM–9 PM) are enforced, lists are scrubbed against DND before dialling, and every call plays the recording notice.
- WhatsApp: 24-hour service window, approved templates, quality-rating monitoring.
- **WhatsApp messaging limits** apply at the business portfolio level, shared by all four entity numbers, and start at 250 business-initiated conversations per rolling 24 hours. The ramp to higher tiers is managed by completing business verification first, keeping the quality rating at Medium or High, and using at least half of the current tier every day. Ads, lead forms and IVR invite the customer to message first (click-to-WhatsApp), so most conversations are customer-initiated and outside the limit.

### 7.8 AI threat model
- WhatsApp messages, uploaded documents and call transcripts are treated as **untrusted data, never instructions**, and are labelled as such in prompts.
- **The customer-facing Concierge has a narrow tool set:**
  - read the current conversation's account;
  - write qualification fields;
  - book callback slots, and site-visit slots once the scheduling board is live;
  - send approved templates or in-window messages;
  - file received documents;
  - hand off to a person.
  It has no cross-customer queries, no price edits, and no access to internal notes.
- **Deterministic output filters** check every outbound message: no internal data, no other customer's PII, no claims outside the approved Playbook, plus a length and link allowlist.
- Every conversation is rate-limited, has abuse/spam detection, and hands off to a person automatically after repeated failed turns.

### 7.9 Data retention
| Data | Retention | Then |
|---|---|---|
| Financial records, proformas, sales orders, Tally mirrors | 8 years | Archive |
| KYC (masked copies), electricity bills, subsidy documents | Project life + 8 years | Delete |
| Call recordings | 12 months (transcripts and summaries retained) | Delete audio |
| WhatsApp messages and media | 3 years | Delete media, keep text summary |
| Unqualified leads with no transaction | 24 months after last activity | Anonymise |
| Audit logs | 8 years | Archive |
| Executive voice sessions | Per consent; default 24 months | Delete |
| Field photos | Project life + 5 years | Delete |

Retention runs as scheduled, logged jobs. Final periods are confirmed with the CA.

### 7.10 Application security
- CSP, CSRF protection, Zod validation on every input.
- Signature verification on all webhooks; HMAC-signed Tally connector requests.
- Secrets only in Vercel and EAS encrypted environments; there is no browser-to-database access.
- **Supply chain:** Renovate, `pnpm audit`, CodeQL and secret scanning in CI; pinned lockfile.
- **Secret rotation:** every 6 months and when team members leave, following a documented runbook.
- **Staging:** synthetic or anonymised data only; never raw production PII.
- **Customer files received on WhatsApp** are downloaded, malware-scanned and type-checked before they are filed.

## 8. Functional modules

### 8.1 CRM & lead management
- **Ingestion channels:**
  - Meta and Google Lead Ads webhooks;
  - entity website forms (signed API + Turnstile);
  - WhatsApp inbound; Exotel IVR and missed calls;
  - walk-in quick form (< 30 s);
  - referral partner codes; CSV/Excel import; manual entry.
- **Normalisation and attribution:** E.164 phones; PIN → village/tehsil/district master; UTM, campaign and ad ID captured for ROI.
- **Deduplication:** see §6.2. **Lead scoring:** rules-based, refined within bounds by the Triage agent.
- **Configurable pipelines**, with stage-exit rules for required fields:
  - Farmer Pumps;
  - Residential Rooftop;
  - Commercial EPC;
  - Dealer/Wholesale.
- **Account 360:** contacts, sites, deals, timeline, tasks, orders, projects, payments, loans, warranty claims.
- **Customer loans:** bank or scheme loans (including the PM Surya Ghar loan route) tracked as applied → sanctioned → disbursed. Loan status can gate payment milestones and dispatch.
- **Referral partners:** attribution and commission accruals.

### 8.2 Tele-calling workspace
- **CC queue:** prioritised by score, callback due and SLA. Click-to-dial, script cards, one-key dispositions, automatic re-attempts, then nurture.
- **Handover:** "Qualified" moves the lead to an LC by weighted round-robin (presence, capacity, language/segment skills). Ownership is locked for a configurable period.
- **LC workspace:** board, WhatsApp thread with the Co-pilot, sizing calculators, quote builder and next-best-action on one screen.
- Inbound screen-pop. Caller seats and Exotel channels are configuration settings.
- **Targets and leaderboards:** daily/weekly/monthly targets per caller and team (calls, qualified leads, conversions, kW). Live progress on each caller's home screen and a team leaderboard. The same targets feed incentives (§8.9).

### 8.3 Price Master, quotes & sales orders
- **Price Master:**
  - Executive-only edits;
  - price tiers (Retail, Dealer, Commercial, extensible), optionally per entity;
  - versioned with effective dates and scheduled changes;
  - HSN per item; GST rates and composite-supply rules live in effective-dated tax tables maintained by Accounts; full change log.
- **Quotes:**
  - The tier comes from the account type.
  - Prices come from the Price Master and can't be edited; a snapshot is frozen at creation; 15-day validity; one-click re-quote at current prices.
  - Tax is computed by the tax engine (§6.3) and snapshotted per line with the rate version used, so a rate change never alters an issued quote.
  - Validations: sizing complete (TDH and kW calculators); pump-curve bounds; sanctioned-load and DCR rules; stock availability shown once the stock ledger is live.
  - Branded PDF; WhatsApp dispatch; acceptance by WhatsApp reply (optionally a WhatsApp OTP) or signed upload.
- **Sales orders** are the backbone of fulfilment:
  - An accepted quote becomes a sales order, and dealers can order directly without a quote.
  - A sales order drives reservations → dispatches → proforma → payment milestones → project creation for install segments.
  - States: draft → confirmed → partially dispatched → dispatched → invoiced (Tally-linked) → closed / cancelled.
  - Partial dispatch and backorders are supported.
- **Dealer credit control:** credit limit and days per dealer, with outstanding balances from the Tally mirror. A new dealer order is blocked if outstanding + order value exceeds the limit, or any invoice is overdue beyond the credit days. An Executive can release a block, and the release is audited.

### 8.4 Inventory, procurement & logistics
- Item master; warehouses (godown, EPC factory) with rack/bin locations; append-only stock ledger with reason codes. The BOS is the operational stock authority; Tally holds statutory stock valuation and is reconciled monthly (§8.8).
- Kits with deterministic, tested availability-to-promise; reservations against sales order lines, released on cancellation or expiry.
- Vendor master and quote comparison matrix; PO drafting from reorder alerts; goods receipt with serial capture (camera scan or handheld scanner).
- Split dispatch from multiple hubs; delivery challans; vehicle and driver details; in-transit status; "materials arrived" confirmed in the app with a photo.
- **E-way bills:** a dispatch whose consignment value exceeds the threshold (₹50,000, configurable) cannot leave the "ready" state until an e-way bill number, validity and vehicle are recorded on it. Accounts generates the e-way bill in Tally against the tax invoice, or on the e-way bill portal for challan-based movement to a project site, and enters it on the dispatch; the connector links it to the Tally invoice afterwards. Validity expiry in transit raises an alert.
- Leftover material is logged into a zero-value surplus pool and suggested for reuse.
- QR/barcode label printing for serials, bins and packages.
- **Warranty claims and supplier returns:**
  1. The claim is raised on a customer or serial.
  2. The failed serial is identified.
  3. A replacement is issued from stock.
  4. A supplier RMA is raised under the supplier's warranty terms.
  5. Supplier credit or a replacement is received.
  The cost impact is recorded in job costing.

### 8.5 Projects, EPC & subsidy
- **Project flows:**
  - **Standard install flow** (farmer pumps, commercial EPC and other non-subsidy jobs): a configurable milestone checklist (survey → dispatch → install → commission → handover). Executives can adjust its steps without code changes.
  - **PM Surya Ghar flow** (rooftop subsidy): survey → load enhancement (when required) → portal registration → feasibility → agreement → material → installation → QC → net-meter/JIR → DBT tracking.
- **Subsidy gates:** a state machine with the required documents for each gate. The sanctioned-load lock, DCR/ALMM serial validation before dispatch, and rejection/resubmission loops are all modelled.
- **Document vault:** requirement templates and completeness gates; generated DISCOM packs (SLD, earthing, structural declaration).
- **Workforce and labour cost:** in-house engineers and crews are scheduled on the board. Labour or contractor charges are recorded as cost lines on the project for job costing.
- **Field scheduling board:**
  - day/week calendar by engineer or crew, plus a map of jobs;
  - drag-and-drop assignment, with conflict detection for double-booking, leave and travel time;
  - an unassigned jobs queue;
  - slot suggestions from the Project Orchestrator, confirmed by a person;
  - automatic WhatsApp confirmation to the customer, and a reminder the day before.
- **Handover:** WhatsApp handover kit (warranty, manuals, certificates); warranty registered per serial.
- **CMC register:** CMC start/end per PM Surya Ghar installation, a yearly reminder to the GM, and a CMC status report.

### 8.6 Customer communication on WhatsApp
- **Milestone messages** (approved templates, Hindi/English): quote sent, order confirmed, dispatched, engineer visit booked (name + date, with a reminder the day before), installed, payment due (UPI link/QR), handover kit.
- **Document collection:**
  - The Concierge or Project Orchestrator requests missing documents.
  - Incoming photos and PDFs are malware-scanned, passed through the masking step (§7.5), classified by Claude vision (electricity bill, Aadhaar, property papers, etc.) and filed into the vault against the right requirement.
  - Low-confidence classifications are confirmed by a person.
- **Self-service:** customers reply "STATUS" at any time for an instant summary of their order and project.

### 8.7 Android field app
- **Offline-first:** today's schedule, jobs, surveys, checklists, geo- and time-stamped photos, signatures, material arrival, leftovers, QC, attendance, expense capture with receipt photos.
- **Sync:**
  - server-authoritative status transitions;
  - field-level merge for survey data;
  - idempotent commands for stock and expense actions;
  - a conflict review screen.
- Background S3 uploads with on-device compression; FCM push; Maps navigation; minimum-version update gate.

### 8.8 Finance & job costing
- **Proforma invoices and delivery challans** per entity, with financial-year numbering. Payment milestones come from templates, with optional loan-disbursement gates.
- **Tally connector:** a Windows service. It reads vouchers and ledgers per Tally company (mapped to an entity) and pushes them outbound to the BOS.
  - Incremental reads by AlterID; sequential processing with throttling; local SQLite outbox; idempotency by voucher GUID; heartbeat with a 30-minute silence alert.
  - A daily GUID snapshot per company detects vouchers deleted or cancelled in Tally. Each one is recorded as a tombstone that reverses its effect on milestones, outstanding and reconciliation, and appears in the review queue.
  - Purchase vouchers land in `tally_purchase_vouchers`, gated by `procurement.rate.read` (§7.2).
  - The connector self-updates from signed releases published by CI; its version and last sync time show on Integration Health.
- **Reconciliation:** Tally "Buyer Order No." = proforma/sales order number, falling back to GSTIN or phone. Unmatched vouchers go to a review queue. Receipts update milestones, credit notes adjust balances, and dealer outstanding is refreshed.
- **Stock valuation reconciliation:** monthly, Accounts compares the BOS stock valuation report with Tally closing stock per company and records any adjustment in Tally.
- **Collections:** WhatsApp payment reminders with a UPI link or QR; an ageing dashboard per entity.
- **Job costing and project profit** (Executive and Accounts):
  - Cost per project or sales order is built from:
    - material issued at moving-average cost;
    - labour/contractor cost lines;
    - approved expenses;
    - warranty replacements;
    - other direct costs.
  - Revenue comes from Tally-linked invoices.
  - Budget (quote BOM at cost) vs actual; margin by project, segment, entity and engineer. This feeds the Executive P&L.
- **Expenses:** claims with receipt photos (app or web), categories (travel, fuel, food, site purchase), policy limits, manager → Accounts approval, allocation to a project or overhead, and a monthly reimbursement export.

### 8.9 HR, attendance & incentives
- Employee directory; office attendance (geofence + selfie) and field check-in at the job site; shifts; regularisation requests.
- Leave types, balances and approvals; holiday calendar.
- **Incentive engine:** rule-based and tied to targets (§8.2). Accruals are released only on confirmed events such as a Tally receipt. Covers staff and referral partners.
- Monthly salary, incentive and reimbursement sheet exported for the CA.

### 8.10 Dashboards, reports & search
- **Role home pages:**
  - Executive: P&L by entity and segment, cash, pipeline, project margins, agent performance, AI spend.
  - GM: operations and SLAs.
  - Callers: queue and targets.
  - Inventory: stock health and open RMAs.
  - Accounts: collections, dealer credit, expenses awaiting approval.
- **Report library:** funnel by source, campaign and caller; ad ROI; quote → order rate; order fulfilment time; project cycle time per gate; subsidy and loan status; stock valuation; job-cost variance; incentive statements.
- Audited, permission-gated exports. ⌘K search across phone, name, village, document numbers and serials.

### 8.11 Notifications
In-app notification centre (Realtime), browser push and FCM, with per-user preferences and quiet hours. SLA breaches escalate to the GM.

### 8.12 Data migration & imports
- A reusable import framework: upload → saved mapping templates → validation preview → dedupe suggestions → chunked commit → batch rollback.
- Sources: Excel/Sheets, the existing CRM, Tally masters, manual entry.
- **Cutover runbook:** staging dry run → count reconciliation → cutover weekend → 1–2 week parallel run.

## 9. AI layer

### 9.1 Executive Knowledge Brain
- **Three layers:**
  1. **Knowledge Vault:** original files in S3, tagged `exec_only`, `management` or `staff_ai_ok`.
  2. **Searchable memory:** Voyage embeddings in pgvector, with RLS by entity and sensitivity.
  3. **Business Playbook:** typed directives (policy, priority, target, SOP, FAQ, tone), each linked to its source. Directives take effect only after Executive approval, and conflicts with existing directives are flagged.
- **Extraction by input type:**
  - PDFs and scans: read natively by Claude.
  - Office files: parsed server-side.
  - Photos: Claude vision.
  - Audio: the speech vendor, with a correctable transcript (important for Rajasthani/Marwari).
- **Ask the Business:** a chat that answers business questions with citations. It runs as the asking user, so role, entity, sensitivity and cost permissions apply. Voice Ask mode (§9.2) uses the same service.
- **Staff knowledge search:** callers and the Concierge draw on approved product and SOP knowledge.

### 9.2 Live voice ("Talk to Shakti")
- **Modes:**
  - **Teach:** the AI interviews the executive and produces draft Playbook directives. Audio and transcript are stored in the Vault.
  - **Ask:** spoken business questions answered by voice, with supporting cards on screen.
  - **Command:** voice requests become proposed actions that are confirmed with a tap.
- **Architecture:**
  - WebRTC via LiveKit Cloud → a LiveKit Agents worker (TypeScript);
  - streaming STT → Claude Sonnet 5 (streaming, tools) → streaming TTS.
  - The worker calls the BOS API **as the speaking user** (short-lived token), so RLS and cost masking apply.
- **Behaviour:** barge-in, live captions, push-to-talk and text fallbacks. Latency target p50 < 1.5 s.
- **Safeguards:** visible listening indicator, per-session recording consent, PII masking, per-user minute and spend caps. Executives and GMs first.

### 9.3 Agent autopilot
- **Runtime:** outbox events → Upstash Workflow → Claude SDK tool runner with typed tools that wrap domain commands. Each agent runs as a least-privilege service principal, so RLS applies.
- **Autonomy levels** (set per agent × action type):
  - **Suggest:** appears in the Agent Inbox.
  - **Needs approval:** runs after one tap.
  - **Automatic:** runs, then notifies.
- **Always on:** full traces, kill switches (global, per agent, per entity), token budgets, customer-message rate limits.

| # | Agent | Responsibilities | Model |
|---|---|---|---|
| 1 | **Intake & Triage** | Dedupe suggestions, entity/pipeline inference, enrichment, scoring, assignment | Haiku 4.5 |
| 2 | **WhatsApp Concierge** | AI disclosure; first touch < 60 s; bilingual qualification (depth, HP, K-number, roof area, bill photo); slot booking; STATUS replies; document collection; handoff to a person on request, low confidence, complaint or legal topic | Sonnet 5 |
| 3 | **Caller Co-pilot** | Pre-call briefs; post-call summaries and field extraction; suggested dispositions; follow-up scheduling; nurture cadences and quote-expiry nudges | Haiku 4.5 (Sonnet 5 for briefs) |
| 4 | **Sizing & Quote** | Deterministic calculators + stock availability → quote at tier prices | Sonnet 5 |
| 5 | **Project Orchestrator** | Survey and job creation, schedule suggestions, document chasing, gate tracking, SLA alerts | Sonnet 5 |
| 6 | **Chief of Staff** | 8 AM briefing, anomaly detection, evidence-backed decision suggestions | Sonnet 5 |

- **Cost data and agents:** no agent principal holds `procurement.rate.read` or `finance.cost.read`. Cost and margin figures in the Executive briefing come from deterministic report queries that run under the viewing Executive's own permissions at render time; agent narratives never contain cost data. Ask the Business and voice Ask run as the user, not as an agent.
- **Deterministic automations** (rules and scheduled jobs): reorder suggestions and PO drafts, payment reminders, voucher-matching suggestions, and outbound-message compliance filters.
- **Hard guardrails in code:** tier prices only; engineering results out of bounds go to human review; WhatsApp window and opt-out; TRAI hours and number series; DPDP consent; PII masking; agents have no access to supplier rates or cost data.
- **Rollout:**
  1. Shadow mode.
  2. Needs approval, while tracking the unedited-approval rate.
  3. Automatic once an action reaches ≥ 95% unedited over ≥ 200 cases, with Executive sign-off.
  Regression evals run on every prompt or model change.
- **Cost controls:** Haiku by default, prompt caching, Batch API for non-urgent work, per-agent daily spend caps.

## 10. Integrations
| Integration | Direction | Key points |
|---|---|---|
| Meta WhatsApp Cloud API | In/out | Business verification, one WABA with one number per entity, template approval per number; signature-verified webhooks → `webhook_inbox` → QStash |
| Meta / Google Lead Ads | In | Meta App Review for the leads-retrieval permission; webhook → ingestion with attribution |
| Exotel | In/out | DLT-registered 140/160-series numbers per entity, click-to-dial, IVR with recording notice, status webhooks, recordings copied to S3 |
| Tally Prime | Connector → BOS | Per-company mapping, read-only, AlterID incremental reads, GUID idempotency, deletion tombstones, heartbeat, self-update |
| AWS S3 / SES | Out | KMS encryption, pre-signed URLs, lifecycle rules, backup bucket; security emails |
| Claude / Voyage / speech vendor / LiveKit | Out | Provider wrappers, budgets, PII masking, confirmed retention terms |
| FCM / Web Push | Out | Device tokens, revoked on logout |
| Entity websites | In | Signed ingest API + Turnstile, per-entity keys |

**API conventions:**
- versioned `/api/v1`;
- Zod contracts in `packages/contracts`;
- an `Idempotency-Key` header on every mutating mobile/connector call;
- one error envelope (`code`, `message`, `details`, `requestId`);
- cursor pagination;
- per-token rate limits.

**Webhook pipeline:** verify signature → store raw payload → return 200 immediately → idempotent QStash worker (retries, dead-letter queue) → visible on the Integration Health admin page.

## 11. UX & design system

### 11.1 Experience principles
- A calm, modern interface that is dense where the work needs it.
- Keyboard-first caller screens; ⌘K everywhere; skeleton loading; WCAG AA; fully responsive; English/Hindi.
- **Plain-language copy.** Every word a user reads or hears is written for non-technical staff and customers, in plain English and natural Hindi. No technical terms, error codes or internal names reach a user, and no placeholder or sample text ships anywhere; every string is final and product-specific, held in the message catalogues and checked by a copy lint in CI (`DESIGN.md` §11).
- **App shell:** a sidebar filtered by permissions; a top bar with the entity switcher, search, notifications, Agent Inbox, the "Talk to Shakti" mic (Executive/GM) and the profile menu.
- **Screens:**
  - role home pages;
  - leads list/board; Account 360; Caller Workspace; Quote Builder; Sales Orders; Dealer Credit;
  - Price Master; Inventory (stock, kits, movements, POs, dispatch, RMAs);
  - Projects (board, detail with gates and documents); Scheduling Board (calendar + map);
  - Finance (proformas, milestones, reconciliation, job costing, expenses); HR (attendance, leave, targets, incentives);
  - Knowledge (Vault, Playbook review, Ask the Business); Agents (autonomy, traces, evals, spend);
  - Admin (users, roles, entities, integrations, audit, imports, feature flags, costs);
  - the public website.

### 11.2 DESIGN.md
- **Foundation:** the Linear design language (VoltAgent awesome-design-md, getdesign.md/linear.app/design-md), for its precision, information density, restraint and single-accent discipline.
- **Shakti Prime adaptations:**
  1. System-aware light and dark themes, designed as equals.
  2. A distinct Shakti Prime accent (solar amber/saffron); no third-party brand identity.
  3. Larger touch targets and higher contrast for mobile and field use.
  4. Devanagari-capable type: Inter + Noto Sans Devanagari.
  5. Status colour tokens for pipeline stages, SLAs and stock health, plus data-grid, Kanban and form patterns.
- `DESIGN.md` lives at the repo root, and its tokens map to Tailwind v4 + shadcn/ui CSS variables. A companion preview page shows every component in both themes.

### 11.3 Theme behaviour
- **Default: System.** The interface follows the device's `prefers-color-scheme` and switches live when the OS setting changes.
- **Override:** System · Light · Dark in the profile menu.
  - The choice is saved to the user profile (so it follows them across devices) and mirrored in a cookie for server rendering.
  - Choosing "System" returns control to the device.
- **No flash of the wrong theme:**
  - An inline pre-paint script via next-themes (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`).
  - The CSS `color-scheme` property, so native controls, scrollbars and date pickers match.
  - A per-scheme `<meta name="theme-color">`.
- **Tokens:** every colour is a semantic CSS variable (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, status colours) with light and dark values. Components never hard-code colours.
- **Assets:** light and dark logo variants; token-driven chart colours; subtle dimming of photos and maps in dark mode.
- **Printed and shared outputs** (quote, proforma and challan PDFs, labels, emails) always use the light letterhead.
- The Android app follows the phone setting (`useColorScheme`) with the same override. The public website follows the visitor's system setting.
- **Quality checks:** AA contrast verified in CI for both themes; Playwright visual snapshots of key screens in light and dark.

### 11.4 Local conventions & performance
- Lakh/crore number formatting, ₹ with paise, DD-MM-YYYY dates, IST.
- Devanagari rendering, and transliteration-aware search ("Ramesh" ↔ "रमेश").
- Performance budget for low-end Android over 3G/4G: JS budget per route, image optimisation, Lighthouse checks in CI.
- Print templates: shared HTML templates for QR/barcode labels, A4 challans, job cards and all PDFs, rendered by headless Chromium with Devanagari shaping verified by snapshot tests.
- In-app help: contextual tips, short Hindi/English walkthroughs per role, and a "What's new" panel.

## 12. Reliability & operations
- **Environments:** dev, staging and prod as separate Supabase projects; Supabase branching for previews.
- **Region:** Vercel functions pinned to `bom1`, next to Supabase Mumbai. The voice-agent worker runs on LiveKit Cloud Agents hosting in the India region, with AWS ECS Fargate in ap-south-1 as the alternative if Mumbai placement is not offered.
- **Backups:** Supabase PITR + a nightly logical dump to S3 (30-day retention); quarterly restore drills.
- **Recovery targets:** RPO ≤ 5 min; RTO ≤ 4 h. Uptime target 99.5% during business hours (8 AM–10 PM IST); maintenance windows on Sunday nights.
- **Ownership and continuity:**
  - All accounts (domain, Vercel, Supabase, AWS, Meta, Exotel, Anthropic, Google Play, GitHub) are registered to the client's organisation, with the development team as members.
  - ADRs, runbooks and an onboarding guide let a new developer be productive within a week.
- **Change management:** expand/contract migrations; feature flags for risky releases.
- **Monitoring:** Sentry; alerts on queue depth and DLQ, connector heartbeat, WhatsApp quality rating, AI and voice spend.
- **Runbooks:**
  - Tally connector offline;
  - WhatsApp template rejected;
  - Exotel outage (manual calling with logging);
  - AI provider outage (agents fall back to Suggest, humans take over the queues);
  - LiveKit outage (text fallback);
  - WhatsApp messaging limit reached (service messages first, promotional queued);
  - e-way bill portal outage (manual generation, number entered on return);
  - personal data breach (DPDP notification steps, §7.5).

## 13. Operating cost estimate (monthly, at full volume)
Assumptions:
- 2,000 leads/day, of which about 50% engage on WhatsApp;
- about 4,500 dial attempts/day across about 45 callers, of which about 2,500 connect and average 3 minutes (about 225k talk-minutes a month); click-to-dial bills two legs per connected call;
- 100 users;
- about 300 minutes a month of executive voice use.

| Item | Estimate |
|---|---|
| Vercel Pro (2–3 seats) | $40–60 |
| Supabase Pro + compute (Medium/Large) + PITR | $200–350 |
| Upstash (QStash, Workflow, Redis) | $20–60 |
| AWS S3 + KMS + transfer + SES | $15–40 |
| Sentry Team | ~$26 |
| **Infrastructure subtotal** | **≈ $300–550 (~₹25–46k)** |
| Claude — WhatsApp Concierge (Sonnet 5, cached) | $800–2,000 |
| Claude — Triage, Co-pilot, summaries (Haiku 4.5) | $300–700 |
| Claude — Quote, Orchestrator, Chief of Staff, Knowledge | $150–400 |
| Voyage embeddings | < $20 |
| Call transcription (LC calls only, ~90k min/month) | $500–1,800 depending on vendor |
| Call transcription (full coverage, ~225k min/month; the largest AI variable) | $1,300–4,500 depending on vendor |
| Live voice (LiveKit + streaming STT/TTS + LLM) | $50–150 |
| **AI subtotal** | **≈ $1,800–5,100 with LC-only transcription (~₹1.5–4.3 lakh); ≈ $2,600–7,800 at full coverage (~₹2.2–6.6 lakh)** |
| WhatsApp (Meta per-message fees; customer-initiated service replies are free) | ~₹20–60k |
| Exotel (plan + about 450k billed minutes/month across two legs) | ~₹2–3 lakh |
| **Telecom subtotal** | **≈ ₹2.2–3.6 lakh** |

- **Total: approximately ₹4–8 lakh/month with LC-only transcription, and ₹4.5–11 lakh/month at full transcription coverage.** AI usage, transcription coverage and call minutes are the main variables, and all three are governed by per-agent caps and coverage settings.
- Call transcription starts with LC calls only. Per-lead AI cost is measured in shadow mode before any agent is moved to Automatic.
- Claude figures use current list prices for Sonnet 5 and Haiku 4.5 with prompt caching and the Batch API for non-urgent work.
- Figures are indicative and are confirmed with vendor quotes in Phase 0.

## 14. Roadmap & effort
Assumes a single full-time developer working with Claude; every phase has a quality gate. Each phase depends only on phases before it, and effort figures include a 20% contingency.

| Phase | Scope | Effort | Exit gate |
|---|---|---|---|
| **0 — Discovery & foundations** | Discovery workshop; monorepo, CI, environments, core schema, RLS + permission suite, auth + 2FA, Realtime auth, audit, outbox, command layer, tax engine, app shell + design system, import framework, integration spikes (§19) | 6–8 wk | Security suite green; design system signed off; spikes passed |
| **1 — MVP: CRM, tele-calling, quotes, sales orders** | Non-integration ingestion, dedupe, pipelines, CC/LC workspaces (manual call logging), targets, Price Master tiers with the minimal catalogue (items, HSN, tax rates, kits as saleable bundles, pump curves), sizing calculators, quotes + PDF, sales orders, dealer credit (manual outstanding until Tally sync), notifications, Knowledge Vault uploads + embeddings, data migration, Triage agent in shadow mode | 12–14 wk | 2-week parallel run; migration reconciled; UAT sign-off per role |
| **2 — Communications & live voice** | WhatsApp (one number per entity), Lead Ads, Exotel on 140/160-series numbers + recordings, Concierge + Caller Co-pilot (shadow → approval), WhatsApp quote acceptance and milestone messages, speech-vendor benchmark, Playbook directive review, Ask the Business, live voice Teach/Ask | 9–11 wk | Webhook idempotency tests; DLT numbers live; shadow reports reviewed; voice latency and accuracy targets met |
| **3 — Inventory & procurement** | Full catalogue, stock ledger, kit availability, reservations, vendors, POs, goods receipt, dispatch/challans with the e-way bill gate, serials, labels, warranty claims/RMA | 7–8 wk | Physical stock audit reconciles |
| **4 — Projects & field** | Standard and PM Surya Ghar flows, subsidy gates, document vault + masked WhatsApp document filing, DISCOM packs, QC, scheduling board (site-visit booking for the Concierge), handover kit, CMC register, customer loans, Android app (incl. attendance and expense capture) | 11–13 wk | Pilot with 2–3 engineers on live jobs |
| **5 — Finance, costing & HR** | Proforma, milestones, Tally connector (AlterID, tombstones) + reconciliation, dealer outstanding sync, stock valuation reconciliation, payment reminders, job costing, expense approval, attendance, leave, incentives, salary export | 9–11 wk | One month reconciled with Tally by Accounts |
| **6 — AI brain & autonomy** | Sizing & Quote, Project Orchestrator and Chief of Staff agents, voice Command mode, autonomy promotions | 7–9 wk | Eval thresholds met per action type |
| **7 — Hardening & rollout** | Load testing (5× volume), security review/pentest, DR drill, DPDP readiness review, documentation, role-wise training, in-app help | 4–5 wk | Go-live sign-off |

- **Full scope: about 65–79 weeks (≈ 15–18 months).** The MVP is live after about 5–6 months (Phases 0–1). A second developer on the Android app in Phase 4 shortens the timeline by 2–3 months.
- **Parallel workstreams starting immediately:**
  - DLT registration of all four entities and 140/160-series number provisioning with Exotel;
  - Meta Business verification, WABA, one WhatsApp number per entity and templates;
  - Meta App Review for Lead Ads access;
  - Tally discovery visit;
  - 20–30 executive voice samples;
  - privacy notice and consent texts.

## 15. Rollout & change management
- **Pilot groups per module:** 2 callers → full calling team; 2–3 engineers → all field staff.
- **Role-wise training:** short live sessions, Hindi/English videos and a one-page guide per role.
- UAT checklist and sign-off per role before each go-live.
- In-app feedback button, with weekly issue triage for the first 8 weeks.
- Android app: staged rollouts via EAS; forced update for breaking API changes; versioned `/api/v1`.

## 16. Edge cases
- **Customers and leads:**
  - shared family phones; one customer buying from two entities;
  - the same lead arriving on WhatsApp and by phone within minutes;
  - a caller leaving the company (bulk reassignment).
- **Prices, quotes and orders:**
  - price changes during a live quote; acceptance after expiry;
  - a GST rate change between quote and invoice (line snapshots keep the quoted rate; the re-quote applies the new one);
  - a dealer over the credit limit (order block + audited Executive release).
- **Stock and dispatch:**
  - reservation conflicts; partial dispatch and backorders;
  - cancellation after dispatch (returns, surplus);
  - an e-way bill expiring in transit; a dispatch above the threshold without one (blocked);
  - serial mismatch at site; a failed unit under warranty (replacement + supplier RMA + job cost).
- **Subsidy, loans and projects:**
  - subsidy gate rejection; sanctioned load changing mid-project;
  - a loan sanctioned but disbursement delayed (milestone and dispatch gate).
- **Scheduling:** double-booked engineers; engineer on leave; jobs overrunning into the next day.
- **Offline and integrations:**
  - the field app offline for days; Tally offline for days;
  - Tally invoices without a Buyer Order No.;
  - a voucher deleted in Tally after it was reconciled (tombstone reverses it, review queue).
- **WhatsApp and calls:**
  - customers outside the 24-hour window; opt-out mid-cadence; DND numbers;
  - the messaging limit reached mid-day (service messages first, promotional queued);
  - a lead without recorded consent (140-series only);
  - misclassified documents (human confirmation); an Aadhaar card arriving unmasked (masked at capture, original discarded).
- **AI and voice:**
  - prompt-injection attempts;
  - runaway agent spend; unsupported technical claims;
  - voice sessions on poor networks (push-to-talk/text fallback).
- **Data formats:**
  - Unicode Hindi names with transliterated search;
  - inter- vs intra-state GST; paise rounding; financial-year numbering per entity.

## 17. Verification strategy
- **Domain unit tests:** TDH, kW sizing, kit availability, tax engine (rate effective dates, place of supply, composite supply, rupee rounding), credit check, job-cost roll-up, incentive rules, all state machines.
- **Security suite:** every role × entity combination checked for:
  - cross-entity reads, supplier-rate exposure and cost-field exposure in API responses (GM sees neither; Inventory Manager sees rates but no margins; purchase vouchers gated);
  - fail-closed RLS: a query outside the request transaction returns no rows;
  - Realtime channels reject tokens for other users and entities;
  - agent and voice principals;
  - vector retrieval by sensitivity;
  - WhatsApp documents only ever filed against the sending customer;
  - masking: Aadhaar digits never appear in storage, logs or LLM payloads.
- **Prompt-injection test set** for the Concierge (data-exfiltration attempts, price manipulation, unauthorised promises). Every case must fail safely.
- **Playwright E2E per role:** lead → qualify → round-robin → quote → sales order → reservation → schedule → survey (app) → dispatch with e-way bill → install → JIR → Tally invoice reconciled → payment → job-cost margin, plus a dealer credit-block path.
- **Contract tests:** recorded Meta, Exotel and Tally payloads, including duplicates, out-of-order events and Tally deletions.
- **Print and PDF:** snapshot tests of Hindi and English quotes, proformas, challans and labels in both scripts.
- **Load tests:** 10k leads/day, 100 concurrent users, 50k-row imports.
- **AI evals** per agent; shadow comparison reports; spend-cap tests.
- **Voice:** p50 latency < 1.5 s, STT accuracy on real samples, cost-masking by role, network-drop fallback.
- **Before go-live:** restore drill and Tally connector catch-up test.

## 18. Risk register
| # | Risk | Likelihood / Impact | Mitigation |
|---|---|---|---|
| 1 | Scope size for a single developer | High / High | Strict phase gates; MVP first; 20% contingency in every phase; a second developer for the Android app; protect quality over scope |
| 2 | Tally behaviour differs from expectations (Buyer Order No., XML limits, company setup) | Medium / High | Tally discovery visit and connector spike in Phase 0; manual linking queue |
| 3 | WhatsApp verification or template approval delays | Medium / High | Start immediately; template variants; WhatsApp Business app as an interim channel |
| 4 | Speech accuracy on Marwari/Hinglish | Medium / Medium | Benchmark before committing; correctable transcripts; text fallback |
| 5 | AI cost above estimate | Medium / Medium | Shadow-mode cost measurement, per-agent caps, Haiku by default, selective transcription |
| 6 | Incorrect or harmful AI response to a customer | Medium / High | Narrow tools, output filters, Playbook-only claims, human handoff, staged autonomy |
| 7 | Low staff adoption | Medium / High | Role-shaped UX, pilots, training, leadership mandate, retiring legacy sheets at cutover |
| 8 | Migration data quality | High / Medium | Import preview, dedupe suggestions, reconciliation counts, parallel run |
| 9 | Vendor outage | Low / High | Runbooks, graceful degradation, independent backups, status alerts |
| 10 | Key-person dependency | Medium / High | Client-owned accounts, ADRs, runbooks, onboarding guide |
| 11 | Regulatory change (PM Surya Ghar, DPDP, TRAI) | Medium / Medium | Configurable gates, document templates and rules |
| 12 | Outbound calls blocked as spam from unregistered numbers | Medium / High | DLT registration and 140/160-series numbers live before Phase 2; consent recorded per lead |
| 13 | WhatsApp messaging limit throttles outbound messages | Medium / Medium | Customer-initiated-first design, early business verification, managed tier ramp |
| 14 | GST rate or composite-supply valuation change | Medium / Medium | Effective-dated tax tables; rate version snapshotted on every line |
| 15 | Realtime authorization gap between Better Auth and Supabase | Low / High | Third-party JWT registration proven in the Phase 0 spike; polling fallback for notifications |

## 19. Phase 0 deliverables
Completed and signed off before feature development begins:
1. **ERD and data dictionary** for all tables in §6.3.
2. **State-machine specifications** (states, transitions, guards, side effects, permitted actors) for: opportunity per pipeline, quote, sales order, dispatch (with the e-way bill gate), standard project flow, PM Surya Ghar flow and subsidy gates, loan, warranty claim, WhatsApp document filing, expense claim, Playbook directive, Tally voucher (including tombstones).
3. **Permission matrix:** role × permission × scope (own / team / entity / all), including `procurement.rate.read`, `finance.cost.read`, agent and voice principals.
4. **API contracts** (Zod) for mobile, connector, webhooks and ingest.
5. **Clickable wireframes** of core screens per role, reviewed with 1–2 real users per role.
6. **`DESIGN.md` and light/dark preview page.**
7. **ADRs** for the key stack decisions.
8. **Integration spikes:** Tally read by AlterID + deletion detection + push; Exotel click-to-dial on 140/160-series numbers; WhatsApp send/receive (sandbox); LiveKit + speech-vendor latency test; Supabase Realtime with BOS-signed JWTs; Chromium PDF rendering of Devanagari templates; OCR masking of Aadhaar numbers on real document photos.
9. **Test strategy and security-suite skeleton.**
10. **Vendor quotes** confirming the §13 cost figures.
11. **Claude Code tooling setup** (§20): `CLAUDE.md`, `.claude/tooling.json`, the SessionStart tooling-check hook, and the Phase 0 tools installed and verified.

**Discovery workshop inputs:**
- pipeline stages, required fields, dispositions and scripts per segment;
- price tiers and tier assignment rules, per-entity pricing, kit pricing, GST per item;
- dealer credit limits and days; incentive, target and expense policies; attendance rules;
- Tally companies per entity, Tally version, "Buyer Order No." usage, whether stock is maintained in Tally, current stock-valuation practice, current e-way bill and e-invoice practice;
- the existing CRM's name and export format; current call volumes and caller headcount;
- the WhatsApp and calling numbers in use per entity, and DLT registration status;
- numbering formats for quotes, sales orders, proformas and challans; letterheads, logos, bank/UPI details;
- required documents per project type and subsidy gate; loan partners and banks.

## 20. Claude Code tooling

### 20.1 Tooling by phase
| Tool | Type | Install from | Needed from | Sign-in / key |
|---|---|---|---|---|
| supabase | Plugin (skills + MCP) | Anthropic plugin directory | Phase 0 | Supabase sign-in or personal access token |
| context7 | Plugin (MCP) | Anthropic plugin directory | Phase 0 | Optional `CONTEXT7_API_KEY` |
| frontend-design | Plugin (skill) | Anthropic plugin directory | Phase 0 | — |
| Security Guidance | Plugin (hooks) | Anthropic plugin directory | Phase 0 | — |
| Upstash Redis | Plugin (skills + MCP) | Anthropic plugin directory | Phase 0 | Upstash email + API key |
| Vercel MCP | MCP (project scope) | `claude mcp add --transport http vercel https://mcp.vercel.com --scope project` | Phase 0 | Vercel sign-in (OAuth) |
| Vercel agent skills | Skills | `npx skills add vercel-labs/agent-skills -a claude-code` | Phase 0 | — |
| shadcn MCP | MCP (project scope) | `npx shadcn@latest mcp init --client claude` | Phase 0 | — |
| github | Plugin (MCP) | Anthropic plugin directory | Phase 0 | GitHub sign-in |
| playwright | Plugin (MCP) | Anthropic plugin directory | Phase 1 | — |
| sentry | Plugin (skills + MCP) | Anthropic plugin directory | Phase 1 | Sentry sign-in |
| aws-core | Plugin (skills + MCP) | Anthropic plugin directory | Phase 1 | AWS credentials (least-privilege IAM user) |
| expo | Plugin (skills + MCP) | Anthropic plugin directory | Phase 4 | Expo account |
| feature-dev, pr-review-toolkit | Plugins (optional) | Anthropic plugin directory | Any phase | — |

**Built in, nothing to install:** `claude-api` (agents, voice, Knowledge Brain), `/code-review`, `/security-review`, `/simplify`, `run`.

### 20.2 Automatic reminders
The project tells Claude which tools each phase needs, and Claude checks them at the start of every session and before any new phase begins. Three pieces work together:

1. **`.claude/tooling.json`** (committed to the repo). It is the single source of truth:
   - `currentPhase`;
   - the §20.1 table as data, per tool: name, type (plugin / mcp / skills), phase, install instruction, sign-in note.

   Updating `currentPhase` is part of each phase's exit-gate checklist.
2. **SessionStart hook** (`.claude/settings.json` → `.claude/hooks/tooling-check.mjs`), a small Node script that runs at the start of every session:
   - It reads `tooling.json`.
   - It checks project-scoped MCP servers in `.mcp.json` and the skills folder for everything required up to `currentPhase`, and anything required for the **next** phase.
   - It prints a short status block into Claude's context: "Phase 1 — missing: playwright, sentry. Coming in Phase 2: none."
   - It is read-only, fast (< 1 s) and never blocks the session.
3. **CLAUDE.md rule.** The project CLAUDE.md tells Claude:
   - At session start, confirm plugin status with the plugin listing tool, since account-level plugins aren't visible to a shell script.
   - Tell the user plainly which tools are missing, with the exact install step or ready-to-click install card, before doing phase work that depends on them.
   - Before starting work in a new phase, run the tooling check and list tools due in that phase.
   - Never install anything without the user's go-ahead.

**Result:**
- Every session opens with an up-to-date tooling status.
- Missing tools are flagged before they're needed, together with their install step and any sign-in required.
- Upcoming tools are announced one phase ahead, so accounts and keys can be prepared in time.

**Security:**
- MCP credentials and API keys live in each developer's local config or environment, never in `tooling.json` or `.mcp.json`.
- Project-scope MCP entries contain only server URLs.
