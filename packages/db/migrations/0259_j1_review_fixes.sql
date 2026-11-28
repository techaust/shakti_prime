-- J1 review fixes (docs/03-roadmap-appendix/phase4.md §6.1):
-- 1. the database holds the line the commands draw: who may change a project's state and reasons,
--    and how a step moves for a person writing at `own` scope;
-- 2. a cancelled order's project: the platform (the platform-only projects.draft, ADR 0020)
--    cancels it while no step is done, else its Project Manager is told;
-- 3. STATUS on WhatsApp leaves out the project of a cancelled order.

-- 1a. A project's state, its reasons and when its state changed are the company's call
--     (projects.write for the company: hold, resume, complete, cancel), or the platform's for the
--     project of a cancelled order (projects.draft). A person writing at `own` scope (the engineer
--     on the project) changes none of them, nor the owner, so a path outside the commands cannot
--     cancel or reopen a project.
create or replace function app.projects_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id and not app.has_perm('projects.write:entity') then
    raise exception 'projects.write for the company names the owner'
      using errcode = 'insufficient_privilege';
  end if;
  if (new.state, new.state_changed_at, new.hold_reason, new.cancel_reason)
       is distinct from (old.state, old.state_changed_at, old.hold_reason, old.cancel_reason)
     and not (app.has_perm('projects.write:entity') or app.has_perm('projects.draft:entity')) then
    raise exception 'projects.write for the company moves a project'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.projects_guard() from public, readonly_reporter;
--> statement-breakpoint

-- 1b. A step, for a person without projects.write for the company: only the next open step of a
--     project in progress, marked done by themselves (projects.milestone.complete's path); never
--     reopened, skipped or marked done for someone else.
create or replace function app.project_milestones_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (new.state, new.done_at, new.done_by, new.skip_reason)
       is not distinct from (old.state, old.done_at, old.done_by, old.skip_reason)
     or app.has_perm('projects.write:entity') then
    return new;
  end if;
  if old.state <> 'open' or new.state <> 'done' or new.done_at is null
     or new.done_by is distinct from app.user_id()
     or new.skip_reason is distinct from old.skip_reason
     or not exists (select 1 from public.projects p
                     where p.id = new.project_id and p.state = 'active')
     or exists (select 1 from public.project_milestones m
                 where m.project_id = new.project_id and m.position < old.position
                   and m.state = 'open') then
    raise exception 'only the next open step is marked done, by the person on the project'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.project_milestones_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger project_milestones_guard before update on project_milestones
  for each row execute function app.project_milestones_guard();
--> statement-breakpoint

-- 2a. The project of a cancelled order of the company that is not cancelled, locked, with how
--     many of its steps are done (projects.project.cancel_for_order, run on sales.order.cancelled
--     by the platform's projects.draft). No row when the order is not cancelled or has no such
--     project.
create or replace function app.order_cancelled_project(p_entity smallint, p_order uuid)
  returns table (project_id uuid, account_id uuid, state text, flow text, steps_done integer)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.draft:entity') then
    raise exception 'projects.draft is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select p.id, p.account_id, p.state, p.flow,
           (select pg_catalog.count(*)::int from public.project_milestones m
             where m.project_id = p.id and m.state = 'done')
      from public.projects p
      join public.sales_orders so on so.id = p.sales_order_id
     where p.sales_order_id = p_order and p.entity_id = p_entity
       and so.state = 'cancelled' and p.state <> 'cancelled'
       for update of p;
end
$$;
--> statement-breakpoint
revoke execute on function app.order_cancelled_project(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_cancelled_project(smallint, uuid) to app_user;
--> statement-breakpoint

-- 2b. Cancels that project with the reason, while it is in progress or on hold, its order is
--     cancelled and none of its steps is done. True when it was cancelled.
create or replace function app.cancel_order_project(
  p_entity smallint, p_project uuid, p_reason text, p_at timestamptz
) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.draft:entity') then
    raise exception 'projects.draft is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  update public.projects p
     set state = 'cancelled', state_changed_at = p_at, cancel_reason = p_reason,
         hold_reason = null, updated_by = app.user_id()
   where p.id = p_project and p.entity_id = p_entity
     and p.state in ('active', 'on_hold')
     and exists (select 1 from public.sales_orders so
                  where so.id = p.sales_order_id and so.state = 'cancelled')
     and not exists (select 1 from public.project_milestones m
                      where m.project_id = p.id and m.state = 'done');
  return found;
end
$$;
--> statement-breakpoint
revoke execute on function app.cancel_order_project(smallint, uuid, text, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.cancel_order_project(smallint, uuid, text, timestamptz) to app_user;
--> statement-breakpoint

-- 2c. Whom the notice of a project kept for a cancelled order is for (notifications.send): its
--     owner, or, when it has none who may receive notices in the company, the company's people
--     whose role holds projects.write for the company (its Project Managers and General Managers).
create or replace function app.notice_project_people(p_entity smallint, p_project uuid)
  returns table (user_id uuid, account_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select distinct w.uid, p.account_id
      from public.projects p
      cross join lateral (
        select p.owner_id as uid
         where p.owner_id is not null and app.notice_recipient_ok(p.owner_id, p_entity)
        union
        select uer.user_id
          from public.user_entity_roles uer
          join public.role_permissions rp on rp.role_id = uer.role_id
         where uer.entity_id = p.entity_id
           and rp.permission_key = 'projects.write' and rp.scope = 'entity'
           and not (p.owner_id is not null and app.notice_recipient_ok(p.owner_id, p_entity))
           and app.notice_recipient_ok(uer.user_id, p_entity)) w
     where p.id = p_project and p.entity_id = p_entity
     order by w.uid;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_project_people(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_project_people(smallint, uuid) to app_user;
--> statement-breakpoint

-- 3. STATUS on WhatsApp (WA-03): the branch's version (0242, which keeps every line of 0201) with
--    the project of a cancelled order left out too, as a cancelled project is: the order line says
--    the order is cancelled. Same result, so replaced in place; its grants stand.
create or replace function app.status_summary(p_thread uuid)
  returns table (kind text, ref text, state text, grand_total numeric, valid_until timestamptz,
                 created_at timestamptz, step_key text, step_title text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_account uuid;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select t.entity_id, t.account_id into v_entity, v_account
    from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_account is null then
    return;
  end if;
  return query
    (select 'quote'::text, q.quote_no, q.state, q.grand_total, q.valid_until, q.created_at,
            null::text, null::text
       from public.quotes q
      where q.account_id = v_account and q.entity_id = v_entity
        and q.state in ('sent', 'accepted', 'expired')
      order by q.created_at desc, q.id desc
      limit 5)
    union all
    (select 'order'::text, so.so_no, so.state, so.grand_total, null::timestamptz, so.created_at,
            null::text, null::text
       from public.sales_orders so
      where so.account_id = v_account and so.entity_id = v_entity
      order by so.created_at desc, so.id desc
      limit 5)
    union all
    -- A cancelled project, or the project of a cancelled order, is left out: the customer's order
    -- shows how it stands.
    (select 'project'::text, p.project_no, p.state, null::numeric, null::timestamptz, p.created_at,
            m.key, m.title
       from public.projects p
       join public.sales_orders pso on pso.id = p.sales_order_id and pso.state <> 'cancelled'
       left join lateral (select pm.key, pm.title from public.project_milestones pm
                           where pm.project_id = p.id and pm.state = 'open'
                           order by pm.position limit 1) m on true
      where p.account_id = v_account and p.entity_id = v_entity and p.state <> 'cancelled'
      order by p.created_at desc, p.id desc
      limit 5);
end
$$;
