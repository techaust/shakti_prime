-- A pg_cron run that never finishes is seen, and none waits for ever (audit 2026-10 review, M2).
-- pg_cron starts no run of a job while its last one is still active, so a run stuck behind a lock
-- stopped the job for good, and no job set a lock or statement time limit.
--
-- 1. The jobs that run a function carry their limits in their command: pg_cron runs the command
--    as one session, so `set` holds for that run only. The command is read from `cron.job` and
--    prefixed, so a schedule or command another migration set is kept as it is. The limits match
--    `JOB_RUN_LIMIT_MINUTES` in packages/domain/src/queries/platform/scheduled-jobs.ts.
do $$
declare
  j record;
begin
  for j in select c.jobid, c.jobname, c.command from cron.job c
            where c.jobname in ('audit-logs-partitions', 'activities-partitions', 'idempotency-keys-purge')
              and c.command not like 'set lock_timeout%' loop
    perform cron.alter_job(
      j.jobid,
      command := case j.jobname
                   when 'idempotency-keys-purge'
                     then 'set lock_timeout = ''5s''; set statement_timeout = ''5min''; '
                   else 'set lock_timeout = ''5s''; set statement_timeout = ''2min''; '
                 end || j.command);
  end loop;
end
$$;
--> statement-breakpoint

-- 2. The two procedures commit, so neither a `set` before their `call` in the same command (the
--    command's implicit transaction makes their COMMIT fail) nor a SET clause (which forbids
--    COMMIT) can limit them. Each sets its lock limit after its first commit, for the transaction
--    that does the work; the hourly check reports a run past its time limit as stuck. Everything
--    else is as in 0060 and 0062.
create or replace procedure app.purge_outbox_events()
language plpgsql as $$
declare
  v_run pg_catalog.uuid := app.uuid_v7();
  v_removed pg_catalog.int4 := 0;
  v_error pg_catalog.text;
begin
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'outbox-events-purge', pg_catalog.clock_timestamp());
  commit;
  -- The work waits at most ten seconds for a lock (review M2): a run stuck behind a long
  -- transaction fails and is recorded instead of holding the job for good.
  perform pg_catalog.set_config('lock_timeout', '10s', true);
  begin
    perform pg_catalog.set_config('app.outbox_retention', 'purge', true);
    delete from public.outbox_events
     where published_at operator(pg_catalog.<)
             (pg_catalog.now() operator(pg_catalog.-) '30 days'::pg_catalog.interval)
       and dead_lettered_at is null;
    get diagnostics v_removed = row_count;
    perform pg_catalog.set_config('app.outbox_retention', '', true);
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is not null then
    update public.retention_runs
       set finished_at = pg_catalog.clock_timestamp(), error = pg_catalog.left(v_error, 500)
     where id operator(pg_catalog.=) v_run;
    commit;
    raise exception 'outbox-events-purge failed: %', v_error;
  end if;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(), rows_affected = v_removed
   where id operator(pg_catalog.=) v_run;
end
$$;
--> statement-breakpoint
revoke execute on procedure app.purge_outbox_events() from public, app_user, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
create or replace procedure app.detach_audit_partitions()
language plpgsql as $$
declare
  v_run pg_catalog.uuid := app.uuid_v7();
  v_detached pg_catalog.int4 := 0;
  v_error pg_catalog.text;
  v_names pg_catalog.text[];
  v_name pg_catalog.text;
  v_cutoff pg_catalog.timestamp :=
    pg_catalog.timezone('UTC', pg_catalog.now()) operator(pg_catalog.-) '8 years'::pg_catalog.interval;
begin
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'audit-logs-detach', pg_catalog.clock_timestamp());
  commit;
  -- The work waits at most ten seconds for a lock (review M2): a run stuck behind a long
  -- transaction fails and is recorded instead of holding the job for good.
  perform pg_catalog.set_config('lock_timeout', '10s', true);
  begin
    -- Monthly partitions are named by app.ensure_audit_partitions(): audit_logs_YYYY_MM, whose
    -- month ends a month after the first day it names. The default partition is never detached.
    select pg_catalog.array_agg(c.relname::pg_catalog.text order by c.relname)
      into v_names
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid operator(pg_catalog.=) i.inhrelid
      join pg_catalog.pg_namespace n on n.oid operator(pg_catalog.=) c.relnamespace
     where i.inhparent operator(pg_catalog.=) 'public.audit_logs'::pg_catalog.regclass
       and n.nspname operator(pg_catalog.=) 'audit_partitions'
       and c.relname operator(pg_catalog.~) '^audit_logs_[0-9]{4}_[0-9]{2}$'
       and (pg_catalog.to_date(pg_catalog.substr(c.relname, 12, 7), 'YYYY_MM')::pg_catalog.timestamp
              operator(pg_catalog.+) '1 month'::pg_catalog.interval)
           operator(pg_catalog.<=) v_cutoff;
    if v_names is not null then
      foreach v_name in array v_names loop
        execute pg_catalog.format(
          'alter table public.audit_logs detach partition audit_partitions.%I', v_name);
        execute pg_catalog.format('alter table audit_partitions.%I set schema audit_archive', v_name);
        v_detached := v_detached operator(pg_catalog.+) 1;
      end loop;
    end if;
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is not null then
    update public.retention_runs
       set finished_at = pg_catalog.clock_timestamp(), error = pg_catalog.left(v_error, 500)
     where id operator(pg_catalog.=) v_run;
    commit;
    raise exception 'audit-logs-detach failed: %', v_error;
  end if;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(), rows_affected = v_detached
   where id operator(pg_catalog.=) v_run;
end
$$;
--> statement-breakpoint
revoke execute on procedure app.detach_audit_partitions() from public, app_user, readonly_reporter, auth_service, outbox_publisher, app_reader;
