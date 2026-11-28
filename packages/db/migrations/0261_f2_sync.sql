-- F2 sync engine (docs/03-roadmap-appendix/phase4.md §7.4, ADR 0012): what the field app's pull and
-- push read beyond the tables' own policies.
--
-- 1. Per-field stamps on customer_sites: when each field a person edits last changed and by whom,
--    so an edit made offline merges field by field (`field_newer_on_server` only for a field
--    someone else changed after the engineer did). Kept by a trigger on every update; a value the
--    statement sets itself is replaced, so nobody writes a stamp by hand. The trigger is named to
--    run after customer_sites_pin_fill, whose district and tehsil follow the PIN and are not a
--    person's edit.
create or replace function app.customer_sites_stamp_fields() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_stamp jsonb := pg_catalog.jsonb_build_object('at', pg_catalog.now(), 'by', app.user_id());
  v_stamps jsonb := coalesce(old.field_changed_at, '{}'::jsonb);
begin
  if new.type is distinct from old.type then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('type', v_stamp);
  end if;
  if new.address is distinct from old.address then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('address', v_stamp);
  end if;
  if new.village is distinct from old.village then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('village', v_stamp);
  end if;
  if new.tehsil is distinct from old.tehsil then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('tehsil', v_stamp);
  end if;
  if new.district is distinct from old.district then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('district', v_stamp);
  end if;
  if new.pin is distinct from old.pin then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('pin', v_stamp);
  end if;
  if new.state_code is distinct from old.state_code then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('stateCode', v_stamp);
  end if;
  if new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    v_stamps := v_stamps || pg_catalog.jsonb_build_object('location', v_stamp);
  end if;
  new.field_changed_at := v_stamps;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_sites_stamp_fields() from public, readonly_reporter;
--> statement-breakpoint
create trigger customer_sites_stamp_fields before update on customer_sites
  for each row execute function app.customer_sites_stamp_fields();
--> statement-breakpoint

-- 2. The sites of the projects a caller reads, for the field app's `customer_sites` collection. A
--    Field Engineer reads a project they are on but not its customer (crm.account.read at `own`
--    scope is the customer's owner's), and needs the place to do the job: its type, village,
--    tehsil, district, PIN, state and map point. Never an address line or a phone number, as
--    app.project_customers() (J1) gives none. One row per project named that the caller reads
--    (projects.read for the company, or a project they own or are on) and that has a site, with
--    the project's own time of making, which the sync's membership check reads.
create or replace function app.sync_project_sites(p_projects uuid[])
  returns table (project_id uuid, project_created_at timestamptz, id uuid, account_id uuid,
                 type text, village text, tehsil text, district text, pin text, state_code text,
                 lat numeric, lng numeric, archived_at timestamptz, created_at timestamptz,
                 updated_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.read:own') then
    raise exception 'projects.read is required' using errcode = '42501';
  end if;
  return query
    select p.id, p.created_at, s.id, s.account_id, s.type, s.village, s.tehsil, s.district, s.pin,
           s.state_code, s.lat, s.lng, s.archived_at, s.created_at, s.updated_at
      from public.projects p
      join public.customer_sites s on s.id = p.site_id
     where p.id = any (p_projects)
       and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and (app.has_perm('projects.read:entity') or app.project_is_mine(p.id));
end
$$;
--> statement-breakpoint
revoke execute on function app.sync_project_sites(uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.sync_project_sites(uuid[]) to app_user, app_reader;
