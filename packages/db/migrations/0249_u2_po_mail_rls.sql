-- U2 the purchase order's PDF and its mail (docs/runs/phase3/u2-purchase-orders.md, review
-- findings 4 and R2). The PDF is printed by the render worker alone (ADR 0009), with its rates (the
-- vendor's copy), and stored as a `purchase_order_pdf` file that only a holder of
-- procurement.rate.read reads. The worker principal (system:workers) holds the platform-only
-- procurement.po.print and no person's grant, so it reads no order, rate, vendor or person by a
-- person's rule; two definers give it exactly what it prints and mails.

-- 1. What the PDF prints: one order of the worker's company, approved, with its lines, rates and
--    amounts, the buying company and the vendor. Version 1 is the order as approved (it prints for
--    every order approved, whatever came after); version 2 is the same order marked cancelled, and
--    prints only once the order is cancelled. A draft, an order never approved or one of another
--    company answers null, and nothing is printed. Column names are those of the order sheet's own
--    read (getPurchaseOrder), so one mapping serves.
create or replace function app.purchase_order_for_print(p_order uuid, p_version int)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_order record;
begin
  if app.user_id() is null or not app.has_perm('procurement.po.print:all') then
    raise exception 'procurement.po.print is required to print a purchase order' using errcode = '42501';
  end if;
  select p.id, p.entity_id, p.vendor_id into v_order
    from public.purchase_orders p
   where p.id = p_order
     and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and p.approved_at is not null
     and ((p_version = 1
           and p.state in ('approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled'))
          or (p_version = 2 and p.state = 'cancelled'));
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'order', (
      select pg_catalog.to_jsonb(o) from (
        select p.id, p.entity_id as "entityId", p.po_no as "poNo", p.vendor_id as "vendorId",
               v.name as "vendorName", p.deliver_to_warehouse_id as "deliverToWarehouseId",
               w.name as "hubName", p.state, p.source, p.expected_at::text as "expectedAt",
               p.drafted_by as "draftedBy", d.display_name as "draftedByName",
               p.approved_by as "approvedBy", a.display_name as "approvedByName",
               p.approved_at as "approvedAt", p.sent_at as "sentAt", p.sent_via as "sentVia",
               p.cancel_reason as "cancelReason", p.close_reason as "closeReason",
               p.vendor_state_code as "vendorStateCode",
               p.place_of_supply_state_code as "placeOfSupplyStateCode", p.notes,
               p.created_at as "createdAt"
          from public.purchase_orders p
          join public.vendors v on v.id = p.vendor_id
          join public.warehouses w on w.id = p.deliver_to_warehouse_id
          left join public.principals d on d.id = p.drafted_by
          left join public.principals a on a.id = p.approved_by
         where p.id = v_order.id) o),
    'lines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l."lineNo") from (
        select l.id, l.line_no as "lineNo", l.item_id as "itemId", i.sku, i.name as "itemName",
               i.is_serial_tracked as "isSerialTracked", i.serial_pattern as "serialPattern",
               l.qty::text as qty, l.purchase_unit as "purchaseUnit", i.unit as "stockUnit",
               l.unit_factor::text as "unitFactor", l.qty_received::text as "qtyReceived", l.hsn,
               l.tax_rate_id as "taxRateId", l.tax_rate_pct::text as "taxRatePct"
          from public.po_lines l join public.items i on i.id = l.item_id
         where l.po_id = v_order.id) l), '[]'::jsonb),
    'rates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)) from (
        select r.po_line_id as "poLineId", r.unit_rate::text as "unitRate", r.amount::text as amount,
               r.quote_id as "quoteId"
          from public.po_line_rates r join public.po_lines l on l.id = r.po_line_id
         where l.po_id = v_order.id) r), '[]'::jsonb),
    'company', (
      select pg_catalog.to_jsonb(c) from (
        select e.legal_name as "legalName", e.brand_name as "brandName", e.gstin,
               e.address_line1 as "line1", e.address_line2 as "line2", e.city, e.pin
          from public.entities e where e.id = v_order.entity_id) c),
    'vendor', (
      select pg_catalog.to_jsonb(v) from (
        select v.name, v.gstin, v.address_json as address
          from public.vendors v where v.id = v_order.vendor_id) v)
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.purchase_order_for_print(uuid, int) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.purchase_order_for_print(uuid, int) to app_user;
--> statement-breakpoint

-- 2. Whom the mail goes to: for one order of the worker's company that a person sent by email,
--    approved and still sent, received or closed, its number, the buying company's name, the
--    vendor's person named if they still have an email address, and the sender's address to reply
--    to. An order that is not that (sent by hand, cancelled since) answers null, and nothing is
--    mailed. No rate: the mail attaches the stored PDF.
create or replace function app.purchase_order_mail_to(p_order uuid, p_contact uuid, p_sender uuid)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_order record;
begin
  if app.user_id() is null or not app.has_perm('procurement.po.print:all') then
    raise exception 'procurement.po.print is required to mail a purchase order' using errcode = '42501';
  end if;
  select p.id, p.entity_id, p.vendor_id, p.po_no into v_order
    from public.purchase_orders p
   where p.id = p_order
     and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and p.sent_via = 'email' and p.sent_at is not null and p.approved_at is not null
     and p.state in ('sent', 'partially_received', 'received', 'closed');
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'poNo', v_order.po_no,
    'companyName', (select e.legal_name from public.entities e where e.id = v_order.entity_id),
    'contact', (
      select pg_catalog.to_jsonb(c) from (
        select c.name, c.email from public.vendor_contacts c
         where c.id = p_contact and c.vendor_id = v_order.vendor_id and c.email is not null) c),
    'replyTo', (select u.email from public.users u where u.id = p_sender)
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.purchase_order_mail_to(uuid, uuid, uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.purchase_order_mail_to(uuid, uuid, uuid) to app_user;
