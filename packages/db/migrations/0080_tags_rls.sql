-- Tags and the tags on a lead (docs/DATABASE.md §6.2).

-- A name is unique in its company whatever its case, and among the group-wide tags.
create unique index tags_entity_name_unique on tags (entity_id, lower(name)) nulls not distinct;
--> statement-breakpoint
create trigger set_updated_at before update on tags for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table tags enable row level security;
--> statement-breakpoint
alter table tags force row level security;
--> statement-breakpoint

-- Whoever reads leads reads the tags of the request's companies and the group's own tags.
create policy tags_read on tags for select to app_user using (
  (select app.has_perm('crm.lead.read:own'))
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0)));
--> statement-breakpoint

-- Team leads, GMs and Executives (crm.lead.assign) make and archive tags; a group-wide tag only in
-- a request for every company (app.request_covers_group(), 0019).
create policy tags_insert on tags for insert to app_user with check (
  (select app.has_perm('crm.lead.assign:own'))
  and created_by = (select app.user_id())
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
create policy tags_update on tags for update to app_user
  using ((select app.has_perm('crm.lead.assign:own'))
         and (entity_id = any ((select app.entity_ids())::int[])
           or (entity_id is null and (select app.request_covers_group()))))
  with check ((select app.has_perm('crm.lead.assign:own'))
              and (entity_id = any ((select app.entity_ids())::int[])
                or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
grant select, insert on tags to app_user;
--> statement-breakpoint
grant update (archived_at, updated_at, updated_by) on tags to app_user;
--> statement-breakpoint

alter table opportunity_tags enable row level security;
--> statement-breakpoint
alter table opportunity_tags force row level security;
--> statement-breakpoint

-- A lead's tags are read with the lead (the exists runs under opportunities_read).
create policy opportunity_tags_read on opportunity_tags for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = opportunity_tags.opportunity_id));
--> statement-breakpoint

-- Written by someone who may write the lead, with a live tag of the lead's own company or of the
-- whole group: a tag of one company never goes on another company's lead.
create policy opportunity_tags_insert on opportunity_tags for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from opportunities o
               where o.id = opportunity_tags.opportunity_id
                 and app.scope_ok('crm.lead.write', o.owner_id, o.team_id))
  and exists (select 1 from tags t
               where t.id = opportunity_tags.tag_id
                 and t.archived_at is null
                 and (t.entity_id is null or t.entity_id = opportunity_tags.entity_id)));
--> statement-breakpoint
create policy opportunity_tags_delete on opportunity_tags for delete to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o
               where o.id = opportunity_tags.opportunity_id
                 and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)));
--> statement-breakpoint

-- A link is made or taken away, never changed.
grant select, insert, delete on opportunity_tags to app_user;
