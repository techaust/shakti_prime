# Hot reads under row-level security with statistics

**Question.** Do the reads people wait on stay under one second for an Executive, a General Manager and a tele-caller at the Phase 0–1 audit's volume, under row-level security, with the planner's statistics in place? The audit (2026-10, `docs/runs/phase1/audit-data.md` item 8) could measure either RLS or statistics, never both, because its data was rolled back.

**State (13-10-2026).** Met: every read below one second for every role; the slowest is ⌘K for a misspelt name as an Executive of four companies, at 715 ms. No index or policy was changed. The hosted stack is still to measure.

## How it was run
- **Database.** A scratch database `shakti_perf` on the slot's own Postgres 17 (Docker, 127.0.0.1:54337, slot 7 of the cloud day), built from every migration through the audit slice's, with pg_cron's statements left out (pg_cron lives only in the database `postgres`), and seeded. The suites' database was not touched.
- **Data**, committed, then `ANALYZE`: the audit's generator. 200,000 customers with contacts, phones and sites; 240,000 leads over four companies (half in company 1), 80 people in 16 teams; 320,792 tasks; 596,436 calls; 1,440,000 activities; 120,000 notices; 40,000 sales orders. No quote, so the ⌘K quote part reads an empty table.
- **Callers**, each with its role's seeded grants: an Executive of the four companies, a General Manager of company 1, a tele-caller (Cold Caller) of company 1, a Sales Team Lead and a Lead Converter of company 1.
- **Method.** As `app_user`, each read in its own transaction with the principal's settings set as `withRequestContext()` sets them (`app.user_id`, `app.entity_ids`, `app.role`, `app.permissions`, `app.team_id`); the read is the domain query itself (`searchLeads`, `searchQuotes`, `searchPeople`, `listLeads`, `loadAccount360`, `listNotices`, `countNotices`, `listSalesOrders`, `listCallQueue`, `loadConvertingBoard`), timed end to end, and each statement it sent is then run again under `EXPLAIN (ANALYZE, BUFFERS)`. One run, first call, on a VM shared with two other builders.

## Results
Total is the read end to end; slowest is the slowest statement's `Execution Time` under `EXPLAIN (ANALYZE, BUFFERS)`, in milliseconds.

| Read | Executive | General Manager | Tele-caller |
|---|---|---|---|
| ⌘K "Ramesh Patel" | 681 (475) | 529 (459) | 254 (169) |
| ⌘K "Rmesh" (misspelt) | 715 (732) | 619 (565) | 282 (242) |
| ⌘K "98765" (a phone's digits) | 83 (10) | 50 (7) | 47 (8) |
| Lead list | 30 (5) | 21 (3) | 21 (3) |
| Lead list by score | 26 (5) | 32 (4) | 27 (3) |
| Lead search "Suresh" | 544 (657) | 476 (456) | 226 (188) |
| Account 360 | 73 (1) | 63 (1) | 50 (1) |
| Notification centre | 14 (1) | 9 (3) | 9 (2) |
| Bell count | 3 (0.1) | 2 (0.1) | 2 (0.1) |
| Orders list | 262 (190) | 8 (1) | 15 (5) |

| Read | Caller | Total | Slowest statement |
|---|---|---|---|
| Calling queue | Tele-caller, own | 157 | 105 |
| Calling queue | Sales Team Lead, a member's | 178 | 105 |
| Calling queue | General Manager, a caller's | 129 | 117 |
| Converting board | Lead Converter | 72 | 10 |
| Converting board | General Manager | 11 | 1 |
| Converting board | Executive | 12 | 1 |

Each statement's time is in [results/hot-reads-2026-10-13.txt](results/hot-reads-2026-10-13.txt), and the table in [results/hot-reads-2026-10-13.json](results/hot-reads-2026-10-13.json); the plans themselves (1.5 MB) were read and not kept.

## What the plans show
- **⌘K and the lead search by name** spend their time in the trigram match of `app.lead_search_ids()` over 200,000 customer names (a word-similarity threshold of 0.4); the definer runs as its owner, so this part does not depend on the caller's policies, and the rest of the read is a few milliseconds. It is the read to watch as customers grow; a misspelt name costs most.
- **The orders list as an Executive** walks `sales_orders_created_idx` backwards and checks each order's customer against `account_entities` until it has 50 (56,892 buffer hits); a General Manager's and a tele-caller's narrower scopes read far fewer rows.
- **The calling queue** reads the caller's open leads and their next tasks through the owner and task indexes in two statements, as [calling.md](calling.md) found at 2,000 leads a caller.

## Still to measure
The hosted stack (Supabase Mumbai and Vercel `bom1`), a quote volume for ⌘K's quote part, and a run on a quiet machine.
