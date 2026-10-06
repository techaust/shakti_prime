# ADR 0007 — Deterministic tax engine with effective-dated rates and composite-supply valuation

**Status:** Accepted (27-09-2026); built in #36. Still open: the CA confirms the golden set (`packages/domain/src/tax/golden.test.ts`), place of supply and rounding at the discovery workshop · **Date:** 27-09-2026 · **Deciders:** Lead developer; the CA confirms · **Blueprint:** §1, §5, §6.3, §8.3 · **Architecture:** §5 · **Design:** docs/03-roadmap-appendix/backend-weeks-3-5.md §6

## Context
Every quote, sales order and proforma line carries GST. Rates change on notification dates, solar EPC and rooftop contracts are valued as a 70:30 goods/services composite supply, and the split between CGST+SGST and IGST depends on the entity's state against the place of supply. The blueprint requires a deterministic engine whose result is snapshotted per line with the rate version used, so a later rate change never alters an issued document.

## Decision
- The engine is a set of pure functions in `packages/domain/src/tax` with no database access: `resolveRate`, `placeOfSupply`, `compositeSplit`, `computeLine`, `computeDocument`. Commands load the effective rows and pass them in; the functions never read tables.
- Money is integer paise inside the engine and two-decimal strings at its boundary (API §1). No floating point.
- Rates resolve on the document date in IST: an item-specific `tax_rates` row wins over the HSN row; both are effective-dated and non-overlapping (exclusion constraints, migration 0008).
- Place of supply is the state of the customer site when the document has one, else the state in the account's GSTIN, else the entity's own state. Intra-state when it equals the entity's `state_code`: CGST and SGST at half the rate each; otherwise IGST at the full rate.
- Composite supply applies when a line is flagged as a works contract in a segment with an effective `composite_supply_rules` row. The line's taxable value is split by the rule's shares, each part taxed at its own rate, and the line keeps both parts (`goods_taxable`, `services_taxable`) plus `composite_rule_id`.
- Rounding: taxable value and each tax amount round half-up to the paisa per line; CGST and SGST round independently from the half rate; the document total rounds to the rupee with the difference stored in `round_off`.
- Every line stores `tax_rate_id` and, where used, `composite_rule_id`; a re-quote recomputes with the rates effective on its own date.
- Tests are fixture tables: rate boundaries at midnight IST, intra and inter state, composite split, paisa and rupee rounding, and a golden set of worked examples the CA signs off.

## Consequences
- Tax logic is testable without Postgres and identical on web, API, imports and agents.
- Sites and accounts carry a state code (`customer_sites.state_code`, `accounts.billing_state_code`), entered on the site form or derived from the GSTIN.
- A change in rates or shares is a new effective-dated row, not a code change; a change in method (for example a new cess) is a new ADR.
