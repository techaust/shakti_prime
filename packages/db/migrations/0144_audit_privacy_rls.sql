-- Audit fixes, privacy (audit 2026-10, SEC-1): an import keeps no identity number, and keeps what
-- the client's file said only while the import needs it.
--
-- The import's own reading leaves out every column of Aadhaar numbers and masks any other Aadhaar
-- number to its last four digits before a row is stored (packages/domain/src/imports/
-- identity-columns.ts); the job records which columns it left out (`left_out_columns`, the
-- migration before this one). What remains, the names, phones and villages of the file, is
-- cleared once the import is done with it:
--   - the file's bytes are deleted from the file store once its job has ended (all rows added,
--     stopped or undone), or a number of days after the upload whatever became of the job; the
--     worker deletes them, then records it here (`files.deleted_at`);
--   - the rows' `raw_json` and `normalised_json` are cleared once the job has ended, or was left
--     before adding, and nothing has changed on it for the reconciliation period; each row's
--     state, what it made, why it was refused and its duplicate findings (ids only) stay, so the
--     job's reconciliation (M1) still adds up, and the job is marked purged (`purged_at`).
-- Both periods are workshop defaults in packages/domain (`WORKSHOP_DEFAULTS.retention`), passed in
-- by the commands. Both run as the worker principal `system:workers`, through the two definers
-- below and the platform-only permission imports.process, which no person's role and no agent
-- holds (ADR 0020). app_user has no update grant on `raw_json`, `purged_at` or `deleted_at`, so
-- nothing else changes them. A call that purges something is one row of retention_runs.

-- 1. Clears what the rows of up to p_jobs of one company's import jobs said: jobs not purged and
--    not adding rows, whose last change is older than p_days, oldest first, each held (a job a
--    command holds now waits for the next run). Answers `{ jobs: [id, ...], rows }`.
create or replace function app.purge_import_rows(p_entity smallint, p_days integer,
                                                 p_jobs integer)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_jobs uuid[];
  v_rows integer := 0;
begin
  if v_actor is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_days is null or p_days < 7 or p_days > 365 then
    raise exception 'the reconciliation period must be between 7 and 365 days'
      using errcode = '22023';
  end if;
  if p_jobs is null or p_jobs < 1 or p_jobs > 100 then
    raise exception 'a call purges between 1 and 100 jobs' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(x.id), '{}')
    into v_jobs
    from (select j.id
            from public.import_jobs j
           where j.entity_id = p_entity
             and j.purged_at is null
             and j.state <> 'committing'
             and j.updated_at < pg_catalog.now() - pg_catalog.make_interval(days => p_days)
           order by j.updated_at, j.id
           limit p_jobs
             for update skip locked) x;
  if pg_catalog.cardinality(v_jobs) = 0 then
    return pg_catalog.jsonb_build_object('jobs', '[]'::jsonb, 'rows', 0);
  end if;

  update public.import_rows r
     set raw_json = '{}'::jsonb, normalised_json = null, updated_by = v_actor
   where r.job_id = any (v_jobs)
     and (r.raw_json <> '{}'::jsonb or r.normalised_json is not null);
  get diagnostics v_rows = row_count;

  update public.import_jobs j
     set purged_at = pg_catalog.now(), updated_by = v_actor
   where j.id = any (v_jobs);

  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (v_run, 'import-rows-purge', v_started, pg_catalog.clock_timestamp(), v_rows, null);
  return pg_catalog.jsonb_build_object('jobs', pg_catalog.to_jsonb(v_jobs), 'rows', v_rows);
end
$$;
--> statement-breakpoint
revoke execute on function app.purge_import_rows(smallint, integer, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.purge_import_rows(smallint, integer, integer) to app_user;
--> statement-breakpoint

-- 2. Records that the worker deleted the bytes of the named import files of one company from the
--    file store: each file of the import purpose still kept, whose job has ended (committed,
--    stopped or undone) or that was uploaded more than p_open_days ago, is marked deleted; any
--    other id is passed over. Answers the ids marked.
create or replace function app.record_import_files_deleted(p_entity smallint,
                                                           p_open_days integer,
                                                           p_files uuid[])
  returns uuid[]
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_done uuid[];
begin
  if v_actor is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_open_days is null or p_open_days < 1 or p_open_days > 90 then
    raise exception 'an import file is kept between 1 and 90 days' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(coalesce(p_files, '{}'::uuid[])) > 500 then
    raise exception 'a call records at most 500 files' using errcode = '22023';
  end if;

  with done as (
    update public.files f
       set deleted_at = pg_catalog.now(), updated_by = v_actor
     where f.id = any (coalesce(p_files, '{}'::uuid[]))
       and f.entity_id = p_entity
       and f.purpose = 'import'
       and f.deleted_at is null
       and (f.created_at < pg_catalog.now() - pg_catalog.make_interval(days => p_open_days)
            or exists (select 1 from public.import_jobs j
                        where j.file_id = f.id
                          and j.state in ('committed', 'failed', 'rolled_back')))
    returning f.id
  )
  select coalesce(pg_catalog.array_agg(done.id order by done.id), '{}') into v_done from done;

  if pg_catalog.cardinality(v_done) > 0 then
    insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
    values (v_run, 'import-files-purge', v_started, pg_catalog.clock_timestamp(),
            pg_catalog.cardinality(v_done), null);
  end if;
  return v_done;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_import_files_deleted(smallint, integer, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_import_files_deleted(smallint, integer, uuid[]) to app_user;
