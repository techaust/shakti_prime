-- A failed retention or partition job is seen (audit 2026-10, DATA-3). pg_cron records each run in
-- `cron.job_run_details`, and the retention jobs also record theirs in `retention_runs`, where
-- `activities-partitions` keeps the error of a month it could not make while pg_cron records the
-- run as succeeded. Nothing read either, so a run of failures went unnoticed.
--
-- 1. The hourly check of the scheduled jobs runs as `system:workers` with a permission of its own,
--    platform-only like the other workers' (0125 holds eight).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'integrations.jobs.check']::text[]
$$;
--> statement-breakpoint

-- 2. Each scheduled job with its last run as pg_cron recorded it and its last run as the job itself
--    recorded it in `retention_runs`, for Integration Health (`admin.integrations.write:all`) and the
--    hourly check (`integrations.jobs.check:all`). A definer, because pg_cron shows a role only the
--    runs of its own jobs, and the jobs are the table owner's; it answers the job's name, schedule
--    and times, and at most 200 characters of each error, never a row of any company.
--    `history_since` is when pg_cron's oldest recorded run started, so a job that has never run can
--    be told apart from one whose first run is not yet due.
create or replace function app.scheduled_jobs()
  returns table (job text, schedule text, active boolean,
                 run_status text, run_started_at timestamptz, run_finished_at timestamptz,
                 run_message text,
                 recorded_started_at timestamptz, recorded_finished_at timestamptz,
                 recorded_error text,
                 history_since timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_perm('admin.integrations.write:all') or app.has_perm('integrations.jobs.check:all')) then
    raise exception 'admin.integrations.write:all or integrations.jobs.check:all is required'
      using errcode = '42501';
  end if;
  return query
    select j.jobname::text, j.schedule::text, j.active,
           d.status::text, d.start_time, d.end_time, pg_catalog.left(d.return_message, 200),
           r.started_at, r.finished_at, pg_catalog.left(r.error, 200),
           (select pg_catalog.min(h.start_time) from cron.job_run_details h)
      from cron.job j
      left join lateral (select x.status, x.start_time, x.end_time, x.return_message
                           from cron.job_run_details x
                          where x.jobid = j.jobid
                          order by x.runid desc
                          limit 1) d on true
      left join lateral (select y.started_at, y.finished_at, y.error
                           from public.retention_runs y
                          where y.job = j.jobname
                          order by y.started_at desc
                          limit 1) r on true
     order by j.jobname;
end
$$;
--> statement-breakpoint
revoke execute on function app.scheduled_jobs() from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.scheduled_jobs() to app_user, app_reader;
