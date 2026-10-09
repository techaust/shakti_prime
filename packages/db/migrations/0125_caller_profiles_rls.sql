-- The handover of qualified leads (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2, ADR 0020):
-- who reads and edits a caller's profile, the platform-only permission of the handover worker and
-- the definers through which it picks a Lead Converter and gives the lead over, and the owner's
-- decision of 09-10-2026 that a round-robin handover moves the customer relationship as a
-- person's handover does.

-- 1. The handover's permission is platform-only, like the other workers' (0123 holds the seven).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run']::text[]
$$;
--> statement-breakpoint

-- 2. Whether the caller manages a person's profile in a company: crm.lead.assign over the company,
--    or at team scope over a person who works in the caller's team there. A definer, since the
--    caller reads no other person's role row.
create or replace function app.caller_profile_manages(p_user uuid, p_entity smallint) returns boolean
  language sql stable security definer set search_path = '' as $$
  select app.has_perm('crm.lead.assign:entity')
      or (app.has_perm('crm.lead.assign:team')
          and app.team_id() is not null
          and exists (select 1 from public.user_entity_roles uer
                       where uer.user_id = p_user and uer.entity_id = p_entity
                         and uer.team_id = app.team_id()))
$$;
--> statement-breakpoint
revoke execute on function app.caller_profile_manages(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.caller_profile_manages(uuid, smallint) to app_user, app_reader;
--> statement-breakpoint

-- 3. caller_profiles: read by the person and by whoever manages them; written by a manager, and a
--    person's own row changes only its presence. Never written by an agent or the system principal.
create or replace function app.caller_profiles_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  new.updated_by := coalesce(app.user_id(), new.updated_by);
  if new.user_id is distinct from old.user_id or new.entity_id is distinct from old.entity_id then
    raise exception 'a profile stays with its person and company' using errcode = 'insufficient_privilege';
  end if;
  if not app.caller_profile_manages(old.user_id, old.entity_id)
     and (new.is_converter is distinct from old.is_converter
          or new.max_open is distinct from old.max_open
          or new.languages is distinct from old.languages
          or new.segments is distinct from old.segments) then
    raise exception 'a person changes only their own presence' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.caller_profiles_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger caller_profiles_guard before update on caller_profiles
  for each row execute function app.caller_profiles_guard();
--> statement-breakpoint
alter table caller_profiles enable row level security;
--> statement-breakpoint
alter table caller_profiles force row level security;
--> statement-breakpoint
create policy caller_profiles_read on caller_profiles for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (user_id = (select app.user_id()) or app.caller_profile_manages(user_id, entity_id)));
--> statement-breakpoint
create policy caller_profiles_insert on caller_profiles for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
              and coalesce(current_setting('app.role', true), '') not like 'system:%')
  and (app.caller_profile_manages(user_id, entity_id)
       or (user_id = (select app.user_id())
           and not is_converter and max_open is null
           and languages = '{}'::text[] and segments = '{}'::text[])));
--> statement-breakpoint
create policy caller_profiles_update on caller_profiles for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
                     and coalesce(current_setting('app.role', true), '') not like 'system:%')
         and (user_id = (select app.user_id()) or app.caller_profile_manages(user_id, entity_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (user_id = (select app.user_id()) or app.caller_profile_manages(user_id, entity_id)));
--> statement-breakpoint
revoke all on caller_profiles from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on caller_profiles to app_user;
--> statement-breakpoint
grant update (is_converter, presence, max_open, languages, segments, updated_at, updated_by) on caller_profiles to app_user;
--> statement-breakpoint
grant select on caller_profiles to app_reader;
--> statement-breakpoint

-- 4. The people a manager sets up (the converters page): the active people of a company who work
--    on leads, with their profile if they have one, and their team. A company-wide manager sees
--    all of them, a team-level one their own team. An agent or the system principal is refused.
create or replace function app.caller_profile_people(p_entity smallint)
  returns table (user_id uuid, name text, team_id uuid, role_key text, profile_id uuid,
                 is_converter boolean, presence text, max_open integer, languages text[],
                 segments text[], updated_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.lead.assign:team')
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'system:%' then
    raise exception 'crm.lead.assign is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select distinct on (u.id) u.id, u.name, uer.team_id, r.key, cp.id,
           coalesce(cp.is_converter, false), coalesce(cp.presence, 'away'), cp.max_open,
           coalesce(cp.languages, '{}'::text[]), coalesce(cp.segments, '{}'::text[]), cp.updated_at
      from public.user_entity_roles uer
      join public.users u on u.id = uer.user_id and u.status = 'active'
      join public.roles r on r.id = uer.role_id
      join public.role_permissions rp on rp.role_id = uer.role_id and rp.permission_key = 'crm.lead.write'
      left join public.caller_profiles cp on cp.user_id = u.id and cp.entity_id = p_entity
     where uer.entity_id = p_entity
       and (app.has_perm('crm.lead.assign:entity')
            or (app.team_id() is not null and uer.team_id = app.team_id()))
     order by u.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.caller_profile_people(smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.caller_profile_people(smallint) to app_user, app_reader;
--> statement-breakpoint

-- 5. Shared check of the handover definers: the handover permission (platform-only, held by
--    system:workers alone) and a company of the request.
create or replace function app.require_handover(p_entity smallint) returns void
  language plpgsql stable set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.handover.run:entity') then
    raise exception 'crm.handover.run is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.require_handover(smallint) from public, readonly_reporter;
--> statement-breakpoint

-- 6. The lead the handover is for: its state, owner and team, its pipeline's segment and lock
--    hours, and the language of its customer's owner contact (hinglish when none is recorded).
create or replace function app.handover_lead_facts(p_entity smallint, p_opportunity uuid)
  returns table (state text, owner_id uuid, team_id uuid, account_id uuid, segment text,
                 lock_hours integer, language text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_handover(p_entity);
  return query
    select o.state, o.owner_id, o.team_id, o.account_id, p.segment, p.lock_hours::integer,
           coalesce((select c.preferred_language
                       from public.account_contacts ac
                       join public.contacts c on c.id = ac.contact_id
                      where ac.account_id = o.account_id
                      order by (ac.role = 'owner') desc, ac.created_at, ac.contact_id
                      limit 1), 'hinglish')
      from public.opportunities o
      join public.pipelines p on p.id = o.pipeline_id
     where o.id = p_opportunity and o.entity_id = p_entity and o.archived_at is null;
end
$$;
--> statement-breakpoint
revoke execute on function app.handover_lead_facts(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.handover_lead_facts(smallint, uuid) to app_user;
--> statement-breakpoint

-- 7. The people who could take a lead: active, with a role in the company that works on leads,
--    with their profile (not a converter, away, when they have none) and their open leads now.
--    Also read by a manager who gives a leaving caller's leads out in turn (crm.lead.reassign_all).
create or replace function app.handover_candidates(p_entity smallint)
  returns table (user_id uuid, team_id uuid, is_converter boolean, presence text, max_open integer,
                 languages text[], segments text[], open_leads integer)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('crm.handover.run:entity') or app.has_perm('crm.lead.assign:team')) then
    raise exception 'crm.handover.run or crm.lead.assign is required' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%' then
    raise exception 'an agent does not hand leads over' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select u.id, w.team_id, coalesce(cp.is_converter, false), coalesce(cp.presence, 'away'),
           cp.max_open, coalesce(cp.languages, '{}'::text[]), coalesce(cp.segments, '{}'::text[]),
           (select pg_catalog.count(*)::integer from public.opportunities o
             where o.entity_id = p_entity and o.owner_id = u.id and o.state = 'open'
               and o.archived_at is null)
      from public.users u
      join lateral (select uer.team_id from public.user_entity_roles uer
                      join public.role_permissions rp
                        on rp.role_id = uer.role_id and rp.permission_key = 'crm.lead.write'
                     where uer.user_id = u.id and uer.entity_id = p_entity
                     order by uer.id limit 1) w on true
      left join public.caller_profiles cp on cp.user_id = u.id and cp.entity_id = p_entity
     where u.status = 'active'
     order by u.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.handover_candidates(smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.handover_candidates(smallint) to app_user;
--> statement-breakpoint

-- 8. The company's Sales Team Lead for a lead: the lead's team's own lead first, else any Sales
--    Team Lead of the lead's team, else any in the company.
create or replace function app.handover_team_lead(p_entity smallint, p_opportunity uuid)
  returns table (user_id uuid, team_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_handover(p_entity);
  return query
    select uer.user_id, uer.team_id
      from public.user_entity_roles uer
      join public.roles r on r.id = uer.role_id and r.key = 'sales_team_lead'
      join public.users u on u.id = uer.user_id and u.status = 'active'
      left join public.opportunities o on o.id = p_opportunity and o.entity_id = p_entity
      left join public.teams t on t.id = o.team_id
     where uer.entity_id = p_entity
     order by (t.lead_principal_id = uer.user_id) desc nulls last,
              (uer.team_id is not distinct from o.team_id) desc, uer.user_id
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.handover_team_lead(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.handover_team_lead(smallint, uuid) to app_user;
--> statement-breakpoint

-- 9. The handover itself. Gives an open lead to a person who works on leads in its company, locks
--    it to them for the pipeline's lock hours, moves the lead's open callbacks and nurture calls
--    to them (a new task at the same time, or now when it is due; the old one cancelled), and
--    writes the lead's timeline rows. A handover already made for the event (its id is in the
--    lead's timeline row) answers 'already' and changes nothing; a lead no longer open answers
--    'not_open'. The customer relationship is moved by app.hand_over_customer() after it.
create or replace function app.handover_assign(p_entity smallint, p_opportunity uuid,
                                               p_owner uuid, p_event uuid)
  returns table (status text, previous_owner uuid, previous_team uuid, team_id uuid,
                 locked_until timestamptz, lock_hours integer, moved jsonb)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_lead public.opportunities%rowtype;
  v_team uuid;
  v_hours integer;
  v_until timestamptz;
  v_moved jsonb := '[]'::jsonb;
  v_task record;
  v_new uuid;
  v_due timestamptz;
begin
  perform app.require_handover(p_entity);
  select * into v_lead from public.opportunities o
   where o.id = p_opportunity and o.entity_id = p_entity and o.archived_at is null
     for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::uuid, null::uuid, null::timestamptz, null::integer, '[]'::jsonb;
    return;
  end if;
  if exists (select 1 from public.activities a
              where a.opportunity_id = p_opportunity and a.type = 'assigned'
                and a.payload_json ->> 'handoverEventId' = p_event::text) then
    return query select 'already'::text, v_lead.owner_id, v_lead.team_id, v_lead.team_id, v_lead.locked_until, null::integer, '[]'::jsonb;
    return;
  end if;
  if v_lead.state <> 'open' then
    return query select 'not_open'::text, v_lead.owner_id, v_lead.team_id, v_lead.team_id, v_lead.locked_until, null::integer, '[]'::jsonb;
    return;
  end if;
  select uer.team_id into v_team
    from public.user_entity_roles uer
    join public.role_permissions rp on rp.role_id = uer.role_id and rp.permission_key = 'crm.lead.write'
    join public.users u on u.id = uer.user_id and u.status = 'active'
   where uer.user_id = p_owner and uer.entity_id = p_entity
   order by uer.id limit 1;
  if not found then
    return query select 'not_eligible'::text, v_lead.owner_id, v_lead.team_id, null::uuid, null::timestamptz, null::integer, '[]'::jsonb;
    return;
  end if;
  select coalesce(p.lock_hours, 48)::integer into v_hours from public.pipelines p where p.id = v_lead.pipeline_id;
  v_until := pg_catalog.now() + pg_catalog.make_interval(hours => v_hours);

  insert into public.activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json)
    values (pg_catalog.gen_random_uuid(), p_entity, p_opportunity, v_lead.account_id, 'assigned', v_actor,
            pg_catalog.jsonb_build_object('fromOwnerId', v_lead.owner_id, 'ownerId', p_owner,
                                          'teamId', v_team, 'handoverEventId', p_event));

  for v_task in
    select t.id, t.kind, t.title, t.due_at from public.tasks t
     where t.opportunity_id = p_opportunity and t.entity_id = p_entity and t.state = 'open'
       and t.kind in ('callback', 'nurture') and t.assignee_id <> p_owner
     order by t.due_at, t.id
  loop
    v_new := pg_catalog.gen_random_uuid();
    v_due := greatest(v_task.due_at, pg_catalog.now());
    insert into public.tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind, title, due_at, created_by)
      values (v_new, p_entity, p_opportunity, v_lead.account_id, p_owner, v_team, v_task.kind, v_task.title, v_due, v_actor);
    update public.tasks set state = 'cancelled', updated_by = v_actor where id = v_task.id;
    insert into public.activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json) values
      (pg_catalog.gen_random_uuid(), p_entity, p_opportunity, v_lead.account_id, 'task_created', v_actor,
       pg_catalog.jsonb_build_object('taskId', v_new, 'kind', v_task.kind, 'dueAt', v_due, 'assigneeId', p_owner)),
      (pg_catalog.gen_random_uuid(), p_entity, p_opportunity, v_lead.account_id, 'task_cancelled', v_actor,
       pg_catalog.jsonb_build_object('taskId', v_task.id, 'kind', v_task.kind));
    v_moved := v_moved || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'oldId', v_task.id, 'newId', v_new, 'kind', v_task.kind, 'dueAt', v_due));
  end loop;

  update public.opportunities
     set owner_id = p_owner, team_id = v_team, locked_until = v_until, updated_by = v_actor
   where id = p_opportunity;
  return query select 'assigned'::text, v_lead.owner_id, v_lead.team_id, v_team, v_until, v_hours, v_moved;
end
$$;
--> statement-breakpoint
revoke execute on function app.handover_assign(smallint, uuid, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.handover_assign(smallint, uuid, uuid, uuid) to app_user;
--> statement-breakpoint

-- 10. Work routed to the Sales Team Lead when no converter qualified: an Agent Inbox item of kind
--     routed_work on the qualified lead itself (subject_type opportunity, so the card says a lead
--     is waiting, not that a customer asked again), for the team lead and their team, with the
--     lead's segment.
create or replace function app.handover_route_to_team_lead(p_entity smallint, p_opportunity uuid,
                                                           p_assignee uuid, p_team uuid)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item uuid := pg_catalog.gen_random_uuid();
  v_lead uuid;
  v_segment text;
begin
  perform app.require_handover(p_entity);
  select o.id, p.segment into v_lead, v_segment
    from public.opportunities o join public.pipelines p on p.id = o.pipeline_id
   where o.id = p_opportunity and o.entity_id = p_entity and o.archived_at is null;
  if not found then
    return null;
  end if;
  insert into public.inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type, subject_id,
                                  state, segment, created_by)
    values (v_item, p_entity, 'routed_work', p_assignee, p_team, 'opportunity', v_lead, 'open',
            v_segment, app.user_id());
  return v_item;
end
$$;
--> statement-breakpoint
revoke execute on function app.handover_route_to_team_lead(smallint, uuid, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.handover_route_to_team_lead(smallint, uuid, uuid, uuid) to app_user;
--> statement-breakpoint

-- 11. The owner's decision of 09-10-2026 (ADR 0020): the round-robin handover, run as
--     system:workers, moves the customer relationship to the lead's new owner as a person's
--     handover does. An agent's handover still never moves it. Everything else is 0064's.
create or replace function app.hand_over_customer(p_opportunity uuid, p_previous_owner uuid)
  returns table (status text, relationship_id uuid, previous_team_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_handover boolean := app.has_perm('crm.handover.run:entity');
  v_account uuid;
  v_entity smallint;
  v_owner uuid;
  v_team uuid;
  v_relationship uuid;
  v_held_by uuid;
  v_held_team uuid;
begin
  if v_actor is null or not (app.has_perm('crm.lead.assign:own') or v_handover) then
    raise exception 'permission crm.lead.assign:own required' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
     or exists (select 1 from public.principals p
                 where p.id = v_actor and p.kind = 'agent') then
    return query select 'unchanged'::text, null::uuid, null::uuid;
    return;
  end if;
  -- The lead as it now stands, only when the caller may write it (opportunities_update), or when
  -- the caller is the handover.
  select o.account_id, o.entity_id, o.owner_id, o.team_id
    into v_account, v_entity, v_owner, v_team
    from public.opportunities o
   where o.id = p_opportunity
     and o.archived_at is null
     and o.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and (v_handover or app.scope_ok('crm.lead.write', o.owner_id, o.team_id));
  if not found then
    raise exception 'opportunity % is outside the caller''s write scope', p_opportunity
      using errcode = '42501';
  end if;
  select ae.id, ae.owner_id, ae.team_id
    into v_relationship, v_held_by, v_held_team
    from public.account_entities ae
   where ae.account_id = v_account and ae.entity_id = v_entity
     for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_held_by is not distinct from v_owner then
    return query select 'unchanged'::text, v_relationship, null::uuid;
    return;
  end if;
  if v_held_by is distinct from p_previous_owner
     or not (v_handover or app.scope_ok('crm.lead.write', v_held_by, v_held_team)) then
    return query select 'held_by_other'::text, v_relationship, null::uuid;
    return;
  end if;
  update public.account_entities
     set owner_id = v_owner, team_id = v_team, updated_at = pg_catalog.now(), updated_by = v_actor
   where id = v_relationship;
  return query select 'moved'::text, v_relationship, v_held_team;
end
$$;
