-- Orders, acceptance and dealer credit (docs/design/phase1.md §8.3, docs/DATABASE.md §6.4).
--
-- A sales order made from an accepted quote is a child of its lead: read with it, made by whoever
-- holds sales.order.create over the lead's owner and team, in the transaction that accepts the
-- quote. A dealer's order without a quote is read by whoever reads the dealer in that company and
-- made with sales.order.create over the dealer's relationship there. Its lines are written only in
-- the transaction that made the order, by its maker, while it is a draft, and never changed.
-- Afterwards a person changes only its state, the credit hold, the release and the cancel reason
-- (column grants), with sales.order.confirm or sales.order.cancel over its lead or dealer, or as
-- the Executive releasing a hold (sales.credit.release:all, which a trigger requires of any change
-- to the release); the sales order machine in packages/domain decides which moves are allowed.
-- Dealer terms and outstanding are append-only entries Accounts make with sales.credit.write, read
-- by them and by whoever reads the dealer in that company. Commission accruals are written only
-- through the definers below, since the person confirming an order cannot read the commission
-- rules, and read by whoever reads the rules. The queries' own role, app_reader, reads under the
-- same policies.

create trigger set_updated_at before update on sales_orders
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger sales_order_lines_append_only before update or delete on sales_order_lines
  for each row execute function app.raise_append_only();
--> statement-breakpoint
create trigger dealer_terms_append_only before update or delete on dealer_terms
  for each row execute function app.raise_append_only();
--> statement-breakpoint
create trigger dealer_outstanding_append_only before update or delete on dealer_outstanding
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- An accrual is never deleted, and only its cancel changes it: once, from accrued to cancelled.
create or replace function app.guard_commission_accrual() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'commission_accruals is append-only' using errcode = '42501';
  end if;
  if old.state <> 'accrued' or new.state <> 'cancelled'
     or (to_jsonb(new) - array['state', 'cancelled_at', 'cancelled_by'])
        is distinct from (to_jsonb(old) - array['state', 'cancelled_at', 'cancelled_by']) then
    raise exception 'an accrual changes only by its cancel' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_commission_accrual() from public, readonly_reporter;
--> statement-breakpoint
create trigger commission_accruals_guard before update or delete on commission_accruals
  for each row execute function app.guard_commission_accrual();
--> statement-breakpoint

-- Only the Executive releases a credit hold (SAL-07, sales.credit.release:all, held by no agent),
-- and the release names the person who gave it; a request that sets or changes the release
-- columns without that permission, or in another person's name, is refused. The owner's own
-- writes (the fixtures) carry no request.
create or replace function app.guard_sales_order_release() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if app.user_id() is not null
     and (new.credit_release_by is distinct from old.credit_release_by
          or new.credit_release_reason is distinct from old.credit_release_reason
          or new.credit_released_at is distinct from old.credit_released_at)
     and (not app.has_perm('sales.credit.release:all')
          or new.credit_release_by is distinct from app.user_id()) then
    raise exception 'a credit hold is released only by the Executive, in their own name'
      using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_sales_order_release() from public, readonly_reporter;
--> statement-breakpoint
create trigger sales_orders_release_guard
  before update of credit_release_by, credit_release_reason, credit_released_at on sales_orders
  for each row execute function app.guard_sales_order_release();
--> statement-breakpoint

alter table sales_orders enable row level security;
--> statement-breakpoint
alter table sales_orders force row level security;
--> statement-breakpoint
alter table sales_order_lines enable row level security;
--> statement-breakpoint
alter table sales_order_lines force row level security;
--> statement-breakpoint
alter table dealer_terms enable row level security;
--> statement-breakpoint
alter table dealer_terms force row level security;
--> statement-breakpoint
alter table dealer_outstanding enable row level security;
--> statement-breakpoint
alter table dealer_outstanding force row level security;
--> statement-breakpoint
alter table commission_accruals enable row level security;
--> statement-breakpoint
alter table commission_accruals force row level security;
--> statement-breakpoint

create policy sales_orders_read on sales_orders for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o where o.id = sales_orders.opportunity_id))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = sales_orders.account_id
                       and ae.entity_id = sales_orders.entity_id))));
--> statement-breakpoint
create policy sales_orders_insert on sales_orders for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and state = 'draft'
  and confirmed_at is null
  and credit_held_at is null
  and credit_release_by is null
  and cancel_reason is null
  and ((quote_id is not null
        and exists (select 1 from quotes q
                      join opportunities o on o.id = q.opportunity_id
                     where q.id = sales_orders.quote_id
                       and q.entity_id = sales_orders.entity_id
                       and q.opportunity_id = sales_orders.opportunity_id
                       and q.account_id = sales_orders.account_id
                       and q.site_id is not distinct from sales_orders.site_id
                       and q.state = 'accepted'
                       and o.archived_at is null
                       and app.scope_ok('sales.order.create', o.owner_id, o.team_id)))
    or (quote_id is null
        and exists (select 1 from account_entities ae
                      join accounts a on a.id = ae.account_id
                     where ae.account_id = sales_orders.account_id
                       and ae.entity_id = sales_orders.entity_id
                       and a.type = 'dealer'
                       and a.archived_at is null
                       and app.scope_ok('sales.order.create', ae.owner_id, ae.team_id)))));
--> statement-breakpoint
create policy sales_orders_update on sales_orders for update to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('sales.credit.release:all'))
    or (opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = sales_orders.opportunity_id
                       and (app.scope_ok('sales.order.confirm', o.owner_id, o.team_id)
                            or app.scope_ok('sales.order.cancel', o.owner_id, o.team_id))))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = sales_orders.account_id
                       and ae.entity_id = sales_orders.entity_id
                       and (app.scope_ok('sales.order.confirm', ae.owner_id, ae.team_id)
                            or app.scope_ok('sales.order.cancel', ae.owner_id, ae.team_id))))))
with check (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('sales.credit.release:all'))
    or (opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = sales_orders.opportunity_id
                       and (app.scope_ok('sales.order.confirm', o.owner_id, o.team_id)
                            or app.scope_ok('sales.order.cancel', o.owner_id, o.team_id))))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = sales_orders.account_id
                       and ae.entity_id = sales_orders.entity_id
                       and (app.scope_ok('sales.order.confirm', ae.owner_id, ae.team_id)
                            or app.scope_ok('sales.order.cancel', ae.owner_id, ae.team_id))))));
--> statement-breakpoint

create policy sales_order_lines_read on sales_order_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from sales_orders so where so.id = sales_order_lines.sales_order_id));
--> statement-breakpoint
create policy sales_order_lines_insert on sales_order_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from sales_orders so
               where so.id = sales_order_lines.sales_order_id
                 and so.entity_id = sales_order_lines.entity_id
                 and so.state = 'draft'
                 and so.created_by = (select app.user_id())
                 and so.created_at = now()));
--> statement-breakpoint

create policy dealer_terms_read on dealer_terms for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('sales.credit.write:entity'))
    or exists (select 1 from account_entities ae
                where ae.account_id = dealer_terms.account_id
                  and ae.entity_id = dealer_terms.entity_id)));
--> statement-breakpoint
create policy dealer_terms_insert on dealer_terms for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('sales.credit.write:entity'))
  and created_by = (select app.user_id())
  and exists (select 1 from account_entities ae
                join accounts a on a.id = ae.account_id
               where ae.account_id = dealer_terms.account_id
                 and ae.entity_id = dealer_terms.entity_id
                 and a.type = 'dealer'
                 and a.archived_at is null));
--> statement-breakpoint
create policy dealer_outstanding_read on dealer_outstanding for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('sales.credit.write:entity'))
    or exists (select 1 from account_entities ae
                where ae.account_id = dealer_outstanding.account_id
                  and ae.entity_id = dealer_outstanding.entity_id)));
--> statement-breakpoint
create policy dealer_outstanding_insert on dealer_outstanding for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('sales.credit.write:entity'))
  and entered_by = (select app.user_id())
  and exists (select 1 from account_entities ae
                join accounts a on a.id = ae.account_id
               where ae.account_id = dealer_outstanding.account_id
                 and ae.entity_id = dealer_outstanding.entity_id
                 and a.type = 'dealer'
                 and a.archived_at is null));
--> statement-breakpoint

-- Read as the commission rules are: by the Executive (crm.config.write:all) and by Accounts, who
-- pay commission (finance.payment.write), in the request's companies.
create policy commission_accruals_read on commission_accruals for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.config.write:all'))
    or (select app.has_perm('finance.payment.write:own'))));
--> statement-breakpoint

grant select, insert on sales_orders to app_user;
--> statement-breakpoint
grant update (state, state_changed_at, confirmed_at, confirmed_by, credit_held_at,
              credit_hold_reason, credit_hold_json, credit_release_by, credit_release_reason,
              credit_released_at, cancel_reason, updated_at, updated_by) on sales_orders to app_user;
--> statement-breakpoint
grant select, insert on sales_order_lines, dealer_terms, dealer_outstanding to app_user;
--> statement-breakpoint
grant select on commission_accruals to app_user;
--> statement-breakpoint
grant select on sales_orders, sales_order_lines, dealer_terms, dealer_outstanding,
                commission_accruals to app_reader, readonly_reporter;
--> statement-breakpoint

-- Accepting a quote records how it was accepted and, for a signed copy, the file.
grant update (accepted_via, signed_file_id) on quotes to app_user;
--> statement-breakpoint

-- A quote's signed copy is read with its quote, as its PDF is (files_quote_pdf_read, 0111): the
-- general file rule lets a person below company scope read only the files they made, and the copy
-- is uploaded by whoever recorded the acceptance.
create policy files_signed_quote_read on files for select to app_user, app_reader using (
  purpose = 'signed_quote'
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from quotes q
               where q.signed_file_id = files.id
                 and q.entity_id = files.entity_id));
--> statement-breakpoint

-- Whether the caller may confirm the order: sales.order.confirm over its lead's owner and team,
-- or, for a dealer's order without a lead, over the dealer's relationship in the order's company.
-- The order must be of a company of the request. Called only by the definers below.
create or replace function app.may_confirm_order(p_order uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  return app.user_id() is not null and exists (
    select 1
      from public.sales_orders so
      left join public.opportunities o on o.id = so.opportunity_id
      left join public.account_entities ae
             on so.opportunity_id is null
            and ae.account_id = so.account_id
            and ae.entity_id = so.entity_id
     where so.id = p_order
       and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and case when so.opportunity_id is not null
                then app.scope_ok('sales.order.confirm', o.owner_id, o.team_id)
                else ae.account_id is not null
                     and app.scope_ok('sales.order.confirm', ae.owner_id, ae.team_id) end);
end
$$;
--> statement-breakpoint
revoke execute on function app.may_confirm_order(uuid) from public, readonly_reporter;
--> statement-breakpoint

-- A dealer's credit position in one company of the request (SAL-07, SALE-5): the newest terms
-- (limit and days, null when none was entered), the newest outstanding entry (the latest as-of
-- date, then the later entry of that day), and the total of the dealer's orders in that company
-- that are confirmed and not yet paid and whose confirmation date in IST is later than that
-- entry's as-of date (all of them when there is no entry), so an order is not counted twice once
-- Accounts' figure includes it; `p_exclude` leaves out the order being confirmed. Answered to a
-- holder of sales.credit.write in that company (`/dealer-credit`), or to a caller who may confirm
-- `p_exclude`, an order of that dealer and company (`sales.order.confirm`); figures only.
create or replace function app.dealer_credit_position(p_entity smallint, p_account uuid, p_exclude uuid)
  returns table (credit_limit numeric, credit_days integer, terms_at timestamptz,
                 outstanding numeric, oldest_overdue_days integer,
                 oldest_overdue_invoice_no text, as_of date, confirmed_unpaid numeric)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date;
begin
  if app.user_id() is null
     or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not app.has_perm('sales.credit.write:entity')
     and not (p_exclude is not null
              and exists (select 1 from public.sales_orders so
                           where so.id = p_exclude
                             and so.entity_id = p_entity
                             and so.account_id = p_account)
              and app.may_confirm_order(p_exclude)) then
    raise exception 'sales.credit.write or sales.order.confirm over the order is required'
      using errcode = '42501';
  end if;
  select d.as_of into v_as_of
    from public.dealer_outstanding d
   where d.account_id = p_account and d.entity_id = p_entity
   order by d.as_of desc, d.created_at desc
   limit 1;
  return query
    select t.credit_limit, t.credit_days, t.created_at,
           coalesce(d.outstanding, 0::numeric), d.oldest_overdue_days,
           d.oldest_overdue_invoice_no, d.as_of,
           (select coalesce(sum(so.grand_total), 0::numeric)
              from public.sales_orders so
             where so.entity_id = p_entity
               and so.account_id = p_account
               and so.state in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')
               and (p_exclude is null or so.id <> p_exclude)
               and (v_as_of is null
                    or (so.confirmed_at at time zone 'Asia/Kolkata')::date > v_as_of))
      from (select 1) one
      left join lateral (select dt.credit_limit, dt.credit_days, dt.created_at
                           from public.dealer_terms dt
                          where dt.account_id = p_account and dt.entity_id = p_entity
                          order by dt.created_at desc, dt.id desc
                          limit 1) t on true
      left join lateral (select x.outstanding, x.oldest_overdue_days,
                                x.oldest_overdue_invoice_no, x.as_of
                           from public.dealer_outstanding x
                          where x.account_id = p_account and x.entity_id = p_entity
                          order by x.as_of desc, x.created_at desc
                          limit 1) d on true;
end
$$;
--> statement-breakpoint
revoke execute on function app.dealer_credit_position(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.dealer_credit_position(smallint, uuid, uuid) to app_user, app_reader;
--> statement-breakpoint

-- The commission rule of a confirmed order of a lead credited to a referral partner (CRM-09):
-- the partner's own rule in force on the order's confirmation date in IST, else the group's
-- default (no partner), each live (not archived) and of the `order_confirmed` trigger. No row when
-- the order has no lead, the lead no partner, or no rule is in force: nothing is invented (CRM-5).
-- Answered only to a caller who may confirm the order; the rule's id, basis and amount only.
create or replace function app.order_commission_rule(p_order uuid)
  returns table (rule_id uuid, partner_id uuid, opportunity_id uuid, basis text, amount numeric)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.may_confirm_order(p_order) then
    raise exception 'sales.order.confirm over the order is required' using errcode = '42501';
  end if;
  return query
    select r.id, o.referral_partner_id, o.id, r.basis, r.amount
      from public.sales_orders so
      join public.opportunities o on o.id = so.opportunity_id
      join public.commission_rules r
        on (r.partner_id = o.referral_partner_id or r.partner_id is null)
       and r.archived_at is null
       and r.trigger = 'order_confirmed'
       and r.effective_from <= (so.confirmed_at at time zone 'Asia/Kolkata')::date
       and (r.effective_to is null
            or r.effective_to > (so.confirmed_at at time zone 'Asia/Kolkata')::date)
     where so.id = p_order
       and so.state = 'confirmed'
       and o.referral_partner_id is not null
     order by r.partner_id is null, r.effective_from desc
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.order_commission_rule(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_commission_rule(uuid) to app_user;
--> statement-breakpoint

-- Records the commission `app.order_commission_rule()` names for a confirmed order, worked out by
-- the domain (`commissionAmount()`): the rule must still be the one in force, and the amount must
-- be the rule's rate applied to the measure (the rate itself for a fixed commission, the order's
-- taxable value for a percentage, the lead's kW or HP otherwise), rounded to the paisa. Stamps the
-- caller; an order already accrued is left as it is. Answers the new accrual's id, or null.
create or replace function app.record_commission_accrual(p_id uuid, p_order uuid, p_rule uuid,
                                                         p_measure numeric, p_amount numeric)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rule record;
  v_entity smallint;
  v_subtotal numeric;
  v_id uuid;
begin
  if not app.may_confirm_order(p_order) then
    raise exception 'sales.order.confirm over the order is required' using errcode = '42501';
  end if;
  select * into v_rule from app.order_commission_rule(p_order);
  if v_rule.rule_id is null or v_rule.rule_id <> p_rule then
    raise exception 'the commission rule is not the one in force' using errcode = '23514';
  end if;
  select so.entity_id, so.subtotal into v_entity, v_subtotal
    from public.sales_orders so where so.id = p_order;
  if p_measure is null or p_measure < 0 or p_amount is null
     or (v_rule.basis = 'fixed' and (p_measure <> 1 or p_amount <> v_rule.amount))
     or (v_rule.basis = 'percent'
         and (p_measure <> v_subtotal or p_amount <> round(v_subtotal * v_rule.amount / 100, 2)))
     or (v_rule.basis in ('per_kw', 'per_hp')
         and (p_measure <= 0 or p_amount <> round(p_measure * v_rule.amount, 2))) then
    raise exception 'the commission does not follow its rule' using errcode = '23514';
  end if;
  insert into public.commission_accruals
         (id, entity_id, partner_id, opportunity_id, sales_order_id, commission_rule_id, basis,
          rate, measure, amount, created_by)
  values (p_id, v_entity, v_rule.partner_id, v_rule.opportunity_id, p_order,
          p_rule, v_rule.basis, v_rule.amount, p_measure, p_amount, app.user_id())
  on conflict (sales_order_id) do nothing
  returning id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_commission_accrual(uuid, uuid, uuid, numeric, numeric) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_commission_accrual(uuid, uuid, uuid, numeric, numeric) to app_user;
--> statement-breakpoint

-- Cancels the commission of a cancelled order of a lead (sales.order.cancel over the lead's owner
-- and team: the General Manager and the Executive), stamping the caller. Answers the accrual it
-- cancelled, or null when the order had none.
create or replace function app.cancel_commission_accrual(p_order uuid) returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if app.user_id() is null or not exists (
       select 1
         from public.sales_orders so
         join public.opportunities o on o.id = so.opportunity_id
        where so.id = p_order
          and so.state = 'cancelled'
          and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
          and app.scope_ok('sales.order.cancel', o.owner_id, o.team_id)) then
    raise exception 'sales.order.cancel over a cancelled order is required' using errcode = '42501';
  end if;
  update public.commission_accruals a
     set state = 'cancelled', cancelled_at = now(), cancelled_by = app.user_id()
   where a.sales_order_id = p_order and a.state = 'accrued'
  returning a.id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.cancel_commission_accrual(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.cancel_commission_accrual(uuid) to app_user;
