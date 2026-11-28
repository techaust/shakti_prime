-- J6 QC checklists, inspections and project cost lines (docs/03-roadmap-appendix/phase4.md §7.3,
-- PRD PRJ-05 and PRJ-02's QC step): row security, grants, guards, the QC photo's file purpose and
-- the definer the step's guard reads.
--
-- A checklist is read by any holder of projects.read in the company and published only by the
-- Executive (projects.write:all); a published version never changes. An inspection is read with
-- its project, submitted by whoever writes the project (its Project Manager, or the engineer on it
-- at `own` scope) and signed off or turned down with projects.qc.signoff for the company, never by
-- its submitter. A cost line is read and written only with finance.cost.read for the company, and
-- written only by a person who also writes the project; it never changes once written, and a
-- correction is a reversal line.

-- 1. The file purposes: main's latest list (0242) kept, qc_photo added: uploaded by whoever writes
--    a project (projects.write, the engineer's `own` included) and read with projects.read (the
--    company's for a holder at entity scope, the uploader's own otherwise).
create or replace function app.file_purpose_grant(p_purpose text, p_access text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_access
    when 'write' then case p_purpose
      when 'import' then 'imports.write:entity'
      when 'quote_pdf' then 'files.process:entity'
      when 'signed_quote' then 'sales.quote.send:own'
      when 'entity_logo' then 'admin.entities.write:all'
      when 'letterhead' then 'admin.entities.write:all'
      when 'print_proof' then 'files.process:entity'
      when 'knowledge' then 'knowledge.vault.write:all'
      when 'consent_evidence' then 'crm.account.write:own'
      when 'vendor_quote' then 'procurement.rate.read:entity'
      when 'label_sheet' then 'files.process:entity'
      when 'qc_photo' then 'projects.write:own'
    end
    when 'read' then case p_purpose
      when 'import' then 'imports.write'
      when 'quote_pdf' then 'crm.lead.read'
      when 'signed_quote' then 'crm.lead.read'
      when 'entity_logo' then 'company'
      when 'letterhead' then 'company'
      when 'print_proof' then 'admin.entities.write'
      when 'consent_evidence' then 'crm.account.write'
      when 'vendor_quote' then 'procurement.rate.read'
      when 'label_sheet' then 'inventory.stock.move'
      when 'qc_photo' then 'projects.read'
    end
  end
$$;
--> statement-breakpoint

-- 2. checklists: read by any holder of projects.read in the company; published by the Executive;
--    a published version never changes.
alter table checklists enable row level security;
--> statement-breakpoint
alter table checklists force row level security;
--> statement-breakpoint
create policy checklists_read on checklists for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('projects.read:own')));
--> statement-breakpoint
create policy checklists_insert on checklists for insert to app_user with check (
  (select app.has_perm('projects.write:all'))
  and entity_id = any ((select app.entity_ids())::int[])
  and published_by = (select app.user_id()));
--> statement-breakpoint
create trigger checklists_append_only before update or delete on checklists
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 3. qc_inspections: read with the project. Submitted on an open step of a project in progress by
--    whoever writes the project, on a checklist of the project's company and segment for that
--    step, as themselves; signed off or turned down, once, with projects.qc.signoff for the
--    company. The signer is never the submitter (qc_inspections_signer_check).
create trigger set_updated_at before update on qc_inspections
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table qc_inspections enable row level security;
--> statement-breakpoint
alter table qc_inspections force row level security;
--> statement-breakpoint
create policy qc_inspections_read on qc_inspections for select to app_user, app_reader using (
  exists (select 1 from projects p where p.id = qc_inspections.project_id));
--> statement-breakpoint
create policy qc_inspections_insert on qc_inspections for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and submitted_by = (select app.user_id())
  and state = 'submitted'
  and exists (
    select 1
      from projects p
      join project_milestones m on m.project_id = p.id
      join checklists c on c.entity_id = p.entity_id and c.segment = p.segment and c.step_key = m.key
     where p.id = qc_inspections.project_id
       and p.entity_id = qc_inspections.entity_id
       and p.state = 'active'
       and m.id = qc_inspections.milestone_id
       and m.state = 'open'
       and c.id = qc_inspections.checklist_id
       and ((select app.has_perm('projects.write:entity'))
            or ((select app.has_perm('projects.write:own')) and app.project_is_mine(p.id)))));
--> statement-breakpoint
create policy qc_inspections_decide on qc_inspections for update to app_user
  using (state = 'submitted'
         and (select app.has_perm('projects.qc.signoff:entity'))
         and entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from projects p where p.id = qc_inspections.project_id))
  with check (state in ('signed_off', 'rejected')
              and decided_by = (select app.user_id())
              and (select app.has_perm('projects.qc.signoff:entity'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
-- No agent submits or decides an inspection (the commands are for people only, and the database
-- holds the same line for every request: a request always names its caller, and the policies
-- refuse one that does not); a decision is taken once and keeps everything the submitter wrote.
create or replace function app.qc_inspections_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if app.user_id() is not null and not app.request_is_person() then
    raise exception 'only a person records a quality check' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE'
     and (old.state <> 'submitted'
          or (new.project_id, new.milestone_id, new.checklist_id, new.answers_json, new.photo_file_ids,
              new.submitted_at, new.submitted_by)
             is distinct from (old.project_id, old.milestone_id, old.checklist_id, old.answers_json,
                               old.photo_file_ids, old.submitted_at, old.submitted_by)) then
    raise exception 'a quality check is decided once and keeps its answers'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.qc_inspections_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger qc_inspections_guard before insert or update on qc_inspections
  for each row execute function app.qc_inspections_guard();
--> statement-breakpoint
create trigger qc_inspections_no_delete before delete on qc_inspections
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 4. project_cost_lines (restricted, append-only): read only with finance.cost.read for the
--    company, of a project the caller reads; written by a person holding it who also writes the
--    project, as themselves.
alter table project_cost_lines enable row level security;
--> statement-breakpoint
alter table project_cost_lines force row level security;
--> statement-breakpoint
create policy project_cost_lines_read on project_cost_lines for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('finance.cost.read:entity'))
  and exists (select 1 from projects p where p.id = project_cost_lines.project_id));
--> statement-breakpoint
create policy project_cost_lines_insert on project_cost_lines for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and (select app.has_perm('finance.cost.read:entity'))
  and exists (select 1 from projects p
               where p.id = project_cost_lines.project_id
                 and p.entity_id = project_cost_lines.entity_id
                 and ((select app.has_perm('projects.write:entity'))
                      or ((select app.has_perm('projects.write:own')) and app.project_is_mine(p.id)))));
--> statement-breakpoint
-- A new contractor's charge names an active vendor of kind contractor; a reversal mirrors the line
-- it reverses (same project, kind, vendor and rate, the quantity negated), which is itself no
-- reversal. Only a person writes a cost line (as for an inspection). Reads the vendor and the reversed line as the owner,
-- because the vendor master is read with inventory and procurement grants a cost holder may lack.
create or replace function app.project_cost_lines_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_original public.project_cost_lines%rowtype;
begin
  if app.user_id() is not null and not app.request_is_person() then
    raise exception 'only a person records a cost line' using errcode = 'insufficient_privilege';
  end if;
  if new.reverses_id is null then
    if new.vendor_id is not null and not exists (
         select 1 from public.vendors v
          where v.id = new.vendor_id and v.kind = 'contractor' and v.is_active) then
      raise exception 'the vendor is no active contractor'
        using errcode = 'check_violation', constraint = 'project_cost_lines_contractor_check';
    end if;
    return new;
  end if;
  select * into v_original from public.project_cost_lines l
   where l.id = new.reverses_id and l.entity_id = new.entity_id;
  if v_original.id is null or v_original.reverses_id is not null
     or v_original.project_id <> new.project_id
     or v_original.kind <> new.kind
     or v_original.vendor_id is distinct from new.vendor_id
     or v_original.rate <> new.rate
     or v_original.quantity <> -new.quantity then
    raise exception 'a reversal mirrors the line it reverses'
      using errcode = 'check_violation', constraint = 'project_cost_lines_reversal_check';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.project_cost_lines_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger project_cost_lines_guard before insert on project_cost_lines
  for each row execute function app.project_cost_lines_guard();
--> statement-breakpoint
create trigger project_cost_lines_append_only before update or delete on project_cost_lines
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 5. Grants: a checklist and a cost line are only ever added; an inspection changes only in its
--    decision. A vendor's kind is set with its sheet (procurement.vendor.create and .update).
revoke all on checklists, qc_inspections, project_cost_lines
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on checklists, qc_inspections, project_cost_lines to app_user, app_reader;
--> statement-breakpoint
grant insert on checklists, qc_inspections, project_cost_lines to app_user;
--> statement-breakpoint
grant update (state, decided_at, decided_by, reject_reason, updated_at) on qc_inspections to app_user;
--> statement-breakpoint
grant update (kind) on vendors to app_user;
--> statement-breakpoint

-- 6. Whether a project's step may be marked done as far as its quality check goes (the guard
--    qc_not_signed_off of projects.milestone.complete): true when the newest checklist of the
--    project's company and segment for the step has no items, or there is none, or the step has a
--    signed-off inspection. False for a project outside the request's companies.
create or replace function app.project_qc_signed_off(p_project uuid, p_step text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_project public.projects%rowtype;
  v_items integer;
begin
  if app.user_id() is null or not app.has_perm('projects.read:own') then
    raise exception 'projects.read is required' using errcode = '42501';
  end if;
  select * into v_project from public.projects p
   where p.id = p_project and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_project.id is null then
    return false;
  end if;
  select pg_catalog.jsonb_array_length(c.items_json) into v_items
    from public.checklists c
   where c.entity_id = v_project.entity_id and c.segment = v_project.segment and c.step_key = p_step
   order by c.version desc
   limit 1;
  return coalesce(v_items, 0) = 0
      or exists (select 1 from public.qc_inspections i
                   join public.project_milestones m on m.id = i.milestone_id
                  where i.project_id = p_project and m.project_id = p_project and m.key = p_step
                    and i.state = 'signed_off');
end
$$;
--> statement-breakpoint
revoke execute on function app.project_qc_signed_off(uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.project_qc_signed_off(uuid, text) to app_user, app_reader;
--> statement-breakpoint

-- 7. The database holds the same line on every path: a step with a checklist is marked done only
--    once its inspection is signed off.
create or replace function app.project_milestones_qc_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'done' and old.state <> 'done'
     and not app.project_qc_signed_off(new.project_id, new.key) then
    raise exception 'the step''s quality check is not signed off'
      using errcode = 'check_violation', constraint = 'qc_not_signed_off';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.project_milestones_qc_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger project_milestones_qc_guard before update on project_milestones
  for each row execute function app.project_milestones_qc_guard();
