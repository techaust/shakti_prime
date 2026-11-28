-- J5 scheduling board (docs/03-roadmap-appendix/phase4.md §7.2, PRD PRJ-04): row security, grants,
-- guards and the two definers the conflict check and the board read.
--
-- Crews are read by any holder of projects.read in their company and written by its schedulers
-- (projects.schedule.write for the company). A visit is read with projects.read for the company or
-- by a scheduler, and at `own` scope by the person on it: its engineer, a member of its crew, or a
-- person on its project (app.project_is_mine()). It is proposed by a scheduler, the Orchestrator
-- among them; only a person changes it afterwards, so only a person confirms (PRJ-04); and the
-- person on a confirmed visit, with projects.write, records it done and changes nothing else.
-- Time away is read by the company's schedulers and by the person themselves, and written by the
-- schedulers. Conflicts are never a database rule: findScheduleConflicts() names them before every
-- save, and a visit saved over them carries the person's reason.

-- 1. crews
create trigger set_updated_at before update on crews for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table crews enable row level security;
--> statement-breakpoint
alter table crews force row level security;
--> statement-breakpoint
create policy crews_read on crews for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('projects.read:own'))
       or (select app.has_perm('projects.schedule.write:entity'))));
--> statement-breakpoint
create policy crews_insert on crews for insert to app_user with check (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy crews_update on crews for update to app_user
  using ((select app.has_perm('projects.schedule.write:entity'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('projects.schedule.write:entity'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint

-- 2. crew_members: read with the crew; added and removed by the company's schedulers.
alter table crew_members enable row level security;
--> statement-breakpoint
alter table crew_members force row level security;
--> statement-breakpoint
create policy crew_members_read on crew_members for select to app_user, app_reader using (
  exists (select 1 from crews c where c.id = crew_members.crew_id));
--> statement-breakpoint
create policy crew_members_insert on crew_members for insert to app_user with check (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from crews c
               where c.id = crew_members.crew_id and c.entity_id = crew_members.entity_id));
--> statement-breakpoint
create policy crew_members_delete on crew_members for delete to app_user using (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint

-- 3. A crew's lead and members are people of its company.
create or replace function app.crews_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_entity_roles r
                  where r.user_id = new.lead_id and r.entity_id = new.entity_id) then
    raise exception 'a crew is led by a person of its company'
      using errcode = 'check_violation', constraint = 'crew_person_outside';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.crews_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger crews_guard before insert or update of lead_id on crews
  for each row execute function app.crews_guard();
--> statement-breakpoint
create or replace function app.crew_members_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_entity_roles r
                  where r.user_id = new.person_id and r.entity_id = new.entity_id) then
    raise exception 'a crew is made of people of its company'
      using errcode = 'check_violation', constraint = 'crew_person_outside';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.crew_members_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger crew_members_guard before insert on crew_members
  for each row execute function app.crew_members_guard();
--> statement-breakpoint

-- 4. schedule_slots
create trigger set_updated_at before update on schedule_slots for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table schedule_slots enable row level security;
--> statement-breakpoint
alter table schedule_slots force row level security;
--> statement-breakpoint
create policy schedule_slots_read on schedule_slots for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('projects.read:entity'))
       or (select app.has_perm('projects.schedule.write:entity'))
       or ((select app.has_perm('projects.read:own'))
           and (engineer_id = (select app.user_id())
                or exists (select 1 from crew_members cm
                            where cm.crew_id = schedule_slots.crew_id
                              and cm.person_id = (select app.user_id()))
                or app.project_is_mine(project_id)))));
--> statement-breakpoint
-- Proposed by a scheduler, as themselves, on a project of the company they read.
create policy schedule_slots_insert on schedule_slots for insert to app_user with check (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and state = 'proposed'
  and proposed_by = (select app.user_id())
  and created_by = (select app.user_id())
  and exists (select 1 from projects p
               where p.id = schedule_slots.project_id and p.entity_id = schedule_slots.entity_id));
--> statement-breakpoint
-- Changed by a scheduler, or by the person on the visit (its engineer or a member of its crew)
-- with projects.write, whom the guard lets only record it done.
create policy schedule_slots_update on schedule_slots for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('projects.schedule.write:entity'))
              or ((select app.has_perm('projects.write:own'))
                  and (engineer_id = (select app.user_id())
                       or exists (select 1 from crew_members cm
                                   where cm.crew_id = schedule_slots.crew_id
                                     and cm.person_id = (select app.user_id()))))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and ((select app.has_perm('projects.schedule.write:entity'))
                   or ((select app.has_perm('projects.write:own'))
                       and (engineer_id = (select app.user_id())
                            or exists (select 1 from crew_members cm
                                        where cm.crew_id = schedule_slots.crew_id
                                          and cm.person_id = (select app.user_id()))))));
--> statement-breakpoint
-- What the policies cannot say: an agent only proposes, so every change after the proposal is a
-- person's, and a confirmation names the person who confirmed; the person on a visit without
-- projects.schedule.write records a confirmed visit done, as themselves, and changes nothing
-- else; the step is of the visit's project, the engineer a person of its company and the crew
-- one still on the board.
create or replace function app.schedule_slots_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if not app.request_is_person() then
      raise exception 'only a person changes a visit; an agent only proposes'
        using errcode = 'insufficient_privilege';
    end if;
    if new.state = 'confirmed' and old.state <> 'confirmed'
       and new.confirmed_by is distinct from app.user_id() then
      raise exception 'a visit is confirmed by the person confirming it'
        using errcode = 'insufficient_privilege';
    end if;
    if not app.has_perm('projects.schedule.write:entity') then
      if old.state <> 'confirmed' or new.state <> 'done'
         or new.done_by is distinct from app.user_id()
         or (new.entity_id, new.project_id, new.milestone_id, new.engineer_id, new.crew_id,
             new.starts_at, new.ends_at, new.travel_min, new.proposed_by, new.confirmed_at,
             new.confirmed_by, new.cancel_reason, new.override_reason)
            is distinct from
            (old.entity_id, old.project_id, old.milestone_id, old.engineer_id, old.crew_id,
             old.starts_at, old.ends_at, old.travel_min, old.proposed_by, old.confirmed_at,
             old.confirmed_by, old.cancel_reason, old.override_reason) then
        raise exception 'the person on a visit only records it done'
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
  end if;
  if tg_op = 'INSERT'
     or (new.project_id, new.milestone_id) is distinct from (old.project_id, old.milestone_id) then
    if not exists (select 1 from public.project_milestones m
                    where m.id = new.milestone_id and m.project_id = new.project_id) then
      raise exception 'the step is of another project'
        using errcode = 'check_violation', constraint = 'schedule_slot_milestone_outside';
    end if;
  end if;
  if new.engineer_id is not null
     and (tg_op = 'INSERT' or new.engineer_id is distinct from old.engineer_id)
     and not exists (select 1 from public.user_entity_roles r
                      where r.user_id = new.engineer_id and r.entity_id = new.entity_id) then
    raise exception 'the engineer is not of the company'
      using errcode = 'check_violation', constraint = 'schedule_slot_person_outside';
  end if;
  if new.crew_id is not null
     and (tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id)
     and exists (select 1 from public.crews c
                  where c.id = new.crew_id and c.archived_at is not null) then
    raise exception 'the crew is archived'
      using errcode = 'check_violation', constraint = 'schedule_slot_crew_archived';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.schedule_slots_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger schedule_slots_guard before insert or update on schedule_slots
  for each row execute function app.schedule_slots_guard();
--> statement-breakpoint

-- 5. unavailability: read by the company's schedulers and by the person; recorded and removed by
--    the schedulers, for a person of the company.
alter table unavailability enable row level security;
--> statement-breakpoint
alter table unavailability force row level security;
--> statement-breakpoint
create policy unavailability_read on unavailability for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('projects.schedule.write:entity'))
       or person_id = (select app.user_id())));
--> statement-breakpoint
create policy unavailability_insert on unavailability for insert to app_user with check (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy unavailability_delete on unavailability for delete to app_user using (
  (select app.has_perm('projects.schedule.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create or replace function app.unavailability_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_entity_roles r
                  where r.user_id = new.person_id and r.entity_id = new.entity_id) then
    raise exception 'the person is not of the company'
      using errcode = 'check_violation', constraint = 'unavailability_person_outside';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.unavailability_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger unavailability_guard before insert on unavailability
  for each row execute function app.unavailability_guard();
--> statement-breakpoint

-- 6. Grants: a crew changes in its name, lead and archive; a visit in its people, times, state and
--    reasons; time away is recorded and removed, never edited.
revoke all on crews, crew_members, schedule_slots, unavailability
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on crews, crew_members, schedule_slots, unavailability to app_user, app_reader;
--> statement-breakpoint
grant insert on crews, schedule_slots to app_user;
--> statement-breakpoint
grant update (name, lead_id, archived_at, updated_at, updated_by) on crews to app_user;
--> statement-breakpoint
grant insert, delete on crew_members, unavailability to app_user;
--> statement-breakpoint
grant update (engineer_id, crew_id, starts_at, ends_at, travel_min, state, state_changed_at,
              confirmed_at, confirmed_by, done_at, done_by, done_note, cancel_reason,
              override_reason, updated_at, updated_by)
  on schedule_slots to app_user;
--> statement-breakpoint

-- 7. When the people named are busy between two times, in every company (a person may work for
--    several): their visits not cancelled (as engineer or crew member) and their time away. The
--    conflict check and the board read it, so a visit booked by another company still clashes.
--    For a caller who schedules or reads every project of a company, and only about people of a
--    company of the request; another company's visit shows when it is, never what, nor where (a
--    site's point only for a company of the request). At most 15 days and 200 people.
create or replace function app.schedule_busy(p_people uuid[], p_from timestamptz, p_to timestamptz)
  returns table (person_id uuid, kind text, item_id uuid, entity_id smallint,
                 starts_at timestamptz, ends_at timestamptz, lat numeric, lng numeric,
                 away_kind text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
begin
  if app.user_id() is null
     or not (app.has_perm('projects.schedule.write:entity') or app.has_perm('projects.read:entity')) then
    raise exception 'projects.schedule.write or projects.read for the company is required'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '15 days'
     or coalesce(pg_catalog.cardinality(p_people), 0) > 200 then
    raise exception 'at most 15 days and 200 people' using errcode = '22023';
  end if;
  return query
    with people as (
      select distinct x.id
        from pg_catalog.unnest(p_people) as x(id)
       where exists (select 1 from public.user_entity_roles r
                      where r.user_id = x.id and r.entity_id = any (v_entities))
    ), slots as (
      select pp.id as person, s.id, s.entity_id, s.starts_at, s.ends_at, s.project_id
        from people pp
        join public.schedule_slots s on s.engineer_id = pp.id
       where s.engineer_id is not null and s.state <> 'cancelled'
         and s.starts_at >= p_from - interval '12 hours' and s.starts_at < p_to
         and s.ends_at > p_from
      union all
      select pp.id, s.id, s.entity_id, s.starts_at, s.ends_at, s.project_id
        from people pp
        join public.crew_members cm on cm.person_id = pp.id
        join public.schedule_slots s on s.crew_id = cm.crew_id
       where s.crew_id is not null and s.state <> 'cancelled'
         and s.starts_at >= p_from - interval '12 hours' and s.starts_at < p_to
         and s.ends_at > p_from
    )
    select sl.person, 'slot'::text, sl.id, sl.entity_id, sl.starts_at, sl.ends_at,
           case when sl.entity_id = any (v_entities) then cs.lat end,
           case when sl.entity_id = any (v_entities) then cs.lng end,
           null::text
      from slots sl
      join public.projects p on p.id = sl.project_id
      left join public.customer_sites cs on cs.id = p.site_id
    union all
    select pp.id, 'away'::text, u.id, u.entity_id, u.starts_at, u.ends_at, null::numeric,
           null::numeric, u.kind
      from people pp
      join public.unavailability u on u.person_id = pp.id
     where u.starts_at >= p_from - interval '90 days' and u.starts_at < p_to
       and u.ends_at > p_from;
end
$$;
--> statement-breakpoint
revoke execute on function app.schedule_busy(uuid[], timestamptz, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.schedule_busy(uuid[], timestamptz, timestamptz) to app_user, app_reader;
--> statement-breakpoint

-- 8. Where the projects named are: their site's point, for travel times and the map. For the
--    projects the caller reads only (projects.read for the company, or one they are on); a site
--    without coordinates answers nulls, and the board shows it by its village.
create or replace function app.schedule_site_points(p_projects uuid[])
  returns table (project_id uuid, lat numeric, lng numeric)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.read:own') then
    raise exception 'projects.read is required' using errcode = '42501';
  end if;
  return query
    select p.id, s.lat, s.lng
      from public.projects p
      left join public.customer_sites s on s.id = p.site_id
     where p.id = any (p_projects)
       and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and (app.has_perm('projects.read:entity') or app.project_is_mine(p.id));
end
$$;
--> statement-breakpoint
revoke execute on function app.schedule_site_points(uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.schedule_site_points(uuid[]) to app_user, app_reader;
