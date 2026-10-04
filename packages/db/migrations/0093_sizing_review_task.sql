-- An out-of-bounds sizing opens a review task for the lead's team lead (docs/design/phase1.md
-- §6.7). The person who records a sizing (a tele-caller, own scope) may not write a task for
-- someone else, so this definer writes the one task the rule allows: a `review` of the caller's
-- own out-of-bounds sizing, on a lead the caller may write, for the active person who holds the
-- Sales Team Lead role on the lead's team in its company. Nothing is opened when the lead has no
-- team or the team no lead, and an open review of the lead for that person is answered instead of
-- a second one. People only, as `crm.sizing.record` (ADR 0021).
create or replace function app.open_sizing_review(p_sizing uuid, p_task uuid, p_due timestamptz)
  returns table (task_id uuid, assignee_id uuid, team_id uuid, opened boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_entity smallint;
  v_opportunity uuid;
  v_account uuid;
  v_team uuid;
  v_lead uuid;
  v_existing uuid;
begin
  if v_actor is null or not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'system:%'
     or not exists (select 1 from public.principals p
                     where p.id = v_actor and p.kind = 'user') then
    raise exception 'a sizing review is opened by people only' using errcode = '42501';
  end if;
  -- The caller's own out-of-bounds sizing, on a lead that is not archived and that the caller may
  -- write (the scope opportunities_update asks).
  select s.entity_id, s.opportunity_id, o.account_id, o.team_id
    into v_entity, v_opportunity, v_account, v_team
    from public.sizings s
    join public.opportunities o on o.id = s.opportunity_id and o.entity_id = s.entity_id
   where s.id = p_sizing
     and s.created_by = v_actor
     and not s.in_bounds
     and s.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and o.archived_at is null
     and app.scope_ok('crm.lead.write', o.owner_id, o.team_id);
  if not found then
    raise exception 'sizing % is not an out-of-bounds sizing of the caller''s', p_sizing
      using errcode = '42501';
  end if;
  if v_team is null then
    return;
  end if;
  -- The team lead: an active person with the Sales Team Lead role on the lead's team there; the
  -- longest-serving first when the team has two.
  select uer.user_id
    into v_lead
    from public.user_entity_roles uer
    join public.roles r on r.id = uer.role_id and r.key = 'sales_team_lead'
    join public.principals p on p.id = uer.user_id and p.kind = 'user'
    join public.users u on u.id = uer.user_id and u.status = 'active'
   where uer.entity_id = v_entity
     and uer.team_id = v_team
   order by uer.created_at, uer.user_id
   limit 1;
  if not found then
    return;
  end if;
  select t.id
    into v_existing
    from public.tasks t
   where t.opportunity_id = v_opportunity
     and t.entity_id = v_entity
     and t.assignee_id = v_lead
     and t.kind = 'review'
     and t.state = 'open'
   limit 1;
  if found then
    return query select v_existing, v_lead, v_team, false;
    return;
  end if;
  insert into public.tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind,
                            due_at, created_by)
  values (p_task, v_entity, v_opportunity, v_account, v_lead, v_team, 'review', p_due, v_actor);
  return query select p_task, v_lead, v_team, true;
end
$$;
--> statement-breakpoint
revoke execute on function app.open_sizing_review(uuid, uuid, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.open_sizing_review(uuid, uuid, timestamptz) to app_user;
