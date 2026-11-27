# TC2 Tally ingest on the BOS (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/tc2-tally-ingest` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an authenticated machine path, supplier rates, financial data, row security |
| Usage | briefed 27-11-2026; builder Opus 5.5 at high, started 27-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase5 §5](../../03-roadmap-appendix/phase5.md#5-the-money-model) (its Tally group) and [§6.3](../../03-roadmap-appendix/phase5.md#63-tc2-tally-ingest-on-the-bos) as written. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Reuse what exists: `checkBatch`, `diffSnapshot`, `connectorHealth` and `shouldAlertSilence` (`packages/domain/src/tally/sync-rules.ts`), the signature verifier and payload parsing (`apps/web/src/integrations/tally/`), the contracts and endpoints (`packages/contracts/src/api/connector.ts`, `endpoints.ts`). Points settled here:

1. **Tables:** `tally_connectors` (id, name, two key hashes for rotation (`key_hash`, `next_key_hash`), the company mappings as rows of `tally_connector_companies` (Tally company name → `entity_id`)), `tally_cursors`, `tally_vouchers` (GUID unique, the `tally-voucher` machine's state column), `tally_purchase_vouchers` (restricted: read only with `procurement.rate.read`, the house pattern for restricted rows), `tally_ledgers`, `tally_voucher_tombstones` (append-only), `tally_snapshots`. Every table with `entity_id` under forced row security; read by `finance.read` (FN1 adds it: if FN1 has not merged, add the key yourself in the catalogue and seed under a TC2 comment, and the lead merges the two), written only by definers that check the connector principal.
2. **The connector principal:** `connector:tally:<id>` resolved from the request's HMAC (key id header) to a request context holding no permission but its routes, with `app.entity_ids` set to the connector's mapped companies only. A company not mapped answers `forbidden`.
3. **Routes:** `/api/v1/connector/tally/cursor`, `/batches`, `/snapshot`, `/heartbeat`, `/release` (answers "no release" until TC4), per the contracts and API §3.5, each through `executeCommand()` as the connector principal: `tally.batch.ingest` (`checkBatch`, then upsert vouchers by GUID newest-AlterID-wins, purchase vouchers to their table, the machine's `ingest` or `alter`, the cursor moved), `tally.snapshot.record` (`diffSnapshot`; tombstones written; over the limits, held for a person: `tally.snapshot.confirm` by Accounts, `finance.recon.write`), `tally.heartbeat.record`.
4. **Admin › Integrations › Tally** (`admin.integrations.write`): register a connector (its key shown once, generated server-side, only its hash kept), map companies, rotate (the next key shown once, both valid until the old is retired), revoke. Integration health's connector row from `connectorHealth`. The silence alert: the jobs check raises `tally.connector.silent` once per silence through Sentry (`shouldAlertSilence`).
5. **Matching is TC3's.** TC2 stores and states; the machine's `match`, `queue`, `link` and `reverse` stay proposed until TC3.

**Early check (Tier A):** once the tables, row security, the principal, the three write routes and their tests are committed (HMAC with two keys and the 5-minute skew, a replayed batch applied once, a gap answering `cursor_mismatch`, the snapshot limit held for a person, purchase vouchers per role on both pools, the connector principal reading no table), report `report: tc2-tally-ingest early check` and stop.

Files owned: the `tally_*` tables and their migrations; `apps/web/src/app/api/v1/connector/tally/`; `packages/domain/src/commands/tally/` (new); Admin › Integrations › Tally.

Do not touch: `apps/tally-connector` (TC1); reconciliation, payments, orders' invoice and close (TC3); proformas (FN1).

Review checklist: no request reaches a table except through a definer as the connector principal; purchase vouchers only with `procurement.rate.read`; keys stored hashed, shown once; idempotency and the cursor's forward-only rule; nothing written back towards Tally.

### Brief addendum (the lead, 27-11-2026 16:10 UTC): from TC1's early check
- **Ledger balances:** a ledger's closing balance changes when a voucher posts, with no new AlterID, so the cursor never carries it. TC1 adds an optional `ledgerBalances` (party ledger GUID, name, closing balance, as of) to the daily snapshot's contract in `packages/contracts/src/api/connector.ts` (TC1 owns that change). Store them in `tally_ledgers` with their date. TC3's dealer outstanding reads them. If TC1 has not merged when you reach it, accept the field when present and say so.
- **Signature:** verify the raw `pathname + search` the request arrived with (a space as `+`), exactly as the connector signs it (TC1's point 5).
- **Missing GUIDs:** `missingOnServer` cannot be resent below the cursor, so a GUID the snapshot lists and the BOS lacks goes to the review queue as "missing in the BOS" for Accounts (TC1's point 4).

### Brief addendum 2 (the lead, 27-11-2026 20:00 UTC): TC1's fix round changes the contract
TC1 (`feat/tc1-tally-connector`) adds three things to `packages/contracts/src/api/connector.ts`. TC1 owns that file: take its version when TC1 merges, or copy exactly its additions if you need them before.
- **`refused` on a batch:** `TallyRefusedRow`, a GUID and the field the contract refused, for a voucher the connector left out of a page. Store each as an `unlinked_vouchers` entry "refused by the connector" for Accounts. The voucher's earlier version, if the BOS has one, is no longer current: mark it so, and keep it out of matching until a later version arrives.
- **`tallyLastAlterId` per company in the heartbeat:** Tally's own last AlterID. Integration health's lag is `tallyLastAlterId - cursor`.
- **`heldRows` in the heartbeat:** outbox rows the connector set aside in the last 7 days. Show it on Integration health, and alert when it is above zero.

Each is optional in the contract, so an older connector still parses.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 5 design](../../03-roadmap-appendix/phase5.md) (§1, §3, §4, §5, §10, §13, §14 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
- **Where:** a seat of the seven-day push (seats protocol v2, `seats/readme.md` on `ops/seats`). Your seat gives you a worktree of this branch with its own Postgres and app port, and its lane prompt names them. Work only there. Put every heavy command through `bash tools/integration/heavy.sh`, and also every lint, typecheck and test while another agent runs in the VM.
- **Push:** commit as you go, at least every 20 minutes. Push your branch after every commit (`git push origin HEAD`), at least every 10 minutes.
- **Your checks before each report:**
  - `pnpm typecheck`;
  - `pnpm exec eslint --max-warnings 0 <each folder you touched>`;
  - the unit tests of each package you touched;
  - `pnpm test:security` when you touched schema, policies, definers, commands or queries;
  - `pnpm copy-lint` when you touched `en.json`;
  - `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs` when they apply;
  - `pnpm build` and `pnpm --filter web js-budget`.

  Journeys cannot sign in on a seat. Write your journeys and run them up to the sign-in, then say in the report which were not run. The lead runs them and makes the Linux baselines at integration.
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: tc2-tally-ingest <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: tc2-tally-ingest blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (Phase 5 wave 1, from 28-11-2026):**
- `fn1-proformas`: proformas and payment milestones;
- `tc1-tally-connector`: `apps/tally-connector`;
- `tc2-tally-ingest`: the connector's routes and the `tally_*` tables;
- `hr1-people`: employees, shifts, holidays and leave.

Phase 3's waves 2 and 3 and Phase 4's waves 1 and 2 run at the same time.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, `MACHINES_IN_USE`, the file purposes, the print registry, the testing lists and the retention list, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
