-- J2 customer loans: who is told when a lender turns a loan down (the customer-loan machine's
-- `notify_owner`, docs/03-roadmap-appendix/phase4.md §6.2). The notify worker runs as
-- system:workers, which reads no customer, lead or loan (ADR 0020), so it asks this definer, which
-- checks notifications.send and the company (app.require_notice_sender()) in its body. It answers
-- the rejected loan's order, customer and lead, and the person to tell: the owner of the order's
-- lead while it is not archived, or, for an order without a lead, the owner of the customer's
-- relationship in the loan's company; nobody who is not an active member of the company.
create or replace function app.notice_loan_owner(p_entity smallint, p_loan uuid)
  returns table (user_id uuid, account_id uuid, opportunity_id uuid, sales_order_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select coalesce(o.owner_id, ae.owner_id), cl.account_id, so.opportunity_id, cl.sales_order_id
      from public.customer_loans cl
      join public.sales_orders so on so.id = cl.sales_order_id
      left join public.opportunities o
        on o.id = so.opportunity_id and o.archived_at is null
      left join public.account_entities ae
        on ae.account_id = cl.account_id and ae.entity_id = cl.entity_id
     where cl.id = p_loan
       and cl.entity_id = p_entity
       and cl.state = 'rejected'
       and coalesce(o.owner_id, ae.owner_id) is not null
       and app.notice_recipient_ok(coalesce(o.owner_id, ae.owner_id), p_entity);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_loan_owner(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_loan_owner(smallint, uuid) to app_user;
