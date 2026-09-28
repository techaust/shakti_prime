# Spike: list and search latency at 50,000 leads

**BLUEPRINT §6.4** ("p95 interaction < 300 ms"). Result: **the lists, later pages, the board and the Activity log meet the target for every caller measured; ⌘K search meets it for the texts the spike types apart from short bursts of slow calls, and short common prefixes do not.** With 50,000 leads across the four companies, every case in the table stays under 300 ms at the 95th percentile in at least one of two runs made one after the other, and 20 of the 23 cases in both. Three cases go over once: the tele-caller's ⌘K by name (506 ms) and by village (366 ms) in the run in the table, and the Executive's ⌘K by the last four digits of a phone (301 ms) in the run before it. The same search by name, leads only, takes 92 ms at the 95th percentile for the tele-caller in the same run, so those misses are bursts on a busy machine rather than the cost of the query. The Executive's board is the slowest steady read, at 293 ms. A short text that begins the names of a large share of the customers is slower: an Executive typing `Kan` waits 607 ms at the median and 631 ms at the 95th percentile ([Short prefixes](#short-prefixes)). The hosted stack (Vercel `bom1`, Supabase Mumbai) is not measured here; that is Phase 1.

Run it with `pnpm spike:lists` (options: `-- --leads 50000 --runs 50 --warmup 5 --keep`). It needs the local Docker Postgres and refuses any other database. [results/lists.json](results/lists.json) holds the run in the table below. It is not part of CI.

## What it does
| Step | How |
|---|---|
| Leads | 50,000 made-up leads, 12,500 a company, built from invented syllables (4,004 names, 500 villages) with made-up mobile numbers starting with 7; 70 % Farmer Pumps, 30 % Residential Rooftop |
| Seeding | Through `commitLeadBatch`, the set-based path of the import commit (`docs/spikes/import-scale.md`), as `app_user` under RLS, 500 rows a transaction. Ten made-up tele-callers a company own 1,250 leads each. The leads are then spread over the four open stages of their pipeline and over the last year of `updated_at`, and the tables analysed, as a year of work and autovacuum would leave them |
| Callers | An Executive of all four companies; a General Manager of Shakti Supreme; one of Shakti Supreme's tele-callers, who reads only their own 1,250 leads |
| Reads | Through `executeQuery`, as the web actions call them, each in a read-only transaction: the leads list's first page and its 11th page (after 500 leads, from the keyset cursor), the Farmer Pumps board, the ⌘K palette's read (leads, and team members for a caller who manages users, as `actions/search.ts` makes it) by a name, a village and the last four digits of a phone, the leads half of that read alone by the name, and the Activity log's first page over the last 30 days |
| Timing | 5 untimed runs of each case, then 50 timed ones, one after another. The time is the `durationMs` of the `query.completed` line `executeQuery` writes: the transaction, the request context settings and the query, in process |
| Clean-up | Every seeded lead, customer, contact, phone, site, company link and idempotency key is deleted at the end (50,000 of each). The spike's made-up callers stay in `principals`, as the test suites' do. The events and the audit summary of the seed are kept in memory and never written |

## How ⌘K search finds its leads
⌘K search takes its candidates from `app.lead_search_ids()` (migration 0052), a security-definer lookup that uses the trigram indexes on `accounts.name`, `contacts.name` and `customer_sites.village` and the index on `contact_phones.e164_reversed` (0051), keeps to the leads and customers the caller may read by the same rules as the policies, and returns the ids of at most 200 leads in the search's own order. The search then reads those leads under the policies with all its own conditions (`search-leads.ts`); `tests/queries/search-equivalence.test.ts` holds it to a plain query over the policies with the same conditions, which must answer the same leads in the same order. A spelling match on a common surname resembles thousands of names, so the lookup first asks the indexes for names and villages that start with the text or resemble it at 0.9, 0.7 and 0.55, and scores every match only when none of those narrow passes finds enough leads.

## Numbers
Windows 11 laptop, 4 × Intel Core i3-1115G4, 8 GB, Node 24.19, Docker Postgres 17 on `127.0.0.1:54348`, one connection, in process. The search terms are the made-up customer `Kevok Kantarvi`, the village `Gondovan` and the digits `7919`. The database held 50,197 open leads (the spike's 50,000 and the test suites' own) and 710 audit rows from the last 30 days during the reads; the round trip (the median of fifty `select 1` in one transaction) was 1.48 ms, and 0.59 ms in the run before.

No other workstream's tests ran on the laptop during the runs. The processor was still busy: sampled every 10 seconds during the reads of the run in the table, its load was between 27 and 100 %, well above the one core a single connection uses, from the spike's own process, Docker and the database's background work. What made the slow bursts was not identified.

The table is the second of two runs made one after the other on the same code and the same seed (21:22 UTC on 28-09-2026); the last column is the 95th percentile of the first.

| Caller | Case | p50 ms | p95 ms | max ms | Rows | Run before, p95 ms |
|---|---|---|---|---|---|---|
| Executive, 4 companies | Leads list, first page | 19.1 | 35.4 | 44.9 | 50 | 46.0 |
| | Leads list, page 11 | 18.8 | 26.3 | 31.9 | 50 | 26.5 |
| | Board, Farmer Pumps | 95.6 | 293.4 | 307.3 | 400 | 222.7 |
| | ⌘K, name | 50.7 | 98.2 | 217.3 | 8 | 93.7 |
| | ⌘K, name, leads only | 66.0 | 208.8 | 343.7 | 8 | 48.4 |
| | ⌘K, village | 88.8 | 211.4 | 254.6 | 8 | 197.3 |
| | ⌘K, phone last 4 | 35.3 | 54.5 | 70.0 | 5 | **300.7** |
| | Activity log, first page | 7.0 | 11.9 | 12.8 | 50 | 10.6 |
| General Manager, 1 company | Leads list, first page | 17.9 | 26.5 | 30.0 | 50 | 33.8 |
| | Leads list, page 11 | 22.5 | 45.8 | 115.9 | 50 | 51.8 |
| | Board, Farmer Pumps | 41.9 | 52.2 | 56.0 | 400 | 79.1 |
| | ⌘K, name | 44.5 | 56.0 | 67.2 | 8 | 41.9 |
| | ⌘K, name, leads only | 44.3 | 48.3 | 50.9 | 8 | 37.0 |
| | ⌘K, village | 53.4 | 65.2 | 73.2 | 8 | 52.1 |
| | ⌘K, phone last 4 | 32.0 | 38.5 | 47.1 | 2 | 38.4 |
| | Activity log, first page | 6.6 | 9.9 | 13.3 | 50 | 7.5 |
| Tele-caller, own leads | Leads list, first page | 17.7 | 23.2 | 26.5 | 50 | 18.3 |
| | Leads list, page 11 | 17.7 | 19.5 | 21.6 | 50 | 27.2 |
| | Board, Farmer Pumps | 47.5 | 108.1 | 114.1 | 400 | 38.1 |
| | ⌘K, name | 109.2 | **506.3** | 553.9 | 8 | 69.6 |
| | ⌘K, name, leads only | 78.4 | 91.7 | 93.3 | 8 | 66.4 |
| | ⌘K, village | 45.9 | **365.6** | 482.1 | 8 | 44.2 |
| | ⌘K, phone last 4 | 31.8 | 34.9 | 56.1 | 1 | 37.8 |
| | Activity log | not allowed to the role | | | | |

Bold marks a time over the 300 ms target. The Executive's ⌘K by name includes the team-member search an administrator also gets; for the tele-caller, who manages no one, the palette's read by name and the leads half alone are the same query.

## What meets and what misses 300 ms
- **Meets in both runs:** the leads list, first page and page 11, for every caller; the board for every caller; the Activity log for the Executive and the General Manager; every ⌘K case of the General Manager; the Executive's ⌘K by name, by name for leads only, and by village.
- **Close to the target:** the Executive's board, 293 ms at the 95th percentile and 307 ms at most in the run in the table (223 ms in the run before). It reads 400 cards over four companies.
- **Over the target once, in one run of two:** the tele-caller's ⌘K by name (506 ms) and by village (366 ms), and the Executive's ⌘K by phone (301 ms in the run before). Their medians stay between 35 and 110 ms, and the same query in the same run (the tele-caller's leads-only search by name) stays at 92 ms, so these are bursts of slow calls on a busy machine; a quiet machine and the hosted stack should settle them.
- **Over the target by the kind of text:** short prefixes of common names, below.

## Short prefixes
Timed with a copy of the spike script that seeds the same 50,000 leads and times only these two texts (the copy is not kept in the repository), after the two runs above: the leads half of the palette alone, with the same timing, 5 untimed and 20 timed runs per caller and text:

| Caller | `Ra` p50 ms | `Ra` p95 ms | `Kan` p50 ms | `Kan` p95 ms |
|---|---|---|---|---|
| Executive, 4 companies | 209.1 | 225.4 | **606.6** | **630.6** |
| General Manager, 1 company | 181.5 | 203.4 | 166.4 | **575.4** |
| Tele-caller, own leads | 51.2 | 69.3 | 115.5 | 157.4 |

`Ra` begins the first name of one in thirteen of these made-up customers, and `Kan` begins `Kantarvi`, the surname of one in seven. A short text that matches a large share of what the caller may read leaves the narrow passes too few leads, so the lookup scores every match it finds, and that is the slowest search: an Executive over four companies waits about 0.6 seconds for `Kan`. Real surnames are spread far wider than the seven the spike invents, so ⌘K search is measured again on the client's imported leads in Phase 1 (ROADMAP §3).

## Not covered
- The hosted stack: the round trip from a Vercel function in `bom1` to Supabase Mumbai, the connection pooler and a cold function.
- Concurrent callers: every read ran alone, one after another, on one connection.
- A large audit trail: the Activity log read 710 rows of the last 30 days; months of real activity will hold far more, and the page is measured again then.
- The server action around the query (session check, principal resolution), the network to the browser and rendering; the 300 ms target is for the whole interaction.
