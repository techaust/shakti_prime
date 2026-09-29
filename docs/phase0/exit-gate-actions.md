# Phase 0 exit gate: who does what next

Phase 0 was closed on 29-09-2026 by the owner's decision, and Phase 1 has started. The items below that are not met are deferred and run alongside Phase 1; this page lists each by who acts next, with the document that says exactly what is needed. The hosted environments exist: Supabase dev (`shakti-prime-dev`) and staging (`shakti-prime-staging`) in Mumbai, migrated through 0060 and seeded by the *Migrate a hosted database* workflow; Vercel projects `shakti-prime-dev` and `shakti-prime-staging` in `bom1` on the Hobby plan (Pro, or the client's Pro team, before production); Upstash Redis per environment in Mumbai; QStash in the EU region with the minute schedule on staging; Cloudflare Turnstile for both hostnames; the first Executive on staging.

## Exit gate, item by item
| Item (ROADMAP §2) | State | Next step |
|---|---|---|
| Security suite green for every core table, with fail-closed and cost-gate tests | Met | None |
| DESIGN.md and the preview page signed off by the client | Deferred | The client signs off `DESIGN.md` and `/design` with `docs/phase0/design-signoff.md` |
| All seven spikes passed, with written results and latency numbers | Partly met, rest deferred | Print and QR labels passed their rendering checks, with the phone and scanner check of printed labels still open; OCR masking passed on generated photos. Tally, Exotel, WhatsApp and voice have harnesses ready to run; Realtime runs on the production site with the client's domain. Each `docs/spikes/*.md` says what it needs |
| ERD, data dictionary, state machines, permission matrix and API contracts reviewed | Deferred | The developer and the client review `docs/data/`, `docs/state-machines/` (the items marked proposed), SECURITY §3.2 and `packages/contracts/src/api` |
| Vendor quotes confirm the §13 cost figures | Deferred | The developer sends the requests in `docs/phase0/vendor-quotes.md` and records the answers |
| Phase 0 tooling installed and verified; `currentPhase` set to 1 | Met | `currentPhase` set to 1 on 29-09-2026 |

## The developer
- The hosted dev and staging environments are created (29-09-2026). Once staging holds data worth keeping, apply every migration to a copy of staging before it reaches production (AGENTS §10). Before production: the Vercel Pro plan or the client's Pro team, a production Supabase project on the paid tier, and a GitHub plan with environments.
- Send the vendor quote requests and record the answers (`docs/phase0/vendor-quotes.md`).
- Open the vendor sandboxes each spike needs: Exotel with DLT numbers, Meta WhatsApp, LiveKit, Sarvam and Anthropic (`docs/spikes/*.md`), then run the Realtime, Exotel, WhatsApp, voice and Tally spikes and record their numbers.
- Set up Amazon SES in Mumbai before production (BLUEPRINT §5, ADR 0003): verify the client's domain with DKIM, SPF and DMARC, ask AWS for production access, and create a send-only IAM user for each environment. The SES mailer behind the `Mailer` port is a small Phase 1 slice.
- Move the repository to a plan or organisation that protects `main` (AUDIT M45); when it moves, make a new GitHub token for that organisation.
- Review the ERD, data dictionary, permission matrix, contracts and the proposed state-machine items with the client.
- Start the Meta App Review for Lead Ads access and the Google Lead Form setup, needed by Phase 2 (ROADMAP §10).

## The client
- Answer the questions in `docs/phase0/workshop-pack.md`, including the tax rates, the numbering format, the nurture cadence and the lock period.
- Sign off `DESIGN.md` and the preview page (`docs/phase0/design-signoff.md`).
- Send one or two staff per role to the screen review, using the real screens and the prototype (`docs/phase0/wireframe-review.md`).
- Arrange the Tally discovery visit and a copy of one company's data.
- Provide real, consented document photos for the OCR run and 20 to 30 voice samples.
- Register the vendor accounts in the client's name: domain, Vercel, Supabase, AWS, Meta, Exotel, Anthropic, Google Play, GitHub, LiveKit, Upstash and Sentry (ROADMAP §10).
- Start DLT registration for all four companies, with the 140- and 160-series numbers through Exotel, and the Meta Business verification with one WhatsApp number per company; both are needed by Phase 2 (ROADMAP §10).
- Accept ADRs 0007 and 0009 to 0013 after review, and answer the open questions in AUDIT §7: the recorded sources of consent, consent per company, and how a negative moving-average cost is handled.

## The CA and vendors
- The CA confirms the place-of-supply rule, the rounding and the tax golden set (ADR 0007).
- Vendors return quotes against the volumes in the quote pack.
- The printer supplier names the thermal label printer model and label stock for the QR label check.
