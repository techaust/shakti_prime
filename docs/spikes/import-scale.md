# Spike: importing 50,000 leads

**Design §8 and IMP-01** ("50k rows in < 5 min"). Result: **the upload and the preview meet the target on the development laptop; the commit does not, by a wide margin.** One in-process worker commits about 11 leads a second, so 50,000 rows would take about 74 minutes. Design §8's five minutes assumes four concurrent batch workers on the hosted stack (Phase 1: QStash workers in `bom1` next to Supabase Mumbai); the arithmetic below shows that four workers at today's cost per row still would not reach it.

Run it with `pnpm spike:import` (options: `-- --rows 50000 --commit-rows 1000 --batch 500 --budget 420`). It needs the local Docker Postgres and refuses any other database. The raw numbers are in [results/import-scale.json](results/import-scale.json). It is not part of CI.

## What it does
| Step | How |
|---|---|
| File | A made-up CSV built in memory: invented names and villages put together from syllables, made-up mobile numbers starting with 7, columns Name, Mobile and Village (1.86 MB for 50,000 rows) |
| Caller | A General Manager of Shakti Supreme made with the testing helpers, which is why the script lives in `packages/domain/tests/spike/import-scale.ts` |
| Full file | `imports.job.create` → `imports.job.map` → `imports.job.preview` through `executeCommand`, with RLS, the audit rows and the dedupe suggestions (phone, then name and village); the job is left previewed |
| Commit sample | A second file of 1,000 rows through the same steps, then `imports.job.commit` and `imports.job.commit_batch` in batches of 500, each batch one transaction as the import worker runs it, then `imports.job.rollback` so the sample's leads are archived again |
| Round trip | The median of fifty `select 1` in one transaction |

## Numbers
Windows 11 laptop, Node 24.19, Docker Postgres 17 on `127.0.0.1:54322`, one connection, in process. Other workstreams were running their test suites on the same machine and database, so treat the times as upper bounds. Run of 28-09-2026:

| Measure | Rows | Time | Rate |
|---|---|---|---|
| Round trip to the database | | 1.36 ms | |
| Parse the CSV | 50,000 | 0.13 s | |
| Create the job (store the rows) | 50,000 | 25.1 s | 1,994 rows/s |
| Map | 50,000 | 0.33 s | |
| Preview (validate every row, dedupe by phone and by name and village, write the findings) | 50,000 | 29.9 s | 1,673 rows/s |
| Commit, batches of 500 (one `crm.lead.create` per row inside the batch's savepoint) | 1,000 | 89.0 s | 11.2 rows/s, 89 ms a row |
| Roll back the committed rows | 1,000 | 0.78 s | 1,282 rows/s |

An earlier run the same morning, with the round trip at 0.94 ms, committed the same sample at 13.1 rows a second. Earlier still, while the machine was under heavy load from the other suites and a statement took 8 to 20 ms, one lead took about 0.46 s and a batch of 500 did not finish within four minutes. The commit rate follows the time of a statement closely.

## What the numbers mean
- **Upload and preview: within the target.** Create and preview together took 55 seconds for 50,000 rows.
- **Commit: about 74 minutes for 50,000 rows** at 11.2 rows a second with one worker (projected, not run: 50,000 ÷ 11.2 = 4,452 s). Batches of one job run one after another today, because the job row is locked per batch (design §8, "Built"). The five-minute target needs about 167 rows a second.
- **Four hosted workers (Phase 1).** Design §8 counts on four concurrent batch workers. At 89 ms a row that is about 45 rows a second, so about 18 minutes for 50,000 rows, still above five. A hosted round trip within `bom1` should be close to the local one, so it is not expected to change this much. Reaching the target needs a lower cost per row as well as the workers; where the 89 ms goes (the statements of `crm.lead.create`, the policies they pass, the savepoint and the idempotency key per row) was not profiled in this spike.
- **Rollback is fast.** Archiving is one statement per chunk of 500, not one command per lead.

## Not covered
- The hosted stack: QStash workers, Supabase Mumbai and the 40-second limit per worker call.
- Four concurrent batch workers on one job, which the job lock does not allow today.
- A commit of all 50,000 rows: at the measured rate it would take over an hour on the shared local database, so the spike commits a sample and projects.
- Files with invalid or repeated rows, and a job whose batch fails: the security suite covers those paths (`packages/domain/tests/commands/imports.test.ts`).
