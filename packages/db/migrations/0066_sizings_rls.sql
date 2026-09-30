-- Sizings (docs/design/phase1.md §6.7, docs/DATABASE.md §6.2): a child of opportunities. A sizing
-- is seen with its lead (the EXISTS runs under opportunities_read) and recorded by whoever may
-- write the lead (app.scope_ok on the lead's owner and team), as the caller, with the lead's
-- site. Append-only: no update or delete grant, and the trigger refuses both for any role.

create trigger sizings_append_only before update or delete on sizings
  for each row execute function app.raise_append_only();
--> statement-breakpoint

alter table sizings enable row level security;
--> statement-breakpoint
alter table sizings force row level security;
--> statement-breakpoint
create policy sizings_read on sizings for select to app_user using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = sizings.opportunity_id));
--> statement-breakpoint
create policy sizings_insert on sizings for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from opportunities o
               where o.id = sizings.opportunity_id
                 and o.site_id is not distinct from sizings.site_id
                 and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)));
--> statement-breakpoint

grant select, insert on sizings to app_user;
--> statement-breakpoint
grant select on sizings to readonly_reporter;
