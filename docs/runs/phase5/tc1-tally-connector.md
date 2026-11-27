# TC1 The Tally connector (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/tc1-tally-connector` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): a service on the client's PC holding a signing key, financial data |
| Usage | briefed 27-11-2026; built on Opus 5.5 at high (start, early check and done, 27-11-2026); fix round on Opus 5.5 at high (start and end, 27-11-2026) |
| State | fixes done |
| Next step | the reviewer re-checks the fix diff of finding 1 (the lead's triage); the lead commits TC2's addendum |

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

### 27-11-2026, fixes (seat, worktree `tc1-tally-connector`, from `57f6ed7e`)
All ten review findings, as the lead's triage says. Commits `e26207a7` (code and tests), `577a75a5` (documents), `e922482c` (the outbox's layout number and its test). Skills: none named by the brief; none loaded.

**Finding 1 (high), an answer the connector cannot read:**
- `packages/contracts/src/api/connector.ts`: `ConnectorAnswers` (`cursor`, `heartbeat`, `batch`, `snapshot`), built from the same field shapes as the strict response schemas but without `.strict()`, so a field the connector does not know is dropped at every level (`accepted` included). The strict schemas are unchanged for the BOS's own tests.
- `src/client.ts` reads every answer through `ConnectorAnswers`; a 2xx that still does not parse is retried in the call with the doubling wait, as a 5xx is, then thrown as `BosUnavailable('bad_answer')`.
- `src/sync.ts`: `bad_answer` no longer stops anything. On a row it counts against the row's attempts like a refusal; the drain goes on past it (only the same company's later batches wait, in order; snapshots and other companies go on); on the cursor call it skips that company for the cycle. The drain stops only when the BOS does not answer at all.
- Tests: the review's reproduction (a batch answer with an extra top-level and nested field, and a heartbeat answer with one) in `client.test.ts`; an unreadable answer retried then given up; in `sync.test.ts` a whole sync against a BOS whose every answer carries new fields, and a batch the BOS applied whose answers were unreadable (row pending, the other company sent, the resend answered from the BOS's store, applied once), and a cursor unreadable twice skipping only that company; contracts: the lenient readings against the strict ones.

**Finding 2, rows tried for ever:** `outboxMaxAttempts` (10) in `src/settings.ts`; the outbox counts `refusals` (answers that did not take the row; a send the BOS never answered does not count, so an outage sets nothing aside). Past the limit a row is `held`, logged `outbox_row_held` with its outbox id, key and code, and counted in the heartbeat's new `heldRows`; `prune()` removes held rows with the sent ones after 7 days. A new day's snapshot supersedes the company's older pending one, and the drain does not send an old snapshot when the next is due that cycle. Tests: a 413 snapshot (plain text, as the platform answers) over two cycles and two days, replaced and sent once, then held and counted; a refused batch held after its attempts and the company read again from the cursor under a new key; the outbox's own `noteRefusal`, `hold`, `supersedeSnapshots` and pruning.

**Finding 3, no `BOOKSFROM`:** the reader's period now requires the books' first day and throws `TallyUnavailable('no_books_from')`; the XML builders take the period as required, so no voucher, ledger or GUID request can go out without one. The sync logs `company_without_books_from`, reports `problem: 'no_books_from'` in the heartbeat and goes on with the other companies. The fixture Tally now filters vouchers by `SVFROMDATE`/`SVTODATE`, or by the company's current period (2026-04-01 to 2027-03-31) when a request names none, and can omit `BOOKSFROM`. Tests: an earlier-year voucher read with the period (reader and snapshot), a company without `BOOKSFROM` never read (only its status asked) and read once it has one.

**Finding 4, refused vouchers:** `ConnectorBatchRequest.refused` (optional, `TallyRefusedRow`: `kind` voucher or ledger, `guid` as Tally gave it up to 100 characters, `alterId` inside the batch range, `field`); the reader puts every row the contract refuses there and logs it by GUID and field only. Fixture: a voucher Tally gives without ledger lines (`noEntries`); test: a sale cancelled that way reaches the BOS in `refused` with field `ledgerEntries`. Contract tests and the recorded fixture carry the field. The addendum for TC2 is below.

**Finding 5, the lag:** the heartbeat's companies gain `tallyLastAlterId` (Tally's last AlterID from the cycle's company status, which already reads `ALTVCHID`/`ALTMSTID` cheaply) and `problem` (`no_books_from`, `tally_behind_bos`, `waiting_on_bos`). A company whose batches wait still has its status read each cycle, so the lag stays current; the heartbeat still never asks Tally itself. Tests: the refused-company case shows `lastAlterId: 0`, `tallyLastAlterId: 4`, `problem: 'waiting_on_bos'`, then both at 4 with no problem.

**Finding 6, documents:** `Built (TC1)` in phase5 §6.2; TESTING §6 names `.github/workflows/tally-connector.yml`; ARCHITECTURE's app table and ADR 0013 (Accepted, and out of the Proposed list at line 370); AGENTS §3 (not planned, its dependency direction, its fence); `missingOnServer`'s comment and tally.md's "listed for a resend"; the web test names `client.test.ts`; API §3.5 rows and §7 for the new fields and `ConnectorAnswers`; the connector's README.

**Finding 7:** `sync.test.ts` "holds only that company while it refuses its batch, and the other company goes on" (403 for company A: A's row pending and tried again next cycle, no further page of A read, B sent both cycles, A caught up in order under the stored key once the BOS takes it), and the `bad_answer` cases above.

**Finding 8:** `Scheduler` takes a `Timers` (clock and timers, `SYSTEM_TIMERS` by default); `scheduler.test.ts` runs on a test clock that moves only when told, with exact times (beats at 0, 30, 60, 90 ms before the first cycle ends; cycles at 0, 120, 240, 360; quick cycles at 0, 150, 300; a stop during the wait with no time passing and no timer left).

**Finding 9, adaptive windows:** `pageSize` 200 is the smallest window, `pageSizeMax` 10,000, `pageGrowBelowRows` 50, `pageShrinkAboveRows` 400 (named settings). The rule counts every voucher and ledger Tally answered with (`page.scanned`, journals too, as that is Tally's cost). A window holding more than a batch carries (500 vouchers or 2,000 ledgers) is read again at half before anything is sent. Tests: a sparse fixture (2 vouchers, 120 AlterIDs of other masters, 60 receipts) paged as 5, 5, 10, 20, 40, 40, 40, 20, 2 instead of 37 fixed pages; 600 vouchers in one window read again narrower (100, 200, 400, 400, 400), nothing twice.

**Finding 10:** `apps/web/scripts/spike/tally-read.ts` and the web's `spike:tally` script are removed (a `package.json` scripts change, so a checks change: the owner's `checks-ok`, with the workflow's and the ESLint fence's); the README row and TESTING §2's list lose it; tally.md says the connector's reader, fixture and tests supersede the spike, and its visit steps now run the connector itself. `parseGuidExport` and the open-ended request forms that only the spike used are gone. The recorded export stays at `apps/tally-connector/test/fixtures/vouchers-export.xml`.

**Tests:** connector 11 files, 65 tests (64 pass on Linux, 1 on Windows only, the real DPAPI round trip), 14 more than at done: `sync.test.ts` 18 (+8), `reader.test.ts` 11 (+3), `client.test.ts` 7 (+2), `outbox.test.ts` 4 (+1), `scheduler.test.ts` 2 (rewritten on a test clock), `xml.test.ts` 10 (updated for the required period). Contracts 344 (+4 in `connector.test.ts`). Web `tally.test.ts` and `lint-fences.test.ts` 28 (unchanged).

**Checks** (all through the lock, from `e922482c`):
- `pnpm typecheck`: 11 tasks successful.
- `pnpm exec turbo run test --filter=@shakti/tally-connector --filter=@shakti/contracts --force`: connector 11 files, 64 passed, 1 skipped; contracts 25 files, 344 passed.
- `pnpm --filter web exec vitest run src/integrations/tally src/lint-fences.test.ts`: 2 files, 28 passed.
- `node apps/tally-connector/packaging/build-sea.ts`: built; the executable answers `0.1.0`.
- `pnpm lint` (whole repository): clean. `pnpm format:check`: clean.
- `pnpm build`, then `pnpm --filter web js-budget`: every page within its budget (65 pages).
- `tools/integration/check-doc-links.py`: the run file's own `ORPHAN` line, as before, and one `PATH` line for `docs/04-architecture.md:73,95,360`, which the Review section's table cites with line numbers (the review's text, left as written).
- No schema, policy, command, query, `en.json` or screen: no security suite, copy-lint, `db:docs`, journeys or `EXPLAIN`.

**Review checklist:** the key is still only in the client's private field and the sealed settings; the new log lines (`outbox_row_held`, `bos_answer_unreadable`, `company_without_books_from`, `page_narrowed`, `voucher_unreadable` with `reported`) hold ids, codes and counts only, and the sync test's no-name, no-amount, no-key check still passes; every request to Tally is still an `Export` with `ISMODIFY="No"` and now always names a period (except the company status); a resend carries the stored body and key (the unreadable-answer and refusal cases end applied once); the outbox's kill test is unchanged and passes; throttling is unchanged and passes.

**Decisions the triage did not settle:**
1. A refusal and an unreadable answer count the same towards `outboxMaxAttempts`; a network failure, a 5xx or a 429 does not count. The limit is 10 (about 20 minutes of cycles for a batch).
2. A batch set aside does not hold the company's next batch: the BOS either applied it (an unreadable answer) or answers the next one `cursor_mismatch`, which sets them all aside and reads again from its cursor. A company the BOS keeps refusing is therefore read again from its cursor about every `outboxMaxAttempts` cycles, each time adding one held row; `heldRows` growing is the signal, and the rows go after 7 days.
3. `problem` and `tallyLastAlterId` are optional fields on each heartbeat company (additive), and `lastAlterId` stays the BOS's cursor. `waiting_on_bos` covers a refused batch, an unreadable answer and a batch waiting behind one.
4. `TallyRefusedRow.guid` is a string up to 100 characters, not `TallyGuidSchema`, so a row refused for its GUID is still reported; a row whose GUID or AlterID cannot be reported at all is counted as `skipped` and logged only. Ledgers the contract refuses go in the list too (`kind: 'ledger'`).
5. `TallyVoucher.ledgerEntries` keeps `.min(1)`: the triage asked for the `refused` list, not the relaxation the review offered. Whether a cancelled voucher without ledger lines should instead pass as a voucher is the lead's call with TC2.
6. The outbox file gains a `refusals` column and a `held` state; no connector is installed yet, so there is no upgrade step. The file now carries `PRAGMA user_version = 1` so a later release (TC4) can upgrade an installed one.
7. Not done from the review's own fix column, as the triage did not ask: a pause proportional to the last request's time (finding 9), and treating an unreadable 2xx as delivered (finding 1).

**For the lead: TC2's addendum** (to commit into `docs/runs/phase5/tc2-tally-ingest.md`):
> From TC1's fix round (27-11-2026), in `packages/contracts/src/api/connector.ts`:
> 1. `ConnectorBatchRequest.refused` (optional): the rows of the batch's range the contract cannot carry, each `{ kind: 'voucher' | 'ledger', guid, alterId, field }`, inside `(fromAlterId, maxAlterId]`. The cursor still moves to `maxAlterId`. Queue each for Accounts: a voucher refused at an AlterID above the version the BOS holds means that version is no longer current (for example a sale cancelled in Tally that comes without ledger lines).
> 2. `ConnectorHeartbeatRequest`: per company the optional `tallyLastAlterId` (the lag is `tallyLastAlterId − lastAlterId`) and `problem` (`no_books_from`, `tally_behind_bos`, `waiting_on_bos`), and the optional `heldRows`. Store them with the heartbeat for Integration health (TC4).
> 3. The connector reads answers through `ConnectorAnswers`, which drop unknown fields: an optional answer field can be added later without breaking an installed connector. The routes still answer the strict response schemas.
> 4. A snapshot the BOS refuses (any 4xx) is tried up to 10 times and then set aside. So `snapshot_would_remove_too_much` should be a 200 with the snapshot held for Accounts, not a refusal. Vercel refuses a body over 4.5 MB (about 90,000 GUIDs); decide gzip (`Content-Encoding: gzip`) or a snapshot in parts before a company grows that large.
> 5. `missingOnServer` is logged by count only: the connector cannot send rows at or below the cursor again, so the BOS lists them for Accounts.
> 6. The signature covers the raw `pathname + search` as received (TC1's assumption 5).

## Review

### 27-11-2026, review (seat, worktree `tc1-tally-connector`, of `83589c29`)
Tier A, adversarial; the lead's lane: key handling, read-only requests to Tally, idempotent resend, the outbox across a kill. One high finding blocks the merge.

| # | Severity | Where | What is wrong | Failure scenario | Fix | Status |
|---|---|---|---|---|---|---|
| 1 | High | `apps/tally-connector/src/client.ts:184-189`, with `sync.ts:149` | Every BOS answer is parsed with the contracts' `.strict()` response schemas, and a 2xx whose body does not parse is a `BosUnavailable('bad_answer')` that is never retried in the call but leaves the row pending. `drain()` stops at the first such row. docs/06-api.md line 234 says additive changes (new optional fields) ship without a version bump. | TC2, TC3 or TC4 adds a field to `ConnectorBatchResponse`. The BOS applies every batch, and the connector reads the answer as "BOS unavailable". The row stays pending, and the next cycle's drain replays it and stops there again. Every company on the PC stops syncing for good. The heartbeat (`ConnectorHeartbeatResponse`, also strict) fails the same way, so TC4's `updateAvailable` is never seen and the PC cannot update itself out of it. Reproduced: a stub `fetch` answering a valid batch answer plus one extra field gives `threw BosUnavailable bad_answer` and the log line `bos_unavailable … kind: bad_answer`. | Parse answers on the connector leniently: strip unknown keys, nested `accepted` included, through a non-strict copy of each response schema (the contracts can export them). Treat a 2xx batch or snapshot whose body still does not parse as delivered: mark the row sent and ask the cursor again. Add a test with an answer carrying an extra field. | Confirmed |
| 2 | Medium | `apps/tally-connector/src/sync.ts:128-133`, `146-153`; `outbox.ts:160-165` | A snapshot the BOS refuses (any 4xx other than `cursor_mismatch` on a batch) stays `pending` forever. Every drain sends it again, about every 2 minutes, with no attempt limit. `prune()` never removes a pending row, and a new snapshot is added each day. | A company's GUID list over Vercel's 4.5 MB request-body limit (about 90,000 GUIDs at 48 bytes each) gets a 413 → `BosRefused` → pending. The office line then uploads every queued multi-megabyte snapshot every 2 minutes, one more each day, until someone deletes the outbox. The same happens if TC2 answers `snapshot_would_remove_too_much` with a refusal rather than an accepted "waits for Accounts". | After a refusal, set a snapshot aside like a superseded batch (a newer day's snapshot replaces it anyway), or keep only the newest pending snapshot per company. Log the count. Test a refused snapshot across two cycles and two days. Raise the body-size limit with TC2 (a snapshot split into parts, or gzip). | Confirmed (path); plausible (413 trigger) |
| 3 | Medium | `apps/tally-connector/src/tally/reader.ts:149-153`, `xml.ts:45-50` | When `BOOKSFROM` is missing or not eight digits, `period()` is `undefined` and the voucher export goes out with no `SVFROMDATE`/`SVTODATE`. Tally then uses the company's current period. The page still covers its whole AlterID window, and the BOS moves its cursor past it. The fixture ignores the period (`fixture-tally.ts` filters by AlterID only), so no test can see it. | The discovery visit finds `BOOKSFROM` in another shape, or a company without it. Vouchers dated outside Tally's current period (earlier years) are left out of their pages. The cursor passes them, so they never reach the BOS, and the snapshot reports them only as `missingOnServer`, which the connector cannot resend (assumption 4). Receipts and invoices vanish from reconciliation without a sound. | Refuse to read a company without a usable `BOOKSFROM` (`TallyUnavailable('tally_error')` with a log reason) rather than read without a period. Make the fixture filter vouchers by `SVFROMDATE`/`SVTODATE` and test a voucher dated before the current period. | Plausible |
| 4 | Medium | `apps/tally-connector/src/tally/reader.ts:178-187`; contract `TallyVoucher.ledgerEntries` `.min(1)` | A voucher the contract refuses is left out of its page, the cursor moves past it, and the BOS keeps the voucher's earlier version as live. Nothing tells the BOS: the snapshot still lists the GUID, so it is neither tombstoned nor "missing". | Accounts cancels a sales invoice in Tally. tally.md step 2 leaves open how Tally reports it, and Tally's cancelled vouchers commonly carry no ledger entries. The cancelled version fails `ledgerEntries.min(1)` and is skipped. The BOS keeps the invoice's amount in dealer outstanding, milestones and reconciliation indefinitely. The recorded fixture is synthetic (tally.md: "nothing has read a real Tally company yet"), and its cancelled voucher keeps its entries. | Add a fixture case of a cancelled voucher with no entries, and allow it through the contract (`ledgerEntries` may be empty when `isCancelled`; a TC2 coordination). Make skips visible to the BOS: a count in the heartbeat, or hold the company after a skip of a voucher at its newest AlterID. | Confirmed (path); plausible (Tally's shape) |
| 5 | Medium | `apps/tally-connector/src/sync.ts:92`, `173`, `330-333` | The heartbeat's `companies[].lastAlterId` is the BOS's own cursor (from `cursor` and batch answers), never Tally's last AlterID. The BOS learns nothing it does not already hold. | TC2's Integration health promises "lag" (phase5 §6.3, §9.2). With the cursor echoed back, lag is always zero. A company held by a refusal, or stuck behind finding 1, shows `reachable: true` and a current cursor; only `queueDepth` hints at it. Changing it later needs a release to the office PC. | Send Tally's last AlterID as read in the cycle (`status.lastAlterId`), or add a field for it in the contract with TC2, and test it. | Confirmed (code); plausible (TC2's reading) |
| 6 | Low | `docs/03-roadmap-appendix/phase5.md` §6.2; `docs/09-testing.md` §6; `docs/04-architecture.md:73,95,360`; `AGENTS.md:26`; `packages/contracts/src/api/connector.ts:263`; `apps/web/src/integrations/tally/tally.test.ts:99` | Documents out of step with the code. There is no "Built (TC1)" record in the design ("each slice records what it built here in the same pull request"). TESTING §6 does not name `.github/workflows/tally-connector.yml`. ARCHITECTURE still calls the app planned and lists ADR 0013 as "Proposed". AGENTS §3 also says "planned" and names no connector fence beside the voice agent's. The contract says of `missingOnServer` "the connector re-reads them", which it cannot (assumption 4). The web test names `apps/tally-connector/test/signing.test.ts`, which does not exist (the vectors are in `client.test.ts`). | A reader trusts the documents over the code. | One line each. | Confirmed |
| 7 | Low | `apps/tally-connector/test/sync.test.ts` | Assumption 7 (a refusal holds that company's batches while the other companies go on) has no test, and neither does the `bad_answer` path. | A change to `drain()`'s `held`/`setAside` logic passes the suite. | A test: company A's batch answered 403, company B still read and sent; A's row pending and tried again next cycle. | Confirmed |
| 8 | Low | `apps/tally-connector/test/scheduler.test.ts:37`, `61-67` | Real-time sleeps with tight bounds (exactly 3 cycle starts in 380 ms at a 150 ms interval; a stop under 50 ms). | Timers on a loaded `windows-latest` runner drift by 80 ms or more, and the Windows job fails at random. | Inject a clock and timer into `Scheduler` (it already takes `now`), or widen the bounds. | Plausible |
| 9 | Low | `apps/tally-connector/src/tally/reader.ts:160-172`, `settings.ts:241-243` | Every page is a TDL filter over the company's whole voucher collection for the period, a window of 200 AlterIDs, two requests a page. A first sync costs about (last AlterID ÷ 200) full scans of Tally, with a 1-second pause between them. Sparse windows (masters, non-read types) cost the same. | A company at AlterID 400,000 takes 2,000 pages, 4,000 full scans, with Tally busy most of the time for hours while Accounts works in it. The daily snapshot repeats this at 5,000 a window. | Measure at the visit (tally.md step 3). Then widen the window while pages come back sparse, and make the pause proportional to the last request's time. | Plausible |
| 10 | Low | `apps/web/scripts/spike/tally-read.ts:18-23` | The web's spike script imports `apps/tally-connector/src` by a relative path, an app → app dependency that AGENTS §3 ("apps → packages") does not allow and no fence catches. The builder flagged it (early check). | None at run time (a local script outside `next build`). The fence's silence is the risk. | Accept it and say so in AGENTS §3, or keep a copy in the web as the builder offered. | Confirmed |

**Checked and sound:**
- **Key handling:**
  - The key lives in one private field (`#key`). `toJSON` and `util.inspect` leave it out (tested).
  - The settings file is DPAPI-sealed on Windows, with the secret only on PowerShell's standard input as Base64 and PowerShell started from its full path. A plain file is refused on Windows always, and elsewhere without `TALLY_CONNECTOR_DEV=1`. An http BOS is refused outside development.
  - Setup takes the key at a raw-mode hidden prompt. The temporary `.new` file only ever holds the sealed form.
  - Logs pass strings only through `logId()`, which withholds anything not id-shaped. Errors are logged by class or code, never by message, so a `JSON.parse` error quoting the opened settings stays out. The top-level crash line prints `errorKind` only.
  - No key, party name or amount reaches the outbox log or the console (fence test, sync test).
- **Read-only:**
  - Every request is `TALLYREQUEST` `Export` of a `Collection` with `ISMODIFY="No"`. The company name is XML-escaped and AlterIDs are checked whole numbers.
  - `fences.test.ts` scans the source for `Import` and `ACTION=` alterations, and the fixture refuses anything that is not an export.
- **Idempotent resend:**
  - The body and `Idempotency-Key` are written before the first send and replayed byte for byte. The time is signed again on each attempt.
  - A lost answer (in the call and across cycles) is applied once against a stub that replays by key and refuses another body. `cursor_mismatch` sets the company's batches aside and reads again from the BOS's cursor.
- **The outbox across a kill:**
  - The outbox is `node:sqlite` in WAL with `synchronous = FULL`. A row is enqueued before the send and marked sent only on a parsed answer.
  - Pending rows are never pruned.
  - The child-process `SIGKILL` test covers both the "before applied" and the "after applied" case, and the restart resends the same key once.
- **Throttling:** one request queue per reader with the pause measured from the last answer. The test holds never two requests in flight across two companies and a snapshot. Timeouts and retries use a doubling wait, and a closed company is not retried.
- **Signing:** the vectors match the BOS's `verifyConnectorRequest`. The path and query are signed as sent (`url.pathname + url.search` after `URLSearchParams`), and redirects are refused.
- **Snapshot:** windows are read on until the last AlterID stops moving, `asOf` is the start less the 5-minute skew, and it runs once per India day after 02:00 and later if the PC was off.
- **Fences:** the ESLint fence for `src` and `packaging` holds, with its cases in `lint-fences.test.ts`. The connector imports only `@shakti/contracts` and `node:`.
- **Packaging:** the Windows job has `contents: read`, actions pinned by the same SHAs as `ci.yml`, and WinSW refused unless its SHA-256 matches the pinned one. The WinSW XML gives a 30 s stop on Ctrl+C and restarts on failure.
- **No database change:** no schema, policy, definer, command, query, screen or `en.json` change, so items 1 to 7 of the checklist do not apply. ADR 0013 is "Accepted", and docs/06-api.md names `ledgerBalances`.
- **Re-run here, all through the lock:** `@shakti/tally-connector` test: 11 files, 50 passed, 1 skipped (the Windows DPAPI case). Its typecheck is clean. `@shakti/contracts` test: 25 files, 340 passed. `web` `src/integrations/tally` and `lint-fences.test.ts`: 2 files, 28 passed.

**Not checked:**
- The first `windows-latest` run (real DPAPI, the SEA build on Windows, WinSW reading its XML) waits for the pull request and the owner's `checks-ok`.
- `build-sea.ts`, the whole-repository `pnpm lint`, `pnpm build` and `js-budget` were not re-run (the builder's done report lists them clean).
- No security suite: the slice changes no schema, policy or command.
- Real Tally shapes (`BOOKSFROM`, cancelled vouchers, the AlterID counter shared by masters and vouchers) wait for the discovery visit.
- **Journeys:** the slice has no screen and no journey, so there was none to run (sign-in is not possible on this seat in any case).

**The lead's triage (27-11-2026): fix all ten in the one fix round.**
- **1:** a 2xx that does not parse is retried in the call, as a 5xx is, and then counted against an attempt limit. The drain never stops behind one row: it moves on to the company's later rows only when they are independent (snapshots, heartbeats). Batches keep their order, and after the limit a batch is held and reported as below.
- **2:** an attempt limit per row (named settings). A row past it is set aside, logged by GUID and code, and counted in the heartbeat as `heldRows`. `prune()` removes set-aside rows after 7 days.
- **3:** a missing or malformed `BOOKSFROM` stops the company with a clear log line and a heartbeat state. It is never read without a period.
- **4:** a voucher the contract refuses goes in a `refused` list on the batch (GUID and field name), so the BOS queues it for Accounts. Add the optional field to the batch contract in `connector.ts`, and tell TC2 through its run file as an addendum (the lead commits it).
- **5:** the heartbeat carries Tally's last AlterID per company, read cheaply (`$$MaxAlterID` or the export's top), so the lag is real.
- **6, 7 and 8:** as the review says. For 8, inject the clock and the timer.
- **9:** adaptive windows. Double the window after a page with fewer than 50 rows, halve it after one over 400, keeping it between 200 and 10,000 AlterIDs. Test it on a sparse fixture.
- **10:** retire `apps/web/scripts/spike/tally-read.ts` and its `spike:tally` script. The connector's reader and tests supersede the Phase 0 spike: say so in `tally.md`, and keep the recorded fixture under the connector.
- **Finding 1 is high, so the reviewer re-checks the fix diff.**

## Integration
