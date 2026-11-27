# X4 The stock ledger's reason registry (wave 2 prerequisite)

| | |
|---|---|
| Branch | `feat/x4-stock-reasons` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): the ledger's one write path and its grants |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC; built and fixed on Opus 5.5 at high, on the seat's own account (start and end) |
| State | fixed (report: fixes) |
| Next step | the lead reads the fix diff and integrates |

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

### Brief addendum 2 (the lead, 27-11-2026 15:50 UTC): which reasons may be reversed
U2's early check found that `app.stock_move()` reverses only a fixed list of reasons (`opening`, `adjust_gain`, `adjust_loss`, `damage`, `count`, `transfer`), so a receipt's reversal is refused with `stock_reversal_not_allowed`.

10. **`app.stock_reason_grants.reversible boolean not null default false`**, seeded true for exactly H1's six. The reversal path reads it instead of the fixed list. A later slice sets it in its own row: U2's `receipt` is reversible. If this reaches you after your `done` report, it is the first item of your fix round, and the reviewer checks it.

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

### 27-11-2026, seat (cloud VM, worktree `x4-stock-reasons`, Postgres 54331): done
Built by Opus 5.5 at high. Covers the brief, addendum 1 (serial moves as data, points 5 to 9) and addendum 2 (reversible reasons, point 10). The earlier builder's unfinished commit was reviewed. I kept its grant table, its seed, its grant read in `app.stock_move()` and its registry test. I reworked the migration for the two addenda and replaced its comment block.

**Files**
- `packages/db/migrations/0240_x4_stock_reasons.sql` (custom; its journal entry and snapshot `meta/0240_snapshot.json` come from `drizzle-kit generate --custom`). It holds:
  - the comment block for later slices;
  - `app.stock_reason_grants` (`reason`, `permission`, `reversible`, `opened_by`) and `app.stock_reason_serial_moves` (`reason` referencing the grant row, `direction`, `from_states`, `creates`, `to_state`, `opened_by`, primary key `(reason, direction)`), with no grant to any role (`revoke all` from public, `app_user`, `app_reader` and `readonly_reporter`; the backup's default select stays);
  - H1's seed rows;
  - seven new attributes on `app.stock_line`;
  - the one redefinition of `app.stock_move()`.
- No generated migration. Both tables live in schema `app` outside Drizzle, as `app.lead_anonymise_scope` (0142) does, so no Drizzle schema entry is needed.
- `packages/db/tests/security/stock-reasons.test.ts` (reworked) and `packages/db/tests/security/stock-serial-moves.test.ts` (new).
- `packages/contracts/src/inventory/enums.ts`: `stock_serial_state` and `stock_customer_missing` added to `STOCK_REFUSALS`.
- `apps/web/messages/en.json`: the catalogue keys for those two refusals.
- `packages/domain/src/stock/move.ts`: `stock_serial_state` added to `CONFLICTS`, so it maps to a conflict like `stock_serial_not_in_bin`.
- `docs/05-database.md`: one §6.5 row for the two registry tables with the rule for later slices, and the `app.stock_move()` row of §4.1 brought up to date.
- `docs/data/*`: regenerated by `pnpm db:docs`.
- AGENTS §6 has no list of shared definers, so it is unchanged.

**The diff against 0231's `app.stock_move()`** (`diff` of the two function bodies). It holds exactly the four changes the brief and its addenda name. The lock order, the costs, the balances and every other refusal are unchanged.
1. **Grant mapping.** The `case` that set `v_perm` became `select g.permission into v_perm from app.stock_reason_grants g where g.reason = v_reason`. A reason with no row leaves `v_perm` null, which is refused with `stock_reason_not_open` as before.
2. **Reversible reasons (addendum 2).** `v_orig.reason not in ('opening', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'transfer')` became `not exists (… app.stock_reason_grants g where g.reason = v_orig.reason and g.reversible)`, which is still refused with `stock_reversal_not_allowed`.
3. **Serial block reads the move table.**
   - Pass 1 looks up the line's move row by reason and direction. A tracked line with no row is refused with `stock_serial_state`.
   - Both of 0231's `v_reason in ('opening', 'adjust_gain')` tests became `v_line.move_creates`.
   - Pass 2 checks the serial's state against `move_from`:
     - **into a bin:** a reversal is refused with `stock_serial_not_in_bin` as in H1. A row that creates, or a serial sitting in a bin, gets `stock_serial_exists` as in H1. Any other serial gets `stock_serial_state`.
     - **out of a bin:** a serial not in the source bin gets `stock_serial_not_in_bin` as in H1. A serial in that bin but in another state gets `stock_serial_state`.
   - One `update` sets `state = move_to`. The bin is null for `with_customer`, `with_supplier` and `scrapped`, else the target bin. `state_changed_at` moves only when the state changes, so H1's transfer keeps it as 0231 did.
   - A new serial takes `move_to`.
4. **Customer fields.** `account_id`, `site_id`, `delivered_at` and `warranty_until` are read from each line.
   - They are refused with `stock_movement_shape` unless the line's move row goes to `with_customer`; a site without its customer is refused the same way.
   - The customer must be linked (`account_entities`) to a company of the request, and the site must be that customer's; otherwise `stock_customer_missing`.
   - On a `with_customer` move they are written to the serial as given. Other moves leave the serial's customer fields as they are.

**Seeded rows and the 0231 lines they reproduce**
- **Grants:** opening, adjust_gain, adjust_loss, damage, count and reversal → `inventory.stock.adjust:entity`; transfer → `inventory.stock.move:entity` (0231's `v_perm := case …`). `reversible` is true for all of them except reversal (0231's `v_orig.reason not in (…)` list).
- **Serial moves.** Directions come from 0231's shape check: opening and adjust_gain go in, adjust_loss and damage go out, count goes either way, transfer needs both bins, and a reversal mirrors what it reverses.
  - `opening`/`in` and `adjust_gain`/`in`: from `{scrapped}`, creates, to `in_stock`. The creation comes from `v_reason in ('opening', 'adjust_gain')`. The reinstatement comes from `if v_serial.state <> 'scrapped'` refused, then `set state = 'in_stock', bin_id = v_line.to_bin`.
  - `count`/`in` and `reversal`/`in`: from `{scrapped}`, does not create, to `in_stock` (the same inbound branch).
  - `adjust_loss`/`out`, `damage`/`out`, `count`/`out` and `reversal`/`out`: from `{in_stock}` to `scrapped` (`v_serial.state <> 'in_stock'` refused; `set state = 'scrapped', bin_id = null`).
  - `transfer`/`transfer` and `reversal`/`transfer`: from `{in_stock}` to `in_stock` (`set bin_id = v_line.to_bin`).

**Tests added**
- `stock-reasons.test.ts`, 48 tests:
  - H1's grants and reversible reasons exactly;
  - the registry matches `OPEN_STOCK_REASONS` and the catalogue;
  - the reason check equals the ledger's;
  - malformed rows are refused;
  - every row gives exactly its permission to every staff, agent and system role;
  - a reason with no row is refused with `stock_reason_not_open`;
  - one insert opens a reason (inside a transaction that is rolled back);
  - for each of the two tables: no privilege for any role except the backup's read, refused without a request context, and every role refused reads and writes on both pools.
- `stock-serial-moves.test.ts`, 17 tests. Each case runs in a migrator transaction that is rolled back, with the request's settings set as `withRequestContext()` sets them.
  - H1's serial rows exactly, and a row the ledger could never post refused by the checks or the foreign key;
  - one test per seeded row: the state, bin and `state_changed_at` it leaves, and its refusals;
  - a missing row (a reason opened with only its grant, and one of H1's rows removed) refused with `stock_serial_state`, while an untracked line still posts;
  - reversible reasons: a reversible receipt is reversed; a non-reversible reason, a reversal, and an H1 reason marked not reversible are all refused;
  - the rows R3 and U2 will add (inserted in the test transaction only): a delivery with its customer, the faulty return keeping the customer, the supplier return, and a receipt accepting only new serials;
  - customer fields refused on any other line, a site without its customer, and a customer or site outside the request's companies.
- H1's suites are unchanged and pass: `stock-ledger.test.ts` 47, domain `ledger.test.ts` 21, `ledger-concurrency.test.ts` 6, `ledger-property.test.ts` 1.

**Checks** (each through `heavy.sh`)
- `pnpm typecheck`: exit 0.
- `pnpm exec turbo run test --force`: 10 of 10 tasks passed (contracts 340, db 161, domain 2806, web 1241 with 1 skipped, and the rest).
- `pnpm test:security`: 4 of 4 tasks passed (db 64 files with 1850 tests, domain 110 files with 1519, web 39 files with 461).
- `pnpm copy-lint`: catalogues and templates are clean.
- `pnpm db:docs`: rewrote `erd.md` and `data-dictionary.md` (source line only).
- `pnpm build`: 2 of 2 tasks passed.
- `pnpm --filter web js-budget`: "Every page is within its budget (65 pages)".
- `pnpm lint` (whole repository, final): exit 0.
- Folder lint of `packages/db/tests/security` and `@shakti/db` typecheck after the test edits: exit 0.
- `machines:docs`: not run (no machine changed).
- No screen and no journey, so nothing was left unrun at sign-in.

**EXPLAIN (ANALYZE)**: the slice adds no list or search. Its new reads are key lookups, run once per line:
- the grant row and the reversible check: primary key of a 7-row table;
- the move row: `Index Scan using stock_reason_serial_moves_pkey … Execution Time: 0.127 ms`;
- the customer check: `Index Only Scan using account_entities_account_entity_key … Heap Fetches: 0, Execution Time: 0.069 ms`;
- the site check: `customer_sites` primary key.

**Assumptions**
- **H1's opening and adjust_gain rows have `from_states = {scrapped}` and `creates = true`, not empty `from_states`.** H1 both creates a new serial and brings back a scrapped one on those reasons. Point 5's "empty for a line that creates" therefore holds only for a row that creates *only* (U2's receipt). The table's check requires `from_states` for a row that does not create.
- **The serial moves table carries checks so a slice cannot write a row the ledger could never post:**
  - the direction is checked against the states;
  - creating is allowed only on `in`;
  - a row's reason needs its grant row (foreign key), so a slice inserts the grant row first.
- **Refusals for states H1 never reached** (H1 only ever had `in_stock` and `scrapped`, so the H1 suite is unaffected):
  - Out of a bin, the bin check now comes before the state check, so a serial in the right bin but in another state gets `stock_serial_state` instead of `stock_serial_not_in_bin`. The two orders agree for every state H1 reaches.
  - Into a bin, a serial in another state gets `stock_serial_exists` when it sits in a bin or the row creates, and `stock_serial_state` otherwise.
- **The customer refusal.** The brief named no refusal for a customer the request's companies do not know. I added `stock_customer_missing` (with its catalogue key) next to `stock_serial_state`. Customer fields on the wrong line, and a site without its customer, use H1's `stock_movement_shape`.
- **Customer fields on a `with_customer` move are written as given, nulls included.** This stops an earlier customer from staying on a serial delivered again. Other moves keep them; for example the faulty return keeps the customer, as the test shows.
- **"Readable by the caller's companies" is read as linked in `account_entities` to a company of the request.** The caller needs no `crm.account.read`, so a store person can post a delivery.
- **`stock_serial_state` maps to a conflict in `move.ts`.**
- **The domain helper's line type (`StockMovementLine` and `lineJson` in `move.ts`) does not carry the four customer fields yet.** R3 adds them when it posts a delivery; I left them out to avoid a clash with R3.
- **The DATABASE row says "Built (X4)" and the §4.1 row still cites 0231.** The lead renumbers at the merge.

**Slot database:** 0240 had been applied by the earlier builder, and I changed it twice. Each time I rolled back my own migration in this slot by hand, then ran `pnpm db:migrate` again: I dropped its two tables and the `app.stock_line` attributes it adds, and deleted its `drizzle.__drizzle_migrations` row. I did not use docker or `fresh-db.sh`. The integration's fresh database applies 0240 as written.

**Skills loaded:** `add-table`.

**For the lead at the merge:** H2 also redefines `app.stock_move()`. Its body must keep all four X4 changes and the seven `app.stock_line` attributes.

### 27-11-2026, seat (cloud VM, worktree `x4-stock-reasons`, Postgres 54334): fixes
Built by Opus 5.5 at high. This is the one fix round: findings 1, 2 and 3, as the lead's triage under the Review says. Findings 4, 5 and 6 are left as triaged (U2's, and the lead's at the merge), apart from the semicolon of finding 5, which the rewritten clause now has. The slot's database was new and empty; `pnpm db:migrate` and `pnpm db:seed` applied 0240 as it now stands.

**Files**
- `packages/db/migrations/0240_x4_stock_reasons.sql`: the opening comment block for later slices, the moves table and its seed comment, and `app.stock_move()`.
- `packages/db/tests/security/stock-reason-moves.test.ts`, renamed from `stock-serial-moves.test.ts` to follow the table.
- `packages/db/tests/security/stock-reasons.test.ts`: the table's new name, and the reversal row moved out of the role walk.
- `docs/05-database.md`: the §4.1 `app.stock_move()` row and the §6.5 registry row. `pnpm db:docs` changed nothing further, since the tables live in schema `app`.

**Finding 1: the customer is checked against the line's company.** The account must be linked by `account_entities` to `v_line.entity_id` (`ae.entity_id = v_line.entity_id`). The old test at 802 is reversed: in a request on companies 1 and 2, a company 1 serial delivered to a customer only company 2 knows is now refused with `stock_customer_missing`. The positive case is now the line's company's own customer, given without a site, in that same request. DATABASE now says "for a customer linked to the line's company".

**Finding 2: every line's direction comes from data.**
- **Renamed:** `app.stock_reason_serial_moves` is now `app.stock_reason_moves`. The table now governs every line, tracked or not, so the old name misled.
  - Its constraints are renamed to match.
  - No sibling branch named the table yet: `git grep` on `origin/feat/u2-purchase-orders`, `origin/feat/r3-warranty` and `origin/feat/h2-reservations` found no match.
  - Its key changes anyway for finding 3, so U2's and R3's `on conflict` clauses change whatever the name.
- **The lookup runs for every line in Pass 1.** It finds the row for the line's reason and direction. A line with no row is refused with `stock_movement_shape`.
  - For a non-reversal line, it sits exactly where 0231's direction check stood (after the shape check, before the company check). That check is removed.
  - The serial block reads the row found there. Its own lookup and its `stock_serial_state` refusal for a missing row are gone. `stock_serial_state` is still used for a serial in a state the row does not take.
  - H1's seeded rows already give 0231's directions, so H1's outcomes do not change.
- **Customer fields stay refused on an untracked line.** `move_to` is now set for every line, so the customer check also requires `v_line.tracked`. Customer fields on an untracked line are still refused, as reviewed.

**Finding 3: a reversal is described by the reason it reverses.**
- **The key.** `reverses_reason text not null default ''` joins the moves key: `(reason, direction, reverses_reason)`. `''` means any reason, as on H1's rows.
  - A check, `stock_reason_moves_reverses_check`, allows a non-empty value only on a `reversal` row, naming one of the other fourteen reasons.
  - A foreign key cannot hold `''`, so a check is used.
- **The lookup.** A reversal line looks for (`reversal`, direction, the reversed reason) first, then (`reversal`, direction, `''`), with `reverses_reason in ('', v_reverses) order by reverses_reason desc limit 1`. `v_reverses` is reset to `''` on every line, so an earlier reversal's reason never reaches a later line.
- **The permission:**
  - **With a row keyed by the reversed reason:** the reversal needs that reason's grant row's permission.
  - **When it falls back to H1's rows:** it needs the `reversal` grant row's permission, `inventory.stock.adjust:entity`. H1's reversals are therefore unchanged: reversing a transfer still needs `inventory.stock.adjust`, not `inventory.stock.move`.
  - **Reversibility:** the reversed reason must still be `reversible` (`stock_reversal_not_allowed`).
- **The comment block** now tells a slice that opens a reversible reason to add reversal rows keyed by its own reason when its reversal should need its own grant and move serials its own way. The wave 2 list names U2's optional reversal rows keyed by `receipt`.

**The diff against 0231's `app.stock_move()`** (`diff` of the two function bodies, 417 and 471 lines). It has the four reviewed changes, now in this form:
1. **Grant mapping.** The `case` is a read of the grant row. A reversal's grant check waits for its move row (`if v_reason <> 'reversal' and not app.has_perm(v_perm)` at the top).
2. **Reversal path.**
   - The fixed list of reversible reasons is a read of the reversed reason's grant row (`reversible`).
   - That check, and `stock_already_reversed`, now follow the move-row lookup and the grant check.
   - Four new variables: `v_reverses`, `v_keyed`, `v_rev_perm` and `v_rev_ok`.
3. **Direction and serial move.**
   - 0231's direction check is replaced by one move-row lookup for every line, refused with `stock_movement_shape`.
   - The serial block reads the row that lookup found, as reviewed.
4. **Customer fields.** As reviewed, now linked to the line's company and refused on an untracked line.

The lock order, costs, balances, the opening rule and every other refusal are unchanged.

**Refusal order on a reversal line (a change from 0231):** not open → reference shape → `stock_movement_missing` → no move row (`stock_movement_shape`) → grant (42501) → `stock_reversal_not_allowed` → `stock_already_reversed`.
- 0231 checked the grant first. The grant now depends on the movement reversed, so it can be checked only after that movement is read.
- The effect: a caller without the grant who names a movement that does not exist, or one of another company, is told `stock_movement_missing` instead of 42501.
- No H1 test depends on that order. H1's suites pass unchanged.

**Tests**
- `stock-reason-moves.test.ts`: 27 tests (17 before). Every case runs in a migrator transaction that is rolled back.
  - **New, finding 2:**
    - One test per H1 reason (6). Each posts an untracked line in each of 0231's directions and refuses, with `stock_movement_shape`, an untracked and a tracked line in each other direction.
    - An opened reason (`receipt` with only its `in` row) posts in, and is refused out of a bin and between bins, tracked or not (review probe A). A reason opened with its grant row alone is refused in every direction.
    - A removed row (`count`/`out`, and H1's `reversal`/`out`) closes that direction for both kinds of line and for a reversal.
  - **New, finding 3:**
    - H1's transfer and adjust_gain reversed, role by role over `ROLE_KEYS`: a holder of `inventory.stock.adjust:entity` gets `stock_already_reversed`, every other role 42501. A caller holding only `inventory.stock.move:entity` cannot reverse a transfer.
    - An opened `receipt` (grant `procurement.grn.write:entity`, reversible), with its own reversal row (`out`, keyed by `receipt`, to `with_supplier`):
      - a caller with only the receipt's grant reverses a serial line and an untracked line;
      - a caller with only `inventory.stock.adjust` is refused 42501;
      - the serial ends `with_supplier` with no bin (H1's fallback row would have scrapped it);
      - the cable balance returns to zero;
      - the receipt's grant does not reverse an H1 gain.
  - **Changed:**
    - the H1 rows test now includes `reverses_reason` (`''` on every H1 row);
    - three more malformed rows are refused (a key on a non-reversal row, a reversal keyed by `reversal`, and an unknown reason);
    - the addendum 2 test and the wave 2 helper add the move rows each reason now needs;
    - the customer test is reversed as finding 1 says.
- `stock-reasons.test.ts`: 48 tests, the same count. The role walk covers every grant row except `reversal`, whose grant now depends on the movement reversed; `stock-reason-moves.test.ts` walks that row role by role, as above. The two-table privilege tests now name `app.stock_reason_moves`.
- H1's suites are unchanged and pass: `stock-ledger.test.ts` 47; domain `tests/stock` 28 (`ledger` 21, `ledger-property` 1, `ledger-concurrency` 6).

**Checks** (each through `heavy.sh`)
- `pnpm db:migrate` and `pnpm db:seed` on the new slot database: exit 0.
- `@shakti/db` typecheck, then `eslint --max-warnings 0 packages/db/tests/security`: exit 0.
- db security, `stock-reason-moves` + `stock-reasons` + `stock-ledger`: 3 files, 122 passed. The first two alone: 75 passed (27 + 48).
- domain security, `tests/stock`: 3 files, 28 passed.
- `pnpm db:docs`: wrote the three documents, no change.
- `pnpm test:security`: 4 of 4 tasks passed (db 64 files, 1860 tests; domain 110 files, 1519; web 39 files, 461).
- `pnpm typecheck`: 10 of 10 tasks passed.
- `pnpm lint` (whole repository, final): exit 0.
- Not run: `pnpm build` and `js-budget`. The fix round changes only a SQL migration, two db security tests and DATABASE, none of which `next build` loads; the earlier report ran both on this branch. `copy-lint` and `machines:docs` do not apply: no catalogue or machine changed.

**EXPLAIN (ANALYZE)** of the new move-row lookup: a reversal keyed by `receipt`, in a rolled-back transaction holding H1's rows and one keyed row.
- On a table this small the planner chooses a seq scan: 11 rows, `Execution Time: 0.032 ms`.
- With seq scans off: `Index Scan Backward using stock_reason_moves_pkey … Index Cond: ((reason = 'reversal') AND (direction = 'out') AND (reverses_reason = ANY ('{"",receipt}')))`, `Execution Time: 0.032 ms`.
- The grant reads are primary-key lookups, as before. The slice still adds no list or search.

**Assumptions**
- **Reading of "the `reversal` grant row's permission then applies only where H1's seed keeps it as the fallback":** the reversal row's permission applies when the move row found is a fallback row (`reverses_reason = ''`), and the reversed reason's permission when the row is keyed by it. Taking the reversed reason's permission always would have made a transfer's reversal need `inventory.stock.move`, which changes H1.
- **A keyed reversal row whose reversed reason has no grant row** (possible, since `reverses_reason` can carry no foreign key) falls back to the reversal row's permission and is then refused with `stock_reversal_not_allowed`.
- **The table is renamed** (the lead allowed it if the old name misled), and the test file is renamed with it.
- **The wave 2 list in the comment block names U2's reversal rows as optional.** Whether a receipt's reversal sends the goods back to the supplier or scraps them, and from which states (finding 4), is U2's decision.
- **The `stock_serial_state` catalogue text is unchanged.** It still describes the one case it now covers: a serial in a state the move row does not take.
- **Shared scratchpad.** Another seat's run writes `sec.log` in the same scratchpad, and it overwrote my first whole-suite log. I ran the suite again under `x4-` log names; the result above is from that run.

**Skills loaded:** none new this round (`add-table` was loaded for the build).

## Review
Slice-reviewer, 27-11-2026, cloud session, on f16949ea (`git diff origin/main...feat/x4-stock-reasons`), Tier A. Run in the VM on the slot's Postgres (54332), each through `heavy.sh`:
- db: `stock-ledger`, `stock-reasons` and `stock-serial-moves`: 3 files, 112 passed (47 + 48 + 17); then the whole db security suite: 64 files, 1850 passed.
- domain: `tests/stock` (`ledger`, **`ledger-property`** and **`ledger-concurrency`**): 3 files, 28 passed (21 + 1 + 6). H1's suites are unchanged on the branch.
- Two probes in `psql` as the migrator, each in a transaction rolled back (nothing left behind), cited in findings 2 and 4.

Not run: the domain and web security suites as a whole, typecheck, lint, `pnpm build` and `js-budget` (the builder reports them green; the slice adds no screen, route or command). No journey or screenshot exists for this slice, so none was skipped and no layout was reviewed.

| # | Severity | Finding | State |
|---|---|---|---|
| 1 | Medium | **A delivery's customer is checked against the request's companies, not the line's company (confirmed: the builder's own test asserts it).** `0240_x4_stock_reasons.sql:427` accepts the account when `ae.entity_id = any (v_entities)`. `stock-serial-moves.test.ts:802-809` posts a company 1 serial to a customer linked only to company 2, in a request on companies 1 and 2, and expects it to post. Scenario: an Executive or GM holding both companies posts R3's warranty replacement of a Shakti Supreme serial to a customer only Agro Solar Hub knows. The company 1 serial then names a customer that company 1's staff cannot read (the `accounts` policy goes through `account_entities`), so the serial and its warranty claim show no customer. It also breaks ADR 0008's rule that a transaction's company has a relationship with its account (`app.ensure_account_entity()`). Fix (one line): `ae.entity_id = v_line.entity_id`. Flip the test at 802 to expect `stock_customer_missing`, and say "linked to the line's company" in the DATABASE §4.1 row. | open |
| 2 | Medium | **A later reason's direction is not checked for an untracked item (confirmed: probe A).** Pass 1's direction check (`0240:308-314`) names only H1's reasons. The move row checks direction only for a serial-tracked line. Probe A opened `receipt` exactly as the comment block names U2's rows (grant row, plus the move row `in` only). An untracked cable then posted `receipt` **out** of a bin (4 m) and **between** two bins (1 m), and both posted. H1's `adjust_gain` out of a bin is still refused with `stock_movement_shape`. Scenario: a fault in U2's or R3's command, or a later caller, posts stock out of a bin as a "receipt" or into one as a "warranty replacement". The ledger, which H1 made the last guard on direction, lets it through. A slice cannot add the check without redefining `app.stock_move()`, the thing X4 exists to prevent. Fix (the lead's call: brief addendum 3 before U2 and R3 open their reasons, or a follow-up): read the direction from data for every line. Either refuse `stock_movement_shape` when `app.stock_reason_serial_moves` has no row for the line's reason and direction, or add `directions text[]` to the grant row. H1's seeded rows already give exactly 0231's directions (opening and adjust_gain in; adjust_loss and damage out; count in or out; transfer between bins; reversal all three), so H1's behaviour is unchanged. Then the hard-coded check can go. Add a test per H1 reason and one for an opened reason. | open, for the lead |
| 3 | Medium | **Reversals cannot be described per reason (plausible, design; it bites D2 and later).** A reversal's serial move is the `reversal` row for its direction, whatever reason it reverses. Its permission is the `reversal` grant row's (`inventory.stock.adjust:entity`), and the comment forbids a slice to change another slice's rows. Scenarios:<br>- D2's `pick` (a transfer to `picked`) reversed: the `reversal`/`transfer` row takes only `in_stock`, so it is refused with `stock_serial_state`.<br>- D2's `issue` (out to `in_transit`) reversed: the `reversal`/`in` row takes only `scrapped`, so it is refused with `stock_serial_not_in_bin`.<br>- U2's receipt reversal needs `inventory.stock.adjust`, not `procurement.grn.write` (U2's report raises this too), so a role customised with the one and not the other can receive but cannot reverse.<br>Fix (the lead's call, before D2): key reversal behaviour by the reason reversed. For example, take the permission from the reversed reason's grant row, and add reversal move rows keyed by the reversed reason (a `reverses` column in the key, or a direction `reverse`), falling back to H1's rows. | open, for the lead |
| 4 | Low | **The receipt rows the comment block names make a reversed receipt's serial impossible to receive again (confirmed: probe B).** With `('receipt', 'in', '{}', true, 'in_stock')` (`0240:38`), a receipt of serial PRB-S1 was reversed, which leaves the serial `scrapped` with no bin through `reversal`/`out`. Receiving PRB-S1 again was refused with `stock_serial_exists`. Scenario: a receipt posted against the wrong order is reversed, and the correct receipt of the same pumps is refused for every serial. Fix: U2's call, flagged now because X4's comment prescribes the row. Either `from_states '{scrapped}'` on U2's receipt row (as H1's `adjust_gain` row takes a scrapped serial back), or a dedicated reversal move per finding 3. | open, for U2 |
| 5 | Low | **DATABASE wording (confirmed by reading).** In `docs/05-database.md` §4.1, the `app.stock_move()` row now reads "for a customer linked to a company of the request (`stock_customer_missing`) and every line's company in `app.entity_ids()`, else 42501". That reads as if a missing customer were a 42501. Its migration column still says only 0231, while other redefined definers list each migration (for example `0142, 0173, 0188`). The §6.5 row says "Built (X4)" where its neighbours give the migration number. Fix at the merge, after renumbering: end the customer clause with a semicolon, put "0231, 0240" (the final number) in the migration column, and write "Built (0240)". | open, for the lead |
| 6 | Low, for the lead | **Merge points (from the builder's report and the sibling branches).** `feat/h2-reservations` redefines `app.stock_move()` from 0231: its migration still has the `case` (line 253 of its diff) and the fixed reversal list. Whichever merges second must carry X4's four changes and the seven `app.stock_line` attributes; diff the live function against both after the merge. `docs/03-roadmap-appendix/phase3.md` has no Built record for X4, which the brief did not give it; add one line under §6.2's Built (H1) at the merge. | open, for the lead |

**Found sound:**
- **The redefinition against 0231** (`diff` of the two function bodies, 417 and 457 lines). It differs only in the brief's points:
  - the `case` replaced by the grant-row read;
  - the four customer fields read per line, and their check after the serial block;
  - addendum 2, the fixed reversal list replaced by `reversible` on the grant row, **present**;
  - the serial block: a move-row lookup by reason and direction, the two `v_reason in ('opening', 'adjust_gain')` tests replaced by `move_creates`, the state checks reading `move_from`, and one `update` to `move_to` with the bin as `serials_bin_check` has it and the customer only on `with_customer`;
  - two comments.

  The lock order, the opening rule, costs, balances, every other refusal, `search_path = ''`, the owner and the ACL (`app_user` execute only) are unchanged; `create or replace` kept them, confirmed in `pg_proc`. Out of a bin, the bin is now checked before the state. For every state H1 reaches the outcome is the same, and H1's suites pass unchanged.
- **The seeds** equal 0231 exactly: seven grant rows; `reversible` on the six reasons of 0231's list and not on `reversal`; ten move rows matching 0231's directions and states. The tests hold both.
- **Grants:** both tables show `{postgres=arwdDxtm, app_backup=r}` only. The test walks every role key (staff, agent, system) on both pools for read, insert, update and delete, plus `anon`, `authenticated`, `service_role` and `public`. No policy is needed, since no request role holds a privilege.
- **A reason with no row** is refused with `stock_reason_not_open`: `select … into` sets `v_perm` to null when it finds no row, and `v_line` is reset per line, so nothing leaks from an earlier line.
- **The table checks refuse rows the ledger could never post**, the foreign key ties a move row to its grant row, and `stock_serial_state` and `stock_customer_missing` have their catalogue keys, `STOCK_REFUSALS` entries and domain mapping.
- **The comment block** tells a later slice exactly what to write: the grant row, the move rows per direction, `OPEN_STOCK_REASONS`, the domain test list and the grant test.
- **Migration:** 0240 follows `main`'s last (0239, still the last on `main`); its journal time is later; its snapshot is 0239's with a new id chained to it. The generated documents are regenerated.
- **Tests:** they assert exact codes and refusals, and run in rolled-back transactions; there are no sleeps, and nothing is skipped or weakened.

**The lead's triage (27-11-2026):**
- **To fix in the one fix round: 1, 2 and 3.**
  - **1:** the customer is linked to the line's company (`ae.entity_id = v_line.entity_id`). The test at 802 is flipped, and DATABASE says so.
  - **2:** direction comes from data for every line. `app.stock_reason_serial_moves` becomes the registry of allowed (reason, direction) pairs for every line, tracked or not. A line whose reason and direction have no row is refused with `stock_movement_shape`. The states and `creates` apply only to serial-tracked lines. Remove Pass 1's hard-coded direction check; H1's seeded rows already give 0231's directions. Add a test per H1 reason and direction, and one for an opened reason posted in a direction it has no row for. Rename the table only if the name now misleads (`app.stock_reason_moves`), and say so.
  - **3:** a reversal is described by the reason it reverses.
    - Add `reverses_reason text not null default ''` to the move rows' key (`''` = any reason, H1's rows). A reversal line looks up its row by (`reversal`, direction, the reversed movement's reason) first, then (`reversal`, direction, `''`).
    - A reversal's permission is the reversed reason's grant row's permission, and that reason must be `reversible`. The `reversal` grant row's permission then applies only where H1's seed keeps it as the fallback.
    - Update the comment block: a slice that opens a reversible reason adds its reversal move rows keyed by its own reason.
    - Tests: H1's reversals unchanged; an opened reason's reversal taking that reason's permission and its own move row.
- **4:** goes to U2, as an addendum on its run file.
- **5 and 6:** the lead's, at the merge.
- **No re-review:** no finding is high or critical. The lead reads the fix diff.

## Integration

### The lead, 27-11-2026, cloud session (slot 9: Postgres 54339)
- **Main taken in** by a merge commit (the push's documents and the Phase 4 to 7 designs). The migration stays `0240`: `main`'s last is still `0239`, so nothing was renumbered. Review findings 5 and 6 are done: DATABASE §4.1 gives `0231, 0240`, §6.5 says Built (0240), phase3 §6.2 has X4's Built line, and `pnpm db:docs` was rerun.
- **The fix diff** (`e5ca90b9`, `9a2fcb3d`), read by the lead:
  - Finding 1: the customer is linked to the line's company.
  - Finding 2: `app.stock_reason_moves` gives every line's (reason, direction), tracked or not, and the hard-coded shape check is gone.
  - Finding 3: reversal rows are keyed by the reversed reason, falling back to H1's rows. A keyed reversal takes the reversed reason's permission.
  - H1's behaviour is unchanged (its suites pass).
- **`integrate.sh`** ran in four parts on a fresh Postgres on 54340:
  - install, lint, format, copy lint, generated and typecheck: pass;
  - unit: pass (domain 2,806; web 1,241, 1 skipped; contracts 340; db 161; tokens 146; ui 107; voice 49; voice-agent 23; copy-lint 17);
  - security: pass (db 1,860; domain 1,519; web 461), and `db:verify` passed;
  - audit, build with `.env` aside, js-budget and gitleaks: pass.
  - The e2e part (`inventory.spec.ts`) ran on the VM's host. Its functional steps passed. Six screenshot comparisons differed there (`stock-valuation` and `stock-list` in each project), which is host font rendering, which slice-integration §10 says does not count.
- **Linux image:** `e2e:snap -- e2e/inventory.spec.ts` on a fresh database (`fresh-db.sh`, migrate, seed, build): 30 passed, every screenshot matching. No baseline changes, since the slice has no screen.
- **No checks files are changed,** so no `checks-ok` is needed.
