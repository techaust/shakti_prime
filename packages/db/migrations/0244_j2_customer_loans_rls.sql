-- J2 Customer loans (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08): row security, grants,
-- the loan's guard and the one answer to an order's loan gates.
-- A company's lenders are read by every principal acting in that company (the loan form lists
-- them) and kept by the Executive (admin.entities.write) in Settings › Lenders; a lender is
-- switched off, never removed, since loans name it.
-- A customer's loan belongs to its order's company and customer (the composite key to the order):
-- it is read with the customer in that company, as the customer's relationship there is read
-- (account_entities, ADR 0008), and recorded and moved on with crm.account.write over that
-- relationship, on an order the caller reads and that is not cancelled. After the insert a person
-- changes only its state, the sanction, the disbursal, the reference, the rejection and the
-- waiver of a rejected loan's gates (column grants); a sanction or payout needs an order the
-- caller reads that is not cancelled; the customer-loan machine in packages/domain decides which
-- moves are allowed, and the guard below holds the table to the same moves. A customer merge
-- moves a loan with its order (ON UPDATE CASCADE, as the table owner). No agent principal holds
-- crm.account.write.
-- app.order_loan_gate() alone answers whether an order's loan holds back its dispatch, and tells
-- a Phase 5 payment milestone the loan's state: J8's dispatch guard and Phase 5 call it.

create trigger set_updated_at before update on lenders
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on customer_loans
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 1. The machine's moves, held by the table as well: applied to sanctioned or rejected,
--    sanctioned to disbursed or rejected; a sanction, once recorded, keeps its amount and time;
--    a disbursed or rejected loan changes no more, but for the customer a merge moves it to and,
--    once, the waiver of a rejected loan's gates, recorded with crm.account.write at company scope
--    and never changed afterwards.
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
  if (new.gates_waived_at, new.gates_waived_by, new.gates_waived_reason)
     is distinct from (old.gates_waived_at, old.gates_waived_by, old.gates_waived_reason) then
    if old.gates_waived_at is not null then
      raise exception 'a recorded waiver does not change' using errcode = '42501';
    end if;
    if old.state <> 'rejected' then
      raise exception 'only a rejected loan''s gates are waived' using errcode = '42501';
    end if;
    if not app.has_perm('crm.account.write:entity') then
      raise exception 'a loan''s gates are waived with crm.account.write at company scope'
        using errcode = '42501';
    end if;
  end if;
  if old.state in ('disbursed', 'rejected')
     and (pg_catalog.to_jsonb(new) - array['account_id', 'updated_at', 'updated_by',
                                           'gates_waived_at', 'gates_waived_by',
                                           'gates_waived_reason'])
         is distinct from (pg_catalog.to_jsonb(old) - array['account_id', 'updated_at', 'updated_by',
                                                             'gates_waived_at', 'gates_waived_by',
                                                             'gates_waived_reason']) then
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
-- A loan is moved on by a person who may write the relationship; a sanction or payout only on an
-- order they read that is not cancelled (a turn-down and a waiver close a loan, so they stay open
-- on a cancelled order).
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
                             and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id))
              and (state in ('applied', 'rejected')
                   or exists (select 1 from sales_orders so
                               where so.id = customer_loans.sales_order_id
                                 and so.entity_id = customer_loans.entity_id
                                 and so.state <> 'cancelled')));
--> statement-breakpoint
revoke all on customer_loans from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on customer_loans to app_user;
--> statement-breakpoint
grant update (state, state_changed_at, sanctioned_amount, sanctioned_at, disbursed_at, reference,
              rejected_reason, gates_waived_at, gates_waived_by, gates_waived_reason, updated_at,
              updated_by) on customer_loans to app_user;
--> statement-breakpoint
grant select on customer_loans to app_reader, readonly_reporter;
--> statement-breakpoint

-- 4. The order's loan gate: whether the order's loan holds back its dispatch, `none` (no loan,
--    the loan holds nothing back, or a person waived a turned-down loan's gates), `pending` (the
--    loan has not reached the state the dispatch waits for, or the lender turned it down and
--    nobody has decided yet: reason `loan_rejected`) or `met`. The order's loan is its active loan,
--    else its newest turned-down one. The answer names the loan, its state and whether its gates
--    were waived, so a Phase 5 milestone compares its own loan gate with the state; a gate value
--    the function does not know answers `pending`, never `none`.
--    Past row security, since the person dispatching or collecting a payment may not read the
--    customer: it answers a holder of inventory.dispatch.write or finance.payment.write in the
--    order's company, or a person who reads the customer's relationship there exactly as
--    customer_loans_read reads a loan (account_entities_read: crm.account.read at company scope,
--    the relationship's team or their own, an agent's bound thread, or, for a person, a live lead
--    of the customer in the company they read), and only for an order of a company of the
--    request; null for any other order. It tells the caller ids, states and the answer, never an
--    amount, a lender or a reason a person typed.
create or replace function app.order_loan_gate(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_operations boolean := app.has_perm('inventory.dispatch.write:entity')
                          or app.has_perm('finance.payment.write:entity');
  v_account_entity boolean := app.has_perm('crm.account.read:entity');
  v_account_team boolean := app.has_perm('crm.account.read:team');
  v_account_own boolean := app.has_perm('crm.account.read:own');
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  v_agent boolean := app.is_agent_request();
  v_person boolean := coalesce(current_setting('app.role', true), '') not like 'agent:%'
    and coalesce(current_setting('app.role', true), '') not like 'system:%'
    and not exists (select 1 from public.principals p
                     where p.id = app.user_id() and p.kind in ('agent', 'system'));
  v_entity smallint;
  v_account uuid;
  v_loan uuid;
  v_state text;
  v_need text;
  v_waived boolean;
begin
  if not (v_operations or v_account_own or v_lead_own) then
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
     and not exists (
       select 1 from public.account_entities ae
        where ae.account_id = v_account and ae.entity_id = v_entity
          and (v_account_entity
               or (v_account_team and v_team is not null and ae.team_id = v_team)
               or (v_account_own
                   and ((not v_agent and ae.owner_id = v_user)
                        or (ae.account_id = (select b.account_id from app.agent_thread_binding() b)
                            and ae.entity_id = (select b.entity_id from app.agent_thread_binding() b))))
               or (v_person
                   and exists (
                     select 1 from public.opportunities o
                      where o.account_id = ae.account_id
                        and o.entity_id = ae.entity_id
                        and o.archived_at is null
                        and (v_lead_entity
                             or (v_lead_team and v_team is not null and o.team_id = v_team)
                             or (v_lead_own
                                 and ((not v_agent and o.owner_id = v_user)
                                      or o.id = (select b.opportunity_id
                                                   from app.agent_thread_binding() b)))))))) then
    return null;
  end if;
  -- The order's loan: its one active loan (customer_loans_active_unique), else its newest
  -- turned-down loan.
  select cl.id, cl.state, cl.gates_json ->> 'dispatch', cl.gates_waived_at is not null
    into v_loan, v_state, v_need, v_waived
    from public.customer_loans cl
   where cl.sales_order_id = p_order
   order by cl.state in ('applied', 'sanctioned', 'disbursed') desc, cl.created_at desc, cl.id desc
   limit 1;
  if not found then
    return pg_catalog.jsonb_build_object(
      'loanId', null, 'loanState', null, 'dispatch', 'none', 'waived', false, 'reason', null);
  end if;
  return pg_catalog.jsonb_build_object(
    'loanId', v_loan,
    'loanState', v_state,
    'dispatch',
    case
      when v_need = 'none' then 'none'
      when v_state = 'rejected' and v_waived then 'none'
      when v_need = 'sanctioned' and v_state in ('sanctioned', 'disbursed') then 'met'
      when v_need = 'disbursed' and v_state = 'disbursed' then 'met'
      else 'pending'
    end,
    'waived', v_waived,
    'reason',
    case
      when v_state = 'rejected' and not v_waived and v_need is distinct from 'none'
        then 'loan_rejected'
    end);
end
$$;
--> statement-breakpoint
revoke execute on function app.order_loan_gate(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_loan_gate(uuid) to app_user, app_reader;
