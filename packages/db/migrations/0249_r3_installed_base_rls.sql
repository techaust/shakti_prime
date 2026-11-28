-- R3 the installed base (docs/03-roadmap-appendix/phase3.md §7.5): serials the company sold before
-- go-live enter as `with_customer` with their customer, site, delivery date and warranty, and no
-- stock movement, through the import framework. Only app.stock_move() writes a serial's state and
-- bin as stock moves; these two definers are the only other writers of serials, and only for this
-- import: one adds a batch of rows, the other takes back the serials a job added that nothing has
-- used since (a movement or a warranty claim).

-- 1. A customer's serials, which a warranty claim offers to identify.
create index serials_account_idx on serials (account_id, entity_id) where account_id is not null;
--> statement-breakpoint

-- 2. app.installed_base_add(job, rows jsonb): rows of {item_id, serial_no, account_id, site_id |
--    null, delivered_on, warranty_until}, in order, for the job's company; answers the new serials'
--    ids in the rows' order. The caller holds imports.write and inventory.warranty.write for the
--    company, the job is an installed base job of that company being added, each item is tracked
--    by serial, each customer deals with the company and each site is the customer's, each
--    delivery is today or earlier and each warranty ends on or after its delivery; a serial
--    number the item has already is refused by serials_item_serial_no_unique.
create or replace function app.installed_base_add(p_job uuid, p_rows jsonb)
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entity smallint;
  v_kind text;
  v_state text;
  v_row jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
begin
  if v_actor is null
     or not app.has_perm('imports.write:entity')
     or not app.has_perm('inventory.warranty.write:entity') then
    raise exception 'permission imports.write and inventory.warranty.write required to add an installed base'
      using errcode = 'insufficient_privilege';
  end if;
  select j.entity_id, j.kind, j.state into v_entity, v_kind, v_state
    from public.import_jobs j where j.id = p_job;
  if not found or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'import job % outside the request scope', p_job
      using errcode = 'insufficient_privilege';
  end if;
  if v_kind <> 'installed_base' or v_state <> 'committing' then
    raise exception 'import job % is not adding an installed base', p_job
      using errcode = 'check_violation', constraint = 'import_job_state';
  end if;
  for v_row in select * from pg_catalog.jsonb_array_elements(p_rows) loop
    if not exists (select 1 from public.items i
                    where i.id = (v_row ->> 'item_id')::uuid and i.is_serial_tracked) then
      raise exception 'item % is not tracked by serial', v_row ->> 'item_id'
        using errcode = 'check_violation', constraint = 'serial_not_tracked';
    end if;
    if not exists (select 1 from public.account_entities ae
                    where ae.account_id = (v_row ->> 'account_id')::uuid and ae.entity_id = v_entity) then
      raise exception 'customer % does not deal with company %', v_row ->> 'account_id', v_entity
        using errcode = 'check_violation', constraint = 'customer_unknown';
    end if;
    if v_row ->> 'site_id' is not null
       and not exists (select 1 from public.customer_sites cs
                        where cs.id = (v_row ->> 'site_id')::uuid
                          and cs.account_id = (v_row ->> 'account_id')::uuid) then
      raise exception 'site % is not the customer''s', v_row ->> 'site_id'
        using errcode = 'check_violation', constraint = 'site_unknown';
    end if;
    if (v_row ->> 'delivered_on')::date > v_today then
      raise exception 'a delivery date ahead of today'
        using errcode = 'check_violation', constraint = 'date_invalid';
    end if;
    if (v_row ->> 'warranty_until')::date < (v_row ->> 'delivered_on')::date then
      raise exception 'a warranty that ends before its delivery'
        using errcode = 'check_violation', constraint = 'warranty_before_delivery';
    end if;
    v_id := app.uuid_v7();
    insert into public.serials (id, entity_id, item_id, serial_no, state, account_id, site_id,
                                delivered_at, warranty_until, created_by)
    values (v_id, v_entity, (v_row ->> 'item_id')::uuid, v_row ->> 'serial_no', 'with_customer',
            (v_row ->> 'account_id')::uuid, (v_row ->> 'site_id')::uuid,
            ((v_row ->> 'delivered_on')::date)::timestamp at time zone 'Asia/Kolkata',
            (v_row ->> 'warranty_until')::date, v_actor);
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end
$$;
--> statement-breakpoint
revoke execute on function app.installed_base_add(uuid, jsonb) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.installed_base_add(uuid, jsonb) to app_user;
--> statement-breakpoint

-- 3. app.installed_base_remove(job, serials): the rollback of an installed base job takes back
--    the serials it added that are still with their customer with no movement and no warranty
--    claim; the others stay as they are. Answers how many it removed.
create or replace function app.installed_base_remove(p_job uuid, p_serials uuid[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_kind text;
  v_removed integer;
begin
  if app.user_id() is null
     or not app.has_perm('imports.write:entity')
     or not app.has_perm('inventory.warranty.write:entity') then
    raise exception 'permission imports.write and inventory.warranty.write required to undo an installed base'
      using errcode = 'insufficient_privilege';
  end if;
  select j.entity_id, j.kind into v_entity, v_kind from public.import_jobs j where j.id = p_job;
  if not found or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'import job % outside the request scope', p_job
      using errcode = 'insufficient_privilege';
  end if;
  if v_kind <> 'installed_base' then
    raise exception 'import job % is not an installed base', p_job
      using errcode = 'check_violation', constraint = 'import_job_state';
  end if;
  with gone as (
    delete from public.serials s
     where s.id = any (p_serials)
       and s.entity_id = v_entity
       and s.state = 'with_customer'
       and exists (select 1 from public.import_rows r
                    where r.job_id = p_job and r.created_type = 'serial' and r.created_id = s.id)
       and not exists (select 1 from public.stock_movements m where m.serial_id = s.id)
       and not exists (select 1 from public.warranty_claims c
                        where s.id in (c.serial_id, c.replacement_serial_id, c.supplier_serial_id))
    returning 1)
  select count(*)::int into v_removed from gone;
  return v_removed;
end
$$;
--> statement-breakpoint
revoke execute on function app.installed_base_remove(uuid, uuid[]) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.installed_base_remove(uuid, uuid[]) to app_user;
