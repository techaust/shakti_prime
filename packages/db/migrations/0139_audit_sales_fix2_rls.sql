-- The sales-integrity fixes of the second review (13-10-2026), with 0134 to 0138.

-- 1. DOM-4, data: `sales.order.cancel` now withdraws the accepted quote of the order it cancels,
--    draft or confirmed, with the cancel reason. A quote still accepted whose order was cancelled
--    before this is moved the same way, keeping how it was accepted. Running it again changes
--    nothing.
update public.quotes q
   set state = 'withdrawn', state_changed_at = pg_catalog.now(), withdrawn_reason = so.cancel_reason
  from public.sales_orders so
 where so.quote_id = q.id
   and so.state = 'cancelled'
   and q.state = 'accepted';
--> statement-breakpoint

-- 2. DOM-2, DOM-3: the lead a quote is made for is held `for share` until the command ends, so a
--    merge or an import rollback that holds it `for update` finishes first and the quote then finds
--    it archived. A locking read under the policies would ask the right to write the lead
--    (`opportunities_update`), which a role may lack while it may quote; this asks
--    sales.quote.create over the lead's owner and team, in a company of the request, and answers
--    only whether a live lead was held.
create or replace function app.hold_quote_lead(p_entity smallint, p_lead uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.has_perm('sales.quote.create:own') then
    raise exception 'sales.quote.create in the company is required' using errcode = '42501';
  end if;
  perform 1
     from public.opportunities o
    where o.id = p_lead
      and o.entity_id = p_entity
      and o.archived_at is null
      and app.scope_ok('sales.quote.create', o.owner_id, o.team_id)
      for share;
  return found;
end
$$;
--> statement-breakpoint
revoke execute on function app.hold_quote_lead(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.hold_quote_lead(smallint, uuid) to app_user;
