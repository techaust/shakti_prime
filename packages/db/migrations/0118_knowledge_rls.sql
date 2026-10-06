-- The Knowledge Vault (docs/design/phase1.md §8.4, docs/DATABASE.md §6.9, SECURITY §3.2, §3.3 and
-- §11 item 6): who reads a vault file and its chunks, who adds and archives one, and the definers
-- through which the index job (system:workers, knowledge.index) reads a file's facts and records
-- its chunks. A vault file and each of its chunks carry the file's company (null for the whole
-- group) and its sensitivity; a reader sees a row of a company of the request, or of the group in
-- any request with a company, only when they hold the read permission of its sensitivity:
-- staff_ai_ok knowledge.vault.read.staff, management knowledge.vault.read.management, exec_only
-- knowledge.vault.read.exec, each held for all companies.

-- 1. The index job's permission is platform-only, like the other workers' (0113).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'knowledge.index']::text[]
$$;
--> statement-breakpoint

-- 2. A vault upload is begun by a holder of knowledge.vault.write (Executive and GM, all
--    companies). It is read with its vault file, by that file's sensitivity, or by its uploader
--    while they hold knowledge.vault.write (files_knowledge_read below), so the general rule of
--    files_read names no read permission for it.
create or replace function app.file_purpose_grant(p_purpose text, p_access text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_access
    when 'write' then case p_purpose
      when 'import' then 'imports.write:entity'
      when 'quote_pdf' then 'files.process:entity'
      when 'signed_quote' then 'sales.quote.send:own'
      when 'entity_logo' then 'admin.entities.write:all'
      when 'letterhead' then 'admin.entities.write:all'
      when 'print_proof' then 'files.process:entity'
      when 'knowledge' then 'knowledge.vault.write:all'
      when 'consent_evidence' then 'crm.account.write:own'
    end
    when 'read' then case p_purpose
      when 'import' then 'imports.write'
      when 'quote_pdf' then 'crm.lead.read'
      when 'signed_quote' then 'crm.lead.read'
      when 'entity_logo' then 'company'
      when 'letterhead' then 'company'
      when 'print_proof' then 'admin.entities.write'
      when 'consent_evidence' then 'crm.account.write'
    end
  end
$$;
--> statement-breakpoint

-- 3. knowledge_files.
create trigger set_updated_at before update on knowledge_files
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- A request changes only a vault file's state, and only to waiting (index it again) or archived;
-- the index job's outcomes (indexed, failed, unavailable) and the columns that go with them are
-- recorded by app.record_knowledge_index() alone, which writes as the owner. Indexing again clears
-- the last reason. Archiving takes the file's chunks out of search at once: the trigger after it
-- removes them as the owner, since no request may write a chunk.
create or replace function app.knowledge_files_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(app.user_id(), new.updated_by);
  if current_user <> 'app_user' then
    return new;
  end if;
  if new.state is distinct from old.state and new.state not in ('waiting', 'archived') then
    raise exception 'only the index job records how reading a vault file went'
      using errcode = 'insufficient_privilege';
  end if;
  if new.state = 'waiting' and old.state <> 'waiting' then
    new.error_reason := null;
  end if;
  if new.state = 'archived' then
    new.chunks := 0;
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.knowledge_files_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger knowledge_files_guard before update on knowledge_files
  for each row execute function app.knowledge_files_guard();
--> statement-breakpoint

create or replace function app.knowledge_files_archived() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.knowledge_chunks where knowledge_file_id = new.id;
  return null;
end
$$;
--> statement-breakpoint
revoke execute on function app.knowledge_files_archived() from public, readonly_reporter;
--> statement-breakpoint
create trigger knowledge_files_archived after update of state on knowledge_files
  for each row when (new.state = 'archived' and old.state is distinct from 'archived')
  execute function app.knowledge_files_archived();
--> statement-breakpoint

alter table knowledge_files enable row level security;
--> statement-breakpoint
alter table knowledge_files force row level security;
--> statement-breakpoint
create policy knowledge_files_read on knowledge_files for select to app_user, app_reader using (
  (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0))
  and ((sensitivity = 'staff_ai_ok' and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (sensitivity = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))
    or (sensitivity = 'exec_only' and (select app.has_perm('knowledge.vault.read.exec:all')))));
--> statement-breakpoint
-- A vault file is added by a holder of knowledge.vault.write from their own vault upload, waiting
-- to be read, with a sensitivity they may read themselves, for a company of the request (the one
-- the upload is stored in) or, in a request for every company, for the whole group. Its source
-- type is the upload's.
create policy knowledge_files_insert on knowledge_files for insert to app_user with check (
  (select app.has_perm('knowledge.vault.write:all'))
  and created_by = (select app.user_id())
  and state = 'waiting' and chunks = 0 and indexed_at is null and error_reason is null
  and ((sensitivity = 'staff_ai_ok' and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (sensitivity = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))
    or (sensitivity = 'exec_only' and (select app.has_perm('knowledge.vault.read.exec:all'))))
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and (select app.request_covers_group())))
  and exists (select 1 from files f
               where f.id = knowledge_files.file_id
                 and f.purpose = 'knowledge'
                 and f.created_by = (select app.user_id())
                 and f.entity_id = any ((select app.entity_ids())::int[])
                 and (knowledge_files.entity_id is null or f.entity_id = knowledge_files.entity_id)
                 and knowledge_files.source_type = case f.content_type
                   when 'application/pdf' then 'pdf'
                   when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'word'
                   when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'excel'
                   else 'photo' end));
--> statement-breakpoint
-- Indexed again or archived by a holder of knowledge.vault.write who reads the file; a file of the
-- whole group only in a request for every company.
create policy knowledge_files_update on knowledge_files for update to app_user
  using ((select app.has_perm('knowledge.vault.write:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
           or (entity_id is null and (select app.request_covers_group())))
         and ((sensitivity = 'staff_ai_ok' and (select app.has_perm('knowledge.vault.read.staff:all')))
           or (sensitivity = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))
           or (sensitivity = 'exec_only' and (select app.has_perm('knowledge.vault.read.exec:all')))))
  with check ((select app.has_perm('knowledge.vault.write:all'))
              and (entity_id = any ((select app.entity_ids())::int[])
                or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
grant select on knowledge_files to app_user, app_reader;
--> statement-breakpoint
grant insert on knowledge_files to app_user;
--> statement-breakpoint
grant update (state, updated_at, updated_by) on knowledge_files to app_user;
--> statement-breakpoint

-- 4. knowledge_chunks: read by the same rule as their file, from their own copy of its company and
--    sensitivity, so a search filters on the chunk itself; written only through
--    app.record_knowledge_index() and removed when the file is archived.
alter table knowledge_chunks enable row level security;
--> statement-breakpoint
alter table knowledge_chunks force row level security;
--> statement-breakpoint
create policy knowledge_chunks_read on knowledge_chunks for select to app_user, app_reader using (
  (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0))
  and ((sensitivity = 'staff_ai_ok' and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (sensitivity = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))
    or (sensitivity = 'exec_only' and (select app.has_perm('knowledge.vault.read.exec:all')))));
--> statement-breakpoint
grant select on knowledge_chunks to app_user, app_reader;
--> statement-breakpoint

-- 5. A vault upload of a company of the request is read with a vault file the caller reads (by
--    its sensitivity), or by its uploader while they hold knowledge.vault.write, so they can finish
--    their upload and add it. Policies of one command are joined with OR, so files_read is
--    unchanged for every other file. The vault file is looked up by a definer that applies
--    knowledge_files_read itself: a policy on files that read knowledge_files under its own policy,
--    whose insert check reads files, would recurse.
create or replace function app.vault_upload_readable(p_file_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.knowledge_files kf
     where kf.file_id = p_file_id
       and (kf.entity_id = any (app.entity_ids())
         or (kf.entity_id is null and pg_catalog.cardinality(app.entity_ids()) > 0))
       and ((kf.sensitivity = 'staff_ai_ok' and app.has_perm('knowledge.vault.read.staff:all'))
         or (kf.sensitivity = 'management' and app.has_perm('knowledge.vault.read.management:all'))
         or (kf.sensitivity = 'exec_only' and app.has_perm('knowledge.vault.read.exec:all'))))
$$;
--> statement-breakpoint
revoke execute on function app.vault_upload_readable(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.vault_upload_readable(uuid) to app_user, app_reader;
--> statement-breakpoint
create policy files_knowledge_read on files for select to app_user, app_reader using (
  purpose = 'knowledge'
  and entity_id = any ((select app.entity_ids())::int[])
  and ((created_by = (select app.user_id()) and (select app.has_perm('knowledge.vault.write:all')))
    or app.vault_upload_readable(id)));
--> statement-breakpoint

-- 6. The index job's definers. Each needs knowledge.index (system:workers alone, SECURITY §3.3) and
--    reaches only vault files whose upload is stored in a company of the request; none answers a
--    chunk's text or a file's title. The job calls them on app_user's pool only.

-- The vault files waiting on an upload that has just passed its checks or been refused by them.
create or replace function app.knowledge_files_waiting_on(p_file_id uuid)
  returns table (knowledge_file_id uuid, entity_id smallint, sensitivity text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_perm('knowledge.index:entity') then
    raise exception 'knowledge.index is required' using errcode = '42501';
  end if;
  return query
    select kf.id, kf.entity_id, kf.sensitivity
      from public.knowledge_files kf
      join public.files f on f.id = kf.file_id
     where kf.file_id = p_file_id
       and kf.state = 'waiting'
       and f.entity_id = any (app.entity_ids())
     order by kf.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.knowledge_files_waiting_on(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.knowledge_files_waiting_on(uuid) to app_user;
--> statement-breakpoint

-- What the index job needs to read one vault file: its company and sensitivity, its upload and
-- where that is stored, what it is, where it stands and how many passages it has.
create or replace function app.knowledge_file_for_index(p_id uuid)
  returns table (knowledge_file_id uuid, entity_id smallint, file_id uuid, file_entity_id smallint,
                 sensitivity text, source_type text, state text, chunks integer)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_perm('knowledge.index:entity') then
    raise exception 'knowledge.index is required' using errcode = '42501';
  end if;
  return query
    select kf.id, kf.entity_id, kf.file_id, f.entity_id, kf.sensitivity, kf.source_type, kf.state,
           kf.chunks
      from public.knowledge_files kf
      join public.files f on f.id = kf.file_id
     where kf.id = p_id
       and f.entity_id = any (app.entity_ids());
end
$$;
--> statement-breakpoint
revoke execute on function app.knowledge_file_for_index(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.knowledge_file_for_index(uuid) to app_user;
--> statement-breakpoint

-- Records how reading a waiting vault file went. `indexed` replaces the file's chunks with
-- p_chunks (`[{id, position, text, embedding}]`), each taking the file's company and sensitivity,
-- and answers how many it replaced; `failed` and `unavailable` keep the chunks it had and record
-- the reason. A file no longer waiting (archived or indexed meanwhile, or a delivery that ran
-- again) is left as it is and the answer is null. The row is locked, so two deliveries take turns.
create or replace function app.record_knowledge_index(p_id uuid, p_state text, p_reason text,
                                                      p_chunks jsonb)
  returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_file public.knowledge_files;
  v_replaced integer := 0;
  v_count integer := 0;
begin
  if not app.has_perm('knowledge.index:entity') then
    raise exception 'knowledge.index is required' using errcode = '42501';
  end if;
  if p_state not in ('indexed', 'failed', 'unavailable') then
    raise exception 'an index outcome is indexed, failed or unavailable' using errcode = '22023';
  end if;
  select kf.* into v_file
    from public.knowledge_files kf
    join public.files f on f.id = kf.file_id
   where kf.id = p_id
     and f.entity_id = any (app.entity_ids())
     for update of kf;
  if not found then
    raise exception 'the vault file is not in a company of the request' using errcode = 'P0002';
  end if;
  if v_file.state <> 'waiting' then
    return null;
  end if;
  if p_state = 'indexed' then
    if p_chunks is null or pg_catalog.jsonb_typeof(p_chunks) <> 'array'
       or pg_catalog.jsonb_array_length(p_chunks) = 0 then
      raise exception 'an indexed vault file has chunks' using errcode = '22023';
    end if;
    delete from public.knowledge_chunks where knowledge_file_id = p_id;
    get diagnostics v_replaced = row_count;
    insert into public.knowledge_chunks
      (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
    select (c->>'id')::uuid, p_id, v_file.entity_id, v_file.sensitivity, (c->>'position')::integer,
           c->>'text', (c->'embedding')::text::public.vector
      from pg_catalog.jsonb_array_elements(p_chunks) c;
    get diagnostics v_count = row_count;
    update public.knowledge_files
       set state = 'indexed', chunks = v_count, indexed_at = pg_catalog.now(), error_reason = null
     where id = p_id;
  else
    update public.knowledge_files
       set state = p_state, error_reason = p_reason
     where id = p_id;
  end if;
  return v_replaced;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_knowledge_index(uuid, text, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_knowledge_index(uuid, text, text, jsonb) to app_user;
