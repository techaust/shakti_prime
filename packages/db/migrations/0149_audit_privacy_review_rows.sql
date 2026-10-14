-- Audit fixes, privacy, after review (review M4): the identity pass's write takes its rows by
-- their key, so a part of a large job is written on the primary key even before the statistics
-- know the job's rows. On the slot, the first two parts of a 50,000-row job took 13 seconds each
-- while the statistics still counted the table before the job: the planner joined the rows given
-- to every row of the table. The definer is otherwise as in the migration before.

-- 2. Writes one checked part of a job of one company not yet checked and not adding rows: each row
--    named in p_rows (`[{ rowNo, raw, normalised }]`, only those that changed, each after the row
--    the pass had reached and no later than p_through) takes its new raw_json and normalised_json.
--    Refused: a column in p_columns the job does not have (a job only loses columns), and any row
--    of the part left with a key that is not one of p_columns. The job's columns become p_columns,
--    p_left_out is added to its columns left out and p_masked to its masked values, the pass's row
--    becomes p_through, and with p_done the job is marked checked. p_file_name, when given, is the
--    file's name with digits replaced by X and nothing else changed. Answers the rows changed.
create or replace function app.record_import_identity_check(p_entity smallint, p_job uuid,
                                                            p_columns jsonb, p_left_out text[],
                                                            p_masked integer, p_through integer,
                                                            p_done boolean, p_file_name text,
                                                            p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_columns jsonb;
  v_left_out text[];
  v_through integer;
  v_file uuid;
  v_name text;
  v_renamed boolean := false;
  v_rows integer := 0;
  v_given jsonb;
  v_row_nos integer[];
begin
  if v_actor is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_masked is null or p_masked < 0 or p_through is null or p_done is null
     or pg_catalog.jsonb_typeof(p_columns) is distinct from 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000
     or pg_catalog.cardinality(coalesce(p_left_out, '{}'::text[])) > 50 then
    raise exception 'the checked rows are not well formed' using errcode = '22023';
  end if;
  select j.columns_json, j.left_out_columns, j.identity_checked_through, j.file_id
    into v_columns, v_left_out, v_through, v_file
    from public.import_jobs j
   where j.id = p_job and j.entity_id = p_entity
     and j.identity_checked_at is null and j.state <> 'committing'
     for update;
  if v_columns is null then
    raise exception 'the import job is not waiting for its identity check' using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_columns) c
              where pg_catalog.jsonb_typeof(c) <> 'string'
                 or not (v_columns @> pg_catalog.jsonb_build_array(c))) then
    raise exception 'a checked job never gains a column' using errcode = '22023';
  end if;
  if p_through < v_through
     or exists (select 1 from pg_catalog.jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
                           as x("rowNo" integer)
                 where x."rowNo" is null or x."rowNo" <= v_through or x."rowNo" > p_through) then
    raise exception 'the checked rows are outside the part being checked' using errcode = '22023';
  end if;

  -- Each row by its key (`job_id`, `row_no`), so the plan stays on the primary key even before
  -- the statistics know a large job's rows (a join with the rows given read every row of the
  -- table once per row given while they did not).
  select coalesce(pg_catalog.jsonb_object_agg(x."rowNo"::text, pg_catalog.jsonb_build_object(
                    'raw', x.raw, 'normalised', x.normalised)), '{}'::jsonb),
         coalesce(pg_catalog.array_agg(x."rowNo"), '{}')
    into v_given, v_row_nos
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
           as x("rowNo" integer, raw jsonb, normalised jsonb)
   where pg_catalog.jsonb_typeof(x.raw) = 'object';
  update public.import_rows r
     set raw_json = v_given -> (r.row_no::text) -> 'raw',
         normalised_json = nullif(v_given -> (r.row_no::text) -> 'normalised', 'null'::jsonb),
         updated_by = v_actor
   where r.job_id = p_job
     and r.row_no = any (v_row_nos);
  get diagnostics v_rows = row_count;
  if exists (select 1 from public.import_rows r
              where r.job_id = p_job and r.row_no > v_through and r.row_no <= p_through
                and exists (select 1 from pg_catalog.jsonb_object_keys(r.raw_json) k
                             where not (p_columns @> pg_catalog.jsonb_build_array(k)))) then
    raise exception 'a checked row keeps a column the job no longer has' using errcode = '22023';
  end if;

  if p_file_name is not null then
    select f.name into v_name from public.files f where f.id = v_file for update;
    if v_name is distinct from p_file_name then
      if pg_catalog.char_length(p_file_name) <> pg_catalog.char_length(v_name)
         or exists (select 1 from pg_catalog.generate_series(1, pg_catalog.char_length(v_name)) i
                     where pg_catalog.substr(p_file_name, i, 1) <> pg_catalog.substr(v_name, i, 1)
                       and not (pg_catalog.substr(v_name, i, 1) ~ '[[:digit:]]'
                                and pg_catalog.substr(p_file_name, i, 1) = 'X')) then
        raise exception 'a file name only loses digits' using errcode = '22023';
      end if;
      update public.files f set name = p_file_name, updated_by = v_actor where f.id = v_file;
      v_renamed := true;
    end if;
  end if;

  update public.import_jobs j
     set columns_json = p_columns,
         left_out_columns = v_left_out || array(select c from pg_catalog.unnest(coalesce(p_left_out, '{}'::text[])) c
                                                 where not (c = any (v_left_out))),
         masked_values = j.masked_values + p_masked,
         identity_checked_through = p_through,
         identity_checked_at = case when p_done then pg_catalog.now() end,
         updated_by = v_actor
   where j.id = p_job;

  if v_rows > 0 or v_renamed or pg_catalog.cardinality(coalesce(p_left_out, '{}'::text[])) > 0 then
    insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
    values (v_run, 'import-identity-check', v_started, pg_catalog.clock_timestamp(), v_rows, null);
  end if;
  return v_rows;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb) to app_user;
