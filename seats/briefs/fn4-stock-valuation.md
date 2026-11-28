# FN4 Stock valuation reconciliation (Phase 5, wave 2)

| | |
|---|---|
| Branch | `feat/fn4-stock-valuation` on GitHub, from `main` after TC2 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): cost figures behind finance.cost.read |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase5 §7.3](../../03-roadmap-appendix/phase5.md#73-fn4-stock-valuation-reconciliation) as written. Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Table `stock_valuation_checks`:** company, the month end, the BOS value (from `readStockValuation` at the month end, stored when the check is recorded), Tally's closing stock value (entered by Accounts, or from the connector's stock summary when TC2 or TC4 sends it; record which), the difference, a note, who recorded it and when. One per company and month (unique), corrected only by a new version that keeps the old.
2. **Access:** `finance.cost.read` only, by RLS and a whitelisted DTO; values never in events, audit values (ids and the month only), notifications or agent inputs.
3. **Commands:** `finance.stock_valuation.record` (and `.revise` with a reason).
4. **Screen:** `/finance/stock-valuation`, per company and month: the two values, the difference and the note, with the history of revisions. Journey: Accounts records a month's check and revises it; a GM without `finance.cost.read` gets not-found. With axe and snapshots.
5. **Adjustments** stay in Tally (BLUEPRINT §8.8): the BOS keeps the record only.

**Early check (Tier A):** once the table, the policies, the commands and the isolation tests are committed, write a short report and push `report: fn4-stock-valuation early check`, then stop.

Files owned: `stock_valuation_checks` and its migration; its commands and query; `/finance/stock-valuation`.

Do not touch: H1's valuation query (read it); TC2's tables (read them).

Review checklist: no value on any path without `finance.cost.read`; one check per company and month, revised by version; the BOS value fixed when recorded.
