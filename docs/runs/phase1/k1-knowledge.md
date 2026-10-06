# K1 Knowledge Vault (wave 4)

| | |
|---|---|
| Branch | `feat/k1-knowledge` on GitHub, from `main` at f74caff0 (#121) |
| PC worktree | `k1-knowledge`, slot 18: Postgres 54348, app 3048 (`bash tools/integration/setup-worktree.sh k1-knowledge feat/k1-knowledge 54348 3048`) |
| Runs on | PC only (owner, 06-10-2026), beside N1 and the other wave 4 builder; heavy commands one at a time through the PC's lock: build, review, fixes, the merge with `main`, integration, baselines, the pull request and the hosted steps |
| State | built, awaiting review |
| Next step | the lead reviews the branch and reruns the journeys on a quiet machine |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §8.4](../../design/phase1.md#84-k1-knowledge-vault), §3 (K1 needs P2 and AI0), §4 (`knowledge.vault.write`: Executive and GM, all companies, no agent), §6 (P2's vault purpose and masking) and §12; §7.1 "Built (AI0)" for the provider wrapper
- PRD AI-01 (Phase 1: vault uploads, extraction and embeddings; audio and Playbook review are Phase 2)
- BLUEPRINT §9.1 (sensitivity tags `exec_only`, `management`, `staff_ai_ok`; extraction per input type; retrieval with RLS by company and sensitivity)
- SECURITY §3.2 (`knowledge.vault.read.staff`, `.management`, `.exec`), §5 and §6 (masking before any model call), §11 item 6 (retrieval respects sensitivity per role); DATABASE §4.3 and the planned `knowledge_files` and `knowledge_chunks`; ADR 0011 (Voyage, 1,024 dimensions, HNSW with iterative scan, retrieval as the caller inside `withRequestContext()`)
- API: `workers.embeddings.index` and `EmbeddingsIndexJob` already exist in `packages/contracts/src/api` (`worker-jobs.ts`, `endpoints.ts`); DEPLOY's `VOYAGE_API_KEY` and `ANTHROPIC_API_KEY` lines (optional; neither is set on dev or staging yet)
- What exists: the file purpose `knowledge` (`packages/domain/src/files/purposes.ts`, closed until this slice), `limits.ts`, the file-check worker that masks vault photos (`apps/web/src/workers/files/handle-file-uploaded.ts`, `workers/ocr/mask-document.ts`); the provider wrapper `packages/domain/src/ai` (`embed` with `inputType` document or query, spend caps, the fake transport); `exceljs` in `@shakti/domain`, `mammoth` declared in `apps/web` (nothing imports it yet); the job route pattern `apps/web/src/app/api/v1/workers/pdf/render/route.ts`, `EVENT_JOB_ROUTES` in `apps/web/src/workers/qstash.ts`, the in-process registry; `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and `app.platform_only_permissions()` (latest in the migration D1 added)
- Skills: `add-command`, `add-table`, `vercel-react-best-practices`, `web-design-guidelines`, `writing-guidelines`.

1. **The `vector` extension:** a migration creates it in `public`, as the migrations create `pg_trgm`; first confirm the local image (`supabase/postgres` in `compose.yaml`) has it, and stop and report if not. DEPLOY gets the same warning it has for `pg_trgm`: never enable `vector` from the Supabase dashboard, which would put it in the `extensions` schema.
2. **Tables**, each with RLS, fixture rows, matrix rules, `app_reader`, the testing lists, `NARROWER` and `enum-sync` where they apply (AGENTS §6):
   - `knowledge_files`: `entity_id` null for the whole group, `file_id`, `title`, `sensitivity` (`exec_only`, `management`, `staff_ai_ok`), `source_type` (pdf, photo, word, excel), `state` (a small machine: waiting, indexed, failed, unavailable when a vendor key is missing, archived), `chunks`, `indexed_at`, `error_reason`.
   - `knowledge_chunks`: `knowledge_file_id`, `entity_id` null, `sensitivity` (copied from the file), `position`, `chunk_text`, `embedding vector(1024)`; an HNSW index with cosine distance; written only by the index job.
   - Read policy on both: a row of the reader's companies or of the whole group, and the sensitivity the reader holds (`staff_ai_ok` needs `knowledge.vault.read.staff`, `management` needs `.management`, `exec_only` needs `.exec`). Files are written by `knowledge.vault.write`.
3. **Permissions:** `knowledge.vault.write` (Executive and GM, all; no agent) with its SECURITY §3.2 row, seed and oracle case; the `knowledge` file purpose opens with write `knowledge.vault.write` and read by sensitivity (update `purposes.test.ts`, `files.test.ts` and the matrix's `knowledge: NEVER`). The index job runs as `system:workers` with a new platform-only permission (`knowledge.index`, in `SYSTEM_MATRIX`, `PLATFORM_ONLY_PERMISSIONS` and a new definition of `app.platform_only_permissions()` that keeps every key `main` has) and reaches the tables only through narrow definers that check it (ADR 0020).
4. **Upload and index:**
   - `knowledge.file.add` (people only): a vault upload with its title, company or the whole group, and sensitivity; Word (`.docx`) and Excel (`.xlsx`) join PDF and photos in `limits.ts` for this purpose, with the file check's type test for each.
   - The file's `ready` event (photos only after masking, as P2 does) sends `EmbeddingsIndexJob` to `/api/v1/workers/embeddings/index`: extraction by type (PDFs and masked photos by Claude through the provider wrapper; Word by `mammoth`; Excel by `exceljs`, sheet by sheet), chunking (a pure, tested function: paragraph-aware, a stated size and overlap), embeddings with `inputType: 'document'` through `embed`, which masks each text; the chunks replace the file's earlier ones in one transaction (`replaced` in the result); a repeated delivery is harmless.
   - Spend: indexing charges the file's company, or only the group cap for a whole-group file (`CallBase.entityId` takes null for this); the indexing agent's name and its daily cap follow AI0's named defaults, flagged for the owner like the others. With no `VOYAGE_API_KEY` or `ANTHROPIC_API_KEY`, the file is `unavailable` with a plain sentence, and an Executive can index it again once the key is set (`knowledge.file.reindex`).
   - `knowledge.file.archive` (`knowledge.vault.write`): an archived file's chunks are removed from search.
5. **Search:** `searchKnowledge()` on the caller's own context: the query embedded with `inputType: 'query'`, ranked by cosine distance under RLS (iterative scan on, so filtering by company and sensitivity still returns enough rows), with the file's title and the chunk's text; `EXPLAIN (ANALYZE)` under RLS at a realistic size (a spike like the others). Without the Voyage key, search says in plain words that it is not available yet.
6. **Screens:** `/knowledge` (menu item Knowledge, `knowledge.vault.read.staff`): staff search, and the file list a reader may see with each file's state; upload, archive and index again for `knowledge.vault.write`. Journeys with axe, copy in `en.json`, the JavaScript budget.
7. **Tests:** the security suite proves retrieval by sensitivity per role (SECURITY §11 item 6): a tele-caller finds `staff_ai_ok` chunks and none of `management` or `exec_only`; Accounts and the GM find `management`; only the Executive finds `exec_only`; a company's file stays out of another company's search; no agent principal reads `exec_only`. Unit tests for chunking and each extractor (the fake transport for Claude and Voyage); the journey uploads a Word file, sees it indexed through the fake transport and finds it by search.
8. **Documents:** DATABASE (the extension and both tables), SECURITY (§3.2, §3.3, §11 item 6 now proved), API (the route's state), DEPLOY (the `vector` warning; the keys' effect on indexing), design §8.4 "Built (K1)", ADR 0011 if it changes, `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch; the sensitivity cases of item 7 pass on real Postgres; a journey uploads, indexes (fake transport) and finds a document.

Not in K1: audio, Playbook directives and their review, Ask the Business (Phase 2); any vault document (the client's; tests use clearly synthetic text); the vendor keys on hosted environments (the owner's). Files another slice owns: N1 owns notifications, S2 orders and credit.

## Report

### 07-10-2026, builder on the PC
Built by the earlier builder (12 commits: contracts, the `vector` extension, `knowledge_files` and `knowledge_chunks` with RLS and definers, the `knowledge_file` machine, chunking, extraction, the index job and route, commands, queries, the `/knowledge` screen and copy, tests, journey, spike, documents). This session finished the checks on the database the lead recreated empty (54348) and fixed the journey's waits. Skills named in the brief were loaded by the earlier builder; none loaded this session.

Changed this session: `apps/web/e2e/knowledge.spec.ts` only (the upload journey waits up to 45 seconds for the dialog to close and for the search hit, and has a 150-second test limit, because the loaded PC made it flaky).

Checks:
- `pnpm typecheck`: 8 of 8 tasks successful.
- `pnpm test:security` (fresh database): `@shakti/db` 36 files, 1,097 tests; `@shakti/domain` 64 files, 791 tests; `web` 19 files, 271 tests; all passed. The earlier `import-kinds` failure was the leftover "Two Sites" account of a used database and did not recur.
- `pnpm test`: tokens 134, ui 105, copy-lint 17, contracts 177, db 126, domain 1,908, web 678; all passed (8 of 8 tasks). `pnpm copy-lint`: clean.
- `pnpm build`: passed. `pnpm --filter web js-budget`: every page within its budget (37 pages).
- Journeys (`pnpm --filter web e2e`, whole run, PC under heavy shared load, 1.1 hours): 234 passed, 17 flaky, 21 failed, 12 skipped, 3 did not run. The failures are spread over agents, customers, imports, leads, quotes, pipelines, duplicates and walk-in specs this slice does not touch, with Postgres connect timeouts and statement timeouts (57014) in the server log: load, not logic. The lead should rerun the whole set on a quiet machine. The knowledge spec on its own (`playwright test e2e/knowledge.spec.ts --workers=1`), after the wait fix: 14 passed on desktop-light, desktop-dark and phone (setup included).
- `pnpm lint`: whole repository, through the lock, after the last edit: exit 0 (`--max-warnings 0`).
- `EXPLAIN (ANALYZE)`: `docs/spikes/knowledge.md` and `docs/spikes/results/knowledge-plans.txt` (search under RLS at 20,000 passages, 1 ms).

Snapshots: one new, `knowledge` (taken in the snapshot company's tele-caller journey); no existing snapshot changed. The lead makes the Linux baseline.

Decisions the brief did not settle (all in the design section 8.4 "Built (K1)"): passage size 1,500 characters with 200 repeated; the vault's own daily caps, 500 rupees for reading and 100 for search, flagged for the owner; `AI_TRANSPORT=fake` for the journeys, refused on hosted runtimes; a company's vault upload readable by its uploader while they hold the write.

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
