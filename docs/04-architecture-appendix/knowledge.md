# Spike: the Knowledge Vault's search and file list

**PRD AI-01** and design §8.4 (the staff search under row-level security, ADR 0011: HNSW with iterative scan, retrieval as the caller). Status (06-10-2026): **the search reads the HNSW index under the policies and answers in about 1 ms of execution at 20,000 passages for every reader**, on the PC's local database; the hosted stack, the client's documents and the real embedding model are still to measure. Owner: the lead engineer. Slice K1.

Run it with `pnpm spike:knowledge` (`packages/domain/tests/spike/knowledge-explain.ts`; options `-- --files 400 --chunks 20000 --runs 50 --keep --out <file>`). It needs the local Docker Postgres and is not part of CI. [results/knowledge-plans.txt](results/knowledge-plans.txt) holds the run of 06-10-2026, with its full plans.

## What it does
- **Seed:** as the migrator, 400 made-up vault files (titles `EXPLK file …`) with 50 made-up passages each, 20,000 in all, each passage with a random unit embedding of 1,024 numbers; the files spread over the four companies and the group (one in five for the whole group) and over the sensitivities (70% staff knowledge, 20% management, 10% Executive). Seeding took 48 s, the HNSW index built as the rows went in.
- **Readers:** a tele-caller of company 1 (staff knowledge of company 1 and the group: about 28% of the passages), a General Manager of company 1 (staff and management of company 1 and the group) and an Executive of every company (all of it).
- **Plans:** `EXPLAIN (ANALYZE, BUFFERS)` under the policies of the search's own statement (`knowledgeSearchSql`, eight passages asked for) for each reader with `hnsw.iterative_scan = relaxed_order`, as the search runs it, once for the tele-caller without it, and of the vault list's first page (`knowledgeListQuery`) for the Executive.
- **Timing:** `searchKnowledge` through `executeQuery`, 5 untimed and 50 timed runs per reader, from the start of the read-only transaction to its end; the embedding call to the vendor is not part of it.
- **Clean-up:** the spike removes its files and passages at the end unless `--keep` is given.

## Run of 06-10-2026 (the PC, Windows 11, Docker Postgres 17 with pgvector 0.8.2, 4 cores, with two other builders' suites sharing the machine)
| Reader | Passages found of 8 | Execution ms (plan) | Buffers | p50 / p95 ms (timed) |
|---|---|---|---|---|
| Tele-caller, company 1 | 8 | 1.3 | 516 | 9.1 / 14.9 |
| Tele-caller, company 1, iterative scan off | 8 | 1.1 | 516 | |
| General Manager, company 1 | 8 | 1.3 | 516 | 9.3 / 11.1 |
| Executive, all companies | 8 | 0.9 | 502 | 9.6 / 11.1 |
| Vault list, Executive (51 rows) | | 0.6 | 12 | |

## Why the search is fast
- The nearest passages come off `knowledge_chunks_embedding_idx` (an `Index Scan` ordered by `<=>`), and the policy is applied to each passage the scan returns as a filter: for the tele-caller 150 passages were filtered out on the way to the eight it may read. The policy's permission checks are init plans evaluated once per statement.
- The eight are then joined to their files' titles (a hash join over the files the reader may see, under their own policy) and put back in exact order, since a relaxed-order scan may return them slightly out of order.
- With the iterative scan off, this mix still found its eight: the 40 candidates the index looks at first (`hnsw.ef_search`) held enough passages the tele-caller may read. The iterative scan matters when a reader may read a small share of the passages (a company with few staff files among many Executive ones); with it on, the scan goes on, up to `hnsw.max_scan_tuples` (20,000), until it has enough.

## Still to measure
- The hosted stack (Supabase Mumbai), where the round trip and not the plan dominates.
- The client's documents: their real passage count and mix of companies and sensitivities, and the real embeddings, whose neighbourhoods are not random.
- The embedding call for the question (Voyage, in the request before the search), which this spike leaves out.
