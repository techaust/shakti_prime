# Phase 0–1 deep audit — auditor brief (12-10-2026)

Audit `main` at 23f78a5, checked out read-only at /home/user/shakti_prime. Do not edit, commit or push anything in the repository. Write your findings only to the output file named in your prompt.

Context: Shakti Prime BOS. Rules: CLAUDE.md, AGENTS.md (§10 definition of done), docs/01-blueprint.md, docs/07-security.md, docs/08-design-system.md, docs/09-testing.md, docs/03-roadmap-appendix/phase1.md. The previous audit and how it was run: docs/14-reviews/2026-09-audit.md (every finding there is fixed; check for regressions, not repeats).

Already known and excluded (do not report): every row of "Open follow-ups" in docs/10-status.md, and the work in flight on these branches: feat/m1-migration-uat (import reconciliation report, anonymising old unqualified leads, cutover/parallel-run/UAT packs, role journeys), fix/followups-db (notifications_entity_dedupe_idx, claim_push_subscription re-claim, commission_accruals.measure precision, Triage pipeline name, ensure_audit_partitions error handling), fix/followups-tooling (heavy.sh queue, pnpm self-install in the cloud hook, renumber-migrations no-op, converting.spec clock and seed item, files.spec and PIN journey axe waits, import-kinds/enum-sync/reader-parity tests). Items waiting on the client or the owner (workshop answers, CA golden set, design sign-off, vendor quotes, G1 accounts) are not findings.

Evidence rules:
- Every finding cites file:line at 23f78a5 and a concrete failure path (who does what, what goes wrong). No style opinions without a rule they break.
- Database claims are reproduced live: Postgres on 127.0.0.1:54322 (credentials in /home/user/shakti_prime/.env), migrated and seeded. Connect as `app_user` (or `app_reader`) inside `begin; set local ...; ...; rollback;` — never commit a change, never run DDL. Use EXPLAIN (ANALYZE) for performance claims, with row counts stated.
- Any heavy command (whole-repo lint, typecheck, build, test suites, journeys) goes through `bash /home/user/shakti_prime/tools/integration/heavy.sh <command>`; three builders share this VM (4 vCPUs, 16 GB). Prefer reading code to running suites.
- Never touch a hosted service or the network beyond the local machine.

Output file format (Markdown):
1. `## Score` — your area's score out of 10 with one paragraph of why, and what would make it 10.
2. `## Findings` — a table: `| id | severity (critical/high/medium/low) | effort (S <½ day, M ≤2 days, L) | title | file:line | failure path | fix |`. Ids are your prefix plus a number (e.g. SEC-1).
3. `## Checked and sound` — a short list of what you verified holds, so the report says what was covered.
Keep the file under ~400 lines. Return to the lead only: the score, the count of findings by severity, and the output file's path.
