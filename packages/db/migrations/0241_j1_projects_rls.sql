-- J1 projects and the standard flow (docs/03-roadmap-appendix/phase4.md §5, §6.1): row security,
-- grants, guards, the `own` predicate and the two definers that make a project.
--
-- A project is read with projects.read for the company, or at `own` scope when the caller is on it
-- (app.project_is_mine(): its owner, or a person assigned to it); its milestones and assignments
-- are read with it. It is written with projects.write the same way; who runs it and who is on it
-- only for the company. No request role inserts a project or its milestones: app.create_project()
-- does, for the platform's drafting (the platform-only projects.draft, ADR 0020) and for a Project
-- Manager's project made by hand (projects.write for the company). Flow templates are read by any
-- holder of projects.read in the company and published only by the Executive
-- (projects.write:all); a published version never changes.

-- 1. The platform-only permissions: main's latest list (0222) kept, projects.draft added.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire', 'projects.draft']::text[]
$$;
--> statement-breakpoint

-- 2. A project's number: 0201's series kept, `project` added, drawn by whoever may make a project
--    (projects.write for the company, or the platform's projects.draft).
create or replace function app.next_document_no(
  p_entity smallint, p_doc_type text, p_fy text, p_prefix text
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_no int;
  v_perm text;
begin
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity
      using errcode = 'insufficient_privilege';
  end if;
  v_perm := case p_doc_type
    when 'quote' then 'sales.quote.create:own'
    when 'sales_order' then 'sales.order.create:own'
    when 'proforma' then 'finance.proforma.write:own'
    when 'challan' then 'inventory.dispatch.write:own'
    when 'purchase_order' then 'procurement.po.write:own'
    when 'project' then 'projects.write:entity'
    else null end;
  if v_perm is null
     or not (app.has_perm(v_perm)
             or (p_doc_type = 'sales_order' and app.has_perm('sales.quote.accept.remote:entity'))
             or (p_doc_type = 'project' and app.has_perm('projects.draft:entity'))) then
    raise exception 'permission % required to number a %', v_perm, p_doc_type
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.document_sequences (id, entity_id, doc_type, fy, prefix)
  values (pg_catalog.gen_random_uuid(), p_entity, p_doc_type, p_fy, p_prefix)
  on conflict (entity_id, doc_type, fy) do nothing;
  update public.document_sequences
     set next_no = next_no + 1
   where entity_id = p_entity and doc_type = p_doc_type and fy = p_fy
  returning next_no - 1 into v_no;
  return v_no;
end
$$;
--> statement-breakpoint
revoke all on function app.next_document_no(smallint, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.next_document_no(smallint, text, text, text) to app_user;
--> statement-breakpoint

-- 3. The `own` predicate (phase4 §4): the caller is the project's owner or assigned to it, in a
--    company of the request. A definer, because the assignments are read with the project and
--    the project's read policy asks this: read under row security, each would ask the other. It
--    answers only about the caller, so it checks no permission; the policies that call it check
--    their own. Later slices reuse it for schedule slots, documents, cost lines and stock.
create or replace function app.project_is_mine(p_project uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select app.user_id() is not null
     and exists (select 1 from public.projects p
                  where p.id = p_project
                    and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
                    and (p.owner_id = app.user_id()
                         or exists (select 1 from public.project_assignments a
                                     where a.project_id = p.id and a.person_id = app.user_id())))
$$;
--> statement-breakpoint
revoke execute on function app.project_is_mine(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.project_is_mine(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. projects
create trigger set_updated_at before update on projects for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table projects enable row level security;
--> statement-breakpoint
alter table projects force row level security;
--> statement-breakpoint
create policy projects_read on projects for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('projects.read:entity'))
       or ((select app.has_perm('projects.read:own')) and app.project_is_mine(id))));
--> statement-breakpoint
create policy projects_update on projects for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and ((select app.has_perm('projects.write:entity'))
              or ((select app.has_perm('projects.write:own')) and app.project_is_mine(id))))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and ((select app.has_perm('projects.write:entity'))
                   or ((select app.has_perm('projects.write:own')) and app.project_is_mine(id))));
--> statement-breakpoint
-- Who runs a project is the company's call: a caller writing at `own` scope cannot name an owner,
-- nor so make a project their own.
create or replace function app.projects_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id and not app.has_perm('projects.write:entity') then
    raise exception 'projects.write for the company names the owner'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.projects_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger projects_guard before update on projects
  for each row execute function app.projects_guard();
--> statement-breakpoint

-- 5. project_assignments: read with the project; written for the company.
alter table project_assignments enable row level security;
--> statement-breakpoint
alter table project_assignments force row level security;
--> statement-breakpoint
create policy project_assignments_read on project_assignments for select to app_user, app_reader using (
  exists (select 1 from projects p where p.id = project_assignments.project_id));
--> statement-breakpoint
create policy project_assignments_insert on project_assignments for insert to app_user with check (
  (select app.has_perm('projects.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from projects p
               where p.id = project_assignments.project_id
                 and p.entity_id = project_assignments.entity_id));
--> statement-breakpoint
create policy project_assignments_delete on project_assignments for delete to app_user using (
  (select app.has_perm('projects.write:entity'))
  and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint

-- 6. project_milestones: read with the project; a step is marked done by whoever writes the
--    project. Made only by app.create_project().
alter table project_milestones enable row level security;
--> statement-breakpoint
alter table project_milestones force row level security;
--> statement-breakpoint
create policy project_milestones_read on project_milestones for select to app_user, app_reader using (
  exists (select 1 from projects p where p.id = project_milestones.project_id));
--> statement-breakpoint
create policy project_milestones_update on project_milestones for update to app_user
  using (exists (select 1 from projects p
                  where p.id = project_milestones.project_id
                    and ((select app.has_perm('projects.write:entity'))
                         or ((select app.has_perm('projects.write:own')) and app.project_is_mine(p.id)))))
  with check (exists (select 1 from projects p
                       where p.id = project_milestones.project_id
                         and ((select app.has_perm('projects.write:entity'))
                              or ((select app.has_perm('projects.write:own')) and app.project_is_mine(p.id)))));
--> statement-breakpoint

-- 7. project_flow_templates: read by any holder of projects.read in the company; published by the
--    Executive; a published version never changes.
alter table project_flow_templates enable row level security;
--> statement-breakpoint
alter table project_flow_templates force row level security;
--> statement-breakpoint
create policy project_flow_templates_read on project_flow_templates for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('projects.read:own')));
--> statement-breakpoint
create policy project_flow_templates_insert on project_flow_templates for insert to app_user with check (
  (select app.has_perm('projects.write:all'))
  and entity_id = any ((select app.entity_ids())::int[])
  and published_by = (select app.user_id()));
--> statement-breakpoint
create trigger project_flow_templates_append_only before update or delete on project_flow_templates
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 8. Grants: a project changes only in its state, reasons and owner; a step only in its state.
revoke all on projects, project_assignments, project_milestones, project_flow_templates
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on projects, project_assignments, project_milestones, project_flow_templates to app_user, app_reader;
--> statement-breakpoint
grant update (state, state_changed_at, owner_id, hold_reason, cancel_reason, updated_at, updated_by)
  on projects to app_user;
--> statement-breakpoint
grant insert, delete on project_assignments to app_user;
--> statement-breakpoint
grant update (state, done_at, done_by, skip_reason) on project_milestones to app_user;
--> statement-breakpoint
grant insert on project_flow_templates to app_user;
--> statement-breakpoint

-- 9. What making a project of an order needs (projects.project.draft and .create): the order's
--    state, customer and site, its lead's pipeline segment, its quote's scheme, the company's code
--    for the number, how many projects the order ever had and the one not cancelled. No row when
--    the order is not of the company. The platform reads no order by a person's rule (ADR 0020),
--    and a Project Manager makes a project of any order of the company.
create or replace function app.project_order_facts(p_entity smallint, p_order uuid)
  returns table (order_state text, account_id uuid, site_id uuid, segment text, scheme text,
                 entity_code text, projects integer, live_project_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('projects.draft:entity') or app.has_perm('projects.write:entity')) then
    raise exception 'projects.draft or projects.write is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return query
    select so.state, so.account_id, so.site_id, pl.segment, coalesce(q.scheme, 'none'), e.code,
           (select pg_catalog.count(*)::int from public.projects p where p.sales_order_id = so.id),
           (select p.id from public.projects p
             where p.sales_order_id = so.id and p.state <> 'cancelled')
      from public.sales_orders so
      join public.entities e on e.id = so.entity_id
      left join public.opportunities o on o.id = so.opportunity_id
      left join public.pipelines pl on pl.id = o.pipeline_id
      left join public.quotes q on q.id = so.quote_id
     where so.id = p_order and so.entity_id = p_entity;
end
$$;
--> statement-breakpoint
revoke execute on function app.project_order_facts(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.project_order_facts(smallint, uuid) to app_user;
--> statement-breakpoint

-- 10. Makes a project of a confirmed order with its checklist (projects.project.draft and
--     .create): under the order's lock, the order must be past draft and not cancelled; with
--     p_once_per_order (the platform's drafting) an order that ever had a project gets none
--     (`created` false), so a replayed event drafts nothing twice; an order with a project not
--     cancelled is refused by projects_sales_order_live_unique. A standard project copies the
--     company's newest template of its segment, else the workshop's default steps the command
--     passes; a PM Surya Ghar project's steps come with the subsidy flow (J4). The owner is the
--     caller or no one.
create or replace function app.create_project(
  p_id uuid, p_entity smallint, p_order uuid, p_project_no text, p_fy text, p_segment text,
  p_scheme text, p_owner uuid, p_default_steps jsonb, p_once_per_order boolean
) returns table (created boolean, template_version_id uuid, milestones integer)
  language plpgsql security definer set search_path = '' as $$
declare
  v_order public.sales_orders%rowtype;
  v_flow text := case when p_scheme = 'pm_surya_ghar' then 'surya_ghar' else 'standard' end;
  v_template uuid;
  v_steps jsonb;
  v_count integer := 0;
begin
  if app.user_id() is null
     or not (app.has_perm('projects.draft:entity') or app.has_perm('projects.write:entity')) then
    raise exception 'projects.draft or projects.write is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_owner is not null and p_owner <> app.user_id() then
    raise exception 'a new project is owned by its maker or no one' using errcode = '42501';
  end if;
  select * into v_order from public.sales_orders so
   where so.id = p_order and so.entity_id = p_entity
   for update;
  if v_order.id is null or v_order.state in ('draft', 'cancelled') then
    raise exception 'the order is not confirmed'
      using errcode = 'check_violation', constraint = 'project_order_not_confirmed';
  end if;
  if p_once_per_order and exists (select 1 from public.projects p where p.sales_order_id = p_order) then
    return query select false, null::uuid, 0;
    return;
  end if;
  if v_flow = 'standard' then
    select t.id, t.steps_json into v_template, v_steps
      from public.project_flow_templates t
     where t.entity_id = p_entity and t.segment = p_segment
     order by t.version desc
     limit 1;
    v_steps := coalesce(v_steps, p_default_steps);
  end if;
  insert into public.projects (id, entity_id, project_no, fy, sales_order_id, account_id, site_id,
                               segment, scheme, flow, template_version_id, owner_id, created_by)
  values (p_id, p_entity, p_project_no, p_fy, p_order, v_order.account_id, v_order.site_id,
          p_segment, p_scheme, v_flow, v_template, p_owner, app.user_id());
  if v_steps is not null then
    insert into public.project_milestones (id, entity_id, project_id, position, key, title, requires)
    select app.uuid_v7(), p_entity, p_id, s.ord::smallint, s.step ->> 'key', s.step ->> 'title',
           coalesce(s.step -> 'requires', '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_steps) with ordinality as s(step, ord);
    get diagnostics v_count = row_count;
  end if;
  return query select true, v_template, v_count;
end
$$;
--> statement-breakpoint
revoke execute on function app.create_project(uuid, smallint, uuid, text, text, text, text, uuid, jsonb, boolean) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.create_project(uuid, smallint, uuid, text, text, text, text, uuid, jsonb, boolean) to app_user;
--> statement-breakpoint

-- 11. The documents a step still needs (the guard documents_missing): a stub answering none until
--     J3's document requirements replace it with the mandatory requirement keys not filed.
create or replace function app.project_missing_documents(p_project uuid, p_step text)
  returns setof text
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.read:own') then
    raise exception 'projects.read is required' using errcode = '42501';
  end if;
  return;
end
$$;
--> statement-breakpoint
revoke execute on function app.project_missing_documents(uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.project_missing_documents(uuid, text) to app_user, app_reader;
