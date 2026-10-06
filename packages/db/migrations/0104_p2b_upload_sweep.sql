-- The sweep of abandoned uploads (files.upload.sweep): the worker principal learns which companies
-- hold an upload still pending after the given minutes, then sweeps each in a request for that
-- company alone. It names companies only, and only to a holder of files.process at scope all,
-- which no person's role holds (system:workers, docs/SECURITY.md §3.3).
create or replace function app.stale_upload_entities(p_minutes integer) returns setof smallint
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_perm('files.process:all') then
    raise exception 'permission files.process:all required' using errcode = 'insufficient_privilege';
  end if;
  return query
    select distinct f.entity_id
      from public.files f
     where f.status = 'pending'
       and f.created_at < pg_catalog.now() - pg_catalog.make_interval(mins => greatest(p_minutes, 0))
     order by f.entity_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.stale_upload_entities(integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stale_upload_entities(integer) to app_user;
--> statement-breakpoint
-- The worker reads the list in a read-only request, on the queries' own role when it is set up.
grant execute on function app.stale_upload_entities(integer) to app_reader;
