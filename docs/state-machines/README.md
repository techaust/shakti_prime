# State-machine specifications

<!-- Generated from packages/domain/src/state-machines by `pnpm --filter @shakti/domain machines:docs`. Do not edit by hand. -->

The Phase 0 state-machine specifications (BLUEPRINT §19 item 2). Each machine is data in `packages/domain/src/state-machines/machines`; `transition()` in `define-machine.ts` checks the permission, runs the guard and returns the target state and effects, and answers `conflict` with `<machine>_transition_not_allowed` for any other move (docs/design/backend-weeks-3-5.md §7.1).

| Machine | States | Events | Proposed items | Specification |
|---|---|---|---|---|
| Opportunity | 4 | 7 | 1 | [opportunity.md](opportunity.md) |
| Quote | 6 | 6 | 0 | [quote.md](quote.md) |
| Sales order | 7 | 8 | 1 | [sales-order.md](sales-order.md) |
| Dispatch | 5 | 6 | 4 | [dispatch.md](dispatch.md) |
| Project, standard install flow | 4 | 6 | 9 | [project-standard.md](project-standard.md) |
| Project, PM Surya Ghar flow | 12 | 13 | 3 | [project-surya-ghar.md](project-surya-ghar.md) |
| Subsidy gate | 4 | 5 | 9 | [subsidy-gate.md](subsidy-gate.md) |
| Customer loan | 4 | 4 | 1 | [customer-loan.md](customer-loan.md) |
| Warranty claim | 6 | 6 | 7 | [warranty-claim.md](warranty-claim.md) |
| WhatsApp document filing | 5 | 5 | 1 | [document-filing.md](document-filing.md) |
| File upload | 6 | 6 | 1 | [file-upload.md](file-upload.md) |
| Expense claim | 6 | 6 | 7 | [expense-claim.md](expense-claim.md) |
| Playbook directive | 3 | 4 | 1 | [playbook-directive.md](playbook-directive.md) |
| Tally voucher | 5 | 7 | 6 | [tally-voucher.md](tally-voucher.md) |

## Workshop defaults

Values used until the discovery workshop answers (docs/design/backend-weeks-3-5.md §11); they live in `packages/domain/src/workshop-defaults.ts` and nowhere else.

| Setting | Default |
|---|---|
| `tax.placeOfSupplyOrder` | site, account_gstin, entity |
| `tax.roundDocumentToRupee` | true |
| `tax.compositeSegments` | residential_rooftop, commercial_epc |
| `opportunity.handoverLockHours` | 48 |
| `opportunity.reopenWindowDays` | 30 |
| `quote.validityDays` | 15 |
| `credit.exposureCountsConfirmedOrders` | true |
| `dispatch.ewayBillThresholdPaise` | 5000000 |
