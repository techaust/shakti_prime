-- FN1 Proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §5, §6.1, questions
-- 3 (a) and 6 (a)): row security, grants, guards and definers.
-- A proforma, its lines and an order's payment milestones are read with finance.read over the
-- order: over its lead's owner and team, or, for a dealer's order without a lead, over the
-- dealer's relationship in the order's company (app.order_finance_readable()). No agent holds
-- finance.read.
-- A proforma is issued by a holder of finance.proforma.write in the order's company, from a
-- confirmed order, with the order's place of supply and totals; its lines are the order's lines
-- copied whole, in the transaction that issued it, and never changed. Afterwards a person changes
-- only its cancellation (column grants), once, in their own name; the number stays used.
-- A company's payment terms are read with finance.read and published, never changed, by a holder
-- of finance.payment.write for every company (the Executive).
-- An order's milestones are written only through app.record_order_milestones(), by the platform
-- (the platform-only finance.milestones.process) or by a holder of finance.payment.write in the
-- order's company, once per order, with amounts summing to its total. Afterwards a person changes
-- only a waiver, as the Executive (finance.payment.write:all), in their own name.
-- app.order_dispatch_payment_gate() answers D2's dispatch whether a before-dispatch milestone is
-- still open.

-- 1. finance.milestones.process is platform-only, like the other workers' grants: the nineteen keys
--    of 0222, kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire', 'finance.milestones.process']::text[]
$$;
--> statement-breakpoint

-- 2. Triggers: updated_at, and the rows nobody changes.
create trigger set_updated_at before update on proformas
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on payment_milestones
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger proforma_lines_append_only before update or delete on proforma_lines
  for each row execute function app.raise_append_only();
--> statement-breakpoint
create trigger payment_milestone_templates_append_only
  before update or delete on payment_milestone_templates
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 3. A request changes a proforma only by its cancel: once, from issued, in the name of the
--    person cancelling. The owner's own writes (a definer, the fixtures) are not a request.
create or replace function app.guard_proforma() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a proforma is never removed' using errcode = '42501';
  end if;
  if pg_catalog.current_user() = 'app_user'
     and (old.state <> 'issued' or new.state <> 'cancelled'
          or new.cancelled_by is distinct from app.user_id()
          or (pg_catalog.to_jsonb(new) - array['state', 'cancel_reason', 'cancelled_at',
                                               'cancelled_by', 'updated_at', 'updated_by'])
             is distinct from
             (pg_catalog.to_jsonb(old) - array['state', 'cancel_reason', 'cancelled_at',
                                               'cancelled_by', 'updated_at', 'updated_by'])) then
    raise exception 'a proforma changes only by its cancel, once' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_proforma() from public, readonly_reporter;
--> statement-breakpoint
create trigger proformas_guard before update or delete on proformas
  for each row execute function app.guard_proforma();
--> statement-breakpoint

-- 4. A request changes a milestone only by its waiver: once, from a state still waiting for
--    money, in the Executive's own name. The definers (and TC3's payments) run as the owner.
create or replace function app.guard_payment_milestone() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a payment milestone is never removed' using errcode = '42501';
  end if;
  if pg_catalog.current_user() = 'app_user'
     and (old.state not in ('pending', 'due', 'part_paid') or new.state <> 'waived'
          or new.waived_by is distinct from app.user_id()
          or (pg_catalog.to_jsonb(new) - array['state', 'waived_at', 'waived_by', 'waive_reason',
                                               'updated_at', 'updated_by'])
             is distinct from
             (pg_catalog.to_jsonb(old) - array['state', 'waived_at', 'waived_by', 'waive_reason',
                                               'updated_at', 'updated_by'])) then
    raise exception 'a payment milestone changes only by its waiver, once' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_payment_milestone() from public, readonly_reporter;
--> statement-breakpoint
create trigger payment_milestones_guard before update or delete on payment_milestones
  for each row execute function app.guard_payment_milestone();
--> statement-breakpoint

-- 5. Whether the caller reads an order's money with finance.read: over its lead's owner and team,
--    or, for a dealer's order without a lead, over the dealer's relationship in the order's
--    company, and only for an order of a company of the request. Past row security, so the read
--    policies below ask finance.read alone, and it answers only that.
create or replace function app.order_finance_readable(p_order uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select app.user_id() is not null and exists (
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
                then app.scope_ok('finance.read', o.owner_id, o.team_id)
                else ae.account_id is not null
                     and app.scope_ok('finance.read', ae.owner_id, ae.team_id) end)
$$;
--> statement-breakpoint
revoke execute on function app.order_finance_readable(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_finance_readable(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 6. Row security.
alter table proformas enable row level security;
--> statement-breakpoint
alter table proformas force row level security;
--> statement-breakpoint
alter table proforma_lines enable row level security;
--> statement-breakpoint
alter table proforma_lines force row level security;
--> statement-breakpoint
alter table payment_milestone_templates enable row level security;
--> statement-breakpoint
alter table payment_milestone_templates force row level security;
--> statement-breakpoint
alter table payment_milestones enable row level security;
--> statement-breakpoint
alter table payment_milestones force row level security;
--> statement-breakpoint

create policy proformas_read on proformas for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and app.order_finance_readable(sales_order_id));
--> statement-breakpoint
-- Issued from a confirmed order the caller reads, with the order's place of supply and totals.
create policy proformas_insert on proformas for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.proforma.write:entity'))
  and created_by = (select app.user_id())
  and state = 'issued'
  and pdf_file_id is null
  and cancel_reason is null
  and exists (select 1 from sales_orders so
               where so.id = proformas.sales_order_id
                 and so.entity_id = proformas.entity_id
                 and so.state in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')
                 and so.place_of_supply_state = proformas.place_of_supply_state
                 and so.supply_kind = proformas.supply_kind
                 and so.subtotal = proformas.subtotal
                 and so.cgst = proformas.cgst
                 and so.sgst = proformas.sgst
                 and so.igst = proformas.igst
                 and so.tax_total = proformas.tax_total
                 and so.round_off = proformas.round_off
                 and so.grand_total = proformas.grand_total));
--> statement-breakpoint
create policy proformas_update on proformas for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('finance.proforma.write:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('finance.proforma.write:entity'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint

create policy proforma_lines_read on proforma_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from proformas p where p.id = proforma_lines.proforma_id));
--> statement-breakpoint
-- Written with its proforma, in the same transaction, by its issuer, as the order's line stands:
-- every value the line was priced and taxed with is the order line's.
create policy proforma_lines_insert on proforma_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (
    select 1 from proformas p
      join sales_order_lines l on l.sales_order_id = p.sales_order_id
     where p.id = proforma_lines.proforma_id
       and p.entity_id = proforma_lines.entity_id
       and p.state = 'issued'
       and p.created_by = (select app.user_id())
       and p.created_at = now()
       and l.id = proforma_lines.sales_order_line_id
       and (l.position, l.item_id, l.kit_id, l.sku, l.description, l.unit, l.qty, l.unit_price,
            l.hsn, l.works_contract, l.tax_rate_id, l.tax_rate_pct, l.composite_rule_id,
            l.goods_rate_pct, l.services_rate_pct, l.taxable_value, l.goods_taxable,
            l.services_taxable, l.cgst, l.sgst, l.igst, l.line_total)
           is not distinct from
           (proforma_lines.position, proforma_lines.item_id, proforma_lines.kit_id,
            proforma_lines.sku, proforma_lines.description, proforma_lines.unit,
            proforma_lines.qty, proforma_lines.unit_price, proforma_lines.hsn,
            proforma_lines.works_contract, proforma_lines.tax_rate_id,
            proforma_lines.tax_rate_pct, proforma_lines.composite_rule_id,
            proforma_lines.goods_rate_pct, proforma_lines.services_rate_pct,
            proforma_lines.taxable_value, proforma_lines.goods_taxable,
            proforma_lines.services_taxable, proforma_lines.cgst, proforma_lines.sgst,
            proforma_lines.igst, proforma_lines.line_total)));
--> statement-breakpoint

create policy payment_milestone_templates_read on payment_milestone_templates
  for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.read:own')));
--> statement-breakpoint
create policy payment_milestone_templates_insert on payment_milestone_templates
  for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.payment.write:all'))
  and created_by = (select app.user_id()));
--> statement-breakpoint

create policy payment_milestones_read on payment_milestones for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and app.order_finance_readable(sales_order_id));
--> statement-breakpoint
create policy payment_milestones_waive on payment_milestones for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('finance.payment.write:all')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('finance.payment.write:all'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint

-- 7. Grants.
revoke all on proformas, proforma_lines, payment_milestone_templates, payment_milestones
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on proformas, proforma_lines, payment_milestone_templates to app_user;
--> statement-breakpoint
grant update (state, cancel_reason, cancelled_at, cancelled_by, updated_at, updated_by)
  on proformas to app_user;
--> statement-breakpoint
grant select on payment_milestones to app_user;
--> statement-breakpoint
grant update (state, waived_at, waived_by, waive_reason, updated_at, updated_by)
  on payment_milestones to app_user;
--> statement-breakpoint
grant select on proformas, proforma_lines, payment_milestone_templates, payment_milestones
  to app_reader, readonly_reporter;
--> statement-breakpoint

-- 8. An order's loan gate (J2, docs/03-roadmap-appendix/phase4.md §6.2). Until J2's
--    app.order_loan_gate() is in the database, a stand-in of the same shape answers that the order
--    has no loan, so nothing waits for one; it is made only where J2's is absent, so it never
--    replaces it. It answers the callers J2's does, and the platform planning milestones.
do $do$
begin
  if pg_catalog.to_regprocedure('app.order_loan_gate(uuid)') is null then
    create function app.order_loan_gate(p_order uuid) returns jsonb
      language plpgsql stable security definer set search_path = '' as $fn$
    begin
      if not (app.has_perm('inventory.dispatch.write:entity')
              or app.has_perm('finance.payment.write:entity')
              or app.has_perm('finance.milestones.process:all')
              or app.has_perm('crm.account.read:own')
              or app.has_perm('crm.lead.read:own')) then
        raise exception 'a loan gate is read with inventory.dispatch.write, finance.payment.write or crm.account.read'
          using errcode = '42501';
      end if;
      if not exists (select 1 from public.sales_orders so
                      where so.id = p_order
                        and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
        return null;
      end if;
      return pg_catalog.jsonb_build_object(
        'loanId', null, 'loanState', null, 'dispatch', 'none', 'waived', false, 'reason', null);
    end
    $fn$;
    revoke execute on function app.order_loan_gate(uuid) from public, readonly_reporter;
    grant execute on function app.order_loan_gate(uuid) to app_user, app_reader;
  end if;
end
$do$;
--> statement-breakpoint

-- 9. What planning an order's milestones starts from: the order's company, state, total, segment
--    (its lead's pipeline's, or dealer_wholesale for a dealer's order without a lead) and
--    confirmation day (IST), whether it already has milestones, and the company's current terms
--    for that segment. For the platform (finance.milestones.process) or a holder of
--    finance.payment.write in the order's company; null for an order outside the request.
create or replace function app.order_milestone_facts(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_order record;
  v_template record;
begin
  if app.user_id() is null
     or not (app.has_perm('finance.milestones.process:all')
             or app.has_perm('finance.payment.write:entity')) then
    raise exception 'finance.milestones.process or finance.payment.write is required'
      using errcode = '42501';
  end if;
  select so.id, so.entity_id, so.state, so.grand_total, so.confirmed_at,
         coalesce(p.segment, 'dealer_wholesale') as segment
    into v_order
    from public.sales_orders so
    left join public.opportunities o on o.id = so.opportunity_id
    left join public.pipelines p on p.id = o.pipeline_id
   where so.id = p_order and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if not found then
    return null;
  end if;
  select t.id, t.version, t.steps_json into v_template
    from public.payment_milestone_templates t
   where t.entity_id = v_order.entity_id and t.segment = v_order.segment
   order by t.version desc
   limit 1;
  return pg_catalog.jsonb_build_object(
    'orderId', v_order.id,
    'entityId', v_order.entity_id,
    'state', v_order.state,
    'grandTotal', v_order.grand_total::numeric(14, 2)::text,
    'segment', v_order.segment,
    'confirmedOn', (v_order.confirmed_at at time zone 'Asia/Kolkata')::date::text,
    'planned', exists (select 1 from public.payment_milestones m
                        where m.sales_order_id = v_order.id),
    'template', case when v_template.id is null then null
                     else pg_catalog.jsonb_build_object('id', v_template.id,
                                                        'version', v_template.version,
                                                        'steps', v_template.steps_json) end);
end
$$;
--> statement-breakpoint
revoke execute on function app.order_milestone_facts(uuid) from public, readonly_reporter;
--> statement-breakpoint

-- 10. Records an order's milestones, once: for a confirmed order of the request, from the
--     company's current terms for its segment (or the named default where it has none, p_template
--     null), each row the step it came from, the amounts summing to the order's total, and each
--     row pending or due. Answers how many it wrote. The split itself is the domain's
--     (`planMilestones()`); this checks what it may not get wrong.
create or replace function app.record_order_milestones(p_order uuid, p_template uuid, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_facts jsonb := app.order_milestone_facts(p_order);
  v_steps jsonb;
  v_sum numeric(14, 2);
  v_count integer;
begin
  if v_facts is null then
    raise exception 'the order is not one of the request' using errcode = '42501';
  end if;
  if v_facts ->> 'state' not in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced') then
    raise exception 'milestones are planned for a confirmed order' using errcode = 'check_violation';
  end if;
  if (v_facts -> 'template' ->> 'id') is distinct from p_template::text then
    raise exception 'milestones are planned from the current terms' using errcode = 'check_violation';
  end if;
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_rows) not between 1 and 10 then
    raise exception 'one to ten milestones' using errcode = 'check_violation';
  end if;
  v_steps := v_facts -> 'template' -> 'steps';
  -- Each row is its step of the terms, in order: key, label, share, due rule and loan gate.
  if v_steps is not null and exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_rows) with ordinality r(v, i)
         full join pg_catalog.jsonb_array_elements(v_steps) with ordinality s(v, i) using (i)
        where r.v is null or s.v is null
           or (r.v ->> 'key') is distinct from (s.v ->> 'key')
           or (r.v ->> 'label') is distinct from (s.v ->> 'label')
           or (r.v ->> 'percent')::numeric is distinct from (s.v ->> 'percent')::numeric
           or (s.v ->> 'amount' is not null
               and (r.v ->> 'amount')::numeric is distinct from (s.v ->> 'amount')::numeric)
           or (r.v ->> 'dueRule') is distinct from (s.v ->> 'dueRule')
           or (r.v ->> 'dueDays')::int is distinct from (s.v ->> 'dueDays')::int
           or (r.v ->> 'loanGate') is distinct from (s.v ->> 'loanGate')) then
    raise exception 'milestones are planned from the current terms' using errcode = 'check_violation';
  end if;
  select coalesce(sum((r.v ->> 'amount')::numeric(14, 2)), 0) into v_sum
    from pg_catalog.jsonb_array_elements(p_rows) r(v);
  if v_sum <> (v_facts ->> 'grandTotal')::numeric(14, 2) then
    raise exception 'the milestones add up to the order total' using errcode = 'check_violation';
  end if;
  insert into public.payment_milestones
    (id, entity_id, sales_order_id, template_id, seq, key, label, percent, amount, due_rule,
     due_days, loan_gate, state, due_on, created_by)
  select (r.v ->> 'id')::uuid, (v_facts ->> 'entityId')::smallint, p_order, p_template,
         r.i::smallint, r.v ->> 'key', r.v ->> 'label', (r.v ->> 'percent')::numeric(5, 2),
         (r.v ->> 'amount')::numeric(14, 2), r.v ->> 'dueRule', (r.v ->> 'dueDays')::smallint,
         r.v ->> 'loanGate', r.v ->> 'state', (r.v ->> 'dueOn')::date, app.user_id()
    from pg_catalog.jsonb_array_elements(p_rows) with ordinality r(v, i)
   where r.v ->> 'state' in ('pending', 'due');
  get diagnostics v_count = row_count;
  if v_count <> pg_catalog.jsonb_array_length(p_rows) then
    raise exception 'a milestone is planned pending or due' using errcode = 'check_violation';
  end if;
  return v_count;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_order_milestones(uuid, uuid, jsonb) from public, readonly_reporter;
--> statement-breakpoint

-- 11. Whether an order's payments let it leave on dispatch (D2's depart guard): `open` while a
--     before-dispatch milestone is neither paid nor waived, `clear` otherwise (no milestones, or
--     all settled). For a holder of inventory.dispatch.write in the order's company, or a reader
--     of the order's money (finance.read); null for any other order.
create or replace function app.order_dispatch_payment_gate(p_order uuid) returns text
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_perm('inventory.dispatch.write:entity') or app.has_perm('finance.read:own')) then
    raise exception 'inventory.dispatch.write or finance.read is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sales_orders so
                  where so.id = p_order
                    and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not (app.has_perm('inventory.dispatch.write:entity') or app.order_finance_readable(p_order)) then
    return null;
  end if;
  return case when exists (select 1 from public.payment_milestones m
                            where m.sales_order_id = p_order
                              and m.due_rule = 'before_dispatch'
                              and m.state in ('pending', 'due', 'part_paid'))
              then 'open' else 'clear' end;
end
$$;
--> statement-breakpoint
revoke execute on function app.order_dispatch_payment_gate(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_dispatch_payment_gate(uuid) to app_user, app_reader;
