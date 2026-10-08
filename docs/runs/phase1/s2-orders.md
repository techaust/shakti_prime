# S2 Orders, acceptance and credit (wave 4)

| | |
|---|---|
| Branch | `feat/s2-orders` on GitHub, from `main` at f74caff0 (#121) |
| PC worktree | `s2-orders`, slot 17: Postgres 54347, app 3047 (`bash tools/integration/setup-worktree.sh s2-orders feat/s2-orders 54347 3047`) |
| Runs on | PC only (owner, 06-10-2026), beside N1 and the other wave 4 builder; heavy commands one at a time through the PC's lock: build, review, fixes, the merge with `main`, integration, baselines, the pull request and the hosted steps |
| State | building |
| Next step | the builder agent on the PC builds the slice from this brief |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase1.md` §8.3](../../03-roadmap-appendix/phase1.md#83-s2-orders-acceptance-and-credit), §3 (S2 needs S1 and C3), §4 (`sales.credit.write`), §11 (workshop defaults) and §12; §7.2 "Built (T1)" and §7.3 "Built (S1)" for the commands this slice extends
- PRD SAL-05 (the signed copy, and acceptance after expiry), SAL-06, SAL-07, CRM-09 (the accrual); the trace rows for SAL-06 and SAL-07 name the tests this slice writes
- BLUEPRINT §8.3 (orders, dealer credit), §3 (prices only from Price Master tiers; tax only from the engine); SECURITY §3.2 (`sales.order.*`, `sales.credit.release`), §3.3
- Workshop pack CRM-5, SALE-4, SALE-5, SALE-6 (dealer limits and days are per company and come from the client; confirmed orders count against the limit is today's default)
- What exists: `creditCheck()` (`packages/domain/src/sales/credit-check.ts`, with its test); the machines `sales-order.ts` and `quote.ts` (its `accept` move, guards `notExpired` and `acceptedViaRecorded`); `nextDocumentNo(..., 'sales_order')` and `WORKSHOP_DEFAULTS.numbering.docCodes.sales_order`; `WORKSHOP_DEFAULTS.credit`; the file purpose `signed_quote`; C3's `referral_partners`, `commission_rules` and `opportunities.referral_partner_id`; `crm.opportunity.win` and `hasAcceptedQuoteOrConfirmedOrder` in `opportunity-shared.ts` (still `false`); T1's `cancelCallTasks()`; S1's `priceQuote()` and `buildQuote()`
- Skills: `add-command`, `add-table`, `vercel-react-best-practices`, `web-design-guidelines`, `writing-guidelines`.

1. **Tables**, each with RLS, fixture rows, matrix rules, `app_reader`, the testing lists, `NARROWER` and `enum-sync` where they apply (AGENTS §6). Money is `numeric(14,2)` and integer paise inside the domain.
   - `sales_orders`: `entity_id`, `so_no` (unique per company, from the document series), `quote_id` null, `opportunity_id` null, `account_id`, `site_id` null, `tier_id`, `price_list_id` null, `state` (the machine's), totals as `quotes`, `credit_release_by`, `credit_release_reason`, `cancel_reason`. An order from a quote is a child of its lead and read with it, as `quotes` are; a dealer order without a lead is read by whoever reads the dealer in that company.
   - `sales_order_lines`: as `quote_lines` (item or kit, `qty`, `unit_price`, `hsn`, `tax_rate_id`, `composite_rule_id`, taxable, goods and services parts, CGST, SGST, IGST, line total), written only in the transaction that made the order and never changed. The reservation and dispatch quantities come with Phase 3, not now.
   - `dealer_terms`: `account_id`, `entity_id` (limits and days are per company, SALE-4; DATABASE's planned row gains the column), `credit_limit` (null means no limit, so the dealer is held, SAL-07), `credit_days`; one row per dealer and company, with its history kept (audited updates or append-only rows, your choice, stated in the report).
   - `dealer_outstanding`: `account_id`, `entity_id`, `outstanding`, `oldest_overdue_days`, `oldest_overdue_invoice_no` (the block names it, SAL-07), `as_of`, `entered_by`; append-only, the newest `as_of` counts.
   - `commission_accruals`: `entity_id`, `partner_id` (the referral partner), `opportunity_id`, `sales_order_id`, `commission_rule_id`, `amount`, `state` (accrued or cancelled), `released_at` null (release is Phase 5); append-only apart from the cancel.
   - `quotes` gains `accepted_via` and `signed_file_id`.
2. **Permissions:** `sales.credit.write` (Executive all, Accounts entity; no agent) with its SECURITY §3.2 row, seed and oracle case. Acceptance keeps the quote machine's own permission, `sales.quote.send`, so no new key. `sales.order.create`, `.confirm`, `.cancel` and `sales.credit.release` exist: check their seeds against SECURITY §3.2 (cancel GM and Executive only; release the Executive only, refused to every agent).
3. **The sales order machine** becomes stored like the quote's (`stored`, each move's event in the catalogue); `machines:docs` regenerated. Dispatch, invoice and close stay unreachable in Phase 1.
4. **Commands**, each with denied, wrong-company and happy-path tests and the agent refusal sweep:
   - `sales.quote.accept` (people only): a sent quote that has not expired, with the signed copy uploaded as a `signed_quote` file of that quote's company; records `accepted_via` `signed_upload` and the file, moves the quote to accepted and creates the order draft with the quote's lines, prices and tax copied, in one transaction. A quote past its validity is refused with the plain sentence that it needs a re-quote (SAL-05).
   - `sales.order.create` (people only): a dealer order without a quote, priced from the live list of the dealer's tier and company and taxed by the engine through S1's pricing (no price in the input, SAL-03); refused for a customer who is not a dealer.
   - `sales.order.confirm`: runs `creditCheck()` with the dealer's terms in the order's company, the newest outstanding entry, and the confirmed orders not cancelled whose confirmation is later than that entry's `as_of` (SALE-5 today: confirmed orders count; the cut-off at the entry's date is the lead's decision, so an order is not counted twice once Accounts' figure includes it). A block is not a refusal: the order stays a draft, held for credit (`credit_held_at` and the reason's facts on the order, committed), the command answers `held` with the limit and the exposure, or the overdue invoice, for a plain sentence, and it sends `sales.order.credit_held` (catalogue entry, unsubscribed) so N1 can tell the Executive and the person who made the order. A non-dealer passes. Confirming an order of a lead wins the lead (`crm.opportunity.win`, with `hasAcceptedQuoteOrConfirmedOrder` now computed from the lead's quotes and orders) and accrues the commission.
   - `sales.credit.release` (the Executive only, a reason, audited): on a held order, clears the hold and lets the next confirm pass that order's block once.
   - `sales.order.cancel` (GM and Executive, a reason): from draft or confirmed; a confirmed order's accrual is cancelled. The lead stays won (the opportunity machine has no move out of won); say so in the report.
   - `sales.dealer_terms.set` and `sales.dealer_outstanding.record` (`sales.credit.write`): Accounts enter limits, days and outstanding with an as-of date (SALE-6).
   - The accrual: by the partner's rule in force on the confirmation date (`commission_rules`, `order_confirmed` trigger; fixed, percent of the order's taxable value, per kW or per HP from the lead's sizing). A salesperson who confirms cannot read `commission_rules` under its policy, so the accrual goes through a narrow definer that checks `sales.order.confirm` over the order; fix the comment in `packages/db/src/testing/index.ts` that says otherwise. No rule, no accrual, and nothing is invented: there are no commission rules until the owner gives them (CRM-5).
   - `crm.opportunity.win` ends the lead's open callbacks and nurture calls (`cancelCallTasks()`), as losing does (the STATUS follow-up "Winning a lead ends its open callbacks").
5. **Screens**, each with journeys, axe, copy in `en.json` and the JavaScript budget:
   - on the quote page: Record acceptance (upload the signed copy) for a sent quote, then a link to its order;
   - `/orders` (menu item Orders; keyset, a choice of status, `EXPLAIN (ANALYZE)` under RLS) and the order page (lines, totals, Confirm with the block's sentence when credit holds it, Release for the Executive, Cancel for GM and Executive);
   - a new dealer order from the dealer's Account 360 (`sales.order.create`);
   - orders on Account 360, after Quotes;
   - `/dealer-credit` (menu item Dealer credit, `sales.credit.write`): each dealer's limit, days, newest outstanding and its date, the exposure, entry forms for terms and outstanding, and each entry's history.
6. **Tests:** the SAL-06 transitions in `machines.test.ts`; `credit-check.test.ts` extended for the exposure with confirmed orders and the release; the accrual's rule bases and its cancel; an order's lines equal the quote's; the journeys of item 7.
7. **Documents:** DATABASE (the five tables, the two quote columns, `dealer_terms.entity_id`), SECURITY (§3.2 `sales.credit.write`, §3.3 if a definer is added), design §8.3 "Built (S2)", the workshop pack's SALE-4 to SALE-6 and CRM-5 "Today" lines where the slice changes them, `pnpm db:docs`, `machines:docs`.

Done when: the checks of AGENTS §10 pass on the branch; a journey records a signed acceptance of a sent quote, confirms the order and sees the lead won; a dealer order over its limit is blocked with the limit named, released by the Executive and then confirmed; Accounts enter terms and an outstanding figure on `/dealer-credit`.

Not in S2: dispatch, reservations, invoices and payments (Phases 3 and 5); commission release (Phase 5); WhatsApp acceptance (Phase 2); any credit limit, credit days, outstanding figure or commission rule (the client's; the journeys use clearly synthetic fixtures). Files another slice owns: N1 owns notifications (S2 sends `sales.order.credit_held` and builds no notification; whichever of N1 and S2 merges second wires N1's notice to it), K1 the vault.

## Report

## Review
| # | Severity | Finding | State |
|---|---|---|---|

## Integration notes
1. If N1 merged first: subscribe N1's notify worker to `sales.order.credit_held` (the Executive of the order's company and the order's maker), with its notice type, preference and journey line.
