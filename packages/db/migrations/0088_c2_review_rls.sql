-- The review of the customer timeline slice (docs/design/phase1.md §6.5).

-- 1. SECURITY §3.3: agents work without customers' notes. A note is hidden from an agent request,
--    tested as account_entities_read tests it (0057, 0059): the request's role key is an agent role
--    or its principal is of kind agent. Every other row reads as before; the payloads carry ids
--    and codes only.
drop policy activities_read on activities;
--> statement-breakpoint
create policy activities_read on activities for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and (type <> 'note'
    or (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
               and not exists (select 1 from principals p
                                where p.id = app.user_id() and p.kind = 'agent')))
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.entity_id = activities.entity_id
                       and activities.opportunity_id is not null))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = activities.account_id
                       and ae.entity_id = activities.entity_id
                       and activities.opportunity_id is null))));
--> statement-breakpoint

-- 2. A note is written by someone who may work the lead, on a lead that is not archived, or, for
--    a note on the customer, by someone who may change the customer. Every other row is written
--    as before.
drop policy activities_insert on activities;
--> statement-breakpoint
create policy activities_insert on activities for insert to app_user with check (
  actor_principal_id = (select app.user_id())
  and entity_id = any ((select app.entity_ids())::int[])
  and ((opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.account_id = activities.account_id
                       and o.entity_id = activities.entity_id))
    or (opportunity_id is null
        and exists (select 1 from account_entities ae
                     where ae.account_id = activities.account_id
                       and ae.entity_id = activities.entity_id)))
  and (type <> 'note'
    or (opportunity_id is not null
        and exists (select 1 from opportunities o
                     where o.id = activities.opportunity_id
                       and o.archived_at is null
                       and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)))
    or (opportunity_id is null and app.account_in_scope(account_id, 'crm.account.write'))));
--> statement-breakpoint

-- 3. A number put on a customer's contact is refused when it already belongs to a live contact of
--    another live customer, anywhere in the group, whom the caller may not change in the request's
--    companies: that customer is a colleague's, and a second customer would split their consent and
--    DND history (as app.lead_phone_status(), 0055, does for the lead form). The answer is a status
--    only, never which customer. crm.contact.update holds the lead form's number lock for each
--    company of the request before it asks, so the two cannot race.
create or replace function app.contact_phone_status(p_e164 text, p_account uuid) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_entity boolean := app.has_perm('crm.account.write:entity');
  v_team_scope boolean := app.has_perm('crm.account.write:team');
  v_own boolean := app.has_perm('crm.account.write:own');
begin
  if v_user is null or not v_own then
    raise exception 'permission crm.account.write required' using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1
      from public.contact_phones ph
      join public.contacts c on c.id = ph.contact_id and c.archived_at is null
      join public.account_contacts ac on ac.contact_id = ph.contact_id
      join public.accounts a on a.id = ac.account_id and a.archived_at is null
     where ph.e164 = p_e164
       and a.id is distinct from p_account
       and not exists (
         select 1 from public.account_entities ae
          where ae.account_id = a.id
            and ae.entity_id = any (v_entities)
            and (v_entity
              or (v_team_scope and ae.team_id = v_team)
              or (v_own and ae.owner_id = v_user)))) then
    return 'held_by_other';
  end if;
  return 'clear';
end
$$;
--> statement-breakpoint
revoke execute on function app.contact_phone_status(text, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.contact_phone_status(text, uuid) to app_user;
--> statement-breakpoint

-- 4. The customers search: plans made for each call, as app.lead_search_ids() (0052); a name,
--    contact or village is looked for from three characters and a phone from four digits; and up
--    to 201 ids, so the list can tell a search that found more than the 200 it shows.
create or replace function app.customer_search_ids(
  p_text text,
  p_phone_reversed text,
  p_max integer
) returns setof uuid
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
rows 50
as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := app.entity_ids();
  v_account_entity boolean := app.has_perm('crm.account.read:entity');
  v_account_team boolean := app.has_perm('crm.account.read:team');
  v_account_own boolean := app.has_perm('crm.account.read:own');
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  -- An agent reads a customer by crm.account.read scope only (account_entities_read, 0057).
  v_agent boolean := coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
    or exists (select 1 from public.principals p where p.id = v_user and p.kind = 'agent');
  v_want integer := least(greatest(coalesce(p_max, 0), 1), 201);
  v_text text := pg_catalog.btrim(coalesce(p_text, ''));
  v_phone text := case when pg_catalog.char_length(coalesce(p_phone_reversed, '')) >= 4
                       then p_phone_reversed end;
  v_pattern text;
begin
  if v_user is null or not (v_account_own or v_lead_own) then
    raise exception 'permission crm.account.read or crm.lead.read required'
      using errcode = 'insufficient_privilege';
  end if;
  if pg_catalog.char_length(v_text) < 3 then
    v_text := null;
  end if;
  v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    coalesce(v_text, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hits as (
    select a.id from public.accounts a where v_text is not null and a.name ilike v_pattern
    union
    select ac.account_id from public.account_contacts ac
     where v_text is not null
       and ac.contact_id in (select c.id from public.contacts c where c.name ilike v_pattern)
    union
    select cs.account_id from public.customer_sites cs
     where v_text is not null and cs.village ilike v_pattern and cs.archived_at is null
    union
    select ac.account_id from public.account_contacts ac
     where v_phone is not null
       and ac.contact_id in (select ph.contact_id from public.contact_phones ph
                              where ph.e164_reversed ^@ v_phone)
  )
  select h.id
    from hits h
    join public.accounts a on a.id = h.id and a.archived_at is null
   where exists (
     select 1 from public.account_entities ae
      where ae.account_id = h.id
        and ae.entity_id = any (v_entities)
        and (v_account_entity
          or (v_account_team and ae.team_id = v_team)
          or (v_account_own and ae.owner_id = v_user)
          or (not v_agent and exists (
            select 1 from public.opportunities o
             where o.account_id = ae.account_id
               and o.entity_id = ae.entity_id
               and o.archived_at is null
               and (v_lead_entity
                 or (v_lead_team and o.team_id = v_team)
                 or (v_lead_own and o.owner_id = v_user))))))
   order by a.name, a.id
   limit v_want;
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_search_ids(text, text, integer) from public, readonly_reporter;
--> statement-breakpoint

-- 5. The monthly partitions of the timeline: a month that fails is recorded and the later months
--    are still made. Each run is one row of retention_runs (job activities-partitions): the
--    partitions made, and the months that failed with their errors, which the Integration Health
--    page reads. A failure also raises a warning to pg_cron's log.
create or replace function app.ensure_activity_partitions(p_months_ahead int default 3) returns int
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
declare
  first_month timestamp := date_trunc('month', now() at time zone 'UTC');
  lo timestamptz;
  hi timestamptz;
  part text;
  created int := 0;
  failed text[] := '{}';
  run uuid := app.uuid_v7();
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 24 then
    raise exception 'months ahead must be between 0 and 24' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.retention_runs (id, job, started_at)
  values (run, 'activities-partitions', clock_timestamp());
  for i in 0..p_months_ahead loop
    lo := (first_month + make_interval(months => i)) at time zone 'UTC';
    hi := (first_month + make_interval(months => i + 1)) at time zone 'UTC';
    part := 'activities_' || to_char(lo at time zone 'UTC', 'YYYY_MM');
    begin
      if to_regclass(format('crm_partitions.%I', part)) is null then
        execute format(
          'create table crm_partitions.%I partition of public.activities for values from (%L) to (%L)',
          part, lo, hi);
        created := created + 1;
      end if;
    exception when others then
      failed := failed || (part || ': ' || sqlerrm);
    end;
  end loop;
  update public.retention_runs
     set finished_at = clock_timestamp(),
         rows_affected = created,
         error = case when cardinality(failed) = 0 then null
                      else left(array_to_string(failed, '; '), 500) end
   where id = run;
  if cardinality(failed) > 0 then
    raise warning 'activities-partitions: %', array_to_string(failed, '; ');
  end if;
  return created;
end
$$;
--> statement-breakpoint
revoke execute on function app.ensure_activity_partitions(int) from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 6. A tag's name is unique across its company and the group's own tags together, whatever its
--    case: a company tag may not reuse a group tag's name, nor a group tag a company's. The check
--    reads every company's tags, so it runs as the owner; it holds a lock on the name while it
--    looks, so two tags saved at once with one name cannot both pass. No role calls it directly.
create or replace function app.tag_name_free() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tag-name:' || pg_catalog.lower(new.name), 0));
  if exists (
    select 1 from public.tags t
     where t.id <> new.id
       and pg_catalog.lower(t.name) = pg_catalog.lower(new.name)
       and (new.entity_id is null or t.entity_id is null or t.entity_id = new.entity_id)) then
    raise exception 'tag name is taken'
      using errcode = 'unique_violation', constraint = 'tags_entity_name_unique';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.tag_name_free() from public, readonly_reporter;
--> statement-breakpoint
create trigger tags_name_free before insert or update of name, entity_id on tags
  for each row execute function app.tag_name_free();
