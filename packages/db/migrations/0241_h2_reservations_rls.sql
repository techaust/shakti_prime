-- H2 reservations and availability (docs/03-roadmap-appendix/phase3.md §7.1, questions 3 (a) and
-- 4 (a)): row security and grants of reservation_needs and reservations, the rule of
-- app.stock_move() that keeps a bin's reserved quantity, and the definers that reserve, release,
-- lapse, extend and move stock and answer availability on quotes and orders.
--
-- The lock order of every reservation path: the sales orders it touches (by id; a person's
-- command already holds its order `for update`, the platform's jobs take theirs `for share`), then
-- H1's order (hubs `for share` by id, bins `for share` by id, balances `for update` by company,
-- hub, bin and item), then the needs and reservations, then the order lines.

-- 1. Timestamps.
create trigger set_updated_at before update on reservation_needs for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on reservations for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. Row security: read by company with inventory.stock.read for the company, as the balances are;
--    written only by the definers below.
alter table reservation_needs enable row level security;
--> statement-breakpoint
alter table reservation_needs force row level security;
--> statement-breakpoint
create policy reservation_needs_read on reservation_needs for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.read:entity')));
--> statement-breakpoint
alter table reservations enable row level security;
--> statement-breakpoint
alter table reservations force row level security;
--> statement-breakpoint
create policy reservations_read on reservations for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.read:entity')));
--> statement-breakpoint
revoke all on reservation_needs, reservations
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on reservation_needs, reservations to app_user, app_reader;
--> statement-breakpoint

-- 3. An order line is written with nothing backordered; the definers keep the figure afterwards.
drop policy sales_order_lines_insert on sales_order_lines;
--> statement-breakpoint
create policy sales_order_lines_insert on sales_order_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and qty_backordered = 0
  and exists (select 1 from sales_orders so
               where so.id = sales_order_lines.sales_order_id
                 and so.entity_id = sales_order_lines.entity_id
                 and so.state = 'draft'
                 and so.created_by = (select app.user_id())
                 and so.created_at = now()));
--> statement-breakpoint

-- 4. The platform-only permissions, with H2's inventory.reservations.process (main's latest list,
--    0222, and the new key).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire', 'inventory.reservations.process']::text[]
$$;
--> statement-breakpoint

-- 5. app.stock_move(): H1's definer (0231) with one rule more, in pass 2: an outbound line never
--    takes a bin below its reserved quantity (stock_reserved_insufficient, naming the item and the
--    bin). Everything else is as 0231 wrote it.
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
  v_reserved numeric(12, 3);
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

    -- The bin it leaves never goes below zero, nor below what it holds for orders (H2): an
    -- outbound line (a loss, damage, a count's loss, a transfer out, a reversal out) leaves at
    -- least the bin's reserved quantity; a reservation is released, lapsed or moved first.
    if v_line.from_bin is not null then
      select b.qty_on_hand, b.qty_reserved into v_have, v_reserved from public.stock_balances b
       where b.entity_id = v_line.entity_id and b.bin_id = v_line.from_bin and b.item_id = v_line.item_id;
      if v_have < v_line.qty then
        select i.sku into v_sku from public.items i where i.id = v_line.item_id;
        select b.code into v_bin_code from public.bins b where b.id = v_line.from_bin;
        perform app.stock_refuse('stock_insufficient',
          pg_catalog.jsonb_build_object('line', v_line.ord, 'itemId', v_line.item_id, 'sku', v_sku,
                                        'binId', v_line.from_bin, 'binCode', v_bin_code));
      end if;
      if v_have - v_line.qty < v_reserved then
        select i.sku into v_sku from public.items i where i.id = v_line.item_id;
        select b.code into v_bin_code from public.bins b where b.id = v_line.from_bin;
        perform app.stock_refuse('stock_reserved_insufficient',
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
--> statement-breakpoint

-- 6. app.order_hubs(order): the godowns and factories in use, in the order an order takes stock
--    from them: those whose PIN codes list the site's PIN code first, then the rest by code.
--    Called by the definers below only.
create or replace function app.order_hubs(p_order uuid)
  returns uuid[]
  language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(w.id order by coalesce(x.pin = any (w.pin_codes), false) desc,
                                         pg_catalog.lower(w.code), w.id), '{}'::uuid[])
    from public.warehouses w
    cross join (select (select s.pin from public.customer_sites s where s.id = so.site_id) as pin
                  from public.sales_orders so where so.id = p_order) x
   where w.kind in ('godown', 'factory') and w.archived_at is null
$$;
--> statement-breakpoint
revoke execute on function app.order_hubs(uuid) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 7. app.stock_lock_free(company, items, hubs): H1's lock order over the free stock of the items in
--    the hubs' storage bins: the hubs `for share` by id, their storage bins `for share` by id, then
--    the balances `for update` by (company, hub, bin, item). Called by the definers below only,
--    before they lock any need or reservation, so a later call within the transaction finds its
--    rows already held.
create or replace function app.stock_lock_free(p_entity smallint, p_items uuid[], p_hubs uuid[])
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from public.warehouses w where w.id = any (p_hubs) order by w.id for share;
  perform 1 from public.bins b
   where b.warehouse_id = any (p_hubs) and b.kind = 'storage'
   order by b.id
   for share;
  perform 1 from public.stock_balances sb
   where sb.entity_id = p_entity and sb.warehouse_id = any (p_hubs) and sb.item_id = any (p_items)
     and exists (select 1 from public.bins b where b.id = sb.bin_id and b.kind = 'storage')
   order by sb.entity_id, sb.warehouse_id, sb.bin_id, sb.item_id
   for update;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_lock_free(smallint, uuid[], uuid[]) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 8. app.sync_line_backorders(lines): each line's qty_backordered from its needs: an item line's
--    is its need's; a kit line's is the kits not yet wholly reserved; a line with no need (a
--    service, an unconfirmed or a cancelled order) has none. Called by the definers below only.
create or replace function app.sync_line_backorders(p_lines uuid[])
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.sales_order_lines l
     set qty_backordered = x.backordered
    from (select l2.id,
                 case
                   when n.needs = 0 or n.short = 0 then 0::numeric
                   when l2.kit_id is null then least(l2.qty, n.short)
                   else l2.qty - least(l2.qty, pg_catalog.floor(n.kits))
                 end as backordered
            from public.sales_order_lines l2
            cross join lateral (
              select count(*) as needs,
                     coalesce(sum(rn.qty_backordered), 0) as short,
                     min((rn.qty_needed - rn.qty_backordered) * l2.qty / rn.qty_needed) as kits
                from public.reservation_needs rn
               where rn.sales_order_line_id = l2.id) n
           where l2.id = any (p_lines)) x
   where l.id = x.id and l.qty_backordered is distinct from x.backordered;
end
$$;
--> statement-breakpoint
revoke execute on function app.sync_line_backorders(uuid[]) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 9. app.stock_reserve(need, qty, hubs, whole, expires_at): the one way stock is set aside. Takes
--    up to `qty` (at most the need's backorder) of the need's item from the free stock (on hand less
--    reserved) of the company's storage bins, hub by hub in the order given and, within a hub, the
--    bin with the most free first; each bin taken is one active reservation until `expires_at`,
--    and its quantity is added to the bin's `qty_reserved`. The need's backorder falls by what was
--    taken. With `whole`, anything short of `qty` refuses the call (reservation_stock_short).
--    Answers the quantity reserved. Locks as stock_lock_free() does, then the need. Called by the
--    definers below only, each of which has checked the caller's grant.
create or replace function app.stock_reserve(p_need uuid, p_qty numeric, p_hubs uuid[],
                                             p_whole boolean, p_expires_at timestamptz)
  returns numeric
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_need record;
  v_bin record;
  v_want numeric(12, 3);
  v_take numeric(12, 3);
  v_got numeric(12, 3) := 0;
begin
  if v_actor is null then
    raise exception 'a reservation needs a request context' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= pg_catalog.now() then
    perform app.stock_refuse('reservation_expiry_invalid');
  end if;
  select n.entity_id, n.item_id into v_need from public.reservation_needs n where n.id = p_need;
  if not found then
    perform app.stock_refuse('reservation_need_missing');
  end if;
  perform app.stock_lock_free(v_need.entity_id, array[v_need.item_id], p_hubs);
  select n.id, n.entity_id, n.sales_order_id, n.sales_order_line_id, n.item_id, n.qty_backordered
    into v_need
    from public.reservation_needs n where n.id = p_need
     for update;
  v_want := least(coalesce(p_qty, 0), v_need.qty_backordered);
  if p_whole and v_want < coalesce(p_qty, 0) then
    perform app.stock_refuse('reservation_stock_short',
      pg_catalog.jsonb_build_object('itemId', v_need.item_id));
  end if;
  for v_bin in
    select b.id as bin_id, b.warehouse_id, sb.qty_on_hand - sb.qty_reserved as free
      from pg_catalog.unnest(p_hubs) with ordinality as h(hub_id, n)
      join public.warehouses w on w.id = h.hub_id and w.archived_at is null
                              and w.kind in ('godown', 'factory')
      join public.bins b on b.warehouse_id = w.id and b.kind = 'storage' and b.archived_at is null
      join public.stock_balances sb on sb.entity_id = v_need.entity_id and sb.warehouse_id = w.id
                                   and sb.bin_id = b.id and sb.item_id = v_need.item_id
     where sb.qty_on_hand > sb.qty_reserved
     order by h.n, sb.qty_on_hand - sb.qty_reserved desc, pg_catalog.lower(b.code), b.id
  loop
    exit when v_want <= 0;
    v_take := least(v_want, v_bin.free);
    insert into public.reservations (id, entity_id, sales_order_id, sales_order_line_id, item_id,
                                     warehouse_id, bin_id, qty, state, expires_at, created_by)
    values (app.uuid_v7(), v_need.entity_id, v_need.sales_order_id, v_need.sales_order_line_id,
            v_need.item_id, v_bin.warehouse_id, v_bin.bin_id, v_take, 'active', p_expires_at, v_actor);
    update public.stock_balances
       set qty_reserved = qty_reserved + v_take
     where entity_id = v_need.entity_id and bin_id = v_bin.bin_id and item_id = v_need.item_id;
    v_want := v_want - v_take;
    v_got := v_got + v_take;
  end loop;
  if p_whole and v_got < p_qty then
    perform app.stock_refuse('reservation_stock_short',
      pg_catalog.jsonb_build_object('itemId', v_need.item_id));
  end if;
  if v_got > 0 then
    update public.reservation_needs set qty_backordered = qty_backordered - v_got where id = p_need;
  end if;
  return v_got;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_reserve(uuid, numeric, uuid[], boolean, timestamptz) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 10. app.stock_unreserve(reservations, state, kind, reason): the one way reserved stock is freed.
--     Each active reservation named becomes `released` (with its kind: by_hand, order_cancelled or
--     moved, and a person's reason for the first two) or `lapsed`, and its quantity leaves its
--     bin's `qty_reserved`. Unless the order was cancelled, the quantity is back on order: the
--     need's backorder grows, and a reservation that lapsed or was released by hand waits behind
--     the backorders already queued; a moved one keeps its place. A reservation no longer active
--     is skipped. Answers what it freed. Locks H1's order over the reservations' bins, then the
--     reservations by id, then the needs. Called by the definers below only.
create or replace function app.stock_unreserve(p_ids uuid[], p_state text, p_kind text, p_reason text)
  returns table (reservation_id uuid, sales_order_id uuid, item_id uuid, qty numeric)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_res record;
  v_lines uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'a reservation needs a request context' using errcode = '42501';
  end if;
  if not ((p_state = 'lapsed' and p_kind is null and p_reason is null)
          or (p_state = 'released' and p_kind in ('by_hand', 'order_cancelled') and p_reason is not null)
          or (p_state = 'released' and p_kind = 'moved' and p_reason is null)) then
    raise exception 'stock_unreserve: % % is not a way to end a reservation', p_state, p_kind
      using errcode = '22023';
  end if;
  -- A reservation's company, hub, bin and item never change, so they are read before the locks.
  perform 1 from public.warehouses w
   where w.id in (select r.warehouse_id from public.reservations r where r.id = any (p_ids))
   order by w.id
   for share;
  perform 1 from public.bins b
   where b.id in (select r.bin_id from public.reservations r where r.id = any (p_ids))
   order by b.id
   for share;
  perform 1 from public.stock_balances sb
   where (sb.entity_id, sb.warehouse_id, sb.bin_id, sb.item_id) in (
           select r.entity_id, r.warehouse_id, r.bin_id, r.item_id
             from public.reservations r where r.id = any (p_ids))
   order by sb.entity_id, sb.warehouse_id, sb.bin_id, sb.item_id
   for update;
  for v_res in
    select r.id, r.entity_id, r.sales_order_id, r.sales_order_line_id, r.item_id, r.bin_id, r.qty
      from public.reservations r
     where r.id = any (p_ids) and r.state = 'active'
     order by r.id
       for update
  loop
    update public.reservations
       set state = p_state, state_changed_at = pg_catalog.now(), release_kind = p_kind,
           released_reason = p_reason, updated_by = v_actor
     where id = v_res.id;
    update public.stock_balances
       set qty_reserved = qty_reserved - v_res.qty
     where entity_id = v_res.entity_id and bin_id = v_res.bin_id and item_id = v_res.item_id;
    if p_kind is distinct from 'order_cancelled' then
      update public.reservation_needs n
         set qty_backordered = n.qty_backordered + v_res.qty,
             queued_at = case when p_kind = 'moved' then n.queued_at else pg_catalog.now() end
       where n.sales_order_line_id = v_res.sales_order_line_id and n.item_id = v_res.item_id;
    end if;
    v_lines := v_lines || v_res.sales_order_line_id;
    reservation_id := v_res.id;
    sales_order_id := v_res.sales_order_id;
    item_id := v_res.item_id;
    qty := v_res.qty;
    return next;
  end loop;
  perform app.sync_line_backorders(v_lines);
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_unreserve(uuid[], text, text, text) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 11. app.reserve_order(order, expires_at): confirming an order reserves its lines' free stock
--     (question 3 (a)). Writes the order's needs (an item line's item, a kit line's components at
--     the kit's quantities now; services and other items kept out of stock need nothing), each
--     queued at the order's confirmation, then reserves each need in line order from the hubs in
--     the order's preferred order (app.order_hubs()); what is short stays backordered. Only for a
--     caller who may confirm the order (app.may_confirm_order()), on a confirmed order with no
--     needs yet. Answers each need with what it reserved and what is backordered.
create or replace function app.reserve_order(p_order uuid, p_expires_at timestamptz)
  returns table (need_id uuid, sales_order_line_id uuid, item_id uuid, qty_reserved numeric,
                 qty_backordered numeric)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order record;
  v_hubs uuid[];
  v_need record;
begin
  if app.user_id() is null then
    raise exception 'a reservation needs a request context' using errcode = '42501';
  end if;
  select so.id, so.entity_id, so.state, so.confirmed_at into v_order
    from public.sales_orders so where so.id = p_order
     for update;
  if not found or not (v_order.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.may_confirm_order(p_order) then
    raise exception 'sales.order.confirm on the order is required' using errcode = '42501';
  end if;
  if v_order.state <> 'confirmed' then
    perform app.stock_refuse('reservation_order_not_open');
  end if;
  if exists (select 1 from public.reservation_needs n where n.sales_order_id = p_order) then
    perform app.stock_refuse('reservation_order_reserved');
  end if;
  insert into public.reservation_needs (id, entity_id, sales_order_id, sales_order_line_id, item_id,
                                        qty_needed, qty_backordered, queued_at)
  select app.uuid_v7(), v_order.entity_id, p_order, x.line_id, x.item_id, x.qty, x.qty,
         v_order.confirmed_at
    from (select l.id as line_id, l.position, l.item_id, l.qty
            from public.sales_order_lines l
            join public.items i on i.id = l.item_id and i.is_stocked
           where l.sales_order_id = p_order and l.item_id is not null
          union all
          select l.id, l.position, kc.item_id, l.qty * kc.qty
            from public.sales_order_lines l
            join public.kit_components kc on kc.kit_id = l.kit_id
            join public.items i on i.id = kc.item_id and i.is_stocked
           where l.sales_order_id = p_order and l.kit_id is not null) x
   order by x.position, x.item_id;
  v_hubs := app.order_hubs(p_order);
  perform app.stock_lock_free(
    v_order.entity_id::smallint,
    array(select n.item_id from public.reservation_needs n where n.sales_order_id = p_order),
    v_hubs);
  for v_need in
    select n.id, n.qty_backordered
      from public.reservation_needs n
      join public.sales_order_lines l on l.id = n.sales_order_line_id
     where n.sales_order_id = p_order
     order by l.position, n.item_id
  loop
    perform app.stock_reserve(v_need.id, v_need.qty_backordered, v_hubs, false, p_expires_at);
  end loop;
  perform app.sync_line_backorders(
    array(select l.id from public.sales_order_lines l where l.sales_order_id = p_order));
  return query
    select n.id, n.sales_order_line_id, n.item_id, (n.qty_needed - n.qty_backordered)::numeric,
           n.qty_backordered::numeric
      from public.reservation_needs n
      join public.sales_order_lines l on l.id = n.sales_order_line_id
     where n.sales_order_id = p_order
     order by l.position, n.item_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.reserve_order(uuid, timestamptz) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reserve_order(uuid, timestamptz) to app_user;
--> statement-breakpoint

-- 12. app.release_order_reservations(order, reason): a cancelled order's reservations are released
--     with its reason, and nothing of it stays backordered (the sales order machine's
--     release_reservations). Only with sales.order.cancel for the order's company. Answers how
--     many reservations it released.
create or replace function app.release_order_reservations(p_order uuid, p_reason text)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order record;
  v_count integer;
begin
  if app.user_id() is null then
    raise exception 'a reservation needs a request context' using errcode = '42501';
  end if;
  select so.id, so.entity_id, so.state into v_order
    from public.sales_orders so where so.id = p_order
     for update;
  if not found or not (v_order.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.has_perm('sales.order.cancel:entity') then
    raise exception 'sales.order.cancel for the company is required' using errcode = '42501';
  end if;
  if v_order.state <> 'cancelled' then
    perform app.stock_refuse('reservation_order_not_cancelled');
  end if;
  select count(*)::integer into v_count
    from app.stock_unreserve(
      array(select r.id from public.reservations r
             where r.sales_order_id = p_order and r.state = 'active'),
      'released', 'order_cancelled', p_reason);
  update public.reservation_needs set qty_backordered = 0
   where sales_order_id = p_order and qty_backordered > 0;
  perform app.sync_line_backorders(
    array(select l.id from public.sales_order_lines l where l.sales_order_id = p_order));
  return v_count;
end
$$;
--> statement-breakpoint
revoke execute on function app.release_order_reservations(uuid, text) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.release_order_reservations(uuid, text) to app_user;
--> statement-breakpoint

-- 13. app.fill_backorders(company, item, expires_at, limit): stock that entered a storage bin goes
--     to the item's backorders in the company, oldest in the queue first (the order's
--     confirmation, or when its reservation lapsed or was released by hand), each from the hubs
--     in its order's preferred order, until the free stock or the backorders run out. Only the
--     backorders of orders still open (confirmed or partly dispatched), at most `limit` of them.
--     Locks the orders `for share` by id, then H1's order over the item in every hub, then the
--     needs. Only with inventory.reservations.process for every company (system:workers).
--     Answers what each need took.
create or replace function app.fill_backorders(p_entity smallint, p_item uuid,
                                               p_expires_at timestamptz, p_limit integer)
  returns table (need_id uuid, sales_order_id uuid, qty_reserved numeric)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_orders uuid[];
  v_hubs uuid[];
  v_need record;
  v_got numeric;
  v_free numeric;
begin
  if app.user_id() is null or not app.has_perm('inventory.reservations.process:all') then
    raise exception 'inventory.reservations.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'company % is outside the request', p_entity using errcode = '42501';
  end if;
  v_orders := array(
    select q.sales_order_id from (
      select n.sales_order_id, min(n.queued_at) as first_at
        from public.reservation_needs n
        join public.sales_orders so on so.id = n.sales_order_id
                                   and so.state in ('confirmed', 'partially_dispatched')
       where n.entity_id = p_entity and n.item_id = p_item and n.qty_backordered > 0
       group by n.sales_order_id
       order by min(n.queued_at), n.sales_order_id
       limit greatest(coalesce(p_limit, 0), 0)) q);
  if pg_catalog.cardinality(v_orders) = 0 then
    return;
  end if;
  perform 1 from public.sales_orders so where so.id = any (v_orders) order by so.id for share;
  v_hubs := array(select w.id from public.warehouses w
                   where w.kind in ('godown', 'factory') and w.archived_at is null);
  perform app.stock_lock_free(p_entity, array[p_item], v_hubs);
  for v_need in
    select n.id, n.sales_order_id, n.qty_backordered
      from public.reservation_needs n
      join public.sales_orders so on so.id = n.sales_order_id
                                 and so.state in ('confirmed', 'partially_dispatched')
     where n.sales_order_id = any (v_orders) and n.item_id = p_item and n.qty_backordered > 0
     order by n.queued_at, n.id
  loop
    select coalesce(sum(sb.qty_on_hand - sb.qty_reserved), 0) into v_free
      from public.stock_balances sb
      join public.bins b on b.id = sb.bin_id and b.kind = 'storage' and b.archived_at is null
     where sb.entity_id = p_entity and sb.item_id = p_item and sb.warehouse_id = any (v_hubs);
    exit when v_free <= 0;
    v_got := app.stock_reserve(v_need.id, v_need.qty_backordered,
                               app.order_hubs(v_need.sales_order_id), false, p_expires_at);
    if v_got > 0 then
      perform app.sync_line_backorders(
        array(select n.sales_order_line_id from public.reservation_needs n where n.id = v_need.id));
      need_id := v_need.id;
      sales_order_id := v_need.sales_order_id;
      qty_reserved := v_got;
      return next;
    end if;
  end loop;
end
$$;
--> statement-breakpoint
revoke execute on function app.fill_backorders(smallint, uuid, timestamptz, integer) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.fill_backorders(smallint, uuid, timestamptz, integer) to app_user;
--> statement-breakpoint

-- 14. app.lapse_reservations(company, limit): the daily scan's lapse. The company's active
--     reservations past `expires_at`, oldest first, at most `limit`, become `lapsed`: their stock
--     is free and their quantity is back on order behind the backorders already queued. Locks the
--     orders `for share` by id first, and lapses only what is still active and due under the
--     locks (an extension may have come first). Only with inventory.reservations.process for
--     every company. Answers what it lapsed.
create or replace function app.lapse_reservations(p_entity smallint, p_limit integer)
  returns table (reservation_id uuid, sales_order_id uuid, item_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if app.user_id() is null or not app.has_perm('inventory.reservations.process:all') then
    raise exception 'inventory.reservations.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'company % is outside the request', p_entity using errcode = '42501';
  end if;
  v_ids := array(select r.id from public.reservations r
                  where r.entity_id = p_entity and r.state = 'active'
                    and r.expires_at <= pg_catalog.now()
                  order by r.expires_at, r.id
                  limit greatest(coalesce(p_limit, 0), 0));
  if pg_catalog.cardinality(v_ids) = 0 then
    return;
  end if;
  perform 1 from public.sales_orders so
   where so.id in (select r.sales_order_id from public.reservations r where r.id = any (v_ids))
   order by so.id
   for share;
  return query
    select u.reservation_id, u.sales_order_id, u.item_id
      from app.stock_unreserve(
             array(select r.id from public.reservations r
                    where r.id = any (v_ids) and r.state = 'active'
                      and r.expires_at <= pg_catalog.now()),
             'lapsed', null, null) u;
end
$$;
--> statement-breakpoint
revoke execute on function app.lapse_reservations(smallint, integer) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.lapse_reservations(smallint, integer) to app_user;
--> statement-breakpoint

-- 15. app.reservation_reminders(company, before, limit): the daily scan's reminder. The company's
--     active reservations lapsing by `before` that have had no reminder since they were made or
--     extended are marked reminded, and answered with the order and who it is for: the order's
--     owner (its lead's owner, or the person who made a dealer's order). Only with
--     inventory.reservations.process for every company. Answers ids, never a quantity.
create or replace function app.reservation_reminders(p_entity smallint, p_before timestamptz,
                                                     p_limit integer)
  returns table (reservation_id uuid, sales_order_id uuid, owner_id uuid, expires_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('inventory.reservations.process:all') then
    raise exception 'inventory.reservations.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'company % is outside the request', p_entity using errcode = '42501';
  end if;
  return query
    with due as (
      select r.id from public.reservations r
       where r.entity_id = p_entity and r.state = 'active' and r.reminded_at is null
         and r.expires_at <= p_before
       order by r.expires_at, r.id
       limit greatest(coalesce(p_limit, 0), 0)
         for update skip locked),
    marked as (
      update public.reservations r set reminded_at = pg_catalog.now()
        from due where r.id = due.id
      returning r.id, r.sales_order_id, r.expires_at)
    select m.id, m.sales_order_id, coalesce(o.owner_id, so.created_by), m.expires_at
      from marked m
      join public.sales_orders so on so.id = m.sales_order_id
      left join public.opportunities o on o.id = so.opportunity_id
     order by m.expires_at, m.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.reservation_reminders(smallint, timestamptz, integer) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reservation_reminders(smallint, timestamptz, integer) to app_user;
--> statement-breakpoint

-- 16. A person's change of one reservation: its order locked `for update` first, as the order
--     commands lock theirs. The reservation must be active and of a company of the request.
create or replace function app.reservation_for_change(p_id uuid)
  returns table (id uuid, entity_id smallint, sales_order_id uuid, sales_order_line_id uuid,
                 item_id uuid, warehouse_id uuid, bin_id uuid, qty numeric, state text,
                 expires_at timestamptz, extended_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order uuid;
  v_entity smallint;
begin
  select r.sales_order_id, r.entity_id into v_order, v_entity
    from public.reservations r where r.id = p_id;
  if not found or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    perform app.stock_refuse('reservation_missing');
  end if;
  perform 1 from public.sales_orders so where so.id = v_order for update;
  return query
    select r.id, r.entity_id, r.sales_order_id, r.sales_order_line_id, r.item_id, r.warehouse_id,
           r.bin_id, r.qty, r.state, r.expires_at, r.extended_at
      from public.reservations r where r.id = p_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.reservation_for_change(uuid) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 17. app.reservation_release(reservation, reason): released by hand with a reason; its quantity
--     is back on order behind the backorders already queued. Only with inventory.stock.adjust for
--     the company.
create or replace function app.reservation_release(p_id uuid, p_reason text)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res record;
begin
  if app.user_id() is null or not app.has_perm('inventory.stock.adjust:entity') then
    raise exception 'inventory.stock.adjust is required' using errcode = '42501';
  end if;
  select * into v_res from app.reservation_for_change(p_id);
  if v_res.state <> 'active' then
    perform app.stock_refuse('reservation_not_active');
  end if;
  perform 1 from app.stock_unreserve(array[p_id], 'released', 'by_hand', p_reason);
end
$$;
--> statement-breakpoint
revoke execute on function app.reservation_release(uuid, text) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reservation_release(uuid, text) to app_user;
--> statement-breakpoint

-- 18. app.reservation_extend(reservation, days, reason): held `days` longer, once, with a reason;
--     a new reminder is due before the new date. With inventory.stock.adjust, or sales.order.cancel
--     (the General Manager), for the company. Answers the new date.
create or replace function app.reservation_extend(p_id uuid, p_days integer, p_reason text)
  returns timestamptz
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res record;
  v_until timestamptz;
begin
  if app.user_id() is null
     or not (app.has_perm('inventory.stock.adjust:entity') or app.has_perm('sales.order.cancel:entity')) then
    raise exception 'inventory.stock.adjust or sales.order.cancel is required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'an extension is 1 to 366 days' using errcode = '22023';
  end if;
  select * into v_res from app.reservation_for_change(p_id);
  if v_res.state <> 'active' then
    perform app.stock_refuse('reservation_not_active');
  end if;
  if v_res.extended_at is not null then
    perform app.stock_refuse('reservation_already_extended');
  end if;
  update public.reservations r
     set expires_at = r.expires_at + pg_catalog.make_interval(days => p_days),
         extended_by = app.user_id(), extended_at = pg_catalog.now(), extend_reason = p_reason,
         reminded_at = null, updated_by = app.user_id()
   where r.id = p_id
  returning r.expires_at into v_until;
  return v_until;
end
$$;
--> statement-breakpoint
revoke execute on function app.reservation_extend(uuid, integer, text) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reservation_extend(uuid, integer, text) to app_user;
--> statement-breakpoint

-- 19. app.reservation_move(reservation, hub): the quantity is reserved instead from another hub's
--     free stock, whole or not at all (reservation_stock_short), held until the same date; the
--     old reservation is released as moved. Locks the order, then H1's order over the old bin and
--     the new hub's storage bins together, then the reservations. Only with inventory.stock.adjust
--     for the company. Answers the new reservations.
create or replace function app.reservation_move(p_id uuid, p_hub uuid)
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res record;
  v_need uuid;
  v_hubs uuid[];
  v_before uuid[];
begin
  if app.user_id() is null or not app.has_perm('inventory.stock.adjust:entity') then
    raise exception 'inventory.stock.adjust is required' using errcode = '42501';
  end if;
  select * into v_res from app.reservation_for_change(p_id);
  if v_res.state <> 'active' then
    perform app.stock_refuse('reservation_not_active');
  end if;
  if v_res.warehouse_id = p_hub then
    perform app.stock_refuse('reservation_move_same_hub');
  end if;
  if not exists (select 1 from public.warehouses w
                  where w.id = p_hub and w.kind in ('godown', 'factory') and w.archived_at is null) then
    perform app.stock_refuse('reservation_hub_missing');
  end if;
  v_hubs := array(select h from pg_catalog.unnest(array[v_res.warehouse_id, p_hub]) h order by h);
  -- Both hubs at once, in H1's order: hubs, bins, balances.
  perform 1 from public.warehouses w where w.id = any (v_hubs) order by w.id for share;
  perform 1 from public.bins b
   where (b.warehouse_id = p_hub and b.kind = 'storage') or b.id = v_res.bin_id
   order by b.id
   for share;
  perform 1 from public.stock_balances sb
   where sb.entity_id = v_res.entity_id and sb.item_id = v_res.item_id
     and (sb.bin_id = v_res.bin_id
          or (sb.warehouse_id = p_hub
              and exists (select 1 from public.bins b where b.id = sb.bin_id and b.kind = 'storage')))
   order by sb.entity_id, sb.warehouse_id, sb.bin_id, sb.item_id
   for update;
  select n.id into v_need from public.reservation_needs n
   where n.sales_order_line_id = v_res.sales_order_line_id and n.item_id = v_res.item_id;
  v_before := array(select r.id from public.reservations r where r.sales_order_id = v_res.sales_order_id);
  perform 1 from app.stock_unreserve(array[p_id], 'released', 'moved', null);
  perform app.stock_reserve(v_need, v_res.qty, array[p_hub], true, v_res.expires_at);
  return array(select r.id from public.reservations r
                where r.sales_order_id = v_res.sales_order_id and not (r.id = any (v_before))
                order by r.id);
end
$$;
--> statement-breakpoint
revoke execute on function app.reservation_move(uuid, uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.reservation_move(uuid, uuid) to app_user;
--> statement-breakpoint

-- 20. app.line_availability(kind, id): availability per line of a quote or an order (question 4
--     (a), PRD SAL-04). For a quote or a draft order, from the company's free stock in the
--     storage bins of every hub in use: an item line is covered when the free stock meets its
--     quantity, partly covered when some is free, short when none is; a kit line counts the kits
--     its components' free stock makes (the floor of each component's free stock over its
--     quantity per kit). For a confirmed order, from its reservations: covered when nothing is
--     backordered, short when nothing is reserved, else partly covered. A cancelled order and a
--     line with nothing kept in stock answer no row. `expected_on` is the date receipts on open
--     purchase orders would cover the line, null until purchase orders exist (U2).
--     Answered to a caller in the document's company who holds inventory.stock.read for it, with
--     the quantities; or who holds sales.quote.create and reads the document's lead (or a
--     dealer's order's customer), with the status and the date and every quantity null.
create or replace function app.line_availability(p_kind text, p_id uuid)
  returns table (line_id uuid, status text, expected_on date, qty_free numeric,
                 qty_reserved numeric, qty_backordered numeric)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_state text;
  v_allowed boolean := false;
  v_counts boolean;
begin
  if app.user_id() is null then
    raise exception 'availability needs a request context' using errcode = '42501';
  end if;
  v_counts := app.has_perm('inventory.stock.read:entity');
  if p_kind = 'quote' then
    select q.entity_id, null::text,
           v_counts or (app.has_perm('sales.quote.create:own')
                        and app.scope_ok('crm.lead.read', o.owner_id, o.team_id))
      into v_entity, v_state, v_allowed
      from public.quotes q join public.opportunities o on o.id = q.opportunity_id
     where q.id = p_id;
  elsif p_kind = 'order' then
    select so.entity_id, so.state,
           v_counts or (app.has_perm('sales.quote.create:own')
                        and case when so.opportunity_id is not null
                                 then app.scope_ok('crm.lead.read', o.owner_id, o.team_id)
                                 else ae.account_id is not null
                                      and app.scope_ok('crm.account.read', ae.owner_id, ae.team_id) end)
      into v_entity, v_state, v_allowed
      from public.sales_orders so
      left join public.opportunities o on o.id = so.opportunity_id
      left join public.account_entities ae on so.opportunity_id is null
                                          and ae.account_id = so.account_id
                                          and ae.entity_id = so.entity_id
     where so.id = p_id;
  else
    raise exception 'availability is for a quote or an order' using errcode = '22023';
  end if;
  if v_entity is null or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not coalesce(v_allowed, false) then
    raise exception 'the document is not readable here' using errcode = '42501';
  end if;
  if v_state = 'cancelled' then
    return;
  end if;

  if p_kind = 'order' and v_state <> 'draft' then
    return query
      select l.id,
             case when sum(n.qty_backordered) = 0 then 'covered'
                  when sum(n.qty_needed - n.qty_backordered) = 0 then 'short'
                  else 'partly_covered' end,
             null::date,
             null::numeric,
             case when v_counts then l.qty - l.qty_backordered end,
             case when v_counts then l.qty_backordered end
        from public.sales_order_lines l
        join public.reservation_needs n on n.sales_order_line_id = l.id
       where l.sales_order_id = p_id
       group by l.id, l.position, l.qty, l.qty_backordered
       order by l.position;
    return;
  end if;

  return query
    with lines as (
      select ql.id, ql.position, ql.item_id, ql.kit_id, ql.qty
        from public.quote_lines ql where p_kind = 'quote' and ql.quote_id = p_id
      union all
      select sl.id, sl.position, sl.item_id, sl.kit_id, sl.qty
        from public.sales_order_lines sl where p_kind = 'order' and sl.sales_order_id = p_id),
    parts as (
      select l.id as line_id, l.position, l.qty, l.kit_id is not null as is_kit,
             l.item_id as part_id, 1::numeric as per_unit
        from lines l join public.items i on i.id = l.item_id and i.is_stocked
      union all
      select l.id, l.position, l.qty, true, kc.item_id, kc.qty
        from lines l
        join public.kit_components kc on kc.kit_id = l.kit_id
        join public.items i on i.id = kc.item_id and i.is_stocked),
    free as (
      select p.part_id, coalesce(sum(greatest(sb.qty_on_hand - sb.qty_reserved, 0)), 0) as qty
        from (select distinct part_id from parts) p
        left join public.stock_balances sb
               on sb.entity_id = v_entity and sb.item_id = p.part_id
              and exists (select 1 from public.bins b
                            join public.warehouses w on w.id = b.warehouse_id
                           where b.id = sb.bin_id and b.kind = 'storage' and b.archived_at is null
                             and w.kind in ('godown', 'factory') and w.archived_at is null)
       group by p.part_id),
    per_line as (
      select p.line_id, p.position, p.qty, bool_or(p.is_kit) as is_kit,
             min(pg_catalog.floor(f.qty / p.per_unit)) as kits,
             min(f.qty) as item_free
        from parts p join free f on f.part_id = p.part_id
       group by p.line_id, p.position, p.qty)
    select pl.line_id,
           case when (case when pl.is_kit then pl.kits else pl.item_free end) >= pl.qty then 'covered'
                when (case when pl.is_kit then pl.kits else pl.item_free end) > 0 then 'partly_covered'
                else 'short' end,
           null::date,
           case when v_counts then (case when pl.is_kit then pl.kits else pl.item_free end) end,
           null::numeric,
           null::numeric
      from per_line pl
     order by pl.position;
end
$$;
--> statement-breakpoint
revoke execute on function app.line_availability(text, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.line_availability(text, uuid) to app_user, app_reader;
