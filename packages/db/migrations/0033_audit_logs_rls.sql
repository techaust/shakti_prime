-- Audit log (docs/design/backend-weeks-3-5.md §3): monthly partitions, append-only, fail-closed RLS.

-- Partitions live in a schema no request role can use, so a partition can never be read or
-- written around the policies on the parent. Rows reach them only through `audit_logs`.
create schema if not exists audit_partitions;
--> statement-breakpoint
revoke all on schema audit_partitions from public;
--> statement-breakpoint

-- A row whose month has no partition lands here instead of failing the command it records.
create table audit_partitions.audit_logs_default partition of public.audit_logs default;
--> statement-breakpoint

-- Creates the partition of the current UTC month and of the next `p_months_ahead` months.
-- Idempotent; run by the migrator and by pg_cron, never by a request role.
create or replace function app.ensure_audit_partitions(p_months_ahead int default 3) returns int
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
declare
  first_month timestamp := date_trunc('month', now() at time zone 'UTC');
  lo timestamptz;
  hi timestamptz;
  part text;
  created int := 0;
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 24 then
    raise exception 'months ahead must be between 0 and 24' using errcode = 'invalid_parameter_value';
  end if;
  for i in 0..p_months_ahead loop
    lo := (first_month + make_interval(months => i)) at time zone 'UTC';
    hi := (first_month + make_interval(months => i + 1)) at time zone 'UTC';
    part := 'audit_logs_' || to_char(lo at time zone 'UTC', 'YYYY_MM');
    if to_regclass(format('audit_partitions.%I', part)) is null then
      execute format(
        'create table audit_partitions.%I partition of public.audit_logs for values from (%L) to (%L)',
        part, lo, hi);
      created := created + 1;
    end if;
  end loop;
  return created;
end
$$;
--> statement-breakpoint
revoke execute on function app.ensure_audit_partitions(int) from public, app_user, readonly_reporter, auth_service;
--> statement-breakpoint
select app.ensure_audit_partitions(3);
--> statement-breakpoint

-- Next months' partitions are made on the 25th, well before they are needed (DATABASE §7).
create extension if not exists pg_cron with schema pg_catalog;
--> statement-breakpoint
select cron.schedule('audit-logs-partitions', '0 3 25 * *', 'select app.ensure_audit_partitions(3)');
--> statement-breakpoint

-- Append-only for every role (DATABASE §5): no update or delete grant, and a trigger as well.
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function app.raise_append_only();
--> statement-breakpoint

alter table audit_logs enable row level security;
--> statement-breakpoint
alter table audit_logs force row level security;
--> statement-breakpoint

-- The runner writes as the caller: its own actor id, an entity in its scope or none, and never a
-- sign-in event, which only the auth module records.
create policy audit_logs_insert on audit_logs for insert to app_user
  with check (
    command not like 'auth.%'
    and actor_principal_id = (select app.user_id())
    and (entity_id is null or entity_id = any ((select app.entity_ids())::int[]))
  );
--> statement-breakpoint

-- The auth module records sign-in and account events only, which belong to no entity.
create policy audit_logs_auth_insert on audit_logs for insert to auth_service
  with check (command like 'auth.%' and entity_id is null);
--> statement-breakpoint

-- `audit.read` at entity scope reads its entities' rows; rows of no entity (admin commands and
-- sign-in events) need `audit.read:all`, and an empty scope reads nothing.
create policy audit_logs_read on audit_logs for select to app_user
  using (
    (entity_id = any ((select app.entity_ids())::int[])
      and (select app.has_perm('audit.read:entity')))
    or (entity_id is null
      and (select app.has_perm('audit.read:all'))
      and cardinality((select app.entity_ids())) > 0)
  );
--> statement-breakpoint

grant select, insert on audit_logs to app_user;
--> statement-breakpoint
grant insert on audit_logs to auth_service;
