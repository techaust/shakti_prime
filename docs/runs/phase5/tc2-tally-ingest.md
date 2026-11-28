# TC2 Tally ingest on the BOS (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/tc2-tally-ingest` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): an authenticated machine path, supplier rates, financial data, row security |
| Usage | briefed 27-11-2026; builder Opus 5.5 at high, started 27-11-2026; early check 27-11-2026, done 27-11-2026 (Opus 5.5 at high) |
| State | done |
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

### 27-11-2026, early check (seat, worktree `tc2-tally-ingest`, Postgres 54334)
**Built** (tables, row security, the connector principal, the routes and the commands with their tests; no screen yet):
- Schema `packages/db/src/schema/tally.ts` and migrations `0240_tc2_tally_ingest` (generated; the widened `roles_key_check` added `NOT VALID`) and `0241_tc2_tally_ingest_rls` (custom): `tally_connectors`, `tally_connector_companies`, `tally_cursors`, `tally_vouchers`, `tally_purchase_vouchers`, `tally_ledgers`, `tally_snapshots`, `tally_voucher_tombstones`. Every table forces row security; request roles only select (`NARROWER` all `{ i: false, u: false }`); people read a company's mirror with `finance.read:entity`, purchase vouchers with `procurement.rate.read:entity` as well, the connectors and their mappings and cursors also with `admin.integrations.write:all`; the key hashes are not selectable by any request role (column grants). Tombstones are append-only by a guard (only `reversal_applied_at`, once). `app.platform_only_permissions()` redefined from W2's version (0222) plus `tally.connector.sync`.
- Definers (all `search_path = ''`, closed to `public` and `readonly_reporter`): `app.tally_require_connector()` (the grant, the role `system:tally_connector`, a live connector of the caller's own id, the company in the request and mapped to it under that Tally name), `tally_connector_auth`, `tally_cursor`, `tally_cursor_lock`, `tally_cursor_move` (forward only), `tally_vouchers_known`, `tally_vouchers_write` (newest AlterID wins; a GUID of another company refused), `tally_ledgers_write`, `tally_ledger_balances_write`, `tally_snapshot_write`, `tally_snapshot_held`, `tally_tombstone`, `tally_heartbeat_write`, and the admin ones (`tally_connector_register`, `_map`, `_unmap`, `_rotate`, `_retire_key`, `_revoke`, behind `app.tally_require_admin()`: a person with `admin.integrations.write:all`).
- Contracts: `finance.read` (the design's FN1 row, under a TC2 comment, for the lead to merge with FN1's) and the platform-only `tally.connector.sync`; the role `system:tally_connector` with `SYSTEM_MATRIX` `[tally.connector.sync:all]`; `packages/contracts/src/commands/tally/ingest.ts` and `connectors.ts` (inputs, DTOs, `TALLY_VOUCHER_STATES`, the voucher-type splits, `TALLY_SNAPSHOT_STATES`, `TallyLedgerBalance`).
- Domain: `packages/domain/src/commands/tally/ingest.ts` (`tally.batch.ingest`, `tally.snapshot.record`, `tally.snapshot.confirm`, `tally.heartbeat.record`), `connectors.ts` (`tally.connector.register`, `.map`, `.unmap`, `.rotate`, `.retire_key`, `.revoke`), `queries/tally/connector.ts` (`findTallyConnector`, `readTallyCursor`), `tally/connector-key.ts` (`newConnectorKey`, `connectorSigningKey`). The `tally-voucher` machine is in use (`stored` on `tally_vouchers.state`): `ingest`, `alter` (now also from `received`) and `tombstone` (now `finance.recon.write` for a person confirming, `system` for the snapshot); `match`, `queue`, `link`, `reverse` untouched for TC3.
- Web: `apps/web/src/integrations/tally/routes.ts`, `connector-principal.ts`, `route-deps.ts`; routes `apps/web/src/app/api/v1/connector/tally/{cursor,batches,snapshot,heartbeat}/route.ts`. Order: body cap, the header's connector found as itself, the HMAC over the raw `pathname + search` under either key with the 5-minute skew, the contract, the mapped company under the body's company code, then one command or query as the connector's principal in that company.
- Copy and labels: `en.json` (13 `errors.*` reasons, 2 permission labels and the `tally` module's name for the role editor, 10 Activity log actions, 11 field labels); `apps/web/src/screens/audit.ts`.
- Registration points, each under a TC2 comment: permission catalogue and seed, roles seed, `SYSTEM_MATRIX`, `MACHINES_IN_USE`, the testing lists (`ENTITY_TABLES` +7, a new `CONNECTOR_TABLES`), the matrix fixture and rules, `enum-sync`, `grants` (`NARROWER`, the reader's definers), the refusal sweep, the masking exemptions, the registry, `en.json`.
- Documents: DATABASE §6.7 rows (built), SECURITY §3.1 platform-only list, §3.2 rows (`finance.read`, `tally.connector.sync`) and the connector principal's paragraph; `pnpm db:docs` and `machines:docs` regenerated.

**Tests added:**
- `packages/db/tests/security/tally.test.ts` (on both pools where it reads): the connectors read only by `admin.integrations.write` holders, never their key hashes, never written directly; a connector's principal reads none of the mirror of its own company on either pool, and no customer, lead, quote, order, cost, rate, file (but the logo and letterhead every principal of a company reads) or audit row; `tally.connector.sync` platform-only; the definers refuse a person, an agent, the workers (with or without the grant), an unregistered or revoked connector, an unmapped company and a company outside the request; newest AlterID wins and another company's GUID is refused; the cursor moves forward only; **purchase vouchers per role on the app_user and app_reader pools** (sale with `finance.read`, purchase with the rate grant too); tombstones append-only. Plus the matrix covers the seven entity tables for every role (and `system:tally_connector` reads none).
- `packages/domain/tests/commands/tally.test.ts` 14: register and map (denied for Accounts and an agent; another company's map forbidden; a Tally company once); rotation with both keys then the retired one gone; batch denied for a person, for an unmapped company and outside the principal; happy path with the purchase in the restricted table and the cursor moved; **a resend under the same key answered from the first call, applied once** (one audit row); **a gap and a resend under another key answer `cursor_mismatch`**; an altered voucher and a ledger; a snapshot within limits tombstones, names what is missing and stores ledger balances; **a snapshot over the limits held for a person**: a tele-caller refused, Accounts of another company not found, Accounts confirm once (32 tombstones), then `tally_snapshot_not_held`; heartbeat for mapped companies only, refused for a person and for a revoked connector; unmap refused to Accounts and for a company outside the request.
- `apps/web/tests/tally-connector.test.ts` 14: signed cursor read; the query as it arrived (a space as `+`); **±290 s accepted, ±310 s refused**; unknown connector, wrong key and tampered body refused; **both keys during a rotation, only the new after retiring**; a batch without `Idempotency-Key` refused; **one batch applied once and its resend answered identically**; `cursor_mismatch` for a gap and for another key; `idempotency_mismatch` for the same key with another body; an unmapped company and another company's code forbidden; a body not the contract refused; the snapshot's answer (with `ledgerBalances` in the body); the heartbeat (no update offered); a revoked connector refused.
- Updated: `agent-refusals.test.ts` (the six admin commands in `INPUTS` and `PEOPLE_ONLY_INPUTS`, `tally.snapshot.confirm` people-only, the three connector commands in `CHECKS`), `unmasked-fields.test.ts` (the key-hash exemptions of register and rotate; Tally's GUIDs need none, the masker leaves them whole), `refusal-coverage.test.ts` (five commands with no company reviewed, with where their denied cases are), `reader-parity.test.ts` (`readTallyCursor`, `readTallyConnector`, `findTallyConnector`), `role-entity-matrix.test.ts` (an `all` rule for the purchase vouchers), `enum-sync.test.ts` (9 pairs), `grants.test.ts` (`CONNECTOR_TABLES`, `NARROWER`, the reader's three definers).

**Checks** (each through `tools/integration/heavy.sh`):
- `pnpm typecheck`: 10 tasks successful.
- `pnpm exec eslint --max-warnings 0 packages/contracts/src packages/domain/src packages/domain/tests packages/db/src packages/db/tests packages/db/seeds apps/web/src/integrations/tally apps/web/src/app/api/v1/connector apps/web/src/screens apps/web/tests`: clean.
- `pnpm copy-lint`: clean (after the role editor's new module name too).
- Unit (`turbo run test --force`): contracts 340 passed; db 163 passed; domain 2,809 passed; web 167 files, 1,241 passed, 1 skipped (after the `tally` module's name was added; the first run had the one failure it fixes).
- Security suite (`turbo run test:security --concurrency=1`, on the worktree's Postgres after the VM's restart, migrated and seeded by the suite): db 63 files, 1,903 passed; domain 111 files, 1,536 passed; web 40 files, 475 passed.
- `pnpm build`: compiled; `pnpm --filter web js-budget`: every page within its budget (65 pages).
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs`: regenerated and committed; `db:migrate --verify` clean earlier on this database.
- Not run: journeys (no screen yet), `EXPLAIN (ANALYZE)` (no list or search yet), the whole-repository `pnpm lint` (the final check at done).

**For the lead, before TC1 and TC2 meet:**
1. **The signing key (needs TC1's one-line change, or the lead's call).** The brief keeps only each key's hash, and HMAC needs the shared secret on the server, so the HMAC key is the SHA-256 of the key shown once, in lower-case hexadecimal (`connectorSigningKey()`, `packages/domain/src/tally/connector-key.ts`): the BOS keeps that hash and verifies with it, and the key itself exists only in the connector's DPAPI file. TC1's `client.ts`/`signing.ts` signs with the key as typed; it must sign with `sha256hex(key)` (node:crypto) as the HMAC key. `verifyConnectorRequest()` and the web's signing vectors are unchanged (they take the HMAC key). The alternative, a sealed key in the database, contradicts "only its hash kept".
2. **`ledgerBalances`:** TC1's contract change has not merged. The route takes `ledgerBalances` out of the snapshot body before the strict contract parses it and passes it to `tally.snapshot.record` as its own field (`TallyLedgerBalance`: `guid`, `name`, `closingBalance`, `asOf`); a known ledger of the company takes a later balance, an unknown GUID waits for its batch. When TC1's field lands, reconcile the two shapes and drop the route's split.
3. **Missing GUIDs:** kept on the snapshot (`tally_snapshots.missing_guids`, the first thousand; `missing` counts all) for TC3's review queue as "missing in the BOS"; the response still lists them (`missingOnServer`), which TC1 logs by count.
4. **Body size:** a 500,000-GUID snapshot is about 25 MB of JSON; the route's cap is 32 MiB, but a Vercel function takes at most 4.5 MB, about 90,000 GUIDs. Either the connector sends the snapshot in parts or the limit is accepted for these companies' sizes (TC4 or the lead).
5. `finance.read` is in the catalogue and seed under a TC2 comment with the design's row (Executive all, GM entity, Sales Lead team, LC own, Accounts entity); merge with FN1's.

**Assumptions (calls the brief did not settle):**
- The connector's role is `system:tally_connector` (a system role, so the platform-only rules, the seed and the refusal sweep apply unchanged); its principal is the connector's own `principals` row (kind `system`), so audit rows name the connector. The brief's `connector:tally:<id>` is that principal.
- `tally.connector.sync` is held at scope `all`, like every platform-only grant (`PERMISSION_SCOPES` requires it); the connector's companies come from its principal and the definers' mapping check.
- A group company may map several Tally companies (Tally often starts one per financial year): `tally_connector_companies` is unique on (company, Tally name), not on the company; a Tally company is read by one connector. The cursor is per (company, Tally name), so a replacement connector resumes it.
- A snapshot compares only stored vouchers dated on or after its `fromDate`; a tombstoned voucher sent again keeps its state (the next snapshot lists it as reappeared); a voucher that changes between the purchase and sales tables is refused (`tally_voucher_type_changed`).
- The heartbeat leaves a company it names that is not mapped out (no refusal), writes no audit row, and answers `latestVersion` = the connector's own with no update until TC4.
- Purchase vouchers need `finance.read` and `procurement.rate.read` together (the brief's two lines read together).
- `/release`: the contract's path is `/connector/release`, outside the folder this slice owns; it comes with the screens after this check (to settle: under `connector/tally/release` as the brief says, or the contract's path).

**Brief addendum 2 (TC1's `refused` rows on a batch, `tallyLastAlterId` and `heldRows` in the heartbeat):** arrived during the checks; not built. TC1's contract additions are not on this branch, so they come with the screens: the refused rows stored for the review queue with the earlier version marked not current, the heartbeat's two fields on the connector and Integration health (lag = `tallyLastAlterId` − cursor, an alert above zero held rows).

**Not yet built (after this check):** Admin › Integrations › Tally (register, key shown once, map, rotate, retire, revoke; the snapshot held for Accounts), Integration health's connector row (`connectorHealth`), the silence alert in the jobs check (`shouldAlertSilence`, Sentry, `silence_alerted_at`), `/release`, server actions, journeys, API §3.5 text, `EXPLAIN (ANALYZE)` for the screen's lists.

**Skills loaded:** `add-table`, `add-command`.

### 27-11-2026, done (seat, worktree `tc2-tally-ingest`, Postgres 54331)
**The lead's two changes to the early check:**
- **Keys sealed, not hashed.** A connector's key is made on the server, shown once and kept only sealed by the field cipher (KMS on a hosted environment, `FIELD_ENCRYPTION_KEY` locally, as `entities.bank_json` is) in `tally_connectors.key_sealed` and, during a rotation, `next_key_sealed`. The seal is bound to the connector's row (company 0: a connector belongs to no company), so a sealed key copied to another connector does not open. The route opens the keys (kept 5 minutes per sealed value in the process) and verifies with the key as shown, so TC1 signs as it does. A runtime with no cipher answers `integration_unavailable`. `connectorSigningKey()` and every key hash are gone.
- **Snapshots in parts.** `ConnectorSnapshotRequest.part` (`snapshotId`, `part`, `parts`, at most `SNAPSHOT_MAX_PARTS` 20) and a route cap of 4.5 MB. Parts are kept on the snapshot's row (`receiving`, `parts_received`, `received_guids`, `app.tally_snapshot_part()`), each part once. A part whose company, size, `asOf` or `fromDate` differs is refused (`tally_snapshot_part_mismatch`). The whole snapshot is compared when the last part arrives, and that row is completed in place. A snapshot still receiving a day after it began is dropped when the company's next part arrives. An intermediate part is answered with zeros.

**Addendum 2:**
- I took TC1's `connector.ts` whole from `feat/tc1-tally-connector` (its `TallyRefusedRow`, `refused`, `tallyLastAlterId`, `problem`, `heldRows`, `ledgerBalances`, the response shapes) and added `part` to the snapshot.
- Refused rows land in `tally_refused_rows` (one per GUID, the latest; resolved when a later version arrives), and the stored earlier version gets `refused_at` (not current) until a later version clears it.
- The heartbeat records `tally_last_alter_id`, `problem`, `held_rows` and `held_since`; an older connector's missing fields leave what was recorded.
- Integration health shows lag (`tallyLastAlterId` less the cursor), records waiting and set aside, and why a company is not read. Held rows raise `tally.connector.rows_held` once per stretch.
- The early check's route split for `ledgerBalances` is gone: the field is TC1's contract now.

**Built since the early check:**
- **Admin › Integrations › Tally** (`/admin/integrations/tally`, `admin.integrations.write`): set up a connector (its number and key shown once), link a Tally company to one of the group's companies, unlink it, make a new key, turn the old one off, turn the connector off. Files: `apps/web/src/components/tally/tally-connectors-screen.tsx` and the page.
- **Tally checks** (`/tally-checks`, `finance.recon.write`): the held snapshots of the caller's companies, each with Confirm (`tally.snapshot.confirm`). Files: `apps/web/src/components/tally/tally-checks-screen.tsx`, the page and its layout. It is a page of its own because Accounts cannot open an admin page: the menu needs every grant it lists.
- **Integration health:** the Tally section (`apps/web/src/components/integrations/tally-health.tsx`) from `readTallyConnectorHealth()`. `ConnectorHealth` now carries the connector's name, `health` (`connectorHealth()`), `heldRows`, `reachable`, `lag` and `problem`, and its version is nullable.
- **The alerts:** `apps/web/src/workers/tally-alerts.ts`, run by the hourly jobs check as `system:workers`.
  - `tally.connector.silent` goes out once per silence (`shouldAlertSilence`); `tally.connector.rows_held` once per stretch (`shouldAlertHeldRows`). Each names the connector by id with counts only, through Sentry (`ALERT_NAMES`).
  - Each sent alert is recorded by the new command `tally.connector.record_alert` (`platform.jobs.check`, through `app.tally_connector_alerted()`). A fault in these alerts is told once a day as `tally-alerts` and never fails the check.
- **`/release`:** `GET /api/v1/connector/tally/release` answers a verified connector `not_found` (`tally_no_release`) until TC4. The endpoint catalogue's `connector.release` path is now `/connector/tally/release`, and API §3.5, ADR 0013 and the design's §9.2 say so.
- **Server actions:** `apps/web/src/actions/tally.ts` (list, register and rotate with the key made there and answered once, map, unmap, retire, revoke, the held snapshots, confirm).
- **Menu and scopes:** `nav.ts` gains `admin-tally` and `tally-checks`; also the BOS route list, the message scopes and the copy-lint button keys.
- **Documents:** API §3.5 and Integration health, DATABASE §6.7 (the new and changed columns, `tally_refused_rows`), SECURITY (the connector principal's paragraph, the jobs check's grant row), the design's "Built (TC2)" record; `db:docs` and `machines:docs` regenerated.

**Tests:**
- `packages/db/tests/security/tally.test.ts` (78 cases with its per-role tables). New since the early check:
  - sealed keys never selectable;
  - a refused later version marks the stored one not current, until a later version clears it;
  - parts kept, each once, a mismatched part refused, an incomplete snapshot dropped after a day;
  - held rows and the companies' Tally counters through the heartbeat;
  - the alert definers only for the jobs check (an Executive, a connector and an agent refused).
- The role × company matrix covers `tally_refused_rows`.
- `packages/domain/tests/commands/tally.test.ts` (18 cases). New since the early check:
  - the key sealed and never in the clear (neither in the table nor in the audit row);
  - it does not open as another connector's;
  - registering refused with no cipher;
  - rotation opens both keys, then only the new;
  - refused rows queued and resolved;
  - a snapshot in two parts compared once, with a mismatched part refused;
  - the heartbeat's held rows and Tally counter;
  - `tally.connector.record_alert` refused to an Executive.
- `apps/web/tests/tally-connector.test.ts` (16 cases): the earlier cases on sealed keys, plus the release route (404 for a verified connector, 401 for an unknown one) and 503 with no cipher.
- `apps/web/tests/tally-alerts.test.ts` (2 cases, new): a connector that never checked in raises nothing; a silence and held rows raise once each, then again after the next stretch.
- Updated: the refusal sweep (`tally.connector.record_alert` in `CHECKS`), the masking exemption for `key` (an example the masker would change), refusal coverage (four commands with no company reviewed), reader parity (five reads), `contract-values`, `enum-sync`, `grants`, the API fixture.
- Journey `apps/web/e2e/tally.spec.ts`: an Executive sets up a connector and walks through its key, link, rotation, unlink and turn-off; Integration health's Tally section; Accounts' empty Tally checks, with a screenshot `tally-checks-empty`; Accounts kept out of the connectors. **Not run:** journeys cannot sign in on a seat; the lead runs them and makes the Linux baseline.

**`EXPLAIN (ANALYZE)` under RLS** (as `app_user` with an Executive's settings, on this worktree's database after the suite):
- `listTallyConnectors`: Seq Scan on `tally_connectors` (5 rows; at most a handful in practice), top-N sort, 0.06 ms.
- `listHeldTallySnapshots`: Index Scan using `tally_snapshots_held_idx`, 0.05 ms.
- `readTallyConnectorHealth`: Seq Scan on `tally_connectors`, Bitmap Index Scan on `tally_connector_companies_connector_id_tally_company_pk`, Index Scan on `tally_cursors_company_unique`, 0.05 ms.
- The snapshot diff's read (`app.tally_vouchers_known`, run as the table owner): a Seq Scan at 37 rows; at scale `tally_vouchers_entity_state_idx` (`entity_id`, `tally_company`, `state`) serves it.

**Checks** (each through `tools/integration/heavy.sh`):
- `pnpm exec turbo run typecheck`: 10 tasks successful.
- `pnpm lint` (the whole repository, the final check): clean.
- `pnpm copy-lint`: clean.
- Unit tests (`turbo run test --force`):
  - contracts 340 passed, after the release endpoint's `not_found` was added: the round before had one failure, the catalogue missing that code;
  - db 163 passed;
  - domain 2,809 passed;
  - web 1,242 passed, 1 skipped.
- Security suite (`turbo run test:security --concurrency=1`, on this worktree's database, migrated and seeded fresh after the VM moved it to 54331):
  - db 63 files, 1,912 passed (`tally.test.ts` 78 with its role cases);
  - domain 111 files, 1,540 passed (`tally.test.ts` 18);
  - web 41 files, 479 passed (`tally-connector.test.ts` 16, `tally-alerts.test.ts` 2).
- `pnpm build`: compiled.
- `pnpm --filter web js-budget`: every page within its budget (67 pages), after the budget changes below.
  - **`apps/web/js-budget.json` changed, a checks change that needs the owner's `checks-ok`.** The two new pages got their budgets (`/admin/integrations/tally` 205 kB, `/tally-checks` 237 kB, each measured plus 5 %).
  - `/catalogue` (245.1 of 245 kB) and `/admin/integrations` (241.0 of 241 kB) were raised by 1 kB each for the shell's two new menu entries (and the Tally section on Integration health), as H1 did for its menu entries.
- `pnpm db:docs` and `pnpm --filter @shakti/domain machines:docs`: regenerated and committed.
- Not run: the journeys (`apps/web/e2e/tally.spec.ts`, written; a seat cannot sign in) and their Linux screenshot `tally-checks-empty`.

**Assumptions (calls the brief and the lead's notes did not settle):**
- A connector's seal context is company 0, column `key`, row the connector's id, so retiring the old key moves the next one into `key_sealed` without sealing it again.
- The route caps a snapshot or part at 4.5 MB (Vercel's limit); the connector's splitting is TC4's.
- The tombstoning of a held snapshot happens when Accounts confirm it.
- Accounts confirm held snapshots on a Tally checks page of their own (`finance.recon.write`); Executives hold that grant too.
- The jobs check's `platform.jobs.check` also reads the connectors' alert facts and records an alert, rather than a new platform grant.
- Refused rows and the GUIDs a snapshot lacks are stored for TC3's review queue; TC2 shows neither on screen.

**For the lead at integration:**
- `finance.read` merges with FN1's catalogue and seed rows.
- `connector.ts` is TC1's file as of `a3d52758` plus `part` and `SNAPSHOT_MAX_PARTS`; take TC1's latest and keep `part`.
- `endpoints.ts`'s `connector.release` path changed to `/connector/tally/release`; TC1's client, if it reads that path, follows.
- Migrations `0240`/`0241` are numbered after this branch's base; `main` now has `0242`, so they are renumbered at the merge.
- The Tally checks page needs its Linux baseline.

**Skills loaded:** `add-table`, `add-command`.

### 28-11-2026, fixes (slot worktree `tc2-tally-ingest` in the lead's cloud VM, Postgres 54334; moved from seat 3)
The one fix round: M1, M2, M3, M5, L1 to L5, L7 and L8, as the lead's triage says. The schema changes are folded into this branch's own two migrations (not on `main`), so the lead's renumbering is unchanged. Skills loaded: `add-table`, `add-command` (for the earlier rounds; this round follows the same recipes).

**M1, a row in conflict held for Accounts, the batch applied:**
- `tally_refused_rows.reason` (new, `connector_refused`, `other_company`, `type_changed`, `not_debtor`; check `tally_refused_rows_reason_check`, paired in `enum-sync` with the contract's `TALLY_REVIEW_REASONS`). `field` is the contract's field, or `company`, `type` or `parent` for a held row.
- `tally.batch.ingest` asks the new definer `app.tally_guids_elsewhere()` which of the batch's voucher and ledger GUIDs another company or Tally company holds, and holds those back (`other_company`), with a voucher that moved between a purchase and a sale (`type_changed`) and a ledger refused by L3 (`not_debtor`). They go to `tally_refused_rows` through `app.tally_refused_write()` with the connector's refused rows (one per GUID); the rest applies, the cursor moves on, and the answer lists them.
- Contract: `TallyHeldRow` and `TALLY_HELD_REASONS` in `connector.ts`, and `held` on `ConnectorBatchResponse` (optional in the shape, always answered). `ConnectorAnswers.batch` reads `held` loosely (`reason` as text), so a later reason never stops an installed connector. **`connector.ts` is TC1's file: the lead merges these additions with TC1's.**
- The audit row counts `held`; the Activity log labels it.

**M2:** `UnmapTallyCompanyInput` gains `tallyCompany`; `app.tally_connector_unmap(connector, entity, company)` deletes that one mapping; the audit row's `before` names that Tally company only. The Unlink button sends it, and its label names it ("Unlink {tally} from {company}").

**M3:** Tally checks: each held check has "See records", which lists the records it would mark removed, newest first, 50 a page with "Load more": number, date, party and type, never an amount (`listHeldTallyVouchers`, `HeldTallyVouchersQuery`, `HeldTallyVoucherDto`, `HeldTallyVoucherPageDto`). It reads under the viewer's own policies (no definer), so a purchase or debit note shows only to those who also read supplier rates, and the screen says how many more there are. A check no longer held answers `tally_snapshot_missing`.

**M5:** DATABASE §4.1's definer register has the slice's definers (13 rows, each with what it checks, its search path and the roles that may run it). SECURITY §3.3's connector paragraph now says the route runs one lookup, `app.tally_connector_auth()`, as the unverified principal the header names before the signature is checked, and that the definer answers only that connector's own row; with the new order of checks (L5). The design's Built record says the same, and names M1, M3 and M2. The `CONNECTOR_TABLES` comment and the security test's header say "sealed keys".

**L1:** each `on conflict (guid) do update` also requires the same company and Tally company. The other-company check of `app.tally_vouchers_write()` and `app.tally_ledgers_write()` now runs after the writes, in a new statement, so a row another company's batch committed at the same moment is seen and the call refused (`tally_vouchers_guid_unique`, `tally_ledgers_guid_unique`). The voucher definer also refuses a GUID that ends up in both tables (`tally_voucher_type_changed`). A ledger batch keeps rows the newest AlterID already holds, so a row count would not tell; the check after the writes covers both.

**L2:** `app.tally_tombstone()`: a person marks only the GUIDs the held snapshot holds, whatever the call names; the connector only for the snapshot it compared in the same transaction. The new `tally_snapshots.compared_at` (set by `app.tally_snapshot_write()`, null only while receiving, check `tally_snapshots_compared_check`) must equal `now()`.

**L3:** `isDebtorLedgerParent()` (`packages/domain/src/tally/ledger-groups.ts`, unit-tested). See the decision below.

**L4:** Set up connector and Make a new key make the key in the action, so a retry under the same form key reaches the command with other input. The action turns that `idempotency_mismatch` into `tally_key_not_shown`: "This was done, but its key did not reach your screen. Make a new key for the connector in the list below." No key that was never stored is shown.

**L5:** the routes, in order:
1. The three headers well formed and the timestamp within five minutes, before the body is read or the database asked.
2. The caps with the existing limiter (`countRequest` in the shared store): `TALLY_CAPS`, 240 a minute per connector id and 600 per address, then 429 with `Retry-After`; TC1 honours it.
3. An id the database did not know, not looked up again for a minute.
4. The body within its cap.
5. The HMAC over the headers and the body's digest under the keys this instance read of the connector in the last minute (`apps/web/src/integrations/tally/connector-cache.ts`), so a call verifies before any transaction.

The connector is read again (one lookup, `app.tally_connector_auth()`) when the instance has no reading of it, during a rotation (read again on every call, so a retired key stops at once), or after a refused signature once the reading is ten seconds old. The Admin actions forget a connector on their own instance. A definer refusal (42501) forgets it too and answers 403, and the next call reads it again (a revoked connector is then 401).

**L7:** "This connector has been turned off. Set up a new connector instead."

**L8:** journey "shows a new key once, and the connector, in every layout": every project sets up a connector of its own, checks axe with the key shown and with its card, pictures both (`tally-connector-key`, `tally-connector-card`, the number and key `data-dynamic`, the name and key hint masked) and turns it off. The lifecycle journey's Unlink label follows M2.

**L6:** API §3.5 says the silence alert comes 30 to 90 minutes after the last heartbeat (the hourly check), as accepted. API §3.5 also gives the caps, the order of checks, the held rows and `held` in the answer.

**Tests:**
- `packages/db/tests/security/tally.test.ts`: 82 with its per-role cases (4 new):
  - `app.tally_guids_elsewhere()` answers only the company's connector, and a person is refused;
  - a voucher sent into both tables and a ledger of another company are refused after the writes, and the other company's row is untouched;
  - a person confirming marks only the held GUIDs;
  - the connector tombstones only for the snapshot it compared in the same transaction, and one compared an hour earlier is refused.
- `packages/domain/tests/commands/tally.test.ts`: 20 (2 new):
  - the next year's Tally company holds a voucher and a party ledger of the current year's (`other_company`) and a creditor's ledger (`not_debtor`), applies the rest, and its next batch applies;
  - a voucher moved from a receipt to a purchase is held (`type_changed`) and its stored version marked not current, with every reason and field in the review rows.
  - Changed: the held snapshot's records paged 20 and 12 for Accounts (32, with the purchase; only number, date, party and type), 31 for a GM, then `tally_snapshot_missing` once confirmed; unmap removes one Tally company (the next year's stays, the audit row names one), a second unmap answers `tally_company_not_mapped`.
- `apps/web/tests/tally-connector.test.ts`: 19 (3 new):
  - a warm instance verifies, and refuses a wrong key, with no cipher, so before any lookup;
  - a stale or unsigned call is refused with its body unread;
  - each cap answers 429 with `Retry-After`.
  - Changed: the batch's answer has `held: []`; the revoked connector is 403 on a warm instance, then 401.
- `packages/domain/src/tally/ledger-groups.test.ts` 3 (unit). Updated: `agent-refusals` (unmap's input), `reader-parity` (`listHeldTallyVouchers`), `enum-sync` (2 pairs), the role × company fixture (the two new columns).

**Checks** (each through `tools/integration/heavy.sh`, on this worktree's database, migrated and seeded fresh first):
- typecheck of contracts, db, domain and web: 5 tasks successful;
- folder lint of every folder touched: clean after one fix (3 `no-unsafe-assignment` in the domain test);
- `pnpm copy-lint`: clean;
- unit tests: domain `src/tally` and `src/command` 13 files, 184 passed; contracts 25 files, 340 passed; web `src/i18n`, `src/screens` and `nav` 34 files, 286 passed;
- security suites: db 63 files, 1,916 passed; domain 111 files, 1,542 passed (the first run had 21 failures, from unmap's missing input in the refusal sweep, the audit column's name and a GUID shared with the parts test, all in the tests); web: FIXME;
- `pnpm lint` (the whole repository): clean;
- FIXME build, js-budget, journeys;
- `pnpm db:docs`: regenerated (the two columns).

**`EXPLAIN (ANALYZE)` under RLS** (as `app_user` with an Accounts' settings, 20,000 sales and 2,000 purchases stored, a held check of 5,500, removed afterwards): `listHeldTallyVouchers`'s page uses an Index Scan on `tally_vouchers_guid_unique` (`guid = ANY (held_guids)`), 5,000 rows, and one on `tally_purchase_vouchers_guid_unique`, 500 rows, then a top-N heapsort for the 51 rows; 19.5 ms. The count reads the same two index scans. The held check's records are sorted in memory, since only its GUIDs select them; a check holds at most the company's live vouchers.

**Decisions the brief and the triage did not settle:**
- **L3, which ledgers are "under Sundry Debtors":** TC1 reads ledgers with Tally's `IsBelongsTo: Sundry Debtors`, which takes a group a company made under Sundry Debtors too, and sends only the immediate group as `parent`. Refusing every `parent` but "Sundry Debtors" would hold back every dealer under a company's own group (dealers by area). So the BOS refuses a ledger whose group is one of the 27 other groups Tally starts every company with (Sundry Creditors, Purchase Accounts, Bank Accounts and the rest), and keeps Sundry Debtors and a company's own groups. A connector sending a creditor under the company's own group would still pass; the full check needs TC1 to send the primary group (a follow-up for TC1 or TC4). A ledger stored before and later sent under another group keeps its stored row; it is not deleted.
- **L5, the cache:** keyed by connector id for a minute in each instance. A key retired within a minute of the rotation on an instance that read the connector before the rotation may verify there for the rest of that minute; with the rotation under way read on every call, this is the only window. A revoked or unlinked connector within the minute is refused by the definers (403), and that instance then reads it again.
- **M1:** a held voucher of another company does not mark anything not current in that other company; a held `type_changed` voucher marks this company's stored version not current, as a refused row does.
- **L4:** the reason is turned in the action rather than leaving the key out of the runner's hash, which would have needed a change to the shared runner.
- **M3:** no confirm dialog or "Not right" action, and no journey with a held check: the triage named the list alone.

**For the lead:**
- `connector.ts`'s additions (`TALLY_HELD_REASONS`, `TallyHeldRow`, `held` on the batch answer and in `ConnectorAnswers.batch`) merge with TC1's file.
- New screenshots for the Linux baselines: `tally-connector-key` and `tally-connector-card` in every project, beside `tally-checks-empty`.
- `copy-lint.config.json` gains the button key `seeRecords`.

## Review

### 27-11-2026, review of `add5048e` (slice reviewer, Opus 5.5 at high, worktree `tc2-tally-ingest`, Postgres 54331)
**Verdict:** no critical or high finding. Nothing blocks the merge. M1 to M5 become follow-ups unless the lead takes them now; M2 and L7 are a few lines each.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| M1 | medium | `packages/domain/src/commands/tally/ingest.ts:207-211`; `0241_tc2_tally_ingest_rls.sql:349-360` and `:445-454` (`tally_vouchers_write`, `tally_ledgers_write`); `0240`: `tally_ledgers_guid_unique` on `guid` alone | One row in conflict refuses the whole batch with 409: a voucher whose type moved between purchase and sale (`tally_voucher_type_changed`), or a voucher or ledger GUID another company or Tally company already holds (`tally_voucher_other_company`). The cursor cannot pass that row, so every later batch of the company starts at the same `fromAlterId` and is refused the same way. Ledger GUIDs are unique across every company. | The builder lets one group company map several Tally companies, one per financial year. If Tally carries a party ledger's GUID into the new year's company (a split or a copied company; not verified against Tally here), that company's first batch that touches the ledger is refused. Its sync stops for good, and the only signals are `waiting_on_bos` and the held-rows alert. The same happens to a voucher whose type is changed in Tally. | Store a conflicting row in `tally_refused_rows` (kind, GUID, AlterID, field `type` or `company`) for Accounts, skip it, and let the batch and the cursor go on. Or key `tally_ledgers` by (`entity_id`, `tally_company`, `guid`). Add a test where one conflicting row does not stop the next batch. | plausible (code path confirmed, Tally's GUID behaviour not) |
| M2 | medium | `0241…sql:893-905` (`app.tally_connector_unmap` deletes every mapping of the connector and company); `apps/web/src/components/tally/tally-connectors-screen.tsx:298-316` (an Unlink button on each Tally company's row) | The screen offers Unlink on each Tally company. The command takes only (`connectorId`, `entityId`), so it unlinks every Tally company of that group company. The audit row's `before` joins all of their names. | RCREF has "RCREF 2025-26" and "RCREF 2026-27" linked, the setup the builder allows. An Executive unlinks the old year. The current year is unlinked too, and its batches answer 403 `tally_company_not_mapped` until someone notices the alert. | Add `tallyCompany` to `UnmapTallyCompanyInput` and to the definer's `where`. Or put a single Unlink on the group company, labelled to say it unlinks every Tally company of that company. | confirmed (read end to end) |
| M3 | medium | `apps/web/src/components/tally/tally-checks-screen.tsx:60-76`; `apps/web/e2e/tally.spec.ts:66-75` | The hold exists because a large removal is "far likelier a wrong company or an empty export". Yet Tally checks shows only two counts. It does not say which records would be marked removed (number, date, party, type), nothing asks Accounts to confirm before the change, and there is no way to turn a held check away, so it waits until a newer one replaces it. The screen with a held row is in no journey, so it has no axe check and no screenshot. | Accounts press Confirm on a check made from an empty export. Hundreds of live sales and receipts are marked removed in one click (`tally_voucher_tombstones` is append-only). TC3 then reverses their payments and links. | List the vouchers a held check would remove (paged, with no purchase amounts unless the caller holds `procurement.rate.read`), confirm in a dialog that names the count, and add a "Not right" action. Seed a held snapshot for a journey with an axe check and a screenshot. If this is not wanted, record the owner's decision. | confirmed (screen read); the design does not settle this |
| M4 | medium | `apps/web/src/integrations/tally/routes.ts:51` (`TALLY_SNAPSHOT_MAX_BYTES` 4.5 MB) against `origin/feat/tc1-tally-connector` `apps/tally-connector/src/sync.ts:378-398` | The BOS caps a snapshot at 4.5 MB and expects larger ones in `part`s. TC1, already integrated, always sends the whole snapshot in one body and never sets `part`. | A company with more than about 80,000 voucher GUIDs from `fromDate` gets 400 `tally_body_too_large` every day. TC1 holds the row, no tombstone is ever found, and the ledger balances (dealer outstanding) stop updating. | The lead pairs TC1 and TC2: TC1 sends parts of at most `SNAPSHOT_MAX_PARTS` (or TC4 does, as the builder notes). Until then, say in TC1's run file that a snapshot is limited to about 80,000 GUIDs. | confirmed (both branches read) |
| M5 | medium | `docs/05-database.md` §4.1 "Security-definer functions"; `docs/07-security.md:318`; design §6.3 "Built (TC2)"; `packages/db/src/testing/index.ts:492` | (a) The definer register in DATABASE §4.1 lists none of the slice's 25 definers (`app.tally_*`, `app.tally_require_*`), though every recent slice adds its own rows there (H1's `app.stock_move`). (b) SECURITY and the Built record say the route builds the connector principal "only after the request's HMAC verified". In fact `verified()` (`routes.ts:116-121`) first runs `findTallyConnector` in a transaction as the unverified principal the header names, which is how it gets the sealed keys. (c) The `CONNECTOR_TABLES` comment still says "key hashes". | A reviewer or the G5 sweep reads the register and misses 25 definers, or trusts a security statement that is not true. | Add the §4.1 rows: what each checks, the search path, the migration, and which ones `app_reader` may run. Say in SECURITY and the Built record that the route runs one lookup, `app.tally_connector_auth()`, before the signature is checked, and that this lookup answers only that connector's own row. Fix the comment. | confirmed |
| L1 | low | `0241…sql:374-387`, `:403-416`, `:460-465` | `on conflict (guid) do update … where alter_id < excluded.alter_id` does not check that the stored row belongs to the same company. The cross-company check before it reads committed rows only. | Two connectors send the same GUID for two companies at the same moment. The second waits for the first's insert, then overwrites that row's party, amount and payload with its own company's data, while `entity_id` stays the first company's. | Add `and v.entity_id = excluded.entity_id and v.tally_company = excluded.tally_company` to each `do update … where` (one line each), and check the row count. | plausible (needs a concurrent duplicate GUID) |
| L2 | low | `0241…sql:678-741` (`app.tally_tombstone`) | The definer marks any GUIDs it is given as removed. On the person path it does not limit them to the snapshot's `held_guids`. On the connector path it accepts any `applied` snapshot of that connector, though its comment says "only the snapshot just recorded". Today only the command code calls it, so this is a missing second check, not a hole. | A later command, or a change to this one, passes other GUIDs. A person confirming one check could then mark any voucher of that company removed. | Intersect `p_guids` with `v_snap.held_guids` on the person path. Limit the connector path to a snapshot made in this transaction (for example `created_at = now()`). | confirmed (read) |
| L3 | low | `0241…sql:434-478`; `TallyLedger.parent` free text | The BOS keeps ledgers under any Tally group, and anyone with `finance.read` reads them (a GM included). TC1 reads only Sundry Debtors, but the BOS does not check that. | A connector that sends Sundry Creditors or Purchase Accounts puts supplier balances and purchase totals in front of people without `procurement.rate.read`. | Accept only party ledgers under Sundry Debtors, or keep any other group out of the `finance.read` policy. | plausible (depends on the connector) |
| L4 | low | `apps/web/src/actions/tally.ts:66` and `:91` | The action makes a new key on every call, and the key is part of the command's hashed input. A retry under the same form key, which `useCommand` keeps "so a retry after a lost answer acts once", therefore answers `idempotency_mismatch`. | The answer to "Set up connector" is lost after the commit. The retry shows an error, and the connector exists with a key nobody has seen. The Executive has to find it and press "Make a new key". | Leave `key` out of the idempotency hash, and on a replay say "the key was shown before; make a new key". Or explain this in the failure sentence. | confirmed (read) |
| L5 | low | `apps/web/src/integrations/tally/routes.ts:106-121` | Before anything is verified, the route reads the body up to its cap (4.5 MB on `/snapshot`) and opens a database transaction for any well-formed connector id. Nothing limits the rate. | Unauthenticated floods use up the pool connections and function time of the companies' other routes. | Check the headers and the timestamp before reading the body and querying. Keep unknown ids in memory for a minute. Consider a rate limit per IP. | plausible |
| L6 | low | `apps/web/src/workers/tally-alerts.ts` run by the hourly jobs check | The design says "the silence alert at 30 minutes". An hourly check raises it 30 to 90 minutes after the last heartbeat. | The office PC goes off at 10:01 and the alert goes out at about 11:00 or later. | Accept this and write it down (API §3.5 and the design say 30 minutes), or run the Tally alerts more often. | confirmed |
| L7 | low | `apps/web/messages/en.json:541` | The sentence says "Register a new connector instead", but the button is called "Set up connector". | A person looks for a "Register" button that is not on the screen. | "This connector has been turned off. Set up a new connector instead." | confirmed |
| L8 | low | `apps/web/e2e/tally.spec.ts:17-21` | Admin › Integrations › Tally is exercised only in `desktop-light`, with no screenshot, so its dark and phone layouts and the key-shown box are never checked. | A layout fault on a phone or in dark mode (the key box, the Field with its Link action) goes unnoticed. | Open the page read-only in every project (empty, or a seeded connector), run the axe check and take a screenshot with the key masked (`data-dynamic`). | confirmed |

**Checked and sound:**
- **HMAC and replay.**
  - The signing string covers the method, the path and query exactly as they arrived, the timestamp and the body's SHA-256. Both keys are tried on every call, with constant-time comparison.
  - The 5-minute skew is tested at ±290 and ±310 seconds.
  - A revoked connector is found by nobody, and a retired key drops out of the cache because the cache is keyed by ciphertext.
  - `Idempotency-Key` is not signed, but replaying a batch under another key answers `cursor_mismatch`, because the cursor is locked (`tally_cursor_lock` … `for update`) and moves forward only. TC1 also sends its snapshots with a key.
  - `X-Connector-Id` is not signed either, which is harmless with one key per connector.
  - Sealed keys are bound to the connector's row and kept out of the audit row, the refusal row (`auditInput`), the masker and every request role's column grants.
- **The connector principal's reach.**
  - Role `system:tally_connector` holds only the platform-only `tally.connector.sync`. Its companies are the mapped ones, and each call narrows to the one company it names. `entityCode` must match the mapping too, which catches a company mapped to the wrong group company.
  - Every definer checks the grant, the role, a live connector with the caller's own id and the (company, Tally name) mapping. The connector reads no table on either pool (tested).
  - `app.request_is_person()` refuses it, so the admin and confirm definers do too.
- **Purchase vouchers by grant.**
  - Policy: `finance.read:entity` and `procurement.rate.read:entity` together. Executive and Accounts read them; GM, the inventory manager, the agents and the connector do not.
  - The role × company matrix and `tally.test.ts` assert this per role on `app_user` and `app_reader`. `readonly_reporter` has no grant.
  - The team and own grants of `finance.read` (Sales Lead, LC) never satisfy `:entity`, because `serializeGrants` expands only narrower scopes, so they read none of the mirror.
  - Tombstones, refused rows and snapshot GUID lists show a purchase voucher's GUID and type to `finance.read`, never an amount or a rate.
- **Definers and grants.** All use `search_path = ''` and revoke `public` and `readonly_reporter`. `app_reader` may run exactly the four definers that queries call. Every table forces row security with select-only grants, `NARROWER` is all false, and tombstones are append-only by a guard.
- **Commands.**
  - The six admin commands and `tally.snapshot.confirm` are `peopleOnly`, and all are in `INPUTS`/`PEOPLE_ONLY_INPUTS`. The connector commands are in `CHECKS`.
  - Every command has denied, wrong-company and happy-path tests. `auditFields` is labelled. Audit rows hold counts only, the heartbeat writes none, and no event is emitted, since the design asks for none.
  - Cost permissions are untouched.
  - Concurrent confirms: the second gets `tally_snapshot_not_held`. Snapshot parts are serialised by a row lock.
- **Web.** Reads go through `executeQuery` with a name and writes through `executeCommand`. Both pages use `screenAccess(navRequires())`. Browser code imports only types from `@shakti/contracts`. Nothing connects at import time.
- **Performance.** I timed the batch's known-voucher read (`app.tally_vouchers_known` with 500 GUIDs) at about 1 ms against 200,000 stored vouchers of one company, using the generic plan after the fifth call. That data was rolled back afterwards.

**Runs (each through `tools/integration/heavy.sh`, on this worktree's database after `pnpm db:migrate` and `pnpm db:seed`):**
- db security `tally.test.ts`, `role-entity-matrix.test.ts`, `grants.test.ts` and `enum-sync.test.ts`: 4 files, 413 passed;
- domain security `commands/tally.test.ts`, `security/agent-refusals.test.ts` and `queries/reader-parity.test.ts`: 3 files, 89 passed;
- web security `tally-connector.test.ts` and `tally-alerts.test.ts`: 2 files, 18 passed;
- db `data-docs.test.ts`: 18 passed; domain unit `state-machines`, `command` and `tally`: 18 files, 1,524 passed.

**Not run or not checked:**
- The journeys in `apps/web/e2e/tally.spec.ts`, all four: a seat cannot sign in. Not run: "sets up a connector, links a company, rotates its key and turns it off", "Integration health shows the Tally section", "lists the checks waiting, none here" and "cannot open the connectors". The Linux baseline `tally-checks-empty` does not exist yet, so I saw no screenshot.
- Not re-run: the full security suite of all three workspaces, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `js-budget` and `copy-lint`; I relied on the builder's runs for those.
- `apps/web/js-budget.json` changed, which is a checks change: it needs the owner's `checks-ok`.
- Next.js on Vercel passing `request.url`'s query through unchanged, which the signature depends on, cannot be checked here.

**The lead's triage (27-11-2026):** fix M1, M2, M3, M5, L1 to L5, L7 and L8 in the one fix round.
- **M1:** a row in conflict goes to the review queue with its reason. The rest of the batch applies, and the batch answers 200, listing the rows held.
- **M2:** Unlink removes the one mapping shown.
- **M3:** the held snapshot lists the records it would mark removed (number, date, party, type), paged.
- **M5:** the definer rows in DATABASE §4.1, SECURITY's line, and the Built record.
- **L3:** keep only ledgers under Sundry Debtors; refuse others in the batch with a reason.
- **L5:** verify the HMAC over the headers and a body digest before opening a transaction, and rate-limit per connector id and per address with the existing limiter.
- **L1, L2, L4, L7 and L8:** as the review says.
- **M4:** a follow-up for TC4 (the connector sends parts). It is recorded in STATUS.
- **L6:** accepted and written in API §3.5. The silence alert comes 30 to 90 minutes after the last heartbeat, from the hourly check.
- **No re-check:** the lead reads the diff.

## Integration
