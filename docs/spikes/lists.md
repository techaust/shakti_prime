# Spike: list and search latency at 50,000 leads

**BLUEPRINT §6.4** ("p95 interaction < 300 ms"). Result: **the lists, the board and the Activity log meet the target; ⌘K search does not.** With 50,000 leads across the four companies, the leads list, a later page of it and the board stay under 300 ms at the 95th percentile for every caller measured, on a laptop that was busy with other work. ⌘K search by a name, a village or the last four digits of a phone takes 1.3 to 1.4 seconds for an Executive (p50) in both runs, and between about 300 ms and 1.6 seconds for a General Manager of one company. This is the baseline for the search fix that follows this spike. After that fix (migration 0052) every search case meets the target for all three callers, at 30 to 135 ms at the 95th percentile ([After the search fix](#after-the-search-fix)). The hosted stack (Vercel `bom1`, Supabase Mumbai) is not measured here; that is Phase 1.

Run it with `pnpm spike:lists` (options: `-- --leads 50000 --runs 50 --warmup 5 --keep`). It needs the local Docker Postgres and refuses any other database. The numbers of the run after the search fix are in [results/lists.json](results/lists.json); the baseline's are in the tables below. It is not part of CI.

## What it does
| Step | How |
|---|---|
| Leads | 50,000 made-up leads, 12,500 a company, built from invented syllables (4,004 names, 500 villages) with made-up mobile numbers starting with 7; 70 % Farmer Pumps, 30 % Residential Rooftop |
| Seeding | Through `commitLeadBatch`, the set-based path of the import commit (`docs/spikes/import-scale.md`), as `app_user` under RLS, 500 rows a transaction. Ten made-up tele-callers a company own 1,250 leads each. The leads are then spread over the four open stages of their pipeline and over the last year of `updated_at`, and the tables analysed, as a year of work and autovacuum would leave them |
| Callers | An Executive of all four companies; a General Manager of Shakti Supreme; one of Shakti Supreme's tele-callers, who reads only their own 1,250 leads |
| Reads | Through `executeQuery`, as the web actions call them: the leads list's first page and its 11th page (after 500 leads, from the keyset cursor), the Farmer Pumps board, the ⌘K palette's read (leads, and team members for a caller who manages users, as `actions/search.ts` makes it) by a name, a village and the last four digits of a phone, the leads half of that read alone by the name, and the Activity log's first page over the last 30 days |
| Timing | 5 untimed runs of each case, then 50 timed ones, one after another. The time is the `durationMs` of the `query.completed` line `executeQuery` writes: the transaction, the request context settings and the query, in process |
| Clean-up | Every seeded lead, customer, contact, phone, site, company link and idempotency key is deleted at the end (50,000 of each). The spike's made-up callers stay in `principals`, as the test suites' do. The events and the audit summary of the seed are kept in memory and never written |

## Numbers
Windows 11 laptop, 4 × Intel Core i3-1115G4, 8 GB, Node 24.19, Docker Postgres 17 on `127.0.0.1:54336`, one connection, in process. The database held 50,107 open leads and 535 audit rows from the last 30 days during the reads. The table is the second run (the one in the result file); the last column is the p95 of the first run, made an hour earlier with the same data, whose search terms were another made-up customer.

| Caller | Case | p50 ms | p95 ms | max ms | Rows | First run p95 ms |
|---|---|---|---|---|---|---|
| Executive, 4 companies | Leads list, first page | 31.9 | 42.0 | 44.9 | 50 | 46.3 |
| | Leads list, page 11 | 31.4 | 42.2 | 50.4 | 50 | 42.4 |
| | Board, Farmer Pumps | 127.2 | 146.3 | 153.4 | 400 | 178.8 |
| | ⌘K, name | **1,384.7** | **1,436.9** | 1,538.4 | 8 | **1,545.6** |
| | ⌘K, name, leads only | **1,362.0** | **1,415.7** | 1,426.9 | 8 | not run |
| | ⌘K, village | **1,253.0** | **1,307.2** | 1,308.6 | 8 | **1,339.8** |
| | ⌘K, phone last 4 | **1,347.1** | **2,396.8** | 4,295.5 | 5 | **1,286.7** |
| | Activity log, first page | 42.4 | 174.3 | 264.6 | 50 | 14.6 |
| General Manager, 1 company | Leads list, first page | 121.5 | **590.0** | 1,489.7 | 50 | 32.7 |
| | Leads list, page 11 | 54.7 | 100.9 | 124.5 | 50 | 32.1 |
| | Board, Farmer Pumps | 80.3 | 107.1 | 128.1 | 400 | 93.1 |
| | ⌘K, name | **761.5** | **1,162.8** | 1,446.2 | 8 | **385.9** |
| | ⌘K, name, leads only | **576.5** | **1,153.4** | 1,704.0 | 8 | not run |
| | ⌘K, village | **926.5** | **1,615.9** | 1,647.8 | 8 | **354.1** |
| | ⌘K, phone last 4 | **1,260.2** | **2,437.6** | 2,566.8 | 2 | **338.3** |
| | Activity log, first page | **397.8** | **644.3** | 815.8 | 50 | 10.5 |
| Tele-caller, own leads | Leads list, first page | 259.5 | **495.8** | 603.6 | 50 | 26.1 |
| | Leads list, page 11 | 65.1 | 150.3 | 403.9 | 50 | 26.6 |
| | Board, Farmer Pumps | 151.4 | 246.7 | 273.0 | 400 | 68.4 |
| | ⌘K, name | 287.8 | **413.8** | 509.2 | 8 | 67.4 |
| | ⌘K, name, leads only | 268.1 | **329.9** | 436.7 | 8 | not run |
| | ⌘K, village | 250.4 | **338.4** | 395.7 | 8 | 70.7 |
| | ⌘K, phone last 4 | 159.6 | **316.8** | 662.3 | 1 | 60.4 |
| | Activity log | not allowed to the role | | | | not allowed |

Bold marks a time over the 300 ms target. The database round trip (the median of fifty `select 1` in one transaction) was 1.13 ms in the first run and 0.69 ms in the second.

**The machine was not quiet.** Other workstreams ran their test suites against their own Postgres containers on the same four-core laptop during both runs, and the processor was at 100 % when the second run ended. The General Manager's and the tele-caller's cases were 2 to 10 times slower in the second run than in the first, with the same data and code, so their second-run times measure the contention as much as the queries. The Executive's search times were the same in both runs (1.3 to 1.5 s), so they are the query's own cost. A run on a quiet machine, and on the hosted stack, should be the reference before any number here is quoted as final.

## What fails the 300 ms target
- **⌘K search for an Executive: every kind, in both runs.** 1.3 to 1.4 s at the median by name, village or phone. The leads half alone costs the same (1,362 ms against 1,385 ms), so the team-member search is not the cost. The Executive reads all four companies with no owner or team narrowing, so the search most likely tests the name, village, contact-name and phone conditions against every one of the 50,000 visible leads under their row-level policies before it orders and keeps eight, since the trigram indexes cannot serve one `or` that spans the customer, the site and the contacts. No query plan was taken in this spike to confirm it. This is the slow search already known, and the fix that follows this spike should be measured again with `pnpm spike:lists`.
- **⌘K search for a General Manager of one company: over the target in both runs** (p95 338 to 386 ms in the first, 1.2 to 2.4 s under contention in the second). The same cause on 12,500 leads.
- **⌘K search by the last digits of a phone** is not indexed (as `search-leads.ts` says) and was the least steady case, with the longest single call (4.3 s) of the whole run.
- **Under contention only:** the General Manager's and the tele-caller's first page of the leads list, the tele-caller's search and the General Manager's Activity log went over the target in the second run and not in the first. They are not counted as failures of the queries here; the quiet-machine run will settle them.

The leads list (first and later pages), the board and the Activity log met the target for every caller in the first run, and the Executive's in both.

## After the search fix
⌘K search now takes its candidates from `app.lead_search_ids()` (migration 0052), a security-definer lookup that uses the trigram indexes on `accounts.name`, `contacts.name` and `customer_sites.village` and the index on `contact_phones.e164_reversed` (0051), keeps to the leads and customers the caller may read by the same rules as the policies, and returns only the ids of the first matches in the search's own order. The search then reads those leads under the policies with all its own conditions (`search-leads.ts`), so its answers are the same as before: `tests/queries/search-equivalence.test.ts` compares them with the previous query for eight callers and twelve texts. A spelling match on a common surname resembles thousands of names (the name searched here resembles 7,450 of the 50,000 at the 0.4 threshold), so the lookup first asks the indexes for names and villages that start with the text or resemble it at 0.9, 0.7 and 0.55, and scores every match only when none of those narrow passes finds enough leads.

Same laptop, seed, callers and search terms as above, on the local Docker Postgres at `127.0.0.1:54337`; round trip 0.64 ms; 50,113 open leads and 112 audit rows from the last 30 days during the reads. Other workstreams were running on the laptop, as in the baseline. The last column is the p95 of a run of the previous code on the same database an hour earlier, busier than this one.

| Caller | Case | p50 ms | p95 ms | max ms | Rows | Before the fix, p95 ms |
|---|---|---|---|---|---|---|
| Executive, 4 companies | Leads list, first page | 32.9 | 41.9 | 44.7 | 50 | 53.4 |
| | Leads list, page 11 | 33.7 | 51.1 | 61.3 | 50 | 205.3 |
| | Board, Farmer Pumps | 145.4 | 215.9 | 379.8 | 400 | 158.4 |
| | ⌘K, name | 45.7 | 50.9 | 61.1 | 8 | **2,679.4** |
| | ⌘K, name, leads only | 45.3 | 77.2 | 232.6 | 8 | **5,785.3** |
| | ⌘K, village | 75.7 | 97.1 | 135.3 | 8 | **3,883.4** |
| | ⌘K, phone last 4 | 29.3 | 39.5 | 51.2 | 5 | **4,152.5** |
| | Activity log, first page | 14.9 | 35.2 | 104.9 | 50 | 71.4 |
| General Manager, 1 company | Leads list, first page | 25.2 | 34.0 | 44.8 | 50 | 87.4 |
| | Leads list, page 11 | 25.5 | 31.8 | 38.6 | 50 | 264.3 |
| | Board, Farmer Pumps | 68.4 | 82.4 | 88.0 | 400 | **447.1** |
| | ⌘K, name | 37.7 | 44.6 | 53.0 | 8 | **1,794.2** |
| | ⌘K, name, leads only | 38.9 | 47.0 | 47.8 | 8 | **1,078.7** |
| | ⌘K, village | 62.5 | 109.0 | 147.0 | 8 | **2,815.2** |
| | ⌘K, phone last 4 | 42.3 | 64.3 | 75.2 | 2 | **1,301.6** |
| | Activity log, first page | 13.3 | 49.1 | 111.4 | 50 | 24.8 |
| Tele-caller, own leads | Leads list, first page | 42.6 | 86.0 | 106.3 | 50 | 139.5 |
| | Leads list, page 11 | 35.0 | 84.7 | 253.9 | 50 | 185.5 |
| | Board, Farmer Pumps | 69.5 | 105.5 | 125.2 | 400 | 200.4 |
| | ⌘K, name | 80.2 | 134.7 | 291.7 | 8 | **423.0** |
| | ⌘K, name, leads only | 75.7 | 95.4 | 103.1 | 8 | 187.9 |
| | ⌘K, village | 40.5 | 46.5 | 58.2 | 8 | 104.5 |
| | ⌘K, phone last 4 | 25.1 | 30.3 | 32.5 | 1 | 50.3 |
| | Activity log | not allowed to the role | | | | |

Bold marks a time over the 300 ms target. Every case now meets it. The Executive's ⌘K by name includes the team-member search an admin also gets; it costs 6 to 20 ms at this size (`users` holds the staff, a few hundred rows at most), so `searchPeople` needs no change.

Texts the spike does not time, measured afterwards on the same data with the same timing (20 runs, leads half of the palette, p50 and p95 in ms): a first name (`Kevok`) or a short common one (`Ram`) takes 35 to 100 for every caller; two letters (`Ra`) take 261 and 467 for the Executive, 89 and 164 for the General Manager and 47 and 49 for the tele-caller; three letters that begin the surname a seventh of these made-up customers share (`Kan`, which resembles 7,150 names at 0.7) take 302 and 1,616 for the Executive, 232 and 248 for the General Manager and 190 and 281 for the tele-caller. Short texts that match a large share of the company still score every match they find and are the slowest searches; real surnames are spread far wider than the seven the spike invents, and the palette should be measured again with the client's imported leads.

## Not covered
- The hosted stack: the round trip from a Vercel function in `bom1` to Supabase Mumbai, the connection pooler and a cold function.
- Concurrent callers: every read ran alone, one after another, on one connection.
- A large audit trail: the Activity log read 535 rows of the last 30 days; months of real activity will hold far more, and the page should be measured again then.
- The server action around the query (session check, principal resolution), the network to the browser and rendering; the 300 ms target is for the whole interaction.
