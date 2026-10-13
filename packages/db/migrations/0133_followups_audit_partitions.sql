-- The monthly partitions of the audit trail, as the timeline's are made
-- (app.ensure_activity_partitions()): the partition of the current UTC month and of the next
-- `p_months_ahead` months, each month apart, so a month that fails is recorded and the later
-- months are still made. A month fails, for example, when rows of that month already wait in the
-- default partition. Each run is one row of retention_runs (job audit-logs-partitions): the
-- partitions made, and the months that failed with their errors. A failure also raises a warning
-- to pg_cron's log. Idempotent; run by the migrator and by pg_cron, never by a request role.
create or replace function app.ensure_audit_partitions(p_months_ahead int default 3) returns int
language plpgsql set search_path = '' as $$
declare
  first_month timestamp := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC');
  lo timestamptz;
  hi timestamptz;
  part text;
  created int := 0;
  failed text[] := '{}';
  run uuid := app.uuid_v7();
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 24 then
    raise exception 'months ahead must be between 0 and 24' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.retention_runs (id, job, started_at)
  values (run, 'audit-logs-partitions', pg_catalog.clock_timestamp());
  for i in 0..p_months_ahead loop
    lo := (first_month + pg_catalog.make_interval(months => i)) at time zone 'UTC';
    hi := (first_month + pg_catalog.make_interval(months => i + 1)) at time zone 'UTC';
    part := 'audit_logs_' || pg_catalog.to_char(lo at time zone 'UTC', 'YYYY_MM');
    begin
      if pg_catalog.to_regclass(pg_catalog.format('audit_partitions.%I', part)) is null then
        execute pg_catalog.format(
          'create table audit_partitions.%I partition of public.audit_logs for values from (%L) to (%L)',
          part, lo, hi);
        created := created + 1;
      end if;
    exception when others then
      failed := failed || (part || ': ' || sqlerrm);
    end;
  end loop;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(),
         rows_affected = created,
         error = case when pg_catalog.cardinality(failed) = 0 then null
                      else pg_catalog.left(pg_catalog.array_to_string(failed, '; '), 500) end
   where id = run;
  if pg_catalog.cardinality(failed) > 0 then
    raise warning 'audit-logs-partitions: %', pg_catalog.array_to_string(failed, '; ');
  end if;
  return created;
end
$$;
--> statement-breakpoint
revoke execute on function app.ensure_audit_partitions(int) from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select app.ensure_audit_partitions(3);
--> statement-breakpoint

-- Every day at 03:00 UTC rather than on the 25th, so a failed run is tried again the next day
-- and a month's partition is in place long before the month starts (DATABASE §7). The job keeps
-- its name; pg_cron changes the schedule of the job of that name.
select cron.schedule('audit-logs-partitions', '0 3 * * *', 'select app.ensure_audit_partitions(3)');
