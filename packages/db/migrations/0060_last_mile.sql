-- The Phase 0 last fixes (the targeted audit of pull requests #70 to #72).
--
-- 1. The retention purge is a procedure that commits, so it may not pin a search path, and every
--    name, type and operator in it is qualified: its variables' types, the interval, and the
--    comparisons of a run's id with operator(pg_catalog.=), as the purge's own comparison uses
--    operator(pg_catalog.<). Its behaviour, its grants and its pg_cron job are those of 0059.
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

-- 2. The batch count of 0058 starts at 0 for every job, so a job that committed batches before
--    0058 would number its next batch 1 again. Such a job counts the highest batch its rows
--    carry; a job with no committed row is not touched, so it keeps its updated_at.
update public.import_jobs j
   set batch_count = (select max(r.committed_batch)
                        from public.import_rows r
                       where r.job_id = j.id)
 where j.batch_count = 0
   and exists (select 1 from public.import_rows r
                where r.job_id = j.id and r.committed_batch is not null);
