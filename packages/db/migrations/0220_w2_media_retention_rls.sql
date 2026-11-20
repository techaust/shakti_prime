-- W2 WhatsApp media retention (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9): a
-- customer's WhatsApp file goes `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` after its message
-- arrived, and the message keeps its text and a short summary of what was sent. The platform
-- (`system:workers`, the platform-only `messaging.media.expire`) reads what is due, records what
-- it removed and asks which stored keys still belong to a file through four narrow definers;
-- the bytes are removed from the file store by the job itself.

-- 1. messaging.media.expire is platform-only, like the other workers' grants: the eighteen keys of
--    0201 (with V2's voice.session.record and S3's sales.quote.accept.remote), kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire']::text[]
$$;
--> statement-breakpoint

-- 2. A message's media summary is written once, by the retention definer, and never changed: no
--    message is written with one, and one written stays as it is. A trigger of its own beside
--    app.whatsapp_messages_guard(), which stays as 0188 made it.
create or replace function app.whatsapp_media_summary_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.media_summary is not null then
      raise exception 'a message is written with no media summary' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.media_summary is not null and new.media_summary is distinct from old.media_summary then
    raise exception 'a media summary stays as it was written' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_media_summary_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger whatsapp_messages_media_summary_guard before insert or update on public.whatsapp_messages
  for each row execute function app.whatsapp_media_summary_guard();
--> statement-breakpoint

-- 3. Of the files named, those another record still uses: any foreign key in the database that
--    references files(id), found in the catalogue at run time (so a table added later that files a
--    WhatsApp photo against a lead or a customer document is covered with no change here), and
--    another WhatsApp message than the ones named that arrived at or after `p_before`, so still
--    within the period (one older than it goes with them). A partition's copy of its parent's key
--    is skipped (the parent's is read). Called only by the definers below; no role may run it.
create or replace function app.whatsapp_media_files_in_use(
  p_files uuid[], p_messages uuid[], p_before timestamptz
)
  returns setof uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  if coalesce(pg_catalog.cardinality(p_files), 0) = 0 then
    return;
  end if;
  return query
    select distinct m.file_id from public.whatsapp_messages m
     where m.file_id = any (p_files) and not (m.id = any (coalesce(p_messages, '{}'::uuid[])))
       and m.created_at >= p_before;
  for r in
    select c.conrelid::regclass::text as rel, a.attname::text as col
      from pg_catalog.pg_constraint c
      cross join lateral rows from (pg_catalog.unnest(c.conkey), pg_catalog.unnest(c.confkey)) as k(attnum, fattnum)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      join pg_catalog.pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.fattnum
     where c.contype = 'f'
       and c.confrelid = 'public.files'::regclass
       and c.conrelid <> 'public.whatsapp_messages'::regclass
       and c.conparentid = 0
       and fa.attname = 'id'
     order by 1, 2
  loop
    return query execute pg_catalog.format(
      'select distinct x.%I from %s x where x.%I = any ($1)', r.col, r.rel, r.col)
      using p_files;
  end loop;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_media_files_in_use(uuid[], uuid[], timestamptz) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- The check every definer below starts with: the platform's grant, a company of the request.
create or replace function app.require_media_expire(p_entity smallint) returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.media.expire:entity') then
    raise exception 'messaging.media.expire is required' using errcode = '42501';
  end if;
  if p_entity is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.require_media_expire(smallint) from public, readonly_reporter, app_user, app_reader;
--> statement-breakpoint

-- 4. The next batch of one company's media messages older than the period whose file is still
--    kept, oldest first after the cursor (on whatsapp_messages_media_kept_idx), each with its
--    file's place in the store (with the upload's own key, which the checks replace with a changed
--    copy, and its type, so the job removes every key of the file) and whether another record
--    still uses it (`in_use`, kept). The cursor's time is answered as text, exact to the
--    microsecond. A dry run reads only this.
create or replace function app.whatsapp_media_due(
  p_entity smallint, p_years integer, p_after_at timestamptz, p_after_id uuid, p_limit integer
) returns table (message_id uuid, message_at text, file_id uuid, bucket text, key text,
                 original_key text, content_type text, in_use boolean)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_cutoff timestamptz;
begin
  perform app.require_media_expire(p_entity);
  if p_years is null or p_years not between 1 and 10 then
    raise exception 'the period is 1 to 10 years' using errcode = 'check_violation';
  end if;
  if (p_after_at is null) <> (p_after_id is null) then
    raise exception 'a cursor has a time and an id' using errcode = 'check_violation';
  end if;
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(years => p_years);
  return query
    with due as (
      select m.id, m.created_at, m.file_id, f.bucket, f.key,
             f.scan_result ->> 'originalKey' as original_key, f.content_type
        from public.whatsapp_messages m
        join public.files f on f.id = m.file_id and f.entity_id = m.entity_id
       where m.entity_id = p_entity
         and m.kind = 'media' and m.file_id is not null and m.media_summary is null
         and m.created_at < v_cutoff
         and f.purpose = 'whatsapp_media'
         and (p_after_at is null or (m.created_at, m.id) > (p_after_at, p_after_id))
       order by m.created_at, m.id
       limit least(greatest(coalesce(p_limit, 0), 0), 500)
    ),
    used as (
      select u.id
        from app.whatsapp_media_files_in_use(
               array(select d.file_id from due d), array(select d.id from due d), v_cutoff) as u(id)
    )
    select d.id,
           pg_catalog.to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           d.file_id, d.bucket, d.key, d.original_key, d.content_type,
           exists (select 1 from used where used.id = d.file_id)
      from due d
     order by d.created_at, d.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_media_due(smallint, integer, timestamptz, uuid, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_media_due(smallint, integer, timestamptz, uuid, integer) to app_user;
--> statement-breakpoint

-- 5. What one batch removed: of the messages named (whose bytes the job deleted from the store),
--    each still older than the period, a media message of the company with no summary, whose
--    file is a WhatsApp file no other record uses, has its file marked deleted (the row kept for
--    the trail) and its summary written: type, name, size and the checks' verdict. Every other
--    message named changes nothing; one whose file is in use is counted as kept. Each call is one
--    row of retention_runs (job whatsapp-media-expire), with the files the store refused
--    (`p_failed`, counted by the job) as its error.
create or replace function app.whatsapp_expire_media(
  p_entity smallint, p_years integer, p_messages uuid[], p_failed integer
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_cutoff timestamptz;
  v_files uuid[];
  v_ids uuid[];
  v_in_use uuid[];
  v_removed jsonb;
begin
  perform app.require_media_expire(p_entity);
  if p_years is null or p_years not between 1 and 10 then
    raise exception 'the period is 1 to 10 years' using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.cardinality(p_messages), 0) > 500 or coalesce(p_failed, -1) < 0 then
    raise exception 'a batch names at most 500 messages' using errcode = 'check_violation';
  end if;
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(years => p_years);

  -- The messages and their files, locked, so a file is filed nowhere else while it goes.
  select pg_catalog.array_agg(m.file_id order by m.created_at, m.id),
         pg_catalog.array_agg(m.id order by m.created_at, m.id)
    into v_files, v_ids
    from (select m.id, m.created_at, m.file_id
            from public.whatsapp_messages m
            join public.files f on f.id = m.file_id and f.entity_id = m.entity_id
           where m.id = any (coalesce(p_messages, '{}'::uuid[]))
             and m.entity_id = p_entity
             and m.kind = 'media' and m.file_id is not null and m.media_summary is null
             and m.created_at < v_cutoff
             and f.purpose = 'whatsapp_media'
           order by m.created_at, m.id
             for update of m, f) m;
  v_in_use := array(select u.id from app.whatsapp_media_files_in_use(v_files, v_ids, v_cutoff) as u(id));

  with gone as (
    update public.files f
       set deleted_at = coalesce(f.deleted_at, pg_catalog.now()), updated_by = v_actor
     where f.id = any (coalesce(v_files, '{}'::uuid[])) and not (f.id = any (v_in_use))
       and f.entity_id = p_entity
    returning f.id, f.name, f.content_type, f.size, f.status
  ),
  summarised as (
    update public.whatsapp_messages m
       set media_summary = pg_catalog.jsonb_build_object(
             'contentType', g.content_type,
             'name', g.name,
             'size', g.size,
             'verdict', case g.status when 'ready' then 'passed'
                                      when 'rejected' then 'refused'
                                      else 'unchecked' end,
             'removedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      from gone g
     where m.file_id = g.id and m.id = any (v_ids) and m.entity_id = p_entity
       and m.created_at < v_cutoff
    returning m.id, m.file_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'messageId', s.id, 'fileId', s.file_id) order by s.id), '[]'::jsonb)
    into v_removed
    from summarised s;

  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (app.uuid_v7(), 'whatsapp-media-expire', v_started, pg_catalog.clock_timestamp(),
          pg_catalog.jsonb_array_length(v_removed),
          case when p_failed = 0 then null
               else 'the store refused ' || p_failed::text
                    || case when p_failed = 1 then ' file' else ' files' end end);
  return pg_catalog.jsonb_build_object(
    'removed', v_removed,
    'inUse', coalesce(pg_catalog.cardinality(v_in_use), 0));
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_expire_media(smallint, integer, uuid[], integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_expire_media(smallint, integer, uuid[], integer) to app_user;
--> statement-breakpoint

-- 6. Of the keys the job found under a company's WhatsApp folder in a store, those to keep: a key
--    a file row not deleted names, and every key of a file still in its checks (its upload, a
--    changed copy being written, a PDF's masked pages, all named by the file's id). Any other key
--    is no file's: an original a stopped try stored and never attached, or one the checks left
--    behind. A key outside the company's folder is always answered as kept.
create or replace function app.whatsapp_media_keys_kept(p_entity smallint, p_bucket text, p_keys text[])
  returns setof text
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_folder text;
begin
  perform app.require_media_expire(p_entity);
  if coalesce(pg_catalog.cardinality(p_keys), 0) > 1000 then
    raise exception 'at most 1,000 keys at a time' using errcode = 'check_violation';
  end if;
  v_folder := p_entity::text || '/whatsapp_media/';
  return query
    select k.key
      from pg_catalog.unnest(coalesce(p_keys, '{}'::text[])) as k(key)
     where not pg_catalog.starts_with(k.key, v_folder)
        or exists (select 1 from public.files f
                    where f.bucket = p_bucket and f.key = k.key and f.deleted_at is null)
        or exists (select 1 from public.files f
                    where f.id = pg_catalog.substring(
                                   k.key, '^[0-9]+/whatsapp_media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid
                      and f.entity_id = p_entity and f.bucket = p_bucket
                      and f.deleted_at is null and f.status not in ('ready', 'rejected'));
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_media_keys_kept(smallint, text, text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_media_keys_kept(smallint, text, text[]) to app_user;
--> statement-breakpoint

-- 7. The record of one company's sweep of keys no file names: one row of retention_runs (job
--    whatsapp-media-orphans) with the keys removed, and those the store refused as its error.
create or replace function app.whatsapp_media_orphans_record(
  p_entity smallint, p_started timestamptz, p_removed integer, p_failed integer
) returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_media_expire(p_entity);
  if coalesce(p_removed, -1) < 0 or coalesce(p_failed, -1) < 0 then
    raise exception 'counts are 0 or more' using errcode = 'check_violation';
  end if;
  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (app.uuid_v7(), 'whatsapp-media-orphans',
          least(coalesce(p_started, pg_catalog.clock_timestamp()), pg_catalog.clock_timestamp()),
          pg_catalog.clock_timestamp(), p_removed,
          case when p_failed = 0 then null
               else 'the store refused ' || p_failed::text
                    || case when p_failed = 1 then ' key' else ' keys' end end);
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_media_orphans_record(smallint, timestamptz, integer, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_media_orphans_record(smallint, timestamptz, integer, integer) to app_user;
