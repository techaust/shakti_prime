# State-machine specifications

<!-- Generated from packages/domain/src/state-machines by `pnpm --filter @shakti/domain machines:docs`. Do not edit by hand. -->

The state-machine specifications (BLUEPRINT §19 item 2), with the checks of an upload. Each machine is data in `packages/domain/src/state-machines/machines`; `transition()` in `define-machine.ts` checks the permission, runs the guard and returns the target state and effects, and answers `conflict` with `<machine>_transition_not_allowed` for any other move (docs/design/backend-weeks-3-5.md §7.1).

A machine marked **yes** under *Driven by commands* has commands that call `transition()` with it (`MACHINES_IN_USE` in `registry.ts`, checked against the commands by `registry.test.ts`). The others are specifications: the commands of their phase follow them when they are built (ROADMAP §3 onwards).

| Machine | Driven by commands | States | Events | Proposed items | Specification |
|---|---|---|---|---|---|
| Opportunity | **yes** | 4 | 7 | 1 | [opportunity.md](opportunity.md) |
| Task | **yes** | 3 | 4 | 0 | [task.md](task.md) |
| Quote | no | 6 | 6 | 0 | [quote.md](quote.md) |
| Sales order | no | 7 | 8 | 1 | [sales-order.md](sales-order.md) |
| Dispatch | no | 5 | 6 | 4 | [dispatch.md](dispatch.md) |
| Project, standard install flow | no | 4 | 6 | 9 | [project-standard.md](project-standard.md) |
| Project, PM Surya Ghar flow | no | 12 | 13 | 3 | [project-surya-ghar.md](project-surya-ghar.md) |
| Subsidy gate | no | 4 | 5 | 9 | [subsidy-gate.md](subsidy-gate.md) |
| Customer loan | no | 4 | 4 | 1 | [customer-loan.md](customer-loan.md) |
| Warranty claim | no | 6 | 6 | 7 | [warranty-claim.md](warranty-claim.md) |
| WhatsApp document filing | no | 5 | 5 | 1 | [document-filing.md](document-filing.md) |
| File upload | **yes** | 6 | 6 | 0 | [file-upload.md](file-upload.md) |
| Expense claim | no | 6 | 6 | 7 | [expense-claim.md](expense-claim.md) |
| Playbook directive | no | 3 | 4 | 1 | [playbook-directive.md](playbook-directive.md) |
| Tally voucher | no | 5 | 7 | 6 | [tally-voucher.md](tally-voucher.md) |

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
| `crm.dispositions` | key: 1; code: interested; label: Interested; nextAction: callback<br>key: 2; code: call_back_later; label: Call back later; nextAction: callback<br>key: 3; code: not_reachable; label: Not reachable; nextAction: retry<br>key: 4; code: switched_off; label: Switched off; nextAction: retry<br>key: 5; code: wrong_number; label: Wrong number; nextAction: wrong_number<br>key: 6; code: not_interested; label: Not interested; nextAction: not_interested<br>key: 7; code: already_bought; label: Already bought; nextAction: not_interested<br>key: 8; code: qualified; label: Qualified; nextAction: qualified |
| `crm.scoreBase` | 50 |
| `crm.scoreRules` | none |
| `crm.firstContactSlaMinutes` | null |
