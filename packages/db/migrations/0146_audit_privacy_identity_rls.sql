-- Audit fixes, privacy (audit 2026-10, SEC-1): the one-off identity pass over the imports made
-- before this fix. Those jobs' rows still hold what the client's file said, Aadhaar numbers
-- included, until the import purge clears them. The pass reads each such job once, as the worker
-- principal (imports.process, platform-only, ADR 0020), applies the import's identity-number rule
-- in the domain (`withoutIdentityNumbers()`: a column of Aadhaar numbers left out, any other
-- Aadhaar number masked to its last four digits) and writes the result back through the second
-- definer, which also records what was left out and marks the job checked
-- (`identity_checked_at`, set at the start of every job from this fix on). The rule lives in one
-- place, the domain, so the worker computes and the definer writes; the definer lets a job only
-- lose columns, never gain one. A job adding rows waits for the next run. Marking a job checked
-- is a change to it, so the import purge's period for a job made before the fix starts again
-- from the pass; its rows hold no identity number by then. Once
-- every job is checked, the lookup is one probe of `import_jobs_identity_unchecked_idx`. A call
-- that changed something is one row of retention_runs (job import-identity-check).

-- 1. The oldest job of one company not yet checked and not adding rows, held until the
--    transaction ends (a job another run holds is passed by), with its columns and every row that
--    still says something: `{ jobId, columns, rows: [{ rowNo, raw, normalised }] }`, or null.
create or replace function app.import_job_to_check(p_entity smallint)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_job uuid;
  v_columns jsonb;
begin
  if app.user_id() is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  select j.id, j.columns_json into v_job, v_columns
    from public.import_jobs j
   where j.entity_id = p_entity
     and j.identity_checked_at is null
     and j.state <> 'committing'
   order by j.created_at, j.id
   limit 1
     for update skip locked;
  if v_job is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'jobId', v_job,
    'columns', v_columns,
    'rows', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'rowNo', r.row_no, 'raw', r.raw_json,
                               'normalised', r.normalised_json) order by r.row_no)
                        from public.import_rows r
                       where r.job_id = v_job
                         and (r.raw_json <> '{}'::jsonb or r.normalised_json is not null)),
                     '[]'::jsonb));
end
$$;
--> statement-breakpoint
revoke execute on function app.import_job_to_check(smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.import_job_to_check(smallint) to app_user;
--> statement-breakpoint

-- 2. Writes the checked rows of one job of one company back and marks it checked: each row named
--    in p_rows (`[{ rowNo, raw, normalised }]`, only those that changed) takes its new raw_json
--    and normalised_json, and afterwards no row of the job has more keys than p_columns, so a
--    column left out is gone from every row; the job's columns become
--    p_columns (no more than before), p_left_out is added to its columns left out and p_masked to
--    its masked values. A job already checked, adding rows or of another company is refused.
--    Answers the rows changed.
create or replace function app.record_import_identity_check(p_entity smallint, p_job uuid,
                                                            p_columns jsonb, p_left_out text[],
                                                            p_masked integer, p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_columns jsonb;
  v_left_out text[];
  v_rows integer := 0;
begin
  if v_actor is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_masked is null or p_masked < 0
     or pg_catalog.jsonb_typeof(p_columns) is distinct from 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or pg_catalog.cardinality(coalesce(p_left_out, '{}'::text[])) > 50 then
    raise exception 'the checked rows are not well formed' using errcode = '22023';
  end if;
  select j.columns_json, j.left_out_columns into v_columns, v_left_out
    from public.import_jobs j
   where j.id = p_job and j.entity_id = p_entity
     and j.identity_checked_at is null and j.state <> 'committing'
     for update;
  if v_columns is null then
    raise exception 'the import job is not waiting for its identity check' using errcode = '55000';
  end if;
  if pg_catalog.jsonb_array_length(p_columns) > pg_catalog.jsonb_array_length(v_columns) then
    raise exception 'a checked job never gains a column' using errcode = '22023';
  end if;

  update public.import_rows r
     set raw_json = x.raw, normalised_json = x.normalised, updated_by = v_actor
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
           as x("rowNo" integer, raw jsonb, normalised jsonb)
   where r.job_id = p_job
     and r.row_no = x."rowNo"
     and pg_catalog.jsonb_typeof(x.raw) = 'object';
  get diagnostics v_rows = row_count;
  if exists (select 1 from public.import_rows r
              where r.job_id = p_job
                and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(r.raw_json))
                    > pg_catalog.jsonb_array_length(p_columns)) then
    raise exception 'a checked row has more keys than the job has columns' using errcode = '22023';
  end if;

  update public.import_jobs j
     set columns_json = p_columns,
         left_out_columns = v_left_out || array(select c from pg_catalog.unnest(coalesce(p_left_out, '{}'::text[])) c
                                                 where not (c = any (v_left_out))),
         masked_values = j.masked_values + p_masked,
         identity_checked_at = pg_catalog.now(),
         updated_by = v_actor
   where j.id = p_job;

  if v_rows > 0 or pg_catalog.cardinality(coalesce(p_left_out, '{}'::text[])) > 0 then
    insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
    values (v_run, 'import-identity-check', v_started, pg_catalog.clock_timestamp(), v_rows, null);
  end if;
  return v_rows;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, jsonb) to app_user;
