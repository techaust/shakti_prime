-- R3 the warranty claim's ledger steps (docs/03-roadmap-appendix/phase3.md §7.5): the three
-- reasons a claim moves stock and serials by, opened in X4's registry as its comment block says
-- (app.stock_move() is not redefined), and the definer that keeps the replacement's cost on the
-- claim's restricted costs.
--   warranty_replacement  out, in_stock -> with_customer   inventory.warranty.write:entity
--                         (the replacement issued from stock at the moving average, with the
--                         claim's customer, site and the failed serial's warranty on the line)
--   return_customer       in, with_customer -> faulty      inventory.warranty.write:entity
--                         (the failed serial back into a quarantine bin; R2 uses the same reason
--                         for its own returns, with its own grant check in its command)
--   return_supplier       out, faulty -> with_supplier     procurement.po.write:entity
--                         (the failed serial sent to its supplier on the RMA; phase3 §14)
-- None is reversible: a claim's own steps undo nothing, and a movement made in error is corrected
-- by an adjustment, so no reversal rows are keyed by these reasons.

-- 1. The grants.
insert into app.stock_reason_grants (reason, permission, reversible, opened_by) values
  ('warranty_replacement', 'inventory.warranty.write:entity', false, 'r3-warranty'),
  ('return_customer', 'inventory.warranty.write:entity', false, 'r3-warranty'),
  ('return_supplier', 'procurement.po.write:entity', false, 'r3-warranty')
on conflict (reason) do nothing;
--> statement-breakpoint

-- 2. The directions and serial moves.
insert into app.stock_reason_moves (reason, direction, from_states, creates, to_state, opened_by) values
  ('warranty_replacement', 'out', '{in_stock}', false, 'with_customer', 'r3-warranty'),
  ('return_customer', 'in', '{with_customer}', false, 'faulty', 'r3-warranty'),
  ('return_supplier', 'out', '{faulty}', false, 'with_supplier', 'r3-warranty')
on conflict (reason, direction, reverses_reason) do nothing;
--> statement-breakpoint

-- 3. app.warranty_claim_record_cost(claim_id, movement_id): the replacement's cost, the unit cost
--    its warranty_replacement movement left stock at (rounded to the paisa), kept once on the
--    claim's restricted costs; by a holder of inventory.warranty.write for the claim's company, for
--    a movement of that claim. Answers nothing, so the cost never returns to a caller without
--    finance.cost.read.
create or replace function app.warranty_claim_record_cost(p_claim uuid, p_movement uuid)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_cost numeric(14, 4);
begin
  if not app.has_perm('inventory.warranty.write:entity') then
    raise exception 'permission inventory.warranty.write required to record a replacement''s cost'
      using errcode = 'insufficient_privilege';
  end if;
  select c.entity_id into v_entity from public.warranty_claims c where c.id = p_claim for update;
  if not found or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'warranty claim % outside the request scope', p_claim
      using errcode = 'insufficient_privilege';
  end if;
  select k.unit_cost into v_cost
    from public.stock_movements m
    join public.stock_movement_costs k on k.movement_id = m.id
   where m.id = p_movement and m.entity_id = v_entity and m.reason = 'warranty_replacement'
     and m.ref_type = 'warranty_claim' and m.ref_id = p_claim;
  if not found then
    raise exception 'movement % is not the replacement of claim %', p_movement, p_claim
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
  insert into public.warranty_claim_costs as w (claim_id, entity_id, replacement_cost)
  values (p_claim, v_entity, round(v_cost, 2))
  on conflict (claim_id) do update
     set replacement_cost = excluded.replacement_cost
   where w.replacement_cost is null;
  if not found then
    raise exception 'warranty claim % has its replacement''s cost', p_claim
      using errcode = 'check_violation', constraint = 'warranty_claim_transition_not_allowed';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.warranty_claim_record_cost(uuid, uuid)
  from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.warranty_claim_record_cost(uuid, uuid) to app_user;
