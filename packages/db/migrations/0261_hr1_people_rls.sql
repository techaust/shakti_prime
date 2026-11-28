-- HR1 Employees, shifts, holidays and leave (docs/03-roadmap-appendix/phase5.md §5, DATABASE §6.8,
-- SECURITY §3.2): row security, grants and triggers.
--
-- Shifts, holidays and leave types belong to one company or, with no company, to the whole group.
-- Every principal acting in some company reads those of its companies and the group's; only a
-- holder of hr.employee.write (HR and the Executive, for every company) writes them, a group row
-- only in a request covering every company.
--
-- An employee is read by:
--   - the person themselves (their own sign-in), in the employee's company;
--   - a holder of hr.employee.write (HR, the Executive), in the request's companies;
--   - a holder of hr.leave.approve for the company or wider (the GM);
--   - a holder of hr.leave.approve for their team (a team lead), for the people whose manager is
--     the caller's own employee record: "the manager's team" (app.hr_manages()).
-- Leave requests and balance movements are read with their employee. A person asks for their own
-- leave (hr.leave.request); HR may ask for anyone on the staff. A decision is an approver's in
-- the scope above and never on their own leave; cancelling is for the person who asked, while the
-- request waits. A balance is its movements, append-only: an approval takes the days off once,
-- and HR's grants and corrections carry a reason.

-- 1. updated_at
create trigger set_updated_at before update on shifts
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on holidays
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on leave_types
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on employees
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on leave_requests
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 2. A balance's movements are never changed or removed.
create trigger leave_balances_append_only before update or delete on leave_balances
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 3. A person has at most one waiting or approved request on any day.
alter table leave_requests add constraint leave_requests_no_overlap
  exclude using gist (employee_id with =, daterange(from_date, to_date, '[]') with &&)
  where (state in ('requested', 'approved'));
--> statement-breakpoint

-- 4. Whether the employee `p_manager` is the caller's own record, active: the people whose manager
--    it is are the caller's team for hr.leave.approve at team scope. The employees policy cannot
--    read employees itself, so it asks this definer, which answers only to a holder of that grant.
create or replace function app.hr_manages(p_manager uuid)
  returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_manager is null or app.user_id() is null
     or not app.has_perm('hr.leave.approve:team') then
    return false;
  end if;
  return exists (select 1 from public.employees m
                  where m.id = p_manager and m.user_id = app.user_id() and m.active);
end
$$;
--> statement-breakpoint
revoke execute on function app.hr_manages(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.hr_manages(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 5. Shifts, holidays and leave types: read acting in some company, written by HR.
alter table shifts enable row level security;
--> statement-breakpoint
alter table shifts force row level security;
--> statement-breakpoint
create policy shifts_read on shifts for select to app_user, app_reader using (
  cardinality((select app.entity_ids())) > 0
  and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy shifts_insert on shifts for insert to app_user with check (
  (select app.has_perm('hr.employee.write:all'))
  and created_by = (select app.user_id())
  and (entity_id = any ((select app.entity_ids())::int[])
       or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
create policy shifts_update on shifts for update to app_user
  using ((select app.has_perm('hr.employee.write:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
              or (entity_id is null and (select app.request_covers_group()))))
  with check ((select app.has_perm('hr.employee.write:all'))
              and updated_by = (select app.user_id())
              and (entity_id = any ((select app.entity_ids())::int[])
                   or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
alter table holidays enable row level security;
--> statement-breakpoint
alter table holidays force row level security;
--> statement-breakpoint
create policy holidays_read on holidays for select to app_user, app_reader using (
  cardinality((select app.entity_ids())) > 0
  and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy holidays_insert on holidays for insert to app_user with check (
  (select app.has_perm('hr.employee.write:all'))
  and created_by = (select app.user_id())
  and (entity_id = any ((select app.entity_ids())::int[])
       or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
create policy holidays_update on holidays for update to app_user
  using ((select app.has_perm('hr.employee.write:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
              or (entity_id is null and (select app.request_covers_group()))))
  with check ((select app.has_perm('hr.employee.write:all'))
              and updated_by = (select app.user_id())
              and (entity_id = any ((select app.entity_ids())::int[])
                   or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
-- A day comes off the list by removing its holiday.
create policy holidays_delete on holidays for delete to app_user
  using ((select app.has_perm('hr.employee.write:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
              or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
alter table leave_types enable row level security;
--> statement-breakpoint
alter table leave_types force row level security;
--> statement-breakpoint
create policy leave_types_read on leave_types for select to app_user, app_reader using (
  cardinality((select app.entity_ids())) > 0
  and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy leave_types_insert on leave_types for insert to app_user with check (
  (select app.has_perm('hr.employee.write:all'))
  and created_by = (select app.user_id())
  and (entity_id = any ((select app.entity_ids())::int[])
       or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
create policy leave_types_update on leave_types for update to app_user
  using ((select app.has_perm('hr.employee.write:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
              or (entity_id is null and (select app.request_covers_group()))))
  with check ((select app.has_perm('hr.employee.write:all'))
              and updated_by = (select app.user_id())
              and (entity_id = any ((select app.entity_ids())::int[])
                   or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint

-- 6. Employees.
alter table employees enable row level security;
--> statement-breakpoint
alter table employees force row level security;
--> statement-breakpoint
create policy employees_read on employees for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((user_id is not null and user_id = (select app.user_id()))
       or (select app.has_perm('hr.employee.write:all'))
       or (select app.has_perm('hr.leave.approve:entity'))
       or ((select app.has_perm('hr.leave.approve:team')) and app.hr_manages(manager_id))));
--> statement-breakpoint
create policy employees_insert on employees for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select app.has_perm('hr.employee.write:all'))
  and created_by = (select app.user_id()));
--> statement-breakpoint
create policy employees_update on employees for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and (select app.has_perm('hr.employee.write:all')))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and (select app.has_perm('hr.employee.write:all'))
              and updated_by = (select app.user_id()));
--> statement-breakpoint

-- 7. Leave requests, read with their employee.
alter table leave_requests enable row level security;
--> statement-breakpoint
alter table leave_requests force row level security;
--> statement-breakpoint
create policy leave_requests_read on leave_requests for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from employees e
               where e.id = leave_requests.employee_id and e.entity_id = leave_requests.entity_id));
--> statement-breakpoint
create policy leave_requests_insert on leave_requests for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and requested_by = (select app.user_id())
  and state = 'requested'
  and exists (select 1 from employees e
               where e.id = leave_requests.employee_id and e.entity_id = leave_requests.entity_id
                 and e.active
                 and ((e.user_id = (select app.user_id())
                       and (select app.has_perm('hr.leave.request:own')))
                      or (select app.has_perm('hr.employee.write:all'))))
  and exists (select 1 from leave_types t
               where t.id = leave_requests.leave_type_id and t.archived_at is null
                 and (t.entity_id is null or t.entity_id = leave_requests.entity_id)));
--> statement-breakpoint
create policy leave_requests_update on leave_requests for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from employees e
                      where e.id = leave_requests.employee_id
                        and e.entity_id = leave_requests.entity_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id())
              and exists (select 1 from employees e
                           where e.id = leave_requests.employee_id
                             and e.entity_id = leave_requests.entity_id));
--> statement-breakpoint
-- Who decides: an approver in scope, never on their own leave; the person who asked (or whose
-- leave it is) cancels a waiting request. The commands check the same through the machine; this
-- holds it for any write. Invoker rights: the employee row is the one the update policy let the
-- caller read.
create or replace function app.leave_requests_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_employee_user uuid;
  v_manager uuid;
begin
  if new.state is not distinct from old.state then
    if new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at
       or new.decision_note is distinct from old.decision_note then
      raise exception 'a decision on leave changes its state' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.state <> 'requested' then
    raise exception 'the leave request is already decided' using errcode = '42501';
  end if;
  if v_user is null or new.decided_by is distinct from v_user then
    raise exception 'a decision on leave is recorded as its maker' using errcode = '42501';
  end if;
  select e.user_id, e.manager_id into v_employee_user, v_manager
    from public.employees e
   where e.id = new.employee_id and e.entity_id = new.entity_id;
  if new.state in ('approved', 'rejected') then
    if v_employee_user is not null and v_employee_user = v_user then
      raise exception 'nobody decides their own leave' using errcode = '42501';
    end if;
    if not (app.has_perm('hr.leave.approve:entity')
            or (app.has_perm('hr.leave.approve:team') and app.hr_manages(v_manager))) then
      raise exception 'the leave is outside the approver''s scope' using errcode = '42501';
    end if;
  elsif new.state = 'cancelled' then
    if not (old.requested_by = v_user
            or (v_employee_user is not null and v_employee_user = v_user)) then
      raise exception 'only the person who asked cancels the leave' using errcode = '42501';
    end if;
  else
    raise exception 'the leave request cannot go back' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger leave_requests_guard before update on leave_requests
  for each row execute function app.leave_requests_guard();
--> statement-breakpoint

-- 8. Balance movements, read with their employee.
alter table leave_balances enable row level security;
--> statement-breakpoint
alter table leave_balances force row level security;
--> statement-breakpoint
create policy leave_balances_read on leave_balances for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from employees e
               where e.id = leave_balances.employee_id and e.entity_id = leave_balances.entity_id));
--> statement-breakpoint
create policy leave_balances_insert on leave_balances for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and exists (select 1 from leave_types t
               where t.id = leave_balances.leave_type_id
                 and (t.entity_id is null or t.entity_id = leave_balances.entity_id))
  and ((kind in ('grant', 'adjust')
        and (select app.has_perm('hr.employee.write:all'))
        and exists (select 1 from employees e
                     where e.id = leave_balances.employee_id
                       and e.entity_id = leave_balances.entity_id))
       or (kind = 'use'
           and exists (select 1 from leave_requests r
                        where r.id = leave_balances.leave_request_id
                          and r.entity_id = leave_balances.entity_id
                          and r.employee_id = leave_balances.employee_id
                          and r.leave_type_id = leave_balances.leave_type_id
                          and r.state = 'approved'
                          and r.decided_by = (select app.user_id())
                          and leave_balances.days = -r.days))));
--> statement-breakpoint

-- 9. Grants: every update is column by column, so a row keeps its company, person and history.
revoke all on shifts, holidays, leave_types, employees, leave_requests, leave_balances
  from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select, insert on shifts, holidays, leave_types, employees, leave_requests, leave_balances
  to app_user;
--> statement-breakpoint
grant delete on holidays to app_user;
--> statement-breakpoint
grant update (name, start_time, end_time, lunch_min, grace_min, weekly_off_days, archived_at,
              updated_at, updated_by) on shifts to app_user;
--> statement-breakpoint
grant update (name, updated_at, updated_by) on holidays to app_user;
--> statement-breakpoint
grant update (name, days_per_year, carries_forward, is_paid, archived_at, updated_at, updated_by)
  on leave_types to app_user;
--> statement-breakpoint
grant update (user_id, name, phone, manager_id, shift_id, office, joined_on, active, left_on,
              updated_at, updated_by) on employees to app_user;
--> statement-breakpoint
grant update (state, decided_by, decided_at, decision_note, updated_at, updated_by)
  on leave_requests to app_user;
--> statement-breakpoint
grant select on shifts, holidays, leave_types, employees, leave_requests, leave_balances
  to app_reader;
