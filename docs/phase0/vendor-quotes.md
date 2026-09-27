# Vendor quote requests — Shakti Prime BOS

Date: 27-09-2026. Status: drafts for the group's review. Nothing has been sent to any vendor. Each request is sent from the group's own account with that vendor (every account is registered to the group, with the development team as members), once the owner approves this pack.

Purpose: the approved blueprint (§13) estimates the monthly running cost at full volume. Phase 0 ends only when vendor quotes confirm those figures (ROADMAP §2, exit-gate item 5). This pack holds one request per vendor, the volumes to quote against, the questions each vendor must answer, the blueprint's estimate, and an empty column for the quoted figure. The cost sheet at the end totals the quotes against the blueprint range.

Currency: the blueprint quotes most services in US dollars and telecom in rupees. Rupee figures for dollar items use ₹84 to the US dollar, the rate implied by the blueprint's own conversions. Quoted figures are recorded in the currency the vendor quotes, before GST, with GST noted separately.

## 1. Volumes to quote against
These are the blueprint's full-volume assumptions (§1, §6.4, §13). Every request quotes the monthly cost at these volumes, and at half of them for the first months after go-live.

| Measure | Full volume |
|---|---|
| Staff users | 100 |
| New leads | 2,000 a day, about 60,000 a month |
| Leads that reply on WhatsApp | about 50%, about 1,000 conversations a day |
| Tele-callers | about 45 |
| Dial attempts | about 4,500 a day |
| Answered calls | about 2,500 a day, averaging 3 minutes: about 2,25,000 talk minutes a month |
| Billed call minutes | about 4,50,000 a month (click-to-dial bills two legs per answered call) |
| Call transcription | lead-converter calls only at first: about 90,000 minutes a month; full coverage: about 2,25,000 minutes a month |
| Executive voice conversations | about 300 minutes a month |
| Companies | 4, each with its own GSTIN, WhatsApp number and calling numbers |
| Sites | Jaipur office and godown, and the EPC factory |

## 2. What every request asks
Every vendor is asked, in addition to its own questions:
1. The monthly price at the volumes above and at half of them, and what is charged beyond each included allowance.
2. **Region:** whether the service runs in India (Mumbai where offered), and where data, backups and logs are stored.
3. **Data protection:** a signed data processing agreement suited to India's Digital Personal Data Protection Act 2023, how long the vendor keeps our data, and whether our data is used to train any model.
4. **Billing:** billing in rupees or dollars, a GST-compliant invoice where the vendor has an Indian entity, and the payment method.
5. **Account ownership:** the account is held by the Shakti group, with the development team added as members.
6. Support terms and the published uptime commitment.

## 3. Quote requests

### 3.1 Vercel — web hosting
- **Used for:** the web app and its server functions, pinned to the Mumbai region (`bom1`), with preview deployments for every change.
- **Plan to quote:** Pro, 2 to 3 seats.
- **Ask:** that functions can be pinned to Mumbai on Pro; the included function time, data transfer and build minutes, and the price beyond them; spend limits and alerts; where logs are kept and for how long; the data processing agreement.
- **Blueprint estimate:** US$40–60 a month.

### 3.2 Supabase — database
- **Used for:** the main database (Postgres 17 with row-level security, pgvector, pg_trgm, pg_cron), private realtime channels for live updates, in the Mumbai region. Three projects: development, staging and production.
- **Plan to quote:** Pro, with Medium or Large compute for production, smaller compute for development and staging, and point-in-time recovery on production.
- **Ask:** the compute add-on prices; the point-in-time recovery price for a 7-day window; branching for previews; realtime limits at 100 concurrent users; that all data and backups stay in Mumbai; how the Data API can be switched off; the data processing agreement and security reports.
- **Blueprint estimate:** US$200–350 a month.

### 3.3 Upstash — job queue, workflows and fast store
- **Used for:** QStash (delivers events to background workers, with retries and a dead-letter queue), Workflow (multi-step and multi-day flows), and Redis (rate limits, locks, round-robin and sign-in counters).
- **Volumes:** at the development team's estimate of about ten events per lead across its life, about 6,00,000 queue messages a month; a few million Redis commands a month.
- **Ask:** whether QStash and Workflow can run in an India region, or the nearest one (messages carry record numbers and codes only, no personal data); Redis in Mumbai; pay-as-you-go against fixed plans at these volumes; the data processing agreement.
- **Blueprint estimate:** US$20–60 a month.

### 3.4 AWS — file storage, encryption and security email
- **Used for:** S3 file storage in Mumbai (`ap-south-1`) with KMS encryption and 15-minute download links; nightly database copies kept 30 days; call recordings kept 12 months; SES for password-reset, sign-in code and security-alert emails only. The fallback host for the voice worker (ECS Fargate in Mumbai) if the live-voice vendor cannot run it in India.
- **Volumes:** at the development team's estimate, call recordings of about 100 GB a month, about 1.2 TB at the 12-month retention; documents and photos a further few hundred GB a year; a few thousand emails a month.
- **Ask:** billing through AWS's Indian entity with a GST invoice; SES production access in Mumbai; KMS key and request charges; a budget alert set up with the account.
- **Blueprint estimate:** US$15–40 a month.

### 3.5 Sentry — error monitoring
- **Used for:** error and performance monitoring of the web app, the Android app, the Tally connector and the voice worker.
- **Plan to quote:** Team.
- **Ask:** the included error and performance-event volumes and overage prices; the data-storage region (Sentry offers the US and the EU); personal-data scrubbing on the server side; the data processing agreement.
- **Blueprint estimate:** about US$26 a month.

### 3.6 Anthropic — AI models
- **Used for:** the six AI assistants, Ask the Business and the Knowledge Vault. Claude Sonnet 5 for the WhatsApp Concierge, Sizing & Quote, Project Orchestrator and Chief of Staff; Claude Haiku 4.5 for lead sorting, caller help and summaries. Prompt caching throughout, and the Batch API for work that can wait.
- **Volumes:** about 1,000 WhatsApp conversations a day; about 2,000 new leads a day sorted; summaries and briefs for lead-converter calls; a daily briefing; knowledge questions from about 20 managers.
- **Ask:** zero data retention on the API; the commercial terms and data processing agreement, including processing outside India (the privacy notice covers it); rate limits at these volumes; volume or committed-spend pricing; invoicing.
- **Blueprint estimate:** US$1,250–3,100 a month in three lines: WhatsApp Concierge US$800–2,000; sorting, caller help and summaries US$300–700; quotes, projects, briefing and knowledge US$150–400.

### 3.7 Voyage AI — search embeddings
- **Used for:** turning Knowledge Vault documents and approved product knowledge into searchable form.
- **Volumes:** a few thousand pages a month once the vault is loaded; a one-time load of the existing documents.
- **Ask:** zero data retention; that data is not used for training; the data processing agreement.
- **Blueprint estimate:** under US$20 a month.

### 3.8 Speech vendor — transcription and speech (lead candidate: Sarvam AI)
- **Used for:** transcribing calls after they end; live speech recognition and speech for Talk to Shakti; transcribing voice notes in the Knowledge Vault.
- **Selection:** one vendor is chosen by a benchmark on the group's own recordings (20 to 30 executive voice samples and a set of recorded calls). Sarvam AI is the lead candidate; the same request goes to at least two others chosen for the benchmark.
- **Volumes:** about 90,000 call minutes a month (lead-converter calls only) rising to about 2,25,000 (all calls); about 300 minutes a month of live conversation.
- **Ask:** accuracy on Hindi, Hinglish and Rajasthani-accented speech (Marwari words included); natural pronunciation of Hinglish written in Roman letters; speaker separation on two-sided calls; streaming latency for live conversation; where audio is processed and stored (India preferred); retention and training use of our audio; the per-minute price at each volume.
- **Blueprint estimate:** US$500–1,800 a month for lead-converter calls only; US$1,300–4,500 a month for all calls.

### 3.9 LiveKit — live voice
- **Used for:** the live voice connection for Talk to Shakti, and hosting of the voice worker.
- **Volumes:** about 300 minutes a month; Executives and the General Manager first.
- **Ask:** media servers and agent hosting in India (Mumbai preferred); if agent hosting in India is not offered, confirm that the worker can run on our own AWS Mumbai account; the plan price and per-minute charges; recordings are not stored by the vendor; the data processing agreement.
- **Blueprint estimate:** US$50–150 a month for live voice in total (connection, streaming speech and the AI model).

### 3.10 Meta — WhatsApp Business Platform
- **Used for:** one business portfolio with one WhatsApp number per company (four numbers) on the Cloud API: customer conversations, approved message templates (quote sent, order confirmed, dispatched, visit booked, payment due, handover) and sign-in codes for customers.
- **Volumes:** about 1,000 customer conversations a day, mostly started by the customer and so free of per-message charges; business-started template messages for milestones, reminders and payment requests.
- **Ask:** the current per-message rates for India by type (marketing, utility, authentication); business verification for the group and its timeline; the messaging limit ramp (the limit starts at 250 business-started conversations a day, shared by all four numbers); template approval times; billing in rupees.
- **Blueprint estimate:** about ₹20,000–60,000 a month.

### 3.11 Exotel — calling
- **Used for:** click-to-dial with recording, the inbound phone menu (IVR) with a recording notice, and missed-call numbers, for all four companies on one account.
- **Numbers:** per company, a 140-series number for promotional calls and a 160-series number for service calls, both registered on the telecom consent platform (DLT); standard virtual numbers for inbound and missed calls.
- **Volumes:** about 45 caller seats; about 4,500 dial attempts a day; about 4,50,000 billed minutes a month across both legs.
- **Ask:** help with each company's DLT registration as a Principal Entity, with headers and consent templates; availability and lead time of 140-series and 160-series numbers for each company; the per-minute rate for each leg at this volume; concurrent-call capacity for 45 callers; call recordings and their copy to our own storage; DND scrubbing; call-status notifications to our system; that call data is stored in India; the agreement and billing.
- **Blueprint estimate:** about ₹2–3 lakh a month (plan and minutes).

### 3.12 Accounts not in the blueprint cost estimate
These are listed in the account-ownership plan (ROADMAP §10) or needed for the Android app, and are not in the §13 estimate. The indicative figures are public list prices noted by the development team, to be confirmed with each vendor.

| Account | Used for | What to ask or check | Indicative figure |
|---|---|---|---|
| Google Play developer account | Publishing the Android field app | Registration as an organisation in the group's name (needs the group's D-U-N-S number); staged roll-outs | US$25, once |
| Domain `shaktiprime.com` | The website and web app, email sending records | Registrar in the group's name, auto-renewal, DNS access for the development team | Yearly renewal at the registrar's price |
| GitHub plan | The code repository | A group organisation on a plan that enforces review and checks before changes reach the live system (AUDIT M45) | Team plan, about US$4 a user a month |
| Firebase Cloud Messaging | Notifications on the Android app | A Firebase project owned by the group | No charge |
| Cloudflare Turnstile | The bot check on sign-in and website forms | Site keys for `shaktiprime.com` and the four company websites | No charge on the free plan |
| Expo Application Services (EAS) | Building and updating the Android app | Build and update limits on each plan against about 20 field devices and weekly updates | Plan price to be quoted |

## 4. Cost sheet
Fill the "Quoted" columns as quotes arrive. Figures are monthly at full volume, before GST.

| # | Line | Blueprint low | Blueprint high | Quoted (vendor currency) | Quoted in ₹ | Notes |
|---|---|---|---|---|---|---|
| 1 | Vercel Pro (2–3 seats) | US$40 (₹3,400) | US$60 (₹5,000) | | | |
| 2 | Supabase Pro, compute and point-in-time recovery | US$200 (₹16,800) | US$350 (₹29,400) | | | |
| 3 | Upstash QStash, Workflow, Redis | US$20 (₹1,700) | US$60 (₹5,000) | | | |
| 4 | AWS S3, KMS, transfer, SES | US$15 (₹1,300) | US$40 (₹3,400) | | | |
| 5 | Sentry Team | US$26 (₹2,200) | US$26 (₹2,200) | | | |
| | **Infrastructure subtotal** | **US$300 (≈ ₹25,000)** | **US$550 (≈ ₹46,000)** | | | |
| 6 | Claude — WhatsApp Concierge | US$800 | US$2,000 | | | |
| 7 | Claude — sorting, caller help, summaries | US$300 | US$700 | | | |
| 8 | Claude — quotes, projects, briefing, knowledge | US$150 | US$400 | | | |
| 9 | Voyage embeddings | — | US$20 | | | |
| 10a | Call transcription, lead-converter calls only | US$500 | US$1,800 | | | Use 10a or 10b |
| 10b | Call transcription, all calls | US$1,300 | US$4,500 | | | |
| 11 | Live voice (LiveKit, streaming speech, AI model) | US$50 | US$150 | | | |
| | **AI subtotal with 10a** | **US$1,800 (≈ ₹1.5 lakh)** | **US$5,100 (≈ ₹4.3 lakh)** | | | |
| | **AI subtotal with 10b** | **US$2,600 (≈ ₹2.2 lakh)** | **US$7,800 (≈ ₹6.6 lakh)** | | | |
| 12 | WhatsApp per-message fees | ₹20,000 | ₹60,000 | | | |
| 13 | Exotel plan and minutes | ₹2,00,000 | ₹3,00,000 | | | |
| | **Telecom subtotal** | **≈ ₹2.2 lakh** | **≈ ₹3.6 lakh** | | | |
| | **Total with transcription of lead-converter calls only** | **≈ ₹4 lakh** | **≈ ₹8 lakh** | | | |
| | **Total with transcription of all calls** | **≈ ₹4.5 lakh** | **≈ ₹11 lakh** | | | |

**Reading the result:**
- The exit-gate item is met when the quoted total with lead-converter transcription falls within ₹4–8 lakh a month, or when the group accepts a figure outside it in writing.
- A line quoted above its blueprint high is flagged to the owner with the reason and the choices (another vendor, lower coverage, a spending cap).
- AI usage, transcription coverage and call minutes are the three figures that move the total most. Each has a cap or a coverage setting in the system, and the real cost per lead is measured in the first weeks before any AI assistant works on its own.
- The one-time and small accounts in §3.12 are recorded separately and are not part of the monthly total.

## 5. Tracking
| Vendor | Request approved by owner | Sent on | Sent by | Quote received on | Data processing agreement signed | Account in the group's name |
|---|---|---|---|---|---|---|
| Vercel | | | | | | |
| Supabase | | | | | | |
| Upstash | | | | | | |
| AWS | | | | | | |
| Sentry | | | | | | |
| Anthropic | | | | | | |
| Voyage AI | | | | | | |
| Speech vendor (Sarvam AI and others) | | | | | | |
| LiveKit | | | | | | |
| Meta WhatsApp | | | | | | |
| Exotel | | | | | | |
| Google Play | | | | | | |
| Domain registrar | | | | | | |
| GitHub | | | | | | |
| Firebase | | | | | | |
| Cloudflare | | | | | | |
| Expo | | | | | | |
