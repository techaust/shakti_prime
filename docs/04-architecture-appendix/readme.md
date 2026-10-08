# Spikes

A spike is a short, measured experiment that answers one technical question before the build relies on it. Each note is a record of its runs: what was built, how to run it, the numbers and what is still to measure. A note gains a dated status line when its state changes; its measured numbers are not rewritten. Raw results are in [results/](results/).

| Note | Question | State and date | Record or living | First run |
|---|---|---|---|---|
| [print.md](print.md) | Chromium A4 PDFs and QR labels | Rendering passed; the phone and scanner check of printed labels is open; hosting settled by ADR 0009 (07-10-2026) | Record, with a status line | 27-09-2026 |
| [ocr.md](ocr.md) | OCR masking of Aadhaar and bank account numbers | Passed on generated images; real document photos to run; vault photos are masked in the upload flow (07-10-2026) | Record | 27-09-2026 |
| [import-scale.md](import-scale.md) | 50,000 leads imported within 5 minutes | Met locally on 28-09-2026; the workbook run of 04-10-2026 on a loaded machine is inconclusive; the dev deployment to measure (07-10-2026) | Record | 28-09-2026 |
| [lists.md](lists.md) | List, board, ⌘K and Activity log latency at 50,000 leads | Met apart from short common prefixes; the hosted stack and real data to measure (04-10-2026) | Record | 29-09-2026 |
| [account360.md](account360.md) | Account 360, the timeline and the customers list | Met on the run of 04-10-2026; a quiet machine and the hosted stack to measure (04-10-2026) | Record | By 30-09-2026 (slice C2) |
| [calling.md](calling.md) | The Cold Caller queue, the workspace's lead and the team view at 2,000 leads a caller | Met on the run of 06-10-2026; the hosted stack and real calling history to measure (06-10-2026) | Record | 06-10-2026 (slice T1) |
| [realtime.md](realtime.md) | Supabase Realtime with BOS-signed tokens | Deferred to the production site with the client's domain (04-10-2026) | Living until it runs | Not run |
| [exotel.md](exotel.md) | Exotel click-to-dial on 140 and 160 numbers | Ready to run; waits for the sandbox and DLT numbers (04-10-2026) | Living until it runs | Not run |
| [whatsapp.md](whatsapp.md) | WhatsApp Cloud API send and receive | Ready to run; waits for Meta verification and a number (04-10-2026) | Living until it runs | Not run |
| [voice.md](voice.md) | LiveKit and speech latency, Roman-Hinglish pronunciation | Ready to run; waits for the sandboxes and voice samples (04-10-2026) | Living until it runs | Not run |
| [tally.md](tally.md) | Tally, the BOS side | Ready to run; waits for the Tally visit and an instance (04-10-2026) | Living until it runs | Not run |

**Catalogue plans.** `pnpm --filter @shakti/domain spike:catalogue` (`packages/domain/tests/spike/catalogue-explain.ts`) fills the local database to 5,000 catalogue items and prints the plans of the items grid and the price change log, for slice C1 (`docs/03-roadmap-appendix/phase1.md` §6.1). It prints plans only and has no note of its own.

**Quote plans.** `pnpm --filter @shakti/domain spike:quotes` (`packages/domain/tests/spike/quotes-explain.ts`) fills the local database with 20,000 quotes on 2,000 leads and prints the plans of the quote list, its ⌘K search, Account 360's quotes and the board cards, for slice S1 (`docs/03-roadmap-appendix/phase1.md` §7.3); the plans it printed are recorded in [the run file of S1](../runs/phase1/s1-quotes.md). It has no note of its own.

No spike runs in CI. The database spikes refuse any database but the local Docker Postgres; the vendor spikes run against the vendors' sandboxes; the Realtime spike is the one that runs against a hosted project, the one behind the production site.
