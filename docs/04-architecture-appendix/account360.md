# Spike: Account 360, the timeline and the customers list

**PRD CRM-07** ("loads in < 300 ms p95 for accounts with 1,000 activities") and BLUEPRINT §6.4. Status (04-10-2026): **met on the run of 04-10-2026 for every caller**, through the `app_reader` pool, on a shared machine; the final measure is taken by the lead engineer on a quiet machine at integration, and on the hosted stack. Owner: the lead engineer. Slice C2 (#89).

Run it with `pnpm spike:account360` (`packages/domain/tests/spike/account360.ts`; options `-- --activities 1000 --customers 5000 --runs 100 --warmup 10 --keep`). It needs the local Docker Postgres and is not part of CI. [results/account360.json](results/account360.json) holds the run of 04-10-2026, with its full plans.

## What it does
- **Seed:** as `app_user`, through the import commit's set-based lead path, 5,000 made-up customers of company 1, each with one lead owned by one made-up tele-caller of one team, and one more customer with five leads.
- **Timeline rows:** as the migrator, five timeline rows for each background customer and 1,001 for the one customer, half on its leads and half on the customer, spread over the last six months; rows older than the current month land in the default partition, the rest in the current month's.
- **Callers:** the team lead of that team, the General Manager of the company and the tele-caller who owns the leads.
- **Timing:** through `executeQuery`, 10 untimed and 100 timed runs per case; the time is the `durationMs` of the `query.completed` line.
- **Clean-up:** the spike removes its customers and leads at the end unless `--keep` is given; their timeline rows stay, since the timeline is append-only. A local database left with them slows other suites' imports past their time limit.

## Runs
Three runs are recorded; dates are in IST.
- **04-10-2026** (the one in `results/account360.json`): through the `app_reader` pool as the app reads (`DATABASE_URL_READER` set), over 5,001 made-up customers and 31,585 timeline rows, on a machine (4 cores, 8 GB) shared with two other building agents, the CPU at 93 % when sampled after the run. Every case was under 300 ms at the 95th percentile for all three callers.
- **30-09-2026:** shared the machine with two other builds, the CPU at 100 % throughout, so its 95th percentiles are the machine's queueing as much as the queries. It kept what it seeded and read 20,000 made-up customers and 157,000 timeline rows.
- **The quiet run** (its date is not recorded): before the customers search had its candidate lookup, so its search numbers are not comparable and are left out.

The runs of 30-09-2026 and the quiet run are recorded here only; their raw results were not kept, so their numbers cannot be checked again.

### Run of 04-10-2026, through `app_reader`, machine shared
| Caller | Account 360 p50 / p95 ms | Timeline page 2 p50 / p95 ms | One lead's timeline p50 / p95 ms | Customers list p50 / p95 ms | Search by name p50 / p95 ms | Search by phone p50 / p95 ms |
|---|---|---|---|---|---|---|
| Team lead | 98.6 / 170.9 | 17.8 / 34.7 | 10.4 / 18.2 | 62.9 / 107.7 | 98.8 / 154.5 | 80.6 / 166.3 |
| General Manager, 1 company | 108.6 / 170.4 | 15.2 / 26.5 | 17.1 / 29.1 | 58.4 / 85.2 | 124.9 / 180.9 | 110.4 / 182.3 |
| Tele-caller, own leads | 97.8 / 141.5 | 15.4 / 22.9 | 12.2 / 21.8 | 66.3 / 93.9 | 122.0 / 244.6 | 113.4 / 150.2 |

### Run of 30-09-2026, CPU at 100 %
| Caller | Account 360 p50 / p95 ms | Timeline page 2 p50 / p95 ms | One lead's timeline p50 / p95 ms | Customers list p50 / p95 ms | Search by name p50 / p95 ms | Search by phone p50 / p95 ms |
|---|---|---|---|---|---|---|
| Team lead | 141.9 / **783.7** | 105.3 / 218.4 | 13.3 / 25.3 | 95.6 / **468.6** | **356.6** / **670.7** | 167.0 / 279.4 |
| General Manager, 1 company | 136.2 / **410.6** | 28.2 / 72.1 | 16.7 / 47.8 | 111.7 / **530.4** | 109.6 / **472.2** | 102.6 / 162.1 |
| Tele-caller, own leads | 148.1 / **420.0** | 16.9 / 44.8 | 8.8 / 12.3 | 110.8 / **305.1** | 125.5 / 241.3 | 55.9 / 111.2 |

Bold marks a time over the 300 ms target.

### The quiet run
At the 50th / 95th percentile: Account 360 at 70.2 / 124.7 ms (team lead), 52.1 / 67.1 ms (General Manager) and 92.3 / 252.0 ms (tele-caller); the second timeline page at 12.8 / 177.2, 9.2 / 12.5 and 17.0 / 55.5 ms. Account 360 and the timeline were under 300 ms at the 95th percentile.

## Why the pages are fast
**Account 360** is about a dozen short reads in one transaction (the customer, contacts, phones, sites, leads, tasks, consents, tags and the first timeline page). Each costs 1 to 6 ms to plan through the customer policies and well under 1 ms to run, so the page's time is mostly planning and round trips, which grow with the machine's load, not with the customer's 1,000 rows.

**The timeline page** reads 26 rows off `activities_account_created_idx` in each monthly partition and merges them: for the team lead, 1.8 ms planning and 0.35 ms execution on the quiet run, 8.2 ms and 1.0 ms on the shared machine of 04-10-2026. The plan is in [results/account360-timeline-plan.txt](results/account360-timeline-plan.txt).
- Without that, the planner turns the read policy's `exists` on the lead into a hashed subplan, which reads every lead the caller may read once for each partition before the first row (5,005 leads for the tele-caller: 11 ms, growing with a company's leads and the months kept).
- Each `exists` of the policy also tests the row's own `opportunity_id`, a condition on the outer row that is not an equality, so the planner keeps the per-row index probe: 0.25 ms of execution for the same caller instead of 11 ms.

**The customers search** takes its candidates from `app.customer_search_ids()`, which uses the trigram indexes on customer, contact and village names and the index on the phone written backwards, keeps to the customers the caller may read, and returns at most 201 ids (the list shows 200 and says when there were more). The list then tests each candidate under the policies with correlated conditions.
- Without it, a search tests every contact and site of the caller's scope row by row through the customer policies (a General Manager: a sequential scan of 15,000 contacts at 99 ms, and 230 ms in all at 10,000 customers).
- The General Manager's plan with it: 26 ms planning and 141 ms execution on the loaded machine of 30-09-2026, 127 ms of it inside the lookup; 16.5 ms planning and 24.6 ms execution on 04-10-2026. The plan of 30-09-2026 is in [results/account360-customers-search-plan.txt](results/account360-customers-search-plan.txt).
- Inside the lookup, run as its owner at a quiet moment, the name branch is a bitmap scan of `accounts_name_trgm_idx` and `contacts_name_trgm_idx` (444 matches each) and 45 ms in all, most of it a hash join over `account_contacts`.
- `Spike customer 42` matches 555 of the made-up customers, so it is a broad search; the list shows the first 50 by name of the first 200 found.
- The search looks for a name from three characters and a phone from four digits, and the list says when a search found more than the 200 customers it lists.

## Still to measure
The customers list and its search are measured again by the lead engineer on a quiet machine at integration, on the hosted stack, and on the client's imported customers.
