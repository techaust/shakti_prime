-- Tasks (docs/DATABASE.md §6.2): a scope root on crm.lead.* with the assignee as the owner, on a lead
-- the caller reads. state and done_at are written only by the task commands through the machine.

create trigger set_updated_at before update on tasks for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table tasks enable row level security;
--> statement-breakpoint
alter table tasks force row level security;
--> statement-breakpoint

-- Own, team and company scope stated inline, each permission test an initplan (DATABASE §4.2); the
-- exists runs under opportunities_read on the lead's primary key.
create policy tasks_read on tasks for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.lead.read:entity'))
    or ((select app.has_perm('crm.lead.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.lead.read:own')) and assignee_id = (select app.user_id())))
  and exists (select 1 from opportunities o where o.id = tasks.opportunity_id));
--> statement-breakpoint

-- A task is written by someone whose lead write scope covers the person it is for and the lead.
create policy tasks_insert on tasks for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and app.scope_ok('crm.lead.write', assignee_id, team_id)
  and exists (select 1 from opportunities o
               where o.id = tasks.opportunity_id
                 and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)));
--> statement-breakpoint
create policy tasks_update on tasks for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and app.scope_ok('crm.lead.write', assignee_id, team_id)
         and exists (select 1 from opportunities o where o.id = tasks.opportunity_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and app.scope_ok('crm.lead.write', assignee_id, team_id)
              and exists (select 1 from opportunities o where o.id = tasks.opportunity_id));
--> statement-breakpoint

-- No delete: a task ends done or cancelled. Only the working columns change after the insert.
grant select, insert on tasks to app_user;
--> statement-breakpoint
grant update (due_at, state, done_at, updated_at, updated_by) on tasks to app_user;
