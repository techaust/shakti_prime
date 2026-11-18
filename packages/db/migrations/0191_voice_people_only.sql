-- V2 Live voice (SECURITY §3.4): a voice session acts as its person, so the person's own
-- principal row no longer tells a definer for people only that the request is not a session's.
-- app.open_sizing_review() (0095) and app.claim_push_subscription() (0131), the definers for
-- people only that read that row, now ask app.request_is_person(), which refuses an agent, the
-- system and a voice session alike; the rest of each body is its migration's, unchanged. Every
-- command they serve is for people only, so the command guard refuses a session first.
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
  -- A person as themselves: never an agent, the system or a voice session (app.request_is_person()).
  if not app.request_is_person() then
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
  -- Two sizings of the lead recorded at once wait here for each other, so the second finds the
  -- review the first opened.
  perform 1 from public.opportunities where id = v_opportunity and entity_id = v_entity for update;
  if v_team is null then
    return;
  end if;
  -- The team lead: an active person with the Sales Team Lead role on the lead's team there, other
  -- than the recorder; the longest-serving first when the team has two.
  select uer.user_id
    into v_lead
    from public.user_entity_roles uer
    join public.roles r on r.id = uer.role_id and r.key = 'sales_team_lead'
    join public.principals p on p.id = uer.user_id and p.kind = 'user'
    join public.users u on u.id = uer.user_id and u.status = 'active'
   where uer.entity_id = v_entity
     and uer.team_id = v_team
     and uer.user_id <> v_actor
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
--> statement-breakpoint
create or replace function app.claim_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_id uuid;
begin
  if v_user is null or not app.has_perm('profile.write:own') or not app.request_is_person() then
    raise exception 'a person with profile.write is required' using errcode = '42501';
  end if;
  -- The conflicting row is locked and changed only when it is the caller's; another person's
  -- row is left as it is and nothing is answered.
  insert into public.push_subscriptions as s (id, user_id, endpoint, p256dh, auth, user_agent)
  values (app.uuid_v7(), v_user, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict on constraint push_subscriptions_endpoint_unique
  do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
     where s.user_id = v_user
  returning s.id into v_id;
  if v_id is null then
    raise exception 'another person receives alerts on this browser'
      using errcode = '23505', constraint = 'push_subscriptions_endpoint_unique';
  end if;
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.claim_push_subscription(text, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.claim_push_subscription(text, text, text, text) to app_user;
