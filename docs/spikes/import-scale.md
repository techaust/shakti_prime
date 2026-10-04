# Spike: importing 50,000 leads

**Design §8 and IMP-01** ("50k rows in < 5 min"). Measured 28-09-2026 at commit `bfbd03f5`; the batch time limit came later (#70) and is not re-measured. Result: **met on the development laptop with one worker.** 50,000 made-up leads went through upload, preview and commit in 3 minutes 25 seconds, the commit alone in 3 minutes 4 seconds (272 rows a second), and the rollback took 8 seconds. Row by row, one lead command at a time, the commit runs at about 11 rows a second, which would take over an hour; the set-based batch described below makes the difference. The hosted stack (QStash workers in `bom1`, Supabase Mumbai, the 30 seconds for which each worker call starts batches) is not measured here; that is Phase 1.

Run it with `pnpm spike:import` (options: `-- --rows 50000 --batch 500 --budget 420 --dedupe 5000`, and `--csv` for a CSV file instead of a workbook). It needs the local Docker Postgres and refuses any other database. The numbers of the set-based run of 28-09-2026 are in [results/import-scale.json](results/import-scale.json), those of the row-by-row run in [results/import-scale-before.json](results/import-scale-before.json), and those of the workbook run of 04-10-2026 (below) in [results/import-scale-xlsx.json](results/import-scale-xlsx.json) with its plan in [results/import-dedupe-plan.txt](results/import-dedupe-plan.txt). It is not part of CI.

## What it does
| Step | How |
|---|---|
| File | A made-up file built in memory: invented names and villages put together from syllables, made-up mobile numbers starting with 7, columns Name, Mobile and Village; a CSV (1.86 MB for 50,000 rows) in the run of 28-09-2026, a workbook written with ExcelJS's streaming writer (1.2 MB) since 04-10-2026, read by `parseImportFile` as the server reads an uploaded file and recorded as a checked upload |
| Caller | A General Manager of Shakti Supreme made with the testing helpers, which is why the script lives in `packages/domain/tests/spike/import-scale.ts` |
| Commands | `imports.job.create` → `imports.job.map` → `imports.job.preview` → `imports.job.commit` → `imports.job.commit_batch` in batches of 500 (one transaction each, as the import worker runs them) → `imports.job.rollback`, all through `executeCommand` as `app_user`, with RLS, the audit rows, the events and the dedupe suggestions (phone, then name and village) |
| Round trip | The median of fifty `select 1` in one transaction |

## Where the time went
Profiled on 500 committed rows with `pg_stat_statements` and a Node CPU profile, the database otherwise quiet:

| Measure | Result |
|---|---|
| Commit of 500 rows, wall time | 23.1 s (21.6 rows a second, 46 ms a row) |
| Time the database spent executing statements in that run | 1.9 s, 8 % of the wall time |
| Statements a row | 12: the pipeline, first open stage and lead source lookups, the idempotency key's claim and answer, and 7 inserts (account, company relationship, contact, account link, phone, site, opportunity) |
| Slowest statements | the inserts into `account_contacts` and `opportunities` at 0.5 ms each; the others 0.2 to 0.4 ms |
| Node CPU profile | 10.5 s of 15.4 s idle, waiting on the database; the JavaScript work (validation, input hashes, the lead answer) under 1 s |

Each row ran `crm.lead.create` through `ctx.run` inside the batch's savepoint, one statement at a time. The statements are cheap; the cost is the round trip of each one between Node and the database (about 3.5 ms a statement in that run, including the driver's work), twelve times a row. The audit is one row a batch, the events one insert a batch, and no numbering function is called for a lead, so none of those was the cost.

## The set-based batch
`imports.job.commit_batch` makes the whole batch in a few statements (`commitLeadBatch` in `packages/domain/src/imports/commit-leads.ts`):
- The lookups are made once for the batch.
- The 500 keys `import:{job}:{row}` are claimed in one insert, with the input hash `crm.lead.create` would store.
- The account, company relationship, contact, account link, phone, site and opportunity rows go in as seven multi-row inserts, in the command's order, as `app_user` under the same policies.
- The keys' answers (the lead each key replays) are written in one update, and one `crm.lead.created` event is emitted a row.

That is about 13 statements a batch instead of about 6,000.

The guarantees:
- A batch is all or nothing (IMP-01: "a failed batch leaves no partial data"), with one exception: a row whose number belongs to a customer a colleague looks after in the company is marked invalid (`customer_held_by_colleague`) and the rest of the batch goes on (0055).
- If anything in the batch is not a plain new lead (a known customer, a consent, a key used before, a row that does not parse) or the database refuses a row, the savepoint takes the batch back. The batch then runs again row by row through `crm.lead.create`, which stops at the row at fault and records it; a row refused for a colleague's customer is marked and passed over. A batch keeps to 20 seconds from its start: the set-based try has one deadline across its statements, 3 seconds before the end, each statement's time limit being the time left; when it is cut off or not made, a row-by-row slice runs for at most 3 seconds, stopping between rows, keeps the rows done as that batch, and leaves the rest to the next one (design §6.3).
- Each row is a customer of its own, as a lead typed in is. A matching name, or a number of a customer the importer may act for, stays a suggestion; a number a colleague's customer holds is refused as above.

The security suite covers these cases (`packages/domain/tests/commands/imports.test.ts`):
- a bad row at the end of a batch and one in the middle;
- rows sharing a customer's number, name and village with each other and with an existing customer;
- the replay of a row's key through `crm.lead.create`.

## Numbers
Windows 11 laptop, Node 24.19, Docker Postgres 17 on `127.0.0.1:54322`, shared with the test suites, one connection, in process.

| Measure | Row by row | Set-based batch |
|---|---|---|
| Round trip to the database | 1.36 ms | 1.39 ms |
| Create the job, 50,000 rows | 25.1 s | 12.3 s |
| Preview, 50,000 rows | 29.9 s (1,673 rows/s) | 9.1 s (5,525 rows/s) |
| Commit | 1,000 rows in 89.0 s (11.2 rows/s, 89 ms a row) | 50,000 rows in 183.9 s (272 rows/s, 4 ms a row) |
| One batch of 500 | 34.6 to 54.5 s | median 1.3 s, slowest 17.2 s |
| Roll back | 1,000 rows in 0.78 s | 50,000 rows in 8.3 s |
| Upload, preview and commit of 50,000 rows | about 75 minutes (projected) | 3 min 25 s (measured) |

Both runs used the local database the test suites share, as both result files record. The row-by-row run's create and preview times were taken while other workstreams ran their test suites on it; what else ran during the set-based run was not recorded, so the create and preview gains in the table are not claimed for the set-based batch. The commit gain comes from the set-based batch: row by row, in the profile above with the database otherwise quiet, 500 rows committed at 21.6 rows a second, against 272 rows a second set-based. The slowest batch (17.2 s) was one of a few slow ones between 20,000 and 25,000 rows, and between 35,000 and 40,000; what else ran on the database at those moments was not recorded.

## What the numbers mean
- **The five-minute target is met locally with one worker.** Concurrent batch workers (design §8) are not needed for it at this rate. Batches of one job run one after another, because the job row is locked per batch.
- **Hosted.** Each worker call starts batches for 30 seconds (the route may run for 60), so it fits about 23 batches at the median rate. A hosted round trip within `bom1` should be close to the local one, but that has to be measured on the hosted stack in Phase 1.
- **The row-by-row path remains for the rows it is needed for.** A batch that holds a bad row costs its set-based try plus row-by-row runs at about 21 rows a second, each stopping between rows once its 20 seconds are spent, until the row at fault stops the job.

## Not covered
- The hosted stack: QStash workers, Supabase Mumbai and the 30 seconds for which each worker call starts batches.
- Concurrent batch workers on one job, which the job lock does not allow.
- Files with invalid or repeated rows at scale; the security suite covers those paths on small files.

## The workbook read as a stream, and the name-and-village search (04-10-2026, local)
Measured at the head of `feat/p2b-imports` on the owner's PC (Windows 11, 8 GB of memory, Node 24.19, Docker Postgres 17 of the slice's worktree on `127.0.0.1:54341`), one connection, in process. **The machine was saturated during the run**: the processor at 100 %, 345 MB of memory free, other worktrees' builds and suites running and Docker restarted shortly before after running out of memory. The round trip to the database was 4.68 ms, against 1.39 ms on 28-09-2026, and the commit times below measure that load as much as the code. The five-minute target is therefore neither confirmed nor refuted by this run; the measure that settles it is the one on the dev deployment (Integration notes of the slice).

| Measure | Result |
|---|---|
| Workbook of 50,000 rows | 1.2 MB, written in 7.4 s |
| Read with the streaming reader | 8.0 s; the process's resident memory rose by 114 MB (122 to 236 MB) and the heap by 64 MB at the peak, sampled every 10 ms after a full collection; the rows read hold 3.3 MB of text |
| Read of a 5,000-row workbook | 1.1 s; resident memory up 7 MB |
| Create the job, 50,000 rows | 62.1 s (805 rows/s) |
| Preview, 50,000 rows | 53.9 s (928 rows/s) |
| Commit | 50,000 rows in 1,264.9 s (39.5 rows/s) in 118 batches: median batch 8.1 s, slowest 47.7 s; 13 batches had their set-based try cut off at its deadline (11 by the statement time limit, 2 between statements) and went on row by row |
| Roll back | 50,000 rows in 50.9 s |

The commit ran at 115 rows a second over its first 5,000 rows (272 on 28-09-2026) and slowed as the machine's load grew; once a batch needed more than its 17 seconds, its try was cut off and only a 3-second slice of single rows followed, so under that load most of the time went to tries that were taken back.

**The name-and-village search.** The preview's second dedupe search (`existingByNameAndVillage` in `preview-job.ts`) compares the stored keys `customer_sites.village_key` and `contacts.name_key` (0090), so each comparison is an index condition instead of a `regexp_replace` over every live site and contact, which ran past the 30-second statement limit at about 25,000 customers. With the 50,000 customers of the run in place (59,854 live sites in the company), a second file of 5,000 rows naming the same people and villages with new numbers was previewed in 22.4 s, every row with its name-and-village suggestions. `EXPLAIN (ANALYZE, BUFFERS)` of the search for its first 1,000 pairs, as a General Manager under the policies ([results/import-dedupe-plan.txt](results/import-dedupe-plan.txt)): an index scan of `customer_sites_village_key_idx` per wanted village (46 sites each here, the made-up file repeating 1,750 villages), the policies' `account_entities` probes by index, and `contacts` by its key, with the name compared on the joined row; 2.57 s on the saturated machine, 1,002,002 buffers all in memory. The work follows the number of customers in the wanted villages, not the number of customers in the group.

