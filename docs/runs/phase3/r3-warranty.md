# R3 Warranty claims and supplier returns (wave 2)

| | |
|---|---|
| Branch | `feat/r3-warranty` on GitHub, from `main` `5913766` |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): stock out, costs behind `finance.cost.read`, row security |
| Usage | briefed at lead 5h 1 %, 27-11-2026 14:30 UTC |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase3 §7.5](../../03-roadmap-appendix/phase3.md#75-r3-warranty-claims-and-supplier-returns) as written, with question 10 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Table `warranty_claims`** with the columns of §7.5, and a new series kind `warranty_claim` (code `WC`). The cost columns `replacement_cost` and `supplier_credit_amount` are readable only with `finance.cost.read`. Use the house pattern for restricted columns (H1's `stock_movement_costs`, U1's quotes) and name it.
2. **The `warranty-claim` machine** exists (`packages/domain/src/state-machines/machines/warranty-claim.ts`). Bring it into use (`MACHINES_IN_USE`) and add one command per event: `inventory.warranty.raise`, `.identify_serial`, `.replace`, `.rma_raise`, `.settle` and `.reject`.
   - `settle` needs `procurement.grn.write`, and `rma.raise` needs `procurement.po.write` (phase3 §14).
   - Its `cost_entry` writes nothing until Phase 5. Keep the cost on the restricted columns (question 10 (a)) and mark the step in the machine's document.
3. **Stock:**
   - `.replace` issues the replacement serial through `app.stock_move()` with reason `warranty_replacement` at the moving average. Open that reason to `inventory.warranty.write:entity` with one insert into `app.stock_reason_grants` in your own migration (X4's registry), with its grant test. Never redefine `app.stock_move()`. If X4 has not merged when you reach this point, take `main` in once it has.
   - When the failed serial comes back it moves to the hub's quarantine bin as `faulty` through the serial machine. Use the reason the ledger's list already holds for a return into stock (`return_customer`), opened to `inventory.warranty.write:entity` in the same insert, with `ref_type` `warranty_claim`. R2 later uses the same reason for its own returns with its own grant check in its command.
   - `.rma_raise` moves the serial to `with_supplier`.
   - `.settle` records a supplier replacement received into stock, through the `receipt` reason if U2 has merged, otherwise this step waits and you say so, or a credit (restricted).
4. **Warranty dates:** in warranty means `warranty_until` on or after today in India (IST, never the UTC date). A serial out of warranty is refused at identification, naming its date.
5. **Installed base:** an import kind for serials sold before go-live (company, SKU, serial, customer, site, delivery date). It enters them as `with_customer` with their warranty dates and no stock movement, through the import framework, with refusals per row and undo as the other kinds have.
6. **Screens:** `/inventory/warranty` (claims by state), the claim sheet with its steps, and Raise a claim from Account 360 and from a serial's page. Journeys: the Inventory Manager takes a claim through replace, RMA and settle; the General Manager sees no cost. Both with axe and snapshots.

**Early check (Tier A):** once the table, the commands, the reason opening and their security tests are committed (the claim machine end to end, the out-of-warranty refusal at 23:30 and 00:30 IST, the cost columns per role on both pools), write a short report and push `report: r3-warranty early check`, then stop.

Files owned: `warranty_claims` and its migrations; `packages/domain/src/commands/inventory/warranty*.ts` and its queries; `apps/web/src/app/(bos)/inventory/warranty`; the installed-base import kind; Raise a claim on Account 360 and the serial page.

Do not touch: purchase orders and receipts (U2); the serial machine's states and transitions beyond calling them (H1); `app.stock_move()`.

Review checklist: no cost in any DTO, event, audit value or notification without `finance.cost.read`; the serial's state and bin stay in step through every step; warranty dates in IST; the installed base moves no stock.

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
- **Reporting:** write each report into this file's Report section, under a heading with the date and "seat <n>". Commit it with the subject `report: r3-warranty <stage>` and push. The stages are `early check`, `done`, `fixes` and `blocked`. The lead reads only the branch.
- **Questions:** nobody answers in the session. For a minor gap, take the reasonable call, record it under "Assumptions" and continue. When no reasonable call exists (an owner's or client's decision, a missing package, a refused tool), push `report: r3-warranty blocked` with the question and stop.
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
