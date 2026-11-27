-- R3 Warranty claims and supplier returns (docs/03-roadmap-appendix/phase3.md §7.5, PRD INV-08):
-- row security, grants and triggers for warranty_claims and its restricted side table
-- warranty_claim_costs, the `warranty_claim` series (code WC), and the definer that records a
-- supplier's credit.
-- A claim belongs to one company. It is read in that company with inventory.stock.read (as serials
-- are) or inventory.warranty.write, raised with inventory.warranty.write, and moved on by its step's
-- grant: inventory.warranty.write (identify, replace, reject), procurement.po.write (the supplier
-- RMA) or procurement.grn.write (settlement; phase3 §14). Only the step columns change after it is
-- raised (column grants).
-- The costs follow the house pattern for a restricted column, the side table of
-- stock_movement_costs (DATABASE §4.3): warranty_claim_costs holds the replacement's cost and the
-- supplier's credit, read only with finance.cost.read for the company (the cost_gate) and written
-- only by definers, since the Inventory Manager who records them holds no finance.cost.read.

-- 1. updated_at
create trigger set_updated_at before update on warranty_claims
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on warranty_claim_costs
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. warranty_claims: by company; each permission test an initplan, run once per query.
alter table warranty_claims enable row level security;
--> statement-breakpoint
alter table warranty_claims force row level security;
--> statement-breakpoint
create policy warranty_claims_read on warranty_claims for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('inventory.warranty.write:entity'))));
--> statement-breakpoint
create policy warranty_claims_insert on warranty_claims for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.warranty.write:entity'))
  and state = 'raised'
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy warranty_claims_update on warranty_claims for update to app_user
  using (
    entity_id = any ((select app.entity_ids())::int[])
    and ((select app.has_perm('inventory.warranty.write:entity'))
         or (select app.has_perm('procurement.po.write:entity'))
         or (select app.has_perm('procurement.grn.write:entity'))))
  with check (
    entity_id = any ((select app.entity_ids())::int[])
    and ((select app.has_perm('inventory.warranty.write:entity'))
         or (select app.has_perm('procurement.po.write:entity'))
         or (select app.has_perm('procurement.grn.write:entity')))
    and updated_by = (select app.user_id()));
--> statement-breakpoint
revoke all on warranty_claims
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert on warranty_claims to app_user;
--> statement-breakpoint
grant update (item_id, serial_id, state, state_changed_at, replacement_serial_id, vendor_id,
              supplier_rma_ref, settlement, supplier_serial_id, rejected_reason, updated_at,
              updated_by) on warranty_claims to app_user;
--> statement-breakpoint
grant select on warranty_claims to app_reader;
--> statement-breakpoint

-- 3. A closed or rejected claim is final, and a claim keeps its serial once identified, whoever
--    writes.
create or replace function app.warranty_claims_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.state in ('closed', 'rejected') then
    raise exception 'warranty claim % is %', old.id, old.state
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
  if old.state <> 'raised' and new.serial_id is distinct from old.serial_id then
    raise exception 'warranty claim % keeps its serial', old.id
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.warranty_claims_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger warranty_claims_guard before update on warranty_claims
  for each row execute function app.warranty_claims_guard();
--> statement-breakpoint

-- 4. warranty_claim_costs: the cost_gate (company scope and finance.cost.read), no write grant.
alter table warranty_claim_costs enable row level security;
--> statement-breakpoint
alter table warranty_claim_costs force row level security;
--> statement-breakpoint
create policy cost_gate on warranty_claim_costs for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.cost.read:entity')));
--> statement-breakpoint
revoke all on warranty_claim_costs
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on warranty_claim_costs to app_user, app_reader;
--> statement-breakpoint

-- 5. app.warranty_claim_record_credit(claim, amount): the supplier's credit on a claim whose RMA
--    is raised, recorded once, by a holder of procurement.grn.write for the claim's company (the
--    settle command records it, then closes the claim). Answers nothing, so the amount never comes
--    back to a caller without finance.cost.read.
create or replace function app.warranty_claim_record_credit(p_claim uuid, p_amount numeric)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_state text;
begin
  if not app.has_perm('procurement.grn.write:entity') then
    raise exception 'permission procurement.grn.write required to record a supplier credit'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'a supplier credit is a positive amount in rupees and paise'
      using errcode = 'check_violation', constraint = 'warranty_claim_costs_credit_check';
  end if;
  select c.entity_id, c.state into v_entity, v_state
    from public.warranty_claims c
   where c.id = p_claim
     for update;
  if not found or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'warranty claim % outside the request scope', p_claim
      using errcode = 'insufficient_privilege';
  end if;
  if v_state <> 'rma_raised' then
    raise exception 'warranty claim % is not awaiting its supplier', p_claim
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
  insert into public.warranty_claim_costs as w (claim_id, entity_id, supplier_credit_amount)
  values (p_claim, v_entity, p_amount)
  on conflict (claim_id) do update
     set supplier_credit_amount = excluded.supplier_credit_amount
   where w.supplier_credit_amount is null;
  if not found then
    raise exception 'warranty claim % has its credit', p_claim
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.warranty_claim_record_credit(uuid, numeric)
  from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.warranty_claim_record_credit(uuid, numeric) to app_user;
--> statement-breakpoint

-- 6. The next number of a series, as 0201 drew it, now also for a warranty claim
--    (inventory.warranty.write numbers one). Every other line is 0201's.
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
    when 'warranty_claim' then 'inventory.warranty.write:own'
    else null end;
  if v_perm is null
     or not (app.has_perm(v_perm)
             or (p_doc_type = 'sales_order' and app.has_perm('sales.quote.accept.remote:entity'))) then
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
