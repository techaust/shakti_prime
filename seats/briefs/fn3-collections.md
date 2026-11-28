# FN3 Collections (Phase 5, wave 2)

| | |
|---|---|
| Branch | `feat/fn3-collections` on GitHub, from `main` after FN1 merged |
| Runs on | a seat (seats protocol v2); the lead integrates in the cloud (owner, 27-11-2026, the seven-day push) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): payment reminders to customers, ageing and exports |
| Usage | briefed 28-11-2026 |
| State | briefed |
| Next step | the builder |

## Brief
Build [phase5 §7.2](../../03-roadmap-appendix/phase5.md#72-fn3-collections) as written, with question 4 (a) (a payment exists only from a Tally receipt; the UPI link and QR only invite payment). Follow [AGENTS §6](../../../AGENTS.md#6-database-changes) and [AGENTS §5](../../../AGENTS.md#5-domain-commands). Points the design leaves to you, settled here:

1. **Reminders:** the platform-only `finance.reminders.process` (add it to `PLATFORM_ONLY_PERMISSIONS`, `SYSTEM_MATRIX` and SECURITY §3.3; redefine `app.platform_only_permissions()` with every key of `main`'s latest, ADR 0020) runs daily and sends `payment_due` for milestones on their due date, then after 3 and 7 days (named defaults in `WORKSHOP_DEFAULTS.finance`).
   - Through the existing WhatsApp template path and its rules (approved template, opt-out, the window), never twice a day to one customer, each send recorded so a rerun sends nothing twice (a unique key per milestone and day).
   - The message carries the company's UPI intent link (`upi://pay?pa=<entities.upi_id>&pn=<company>&am=<amount>&tn=<proforma no>`) and a QR rendered from it. A company with no `upi_id` sends the reminder without them.
   - A milestone held by a loan gate (`app.order_loan_gate()`) is not reminded.
2. **The ageing view:** `/finance/ageing`, outstanding per company bucketed 0–30, 31–60, 61–90 and 90+ days by due date, per customer and per dealer, read under the viewer's own permissions; the export is a command with `reports.export`, audited with its filters and row count.
3. **Settings:** the company's UPI id in Settings › Companies (`admin.entities.write`), validated as a VPA.
4. **Screens and journeys:** the ageing view with its export; a milestone's reminder history on the order page. Journey: Accounts opens the ageing view and exports it; the reminder job (run by the test's clock) sends one reminder for a due milestone and none on a rerun. With axe and snapshots.

**Early check (Tier A):** once the reminder job, its once-a-day rule and its tests are committed, write a short report and push `report: fn3-collections early check`, then stop.

Files owned: the reminder job and its records; `/finance/ageing`; the UPI id field.

Do not touch: payments and reconciliation (TC3); proformas and milestones (FN1's, beyond reading them).

Review checklist: never two reminders a day or on a rerun; no reminder for a loan-held milestone; opt-out and template rules kept; the export audited; nothing records a payment.
