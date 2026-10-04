# P2b Imports upgrade (wave 2)

| | |
|---|---|
| Branch | `feat/p2b-imports`, made from `main` when the slice starts |
| PC worktree | `p2b-imports`, slot 11: Postgres 54341, app 3041 (`bash tools/integration/setup-worktree.sh p2b-imports feat/p2b-imports 54341 3041`) |
| Runs on | build and review: cloud; merge with `main`, integration and the measurement on dev: PC |
| State | brief; can start (P2 and C2 are on `main`) |
| Next step | the lead pushes the branch with this file, then a builder starts |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §6.3](../../design/phase1.md#63-p2b-imports-upgrade)
- PRD IMP-01 and CRM-02
- the import framework (`packages/domain/src/imports`, the `imports.job.*` commands, the worker `/api/v1/workers/imports/commit`)
- P2's uploads (`packages/domain/src/files`, `apps/web/src/files`)
- `docs/spikes/import-scale.md`
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`.
- Lead creation and the import batch's attribution belong to C3's integration (its run file): coordinate any change to `packages/domain/src/imports/commit-leads.ts` with the lead session.

1. **Uploads:** import files arrive by the pre-signed flow of P2; the workbook is read as a stream (the `exceljs` streaming reader), so memory stays flat; the server-action body limit (`serverActions.bodySizeLimit` and `proxyClientMaxBodySize` in `apps/web/next.config.ts`, set to `UPLOAD_BODY_LIMIT` for the import form) returns to the default.
2. **Batch budgets:** one deadline across the whole set-based try, then a short row-by-row slice; a job fails after its last queue retry (`Upstash-Retried`).
3. **Import kinds** `accounts` (customers, one relationship per row's company, a repeated customer folded into one record) and `pin_codes`.
4. **PIN master** `pin_codes(pin, office_name, taluk, district, state_code)`, shared and read-only to requests, written by the `pin_codes` import (an Executive, in a request for every company) from the public India Post directory; a PIN fills the tehsil and district and offers its post-office localities for the village; a PIN outside the master is flagged for review (CRM-02).
5. **The sweep of abandoned pending uploads.**
6. **The slow dedupe query:** the preview's name-and-village match (`regexp_replace` over `customer_sites` and `contacts` in `packages/domain/src/commands/imports/preview-job.ts`) ran past the statement time limit (SQLSTATE 57014) at about 25,000 customers; make it use an index, with `EXPLAIN (ANALYZE)` under RLS.
7. **Documents:** DATABASE (the PIN master and the import kinds), API (the upload path for imports), design §6.3 "Built (P2b)", `pnpm db:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a 50,000-row import is measured locally with the streaming reader.

## Report
None yet.

## Review
None yet.

## Integration notes
1. Hosted imports need `FILES_BUCKET` and the other file settings, which wait for the owner's AWS files stack ([files-setup](../../runbooks/files-setup.md)).
2. After the merge, the import is measured on the dev deployment and recorded in `docs/spikes/import-scale.md`; concurrent batch workers only if it misses the PRD's five minutes for 50,000 rows (PRD §5).
