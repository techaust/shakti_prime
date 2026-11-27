-- J2 Customer loans (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08): row security, grants,
-- the loan's guard and the one answer to an order's loan gates.
-- A company's lenders are read by every principal acting in that company (the loan form lists
-- them) and kept by the Executive (admin.entities.write) in Settings › Lenders; a lender is
-- switched off, never removed, since loans name it.
-- A customer's loan belongs to its order's company and customer (the composite key to the order):
-- it is read with the customer in that company, as the customer's relationship there is read
-- (account_entities, ADR 0008), and recorded and moved on with crm.account.write over that
-- relationship, on an order the caller reads and that is not cancelled. After the insert a person
-- changes only its state, the sanction, the disbursal, the reference and the rejection (column
-- grants); the customer-loan machine in packages/domain decides which moves are allowed, and the
-- guard below holds the table to the same moves. A customer merge moves a loan with its order
-- (ON UPDATE CASCADE, as the table owner). No agent principal holds crm.account.write.
-- app.order_loan_gate() alone answers whether an order's loan holds back its dispatch or a
-- payment milestone: J8's dispatch guard and Phase 5's milestones call it.

create trigger set_updated_at before update on lenders
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on customer_loans
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 1. The machine's moves, held by the table as well: applied to sanctioned or rejected,
--    sanctioned to disbursed or rejected; a sanction, once recorded, keeps its amount and time;
--    a disbursed or rejected loan changes no more, but for the customer a merge moves it to.
create or replace function app.guard_customer_loan() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.state is distinct from old.state
     and not ((old.state = 'applied' and new.state in ('sanctioned', 'rejected'))
              or (old.state = 'sanctioned' and new.state in ('disbursed', 'rejected'))) then
    raise exception 'a loan moves only as the customer-loan machine allows'
      using errcode = '42501';
  end if;
  if old.sanctioned_at is not null
     and (new.sanctioned_amount is distinct from old.sanctioned_amount
          or new.sanctioned_at is distinct from old.sanctioned_at) then
    raise exception 'a recorded sanction does not change' using errcode = '42501';
  end if;
  if old.state in ('disbursed', 'rejected')
     and (pg_catalog.to_jsonb(new) - array['account_id', 'updated_at', 'updated_by'])
         is distinct from (pg_catalog.to_jsonb(old) - array['account_id', 'updated_at', 'updated_by']) then
    raise exception 'a disbursed or rejected loan does not change' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.guard_customer_loan() from public, readonly_reporter;
--> statement-breakpoint
create trigger customer_loans_guard before update on customer_loans
  for each row execute function app.guard_customer_loan();
--> statement-breakpoint

-- 2. lenders
alter table lenders enable row level security;
--> statement-breakpoint
alter table lenders force row level security;
--> statement-breakpoint
create policy lenders_read on lenders for select to app_user, app_reader
  using (entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy lenders_insert on lenders for insert to app_user
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('admin.entities.write:all'))
              and created_by = (select app.user_id()));
--> statement-breakpoint
create policy lenders_update on lenders for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('admin.entities.write:all')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('admin.entities.write:all'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint
revoke all on lenders from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on lenders to app_user;
--> statement-breakpoint
grant update (name, is_active, updated_at, updated_by) on lenders to app_user;
--> statement-breakpoint
grant select on lenders to app_reader, readonly_reporter;
--> statement-breakpoint

-- 3. customer_loans
alter table customer_loans enable row level security;
--> statement-breakpoint
alter table customer_loans force row level security;
--> statement-breakpoint
create policy customer_loans_read on customer_loans for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from account_entities ae
               where ae.account_id = customer_loans.account_id
                 and ae.entity_id = customer_loans.entity_id));
--> statement-breakpoint
-- A new loan is applied for, by its maker, over a relationship they may write, on an order they
-- read and that is not cancelled, naming an active lender of the company or, while the company
-- has none, a typed name.
create policy customer_loans_insert on customer_loans for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and state = 'applied'
  and sanctioned_amount is null
  and sanctioned_at is null
  and disbursed_at is null
  and rejected_reason is null
  and exists (select 1 from account_entities ae
               where ae.account_id = customer_loans.account_id
                 and ae.entity_id = customer_loans.entity_id
                 and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
  and exists (select 1 from sales_orders so
               where so.id = customer_loans.sales_order_id
                 and so.entity_id = customer_loans.entity_id
                 and so.state <> 'cancelled')
  and (lender_id is null
       or exists (select 1 from lenders l
                   where l.id = customer_loans.lender_id
                     and l.entity_id = customer_loans.entity_id
                     and l.is_active))
  and (lender_name is null
       or not exists (select 1 from lenders l
                       where l.entity_id = customer_loans.entity_id and l.is_active)));
--> statement-breakpoint
create policy customer_loans_update on customer_loans for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from account_entities ae
                      where ae.account_id = customer_loans.account_id
                        and ae.entity_id = customer_loans.entity_id
                        and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id())
              and exists (select 1 from account_entities ae
                           where ae.account_id = customer_loans.account_id
                             and ae.entity_id = customer_loans.entity_id
                             and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)));
--> statement-breakpoint
revoke all on customer_loans from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on customer_loans to app_user;
--> statement-breakpoint
grant update (state, state_changed_at, sanctioned_amount, sanctioned_at, disbursed_at, reference,
              rejected_reason, updated_at, updated_by) on customer_loans to app_user;
--> statement-breakpoint
grant select on customer_loans to app_reader, readonly_reporter;
--> statement-breakpoint

-- 4. The order's loan gates: for the dispatch and each payment milestone the active loan names,
--    `none` (no active loan, or the loan holds nothing back), `pending` (the loan has not reached
--    the state the gate waits for) or `met`. Past row security, since the person dispatching or
--    collecting a payment may not read the customer: it answers a holder of
--    inventory.dispatch.write or finance.payment.write in the order's company, or a person who
--    reads the customer's relationship there with crm.account.read, and only for an order of a
--    company of the request; null for any other order. It tells the caller the loan's id and
--    state and the answers, never an amount or a lender.
create or replace function app.order_loan_gate(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_operations boolean := app.has_perm('inventory.dispatch.write:entity')
                          or app.has_perm('finance.payment.write:entity');
  v_entity smallint;
  v_account uuid;
  v_loan uuid;
  v_state text;
  v_gates jsonb;
  v_milestones jsonb := '{}'::jsonb;
  m record;
begin
  if not (v_operations or app.has_perm('crm.account.read:own')) then
    raise exception 'a loan gate is read with inventory.dispatch.write, finance.payment.write or crm.account.read'
      using errcode = '42501';
  end if;
  select so.entity_id, so.account_id into v_entity, v_account
    from public.sales_orders so
   where so.id = p_order and so.entity_id = any (v_entities);
  if not found then
    return null;
  end if;
  if not v_operations
     and not exists (select 1 from public.account_entities ae
                      where ae.account_id = v_account and ae.entity_id = v_entity
                        and app.scope_ok('crm.account.read', ae.owner_id, ae.team_id)) then
    return null;
  end if;
  -- The order's one active loan (customer_loans_active_unique); a rejected loan holds nothing.
  select cl.id, cl.state, cl.gates_json into v_loan, v_state, v_gates
    from public.customer_loans cl
   where cl.sales_order_id = p_order
     and cl.state in ('applied', 'sanctioned', 'disbursed');
  if not found then
    return pg_catalog.jsonb_build_object(
      'loanId', null, 'loanState', null, 'dispatch', 'none', 'milestones', '{}'::jsonb);
  end if;
  for m in
    select g.key, g.value #>> '{}' as need
      from pg_catalog.jsonb_each(coalesce(v_gates -> 'milestones', '{}'::jsonb)) g
  loop
    v_milestones := v_milestones || pg_catalog.jsonb_build_object(m.key,
      case
        when m.need = 'sanctioned' and v_state in ('sanctioned', 'disbursed') then 'met'
        when m.need = 'disbursed' and v_state = 'disbursed' then 'met'
        when m.need in ('sanctioned', 'disbursed') then 'pending'
        else 'none'
      end);
  end loop;
  return pg_catalog.jsonb_build_object(
    'loanId', v_loan,
    'loanState', v_state,
    'dispatch',
    case
      when v_gates ->> 'dispatch' = 'sanctioned' and v_state in ('sanctioned', 'disbursed') then 'met'
      when v_gates ->> 'dispatch' = 'disbursed' and v_state = 'disbursed' then 'met'
      when v_gates ->> 'dispatch' in ('sanctioned', 'disbursed') then 'pending'
      else 'none'
    end,
    'milestones', v_milestones);
end
$$;
--> statement-breakpoint
revoke execute on function app.order_loan_gate(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_loan_gate(uuid) to app_user, app_reader;
