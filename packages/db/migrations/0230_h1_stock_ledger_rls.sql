-- H1 hubs, bins and the stock ledger (docs/03-roadmap-appendix/phase3.md §5, §6.2): row security,
-- grants, guards and the ledger's one write path.
-- Hubs and bins belong to no company (question 1 (a)): read by any principal holding
-- inventory.stock.read in a request with a company, written by the hub and bin commands with
-- inventory.stock.adjust for every company. Movements, balances and serials are read by company
-- with inventory.stock.read for the company (a Field Engineer's `own` scope reads none until
-- Phase 4 says what own means for stock); each movement's cost and the item's average only with
-- finance.cost.read. No request role writes the ledger, its costs, the balances, the serials or
-- item_costs: only app.stock_move() does, as the table owner.

-- 1. updated_at
create trigger set_updated_at before update on warehouses for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on bins for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on serials for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on stock_balances for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. The ledger and its costs are append-only, for every role: a correction is a reversal.
create trigger stock_movements_append_only before update or delete on stock_movements
  for each row execute function app.raise_append_only();
--> statement-breakpoint
create trigger stock_movement_costs_append_only before update or delete on stock_movement_costs
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 3. Hubs: readable with inventory.stock.read in a request with a company; written with
--    inventory.stock.adjust for every company, by the caller. A hub's kind stays as created, and
--    a hub is archived only while none of its bins holds stock of any company.
alter table warehouses enable row level security;
--> statement-breakpoint
alter table warehouses force row level security;
--> statement-breakpoint
create policy warehouses_read on warehouses for select to app_user, app_reader using (
  (select app.has_perm('inventory.stock.read:own'))
  and (select coalesce(pg_catalog.cardinality(app.entity_ids()), 0)) > 0);
--> statement-breakpoint
create policy warehouses_insert on warehouses for insert to app_user with check (
  (select app.has_perm('inventory.stock.adjust:all'))
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy warehouses_update on warehouses for update to app_user
  using ((select app.has_perm('inventory.stock.adjust:all')))
  with check ((select app.has_perm('inventory.stock.adjust:all')));
--> statement-breakpoint
create or replace function app.warehouses_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'a hub keeps its kind' using errcode = 'check_violation', constraint = 'hub_kind_fixed';
  end if;
  if new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.stock_balances b
                  where b.warehouse_id = new.id and (b.qty_on_hand > 0 or b.qty_reserved > 0)) then
    raise exception 'the hub holds stock' using errcode = 'check_violation', constraint = 'hub_holds_stock';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.warehouses_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger warehouses_guard before update on warehouses
  for each row execute function app.warehouses_guard();
--> statement-breakpoint

-- 4. Bins: read and written as hubs are. A bin stays in its hub and pair; a transit bin belongs to
--    the transit hub and pairs two other hubs, any other bin to a godown or factory; only a
--    storage, quarantine or surplus bin changes kind, and only among those three; a bin is
--    archived only while it holds no stock of any company.
alter table bins enable row level security;
--> statement-breakpoint
alter table bins force row level security;
--> statement-breakpoint
create policy bins_read on bins for select to app_user, app_reader using (
  (select app.has_perm('inventory.stock.read:own'))
  and (select coalesce(pg_catalog.cardinality(app.entity_ids()), 0)) > 0);
--> statement-breakpoint
create policy bins_insert on bins for insert to app_user with check (
  (select app.has_perm('inventory.stock.adjust:all'))
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy bins_update on bins for update to app_user
  using ((select app.has_perm('inventory.stock.adjust:all')))
  with check ((select app.has_perm('inventory.stock.adjust:all')));
--> statement-breakpoint
create or replace function app.bins_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_hub_kind text;
begin
  if tg_op = 'UPDATE' then
    if new.warehouse_id is distinct from old.warehouse_id
       or new.pair_a_warehouse_id is distinct from old.pair_a_warehouse_id
       or new.pair_b_warehouse_id is distinct from old.pair_b_warehouse_id
       or (new.kind is distinct from old.kind
           and not (old.kind in ('storage', 'quarantine', 'surplus')
                    and new.kind in ('storage', 'quarantine', 'surplus'))) then
      raise exception 'a bin keeps its hub, pair and kind' using errcode = 'check_violation', constraint = 'bin_fixed';
    end if;
    if new.archived_at is not null and old.archived_at is null
       and exists (select 1 from public.stock_balances b
                    where b.bin_id = new.id and (b.qty_on_hand > 0 or b.qty_reserved > 0)) then
      raise exception 'the bin holds stock' using errcode = 'check_violation', constraint = 'bin_holds_stock';
    end if;
    return new;
  end if;
  select w.kind into v_hub_kind from public.warehouses w where w.id = new.warehouse_id;
  if (new.kind = 'transit') <> (v_hub_kind = 'transit') then
    raise exception 'a transit bin belongs to the transit hub' using errcode = 'check_violation', constraint = 'bin_kind_hub';
  end if;
  if new.kind = 'transit' and exists (
       select 1 from public.warehouses w
        where w.id in (new.pair_a_warehouse_id, new.pair_b_warehouse_id) and w.kind = 'transit') then
    raise exception 'a transit bin pairs two hubs' using errcode = 'check_violation', constraint = 'bin_kind_hub';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.bins_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger bins_guard before insert or update on bins
  for each row execute function app.bins_guard();
--> statement-breakpoint

-- 5. Movements, balances and serials: by company, with inventory.stock.read for the company.
alter table stock_movements enable row level security;
--> statement-breakpoint
alter table stock_movements force row level security;
--> statement-breakpoint
create policy stock_movements_read on stock_movements for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.read:entity')));
--> statement-breakpoint
alter table stock_balances enable row level security;
--> statement-breakpoint
alter table stock_balances force row level security;
--> statement-breakpoint
create policy stock_balances_read on stock_balances for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.read:entity')));
--> statement-breakpoint
alter table serials enable row level security;
--> statement-breakpoint
alter table serials force row level security;
--> statement-breakpoint
create policy serials_read on serials for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.read:entity')));
--> statement-breakpoint

-- 6. Costs: the cost_gate of 0008 (company scope and finance.cost.read). item_costs keeps its
--    read policy and loses its write policies and grants: app.stock_move() keeps the average.
alter table stock_movement_costs enable row level security;
--> statement-breakpoint
alter table stock_movement_costs force row level security;
--> statement-breakpoint
create policy cost_gate on stock_movement_costs for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.cost.read:entity')));
--> statement-breakpoint
drop policy item_costs_insert on item_costs;
--> statement-breakpoint
drop policy item_costs_update on item_costs;
--> statement-breakpoint
revoke insert, update, delete on item_costs from app_user, app_reader;
--> statement-breakpoint

-- 7. Grants: hubs and bins are written by their commands; the ledger, its costs, the balances and
--    the serials only by the definer.
revoke all on warehouses, bins, serials, stock_movements, stock_movement_costs, stock_balances
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert, update on warehouses, bins to app_user;
--> statement-breakpoint
grant select on serials, stock_movements, stock_movement_costs, stock_balances to app_user;
--> statement-breakpoint
grant select on warehouses, bins, serials, stock_movements, stock_movement_costs, stock_balances to app_reader;
--> statement-breakpoint

-- 8. One line of a stock_move() batch, as the definer normalises it.
create type app.stock_line as (
  ord integer,
  entity_id smallint,
  item_id uuid,
  tracked boolean,
  serial_id uuid,
  serial_no text,
  from_bin uuid,
  from_hub uuid,
  to_bin uuid,
  to_hub uuid,
  qty numeric(12, 3),
  reason text,
  ref_type text,
  ref_id uuid,
  reverses_id uuid,
  unit_cost numeric(14, 4)
);
--> statement-breakpoint

-- 9. A refusal of the ledger: check_violation named by its catalogue reason, with the facts a
--    screen names (ids and codes, never a cost) as JSON in the detail. Called by the definers only.
create or replace function app.stock_refuse(p_reason text, p_detail jsonb default '{}'::jsonb)
  returns void
  language plpgsql set search_path = '' as $$
begin
  raise exception 'stock movement refused: %', p_reason
    using errcode = 'check_violation', constraint = p_reason, detail = p_detail::text;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_refuse(text, jsonb) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 10. A bin as the ledger reads it: its hub, kind and pair, refused when missing or archived
--     (the bin or its hub).
create or replace function app.stock_bin(p_bin uuid)
  returns table (warehouse_id uuid, kind text, pair_a uuid, pair_b uuid)
  language plpgsql stable set search_path = '' as $$
declare
  v_archived boolean;
begin
  select b.warehouse_id, b.kind, b.pair_a_warehouse_id, b.pair_b_warehouse_id,
         (b.archived_at is not null or w.archived_at is not null)
    into warehouse_id, kind, pair_a, pair_b, v_archived
    from public.bins b join public.warehouses w on w.id = b.warehouse_id
   where b.id = p_bin;
  if not found then
    perform app.stock_refuse('stock_bin_missing', pg_catalog.jsonb_build_object('binId', p_bin));
  end if;
  if v_archived then
    perform app.stock_refuse('stock_bin_archived', pg_catalog.jsonb_build_object('binId', p_bin));
  end if;
  return next;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_bin(uuid) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 11. app.stock_move(movements jsonb): the one write path of the ledger (§5). A batch of lines,
--     each {entity_id, item_id, serial_id | serial_no | null, from_bin_id | null, to_bin_id | null,
--     qty, reason, ref_type, ref_id, reverses_id | null, unit_cost | null}, posted in one call
--     under one batch id, in the order given. Answers the movement ids, never a cost.
--     The caller's grant is checked per reason from the request's settings: opening, adjust_gain,
--     adjust_loss, damage, count and reversal need inventory.stock.adjust for the company, transfer
--     inventory.stock.move; every other reason is refused (stock_reason_not_open) until the slice
--     that opens it. Rows are locked in one fixed order on every path: the balances by (company,
--     hub, bin, item) after inserting the missing ones, then item_costs by (company, item), then
--     the serials by id; the checks that depend on what is held run after the locks.
--     Costs (question 2 (a)): an inbound line takes its given unit cost, else the moving average
--     while the company holds some of the item, else the last positive average (STOCK-2), and
--     revalues the average; an outbound line or a transfer takes the moving average; a reversal
--     takes the original movement's cost, and the reversal of an inbound line takes its value back
--     out of the average.
create or replace function app.stock_move(p_movements jsonb)
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_batch uuid := app.uuid_v7();
  v_request text := nullif(pg_catalog.current_setting('app.request_id', true), '');
  v_has_stocked boolean;
  v_lines app.stock_line[] := '{}';
  v_line app.stock_line;
  v_el jsonb;
  v_ord integer := 0;
  v_ids uuid[] := '{}';
  v_reason text;
  v_perm text;
  v_item_active boolean;
  v_item_tracked boolean;
  v_stocked boolean;
  v_from record;
  v_to record;
  v_orig record;
  v_serial record;
  v_serial_ids uuid[] := '{}';
  v_entity int;
  v_have numeric(12, 3);
  v_onhand numeric(14, 3);
  v_avg numeric(14, 4);
  v_last numeric(14, 4);
  v_cost numeric(14, 4);
  v_new_avg numeric(14, 4);
  v_movement uuid;
  v_sku text;
  v_bin_code text;
begin
  if v_actor is null then
    raise exception 'a stock movement needs a request context' using errcode = '42501';
  end if;
  if p_movements is null or pg_catalog.jsonb_typeof(p_movements) <> 'array'
     or pg_catalog.jsonb_array_length(p_movements) = 0 then
    perform app.stock_refuse('stock_batch_empty');
  end if;
  if pg_catalog.jsonb_array_length(p_movements) > 10000 then
    perform app.stock_refuse('stock_batch_too_large');
  end if;
  -- items.is_stocked arrives with C5: read where present, else every item is stocked.
  select exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = 'public.items'::pg_catalog.regclass
                    and a.attname = 'is_stocked' and not a.attisdropped)
    into v_has_stocked;

  -- Pass 1: shape, grant, company, bins, item and serial, before any lock.
  for v_el in select e from pg_catalog.jsonb_array_elements(p_movements) as e loop
    v_ord := v_ord + 1;
    v_line := null;
    v_line.ord := v_ord;
    v_reason := v_el ->> 'reason';
    v_line.reason := v_reason;
    v_perm := case
      when v_reason in ('opening', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'reversal')
        then 'inventory.stock.adjust:entity'
      when v_reason = 'transfer' then 'inventory.stock.move:entity'
      else null end;
    if v_perm is null then
      perform app.stock_refuse('stock_reason_not_open', pg_catalog.jsonb_build_object('line', v_ord));
    end if;
    if not app.has_perm(v_perm) then
      raise exception '% is required for a % movement', v_perm, v_reason using errcode = '42501';
    end if;
    v_line.ref_type := nullif(pg_catalog.btrim(v_el ->> 'ref_type'), '');
    v_line.ref_id := (v_el ->> 'ref_id')::uuid;
    if (v_line.ref_type is null) <> (v_line.ref_id is null) then
      perform app.stock_refuse('stock_movement_shape', pg_catalog.jsonb_build_object('line', v_ord));
    end if;

    if v_reason = 'reversal' then
      -- Everything but the reference comes from the movement reversed.
      v_line.reverses_id := (v_el ->> 'reverses_id')::uuid;
      select m.entity_id, m.item_id, m.serial_id, m.from_bin_id, m.to_bin_id, m.qty, m.reason,
             c.unit_cost,
             exists (select 1 from public.stock_movements r where r.reverses_id = m.id) as reversed
        into v_orig
        from public.stock_movements m
        left join public.stock_movement_costs c on c.movement_id = m.id
       where m.id = v_line.reverses_id;
      if not found or not (v_orig.entity_id = any (v_entities)) then
        perform app.stock_refuse('stock_movement_missing', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
      if v_orig.reason not in ('opening', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'transfer') then
        perform app.stock_refuse('stock_reversal_not_allowed', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
      if v_orig.reversed then
        perform app.stock_refuse('stock_already_reversed', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
      v_line.entity_id := v_orig.entity_id;
      v_line.item_id := v_orig.item_id;
      v_line.serial_id := v_orig.serial_id;
      v_line.from_bin := v_orig.to_bin_id;
      v_line.to_bin := v_orig.from_bin_id;
      v_line.qty := v_orig.qty;
      v_line.unit_cost := v_orig.unit_cost;
    else
      if v_el ? 'reverses_id' and v_el ->> 'reverses_id' is not null then
        perform app.stock_refuse('stock_movement_shape', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
      v_line.entity_id := (v_el ->> 'entity_id')::smallint;
      v_line.item_id := (v_el ->> 'item_id')::uuid;
      v_line.serial_id := (v_el ->> 'serial_id')::uuid;
      v_line.serial_no := nullif(pg_catalog.btrim(v_el ->> 'serial_no'), '');
      v_line.from_bin := (v_el ->> 'from_bin_id')::uuid;
      v_line.to_bin := (v_el ->> 'to_bin_id')::uuid;
      v_line.qty := (v_el ->> 'qty')::numeric(12, 3);
      v_line.unit_cost := (v_el ->> 'unit_cost')::numeric(14, 4);
      if v_line.entity_id is null or v_line.item_id is null or v_line.qty is null or v_line.qty <= 0
         or (v_line.from_bin is null and v_line.to_bin is null)
         or v_line.from_bin is not distinct from v_line.to_bin
         or (v_line.serial_id is not null and v_line.serial_no is not null)
         or (v_line.unit_cost is not null and (v_line.from_bin is not null or v_line.unit_cost < 0)) then
        perform app.stock_refuse('stock_movement_shape', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
      -- Each reason's direction: into a bin, out of a bin, or between two.
      if (v_reason in ('opening', 'adjust_gain') and (v_line.from_bin is not null or v_line.to_bin is null))
         or (v_reason in ('adjust_loss', 'damage') and (v_line.to_bin is not null or v_line.from_bin is null))
         or (v_reason = 'count' and v_line.from_bin is not null and v_line.to_bin is not null)
         or (v_reason = 'transfer' and (v_line.from_bin is null or v_line.to_bin is null)) then
        perform app.stock_refuse('stock_movement_shape', pg_catalog.jsonb_build_object('line', v_ord));
      end if;
    end if;

    if not (v_line.entity_id = any (v_entities)) then
      raise exception 'company % is outside the request', v_line.entity_id using errcode = '42501';
    end if;

    -- The bins: present, in use, and a transit bin only with a hub of its pair.
    if v_line.from_bin is not null then
      select * into v_from from app.stock_bin(v_line.from_bin);
      v_line.from_hub := v_from.warehouse_id;
    end if;
    if v_line.to_bin is not null then
      select * into v_to from app.stock_bin(v_line.to_bin);
      v_line.to_hub := v_to.warehouse_id;
    end if;
    if v_line.from_bin is not null and v_line.to_bin is not null
       and (v_from.kind = 'transit' or v_to.kind = 'transit')
       and ((v_from.kind = 'transit' and v_to.kind = 'transit')
            or (v_from.kind = 'transit' and v_line.to_hub is distinct from v_from.pair_a
                and v_line.to_hub is distinct from v_from.pair_b)
            or (v_to.kind = 'transit' and v_line.from_hub is distinct from v_to.pair_a
                and v_line.from_hub is distinct from v_to.pair_b)) then
      perform app.stock_refuse('stock_transit_pair', pg_catalog.jsonb_build_object('line', v_ord));
    end if;

    -- The item: in the catalogue, active and stocked.
    select i.is_active and i.archived_at is null, i.is_serial_tracked, i.sku
      into v_item_active, v_item_tracked, v_sku
      from public.items i where i.id = v_line.item_id;
    if not found then
      perform app.stock_refuse('stock_item_missing', pg_catalog.jsonb_build_object('line', v_ord));
    end if;
    if not v_item_active then
      perform app.stock_refuse('stock_item_inactive',
        pg_catalog.jsonb_build_object('line', v_ord, 'itemId', v_line.item_id, 'sku', v_sku));
    end if;
    if v_has_stocked then
      execute 'select is_stocked from public.items where id = $1' into v_stocked using v_line.item_id;
      if not coalesce(v_stocked, true) then
        perform app.stock_refuse('stock_item_not_stocked',
          pg_catalog.jsonb_build_object('line', v_ord, 'itemId', v_line.item_id, 'sku', v_sku));
      end if;
    end if;
    v_line.tracked := v_item_tracked;

    -- The serial: one per movement of a tracked item, none for an untracked one.
    if not v_item_tracked then
      if v_line.serial_id is not null or v_line.serial_no is not null then
        perform app.stock_refuse('stock_serial_untracked',
          pg_catalog.jsonb_build_object('line', v_ord, 'itemId', v_line.item_id, 'sku', v_sku));
      end if;
    else
      if v_line.qty <> 1 then
        perform app.stock_refuse('stock_serial_qty',
          pg_catalog.jsonb_build_object('line', v_ord, 'itemId', v_line.item_id, 'sku', v_sku));
      end if;
      if v_line.serial_id is null and v_line.serial_no is null then
        perform app.stock_refuse('stock_serial_required',
          pg_catalog.jsonb_build_object('line', v_ord, 'itemId', v_line.item_id, 'sku', v_sku));
      end if;
      if v_line.serial_id is null then
        select s.id, s.entity_id into v_serial from public.serials s
         where s.item_id = v_line.item_id and pg_catalog.lower(s.serial_no) = pg_catalog.lower(v_line.serial_no);
        if found then
          if v_serial.entity_id <> v_line.entity_id then
            -- Another company's serial is never named to this one.
            perform app.stock_refuse('stock_serial_exists',
              pg_catalog.jsonb_build_object('line', v_ord, 'serialNo', v_line.serial_no));
          end if;
          v_line.serial_id := v_serial.id;
        elsif not (v_reason in ('opening', 'adjust_gain')) then
          perform app.stock_refuse('stock_serial_unknown',
            pg_catalog.jsonb_build_object('line', v_ord, 'serialNo', v_line.serial_no));
        end if;
      else
        if not exists (select 1 from public.serials s
                        where s.id = v_line.serial_id and s.entity_id = v_line.entity_id
                          and s.item_id = v_line.item_id) then
          perform app.stock_refuse('stock_serial_unknown', pg_catalog.jsonb_build_object('line', v_ord));
        end if;
      end if;
      if v_line.serial_id is not null then
        v_serial_ids := v_serial_ids || v_line.serial_id;
      end if;
    end if;
    v_lines := v_lines || v_line;
  end loop;

  -- Opening stock once per company, unless the earlier batch is reversed whole.
  for v_entity in select distinct l.entity_id from pg_catalog.unnest(v_lines) l
                   where l.reason = 'opening' order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app.stock_move.opening'), v_entity);
    if exists (select 1 from public.stock_movements m
                where m.entity_id = v_entity and m.reason = 'opening'
                  and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id)) then
      perform app.stock_refuse('opening_stock_posted', pg_catalog.jsonb_build_object('entityId', v_entity));
    end if;
  end loop;

  -- Locks, in the one order every stock path takes.
  insert into public.stock_balances (id, entity_id, warehouse_id, bin_id, item_id)
  select app.uuid_v7(), k.entity_id, k.hub, k.bin, k.item_id
    from (select l.entity_id, l.from_hub as hub, l.from_bin as bin, l.item_id
            from pg_catalog.unnest(v_lines) l where l.from_bin is not null
          union
          select l.entity_id, l.to_hub, l.to_bin, l.item_id
            from pg_catalog.unnest(v_lines) l where l.to_bin is not null) k
   order by k.entity_id, k.hub, k.bin, k.item_id
  on conflict (entity_id, warehouse_id, bin_id, item_id) do nothing;
  perform 1 from public.stock_balances b
   where (b.entity_id, b.warehouse_id, b.bin_id, b.item_id) in (
           select l.entity_id, l.from_hub, l.from_bin, l.item_id
             from pg_catalog.unnest(v_lines) l where l.from_bin is not null
           union
           select l.entity_id, l.to_hub, l.to_bin, l.item_id
             from pg_catalog.unnest(v_lines) l where l.to_bin is not null)
   order by b.entity_id, b.warehouse_id, b.bin_id, b.item_id
   for update;
  insert into public.item_costs (id, item_id, entity_id)
  select app.uuid_v7(), k.item_id, k.entity_id
    from (select distinct l.entity_id, l.item_id from pg_catalog.unnest(v_lines) l) k
   order by k.entity_id, k.item_id
  on conflict (item_id, entity_id) do nothing;
  perform 1 from public.item_costs c
   where (c.entity_id, c.item_id) in (select l.entity_id, l.item_id from pg_catalog.unnest(v_lines) l)
   order by c.entity_id, c.item_id
   for update;
  perform 1 from public.serials s where s.id = any (v_serial_ids) order by s.id for update;

  -- Pass 2: in the order given, with what is held now.
  foreach v_line in array v_lines loop
    -- The serial follows its movement.
    if v_line.tracked then
      if v_line.serial_id is null then
        -- A new serial (opening or adjust_gain); a race on its number meets the unique index.
        insert into public.serials (id, entity_id, item_id, serial_no, state, bin_id, created_by)
        values (app.uuid_v7(), v_line.entity_id, v_line.item_id, v_line.serial_no, 'in_stock',
                v_line.to_bin, v_actor)
        returning id into v_line.serial_id;
      else
        select s.state, s.bin_id, s.serial_no into v_serial from public.serials s where s.id = v_line.serial_id;
        if v_line.from_bin is null then
          -- Into a bin: a serial that left the company's stock comes back.
          if v_serial.state <> 'scrapped' then
            perform app.stock_refuse(case when v_line.reason = 'reversal' then 'stock_serial_not_in_bin'
                                          else 'stock_serial_exists' end,
              pg_catalog.jsonb_build_object('line', v_line.ord, 'serialNo', v_serial.serial_no));
          end if;
          update public.serials
             set state = 'in_stock', bin_id = v_line.to_bin, state_changed_at = pg_catalog.now(),
                 updated_by = v_actor
           where id = v_line.serial_id;
        else
          if v_serial.state <> 'in_stock' or v_serial.bin_id is distinct from v_line.from_bin then
            perform app.stock_refuse('stock_serial_not_in_bin',
              pg_catalog.jsonb_build_object('line', v_line.ord, 'serialNo', v_serial.serial_no,
                                            'binId', v_line.from_bin));
          end if;
          if v_line.to_bin is null then
            update public.serials
               set state = 'scrapped', bin_id = null, state_changed_at = pg_catalog.now(),
                   updated_by = v_actor
             where id = v_line.serial_id;
          else
            update public.serials set bin_id = v_line.to_bin, updated_by = v_actor
             where id = v_line.serial_id;
          end if;
        end if;
      end if;
    end if;

    -- The bin it leaves never goes below zero.
    if v_line.from_bin is not null then
      select b.qty_on_hand into v_have from public.stock_balances b
       where b.entity_id = v_line.entity_id and b.bin_id = v_line.from_bin and b.item_id = v_line.item_id;
      if v_have < v_line.qty then
        select i.sku into v_sku from public.items i where i.id = v_line.item_id;
        select b.code into v_bin_code from public.bins b where b.id = v_line.from_bin;
        perform app.stock_refuse('stock_insufficient',
          pg_catalog.jsonb_build_object('line', v_line.ord, 'itemId', v_line.item_id, 'sku', v_sku,
                                        'binId', v_line.from_bin, 'binCode', v_bin_code));
      end if;
    end if;

    -- The cost, and the average it leaves.
    select c.moving_avg_cost, c.last_positive_avg_cost into v_avg, v_last
      from public.item_costs c where c.entity_id = v_line.entity_id and c.item_id = v_line.item_id;
    select coalesce(sum(b.qty_on_hand), 0) into v_onhand from public.stock_balances b
     where b.entity_id = v_line.entity_id and b.item_id = v_line.item_id;
    v_new_avg := v_avg;
    if v_line.from_bin is null then
      v_cost := case
        when v_line.unit_cost is not null then v_line.unit_cost
        when v_onhand > 0 and v_avg is not null then v_avg
        else coalesce(v_last, v_avg, 0) end;
      v_new_avg := case when v_onhand > 0
        then pg_catalog.round((v_onhand * coalesce(v_avg, 0) + v_line.qty * v_cost) / (v_onhand + v_line.qty), 4)
        else v_cost end;
    elsif v_line.to_bin is null then
      v_cost := coalesce(case when v_line.reason = 'reversal' then v_line.unit_cost end, v_avg, 0);
      if v_line.reason = 'reversal' and v_onhand - v_line.qty > 0 then
        v_new_avg := pg_catalog.greatest(0, pg_catalog.round(
          (v_onhand * coalesce(v_avg, 0) - v_line.qty * v_cost) / (v_onhand - v_line.qty), 4));
      end if;
    else
      v_cost := coalesce(case when v_line.reason = 'reversal' then v_line.unit_cost end, v_avg, 0);
    end if;

    v_movement := app.uuid_v7();
    insert into public.stock_movements (id, entity_id, item_id, serial_id, from_bin_id, to_bin_id,
                                        qty, reason, ref_type, ref_id, reverses_id, batch_id,
                                        moved_by, request_id)
    values (v_movement, v_line.entity_id, v_line.item_id, v_line.serial_id, v_line.from_bin,
            v_line.to_bin, v_line.qty, v_line.reason, v_line.ref_type, v_line.ref_id,
            v_line.reverses_id, v_batch, v_actor, v_request);
    insert into public.stock_movement_costs (movement_id, entity_id, unit_cost)
    values (v_movement, v_line.entity_id, v_cost);

    if v_line.from_bin is not null then
      update public.stock_balances
         set qty_on_hand = qty_on_hand - v_line.qty, last_moved_at = pg_catalog.now()
       where entity_id = v_line.entity_id and bin_id = v_line.from_bin and item_id = v_line.item_id;
    end if;
    if v_line.to_bin is not null then
      update public.stock_balances
         set qty_on_hand = qty_on_hand + v_line.qty, last_moved_at = pg_catalog.now()
       where entity_id = v_line.entity_id and bin_id = v_line.to_bin and item_id = v_line.item_id;
    end if;

    if v_new_avg is distinct from v_avg then
      update public.item_costs
         set moving_avg_cost = v_new_avg,
             last_positive_avg_cost = case when v_new_avg > 0 then v_new_avg else last_positive_avg_cost end,
             as_of = pg_catalog.now(), updated_by = v_actor
       where entity_id = v_line.entity_id and item_id = v_line.item_id;
    elsif v_new_avg > 0 and v_last is distinct from v_new_avg then
      update public.item_costs set last_positive_avg_cost = v_new_avg, as_of = pg_catalog.now()
       where entity_id = v_line.entity_id and item_id = v_line.item_id;
    end if;
    v_ids := v_ids || v_movement;
  end loop;
  return v_ids;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_move(jsonb) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.stock_move(jsonb) to app_user;
--> statement-breakpoint

-- 12. app.stock_balance_check(): every (company, bin, item) whose balance differs from the sum of
--     its movements, for the platform's nightly check (G3) and the tests; none when the ledger
--     holds. Only with platform.jobs.check for every company (system:workers).
create or replace function app.stock_balance_check()
  returns table (entity_id smallint, bin_id uuid, item_id uuid, qty_on_hand numeric, qty_moved numeric)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_perm('platform.jobs.check:all') then
    raise exception 'platform.jobs.check:all is required' using errcode = '42501';
  end if;
  return query
    with moved as (
      select x.entity_id, x.bin_id, x.item_id, sum(x.q) as q
        from (select m.entity_id, m.to_bin_id as bin_id, m.item_id, m.qty as q
                from public.stock_movements m where m.to_bin_id is not null
              union all
              select m.entity_id, m.from_bin_id, m.item_id, -m.qty
                from public.stock_movements m where m.from_bin_id is not null) x
       group by x.entity_id, x.bin_id, x.item_id)
    select coalesce(b.entity_id, mv.entity_id), coalesce(b.bin_id, mv.bin_id),
           coalesce(b.item_id, mv.item_id),
           coalesce(b.qty_on_hand, 0)::numeric, coalesce(mv.q, 0)::numeric
      from public.stock_balances b
      full join moved mv
        on mv.entity_id = b.entity_id and mv.bin_id = b.bin_id and mv.item_id = b.item_id
     where coalesce(b.qty_on_hand, 0) <> coalesce(mv.q, 0);
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_balance_check() from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.stock_balance_check() to app_user;
