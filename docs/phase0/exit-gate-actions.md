# Phase 0 exit gate: who does what next

Phase 0 was closed on 29-09-2026 by the owner's decision, and Phase 1 has started. The items below that are not met are deferred and run alongside Phase 1. This page is the developer's and the owner's checklist: each item by who acts next, with the document that says exactly what is needed. What the client's people do is written for them, in business words, in [client-actions.md](client-actions.md). The state of the hosted environments is in [STATUS](../STATUS.md).

## Exit gate, item by item
| Item (ROADMAP §2) | State | Next step |
|---|---|---|
| Security suite green for every core table, with fail-closed and cost-gate tests | Met | None |
| DESIGN.md and the preview page signed off by the client | Deferred | The client signs off `DESIGN.md` and `/design` with `docs/phase0/design-signoff.md` |
| All seven spikes passed, with written results and latency numbers | Partly met, rest deferred | Print and QR labels passed their rendering checks, with the phone and scanner check of printed labels still open; OCR masking passed on generated photos. Tally, Exotel, WhatsApp and voice have harnesses ready to run; Realtime runs on the production site with the client's domain. Each `docs/spikes/*.md` says what it needs |
| ERD, data dictionary, state machines, permission matrix and API contracts reviewed | Deferred | The developer and the client review `docs/data/`, `docs/state-machines/` (the items marked proposed), SECURITY §3.2 and `packages/contracts/src/api` |
| Vendor quotes confirm the §13 cost figures | Deferred | The developer sends the requests in `docs/phase0/vendor-quotes.md` and records the answers |
| Phase 0 tooling installed and verified; `currentPhase` set to 1 | Met | `currentPhase` set to 1 on 29-09-2026 |

## The developer and the owner
- Once staging holds data worth keeping, apply every migration to a copy of staging before it reaches production (AGENTS §10). Before production (slice G1): the Vercel Pro plan or the client's Pro team, a production Supabase project on the paid tier, and a GitHub plan with environments.
- Send the vendor quote requests and record the answers (`docs/phase0/vendor-quotes.md`).
- Open the vendor sandboxes each spike needs: Exotel with DLT numbers, Meta WhatsApp, LiveKit, Sarvam and Anthropic (`docs/spikes/*.md`), then run the Realtime, Exotel, WhatsApp, voice and Tally spikes and record their numbers.
- Set up Amazon SES in Mumbai before production (BLUEPRINT §5, ADR 0003): verify the client's domain with DKIM, SPF and DMARC, ask AWS for production access, and create a send-only IAM user for each environment. The SES mailer behind the `Mailer` port is built (#85) and is switched on with `MAILER=ses` once the domain is verified.
- Create the files stack for dev, then staging, with `infra/aws/files.yaml` as `docs/runbooks/files-setup.md` describes (the bucket, the KMS key, the GuardDuty malware scan and the app user), and put the access key and the bucket settings in Vercel; until then uploads on the hosted sites are refused and imports keep their in-function path.
- In Sentry, on the `shakti-prime-web` project's Security and Privacy settings, turn on the Data Scrubber and Use Default Scrubbers and turn on Prevent Storing of IP Addresses (the app already removes personal data before it sends an event; these settings are the second line).
- Move the repository to a plan or organisation that protects `main` (AUDIT M45); when it moves, make a new GitHub token for that organisation.
- Review the ERD, data dictionary, permission matrix, contracts and the proposed state-machine items with the client.
- Start the Meta App Review for Lead Ads access and the Google Lead Form setup, needed by Phase 2 (ROADMAP §10).

## The client
Every client task, with who does it and which slice waits for it, is in [client-actions.md](client-actions.md): the workshop answers (first the "Blocking work now" box of `workshop-pack.md`), the CA's golden set, the design sign-off, the screen review, the letterheads and data files, the vendor accounts in the client's name (ROADMAP §10), DLT registration and Meta verification, the voice samples, real document photos and the Tally visit.

The developer walks the client's engineering contact through the technical reviews in client-actions §4: the ERD, data dictionary, permission matrix and contracts, the proposed state-machine items, and acceptance of ADRs 0007 and 0009 to 0013. The open questions of AUDIT §7 (the recorded sources of consent, consent per company, a negative moving-average cost) are asked as workshop LAW-1, LAW-2 and STOCK-2.

## The CA and vendors
- The CA confirms the place-of-supply rule, the rounding and the tax golden set (ADR 0007).
- Vendors return quotes against the volumes in the quote pack.
- The printer supplier names the thermal label printer model and label stock for the QR label check.
