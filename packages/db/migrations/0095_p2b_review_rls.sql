-- The imports upgrade after review (docs/design/phase1.md §6.3): the companies a job's rows name,
-- the import worker's own way to stop a job, the site PIN check after a PIN code import, and the
-- customers a rollback must keep.

-- The companies the preview found a job's rows naming are a working column of the job.
grant update (entity_ids) on import_jobs to app_user;
--> statement-breakpoint

-- imports.process: held only by the platform's workers (system:workers), never by a person's role.
-- The import worker stops a job whose last queue try failed as that principal, whatever became of
-- the person who asked for the commit (docs/SECURITY.md §3.3).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process']::text[]
$$;
--> statement-breakpoint
create policy import_jobs_process_read on import_jobs for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('imports.process:entity')));
--> statement-breakpoint
create policy import_jobs_process_update on import_jobs for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('imports.process:entity')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('imports.process:entity')));
--> statement-breakpoint

-- A site's PIN (PRD CRM-02), as before, and now also checked again whenever a site still waiting
-- for its PIN to be checked is written with its PIN unchanged: a PIN the master has since learned
-- clears the flag and fills only the tehsil, district and state the site leaves empty.
create or replace function app.customer_sites_pin_fill() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_known boolean;
  v_taluk text;
  v_district text;
  v_state text;
  v_recheck boolean := false;
begin
  if new.pin is null then
    new.pin_needs_review := false;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.pin is not distinct from old.pin then
    if not old.pin_needs_review then
      return new;
    end if;
    v_recheck := true;
  end if;
  select count(*) > 0,
         case when count(distinct p.taluk) = 1 and count(p.taluk) = count(*) then min(p.taluk) end,
         case when count(distinct p.district) = 1 then min(p.district) end,
         case when count(distinct p.state_code) = 1 and count(p.state_code) = count(*)
              then min(p.state_code) end
    into v_known, v_taluk, v_district, v_state
    from public.pin_codes p
   where p.pin = new.pin;
  new.pin_needs_review := not v_known;
  if not v_known then
    return new;
  end if;
  if tg_op = 'INSERT' or v_recheck then
    new.tehsil := coalesce(new.tehsil, v_taluk);
    new.district := coalesce(new.district, v_district);
    new.state_code := coalesce(new.state_code, v_state);
  else
    if new.tehsil is not distinct from old.tehsil then
      new.tehsil := coalesce(v_taluk, new.tehsil);
    end if;
    if new.district is not distinct from old.district then
      new.district := coalesce(v_district, new.district);
    end if;
    if new.state_code is not distinct from old.state_code then
      new.state_code := coalesce(v_state, new.state_code);
    end if;
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop trigger customer_sites_pin_fill on customer_sites;
--> statement-breakpoint
create trigger customer_sites_pin_fill before insert or update on customer_sites
  for each row execute function app.customer_sites_pin_fill();
--> statement-breakpoint

-- After a PIN code import adds offices (or its rollback removes them), the live sites with those
-- PINs whose flag no longer fits the master are checked again: a PIN now known clears the flag and
-- fills the empty tehsil, district and state; a PIN no longer known is flagged again. The sites of
-- every company are concerned and the importer may not see them all, so this runs as a definer,
-- only for the PIN code import's own caller (imports.write at scope all, in a request for every
-- company, as the master is written), and answers a count only.
create or replace function app.recheck_site_pins(p_pins text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if app.user_id() is null or not app.has_perm('imports.write:all')
     or not app.request_covers_group() then
    raise exception 'permission imports.write:all in a request for every company required'
      using errcode = 'insufficient_privilege';
  end if;
  with wanted as (
    select distinct w.pin from pg_catalog.unnest(p_pins) as w(pin) where w.pin is not null
  ), known as (
    select w.pin,
           count(p.id) > 0 as known,
           case when count(distinct p.taluk) = 1 and count(p.taluk) = count(p.id)
                then min(p.taluk) end as taluk,
           case when count(distinct p.district) = 1 then min(p.district) end as district,
           case when count(distinct p.state_code) = 1 and count(p.state_code) = count(p.id)
                then min(p.state_code) end as state_code
      from wanted w
      left join public.pin_codes p on p.pin = w.pin
     group by w.pin
  )
  update public.customer_sites s
     set pin_needs_review = not k.known,
         tehsil = case when k.known then coalesce(s.tehsil, k.taluk) else s.tehsil end,
         district = case when k.known then coalesce(s.district, k.district) else s.district end,
         state_code = case when k.known then coalesce(s.state_code, k.state_code)
                           else s.state_code end,
         updated_by = app.user_id()
    from known k
   where s.pin = k.pin
     and s.archived_at is null
     and s.pin_needs_review = k.known;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
--> statement-breakpoint
revoke execute on function app.recheck_site_pins(text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.recheck_site_pins(text[]) to app_user;
--> statement-breakpoint

-- Which customers a customers import made are now in use, so its rollback keeps them: a live lead
-- of any company, a consent of one of its contacts, or a relationship with a company that was not
-- made with the customer (another company took the customer on since). The policies would show
-- the caller only what their own companies hold, so this runs as a definer, answers only the ids
-- of the job's own customers that are in use, and only to a caller who may import in the job's
-- company within the request.
create or replace function app.import_accounts_in_use(p_job uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
begin
  select j.entity_id into v_entity
    from public.import_jobs j
   where j.id = p_job and j.kind = 'accounts';
  if not found or app.user_id() is null
     or not (v_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
     or not app.has_perm('imports.write:entity') then
    raise exception 'import job % is outside the request scope', p_job
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.created_id
      from public.import_rows r
      join public.accounts a on a.id = r.created_id
     where r.job_id = p_job
       and r.state = 'committed'
       and r.created_type = 'account'
       and (exists (select 1 from public.opportunities o
                     where o.account_id = a.id and o.archived_at is null)
            or exists (select 1
                         from public.account_contacts ac
                         join public.consents c on c.contact_id = ac.contact_id
                        where ac.account_id = a.id)
            or exists (select 1 from public.account_entities ae
                        where ae.account_id = a.id and ae.created_at <> a.created_at));
end
$$;
--> statement-breakpoint
revoke execute on function app.import_accounts_in_use(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_accounts_in_use(uuid) to app_user;
