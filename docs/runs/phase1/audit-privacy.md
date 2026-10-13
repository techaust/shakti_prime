# Audit fixes: privacy (Phase 0–1 audit, 12-10-2026)

| | |
|---|---|
| Branch | `fix/audit-privacy`, from `main` after M1 merges |
| PC worktree | cloud day: `/home/user/shakti-wt/audit-privacy`, slot 6: Postgres 54336, app 3036 |
| Runs on | cloud (owner, 12-10-2026: a deep audit of Phases 0–1, every finding fixed), heavy commands through the VM's lock |
| Tier | A (identity documents, deleting data): build Opus 5.5 high, early check by the lead, review Opus 5.5 xhigh |
| Usage | the gate's reading at the start and end of each agent run |
| State | brief |
| Next step | the lead branches it from `main` once M1 has merged, then starts the builder |

## Brief
The audit's evidence and the verifier's verdicts: [`1-security.md`](../../14-reviews/2026-10-audit/1-security.md), [`1-security.verdict.md`](../../14-reviews/2026-10-audit/1-security.verdict.md), [`5-ops.md`](../../14-reviews/2026-10-audit/5-ops.md) (OPS-5). Report: `docs/14-reviews/2026-10-audit.md`.

1. **SEC-1 (high):** an import never keeps an identity number. At parse time, a column whose header or values look like an Aadhaar number (twelve digits in any script or separator, by the same rule as item 3) is dropped from `import_rows.raw_json` and the preview, and the importer is told in plain words which column was left out; a value inside another column is masked to its last four digits. The import file itself is deleted from storage once its job is committed or rolled back (or after a stated number of days for a job left open), and `raw_json` and `normalised_json` of committed jobs are cleared after the reconciliation window (name the period in `workshop-defaults.ts`), keeping each row's state, what it made and why it was refused so M1's reconciliation still adds up. Logged in `retention_runs`. Tests: a workbook with an Aadhaar column and one with a number inside an address; the purge; reconciliation still adds up after it.
2. **SEC-3 (medium):** `redactText()` (`packages/domain/src/ports/redaction.ts`) catches every shape `maskForModel()` does (every script's digits, dots, slashes, underscores, commas, brackets, a letter prefix, phones with separators), with one shared normaliser so the two can never drift again; a table-driven test over every input the verifier lists, run against both.
3. **SEC-2 (low):** SECURITY §5 says exactly what Phase 1 masks (vault photos and PDFs, imports after item 1, the scrubber) and which uploads wait for Phase 2's identity-document flows; no promise the code does not keep.
4. **OPS-5 (low):** the real masking test runs in CI: the OCR model cached in CI keyed by the `tesseract.js` version, `OCR_LANG_PATH` set for the unit and security jobs and listed for `web#test` in `turbo.json`.

Done when: the checks of AGENTS §10 pass; the security suite passes on the slot's Postgres; no Aadhaar-shaped value from the test workbooks is found anywhere in the database or storage after an import (a completeness search like M1's).

**Migrations:** after `main`'s last one. **Early check:** after the parse-time filter, the purge job and their tests. **How to work:** as every brief: commit every 20 minutes, never push, never docker, heavy commands through `bash /home/user/shakti_prime/tools/integration/heavy.sh`, no pull request, no install, no hosted service.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
