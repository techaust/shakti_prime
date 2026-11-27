-- U2 opens the ledger's `receipt` reason (docs/runs/phase3/u2-purchase-orders.md, brief addendum 2),
-- with the inserts X4's comment block names and nothing else about app.stock_move():
-- 1. the grant: a receipt needs procurement.grn.write in the company, and is reversible, so
--    procurement.grn.reverse takes a whole receipt back through the ledger's own reversal, which
--    takes the receipt's cost back out of the moving average;
-- 2. the move: into a bin only. A serial number the item has not got makes a new serial in stock;
--    a serial whose receipt was reversed (scrapped, no bin) comes back in stock, so the right
--    receipt of the same goods can follow a wrong one. app.goods_receipt_post() lets a scrapped
--    serial in only when it is the company's own from a reversed receipt;
-- 3. the reversal of a receipt, keyed by the reason it reverses: out of its bin, from in stock to
--    scrapped, under the receipt's own grant (procurement.grn.write), not H1's reversal grant.
insert into app.stock_reason_grants (reason, permission, reversible, opened_by)
  values ('receipt', 'procurement.grn.write:entity', true, 'u2-purchase-orders')
  on conflict (reason) do nothing;
--> statement-breakpoint
insert into app.stock_reason_moves (reason, direction, from_states, creates, to_state, opened_by)
  values ('receipt', 'in', '{scrapped}', true, 'in_stock', 'u2-purchase-orders')
  on conflict (reason, direction, reverses_reason) do nothing;
--> statement-breakpoint
insert into app.stock_reason_moves
    (reason, reverses_reason, direction, from_states, creates, to_state, opened_by)
  values ('reversal', 'receipt', 'out', '{in_stock}', false, 'scrapped', 'u2-purchase-orders')
  on conflict (reason, direction, reverses_reason) do nothing;
