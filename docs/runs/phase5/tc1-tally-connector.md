# TC1 The Tally connector (Phase 5, wave 1)

| | |
|---|---|
| Branch | `feat/tc1-tally-connector` on GitHub, from `main` after the approved design (#296) |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): a service on the client's PC holding a signing key, financial data |
| Usage | briefed 27-11-2026 |
| State | briefed |
| Next step | the builder |

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

## Review

## Integration
