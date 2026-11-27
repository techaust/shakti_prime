-- X4 the stock ledger's reason registry (docs/runs/phase3/x4-stock-reasons.md): which permission
-- each movement reason of app.stock_move() needs now lives in data, in app.stock_reason_grants,
-- so a slice opens a reason with one insert and never redefines the ledger's write path.
--
-- HOW A LATER SLICE OPENS A REASON. In that slice's own custom migration write exactly one
-- statement, and nothing else about app.stock_move():
--
--   insert into app.stock_reason_grants (reason, permission, opened_by)
--     values ('<reason>', '<permission key>:<scope>', '<your slice>')
--     on conflict (reason) do nothing;
--
-- <reason> is one of the ledger's fifteen (stock_movements_reason_check); <permission key>:<scope>
-- is a key of the permission catalogue with one of its scopes, written exactly as app.has_perm()
-- reads the request's settings (H1's are 'inventory.stock.adjust:entity' and
-- 'inventory.stock.move:entity'); <your slice> is the run file's slug, for example
-- 'u2-purchase-orders'. Then, in the same slice: add the reason's grant test (the roles that
-- may and may not post it) beside H1's in the ledger suite; take the reason out of the list in
-- the domain ledger test 'refuses every reason a later slice opens'; and add it to
-- OPEN_STOCK_REASONS in the contracts, which the registry's test holds equal to this table. The
-- registry's test walks every row of the table, so the new row's grant is checked there too.
-- A reason with no row stays refused with stock_reason_not_open. Never redefine app.stock_move() to open a reason, and never update or
-- delete another slice's row: a later full redefinition would silently drop an earlier slice's
-- reason, which is why the mapping left the function.

-- 1. The registry: one row per open reason, read only by app.stock_move() as its owner. It holds
--    no company and no personal data, and no request role, reporting or agent reads or writes it.
create table app.stock_reason_grants (
  reason text primary key,
  permission text not null,
  opened_by text not null,
  constraint stock_reason_grants_reason_check check (reason in ('opening', 'receipt', 'transfer',
    'pick', 'issue', 'return_customer', 'return_supplier', 'adjust_gain', 'adjust_loss', 'damage',
    'count', 'warranty_replacement', 'surplus_in', 'surplus_out', 'reversal')),
  constraint stock_reason_grants_permission_check
    check (permission ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+:(own|team|entity|all)$'),
  constraint stock_reason_grants_opened_by_check
    check (opened_by ~ '^[a-z0-9][a-z0-9-]*$' and char_length(opened_by) <= 60)
);
--> statement-breakpoint
revoke all on app.stock_reason_grants from public, app_user, app_reader, readonly_reporter;
--> statement-breakpoint

-- 2. H1's mapping, exactly as its case had it.
insert into app.stock_reason_grants (reason, permission, opened_by) values
  ('opening', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('adjust_gain', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('adjust_loss', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('damage', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('count', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('reversal', 'inventory.stock.adjust:entity', 'h1-stock-ledger'),
  ('transfer', 'inventory.stock.move:entity', 'h1-stock-ledger');
--> statement-breakpoint

-- 3. app.stock_move(), as H1 wrote it, with one change: the case that named each reason's
--    permission is now a read of app.stock_reason_grants. Every other line, the lock order and
--    every refusal included, is H1's; a reason with no row leaves v_perm null and is refused with
--    stock_reason_not_open, as before.
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
  v_from_kind text;
  v_from_pair_a uuid;
  v_from_pair_b uuid;
  v_to_kind text;
  v_to_pair_a uuid;
  v_to_pair_b uuid;
  v_orig record;
  v_serial record;
  v_serial_ids uuid[] := '{}';
  v_entity int;
  v_ref uuid;
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
    select g.permission into v_perm
      from app.stock_reason_grants g where g.reason = v_reason;
    if v_perm is null then
      perform app.stock_refuse('stock_reason_not_open', pg_catalog.jsonb_build_object('line', v_ord));
    end if;
    if not app.has_perm(v_perm) then
      raise exception '% is required for a % movement', v_perm, v_reason using errcode = '42501';
    end if;
    v_line.ref_type := nullif(pg_catalog.btrim(v_el ->> 'ref_type'), '');
    v_line.note := nullif(pg_catalog.btrim(v_el ->> 'note'), '');
    v_line.ref_id := (v_el ->> 'ref_id')::uuid;
    if (v_line.ref_type is null) <> (v_line.ref_id is null)
       or pg_catalog.char_length(coalesce(v_line.ref_type, '')) > 40
       or pg_catalog.char_length(coalesce(v_line.note, '')) > 300 then
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
    v_from_kind := null;
    v_to_kind := null;
    if v_line.from_bin is not null then
      select b.warehouse_id, b.kind, b.pair_a, b.pair_b
        into v_line.from_hub, v_from_kind, v_from_pair_a, v_from_pair_b
        from app.stock_bin(v_line.from_bin) b;
    end if;
    if v_line.to_bin is not null then
      select b.warehouse_id, b.kind, b.pair_a, b.pair_b
        into v_line.to_hub, v_to_kind, v_to_pair_a, v_to_pair_b
        from app.stock_bin(v_line.to_bin) b;
    end if;
    if v_from_kind is not null and v_to_kind is not null
       and ((v_from_kind = 'transit' and v_to_kind = 'transit')
            or (v_from_kind = 'transit' and v_line.to_hub is distinct from v_from_pair_a
                and v_line.to_hub is distinct from v_from_pair_b)
            or (v_to_kind = 'transit' and v_line.from_hub is distinct from v_to_pair_a
                and v_line.from_hub is distinct from v_to_pair_b)) then
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
            -- Another company's serial is never named to this one: its number is taken for a new
            -- serial, and unknown to a movement of one.
            perform app.stock_refuse(case when v_reason in ('opening', 'adjust_gain')
                                          then 'stock_serial_exists' else 'stock_serial_unknown' end,
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

  -- Opening stock once per company, unless the earlier one is reversed whole: an opening batch is
  -- the movements of one reference (an import job posts its rows batch by batch under its own
  -- id), so a company's unreversed opening movement of another reference, or of none, refuses it,
  -- and so does a batch whose opening lines name two references (or one and none) for a company.
  for v_entity in select l.entity_id from pg_catalog.unnest(v_lines) l
                   where l.reason = 'opening' group by l.entity_id
                  having count(distinct coalesce(l.ref_id::text, '')) > 1 loop
    perform app.stock_refuse('opening_stock_posted', pg_catalog.jsonb_build_object('entityId', v_entity));
  end loop;
  for v_entity, v_ref in select distinct l.entity_id, l.ref_id from pg_catalog.unnest(v_lines) l
                          where l.reason = 'opening' order by 1, 2 loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app.stock_move.opening'), v_entity);
    if exists (select 1 from public.stock_movements m
                where m.entity_id = v_entity and m.reason = 'opening'
                  and (v_ref is null or m.ref_id is distinct from v_ref)
                  and not exists (select 1 from public.stock_movements r where r.reverses_id = m.id)) then
      perform app.stock_refuse('opening_stock_posted', pg_catalog.jsonb_build_object('entityId', v_entity));
    end if;
  end loop;

  -- Locks, in the one order every stock path takes: hubs, bins, balances, item costs, serials.
  perform 1 from public.warehouses w
   where w.id in (select l.from_hub from pg_catalog.unnest(v_lines) l where l.from_hub is not null
                  union
                  select l.to_hub from pg_catalog.unnest(v_lines) l where l.to_hub is not null)
   order by w.id
   for share;
  perform 1 from public.bins b
   where b.id in (select l.from_bin from pg_catalog.unnest(v_lines) l where l.from_bin is not null
                  union
                  select l.to_bin from pg_catalog.unnest(v_lines) l where l.to_bin is not null)
   order by b.id
   for share;
  -- A bin or hub archived while this batch waited for its lock: refused, never stock in it.
  select l.ord into v_ord
    from pg_catalog.unnest(v_lines) l
    cross join lateral (values (l.from_bin), (l.to_bin)) as x(bin_id)
    join public.bins b on b.id = x.bin_id
    join public.warehouses w on w.id = b.warehouse_id
   where b.archived_at is not null or w.archived_at is not null
   order by l.ord
   limit 1;
  if found then
    perform app.stock_refuse('stock_bin_archived', pg_catalog.jsonb_build_object('line', v_ord));
  end if;
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
        v_new_avg := greatest(0, pg_catalog.round(
          (v_onhand * coalesce(v_avg, 0) - v_line.qty * v_cost) / (v_onhand - v_line.qty), 4));
      end if;
    else
      v_cost := coalesce(case when v_line.reason = 'reversal' then v_line.unit_cost end, v_avg, 0);
    end if;

    v_movement := app.uuid_v7();
    insert into public.stock_movements (id, entity_id, item_id, serial_id, from_bin_id, to_bin_id,
                                        qty, reason, ref_type, ref_id, reverses_id, note, batch_id,
                                        moved_by, request_id)
    values (v_movement, v_line.entity_id, v_line.item_id, v_line.serial_id, v_line.from_bin,
            v_line.to_bin, v_line.qty, v_line.reason, v_line.ref_type, v_line.ref_id,
            v_line.reverses_id, v_line.note, v_batch, v_actor, v_request);
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
