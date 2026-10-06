# Phase 0 exit gate: who does what next

Prepared 28-09-2026 · last updated 04-10-2026. For: the owner and the development team.

Phase 0 was closed on 29-09-2026 by the owner's decision, and Phase 1 has started. The exit-gate items that are not met are deferred and run alongside Phase 1. This page is the owner's and the developer's checklist: each gate item, then every action by who acts next, with the document that says exactly what is needed. What the client's people do is written for them, in business words, in [client-actions.md](client-actions.md). The state of the hosted environments is in [STATUS](../10-status.md).

**Contents:** [1. Exit gate](#1-exit-gate-item-by-item) · [2. Actions](#2-actions) · [3. Standing rule](#3-standing-rule) · [4. Technical reviews](#4-technical-reviews-with-the-clients-engineering-contact) · [5. Where each workshop question comes from](#5-where-each-workshop-question-comes-from)

## 1. Exit gate, item by item
| Item (ROADMAP §2) | State | Next step |
|---|---|---|
| Security suite green for every core table, with fail-closed and cost-gate tests | Met | None |
| docs/08-design-system.md and the preview page signed off by the client | Deferred | The client signs off `docs/08-design-system.md` and `/design` with `docs/13-client-packs/design-signoff.md` |
| All seven spikes passed, with written results and latency numbers | Partly met, rest deferred | Print and QR labels passed their rendering checks, with the phone and scanner check of printed labels still open; OCR masking passed on generated photos. Tally, Exotel, WhatsApp and voice have harnesses ready to run; Realtime runs on the production site with the client's domain. Each `docs/04-architecture-appendix/*.md` says what it needs |
| ERD, data dictionary, state machines, permission matrix and API contracts reviewed | Deferred | The technical reviews of §4 |
| Vendor quotes confirm the §13 cost figures | Deferred | Action 3 below |
| Phase 0 tooling installed and verified; `currentPhase` set to 1 | Met | `currentPhase` set to 1 on 29-09-2026 |

## 2. Actions
"Needed by" is the slice or phase that waits for the action.

| # | Action | Who | State | Needed by |
|---|---|---|---|---|
| 1 | Create the files stack for dev, then staging, with `infra/aws/files.yaml` as `docs/runbooks/files-setup.md` describes (the bucket, the KMS key, the GuardDuty malware scan and the app user), and put the access key and the bucket settings in Vercel. Until then uploads on the hosted sites are refused and imports keep their in-function path | Owner | Not done | P2b on the hosted sites |
| 2 | In Sentry, on the `shakti-prime-web` project's Security and Privacy settings, turn on the Data Scrubber and Use Default Scrubbers and turn on Prevent Storing of IP Addresses (the app already removes personal data before it sends an event; these settings are the second line) | Owner | Not done | Before real data reaches a hosted site |
| 3 | Prepare each vendor quote letter (`docs/13-client-packs/vendor-quotes.md`); the owner approves the pack and sends each letter from the group's account with that vendor; record each answer in the pack's cost sheet and tracking table | Developer prepares; owner sends | Not started | Production readiness (G1); the telecom, WhatsApp and voice quotes before Phase 2 |
| 4 | Open the vendor sandboxes each spike needs (Exotel with DLT numbers, Meta WhatsApp, LiveKit, Sarvam and Anthropic, `docs/04-architecture-appendix/*.md`), then run the Exotel, WhatsApp, voice and Tally spikes and record their numbers | Developer, in the group's accounts | Waiting on the accounts (client-actions 13, 17, 18) | Phase 2; the Tally spike before Phase 5 |
| 5 | Run the Realtime spike on the production site with the client's domain (`docs/04-architecture-appendix/realtime.md`) | Developer | Waiting on the production site | Before notifications move from polling to Realtime |
| 6 | Add the Anthropic and Voyage keys for each environment | Owner | Not done | The Agent Inbox (AI0), the Knowledge Vault (K1), Triage in shadow (A1) |
| 7 | Set up Amazon SES in Mumbai (BLUEPRINT §5, ADR 0003): verify the client's domain with DKIM, SPF and DMARC and ask AWS for production access (`docs/runbooks/files-setup.md` §7), then update each environment's files stack with the verified identity and the one sender address, so its app user may send mail from that address alone (`docs/runbooks/files-setup.md` §4), and set `MAILER=ses`. The SES mailer behind the `Mailer` port is built (#85) | Owner, with the person who manages the client's domain | Waiting on the client's domain (client-actions 16) | Production readiness (G1) |
| 8 | Buy the production plans: the Vercel Pro plan or the client's Pro team, and a production Supabase project on the paid tier | Owner, from the client's accounts | Not started | Production readiness (G1) |
| 9 | Move the repository to a GitHub plan or the client's organisation that protects `main` with branch rules and holds the production secrets in an environment (the audit ([2026-09-audit](../14-reviews/2026-09-audit.md)) M45, ADR 0017); then make a new GitHub token for that organisation | Owner | Not started | Production readiness (G1) |
| 10 | Prepare the screen review on staging: a small, clearly labelled demo data set and one account per role, removed after the reviews (`docs/13-client-packs/wireframe-review.md` §1a) | Development team | Not started | The screen review (client-actions 6) |
| 11 | Walk the client's engineering contact through the technical reviews of §4 | Developer | Not started | ADR 0007 before quotes (S1); the rest before the slice or phase that builds on each |
| 12 | Start the Meta App Review for Lead Ads access and the Google Lead Form setup (ROADMAP §10) | Developer, in the group's Meta and Google accounts | Not started | Phase 2 |
| 13 | Confirm the place-of-supply rule, the rounding and the tax golden set (ADR 0007) | The group's CA | Not started | Quotes (S1) |
| 14 | Return quotes against the volumes in the quote pack | Vendors | Not started | As action 3 |
| 15 | Name the thermal label printer model and label stock for the QR label check | The printer supplier | Not started | Phase 3 |
| 16 | Confirm the workshop defaults quotes use until the answers come (`packages/domain/src/workshop-defaults.ts`, design §11): the document number format `<company code>/Q/<year>/0001` (SALE-1, the pack's first example; each document's code and the serial's digits change in one place), no map from customer type to price tier, so an Executive gives each customer its tier on the customer's page (PRICE-1), and kits sold at their own fixed price (PRICE-3) | Accounts (SALE-1), owner and sales head (PRICE-1, PRICE-3) | Not started | Quotes in daily use (S1) |
| 17 | Confirm or change the owner's calling defaults of 05-10-2026, which the Cold Caller workspace uses: three attempts for an unanswered lead on the day of the first call, the next day and day 3 (CALL-3), and nurture calls on day 7, 30 and 90 (CALL-5); a change is one edit of `WORKSHOP_DEFAULTS.calling` | Sales head, at the workshop | Not started | The Cold Caller workspace in daily use (T1) |

Every other client task (the workshop answers, the design sign-off, the screen review, the letterheads and data files, the vendor accounts in the client's name, DLT registration and Meta verification, the voice samples, real document photos and the Tally visit) is in [client-actions.md](client-actions.md), with who does it and which slice waits for it.

## 3. Standing rule
Once staging holds data worth keeping, every migration is applied to a copy of staging before it reaches production (AGENTS §10).

## 4. Technical reviews with the client's engineering contact
Each is a decision the person who looks after technology for the group reviews with the developer, who records the outcome:
- **The data model and permissions:** the diagram of every table and the data dictionary (`docs/data/`), the permission matrix (`docs/07-security.md` §3.2) and the planned interfaces (`packages/contracts/src/api`). Accept, or ask for changes.
- **The order of steps in each process:** the items marked *proposed* in `docs/state-machines/`, which the blueprint did not settle.
- **Architecture decisions awaiting review:** the tax engine (ADR 0007), the voice assistant (ADR 0010), the AI provider and search (ADR 0011), the offline field app (ADR 0012) and the Tally connector (ADR 0013), in `docs/adr/`. Each is accepted or changed. Printed documents (ADR 0009) were accepted on 29-09-2026.
- **Questions left open by the audit** (§7 of the [2026-09-audit](../14-reviews/2026-09-audit.md)): which consents a caller may record, consent per company, and a negative moving-average cost. They are asked in the workshop pack as LAW-1, LAW-2 and STOCK-2, so the answers are recorded there.

## 5. Where each workshop question comes from
- CRM-1 to CRM-6, CALL-1 to CALL-7, PRICE-1 to PRICE-4, SALE-2 to SALE-4, SALE-6, STOCK-1, STOCK-3, PROJ-1, FIN-1, HR-1 to HR-3 and LAW-4 are the discovery inputs of BLUEPRINT §19 and PRD §7.
- PRICE-5 and SALE-5 are items 1 and 3 of `docs/03-roadmap-appendix/backend-weeks-3-5.md` §11, CALL-4 and CALL-5 its item 2, ACC-1 its item 4, and SALE-1 its item 5 with DATABASE §9.
- LAW-1 and STOCK-2 are items 6 and 7 of the audit's §7; LAW-2 is review 3; PRICE-6 is ADR 0007; FIN-2 is BLUEPRINT §7.9; LAW-3, LAW-5 and ACC-2 are ROADMAP §10.
- CRM-7, STOCK-4, PROJ-3 and PROJ-4 hold the values PRD CRM-06, INV-03, WA-02, PRJ-04 and FLD-02 leave to the client; ENG-1 is the sizing constants of `docs/03-roadmap-appendix/phase1.md` §6.7 and §11; TERM-1 confirms the business terms the glossary marks "to confirm".
- Part A1 is the header of `docs/03-roadmap-appendix/backend-weeks-3-5.md`, ADR 0008 and ADR 0014; Part A2 is the audit's §8.
