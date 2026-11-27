-- H3 stock counts (docs/03-roadmap-appendix/phase3.md §7.3): row security, grants, the guard of a
-- count's state and the definers of its lines.
-- A count belongs to one company and one hub. Its header is read by company with
-- inventory.stock.read or inventory.stock.move, started with inventory.stock.adjust and moved on
-- by the count commands. Its lines are blind to the counter: no request role selects
-- stock_count_lines.expected_qty (column grants), the rows themselves are read only with
-- inventory.stock.adjust (a serial's line would tell a counter how many serials to look for), and
-- every line is written only by the definers below. A counter (inventory.stock.move) reads the
-- bins and items to count through app.stock_count_sheet(), which never selects the expected
-- quantity; the Inventory Manager reads the expected quantities and the variances through
-- app.stock_count_review(), which checks inventory.stock.adjust.
-- The expected quantity a variance is taken from is the ledger's at the moment the line was
-- counted: the balance now less every movement into or out of the bin since then. So a movement
-- during the count is folded in, the count never freezes the hub, and the result does not change
-- when movements commit while the count posts.

-- 1. updated_at
create trigger set_updated_at before update on stock_counts
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. stock_counts: by company. Started only with inventory.stock.adjust, as the starter, open;
--    changed by the counter (inventory.stock.move) and the Inventory Manager. Only the state and
--    its stamps change (column grants); the guard keeps the machine's moves and their grants.
alter table stock_counts enable row level security;
--> statement-breakpoint
alter table stock_counts force row level security;
--> statement-breakpoint
create policy stock_counts_read on stock_counts for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('inventory.stock.read:entity'))
       or (select app.has_perm('inventory.stock.move:entity'))));
--> statement-breakpoint
create policy stock_counts_insert on stock_counts for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.adjust:entity'))
  and started_by = (select app.user_id())
  and state = 'open');
--> statement-breakpoint
create policy stock_counts_update on stock_counts for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('inventory.stock.move:entity'))
              or (select app.has_perm('inventory.stock.adjust:entity'))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id()));
--> statement-breakpoint
create or replace function app.stock_counts_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if old.state in ('posted', 'cancelled') then
    raise exception 'a closed count does not change'
      using errcode = 'check_violation', constraint = 'stock_count_closed';
  end if;
  if new.state is distinct from old.state then
    v_ok := case
      when old.state = 'open' and new.state = 'counting' then app.has_perm('inventory.stock.move:entity')
      when old.state = 'counting' and new.state = 'review' then app.has_perm('inventory.stock.move:entity')
      when old.state = 'review' and new.state = 'counting' then app.has_perm('inventory.stock.adjust:entity')
      when old.state = 'review' and new.state = 'posted' then app.has_perm('inventory.stock.adjust:entity')
      when new.state = 'cancelled' then app.has_perm('inventory.stock.adjust:entity')
      else false end;
    if not v_ok then
      raise exception 'a count does not move from % to % this way', old.state, new.state
        using errcode = 'check_violation', constraint = 'stock_count_transition';
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_counts_guard() from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint
create trigger stock_counts_guard before update on stock_counts
  for each row execute function app.stock_counts_guard();
--> statement-breakpoint
revoke all on stock_counts from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert on stock_counts to app_user;
--> statement-breakpoint
grant update (state, state_changed_at, submitted_at, submitted_by, posted_at, posted_by, post_note,
              cancelled_at, cancelled_by, cancel_reason, updated_by, updated_at) on stock_counts to app_user;
--> statement-breakpoint
grant select on stock_counts to app_reader;
--> statement-breakpoint

-- 3. stock_count_lines: read only with inventory.stock.adjust, and never the expected quantity
--    (column grants, for every request role); written only by the definers below.
alter table stock_count_lines enable row level security;
--> statement-breakpoint
alter table stock_count_lines force row level security;
--> statement-breakpoint
create policy stock_count_lines_read on stock_count_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('inventory.stock.adjust:entity')));
--> statement-breakpoint
revoke all on stock_count_lines from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select (id, entity_id, count_id, bin_id, item_id, serial_id, counted_qty, counted_by, counted_at,
              recount_requested_at, recount_requested_by, recount_qty, recounted_by, recounted_at,
              created_at)
  on stock_count_lines to app_user, app_reader;
--> statement-breakpoint

-- 4. app.stock_count_refuse(): a count's refusal, as app.stock_refuse() raises the ledger's:
--    check_violation named by its catalogue reason, with the facts a screen names (ids, codes and
--    serial numbers, never a quantity) as JSON in the detail. Called by the definers only.
create or replace function app.stock_count_refuse(p_reason text, p_detail jsonb default '{}'::jsonb)
  returns void
  language plpgsql set search_path = '' as $$
begin
  raise exception 'stock count refused: %', p_reason
    using errcode = 'check_violation', constraint = p_reason, detail = p_detail::text;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_refuse(text, jsonb) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 5. app.stock_count_of(count, grant): the count's company, hub, scope, state and start, refused
--    unless the caller holds the grant and the request covers the count's company. Called by the
--    definers only.
create or replace function app.stock_count_of(p_count uuid, p_perm text)
  returns table (entity_id smallint, warehouse_id uuid, scope text, scope_bin_ids uuid[],
                 scope_item_ids uuid[], state text, started_at timestamptz)
  language plpgsql stable set search_path = '' as $$
begin
  if not app.has_perm(p_perm) then
    raise exception '% is required for a stock count', p_perm using errcode = '42501';
  end if;
  return query
    select c.entity_id, c.warehouse_id, c.scope, c.scope_bin_ids, c.scope_item_ids, c.state, c.started_at
      from public.stock_counts c
     where c.id = p_count and c.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if not found then
    raise exception 'count % is outside the request', p_count using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_of(uuid, text) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 6. app.stock_count_moved(company, bin, item, after): the net quantity moved into the bin (in
--    less out) after the moment given, through the ledger's bin indexes. Called by the definers
--    only.
create or replace function app.stock_count_moved(p_entity smallint, p_bin uuid, p_item uuid, p_after timestamptz)
  returns numeric
  language sql stable set search_path = '' as $$
  select coalesce((select sum(m.qty) from public.stock_movements m
                    where m.to_bin_id = p_bin and m.moved_at > p_after
                      and m.entity_id = p_entity and m.item_id = p_item), 0)
       - coalesce((select sum(m.qty) from public.stock_movements m
                    where m.from_bin_id = p_bin and m.moved_at > p_after
                      and m.entity_id = p_entity and m.item_id = p_item), 0)
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_moved(smallint, uuid, uuid, timestamptz) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 7. app.stock_count_start(count): freezes the expected quantities of an open count that has no
--    lines yet: one line per untracked item a bin of the scope holds, one per serial a bin of the
--    scope holds (in any state that keeps it in a bin). Answers how many lines it made, which the
--    command keeps to itself. Only with inventory.stock.adjust for the count's company.
create or replace function app.stock_count_start(p_count uuid)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count record;
  v_lines integer;
begin
  select * into v_count from app.stock_count_of(p_count, 'inventory.stock.adjust:entity');
  if v_count.state <> 'open'
     or exists (select 1 from public.stock_count_lines l where l.count_id = p_count) then
    perform app.stock_count_refuse('stock_count_started');
  end if;
  insert into public.stock_count_lines (id, entity_id, count_id, bin_id, item_id, expected_qty)
  select app.uuid_v7(), b.entity_id, p_count, b.bin_id, b.item_id, b.qty_on_hand
    from public.stock_balances b
    join public.bins bn on bn.id = b.bin_id and bn.archived_at is null
    join public.items i on i.id = b.item_id and not i.is_serial_tracked
   where b.entity_id = v_count.entity_id and b.warehouse_id = v_count.warehouse_id
     and b.qty_on_hand > 0
     and (v_count.scope_bin_ids is null or b.bin_id = any (v_count.scope_bin_ids))
     and (v_count.scope_item_ids is null or b.item_id = any (v_count.scope_item_ids))
   order by b.bin_id, b.item_id;
  insert into public.stock_count_lines (id, entity_id, count_id, bin_id, item_id, serial_id, expected_qty)
  select app.uuid_v7(), s.entity_id, p_count, s.bin_id, s.item_id, s.id, 1
    from public.bins bn
    join public.serials s on s.bin_id = bn.id
   where bn.warehouse_id = v_count.warehouse_id and bn.archived_at is null
     and s.entity_id = v_count.entity_id
     and s.state in ('in_stock', 'reserved', 'picked', 'faulty')
     and (v_count.scope_bin_ids is null or s.bin_id = any (v_count.scope_bin_ids))
     and (v_count.scope_item_ids is null or s.item_id = any (v_count.scope_item_ids))
   order by s.bin_id, s.item_id, s.id;
  select count(*)::int into v_lines from public.stock_count_lines l where l.count_id = p_count;
  return v_lines;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_start(uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.stock_count_start(uuid) to app_user;
--> statement-breakpoint

-- 8. app.stock_count_record(count, bin, item, qty, serial numbers): a counter's count of one item
--    in one bin, a quantity for an untracked item or every serial found for a tracked one (none
--    is a count too), while the count is open or counting. The bin is the count's hub's and in
--    its scope, the item too. A line the start did not list (stock found where none was expected)
--    is added with the expected quantity the bin held when the count started. While the Inventory
--    Manager has asked for the item in the bin again, the count is the recount; otherwise it
--    replaces the earlier one. A serial number is the company's serial of the item (in any case),
--    and is counted in one bin of the count at a time. Answers nothing. Only with
--    inventory.stock.move for the count's company.
create or replace function app.stock_count_record(p_count uuid, p_bin uuid, p_item uuid,
                                                  p_qty numeric, p_serial_nos text[])
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count record;
  v_actor uuid := app.user_id();
  v_hub uuid;
  v_bin_archived boolean;
  v_tracked boolean;
  v_recount boolean;
  v_requested_at timestamptz;
  v_requested_by uuid;
  v_serials uuid[];
  v_unknown text;
  v_elsewhere record;
begin
  select * into v_count from app.stock_count_of(p_count, 'inventory.stock.move:entity');
  if v_count.state not in ('open', 'counting') then
    perform app.stock_count_refuse('stock_count_not_counting');
  end if;
  select b.warehouse_id, b.archived_at is not null into v_hub, v_bin_archived
    from public.bins b where b.id = p_bin;
  if not found or v_hub <> v_count.warehouse_id or v_bin_archived
     or (v_count.scope_bin_ids is not null and not (p_bin = any (v_count.scope_bin_ids))) then
    perform app.stock_count_refuse('stock_count_bin_outside', pg_catalog.jsonb_build_object('binId', p_bin));
  end if;
  select i.is_serial_tracked into v_tracked from public.items i where i.id = p_item;
  if not found
     or (v_count.scope_item_ids is not null and not (p_item = any (v_count.scope_item_ids))) then
    perform app.stock_count_refuse('stock_count_item_outside', pg_catalog.jsonb_build_object('itemId', p_item));
  end if;
  if v_tracked <> (p_serial_nos is not null) or (p_qty is null) = (p_serial_nos is null)
     or (p_qty is not null and (p_qty < 0 or p_qty <> pg_catalog.round(p_qty, 3))) then
    perform app.stock_count_refuse(case when v_tracked then 'stock_serial_required'
                                        else 'stock_serial_untracked' end);
  end if;

  -- The item's lines in the bin, locked, so two counters of one bin take turns.
  perform 1 from public.stock_count_lines l
   where l.count_id = p_count and l.bin_id = p_bin and l.item_id = p_item
   order by l.id for update;
  select l.recount_requested_at, l.recount_requested_by into v_requested_at, v_requested_by
    from public.stock_count_lines l
   where l.count_id = p_count and l.bin_id = p_bin and l.item_id = p_item
     and l.recount_requested_at is not null
   limit 1;
  v_recount := v_requested_at is not null;

  if not v_tracked then
    insert into public.stock_count_lines (id, entity_id, count_id, bin_id, item_id, expected_qty)
    select app.uuid_v7(), v_count.entity_id, p_count, p_bin, p_item,
           greatest(0, coalesce((select b.qty_on_hand from public.stock_balances b
                                  where b.entity_id = v_count.entity_id and b.bin_id = p_bin
                                    and b.item_id = p_item), 0)
                       - app.stock_count_moved(v_count.entity_id, p_bin, p_item, v_count.started_at))
    on conflict (count_id, bin_id, item_id) where serial_id is null do nothing;
    if v_recount then
      update public.stock_count_lines
         set recount_qty = p_qty, recounted_by = v_actor, recounted_at = pg_catalog.now()
       where count_id = p_count and bin_id = p_bin and item_id = p_item and serial_id is null;
    else
      update public.stock_count_lines
         set counted_qty = p_qty, counted_by = v_actor, counted_at = pg_catalog.now()
       where count_id = p_count and bin_id = p_bin and item_id = p_item and serial_id is null;
    end if;
    return;
  end if;

  select n into v_unknown
    from pg_catalog.unnest(p_serial_nos) as n
   where not exists (select 1 from public.serials s
                      where s.entity_id = v_count.entity_id and s.item_id = p_item
                        and pg_catalog.lower(s.serial_no) = pg_catalog.lower(pg_catalog.btrim(n)))
   limit 1;
  if found then
    perform app.stock_count_refuse('stock_count_serial_unknown',
      pg_catalog.jsonb_build_object('serialNo', v_unknown));
  end if;
  select coalesce(pg_catalog.array_agg(s.id order by s.id), '{}'::uuid[]) into v_serials
    from public.serials s
   where s.entity_id = v_count.entity_id and s.item_id = p_item
     and pg_catalog.lower(s.serial_no) in (select pg_catalog.lower(pg_catalog.btrim(n))
                                             from pg_catalog.unnest(p_serial_nos) as n);
  select s.serial_no, b.code as bin_code into v_elsewhere
    from public.stock_count_lines l
    join public.serials s on s.id = l.serial_id
    join public.bins b on b.id = l.bin_id
   where l.count_id = p_count and l.serial_id = any (v_serials) and l.bin_id <> p_bin
     and (case when l.recount_requested_at is not null then l.recount_qty else l.counted_qty end) = 1
   limit 1;
  if found then
    perform app.stock_count_refuse('stock_count_serial_counted_elsewhere',
      pg_catalog.jsonb_build_object('serialNo', v_elsewhere.serial_no, 'binCode', v_elsewhere.bin_code));
  end if;

  -- A serial found where the start did not list it was not in this bin then. Found in a recount,
  -- the first count did not find it.
  insert into public.stock_count_lines (id, entity_id, count_id, bin_id, item_id, serial_id, expected_qty,
                                        counted_qty, counted_by, counted_at,
                                        recount_requested_at, recount_requested_by)
  select app.uuid_v7(), v_count.entity_id, p_count, p_bin, p_item, x.id, 0,
         case when v_recount then 0 end, case when v_recount then v_actor end,
         case when v_recount then pg_catalog.now() end,
         v_requested_at, v_requested_by
    from pg_catalog.unnest(v_serials) as x(id)
   where not exists (select 1 from public.stock_count_lines l
                      where l.count_id = p_count and l.bin_id = p_bin and l.serial_id = x.id)
   order by x.id;
  if v_recount then
    update public.stock_count_lines
       set recount_qty = case when serial_id = any (v_serials) then 1 else 0 end,
           recounted_by = v_actor, recounted_at = pg_catalog.now()
     where count_id = p_count and bin_id = p_bin and item_id = p_item and serial_id is not null;
  else
    update public.stock_count_lines
       set counted_qty = case when serial_id = any (v_serials) then 1 else 0 end,
           counted_by = v_actor, counted_at = pg_catalog.now()
     where count_id = p_count and bin_id = p_bin and item_id = p_item and serial_id is not null;
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_record(uuid, uuid, uuid, numeric, text[]) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.stock_count_record(uuid, uuid, uuid, numeric, text[]) to app_user;
--> statement-breakpoint

-- 9. app.stock_count_recount(count, bin, item): the Inventory Manager asks for an item in a bin
--    again, once every line of it is counted; an earlier recount is set aside. Answers whether the
--    count has that item in that bin. Only with inventory.stock.adjust for the count's company.
create or replace function app.stock_count_recount(p_count uuid, p_bin uuid, p_item uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count record;
  v_lines integer;
  v_uncounted integer;
begin
  select * into v_count from app.stock_count_of(p_count, 'inventory.stock.adjust:entity');
  if v_count.state not in ('counting', 'review') then
    perform app.stock_count_refuse('stock_count_not_counting');
  end if;
  perform 1 from public.stock_count_lines l
   where l.count_id = p_count and l.bin_id = p_bin and l.item_id = p_item
   order by l.id for update;
  select count(*)::int, (count(*) filter (where l.counted_qty is null))::int
    into v_lines, v_uncounted
    from public.stock_count_lines l
   where l.count_id = p_count and l.bin_id = p_bin and l.item_id = p_item;
  if v_lines = 0 then
    return false;
  end if;
  if v_uncounted > 0 then
    perform app.stock_count_refuse('stock_count_uncounted');
  end if;
  update public.stock_count_lines
     set recount_requested_at = pg_catalog.now(), recount_requested_by = app.user_id(),
         recount_qty = null, recounted_by = null, recounted_at = null
   where count_id = p_count and bin_id = p_bin and item_id = p_item;
  return true;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_recount(uuid, uuid, uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.stock_count_recount(uuid, uuid, uuid) to app_user;
--> statement-breakpoint

-- 10. app.stock_count_sheet(count): what a counter sees, one row per item in a bin: the bin, the
--     item, whether it is still to count, counted or asked for again, and what the counter
--     entered (the quantity, or the serials found), never what the ledger expects. A recount
--     shows nothing of the earlier count. Only with inventory.stock.move for the count's company.
create or replace function app.stock_count_sheet(p_count uuid)
  returns table (bin_id uuid, bin_code text, item_id uuid, sku text, item_name text, unit text,
                 is_serial_tracked boolean, serial_pattern text, line_state text,
                 counted_qty numeric, serial_nos text[])
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from app.stock_count_of(p_count, 'inventory.stock.move:entity');
  return query
    with g as (
      select l.bin_id, l.item_id,
             bool_or(l.recount_requested_at is not null and l.recounted_at is null) as recount_open,
             bool_and(l.counted_qty is not null) as counted,
             sum(case when l.recount_requested_at is not null then l.recount_qty else l.counted_qty end) as qty,
             pg_catalog.array_agg(s.serial_no order by s.serial_no)
               filter (where (case when l.recount_requested_at is not null then l.recount_qty
                                   else l.counted_qty end) = 1) as serials
        from public.stock_count_lines l
        left join public.serials s on s.id = l.serial_id
       where l.count_id = p_count
       group by l.bin_id, l.item_id)
    select g.bin_id, b.code, g.item_id, i.sku, i.name, i.unit, i.is_serial_tracked, i.serial_pattern,
           case when g.recount_open then 'recount' when g.counted then 'counted' else 'to_count' end,
           case when g.counted and not g.recount_open then g.qty end,
           case when g.counted and not g.recount_open and i.is_serial_tracked
                then coalesce(g.serials, '{}'::text[]) end
      from g
      join public.bins b on b.id = g.bin_id
      join public.items i on i.id = g.item_id
     order by b.code, i.sku;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_sheet(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stock_count_sheet(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 11. app.stock_count_progress(count): how many items in bins the count has, how many are still
--     to count and how many are asked for again, counted per item in a bin and never per serial.
--     With inventory.stock.move or inventory.stock.adjust for the count's company.
create or replace function app.stock_count_progress(p_count uuid)
  returns table (items_in_bins integer, to_count integer, recount_open integer)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from app.stock_count_of(p_count,
    case when app.has_perm('inventory.stock.move:entity') then 'inventory.stock.move:entity'
         else 'inventory.stock.adjust:entity' end);
  return query
    select count(*)::int,
           (count(*) filter (where not g.counted))::int,
           (count(*) filter (where g.recount_open))::int
      from (select bool_and(l.counted_qty is not null) as counted,
                   bool_or(l.recount_requested_at is not null and l.recounted_at is null) as recount_open
              from public.stock_count_lines l
             where l.count_id = p_count
             group by l.bin_id, l.item_id) g;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_progress(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stock_count_progress(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 12. app.stock_count_review(count): every line with its expected quantity, for the Inventory
--     Manager's review and the posting. `final_qty` is the count that stands (the recount once one
--     is asked for) and `counted_at` when it was taken (null while uncounted or asked for again);
--     `expected_at_count` is
--     what the ledger held in the bin then: for an untracked item the balance now less what moved
--     since, for a serial 1 if it was in the bin then (where its first movement since took it
--     from, or else where it is now). `serial_moved_since` says a serial moved after its count by
--     anything but this count's own posting. Only with inventory.stock.adjust for the count's
--     company; never a cost.
create or replace function app.stock_count_review(p_count uuid)
  returns table (line_id uuid, bin_id uuid, item_id uuid, serial_id uuid, serial_no text,
                 expected_qty numeric, counted_qty numeric, recount_qty numeric, recount_open boolean,
                 final_qty numeric, counted_at timestamptz, expected_at_count numeric,
                 serial_moved_since boolean, serial_state text, serial_bin_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform 1 from app.stock_count_of(p_count, 'inventory.stock.adjust:entity');
  return query
    with l as (
      select x.*,
             case when x.recount_requested_at is not null then x.recounted_at else x.counted_at end as t
        from public.stock_count_lines x
       where x.count_id = p_count)
    select l.id, l.bin_id, l.item_id, l.serial_id, s.serial_no, l.expected_qty, l.counted_qty,
           l.recount_qty, (l.recount_requested_at is not null and l.recounted_at is null),
           case when l.recount_requested_at is not null then l.recount_qty else l.counted_qty end,
           l.t,
           case
             when l.serial_id is null then
               coalesce((select b.qty_on_hand from public.stock_balances b
                          where b.entity_id = l.entity_id and b.bin_id = l.bin_id
                            and b.item_id = l.item_id), 0)
               - app.stock_count_moved(l.entity_id, l.bin_id, l.item_id,
                                       coalesce(l.t, 'infinity'::timestamptz))
             when (case when f.found then f.from_bin_id
                        when s.state in ('in_stock', 'reserved', 'picked', 'faulty') then s.bin_id
                   end) = l.bin_id then 1::numeric
             else 0::numeric
           end,
           l.serial_id is not null and exists (
             select 1 from public.stock_movements m
              where m.serial_id = l.serial_id and m.moved_at > coalesce(l.t, 'infinity'::timestamptz)
                and (m.ref_type is distinct from 'stock_count' or m.ref_id is distinct from p_count)),
           s.state, s.bin_id
      from l
      left join public.serials s on s.id = l.serial_id
      left join lateral (
        select true as found, m.from_bin_id
          from public.stock_movements m
         where l.serial_id is not null and m.serial_id = l.serial_id
           and m.moved_at > coalesce(l.t, 'infinity'::timestamptz)
         order by m.moved_at, m.id
         limit 1) f on true
     order by l.bin_id, l.item_id, l.serial_id nulls first;
end
$$;
--> statement-breakpoint
revoke execute on function app.stock_count_review(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stock_count_review(uuid) to app_user, app_reader;
