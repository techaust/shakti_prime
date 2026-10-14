-- Audit fixes, privacy, after the second review (review M4, L12, L15): the identity pass's write
-- takes its rows by their key, so a part of a large job is written on the primary key even
-- before the statistics know the job's rows (on the slot, the first two parts of a 50,000-row
-- job took 13 seconds each while the statistics still counted the table before the job: the
-- planner joined the rows given to every row of the table). The definers also stop taking the
-- worker's word for what they record:
--   - each column left out must be one the part drops, named with only its digits turned to X,
--     one name for each column dropped, and no name may hold twelve digits;
--   - the pass's row may move on at most as far as a part reads (2,000 rows), and a job is marked
--     checked only when no row lies past it;
--   - the job's saved mapping may change only by digits turned to X (a left-out column's name);
--   - a failure is recorded by a code alone: an SQLSTATE or a domain code;
--   - every check of "digits turned to X" names the digit ranges it accepts (ASCII, Arabic-Indic,
--     the Indian scripts and full-width), so it reads the same under a libc locale as under ICU.

-- 1. Whether p_new is p_old with some of its digits, of the ranges below, turned to X and nothing
--    else changed. No role calls it directly; the definers below ask it.
create or replace function app.only_digits_masked(p_old text, p_new text) returns boolean
  language sql immutable set search_path = '' as $$
  select p_old is not null and p_new is not null
     and pg_catalog.char_length(p_old) = pg_catalog.char_length(p_new)
     and not exists (
           select 1 from pg_catalog.generate_series(1, pg_catalog.char_length(p_old)) i
            where pg_catalog.substr(p_new, i, 1) <> pg_catalog.substr(p_old, i, 1)
              and not (pg_catalog.substr(p_new, i, 1) = 'X'
                       and pg_catalog.substr(p_old, i, 1) ~ '[0-9٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯０-９]'))
$$;
--> statement-breakpoint
revoke execute on function app.only_digits_masked(text, text) from public, readonly_reporter;
--> statement-breakpoint

-- 2. How many digits, of the same ranges, a text holds.
create or replace function app.digit_count(p_text text) returns integer
  language sql immutable set search_path = '' as $$
  select pg_catalog.char_length(pg_catalog.regexp_replace(coalesce(p_text, ''),
           '[^0-9٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯０-９]',
           '', 'g'))
$$;
--> statement-breakpoint
revoke execute on function app.digit_count(text) from public, readonly_reporter;
--> statement-breakpoint

-- 3. The read, as in 0148, answering the job's saved mapping too.
create or replace function app.import_job_to_check(p_entity smallint, p_job uuid, p_limit integer)
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_columns jsonb;
  v_mapping jsonb;
  v_through integer;
  v_file uuid;
  v_rows jsonb;
  v_last integer;
begin
  if app.user_id() is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'a call reads between 1 and 2000 rows' using errcode = '22023';
  end if;
  select j.columns_json, j.mapping_json, j.identity_checked_through, j.file_id
    into v_columns, v_mapping, v_through, v_file
    from public.import_jobs j
   where j.id = p_job and j.entity_id = p_entity
     and j.identity_checked_at is null and j.state <> 'committing'
     for update skip locked;
  if v_columns is null then
    return null;
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'rowNo', x.row_no, 'raw', x.raw_json, 'normalised', x.normalised_json)
                  order by x.row_no), '[]'::jsonb),
         pg_catalog.max(x.row_no)
    into v_rows, v_last
    from (select r.row_no, r.raw_json, r.normalised_json
            from public.import_rows r
           where r.job_id = p_job and r.row_no > v_through
           order by r.row_no
           limit p_limit) x;
  return pg_catalog.jsonb_build_object(
    'jobId', p_job,
    'columns', v_columns,
    'mapping', v_mapping,
    'fileName', (select f.name from public.files f where f.id = v_file),
    'through', v_through,
    'last', v_last is null or not exists (select 1 from public.import_rows r
                                          where r.job_id = p_job and r.row_no > v_last),
    'rows', v_rows);
end
$$;
--> statement-breakpoint

-- 4. The write: 0148's, with its rows by their key, the saved mapping, and the checks above.
drop function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb);
--> statement-breakpoint
create function app.record_import_identity_check(p_entity smallint, p_job uuid,
                                                 p_columns jsonb, p_left_out text[],
                                                 p_masked integer, p_through integer,
                                                 p_done boolean, p_file_name text,
                                                 p_mapping jsonb, p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_columns jsonb;
  v_mapping jsonb;
  v_left_out text[];
  v_through integer;
  v_file uuid;
  v_name text;
  v_dropped text[];
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
  select j.columns_json, j.mapping_json, j.left_out_columns, j.identity_checked_through, j.file_id
    into v_columns, v_mapping, v_left_out, v_through, v_file
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
  -- The columns the part drops, each named once among the columns left out, with only its digits
  -- turned to X, and no name left with twelve digits.
  v_dropped := array(select c from pg_catalog.jsonb_array_elements_text(v_columns) c
                      where not (p_columns @> pg_catalog.jsonb_build_array(c)));
  if pg_catalog.cardinality(coalesce(p_left_out, '{}'::text[])) <> pg_catalog.cardinality(v_dropped)
     or exists (select 1 from pg_catalog.unnest(coalesce(p_left_out, '{}'::text[])) l
                 where app.digit_count(l) >= 12
                    or not exists (select 1 from pg_catalog.unnest(v_dropped) d
                                    where d = l or app.only_digits_masked(d, l))) then
    raise exception 'each column left out is named once, with only its digits masked'
      using errcode = '22023';
  end if;
  if p_through < v_through
     or (select pg_catalog.count(*) from public.import_rows r
          where r.job_id = p_job and r.row_no > v_through and r.row_no <= p_through) > 2000
     or (p_done and exists (select 1 from public.import_rows r
                             where r.job_id = p_job and r.row_no > p_through))
     or exists (select 1 from pg_catalog.jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
                           as x("rowNo" integer)
                 where x."rowNo" is null or x."rowNo" <= v_through or x."rowNo" > p_through) then
    raise exception 'the checked rows are outside the part being checked' using errcode = '22023';
  end if;

  -- Each row by its key (`job_id`, `row_no`), so the plan stays on the primary key.
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
      if not app.only_digits_masked(v_name, p_file_name) then
        raise exception 'a file name only loses digits' using errcode = '22023';
      end if;
      update public.files f set name = p_file_name, updated_by = v_actor where f.id = v_file;
      v_renamed := true;
    end if;
  end if;

  if p_mapping is not null and p_mapping is distinct from v_mapping then
    if not app.only_digits_masked(v_mapping::text, p_mapping::text) then
      raise exception 'a saved mapping only loses digits' using errcode = '22023';
    end if;
  end if;

  update public.import_jobs j
     set columns_json = p_columns,
         mapping_json = coalesce(p_mapping, j.mapping_json),
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
revoke execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb, jsonb) to app_user;
--> statement-breakpoint

-- 5. The failure record, as in 0148, taking only an SQLSTATE (five letters or digits) or a domain
--    code (lower-case letters and underscores).
create or replace function app.record_import_purge_failure(p_entity smallint, p_job text,
                                                           p_error text)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('imports.process:entity') then
    raise exception 'imports.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_job is null or p_job not in ('import-identity-check', 'import-rows-purge', 'import-files-purge')
     or p_error is null or p_error !~ '^([0-9a-z]{5}|[a-z_]{1,40})$' then
    raise exception 'a failure is recorded by its job and its code alone' using errcode = '22023';
  end if;
  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (app.uuid_v7(), p_job, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), 0,
          p_error);
end
$$;
