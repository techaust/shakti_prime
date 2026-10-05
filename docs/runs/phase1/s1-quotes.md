# S1 Quotes (wave 3)

| | |
|---|---|
| Branch | `feat/s1-quotes` on GitHub, from `main` at #103 |
| PC worktree | `s1-quotes`, slot 13: Postgres 54343, app 3043 (`bash tools/integration/setup-worktree.sh s1-quotes feat/s1-quotes 54343 3043`) |
| Runs on | PC for now ([DECISIONS](../../DECISIONS.md) 04-10-2026) |
| State | brief |
| Next step | a builder starts |

## Brief
Read first:
- Design: [`docs/design/phase1.md` §7.3](../../design/phase1.md#73-s1-quotes), §11 (workshop defaults) and §12
- BLUEPRINT §8.3 (quote validations and validity), §3 (prices only from Price Master tiers, no discounts; tax only from the engine; LLMs never do this math)
- PRD SAL-03, SAL-04, RPT-03 (quote numbers in ⌘K)
- ADR 0007 (the tax engine), ADR 0009 (print), ADR 0021 (people record the sizing a quote relies on)
- The quote state machine `packages/domain/src/state-machines/machines/quote.ts` (guards `sizingComplete`, `pumpCurveInBounds`, `dcrRuleMet`)
- C1's catalogue, price lists and tax (`packages/domain/src/tax`, the price list commands and reads)
- C4's `quoteSizingFacts()` and `latestSizing()`
- P4's print module: the quote template and loader data, the document-type registry in `apps/web/src/print/documents.ts`, `files.document.record`, the purpose `quote_pdf`
- The workshop pack (SALE-1, PRICE-1, PRICE-3)
- Skills: `add-command`, `add-table`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `frontend-design:frontend-design`, `web-design-guidelines`.

1. **Workshop defaults**, added to `packages/domain/src/workshop-defaults.ts`, each named under its question, flagged in `docs/phase0/exit-gate-actions.md` and design §11, and never presented as a client fact:
   - the document number format (SALE-1);
   - the customer type to price tier map (PRICE-1);
   - kits priced as a fixed kit price (PRICE-3).
   Where the workshop pack proposes a default, use it; where it does not, stop and report rather than invent one.
2. **Tables**, each with RLS (a child of the lead and the company), fixture rows, matrix rules, `app_reader` and the testing lists (AGENTS §6):
   - `quotes`: `entity_id`, `quote_no` (unique per company), `opportunity_id`, `account_id`, `site_id`, `sizing_id`, `tier_id`, `price_list_id`, `valid_until`, `state`, `round_off`, totals, `pdf_file_id`, `supersedes_id`;
   - `quote_lines`: item or kit, `qty`, `unit_price`, `hsn`, `tax_rate_id`, `composite_rule_id`, taxable, goods and services parts, CGST, SGST, IGST, line total;
   - `quote_versions` (`snapshot_json`);
   - a per-company, per-financial-year number series that takes no gap under concurrency.
   Money is `numeric(14,2)` and integer paise inside the domain.
3. **Commands**, each with denied, wrong-company and happy-path tests and the agent refusal sweep:
   - `sales.quote.create`:
     - the tier comes from the customer type through the default map;
     - prices come only from the live price list for that tier and company, and a price in the input is refused (SAL-03);
     - tax comes from the engine, with each line's rate version and the solar 70:30 composite supply where it applies, and place of supply from the site;
     - validity is the default 15 days;
     - the number comes from the series;
     - it is refused when the sizing is missing or out of bounds, or the pump curve or DCR rule fails (SAL-04, through the machine's guards and C4's facts).
   - `sales.quote.send`: needs the PDF. Rendering goes through P4's worker, with the quote registered as a document type (loader, template, attach command `quotes.pdf_file_id`).
   - `sales.quote.expire`: run by a daily QStash job as `system:workers`, with only the grant it needs (a platform-only permission like `crm.score.refresh`, never a person's `sales.*`). A read shows a lapsed quote as expired.
   - `sales.quote.requote`: supersedes the quote at current prices.
   - `sales.quote.withdraw`.
4. **Screens:**
   - the quote builder from a lead, and `/quotes` (list, keyset, `EXPLAIN` under RLS);
   - the quote page (its PDF, send, re-quote, withdraw);
   - quotes on Account 360;
   - ⌘K finds quote numbers (RPT-03);
   - board cards show kW or HP and time in stage (STATUS follow-up).
   Each with journeys and axe, copy in `en.json`, and the JavaScript budget.
5. **Tests:**
   - property tests on the totals: sum of lines, rupee rounding, intra-state CGST and SGST against inter-state IGST, and composite supply;
   - fixtures for the guards;
   - the print snapshot of a real quote (P4's `print-quote` template with real loader data).
6. **Documents:** DATABASE, SECURITY (the new permissions and the worker's grant), API (the expire job), DEPLOY (its schedule), design §7.3 "Built (S1)", `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch, and a journey takes a sized lead to a sent quote with its PDF locally (the in-process render).

Not in S1: orders, acceptance and credit (S2); stock availability (Phase 3); any tax rate value, price or number the client must give. The tax rates and price lists stay empty until the client gives them; tests and journeys use clearly synthetic fixtures.

## Report
None yet.

## Review
None yet.

## Integration notes
1. Hosted PDFs wait on the owner's AWS files stack, as P4's do.
