# Spike: importing 50,000 leads

**Design §8 and IMP-01** ("50k rows in < 5 min"). Result: **met on the development laptop with one worker.** 50,000 made-up leads went through upload, preview and commit in 3 minutes 25 seconds, the commit alone in 3 minutes 4 seconds (272 rows a second), and the rollback took 8 seconds. Row by row, one lead command at a time, the commit runs at about 11 rows a second, which would take over an hour; the set-based batch described below makes the difference. The hosted stack (QStash workers in `bom1`, Supabase Mumbai, the 30 seconds for which each worker call starts batches) is not measured here; that is Phase 1.

Run it with `pnpm spike:import` (options: `-- --rows 50000 --batch 500 --budget 420`). It needs the local Docker Postgres and refuses any other database. The numbers are in [results/import-scale.json](results/import-scale.json), and those of the row-by-row run in [results/import-scale-before.json](results/import-scale-before.json). It is not part of CI.

## What it does
| Step | How |
|---|---|
| File | A made-up CSV built in memory: invented names and villages put together from syllables, made-up mobile numbers starting with 7, columns Name, Mobile and Village (1.86 MB for 50,000 rows) |
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
- If anything in the batch is not a plain new lead (a known customer, a consent, a key used before, a row that does not parse) or the database refuses a row, the savepoint takes the batch back. The batch then runs again row by row through `crm.lead.create`, which stops at the row at fault and records it; a row refused for a colleague's customer is marked and passed over. A batch keeps to 20 seconds from its start: it tries the set-based path only while 17.2 seconds, the slowest set-based batch below, are left, and row by row it stops between rows once its time is spent, keeps the rows done as that batch, and leaves the rest to the next one.
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
