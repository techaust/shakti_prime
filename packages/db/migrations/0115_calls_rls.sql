-- Calls (docs/design/phase1.md §7.2, docs/DATABASE.md §6.2): a child of opportunities. A call is
-- seen with its lead (the EXISTS runs under opportunities_read) and logged by `calls.log` as the
-- caller, a person whose `calls.log` scope covers the lead (own, team or company: app.scope_ok on
-- the lead's owner and team), with an outcome of the group's or the lead's company that is still
-- in use. Only people log calls: the command refuses agents and the system principal at its guard
-- (`peopleOnly`), and the insert policy holds the caller to a user principal. Append-only: no
-- update or delete grant, and the trigger refuses both for any role. The queries' own role,
-- app_reader, reads under the same policy.

create trigger calls_append_only before update or delete on calls
  for each row execute function app.raise_append_only();
--> statement-breakpoint

alter table calls enable row level security;
--> statement-breakpoint
alter table calls force row level security;
--> statement-breakpoint
create policy calls_read on calls for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = calls.opportunity_id));
--> statement-breakpoint
create policy calls_insert on calls for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and caller_id = (select app.user_id())
  and exists (select 1 from principals p where p.id = calls.caller_id and p.kind = 'user')
  and exists (select 1 from call_dispositions d
               where d.id = calls.disposition_id
                 and d.archived_at is null
                 and (d.entity_id is null or d.entity_id = calls.entity_id))
  and exists (select 1 from opportunities o
               where o.id = calls.opportunity_id
                 and app.scope_ok('calls.log', o.owner_id, o.team_id)));
--> statement-breakpoint

grant select, insert on calls to app_user;
--> statement-breakpoint
grant select on calls to app_reader;
--> statement-breakpoint
grant select on calls to readonly_reporter;
