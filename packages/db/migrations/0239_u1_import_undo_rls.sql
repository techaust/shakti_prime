-- U1 review M4, M5 and L9: undoing a vendor list's import, and keeping only its mapped cells.
--
-- 1. import_rows.undo_json (0235) is written by the commit of a vendors row that updated a vendor
--    (what the vendor was before, and when the row changed it), so a rollback restores it.
grant update (undo_json) on import_rows to app_user;
--> statement-breakpoint

-- 2. A rollback of a vendor list removes the vendors the job added that nothing refers to yet (no
--    quote and no item supplied): no request may delete a vendor, so this definer does it, for the
--    vendors the job's own committed rows name and nothing else. A vendor something refers to is
--    archived instead, as before; an import of its GSTIN later brings it back. The caller needs
--    imports.write and procurement.po.write for the job's company, as the import's commands do.
--    Answers how many it removed and how many it archived.
create or replace function app.import_vendors_undo(p_entity smallint, p_job uuid, p_ids uuid[])
  returns table (removed integer, archived integer)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_ids uuid[];
  v_free uuid[];
  v_removed integer := 0;
  v_archived integer := 0;
begin
  if v_actor is null
     or not app.has_perm('imports.write:entity')
     or not app.has_perm('procurement.po.write:entity') then
    raise exception 'imports.write and procurement.po.write are required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not exists (select 1 from public.import_jobs j
                  where j.id = p_job and j.entity_id = p_entity and j.kind = 'vendors') then
    raise exception 'no vendors import of the company' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct r.created_id), '{}'::uuid[]) into v_ids
    from public.import_rows r
   where r.job_id = p_job and r.created_type = 'vendor' and r.state = 'committed'
     and r.created_id = any (coalesce(p_ids, '{}'::uuid[]));
  select coalesce(array_agg(v.id), '{}'::uuid[]) into v_free
    from public.vendors v
   where v.id = any (v_ids)
     and not exists (select 1 from public.vendor_quotes q where q.vendor_id = v.id)
     and not exists (select 1 from public.item_vendors iv where iv.vendor_id = v.id);
  delete from public.vendor_contacts c where c.vendor_id = any (v_free);
  delete from public.vendors v where v.id = any (v_free);
  get diagnostics v_removed = row_count;
  update public.vendors v set is_active = false, updated_by = v_actor
   where v.id = any (v_ids) and not (v.id = any (v_free)) and v.is_active;
  get diagnostics v_archived = row_count;
  return query select v_removed, v_archived;
end
$$;
--> statement-breakpoint
revoke all on function app.import_vendors_undo(smallint, uuid, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_vendors_undo(smallint, uuid, uuid[]) to app_user;
--> statement-breakpoint

-- 3. A vendor list's rows keep only the cells of its mapped columns once the person commits the
--    job (review L9): a sheet's other columns, a supplier's rates among them, are not kept for
--    every holder of imports.write in the company to read. raw_json is never updated by a request,
--    so this definer does it, for a vendors job of a company of the request only.
create or replace function app.import_rows_keep_columns(p_entity smallint, p_job uuid, p_columns text[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if app.user_id() is null or not app.has_perm('imports.write:entity') then
    raise exception 'imports.write is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not exists (select 1 from public.import_jobs j
                  where j.id = p_job and j.entity_id = p_entity and j.kind = 'vendors') then
    raise exception 'no vendors import of the company' using errcode = '42501';
  end if;
  update public.import_rows r
     set raw_json = (select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                       from pg_catalog.jsonb_each(r.raw_json) e
                      where e.key = any (coalesce(p_columns, '{}'::text[])))
   where r.job_id = p_job and r.raw_json is not null;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;
--> statement-breakpoint
revoke all on function app.import_rows_keep_columns(smallint, uuid, text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_rows_keep_columns(smallint, uuid, text[]) to app_user;
