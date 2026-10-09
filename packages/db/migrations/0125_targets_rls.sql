-- Targets (docs/03-roadmap-appendix/phase1.md §9, docs/05-database.md §6.2, SECURITY §3.2, PRD
-- TEL-06 and RPT-01): who reads a target, who sets one, and the definer through which a person's
-- progress against a target is counted.
--
-- A target is read by its subject (a caller's own, the team's for a member of the team), by the
-- holders of sales.targets.write in the scope they hold it (a team lead the targets of their
-- team and of the callers who are in it now, the GM those of the company, the Executive all) and by nobody else. It
-- is set by a holder of sales.targets.write, as themselves, for a caller of their team (a team
-- lead), of the company (the GM) or any (the Executive), or for a team. Append-only: a target is
-- never changed; setting it again adds a row, and the newest counts.

-- 1. Append-only for every role.
create trigger targets_append_only before update or delete on targets
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- Two helpers for the policies below. user_entity_roles and users are not readable by app_reader,
-- and app_user reads no other person's users row, so the policies ask these definers; each answers
-- yes or no about the person asked for and only to a holder of sales.targets.write.
--   target_caller_in_team: the person holds a role in the company in that team now (a caller who
--     moved to another team is read by the new team lead, no longer by the old one);
--   target_caller_ok: the same, and the person is active and holds calls.log, so a target is set
--     only for someone who logs calls.
create or replace function app.target_caller_in_team(p_user uuid, p_entity smallint, p_team uuid)
  returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('sales.targets.write:team') or app.has_perm('sales.targets.write:entity')
             or app.has_perm('sales.targets.write:all')) then
    return false;
  end if;
  return exists (select 1 from public.user_entity_roles r
                  where r.user_id = p_user and r.entity_id = p_entity and r.team_id = p_team);
end
$$;
--> statement-breakpoint
create or replace function app.target_caller_ok(p_user uuid, p_entity smallint, p_team uuid)
  returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('sales.targets.write:team') or app.has_perm('sales.targets.write:entity')
             or app.has_perm('sales.targets.write:all')) then
    return false;
  end if;
  return exists (select 1
                   from public.user_entity_roles r
                   join public.role_permissions rp
                     on rp.role_id = r.role_id and rp.permission_key = 'calls.log'
                   join public.users u on u.id = r.user_id and u.status = 'active'
                  where r.user_id = p_user and r.entity_id = p_entity and r.team_id = p_team);
end
$$;
--> statement-breakpoint
revoke execute on function app.target_caller_in_team(uuid, smallint, uuid),
  app.target_caller_ok(uuid, smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.target_caller_in_team(uuid, smallint, uuid),
  app.target_caller_ok(uuid, smallint, uuid) to app_user, app_reader;
--> statement-breakpoint

alter table targets enable row level security;
--> statement-breakpoint
alter table targets force row level security;
--> statement-breakpoint
create policy targets_read on targets for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((scope = 'caller' and subject_id = (select app.user_id()))
    or (scope = 'team' and subject_id = (select app.team_id()))
    or (select app.has_perm('sales.targets.write:entity'))
    or (select app.has_perm('sales.targets.write:all'))
    or ((select app.has_perm('sales.targets.write:team')) and scope = 'caller'
        and app.target_caller_in_team(subject_id, entity_id, (select app.team_id())))));
--> statement-breakpoint
-- A target is set by a person as themselves. The subject is a person with a role in the company
-- whose team is the row's team, or a team of the company (or the whole group); a team lead sets
-- only the targets of their own team.
create policy targets_insert on targets for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and set_by = (select app.user_id())
  and exists (select 1 from principals p where p.id = targets.set_by and p.kind = 'user')
  and ((select app.has_perm('sales.targets.write:all'))
    or (select app.has_perm('sales.targets.write:entity'))
    or ((select app.has_perm('sales.targets.write:team')) and team_id = (select app.team_id())))
  and ((scope = 'caller'
        and app.target_caller_ok(targets.subject_id, targets.entity_id, targets.team_id))
    or (scope = 'team'
        and exists (select 1 from teams t
                     where t.id = targets.subject_id
                       and (t.entity_id is null or t.entity_id = targets.entity_id)))));
--> statement-breakpoint

grant select, insert on targets to app_user;
--> statement-breakpoint
grant select on targets to app_reader;
--> statement-breakpoint
grant select on targets to readonly_reporter;
--> statement-breakpoint

-- 2. What the people in `p_users` did in a company between two instants, the actuals the targets
--    are measured by (never stored; worked out here, from the one definition):
--    - calls: the calls the person logged (started in the period);
--    - qualified: the leads the person moved to the stage keyed qualified (each lead once);
--    - orders: the orders the person confirmed in the period and that are not cancelled;
--    - kw: for each lead whose order the person confirmed in the period (each lead once), the
--      kW of the lead's newest in-bounds sizing made before the confirmation: the recommended
--      kWp of a rooftop sizing, the standard motor kW of a pump sizing (0 when there is none).
--    A caller counts what they cannot read row by row (a lead handed on since, a teammate's
--    order), so the count is a definer. Answered for the caller themselves, and for the people of
--    the team of a holder of sales.targets.write at team scope, or of the company at company
--    scope or wider; anyone else asked for is refused. Figures only; people only.
create or replace function app.target_actuals(p_entity smallint, p_from timestamptz,
                                              p_to timestamptz, p_users uuid[])
  returns table (subject_id uuid, calls_n integer, qualified_n integer, orders_n integer,
                 kw_n numeric)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or coalesce(current_setting('app.role', true), '') like 'agent:%'
     or coalesce(current_setting('app.role', true), '') like 'system:%'
     or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not (app.has_perm('sales.targets.write:entity') or app.has_perm('sales.targets.write:all'))
     and exists (
       select 1 from unnest(p_users) as u(id)
        where u.id <> app.user_id()
          and not (app.has_perm('sales.targets.write:team')
                   and app.team_id() is not null
                   and exists (select 1 from public.user_entity_roles r
                                where r.user_id = u.id and r.entity_id = p_entity
                                  and r.team_id = app.team_id()))) then
    raise exception 'progress is answered for yourself, or for your team to a team lead'
      using errcode = '42501';
  end if;
  return query
    select s.id,
           coalesce(c.n, 0), coalesce(q.n, 0), coalesce(o.n, 0),
           round(coalesce(k.kw, 0), 2)
      from (select distinct x as id from unnest(p_users) as x) s
      left join (select ca.caller_id as id, count(*)::integer as n
                   from public.calls ca
                  where ca.caller_id = any (p_users) and ca.entity_id = p_entity
                    and ca.started_at >= p_from and ca.started_at < p_to
                  group by ca.caller_id) c on c.id = s.id
      left join (select a.actor_principal_id as id,
                        count(distinct a.opportunity_id)::integer as n
                   from public.activities a
                  where a.actor_principal_id = any (p_users) and a.entity_id = p_entity
                    and a.type = 'stage_moved'
                    and a.payload_json ->> 'toStageKey' = 'qualified'
                    and a.created_at >= p_from and a.created_at < p_to
                  group by a.actor_principal_id) q on q.id = s.id
      left join (select so.confirmed_by as id, count(*)::integer as n
                   from public.sales_orders so
                  where so.confirmed_by = any (p_users) and so.entity_id = p_entity
                    and so.confirmed_at >= p_from and so.confirmed_at < p_to
                    and so.state <> 'cancelled'
                  group by so.confirmed_by) o on o.id = s.id
      left join (select l.id, sum(l.kw) as kw
                   from (select distinct on (so.confirmed_by, so.opportunity_id)
                                so.confirmed_by as id,
                                coalesce(z.kw, 0) as kw
                           from public.sales_orders so
                           left join lateral (
                             select case sz.kind
                                      when 'rooftop'
                                        then (sz.result_json -> 'rooftop' ->> 'recommendedKwp')::numeric
                                      else (sz.result_json -> 'power' ->> 'standardKw')::numeric
                                    end as kw
                               from public.sizings sz
                              where sz.opportunity_id = so.opportunity_id
                                and sz.entity_id = so.entity_id
                                and sz.in_bounds
                                and sz.created_at <= so.confirmed_at
                              order by sz.created_at desc, sz.id desc
                              limit 1) z on true
                          where so.confirmed_by = any (p_users) and so.entity_id = p_entity
                            and so.opportunity_id is not null
                            and so.confirmed_at >= p_from and so.confirmed_at < p_to
                            and so.state <> 'cancelled'
                          order by so.confirmed_by, so.opportunity_id, so.confirmed_at) l
                  group by l.id) k on k.id = s.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.target_actuals(smallint, timestamptz, timestamptz, uuid[])
  from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.target_actuals(smallint, timestamptz, timestamptz, uuid[])
  to app_user, app_reader;
