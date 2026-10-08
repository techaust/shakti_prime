-- Orders, acceptance and dealer credit (docs/03-roadmap-appendix/phase1.md §8.3, docs/05-database.md §6.4).
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
-- Dealer terms and outstanding stay append-only, with one exception: a customer merge, and its
-- undo, move a dealer's entries to the other customer, as they do the timeline
-- (app.activities_append_only(), 0113). Only the merge definers set app.customer_merge, only the
-- table owner may update these tables at all (no request role holds update on them), and then
-- only the customer the row names may change.
create or replace function app.dealer_credit_append_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(pg_catalog.current_setting('app.customer_merge', true), '') <> ''
     and pg_catalog.to_jsonb(new) - 'account_id' = pg_catalog.to_jsonb(old) - 'account_id' then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
revoke execute on function app.dealer_credit_append_only() from public, readonly_reporter;
--> statement-breakpoint
create trigger dealer_terms_append_only before update or delete on dealer_terms
  for each row execute function app.dealer_credit_append_only();
--> statement-breakpoint
create trigger dealer_outstanding_append_only before update or delete on dealer_outstanding
  for each row execute function app.dealer_credit_append_only();
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
revoke execute on function app.may_confirm_order(uuid) from public, app_user, readonly_reporter;
--> statement-breakpoint

-- A dealer's credit position in one company of the request (SAL-07, SALE-5): the newest terms
-- (limit and days, null when none was entered), the newest outstanding entry (the latest as-of
-- date, then the later entry of that day) with the date and number of the oldest unpaid invoice
-- Accounts named (the domain works out its age on the day of the check), and the total of the
-- dealer's orders in that company that are confirmed and not yet paid and not in that entry's
-- figure (all of them when there is no entry): those confirmed after the entry was made, or on a
-- day after its as-of date in IST. An order confirmed on the entry's own day, after Accounts
-- entered it, counts, so the figure is never counted twice yet a same-day order is never missed;
-- `p_exclude` leaves out the order being confirmed. Answered to a holder of sales.credit.write in
-- that company (`/dealer-credit`), or to a caller who may confirm `p_exclude`, an order of that
-- dealer and company (`sales.order.confirm`); figures only.
create or replace function app.dealer_credit_position(p_entity smallint, p_account uuid, p_exclude uuid)
  returns table (credit_limit numeric, credit_days integer, terms_at timestamptz,
                 outstanding numeric, oldest_unpaid_invoice_date date,
                 oldest_unpaid_invoice_no text, as_of date, confirmed_unpaid numeric)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date;
  v_entered timestamptz;
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
  select d.as_of, d.created_at into v_as_of, v_entered
    from public.dealer_outstanding d
   where d.account_id = p_account and d.entity_id = p_entity
   order by d.as_of desc, d.created_at desc
   limit 1;
  return query
    select t.credit_limit, t.credit_days, t.created_at,
           coalesce(d.outstanding, 0::numeric), d.oldest_unpaid_invoice_date,
           d.oldest_unpaid_invoice_no, d.as_of,
           (select coalesce(sum(so.grand_total), 0::numeric)
              from public.sales_orders so
             where so.entity_id = p_entity
               and so.account_id = p_account
               and so.state in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')
               and (p_exclude is null or so.id <> p_exclude)
               and (v_as_of is null
                    or so.confirmed_at > v_entered
                    or (so.confirmed_at at time zone 'Asia/Kolkata')::date > v_as_of))
      from (select 1) one
      left join lateral (select dt.credit_limit, dt.credit_days, dt.created_at
                           from public.dealer_terms dt
                          where dt.account_id = p_account and dt.entity_id = p_entity
                          order by dt.created_at desc, dt.id desc
                          limit 1) t on true
      left join lateral (select x.outstanding, x.oldest_unpaid_invoice_date,
                                x.oldest_unpaid_invoice_no, x.as_of
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
-- taxable value for a percentage, the lead's kW or HP otherwise, which the definer reads from the
-- lead's newest sizing by a person: the pump's array kWp or standard HP, the rooftop's recommended
-- kWp; the caller's measure must equal it to three decimals), rounded to the paisa. Stamps the
-- caller; an order already accrued is left as it is. Answers the new accrual's id, or null.
create or replace function app.record_commission_accrual(p_id uuid, p_order uuid, p_rule uuid,
                                                         p_measure numeric, p_amount numeric)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rule record;
  v_entity smallint;
  v_subtotal numeric;
  v_sized numeric;
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
  if v_rule.basis in ('per_kw', 'per_hp') then
    select case when z.kind = 'pump' and v_rule.basis = 'per_kw'
                then (z.result_json #>> '{solar,arrayKwp}')::numeric
                when z.kind = 'pump' then (z.result_json #>> '{power,standardHp}')::numeric
                when v_rule.basis = 'per_kw' then (z.result_json #>> '{rooftop,recommendedKwp}')::numeric
                else null end
      into v_sized
      from public.sizings z
      join public.principals pr on pr.id = z.created_by and pr.kind = 'user'
     where z.opportunity_id = v_rule.opportunity_id and z.entity_id = v_entity
     order by z.created_at desc, z.id desc
     limit 1;
    if v_sized is null or p_measure is distinct from round(v_sized, 3) then
      raise exception 'the commission measure is not the lead''s size' using errcode = '23514';
    end if;
  end if;
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
--> statement-breakpoint

-- Customer merges know the dealer tables of this slice: app.merge_customers() and
-- app.unmerge_customers() as 0113 defines them, with a dealer's own orders, terms and outstanding
-- moved to the kept customer (and back on an undo) and recorded in customer_merges.moved_json
-- (orders, dealerTerms, dealerOutstanding).
create or replace function app.merge_customers(
  p_merge uuid, p_kept uuid, p_merged uuid, p_entity smallint, p_candidate uuid
)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_found integer;
  v_sites jsonb;
  v_relationships jsonb;
  v_contacts jsonb;
  v_consents jsonb;
  v_leads jsonb;
  v_tasks jsonb;
  v_tags jsonb;
  v_activities jsonb;
  v_orders jsonb;
  v_terms jsonb;
  v_outstanding jsonb;
  v_moved jsonb;
begin
  if v_actor is null or not app.request_is_person()
     or not app.has_perm('crm.lead.merge:team') or not app.has_perm('crm.account.write:own') then
    raise exception 'a person holding crm.lead.merge is required' using errcode = '42501';
  end if;
  if not (p_entity = any (v_entities)) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_kept = p_merged then
    return jsonb_build_object('status', 'missing');
  end if;
  -- Both customers, live, locked in id order so two merges of one pair cannot cross.
  select count(*) into v_found
    from (select 1 from public.accounts a
           where a.id in (p_kept, p_merged) and a.archived_at is null
           order by a.id
             for update) locked;
  if v_found <> 2
     or not exists (select 1 from public.account_entities ae
                     where ae.account_id in (p_kept, p_merged) and ae.entity_id = p_entity)
     or not exists (select 1 from public.account_entities ae where ae.account_id = p_kept)
     or not exists (select 1 from public.account_entities ae where ae.account_id = p_merged) then
    return jsonb_build_object('status', 'missing');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (p_kept, p_merged) and not (ae.entity_id = any (v_entities)))
     or exists (select 1 from public.opportunities o
                 where o.account_id = p_merged and not (o.entity_id = any (v_entities))) then
    return jsonb_build_object('status', 'other_company');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (p_kept, p_merged)
                and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
     or exists (select 1 from public.opportunities o
                 where o.account_id = p_merged
                   and not app.scope_ok('crm.lead.write', o.owner_id, o.team_id)) then
    return jsonb_build_object('status', 'held_by_other');
  end if;
  if exists (select 1 from public.referral_partners rp where rp.account_id = p_merged) then
    return jsonb_build_object('status', 'partner');
  end if;

  with moved as (
    update public.customer_sites cs
       set account_id = p_kept, updated_by = v_actor
     where cs.account_id = p_merged
    returning cs.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_sites from moved;

  with moved as (
    update public.account_entities ae
       set account_id = p_kept, updated_by = v_actor
     where ae.account_id = p_merged
       and not exists (select 1 from public.account_entities k
                        where k.account_id = p_kept and k.entity_id = ae.entity_id)
    returning ae.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_relationships from moved;

  with before as (
    select ac.contact_id, ac.role
      from public.account_contacts ac
     where ac.account_id = p_merged
       and not exists (select 1 from public.account_contacts k
                        where k.account_id = p_kept and k.contact_id = ac.contact_id)),
  moved as (
    update public.account_contacts ac
       set account_id = p_kept,
           role = case when ac.role = 'owner' then 'other' else ac.role end,
           updated_by = v_actor
      from before b
     where ac.account_id = p_merged and ac.contact_id = b.contact_id
    returning ac.contact_id, b.role)
  select coalesce(jsonb_agg(jsonb_build_object('id', moved.contact_id, 'role', moved.role)
                            order by moved.contact_id), '[]'::jsonb)
    into v_contacts from moved;

  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_consents
    from public.consents c
   where c.contact_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_contacts) x);

  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_tasks
    from public.tasks t where t.account_id = p_merged;
  select coalesce(jsonb_agg(jsonb_build_object('opportunityId', ot.opportunity_id,
                                               'tagId', ot.tag_id)), '[]'::jsonb)
    into v_tags
    from public.opportunity_tags ot where ot.account_id = p_merged;

  with moved as (
    update public.opportunities o
       set account_id = p_kept, updated_by = v_actor
     where o.account_id = p_merged
    returning o.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_leads from moved;

  perform pg_catalog.set_config('app.customer_merge', p_merge::text, true);
  with moved as (
    update public.activities a
       set account_id = p_kept
     where a.account_id = p_merged
    returning a.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_activities from moved;

  -- A dealer's own orders (those without a lead) follow the customer; an order of a lead moved
  -- with the lead (ON UPDATE CASCADE). The dealer's terms and outstanding entries of a company
  -- move when the kept customer has none of its own there; where it has, its own stay the current
  -- ones (the merged entries would otherwise override them by date, or count one debt twice) and
  -- the merged customer's stay on it, kept as history.
  with moved as (
    update public.sales_orders so
       set account_id = p_kept, updated_by = v_actor
     where so.account_id = p_merged and so.opportunity_id is null
    returning so.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_orders from moved;
  with moved as (
    update public.dealer_terms dt
       set account_id = p_kept
     where dt.account_id = p_merged
       and not exists (select 1 from public.dealer_terms k
                        where k.account_id = p_kept and k.entity_id = dt.entity_id)
    returning dt.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_terms from moved;
  with moved as (
    update public.dealer_outstanding d
       set account_id = p_kept
     where d.account_id = p_merged
       and not exists (select 1 from public.dealer_outstanding k
                        where k.account_id = p_kept and k.entity_id = d.entity_id)
    returning d.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_outstanding from moved;
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.accounts
     set archived_at = pg_catalog.now(), updated_by = v_actor
   where id = p_merged;

  v_moved := jsonb_build_object(
    'contacts', v_contacts, 'sites', v_sites, 'relationships', v_relationships,
    'leads', v_leads, 'tasks', v_tasks, 'tags', v_tags, 'consents', v_consents,
    'activities', v_activities, 'orders', v_orders, 'dealerTerms', v_terms,
    'dealerOutstanding', v_outstanding);
  insert into public.customer_merges
    (id, entity_id, kept_account_id, merged_account_id, candidate_id, moved_json, created_by)
  values (p_merge, p_entity, p_kept, p_merged, p_candidate, v_moved, v_actor);
  return jsonb_build_object('status', 'merged', 'moved', v_moved);
end
$$;
--> statement-breakpoint
revoke execute on function app.merge_customers(uuid, uuid, uuid, smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.merge_customers(uuid, uuid, uuid, smallint, uuid) to app_user;
--> statement-breakpoint
create or replace function app.unmerge_customers(p_merge uuid)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  m public.customer_merges%rowtype;
  v_leads uuid[];
  rel record;
  v_relationships jsonb := '[]'::jsonb;
  v_sites jsonb;
  v_back_leads jsonb;
  v_contacts jsonb;
  v_consents jsonb;
  v_tasks jsonb;
  v_tags jsonb;
  v_activities jsonb;
  v_orders jsonb;
  v_terms jsonb;
  v_outstanding jsonb;
begin
  if v_actor is null or not app.request_is_person()
     or not app.has_perm('crm.lead.merge:team') or not app.has_perm('crm.account.write:own') then
    raise exception 'a person holding crm.lead.merge is required' using errcode = '42501';
  end if;
  select * into m from public.customer_merges cm where cm.id = p_merge for update;
  if not found or not (m.entity_id = any (v_entities)) then
    return jsonb_build_object('status', 'missing');
  end if;
  if m.undone_at is not null then
    return jsonb_build_object('status', 'undone_already');
  end if;
  perform 1 from public.accounts a
   where a.id in (m.kept_account_id, m.merged_account_id)
   order by a.id
     for update;
  if exists (select 1 from public.accounts a
              where a.id = m.kept_account_id and a.archived_at is not null) then
    return jsonb_build_object('status', 'kept_merged');
  end if;
  select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_leads
    from jsonb_array_elements_text(m.moved_json -> 'leads') x;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (m.kept_account_id, m.merged_account_id)
                and not (ae.entity_id = any (v_entities)))
     or exists (select 1 from public.opportunities o
                 where o.id = any (v_leads) and not (o.entity_id = any (v_entities))) then
    return jsonb_build_object('status', 'other_company');
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id in (m.kept_account_id, m.merged_account_id)
                and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
     or exists (select 1 from public.opportunities o
                 where o.id = any (v_leads)
                   and not app.scope_ok('crm.lead.write', o.owner_id, o.team_id)) then
    return jsonb_build_object('status', 'held_by_other');
  end if;

  update public.accounts
     set archived_at = null, updated_by = v_actor
   where id = m.merged_account_id;

  for rel in
    select ae.id, ae.entity_id, ae.owner_id, ae.team_id
      from public.account_entities ae
     where ae.account_id = m.kept_account_id
       and ae.id in (select x::uuid
                       from jsonb_array_elements_text(m.moved_json -> 'relationships') x)
  loop
    if exists (select 1 from public.opportunities o
                where o.account_id = m.kept_account_id and o.entity_id = rel.entity_id
                  and not (o.id = any (v_leads))) then
      insert into public.account_entities
        (id, account_id, entity_id, owner_id, team_id, created_by)
      values (app.uuid_v7(), m.merged_account_id, rel.entity_id, rel.owner_id, rel.team_id,
              v_actor)
      on conflict do nothing;
    else
      update public.account_entities
         set account_id = m.merged_account_id, updated_by = v_actor
       where id = rel.id;
    end if;
    v_relationships := v_relationships || jsonb_build_array(rel.id);
  end loop;

  with moved as (
    update public.customer_sites
       set account_id = m.merged_account_id, updated_by = v_actor
     where account_id = m.kept_account_id
       and id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'sites') x)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_sites from moved;

  with moved as (
    update public.opportunities
       set account_id = m.merged_account_id, updated_by = v_actor
     where account_id = m.kept_account_id and id = any (v_leads)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_back_leads from moved;

  with moved as (
    update public.account_contacts ac
       set account_id = m.merged_account_id, role = c.role, updated_by = v_actor
      from (select (x ->> 'id')::uuid as contact_id, x ->> 'role' as role
              from jsonb_array_elements(m.moved_json -> 'contacts') x) c
     where ac.account_id = m.kept_account_id and ac.contact_id = c.contact_id
    returning ac.contact_id, c.role)
  select coalesce(jsonb_agg(jsonb_build_object('id', moved.contact_id, 'role', moved.role)
                            order by moved.contact_id), '[]'::jsonb)
    into v_contacts from moved;

  -- What went back with the leads (tasks and tags, ON UPDATE CASCADE) and the contacts (consents).
  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_tasks
    from public.tasks t
   where t.account_id = m.merged_account_id
     and t.id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'tasks') x);
  select coalesce(jsonb_agg(jsonb_build_object('opportunityId', ot.opportunity_id,
                                               'tagId', ot.tag_id)), '[]'::jsonb)
    into v_tags
    from public.opportunity_tags ot
   where ot.account_id = m.merged_account_id
     and exists (select 1 from jsonb_array_elements(m.moved_json -> 'tags') x
                  where (x ->> 'opportunityId')::uuid = ot.opportunity_id
                    and (x ->> 'tagId')::uuid = ot.tag_id);
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_consents
    from public.consents c
   where c.contact_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_contacts) x)
     and c.id in (select x::uuid from jsonb_array_elements_text(m.moved_json -> 'consents') x);

  perform pg_catalog.set_config('app.customer_merge', p_merge::text, true);
  with moved as (
    update public.activities
       set account_id = m.merged_account_id
     where account_id = m.kept_account_id
       and id in (select x::uuid
                    from jsonb_array_elements_text(m.moved_json -> 'activities') x)
    returning id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_activities from moved;

  -- What a merge moved of the dealer's own orders, terms and outstanding goes back too.
  with moved as (
    update public.sales_orders so
       set account_id = m.merged_account_id, updated_by = v_actor
     where so.account_id = m.kept_account_id and so.opportunity_id is null
       and so.id in (select x::uuid
                       from jsonb_array_elements_text(coalesce(m.moved_json -> 'orders', '[]'::jsonb)) x)
    returning so.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_orders from moved;
  with moved as (
    update public.dealer_terms dt
       set account_id = m.merged_account_id
     where dt.account_id = m.kept_account_id
       and dt.id in (select x::uuid
                       from jsonb_array_elements_text(coalesce(m.moved_json -> 'dealerTerms', '[]'::jsonb)) x)
    returning dt.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb) into v_terms from moved;
  with moved as (
    update public.dealer_outstanding d
       set account_id = m.merged_account_id
     where d.account_id = m.kept_account_id
       and d.id in (select x::uuid
                      from jsonb_array_elements_text(coalesce(m.moved_json -> 'dealerOutstanding', '[]'::jsonb)) x)
    returning d.id)
  select coalesce(jsonb_agg(moved.id order by moved.id), '[]'::jsonb)
    into v_outstanding from moved;
  perform pg_catalog.set_config('app.customer_merge', '', true);

  update public.customer_merges
     set undone_at = pg_catalog.now(), undone_by = v_actor, updated_by = v_actor
   where id = m.id;
  return jsonb_build_object(
    'status', 'undone', 'keptAccountId', m.kept_account_id,
    'mergedAccountId', m.merged_account_id, 'candidateId', m.candidate_id,
    'entityId', m.entity_id,
    'moved', jsonb_build_object(
      'contacts', v_contacts, 'sites', v_sites, 'relationships', v_relationships,
      'leads', v_back_leads, 'tasks', v_tasks, 'tags', v_tags, 'consents', v_consents,
      'activities', v_activities, 'orders', v_orders, 'dealerTerms', v_terms,
      'dealerOutstanding', v_outstanding));
end
$$;
--> statement-breakpoint
revoke execute on function app.unmerge_customers(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.unmerge_customers(uuid) to app_user;
