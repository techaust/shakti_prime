# X4 The stock ledger's reason registry (wave 2 prerequisite)

| | |
|---|---|
| Branch | `feat/x4-stock-reasons` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the ledger's one write path and its grants |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

## Brief
`app.stock_move()` (H1, migration 0231) maps each movement reason to the permission it needs in a `case` inside a 300-line function. Every reason except H1's own is refused with `stock_reason_not_open`. Wave 2 opens reasons in three slices at once: U2 opens `receipt`, R3 opens `warranty_replacement`, and later D2 and R2 open theirs. If each slice redefined the function, a later migration's full redefinition would silently drop an earlier slice's reason ([slice-integration §10](../../runbooks/slice-integration.md#10-lessons)). This slice moves the mapping into data, so later slices open a reason with one insert and never redefine the function.

1. **Table `app.stock_reason_grants`:** `reason text primary key` (checked against the same list as `stock_movements_reason_check`), `permission text not null` (a permission key with its scope, as the `case` uses, for example `inventory.stock.adjust:entity`), `opened_by text not null` (the slice, for the record). It lives in schema `app`, holds no company and no personal data, and is readable only by the definer: no grant to `app_user`, `app_reader` or `readonly_reporter`.
   - Seed it in the migration with exactly H1's mapping: `opening`, `adjust_gain`, `adjust_loss`, `damage`, `count` and `reversal` to `inventory.stock.adjust:entity`; `transfer` to `inventory.stock.move:entity`.
   - A reason not in the table stays refused with `stock_reason_not_open`, exactly as today.
2. **`app.stock_move()`:** redefine it once, changing only the `case` that sets `v_perm` into a read of `app.stock_reason_grants`. Diff your version against 0231 line by line: nothing else changes, the lock order and every refusal included. Say in the report that the diff is that one change.
3. **For later slices:** a comment block at the top of the migration says how a slice opens a reason. It is one `insert into app.stock_reason_grants … on conflict (reason) do nothing` in that slice's own migration, plus the reason's grant test. Add the same rule as one line in DATABASE §6 beside the ledger's description (`docs/05-database.md`), and in AGENTS §6 if it has a list of shared definers. Then run `pnpm db:docs`.
4. **Tests** (`packages/db/tests/security`, beside H1's ledger tests): every row of the table gives exactly its permission. A reason with no row is refused with `stock_reason_not_open`. No role and no agent principal reads or writes the table on either pool. H1's whole ledger suite passes unchanged: the property test and the concurrency test too.

**Early check:** none. This slice is the schema change itself. Report `done` when it is finished.

Files owned: one generated migration (if Drizzle needs a schema entry for the table, keep it beside `stock.ts`) and one custom migration; the ledger's security tests; the DATABASE §6 line.

Do not touch: anything else under `inventory`, `procurement` or `sales`; the wave 2 slices.

Review checklist: the redefinition differs from 0231 only in the mapping; no grant on the new table; H1's suites green; the comment tells a later slice exactly what to write.

### Brief addendum (the lead, 27-11-2026 14:35 UTC): serial moves as data too
R3's builder found (its report, `feat/r3-warranty`) that `app.stock_move()`'s serial block fixes the states a serial may come from and go to: an inbound line with no source bin accepts only a `scrapped` serial and sets `in_stock`; an outbound line with no target bin sets `scrapped`; only `opening` and `adjust_gain` create a serial (`stock_serial_unknown` otherwise). Warranty replacement, a faulty return, the supplier RMA and U2's receipt of new serials cannot be expressed. So X4 moves the serial rules into data too, beside the grant mapping, and later slices add a row instead of redefining the function.

5. **Table `app.stock_reason_serial_moves`:** `reason`, `direction` (`in`, `out`, `transfer`), `from_states text[]` (empty for a line that creates a serial), `creates boolean`, `to_state` (a `serial` machine state), `opened_by`. Primary key `(reason, direction)`. Same grants as the reason table (none). Seed it with H1's behaviour exactly, read from migration 0231's serial block (each reason and direction H1 allows, the states it accepts and the state it sets); say in the report each seeded row and the 0231 line it reproduces.
6. **The serial block of `app.stock_move()`** reads that table: a line whose reason and direction have no row, or whose serial is in a state outside `from_states`, is refused with the refusals H1 already uses (`stock_serial_unknown`, `stock_serial_exists`, `stock_serial_state`, adding the last if it does not exist, with its catalogue key); a `creates` row creates the serial; the bin follows the state as `serials_bin_check` requires (a bin for `in_stock`, `reserved`, `picked`, `faulty`; none for `with_customer`, `with_supplier`, `in_transit`, `scrapped`, or as the check says).
7. **Customer fields on a line:** optional `account_id`, `site_id`, `delivered_at`, `warranty_until` per movement line, written to the serial only when the line's move row has `to_state` `with_customer`, and refused on any other line. The definer checks the account is readable by the caller's companies.
8. **The diff against 0231** now holds three changes: the grant mapping, the serial block's table read, and the line's customer fields. Nothing else changes (the lock order, every other refusal). H1's whole ledger suite, the property test and the concurrency test pass unchanged; add a test per seeded row and for a missing row.
9. **The comment block for later slices** says how to open a reason: the grant row and, for a serial-tracked movement, its move rows. Named now so the parallel slices can write them: R3 `warranty_replacement` out `in_stock` → `with_customer`, `return_customer` in `with_customer` → `faulty`, `return_supplier` out `faulty` → `with_supplier`; U2 `receipt` in, creates, → `in_stock`. Do not add those rows yourself: each slice adds its own.

Report `done` when this is finished; there is still no early check.

## How this slice runs
- **Your role:** you are this slice's builder (or, in a review lane, its reviewer), not the lead. Read `.claude/agents/slice-builder.md` (or `slice-reviewer.md`) and follow it as your rules, with this file as your brief and [the Phase 3 design](../../03-roadmap-appendix/phase3.md) (§1, §4, §5, §10, §13 and your slice's section) as its source. `CLAUDE.md` calls every session the lead; that does not apply to you. Never run the `start-session` or `end-session` skills, open or merge a pull request, push to `main` or `ops/seats`, touch a hosted service or GitHub workflow, delete a branch, force-push, or install a package.
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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: x4-stock-reasons <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: x4-stock-reasons blocked` with the question and stop.
- **Migrations:** number yours after `main`'s last (0239 on 27-11-2026). The lead renumbers them at the merge. Never cite a migration number in code.
- **Never:** a live vendor or hosted call in a test; a `package.json` script change, a new package or a lockfile edit; an edit to a file another slice owns.
- **Usage line:** record your model and effort at the start and end in the header's Usage line (Opus 5.5 at high, on the seat's own account).

**Built beside you (wave 2, 27-11-2026):**
- `x4-stock-reasons`: the reason registry of `app.stock_move()`;
- `h2-reservations`: reservations and availability, and the only body change to `app.stock_move()`;
- `u2-purchase-orders`: purchase orders, receipts and the scan field;
- `h3-stock-counts`: stock counts;
- `q1-labels`: labels and `parseLabelPayload()`;
- `r3-warranty`: warranty claims and supplier returns;
- `calling-hours-clock`: the calling screen outside calling hours.

Shared registration points take one line or one block each, kept together under a comment naming your slice; the lead merges them. They are `en.json`, `WORKSHOP_DEFAULTS`, the permission catalogue and seed, the event catalogue and worker registry, the state machine registry, the import kinds' registry, the print document registry, the testing lists, `nav.ts`, `turbo.json` and `.env.example`.

## Report

## Review

## Integration
