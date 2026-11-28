-- FN1 fix round (the review of 27-11-2026): an order whose payments the platform could not plan
-- records why and tells Accounts (finding 3); the dispatch's payment gate holds such an order, and
-- one whose terms hold anything before dispatch, until its payments are planned; a held
-- milestone falls due when its loan reaches the state it waits for (finding 4); a cancelled
-- proforma's PDF is printed again with "Cancelled" across it (finding 5); a cancelled order's
-- live proforma and open payments are cancelled with it (finding 6).

-- 1. The record of the order's plan: written once the plan succeeds (cleared) and here, when the
--    platform's plan failed, by the platform alone (finance.milestones.process), for a confirmed
--    order of the request that has no payments.
create or replace function app.record_order_milestone_failure(p_order uuid, p_reason text)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_done uuid;
begin
  if app.user_id() is null or not app.has_perm('finance.milestones.process:all') then
    raise exception 'finance.milestones.process is required' using errcode = '42501';
  end if;
  if p_reason not in ('milestone_amounts_exceed_total', 'forbidden') then
    raise exception 'an unknown reason' using errcode = 'check_violation';
  end if;
  update public.sales_orders so
     set payment_plan_failure = p_reason,
         payment_plan_failed_at = now()
   where so.id = p_order
     and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and so.state in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')
     and not exists (select 1 from public.payment_milestones m where m.sales_order_id = so.id)
  returning so.id into v_done;
  return v_done is not null;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_order_milestone_failure(uuid, text) from public, readonly_reporter;
--> statement-breakpoint

-- 2. Recording the order's milestones clears a failure recorded before (otherwise as 0261 §10).
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
  -- A plan that failed before is no longer the order's state.
  update public.sales_orders so
     set payment_plan_failure = null, payment_plan_failed_at = null
   where so.id = p_order and so.payment_plan_failure is not null;
  return v_count;
end
$$;
--> statement-breakpoint

-- 3. The dispatch's payment gate: `open` while a before-dispatch milestone is neither paid nor
--    waived, and, for a confirmed order with no payments planned, while its plan failed or its
--    terms would hold a payment before dispatch (its company's current terms for its segment, or
--    the standard terms, which hold the balance before dispatch, where it has none); `clear`
--    otherwise, and for a cancelled order. Callers as 0261 §11.
create or replace function app.order_dispatch_payment_gate(p_order uuid) returns text
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_order record;
  v_steps jsonb;
begin
  if not (app.has_perm('inventory.dispatch.write:entity') or app.has_perm('finance.read:own')) then
    raise exception 'inventory.dispatch.write or finance.read is required' using errcode = '42501';
  end if;
  select so.id, so.entity_id, so.state, so.payment_plan_failure,
         coalesce(p.segment, 'dealer_wholesale') as segment
    into v_order
    from public.sales_orders so
    left join public.opportunities o on o.id = so.opportunity_id
    left join public.pipelines p on p.id = o.pipeline_id
   where so.id = p_order and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if not found
     or not (app.has_perm('inventory.dispatch.write:entity') or app.order_finance_readable(p_order)) then
    return null;
  end if;
  if exists (select 1 from public.payment_milestones m
              where m.sales_order_id = p_order
                and m.due_rule = 'before_dispatch'
                and m.state in ('pending', 'due', 'part_paid')) then
    return 'open';
  end if;
  if v_order.state not in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced')
     or exists (select 1 from public.payment_milestones m where m.sales_order_id = p_order) then
    return 'clear';
  end if;
  if v_order.payment_plan_failure is not null then
    return 'open';
  end if;
  select t.steps_json into v_steps
    from public.payment_milestone_templates t
   where t.entity_id = v_order.entity_id and t.segment = v_order.segment
   order by t.version desc
   limit 1;
  if v_steps is null
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_steps) s(v)
                 where s.v ->> 'dueRule' = 'before_dispatch') then
    return 'open';
  end if;
  return 'clear';
end
$$;
--> statement-breakpoint
revoke execute on function app.order_dispatch_payment_gate(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_dispatch_payment_gate(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. Who is told that an order's payments could not be planned: the people with
--    finance.payment.write for the order's company (Accounts, the Executive), active there, while
--    the failure stands. For the notify worker (notifications.send) alone.
create or replace function app.notice_finance_people(p_entity smallint, p_order uuid)
  returns table (user_id uuid, account_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select distinct uer.user_id, so.account_id
      from public.sales_orders so
      join public.user_entity_roles uer on uer.entity_id = so.entity_id
      join public.role_permissions rp on rp.role_id = uer.role_id
     where so.id = p_order
       and so.entity_id = p_entity
       and so.payment_plan_failure is not null
       and rp.permission_key = 'finance.payment.write'
       and rp.scope in ('entity', 'all')
       and app.notice_recipient_ok(uer.user_id, p_entity)
     order by uer.user_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_finance_people(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_finance_people(smallint, uuid) to app_user;
--> statement-breakpoint

-- 5. A cancelled order's money, for the platform (finance.milestones.process): its live proforma
--    is cancelled with the order's own reason, in the platform's name, and its payments still
--    waiting for money are cancelled. Answers the proforma cancelled (null when none was live)
--    and how many payments were cancelled; a second call finds nothing.
create or replace function app.cancel_order_finance(p_order uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reason text;
  v_entity smallint;
  v_proforma uuid;
  v_count integer;
begin
  if app.user_id() is null or not app.has_perm('finance.milestones.process:all') then
    raise exception 'finance.milestones.process is required' using errcode = '42501';
  end if;
  select so.cancel_reason, so.entity_id into v_reason, v_entity
    from public.sales_orders so
   where so.id = p_order
     and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and so.state = 'cancelled';
  if not found then
    return null;
  end if;
  update public.proformas p
     set state = 'cancelled', cancel_reason = v_reason, cancelled_at = now(),
         cancelled_by = app.user_id(), updated_by = app.user_id()
   where p.sales_order_id = p_order and p.state = 'issued'
  returning p.id into v_proforma;
  update public.payment_milestones m
     set state = 'cancelled', updated_by = app.user_id()
   where m.sales_order_id = p_order and m.state in ('pending', 'due', 'part_paid');
  get diagnostics v_count = row_count;
  return pg_catalog.jsonb_build_object('entityId', v_entity, 'proformaId', v_proforma,
                                       'milestones', v_count);
end
$$;
--> statement-breakpoint
revoke execute on function app.cancel_order_finance(uuid) from public, readonly_reporter;
--> statement-breakpoint

-- 6. The payments of an order that still wait (pending), with what decides whether they fall
--    due: the rule, the days, the loan gate and the day the order was confirmed (IST). For the
--    platform alone; null for an order outside the request.
create or replace function app.order_waiting_milestones(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_confirmed text;
begin
  if app.user_id() is null or not app.has_perm('finance.milestones.process:all') then
    raise exception 'finance.milestones.process is required' using errcode = '42501';
  end if;
  select (so.confirmed_at at time zone 'Asia/Kolkata')::date::text into v_confirmed
    from public.sales_orders so
   where so.id = p_order and so.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and so.state in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced');
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'confirmedOn', v_confirmed,
    'milestones', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', m.id, 'entityId', m.entity_id, 'key', m.key,
                            'dueRule', m.due_rule, 'dueDays', m.due_days,
                            'loanGate', m.loan_gate) order by m.seq), '[]'::jsonb)
                     from public.payment_milestones m
                    where m.sales_order_id = p_order and m.state = 'pending'));
end
$$;
--> statement-breakpoint
revoke execute on function app.order_waiting_milestones(uuid) from public, readonly_reporter;
--> statement-breakpoint

-- 7. Brings the named waiting payments of an order due from a day, the platform alone; answers
--    how many moved (a payment no longer pending is left as it is).
create or replace function app.milestones_fall_due(p_order uuid, p_ids uuid[], p_due_on date)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if app.user_id() is null or not app.has_perm('finance.milestones.process:all') then
    raise exception 'finance.milestones.process is required' using errcode = '42501';
  end if;
  update public.payment_milestones m
     set state = 'due', due_on = p_due_on, updated_by = app.user_id()
   where m.sales_order_id = p_order
     and m.id = any (p_ids)
     and m.state = 'pending'
     and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
--> statement-breakpoint
revoke execute on function app.milestones_fall_due(uuid, uuid[], date) from public, readonly_reporter;
--> statement-breakpoint

-- 8. Attaches the PDF the render worker recorded to its proforma, as 0263 §4, and once more for a
--    cancelled proforma: a file recorded at or after the cancel, which the template prints
--    "Cancelled" across, replaces the one printed while it was live.
create or replace function app.attach_proforma_pdf(p_entity smallint, p_proforma uuid, p_file uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attached uuid;
begin
  if app.user_id() is null or not app.has_perm('files.process:entity') then
    raise exception 'files.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not exists (select 1 from public.files f
                  where f.id = p_file and f.entity_id = p_entity
                    and f.purpose = 'proforma_pdf' and f.status = 'ready') then
    return false;
  end if;
  update public.proformas p
     set pdf_file_id = p_file,
         updated_by = app.user_id()
   where p.id = p_proforma
     and p.entity_id = p_entity
     and (p.pdf_file_id is null
          or p.pdf_file_id = p_file
          or (p.state = 'cancelled'
              and exists (select 1 from public.files f
                           where f.id = p_file and f.created_at >= p.cancelled_at)))
  returning p.pdf_file_id into v_attached;
  return v_attached is not null;
end
$$;
--> statement-breakpoint
revoke execute on function app.attach_proforma_pdf(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_proforma_pdf(smallint, uuid, uuid) to app_user;
