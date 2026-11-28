-- HR1 people and leave (docs/03-roadmap-appendix/phase5.md §5, DATABASE §4.1): a person's own page
-- shows their manager's name, but the employees policy lets a person read only their own record.
-- This definer answers that one name and nothing more: the manager of the caller's own record, in
-- a company of the request; null for any other record.
create or replace function app.hr_own_manager_name(p_employee uuid)
  returns text language sql stable security definer set search_path = '' as $$
  select m.name
    from public.employees e
    join public.employees m on m.id = e.manager_id and m.entity_id = e.entity_id
   where e.id = p_employee
     and e.user_id is not null
     and e.user_id = app.user_id()
     and e.entity_id = any (app.entity_ids()::int[])
$$;
--> statement-breakpoint
revoke execute on function app.hr_own_manager_name(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.hr_own_manager_name(uuid) to app_user, app_reader;
