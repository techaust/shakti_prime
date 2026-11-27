# TC1 The Tally connector (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/tc1-tally-connector` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): a service on the client's PC holding a signing key, financial data |
| Usage | briefed 27-11-2026; built on Opus 5.5 at high (start, early check and done, 27-11-2026) |
| State | done |
| Next step | the review |

## Brief
Build [phase5 §6.2](../../03-roadmap-appendix/phase5.md#62-tc1-the-tally-connector) as written, with question 1 (a), and ADR 0013 (change its status to "Accepted (27-11-2026, Phase 5 design)"). The BOS side's rules, contracts and signing already exist; read `docs/04-architecture-appendix/tally.md`, `packages/domain/src/tally/sync-rules.ts`, `packages/contracts/src/api/connector.ts` and `apps/web/src/integrations/tally/` first. Points settled here:

1. **`apps/tally-connector`** (`@shakti/tally-connector`), Node 24 and TypeScript, strict, importing only `@shakti/contracts` (never the database or the domain):
   - `reader`: Tally's XML server on `TALLY_URL` (port 9000), one company and one request at a time, pages of 200 by AlterID, a pause between requests (named setting), timeouts and retries with backoff; move `tally-xml.ts`'s parsing here (the web keeps only what its spike script needs, or imports it from here if the fences allow; say which).
   - `outbox`: SQLite through Node's built-in `node:sqlite` (no package), one database file per installation: pages written before sending, marked sent on the BOS's answer, kept 7 days after.
   - `client`: the BOS calls (`cursor`, `batches`, `snapshot`, `heartbeat`) signed per `connectorSigningString` with the key, an `Idempotency-Key` per batch; a lost answer resends the same batch.
   - `scheduler`: heartbeat every 5 minutes; reads every 2 minutes per company while the BOS answers; the GUID snapshot daily at 02:00 IST.
   - `config`: company mappings, the BOS URL, the connector id and key, read from an encrypted file. On Windows the file is DPAPI-protected through a small PowerShell call (`ConvertFrom-SecureString` style, no package); elsewhere (tests, Linux) a plain file is refused unless `TALLY_CONNECTOR_DEV=1`.
   - `setup` command: asks for the values once (the key at a hidden prompt), writes the encrypted file, and tests a heartbeat.
   - Logs rotate daily, hold ids and counts only, never a party name, an amount or the key.
2. **Fixture server** (`apps/tally-connector/test/fixture-tally.ts`): serves Tally-shaped XML for vouchers and ledgers by AlterID from recorded shapes (the spike's and Tally's documented format), with knobs for slowness, errors and alterations.
3. **Tests** (vitest, Node): paging by AlterID; the outbox across a kill mid-batch (a child process killed and restarted); a resend after a lost answer applied once (against a stub BOS that checks idempotency keys); signing matching the BOS's verifier; throttling; and a 3-day outage (the stub BOS down, Tally altering vouchers) caught up in order with nothing twice. These run in the workspace's `test` script on Linux.
4. **Packaging (waits for the owner's yes):** a single executable with Node's SEA and `postject` 1.0.0-alpha.6, run as a service by WinSW 2.12 with an XML config; a `windows-latest` CI job builds it and runs the tests on Windows (a checks change: the owner's `checks-ok`). The owner has not yet said yes to `postject` and WinSW: build and test everything else; write the SEA config, the WinSW XML and the CI job as files, and stop at `report: tc1-tally-connector early check` naming what waits on the yes. Install nothing.
5. **Scripts:** the lead made `apps/tally-connector/package.json` with `typecheck` and `test` (vitest) and the lockfile; add a `tsconfig.json` and leave the scripts and dependencies as they are.

**Early check (Tier A):** once the reader, outbox, client, scheduler and their tests pass on Linux, write a short report and push `report: tc1-tally-connector early check`, then stop.

Files owned: `apps/tally-connector/**`; the move of `tally-xml.ts`; ADR 0013's status; the CI job file.

Do not touch: the BOS's connector routes and tables (TC2); reconciliation (TC3).

Review checklist: the key never logged, printed or stored in plain text outside dev; nothing written to Tally (read-only requests only: no `IMPORT` request anywhere); idempotent resend; the outbox survives a kill; throttling holds.

### Brief addendum (the lead, 27-11-2026): packaging approved
The owner approved `postject` and WinSW on 27-11-2026. `postject` 1.0.0-alpha.6 is now a development dependency of this workspace (the lead's commit, with the lockfile). The Windows CI job downloads `https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe` and refuses it unless its SHA-256 is `05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da` (taken by the lead from that release on 27-11-2026). Build the packaging too; the early check now includes the SEA config, the WinSW XML and the CI job file; the first Windows run is read by the lead on the pull request.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: tc1-tally-connector <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: tc1-tally-connector blocked` with the question and stop.
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

### 27-11-2026, early check (seat, worktree `tc1-tally-connector`)
**Built** (the reader, outbox, client, scheduler, setup and packaging; no schema, migration, command or screen):
- `apps/tally-connector/src/`: `tally/xml.ts` (moved from `apps/web/src/integrations/tally/tally-xml.ts` with `voucherTypeOf`, then grown: AlterID windows `(after, upTo]`, party ledgers, the company's state, the voucher type's parent for renamed types, UTF-16 answers, Tally's error answers), `tally/reader.ts`, `outbox.ts` (`node:sqlite`, WAL, `synchronous = FULL`), `client.ts`, `signing.ts`, `sync.ts`, `scheduler.ts`, `config.ts`, `dpapi.ts`, `setup.ts`, `log.ts`, `messages.ts`, `settings.ts` (the named settings), `main.ts` (`setup`, `run`, `version`); `tsconfig.json`; `README.md` (parts and the office-PC install steps).
- `apps/tally-connector/test/`: `fixture-tally.ts` (Tally-shaped XML by AlterID window from the spike's recording, knobs for slowness, 500s, silence, UTF-16, closed companies, edits and deletions; refuses anything but an `Export`), `stub-bos.ts` (verifies every signature, cursor per company, `cursor_mismatch`, idempotency store with replay and `idempotency_mismatch`, records every applied voucher version; knobs for down, lost answers, holding a batch before or after applying), `harness.ts`, `child-connector.ts`.
- Packaging: `packaging/build-sea.ts` (esbuild bundle to one CommonJS file, SEA blob from `packaging/sea-config.json`, `postject` inject, then checks the executable answers its version), `packaging/postject.d.ts`, `packaging/winsw/shakti-tally-connector-service.xml`, and the CI job `.github/workflows/tally-connector.yml` (windows-latest: typecheck, tests with the real DPAPI, WinSW 2.12.0 refused unless its SHA-256 is the pinned one, the executable, WinSW reading its XML, the folder as an artifact). Built and run on Linux here: a 128 MB executable that answers `0.1.0`, refuses to start without settings, and with a dev settings file starts, logs, retries and stops on Ctrl+C.
- The move of `tally-xml.ts`: **the web imports it from the connector**. The spike script (`apps/web/scripts/spike/tally-read.ts`) imports `../../../tally-connector/src/tally/xml` by path; no ESLint fence forbids it (only `apps/voice-agent` has a relative-path fence), it is a local script outside `next build`, and the web keeps no copy. `payloads.ts` loses `voucherTypeOf`; the XML tests moved to the connector. If the lead reads AGENTS §3's "apps → packages" as forbidding even a script, the alternative is a web copy of the four functions the spike calls.
- ADR 0013's status is "Accepted (27-11-2026, Phase 5 design)". `docs/04-architecture-appendix/tally.md` names the reader's new place (two lines).

**Tests** (vitest, Node; `pnpm --filter @shakti/tally-connector test`): 11 files, 50 tests, 49 pass on Linux and 1 runs on Windows only (the real DPAPI round trip).
- `xml.test.ts` 10: windows and escaping, exports only (no `Import`, `ISMODIFY="No"`), the recorded fixture into the contract, renamed types, ledgers, company state, snapshot types, UTF-16, error answers.
- `reader.test.ts` 7: paging by AlterID (vouchers and ledgers in one window, each once, in order); a voucher the contract refuses left out and logged by GUID and field only; the snapshot in windows read on to the new last AlterID when a voucher is edited mid-read; **throttling** (two companies and a snapshot at once: never two requests in flight, the pause between each); timeouts and retries with a doubling wait; unavailable after the retries, a closed company not retried; UTF-16.
- `sync.test.ts` 10: pages marked sent on the answer and a quiet second cycle; what leaves the PC parses as the contract and the log holds no name, amount or key; **a lost answer** retried at once under the same key, and resent next cycle under the same key and body, applied once; `cursor_mismatch` sets queued pages aside and re-reads; **a 3-day outage** (BOS down, Tally adding, editing and deleting vouchers in two companies, a cycle and heartbeat every 3 hours): caught up contiguous, oldest change first, every voucher at its latest AlterID, nothing applied twice, one snapshot a day without the deleted voucher; pages queued when the BOS fell over mid-catch-up resent after a restart; the snapshot after 02:00 India time once a day with `asOf` 5 minutes before the read; the heartbeat from the last cycle without asking Tally; Tally behind the BOS waits for a person.
- `outbox-kill.test.ts` 2: **a connector process killed mid-batch** (held before the BOS applied it, and after) and restarted on the same file sends the same key and the BOS applies the page once.
- `client.test.ts` 5: **signing vectors** equal to the ones `apps/web/src/integrations/tally/tally.test.ts` now verifies with `verifyConnectorRequest` (a batch, and a cursor read with its query); the key absent from `JSON.stringify` and `util.inspect`; the same key and body on every attempt; `Retry-After`; no retry of a refusal.
- `config.test.ts` 4, `log.test.ts` 2, `setup.test.ts` 2, `scheduler.test.ts` 2, `fences.test.ts` 3 (imports only `@shakti/contracts`, `node:` and its own files; no import request to Tally; no `console`).
- Web: `tally.test.ts` 10 (+1 signing vectors, −3 moved).

**Checks:**
- `pnpm --filter @shakti/tally-connector typecheck`: clean; `pnpm --filter web typecheck`: clean (exit 0).
- `pnpm exec eslint apps/tally-connector apps/web/src/integrations/tally apps/web/scripts/spike/tally-read.ts --max-warnings 0`: clean.
- `pnpm exec turbo run test typecheck --filter=@shakti/tally-connector --force`: 2 tasks successful, 49 passed, 1 skipped.
- `pnpm --filter web exec vitest run src/integrations/tally`: 10 passed.
- `node apps/tally-connector/packaging/build-sea.ts`: built and answered `0.1.0` (Linux).
- Prettier: clean on every file touched.
- `pnpm typecheck` (through the lock): 11 tasks successful.
- `pnpm --filter web exec vitest run`: 167 files, 1,239 passed, 1 skipped.
- `pnpm build`, then `pnpm --filter web js-budget`: built; every page within its budget (65 pages).
- `tools/integration/check-doc-links.py`: one finding, `ORPHAN docs/runs/phase5/tc1-tally-connector.md`, the same before this slice's changes (the run file is not linked from an index yet).
- The whole-repository `pnpm lint` is left for the final check at done.
- No schema, policy, command, query, `en.json` or screen: no security suite, copy-lint, `db:docs`, journeys or `EXPLAIN` (no list or search).

**What waits:**
- The first Windows run of `.github/workflows/tally-connector.yml` (read on the pull request); it is a checks change, so the owner's `checks-ok`. It runs only when the connector, the contracts, the lockfile, `.node-version` or itself change.
- The live checks of the discovery visit: the TDL names the connector relies on beyond the spike's (`ALTVCHID`, `ALTMSTID`, `BOOKSFROM`, `$$SysInfo:Version`, `$PARENT:VOUCHERTYPE:$VOUCHERTYPENAME`, `$$IsBelongsTo:$$GroupSundryDebtors`, `LEDGSTREGDETAILS.LIST`), now listed in `tally.md` step 3.

**Decisions the brief did not settle (Assumptions):**
1. Pages are AlterID windows `(cursor, cursor + 200]` up to the company's last AlterID (`max($AltVchId, $AltMstId)`), so a page holds at most 200 rows; vouchers and party ledgers share the window, as the contract's one range per batch requires (Tally gives vouchers and masters AlterIDs from one counter; the visit confirms it). An empty window is still sent, to move the cursor.
2. Ledgers read are those under Sundry Debtors (dealer outstanding), not banks, expenses or suppliers.
3. **For TC2/TC3:** a ledger's closing balance changes when a voucher posts, without a new AlterID, and the contract refuses a ledger at or below the cursor, so the connector cannot send a fresh balance for an unaltered ledger. Dealer outstanding (question 11) needs either balances computed from vouchers or a contract change (a ledger-balance push outside the cursor range).
4. **For TC2:** `missingOnServer` is logged by count only; the contract refuses any row at or below the cursor, so the connector cannot resend those vouchers. The snapshot lists only the voucher types the BOS reads, so a journal is never "missing".
5. **For TC2:** the signature covers the path and query exactly as sent (`URLSearchParams`, a space as `+`); the route must verify the raw `pathname + search` it received.
6. A voucher the contract refuses (a malformed GSTIN, a number over 60 characters, no ledger lines) is left out of its page and logged by GUID and field name, so one odd voucher cannot stop every later one. It reaches the BOS only as a snapshot GUID.
7. On `cursor_mismatch` (an answer lost longer than the BOS keeps its keys, or a cursor reset) the company's pending batches are set aside and Tally is read again from the BOS's cursor in the same cycle. Another refusal (400, 401, 403) holds that company's batches pending, logged, tried each cycle; the other companies go on.
8. Reads happen only while the BOS answers: during an outage nothing is queued, and the catch-up reads each voucher once at its latest version. The outbox holds only pages read but not yet answered.
9. The snapshot runs on the first cycle at or after 02:00 India time on a day without one, per company, so a PC that was off at 02:00 sends it when it comes back. `asOf` is the read's start less the 5-minute skew; `fromDate` is the earliest voucher date read.
10. Settings: DPAPI `CurrentUser` scope with fixed entropy, through Windows PowerShell 5.1 from its full path, the secret only on standard input as Base64. The setup is run under the service's account (`runas`), and WinSW's `install /p` sets that account, so the service opens the file. On Windows a plain file is always refused; off Windows only with `TALLY_CONNECTOR_DEV=1`, which also allows an http BOS. `TALLY_URL` is an environment value (default `http://localhost:9000`, set in the WinSW XML), not a setting.
11. The setup's and the service's few sentences live in `src/messages.ts`, in the design system's plain English: the connector cannot read the web's `en.json` and has no copy-lint of its own.
12. The log admits only numbers, booleans and id-shaped strings through `logId()` (GUIDs, company codes, error codes, field names); anything else is written as `withheld`. Errors are logged by reason, code or class name, never their message. Files rotate by India day and are kept 30 days.
13. `CONNECTOR_VERSION` is `0.1.0` in `src/settings.ts`; TC4's release sets it.
14. **For the lead:** `build-sea.ts` reaches esbuild through tsx (a root development tool) with `createRequire`, under an `eslint-disable no-restricted-syntax` with its reason, because the workspace may not add a package. Adding `esbuild` as a development dependency of the workspace would remove the exception.
15. **For the lead:** `eslint.config.mjs` has no fence block for `apps/tally-connector` like `apps/voice-agent`'s; `test/fences.test.ts` enforces the same rule from the connector's own files. A block in the ESLint config (a checks change) would make it a lint error too.
16. Skills: the brief names none for this slice; none loaded.

### 27-11-2026, done (seat, worktree `tc1-tally-connector`, from `a3d52758`)
The lead's three points after the early check:
- **(a) Dealer balances with the snapshot.** `packages/contracts/src/api/connector.ts`: `TallyLedgerBalance` (party ledger GUID, name, signed closing balance, as of) and an optional `ledgerBalances` on `ConnectorSnapshotRequest` (at most 50,000, each GUID once, refused otherwise with "a ledger appears twice"); the recorded example in `fixtures.ts` carries one; `docs/06-api.md` §3.5's snapshot row names it. The connector reads every Sundry Debtors ledger in the same AlterID windows as the GUIDs (with `SVTODATE` the snapshot's India day, so the closing balance is that day's), the newest reading of each GUID kept, through the same read-on-until-still loop, and sends them with each daily snapshot; a balance moved by a posting without a new AlterID is read as it stands. Batch ledgers now ask for the same period, so their balances are the day's too. The log names the count only.
- **(b) esbuild.** `packaging/build-sea.ts` imports `build` from `esbuild` (the lead's development dependency, 0.28.2); the `createRequire` and both `eslint-disable` comments are gone.
- **(c) The fence.** `eslint.config.mjs`, under a `TC1 the Tally connector` comment: `apps/tally-connector/src` imports only `@shakti/contracts`, `node:` modules and its own files, and nothing by a relative path into another app or package; `apps/tally-connector/packaging` imports only `esbuild`, `postject` and `node:` modules. Tests stay outside, as the voice agent's do. `apps/web/src/lint-fences.test.ts` gains the case (allowed and refused imports for both folders). A checks change: the owner's `checks-ok`, with the Windows job's.

**Tests added since the early check:** connector 51 (50 pass on Linux, 1 Windows only): `reader.test.ts` +1 (every Sundry Debtors balance as at the day across windows, one moved without an AlterID; each ledger read names `SVTODATE`), `sync.test.ts` (the snapshot case now checks the balance sent and that the log holds neither the dealer's name nor the figure). Web: `tally.test.ts` 11 (+1: balances read, a ledger twice refused, a numeric balance and a bad date named); `lint-fences.test.ts` 17 (+1).

**Final checks** (all through the lock, from the commit before this report):
- `pnpm typecheck`: 11 tasks successful.
- `pnpm exec turbo run test --filter=@shakti/tally-connector --filter=@shakti/contracts --force`: connector 11 files, 50 passed, 1 skipped; contracts 25 files, 340 passed.
- `pnpm --filter web exec vitest run`: 167 files, 1,241 passed, 1 skipped.
- `node apps/tally-connector/packaging/build-sea.ts`: built with esbuild imported directly; the executable answers `0.1.0`.
- `pnpm build`, then `pnpm --filter web js-budget`: every page within its budget (65 pages).
- `pnpm lint` (whole repository): clean. `pnpm format:check`: clean.
- `tools/integration/check-doc-links.py`: only the run file's own `ORPHAN` line, as before this slice.
- No schema, policy, command, query, `en.json` or screen: no security suite, copy-lint, `db:docs`, journeys or `EXPLAIN`.

**Review checklist:** the key lives in one private field, never in a log line (`logId` withholds anything not id-shaped), a printout, the outbox or a plain file outside development (DPAPI on Windows; plain only off Windows with `TALLY_CONNECTOR_DEV=1`); every Tally request is an `Export` with `ISMODIFY="No"` (tested on the requests, the fixture refuses anything else, and `fences.test.ts` scans the source); a resend carries the stored body and key and is applied once (lost answer, kill before and after the BOS applied it, outage); the outbox survives a kill (a child process killed and restarted); throttling holds (never two requests in flight, the pause between each).

**Still waiting:** the first Windows run of `.github/workflows/tally-connector.yml` and the owner's `checks-ok` for it and the ESLint change; the discovery visit's check of the TDL names (`tally.md` step 3). For TC2: `ledgerBalances` is the dealer-outstanding source (question 11); the snapshot's `missingOnServer` and the raw `pathname + search` signing are as the early check says (assumptions 4 and 5).

## Review

## Integration
