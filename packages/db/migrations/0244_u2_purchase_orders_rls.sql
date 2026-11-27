-- U2 purchase orders and goods receipt (docs/03-roadmap-appendix/phase3.md §7.2, questions 2 (a),
-- 5 (a) and 8 (a)): row security, grants, guards and definers for reorder rules, purchase orders and
-- goods receipts.
-- Orders and receipts belong to one company. They are read in that company by a holder of
-- inventory.stock.read (the General Manager, the Store Manager, the Inventory Manager and others)
-- or procurement.po.write, and written by the procurement commands: orders with
-- procurement.po.write (approval with procurement.po.approve), receipts with procurement.grn.write.
-- No rate or amount lives on those rows. A purchase order line's rate and amount are in
-- po_line_rates and a receipt line's rate in goods_receipt_line_rates, both read only with
-- procurement.rate.read in the row's company, as vendor_quotes are (docs/05-database.md §4.3);
-- readonly_reporter holds nothing on any of the seven tables.
-- Stock comes in and goes back out only through app.stock_move(): the receipt definers below
-- build its batch, so the receipt's rate reaches the ledger without the person posting it ever
-- reading it. The reorder job (system:workers, the platform-only procurement.reorder.draft) reads
-- and drafts through two definers of its own, never with a person's grant.

-- 1. procurement.reorder.draft and procurement.po.mail (the purchase order mailer) are
--    platform-only, like the other workers' grants: the nineteen keys of 0222 (with W2's
--    messaging.media.expire), kept, and these two.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire',
               -- U2 reorder drafts and the purchase order mailer
               'procurement.reorder.draft', 'procurement.po.mail']::text[]
$$;
--> statement-breakpoint

-- 2. The next number of a series, as 0201 drew it, now also for a goods receipt
--    (procurement.grn.write) and for a purchase order the reorder job drafts
--    (procurement.reorder.draft).
create or replace function app.next_document_no(
  p_entity smallint, p_doc_type text, p_fy text, p_prefix text
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_no int;
  v_perm text;
begin
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity
      using errcode = 'insufficient_privilege';
  end if;
  v_perm := case p_doc_type
    when 'quote' then 'sales.quote.create:own'
    when 'sales_order' then 'sales.order.create:own'
    when 'proforma' then 'finance.proforma.write:own'
    when 'challan' then 'inventory.dispatch.write:own'
    when 'purchase_order' then 'procurement.po.write:own'
    when 'goods_receipt' then 'procurement.grn.write:own'
    else null end;
  if v_perm is null
     or not (app.has_perm(v_perm)
             or (p_doc_type = 'sales_order' and app.has_perm('sales.quote.accept.remote:entity'))
             or (p_doc_type = 'purchase_order' and app.has_perm('procurement.reorder.draft:entity'))) then
    raise exception 'permission % required to number a %', v_perm, p_doc_type
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.document_sequences (id, entity_id, doc_type, fy, prefix)
  values (pg_catalog.gen_random_uuid(), p_entity, p_doc_type, p_fy, p_prefix)
  on conflict (entity_id, doc_type, fy) do nothing;
  update public.document_sequences
     set next_no = next_no + 1
   where entity_id = p_entity and doc_type = p_doc_type and fy = p_fy
  returning next_no - 1 into v_no;
  return v_no;
end
$$;
--> statement-breakpoint
revoke all on function app.next_document_no(smallint, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.next_document_no(smallint, text, text, text) to app_user;
--> statement-breakpoint

-- 3. updated_at; a receipt line's rate is written once.
create trigger set_updated_at before update on reorder_rules
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on purchase_orders
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on po_lines
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on po_line_rates
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on goods_receipts
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger goods_receipt_line_rates_append_only before update or delete on goods_receipt_line_rates
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 4. reorder_rules: read in the company with inventory.stock.read or procurement.po.write; set and
--    removed with procurement.po.write for the company.
alter table reorder_rules enable row level security;
--> statement-breakpoint
alter table reorder_rules force row level security;
--> statement-breakpoint
create policy reorder_rules_read on reorder_rules for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy reorder_rules_insert on reorder_rules for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.po.write:entity'))
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy reorder_rules_update on reorder_rules for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('procurement.po.write:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('procurement.po.write:entity'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
create policy reorder_rules_delete on reorder_rules for delete to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.po.write:entity')));
--> statement-breakpoint

-- 5. purchase_orders: read in the company with inventory.stock.read or procurement.po.write;
--    drafted with procurement.po.write by the caller; changed by a holder of procurement.po.write,
--    procurement.po.approve or procurement.grn.write (a receipt moves the order's state), each only
--    as far as the guard of step 6 lets that grant.
alter table purchase_orders enable row level security;
--> statement-breakpoint
alter table purchase_orders force row level security;
--> statement-breakpoint
create policy purchase_orders_read on purchase_orders for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy purchase_orders_insert on purchase_orders for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.po.write:entity'))
  and state = 'draft' and source = 'manual'
  and created_by = (select app.user_id())
  and drafted_by = (select app.user_id())
  and approved_by is null and sent_at is null);
--> statement-breakpoint
create policy purchase_orders_update on purchase_orders for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('procurement.po.write:entity'))
              or (select app.has_perm('procurement.po.approve:entity'))
              or (select app.has_perm('procurement.grn.write:entity'))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and ((select app.has_perm('procurement.po.write:entity'))
                   or (select app.has_perm('procurement.po.approve:entity'))
                   or (select app.has_perm('procurement.grn.write:entity')))
              and updated_by = (select app.user_id()));
--> statement-breakpoint

-- 6. The order's guard: what each change may touch. A draft's terms change only in draft and only
--    with procurement.po.write, and whoever writes a draft becomes its drafter. The state moves
--    only as the purchase_order machine allows, each move with its grant: approval with
--    procurement.po.approve, a line, a rate and a GST rate on every line, and an approver who is
--    not the drafter unless they are an Executive (question 5 (a)); sending, cancelling and
--    closing with procurement.po.write; receiving and its reversal with procurement.grn.write.
--    The limit on the grand total is the command's (WORKSHOP_DEFAULTS.procurement), since the
--    amount is worked out by the tax engine.
create or replace function app.purchase_orders_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
begin
  if new.entity_id is distinct from old.entity_id or new.po_no is distinct from old.po_no
     or new.source is distinct from old.source or new.created_by is distinct from old.created_by then
    raise exception 'a purchase order keeps its company, number and source'
      using errcode = 'check_violation', constraint = 'purchase_order_fixed';
  end if;
  if (new.vendor_id, new.deliver_to_warehouse_id, new.expected_at, new.notes, new.drafted_by,
      new.vendor_state_code, new.place_of_supply_state_code)
     is distinct from
     (old.vendor_id, old.deliver_to_warehouse_id, old.expected_at, old.notes, old.drafted_by,
      old.vendor_state_code, old.place_of_supply_state_code) then
    if old.state <> 'draft' or new.state <> 'draft' then
      raise exception 'only a draft purchase order changes its terms'
        using errcode = 'check_violation', constraint = 'purchase_order_not_draft';
    end if;
    if not app.has_perm('procurement.po.write:entity') or new.drafted_by is distinct from v_actor then
      raise exception 'procurement.po.write is required to change a draft' using errcode = '42501';
    end if;
  end if;
  if (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at)
     and not (old.state = 'draft' and new.state = 'approved') then
    raise exception 'a purchase order is approved once'
      using errcode = 'check_violation', constraint = 'purchase_order_transition_not_allowed';
  end if;
  if (new.sent_at, new.sent_via) is distinct from (old.sent_at, old.sent_via)
     and not (old.state = 'approved' and new.state = 'sent') then
    raise exception 'a purchase order is sent once'
      using errcode = 'check_violation', constraint = 'purchase_order_transition_not_allowed';
  end if;
  if new.state is distinct from old.state then
    if not ((old.state, new.state) in (('draft', 'approved'), ('approved', 'sent'),
                                       ('sent', 'partially_received'), ('sent', 'received'),
                                       ('partially_received', 'received'),
                                       ('partially_received', 'sent'), ('received', 'sent'),
                                       ('received', 'partially_received'),
                                       ('partially_received', 'closed'), ('received', 'closed'),
                                       ('draft', 'cancelled'), ('approved', 'cancelled'),
                                       ('sent', 'cancelled'))) then
      raise exception 'a purchase order does not move from % to %', old.state, new.state
        using errcode = 'check_violation', constraint = 'purchase_order_transition_not_allowed';
    end if;
    if new.state = 'approved' then
      if not app.has_perm('procurement.po.approve:entity') or new.approved_by is distinct from v_actor then
        raise exception 'procurement.po.approve is required to approve a purchase order'
          using errcode = '42501';
      end if;
      if new.approved_by = new.drafted_by
         and pg_catalog.current_setting('app.role', true) is distinct from 'executive' then
        raise exception 'nobody approves a purchase order they drafted'
          using errcode = 'check_violation', constraint = 'po_self_approval';
      end if;
      if not exists (select 1 from public.po_lines l where l.po_id = new.id)
         or exists (select 1 from public.po_lines l
                     where l.po_id = new.id
                       and (l.tax_rate_pct is null
                            or not exists (select 1 from public.po_line_rates r
                                            where r.po_line_id = l.id))) then
        raise exception 'every line of an approved purchase order has its rate'
          using errcode = 'check_violation', constraint = 'po_lines_incomplete';
      end if;
    elsif new.state in ('cancelled', 'closed') or (old.state = 'approved' and new.state = 'sent') then
      if not app.has_perm('procurement.po.write:entity') then
        raise exception 'procurement.po.write is required to send, cancel or close a purchase order'
          using errcode = '42501';
      end if;
    elsif not app.has_perm('procurement.grn.write:entity') then
      raise exception 'procurement.grn.write is required to receive against a purchase order'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.purchase_orders_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger purchase_orders_guard before update on purchase_orders
  for each row execute function app.purchase_orders_guard();
--> statement-breakpoint

-- 7. po_lines: read as their order; written with procurement.po.write while the order is a draft.
--    After that only the quantity received changes, by a holder of procurement.grn.write (a
--    receipt, or its reversal) on an order that has been sent.
alter table po_lines enable row level security;
--> statement-breakpoint
alter table po_lines force row level security;
--> statement-breakpoint
create policy po_lines_read on po_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))));
--> statement-breakpoint
create policy po_lines_insert on po_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.po.write:entity'))
  and created_by = (select app.user_id())
  and qty_received = 0
  and exists (select 1 from purchase_orders p
               where p.id = po_id and p.entity_id = po_lines.entity_id and p.state = 'draft'));
--> statement-breakpoint
create policy po_lines_update on po_lines for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('procurement.po.write:entity'))
              or (select app.has_perm('procurement.grn.write:entity'))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and ((select app.has_perm('procurement.po.write:entity'))
                   or (select app.has_perm('procurement.grn.write:entity')))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
create policy po_lines_delete on po_lines for delete to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.po.write:entity'))
  and exists (select 1 from purchase_orders p
               where p.id = po_id and p.entity_id = po_lines.entity_id and p.state = 'draft'));
--> statement-breakpoint
create or replace function app.po_lines_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_state text;
begin
  select p.state into v_state from public.purchase_orders p where p.id = new.po_id;
  if new.po_id is distinct from old.po_id or new.entity_id is distinct from old.entity_id
     or new.item_id is distinct from old.item_id then
    raise exception 'a purchase order line keeps its order and item'
      using errcode = 'check_violation', constraint = 'po_line_fixed';
  end if;
  if (new.line_no, new.qty, new.purchase_unit, new.unit_factor, new.hsn, new.tax_rate_id,
      new.tax_rate_pct)
     is distinct from
     (old.line_no, old.qty, old.purchase_unit, old.unit_factor, old.hsn, old.tax_rate_id,
      old.tax_rate_pct) then
    if v_state <> 'draft' then
      raise exception 'only a draft purchase order changes its lines'
        using errcode = 'check_violation', constraint = 'purchase_order_not_draft';
    end if;
    if not app.has_perm('procurement.po.write:entity') then
      raise exception 'procurement.po.write is required to change a line' using errcode = '42501';
    end if;
  end if;
  if new.qty_received is distinct from old.qty_received
     and (v_state not in ('sent', 'partially_received', 'received')
          or not app.has_perm('procurement.grn.write:entity')) then
    raise exception 'goods are received only against a sent purchase order'
      using errcode = 'check_violation', constraint = 'purchase_order_not_open';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.po_lines_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger po_lines_guard before update on po_lines
  for each row execute function app.po_lines_guard();
--> statement-breakpoint

-- 8. po_line_rates: restricted. Read only with procurement.rate.read in the line's company;
--    written with procurement.rate.read and procurement.po.write while the order is a draft.
alter table po_line_rates enable row level security;
--> statement-breakpoint
alter table po_line_rates force row level security;
--> statement-breakpoint
create policy po_line_rates_read on po_line_rates for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.rate.read:entity')));
--> statement-breakpoint
create policy po_line_rates_insert on po_line_rates for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.rate.read:entity'))
  and (select app.has_perm('procurement.po.write:entity'))
  and created_by = (select app.user_id())
  and exists (select 1 from po_lines l join purchase_orders p on p.id = l.po_id
               where l.id = po_line_id and l.entity_id = po_line_rates.entity_id
                 and p.state = 'draft'));
--> statement-breakpoint
create policy po_line_rates_update on po_line_rates for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('procurement.rate.read:entity'))
         and (select app.has_perm('procurement.po.write:entity'))
         and exists (select 1 from po_lines l join purchase_orders p on p.id = l.po_id
                      where l.id = po_line_id and p.state = 'draft'))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('procurement.rate.read:entity'))
              and (select app.has_perm('procurement.po.write:entity'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
create policy po_line_rates_delete on po_line_rates for delete to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.rate.read:entity'))
  and (select app.has_perm('procurement.po.write:entity'))
  and exists (select 1 from po_lines l join purchase_orders p on p.id = l.po_id
               where l.id = po_line_id and p.state = 'draft'));
--> statement-breakpoint

-- 9. goods_receipts and their lines: read as orders are; posted with procurement.grn.write by the
--    caller; a receipt changes only to reversed, by a holder of procurement.grn.write. Lines are
--    written once, into a receipt the caller is posting.
alter table goods_receipts enable row level security;
--> statement-breakpoint
alter table goods_receipts force row level security;
--> statement-breakpoint
create policy goods_receipts_read on goods_receipts for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))
       or (select app.has_perm('procurement.grn.write:entity'))));
--> statement-breakpoint
create policy goods_receipts_insert on goods_receipts for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.grn.write:entity'))
  and state = 'posted'
  and created_by = (select app.user_id())
  and received_by = (select app.user_id()));
--> statement-breakpoint
create policy goods_receipts_reverse on goods_receipts for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('procurement.grn.write:entity'))
         and state = 'posted')
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('procurement.grn.write:entity'))
              and state = 'reversed'
              and reversed_by = (select app.user_id())
              and updated_by = (select app.user_id()));
--> statement-breakpoint
alter table goods_receipt_lines enable row level security;
--> statement-breakpoint
alter table goods_receipt_lines force row level security;
--> statement-breakpoint
create policy goods_receipt_lines_read on goods_receipt_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('procurement.po.write:entity'))
       or (select app.has_perm('procurement.grn.write:entity'))));
--> statement-breakpoint
create policy goods_receipt_lines_insert on goods_receipt_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.grn.write:entity'))
  and created_by = (select app.user_id())
  and exists (select 1 from goods_receipts r
               where r.id = receipt_id and r.entity_id = goods_receipt_lines.entity_id
                 and r.state = 'posted' and r.created_by = (select app.user_id())));
--> statement-breakpoint

-- 10. goods_receipt_line_rates: restricted, as po_line_rates; written only by
--     app.goods_receipt_post().
alter table goods_receipt_line_rates enable row level security;
--> statement-breakpoint
alter table goods_receipt_line_rates force row level security;
--> statement-breakpoint
create policy goods_receipt_line_rates_read on goods_receipt_line_rates for select
  to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('procurement.rate.read:entity')));
--> statement-breakpoint

-- 11. Grants.
revoke all on reorder_rules, purchase_orders, po_lines, po_line_rates, goods_receipts,
              goods_receipt_lines, goods_receipt_line_rates
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert, delete on reorder_rules to app_user;
--> statement-breakpoint
grant update (reorder_level, reorder_qty, updated_at, updated_by) on reorder_rules to app_user;
--> statement-breakpoint
grant select, insert on purchase_orders to app_user;
--> statement-breakpoint
grant update (deliver_to_warehouse_id, state, state_changed_at, expected_at, drafted_by,
              approved_by, approved_at, sent_at, sent_via, cancel_reason, close_reason,
              vendor_state_code, place_of_supply_state_code, notes, updated_at, updated_by)
  on purchase_orders to app_user;
--> statement-breakpoint
grant select, insert, delete on po_lines to app_user;
--> statement-breakpoint
grant update (line_no, qty, purchase_unit, unit_factor, qty_received, hsn, tax_rate_id,
              tax_rate_pct, updated_at, updated_by)
  on po_lines to app_user;
--> statement-breakpoint
grant select, insert, delete on po_line_rates to app_user;
--> statement-breakpoint
grant update (unit_rate, amount, quote_id, updated_at, updated_by) on po_line_rates to app_user;
--> statement-breakpoint
grant select, insert on goods_receipts to app_user;
--> statement-breakpoint
grant update (state, reversed_at, reversed_by, reverse_reason, updated_at, updated_by)
  on goods_receipts to app_user;
--> statement-breakpoint
grant select, insert on goods_receipt_lines to app_user;
--> statement-breakpoint
grant select on goods_receipt_line_rates to app_user;
--> statement-breakpoint
grant select on reorder_rules, purchase_orders, po_lines, po_line_rates, goods_receipts,
                goods_receipt_lines, goods_receipt_line_rates to app_reader;
--> statement-breakpoint

-- 12. app.goods_receipt_post(receipt, serials): moves a receipt's goods into stock, for its
--     command (procurement.grn.post), inside the command's transaction. The receipt and its lines
--     are already written by the caller under row security; this reads each purchase order line's
--     rate (restricted), keeps it as the receipt line's rate, and posts one `receipt` movement per
--     line (per serial for a tracked item) through app.stock_move() at that rate per stock unit,
--     which revalues the moving average (question 2 (a)). It trusts no row it is given: the order
--     is sent or partially received and delivers to the receipt's hub; each line is a line of that
--     order, for its item, in the company, with its stock quantity the quantity times the order
--     line's unit factor, within what the order line still expects (all the receipt's lines of an
--     order line together; the command raises qty_received after this), into a receiving, storage
--     or quarantine bin of the hub in use. `p_serials` maps each tracked line's id
--     to its serial numbers: exactly the line's quantity of them, each once. A number the item
--     already has is refused (goods_receipt_serial_taken), unless it is this company's serial out
--     of stock (`scrapped`) because the receipt it came in on was reversed: it comes in again. The
--     ledger makes each new serial, or brings the returning one back, in stock (the `receipt` move
--     row: creates, or from `scrapped`), and this then records its vendor, its receipt line and its
--     supplier warranty from the date received in India. Answers the movement ids, never a rate.
create or replace function app.goods_receipt_post(p_receipt_id uuid, p_serials jsonb)
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_receipt record;
  v_line record;
  v_rate numeric(14, 4);
  v_cost numeric(14, 4);
  v_batch jsonb := '[]'::jsonb;
  v_nos jsonb;
  v_no text;
  v_ids uuid[];
begin
  if v_actor is null or not app.has_perm('procurement.grn.write:entity') then
    raise exception 'procurement.grn.write is required to post a goods receipt' using errcode = '42501';
  end if;
  -- The order, then the receipt, as the command locks them.
  select r.id, r.entity_id, r.state, r.received_at, r.po_id, r.warehouse_id, p.vendor_id,
         p.state as po_state, p.deliver_to_warehouse_id
    into v_receipt
    from public.goods_receipts r
    join public.purchase_orders p on p.id = r.po_id and p.entity_id = r.entity_id
   where r.id = p_receipt_id
     for update of p, r;
  if not found or not (v_receipt.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'goods receipt % is outside the request', p_receipt_id using errcode = '42501';
  end if;
  if v_receipt.po_state not in ('sent', 'partially_received')
     or v_receipt.warehouse_id is distinct from v_receipt.deliver_to_warehouse_id then
    raise exception 'the purchase order is not open for goods'
      using errcode = 'check_violation', constraint = 'purchase_order_not_open';
  end if;
  if v_receipt.state <> 'posted'
     or exists (select 1 from public.goods_receipt_line_rates x
                  join public.goods_receipt_lines l on l.id = x.receipt_line_id
                 where l.receipt_id = p_receipt_id) then
    raise exception 'the goods receipt is already in stock'
      using errcode = 'check_violation', constraint = 'goods_receipt_posted';
  end if;
  if p_serials is null or pg_catalog.jsonb_typeof(p_serials) <> 'object' then
    raise exception 'serials are given per line'
      using errcode = 'check_violation', constraint = 'goods_receipt_serials_count';
  end if;

  for v_line in
    select l.id, l.entity_id, l.item_id, l.bin_id, l.qty, l.stock_qty, l.is_serial_tracked,
           l.po_line_id, pl.po_id, pl.entity_id as po_line_entity_id, pl.item_id as po_item_id,
           pl.unit_factor, pl.qty - pl.qty_received as open_qty,
           sum(l.qty) over (partition by l.po_line_id) as receipt_qty,
           b.warehouse_id as bin_hub, b.kind as bin_kind, b.archived_at as bin_archived_at,
           i.is_serial_tracked as item_tracked
      from public.goods_receipt_lines l
      left join public.po_lines pl on pl.id = l.po_line_id
      left join public.bins b on b.id = l.bin_id
      join public.items i on i.id = l.item_id
     where l.receipt_id = p_receipt_id
     order by l.id
  loop
    if v_line.po_id is distinct from v_receipt.po_id
       or v_line.entity_id <> v_receipt.entity_id
       or v_line.po_line_entity_id is distinct from v_receipt.entity_id
       or v_line.po_item_id is distinct from v_line.item_id
       or v_line.stock_qty <> pg_catalog.round(v_line.qty * v_line.unit_factor, 3) then
      raise exception 'the receipt line is not a line of the order'
        using errcode = 'check_violation', constraint = 'goods_receipt_line_unknown',
              detail = pg_catalog.jsonb_build_object('itemId', v_line.item_id)::text;
    end if;
    if v_line.receipt_qty > v_line.open_qty then
      raise exception 'more than the order still expects'
        using errcode = 'check_violation', constraint = 'goods_receipt_over_order',
              detail = pg_catalog.jsonb_build_object('itemId', v_line.item_id)::text;
    end if;
    if v_line.bin_hub is distinct from v_receipt.warehouse_id
       or v_line.bin_kind not in ('receiving', 'storage', 'quarantine')
       or v_line.bin_archived_at is not null then
      raise exception 'the bin is not one goods are received into at the hub'
        using errcode = 'check_violation', constraint = 'goods_receipt_bin_unusable',
              detail = pg_catalog.jsonb_build_object('itemId', v_line.item_id)::text;
    end if;
    if v_line.is_serial_tracked is distinct from v_line.item_tracked then
      raise exception 'the item changed its serial tracking'
        using errcode = 'check_violation', constraint = 'goods_receipt_serials_count';
    end if;
    select r.unit_rate into v_rate from public.po_line_rates r where r.po_line_id = v_line.po_line_id;
    if v_rate is null then
      raise exception 'the purchase order line has no rate'
        using errcode = 'check_violation', constraint = 'po_lines_incomplete';
    end if;
    insert into public.goods_receipt_line_rates (receipt_line_id, entity_id, unit_rate)
    values (v_line.id, v_receipt.entity_id, v_rate);
    v_cost := pg_catalog.round(v_rate / v_line.unit_factor, 4);

    if not v_line.is_serial_tracked then
      v_batch := v_batch || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'reason', 'receipt', 'entity_id', v_receipt.entity_id, 'item_id', v_line.item_id,
        'to_bin_id', v_line.bin_id, 'qty', v_line.stock_qty, 'unit_cost', v_cost,
        'ref_type', 'goods_receipt', 'ref_id', p_receipt_id));
      continue;
    end if;

    v_nos := p_serials -> (v_line.id::text);
    if v_nos is null or pg_catalog.jsonb_typeof(v_nos) <> 'array'
       or pg_catalog.jsonb_array_length(v_nos) <> v_line.stock_qty
       or (select count(distinct pg_catalog.lower(pg_catalog.btrim(e)))
             from pg_catalog.jsonb_array_elements_text(v_nos) e) <> v_line.stock_qty then
      raise exception 'every serial of the line is given once'
        using errcode = 'check_violation', constraint = 'goods_receipt_serials_count',
              detail = pg_catalog.jsonb_build_object('itemId', v_line.item_id)::text;
    end if;
    for v_no in select pg_catalog.btrim(e) from pg_catalog.jsonb_array_elements_text(v_nos) e loop
      if exists (select 1 from public.serials s
                  where s.item_id = v_line.item_id
                    and pg_catalog.lower(s.serial_no) = pg_catalog.lower(v_no)
                    and not (s.entity_id = v_receipt.entity_id and s.state = 'scrapped'
                             and exists (select 1 from public.goods_receipt_lines gl
                                           join public.goods_receipts gr on gr.id = gl.receipt_id
                                          where gl.id = s.receipt_line_id
                                            and gr.state = 'reversed'))) then
        raise exception 'the serial is already recorded for the item'
          using errcode = 'check_violation', constraint = 'goods_receipt_serial_taken',
                detail = pg_catalog.jsonb_build_object('serialNo', v_no)::text;
      end if;
      v_batch := v_batch || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'reason', 'receipt', 'entity_id', v_receipt.entity_id, 'item_id', v_line.item_id,
        'serial_no', v_no, 'to_bin_id', v_line.bin_id, 'qty', 1, 'unit_cost', v_cost,
        'ref_type', 'goods_receipt', 'ref_id', p_receipt_id));
    end loop;
  end loop;

  if pg_catalog.jsonb_array_length(v_batch) = 0 then
    raise exception 'a goods receipt has a line'
      using errcode = 'check_violation', constraint = 'goods_receipt_serials_count';
  end if;
  v_ids := app.stock_move(v_batch);

  -- The serials the ledger made: their vendor, receipt line and supplier warranty.
  update public.serials s
     set vendor_id = v_receipt.vendor_id,
         receipt_line_id = l.id,
         supplier_warranty_until = case when i.supplier_warranty_months is null then null
           else ((v_receipt.received_at at time zone 'Asia/Kolkata')::date
                 + pg_catalog.make_interval(months => i.supplier_warranty_months::int))::date end,
         updated_by = v_actor
    from public.stock_movements m
    join public.goods_receipt_lines l
      on l.receipt_id = p_receipt_id and l.item_id = m.item_id and l.bin_id = m.to_bin_id
    join public.items i on i.id = m.item_id
   where m.id = any (v_ids) and m.serial_id is not null and s.id = m.serial_id;
  return v_ids;
end
$$;
--> statement-breakpoint
revoke execute on function app.goods_receipt_post(uuid, jsonb) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.goods_receipt_post(uuid, jsonb) to app_user;
--> statement-breakpoint

-- 13. app.goods_receipt_unpost(receipt): takes a whole receipt's goods back out of stock, for
--     procurement.grn.reverse, while none of its stock or serials has moved on: every serial is
--     still in stock in the bin it came into, with no movement since, and no stock of a line's
--     item has left the line's bin since the receipt, which still holds the line's quantity free
--     of reservations. Each receipt movement is reversed through app.stock_move(), which takes the
--     receipt's own cost back out of the moving average. Answers the movement ids.
--     "Since" is by the order movements were written, never by moved_at (a transaction's start, so
--     an issue whose transaction began before the receipt's and wrote after it would look older):
--     the receipt's bins and their balances (and its serials) are locked first, in the order every
--     stock path takes them, so a movement out of them either committed before and is read here, or
--     waits for this reversal; and a movement written after the receipt's has a later uuid v7 id,
--     since the ledger takes its id only once it holds the balance's lock. One written in the same
--     millisecond counts as since, so the doubt refuses the reversal rather than allowing it.
create or replace function app.goods_receipt_unpost(p_receipt_id uuid)
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_receipt record;
  v_move record;
  v_batch jsonb := '[]'::jsonb;
begin
  if app.user_id() is null or not app.has_perm('procurement.grn.write:entity') then
    raise exception 'procurement.grn.write is required to reverse a goods receipt' using errcode = '42501';
  end if;
  select r.id, r.entity_id, r.state into v_receipt
    from public.goods_receipts r where r.id = p_receipt_id for update;
  if not found or not (v_receipt.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'goods receipt % is outside the request', p_receipt_id using errcode = '42501';
  end if;
  if v_receipt.state <> 'posted' then
    raise exception 'the goods receipt is already reversed'
      using errcode = 'check_violation', constraint = 'goods_receipt_reversed';
  end if;
  -- The locks first, in app.stock_move()'s order (hubs, bins, balances, serials), so the checks
  -- below read every movement out of the receipt's bins that committed before them.
  perform 1 from public.warehouses w
   where w.id in (select b.warehouse_id from public.bins b
                   where b.id in (select m.to_bin_id from public.stock_movements m
                                   where m.ref_type = 'goods_receipt' and m.ref_id = p_receipt_id
                                     and m.reason = 'receipt'))
   order by w.id
   for share;
  perform 1 from public.bins b
   where b.id in (select m.to_bin_id from public.stock_movements m
                   where m.ref_type = 'goods_receipt' and m.ref_id = p_receipt_id
                     and m.reason = 'receipt')
   order by b.id
   for share;
  perform 1 from public.stock_balances b
   where (b.entity_id, b.bin_id, b.item_id) in (
           select m.entity_id, m.to_bin_id, m.item_id from public.stock_movements m
            where m.ref_type = 'goods_receipt' and m.ref_id = p_receipt_id and m.reason = 'receipt')
   order by b.entity_id, b.warehouse_id, b.bin_id, b.item_id
   for update;
  perform 1 from public.serials s
   where s.id in (select m.serial_id from public.stock_movements m
                   where m.ref_type = 'goods_receipt' and m.ref_id = p_receipt_id
                     and m.reason = 'receipt' and m.serial_id is not null)
   order by s.id
   for update;
  for v_move in
    select m.id, m.entity_id, m.item_id, m.serial_id, m.to_bin_id, m.qty, m.batch_id
      from public.stock_movements m
     where m.ref_type = 'goods_receipt' and m.ref_id = p_receipt_id and m.reason = 'receipt'
     order by m.id
  loop
    if exists (select 1 from public.stock_movements r where r.reverses_id = v_move.id) then
      raise exception 'the goods receipt is already reversed'
        using errcode = 'check_violation', constraint = 'goods_receipt_reversed';
    end if;
    if v_move.serial_id is not null then
      if not exists (select 1 from public.serials s
                      where s.id = v_move.serial_id and s.state = 'in_stock'
                        and s.bin_id = v_move.to_bin_id)
         or exists (select 1 from public.stock_movements x
                     where x.serial_id = v_move.serial_id and x.id <> v_move.id
                       and (x.id > v_move.id
                            or pg_catalog.left(x.id::text, 13) = pg_catalog.left(v_move.id::text, 13))) then
        raise exception 'a serial of the receipt has moved on'
          using errcode = 'check_violation', constraint = 'goods_receipt_moved_on',
                detail = pg_catalog.jsonb_build_object('itemId', v_move.item_id)::text;
      end if;
    elsif exists (select 1 from public.stock_movements x
                   where x.entity_id = v_move.entity_id and x.item_id = v_move.item_id
                     and x.from_bin_id = v_move.to_bin_id and x.batch_id <> v_move.batch_id
                     and (x.id > v_move.id
                          or pg_catalog.left(x.id::text, 13) = pg_catalog.left(v_move.id::text, 13)))
       or not exists (select 1 from public.stock_balances b
                       where b.entity_id = v_move.entity_id and b.bin_id = v_move.to_bin_id
                         and b.item_id = v_move.item_id
                         and b.qty_on_hand - b.qty_reserved >= v_move.qty) then
      raise exception 'stock of the receipt has moved on'
        using errcode = 'check_violation', constraint = 'goods_receipt_moved_on',
              detail = pg_catalog.jsonb_build_object('itemId', v_move.item_id)::text;
    end if;
    v_batch := v_batch || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'reason', 'reversal', 'reverses_id', v_move.id,
      'ref_type', 'goods_receipt', 'ref_id', p_receipt_id));
  end loop;
  if pg_catalog.jsonb_array_length(v_batch) = 0 then
    raise exception 'the goods receipt moved no stock'
      using errcode = 'check_violation', constraint = 'goods_receipt_reversed';
  end if;
  return app.stock_move(v_batch);
end
$$;
--> statement-breakpoint
revoke execute on function app.goods_receipt_unpost(uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.goods_receipt_unpost(uuid) to app_user;
--> statement-breakpoint

-- 14. app.reorder_shortfalls(company): the reorder job's read (procurement.reorder.draft, every
--     company; system:workers). For each reorder rule of the company whose item is active and
--     stocked and whose hub is in use: free stock at the hub (on hand less reserved in its storage
--     and receiving bins, so goods received and not yet put away count) plus what open purchase
--     orders to the hub still bring (draft to partially received, in stock units). A rule below
--     its level answers its reorder quantity in the item's purchase unit (whole purchase units
--     when one holds several stock units) and the item's preferred active vendor, or none. Holds
--     the company's reorder lock to the end of the transaction, so two runs never draft twice.
create or replace function app.reorder_shortfalls(p_entity_id smallint)
  returns table (item_id uuid, warehouse_id uuid, vendor_id uuid, qty numeric, purchase_unit text,
                 unit_factor numeric, hsn text)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('procurement.reorder.draft:all') then
    raise exception 'procurement.reorder.draft is required' using errcode = '42501';
  end if;
  if not (p_entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'company % is outside the request', p_entity_id using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app.reorder'), p_entity_id);
  return query
    with rules as (
      select r.entity_id, r.item_id, r.warehouse_id, r.reorder_level, r.reorder_qty,
             coalesce(i.purchase_unit, i.unit) as purchase_unit,
             coalesce(i.purchase_unit_factor, 1::numeric) as unit_factor, i.hsn
        from public.reorder_rules r
        join public.items i on i.id = r.item_id
        join public.warehouses w on w.id = r.warehouse_id
       where r.entity_id = p_entity_id
         and i.is_active and i.archived_at is null and i.is_stocked
         and w.archived_at is null),
    levels as (
      select ru.*,
             coalesce((select sum(b.qty_on_hand - b.qty_reserved)
                         from public.stock_balances b
                         join public.bins bn on bn.id = b.bin_id
                        where b.entity_id = ru.entity_id and b.item_id = ru.item_id
                          and b.warehouse_id = ru.warehouse_id
                          and bn.kind in ('storage', 'receiving')), 0)
             + coalesce((select sum((l.qty - l.qty_received) * l.unit_factor)
                           from public.po_lines l
                           join public.purchase_orders p on p.id = l.po_id
                          where p.entity_id = ru.entity_id and l.item_id = ru.item_id
                            and p.deliver_to_warehouse_id = ru.warehouse_id
                            and p.state in ('draft', 'approved', 'sent', 'partially_received')), 0)
               as covered
        from rules ru)
    select lv.item_id, lv.warehouse_id,
           (select iv.vendor_id from public.item_vendors iv
              join public.vendors v on v.id = iv.vendor_id
             where iv.item_id = lv.item_id and iv.is_preferred and v.is_active),
           (case when lv.unit_factor = 1 then lv.reorder_qty
                 else pg_catalog.ceil(lv.reorder_qty / lv.unit_factor) end)::numeric,
           lv.purchase_unit, lv.unit_factor::numeric, lv.hsn
      from levels lv
     where lv.covered < lv.reorder_level
     order by lv.warehouse_id, lv.item_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.reorder_shortfalls(smallint) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reorder_shortfalls(smallint) to app_user;
--> statement-breakpoint

-- 15. app.reorder_draft_po(...): the reorder job's write (procurement.reorder.draft): one draft
--     purchase order of the company to an active vendor for a hub in use, numbered by the caller
--     from the series, with lines of quantities and GST rates and never a rate. `p_lines` is
--     [{item_id, qty, tax_rate_id | null, tax_rate_pct | null}]; each item's purchase unit, factor
--     and HSN come from the catalogue. The platform is the drafter.
create or replace function app.reorder_draft_po(
  p_entity_id smallint, p_po_id uuid, p_po_no text, p_vendor_id uuid, p_warehouse_id uuid,
  p_lines jsonb
) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_vendor_state text;
  v_hub_state text;
  v_el jsonb;
  v_n smallint := 0;
begin
  if v_actor is null or not app.has_perm('procurement.reorder.draft:all') then
    raise exception 'procurement.reorder.draft is required' using errcode = '42501';
  end if;
  if not (p_entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'company % is outside the request', p_entity_id using errcode = '42501';
  end if;
  select v.state_code into v_vendor_state from public.vendors v
   where v.id = p_vendor_id and v.is_active;
  if not found then
    raise exception 'the vendor is not active'
      using errcode = 'check_violation', constraint = 'purchase_order_vendor_inactive';
  end if;
  select w.state_code into v_hub_state from public.warehouses w
   where w.id = p_warehouse_id and w.archived_at is null and w.kind <> 'transit';
  if not found then
    raise exception 'the hub is not in use'
      using errcode = 'check_violation', constraint = 'purchase_order_hub_unusable';
  end if;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array'
     or pg_catalog.jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'a reorder draft has 1 to 200 lines'
      using errcode = 'check_violation', constraint = 'po_lines_line_no_check';
  end if;
  insert into public.purchase_orders (id, entity_id, po_no, vendor_id, deliver_to_warehouse_id,
                                      state, source, drafted_by, vendor_state_code,
                                      place_of_supply_state_code, created_by)
  values (p_po_id, p_entity_id, p_po_no, p_vendor_id, p_warehouse_id, 'draft', 'reorder', v_actor,
          v_vendor_state, v_hub_state, v_actor);
  for v_el in select e from pg_catalog.jsonb_array_elements(p_lines) e loop
    v_n := v_n + 1;
    insert into public.po_lines (id, po_id, entity_id, line_no, item_id, qty, purchase_unit,
                                 unit_factor, hsn, tax_rate_id, tax_rate_pct, created_by)
    select app.uuid_v7(), p_po_id, p_entity_id, v_n, i.id, (v_el ->> 'qty')::numeric(12, 3),
           coalesce(i.purchase_unit, i.unit), coalesce(i.purchase_unit_factor, 1), i.hsn,
           (v_el ->> 'tax_rate_id')::uuid, (v_el ->> 'tax_rate_pct')::numeric(5, 2), v_actor
      from public.items i
     where i.id = (v_el ->> 'item_id')::uuid and i.is_active and i.archived_at is null;
    if not found then
      raise exception 'the item is not in the catalogue'
        using errcode = 'check_violation', constraint = 'purchase_order_item_unusable';
    end if;
  end loop;
end
$$;
--> statement-breakpoint
revoke execute on function app.reorder_draft_po(smallint, uuid, text, uuid, uuid, jsonb)
  from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reorder_draft_po(smallint, uuid, text, uuid, uuid, jsonb) to app_user;
