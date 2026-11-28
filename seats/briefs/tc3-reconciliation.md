# TC3 Reconciliation (Phase 5, wave 2)

| | |
|---|---|
| Branch | `feat/tc3-reconciliation` on GitHub, from `main` after TC2 and FN1 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): money: payments from Tally receipts applied to milestones, reversible |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase5 §7.1](../../03-roadmap-appendix/phase5.md#71-tc3-reconciliation) as written, with questions 4 (a), 5 (a) and 11 (a). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Tables** (the money model, phase5 §5): `reconciliation_links` (a voucher to a proforma, order or project; linked by a person or by the matcher; reversible by a new row, never an update) and `payments` (append-only, from a receipt voucher, applied to milestones in order). The review queue `unlinked_vouchers` is a view under the viewer's own permissions.
2. **The matcher:** the platform-only `finance.recon.match` (add it as ADR 0020 says, redefining `app.platform_only_permissions()` with every key of `main`'s latest) runs on each ingested voucher (TC2's outbox event) and links only by question 5's unique-match rule. A receipt also needs an amount at or below the open balance.
   - A receipt creates a `payment` applied to the order's milestones in sequence (FN1's machine: `part_paid`, `paid`).
   - A sales voucher marks the order `invoiced` (the sales-order machine's `invoice`); fully paid and invoiced orders `close`.
   - A credit note reduces the order's balance.
   - A tombstone or an altered voucher reverses its effects (payments by reversal rows, milestones and the order back by the machines' events) and returns the voucher to the queue.
   - Idempotent: a voucher sent twice is applied once (FIN-02).
3. **The review queue:** `/finance/reconciliation`, the unlinked vouchers with their candidates; Link and Unlink through `finance.recon.write`, audited. Purchase vouchers stay behind `procurement.rate.read`.
4. **Dealer outstanding** (question 11): once a company's connector has synced, `tally_ledgers`' balance replaces the manual entry for that company; the manual command is refused there with a reason naming the sync. The credit check reads the synced figure.
5. **Commission accruals:** if `commission_accruals` exists on `main`, release them on full payment; otherwise record this as HR3's hook.
6. **Journeys:** Accounts links an unlinked receipt and sees the milestone paid; unlinks it and sees it back. With axe and snapshots.

**Early check (Tier A):** once the tables, the matcher, its reversal on a tombstone and their tests are committed, write a short report and push `report: tc3-reconciliation early check`, then stop.

Files owned: `reconciliation_links`, `payments` and the view, and their migrations; the matcher; `/finance/reconciliation`; the dealer-outstanding switch.

Do not touch: TC2's ingest (subscribe to its event); FN1's milestones beyond their machine's events; the connector (TC1, TC4).

Review checklist: links only on a unique match; a receipt never over the open balance; a voucher applied once; every effect of a tombstone or alteration reversed; payments append-only; purchase vouchers behind `procurement.rate.read`.
