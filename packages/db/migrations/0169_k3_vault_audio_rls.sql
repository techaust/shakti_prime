-- Vault audio (docs/03-roadmap-appendix/phase2.md §6.4, docs/05-database.md §6.9, ADR 0014): a
-- vault file may be a recording (`audio`, a WAV upload), whose transcript is its text. The index
-- job keeps the transcript through app.record_knowledge_transcript() before it cuts it into
-- passages, and reads it back through app.knowledge_file_transcript(), so a delivery tried again
-- never pays for the recording twice. A holder of knowledge.vault.write who reads the file replaces
-- the transcript with a correction (`knowledge.transcript.correct`), which sends the file back to
-- waiting so it is read again from the corrected text. The transcript is a column of the vault file,
-- so it is read by the file's own company and sensitivity (knowledge_files_read).

-- 1. A vault file is added from a WAV upload as `audio`, with no transcript yet.
drop policy knowledge_files_insert on knowledge_files;
--> statement-breakpoint
create policy knowledge_files_insert on knowledge_files for insert to app_user with check (
  (select app.has_perm('knowledge.vault.write:all'))
  and created_by = (select app.user_id())
  and state = 'waiting' and chunks = 0 and indexed_at is null and error_reason is null
  and transcript is null and transcript_corrected_at is null
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
                   when 'audio/wav' then 'audio'
                   else 'photo' end));
--> statement-breakpoint

-- 2. A request changes a vault file's state only to waiting or archived, as before, and its
--    transcript only as a correction: of a recording that is indexed, failed or unavailable (never
--    while it is being read), to a transcript, with the file sent back to waiting. The correction's
--    time is the database's.
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
  if new.transcript is distinct from old.transcript
     or new.transcript_corrected_at is distinct from old.transcript_corrected_at then
    if old.source_type <> 'audio' or old.state not in ('indexed', 'failed', 'unavailable')
       or new.state <> 'waiting' or new.transcript is null then
      raise exception 'a transcript is corrected only on a recording that is not being read'
        using errcode = 'insufficient_privilege';
    end if;
    new.transcript_corrected_at := pg_catalog.now();
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
grant update (transcript, transcript_corrected_at) on knowledge_files to app_user;
--> statement-breakpoint

-- 3. The index job's definers for a recording's transcript. Each needs knowledge.index
--    (system:workers alone) and reaches only vault files whose upload is stored in a company of
--    the request; the job calls them on app_user's pool only.

-- The transcript kept for a vault recording (the index job's own, or a person's correction), or
-- null while it has none.
create or replace function app.knowledge_file_transcript(p_id uuid) returns text
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_transcript text;
begin
  if not app.has_perm('knowledge.index:entity') then
    raise exception 'knowledge.index is required' using errcode = '42501';
  end if;
  select kf.transcript into v_transcript
    from public.knowledge_files kf
    join public.files f on f.id = kf.file_id
   where kf.id = p_id
     and f.entity_id = any (app.entity_ids());
  return v_transcript;
end
$$;
--> statement-breakpoint
revoke execute on function app.knowledge_file_transcript(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.knowledge_file_transcript(uuid) to app_user;
--> statement-breakpoint

-- Keeps the transcript of a waiting vault recording that has none, and answers true; a file no
-- longer waiting, or one that already has a transcript (a delivery that ran again, a person's
-- correction), is left as it is and the answer is false. The row is locked, so two deliveries take
-- turns.
create or replace function app.record_knowledge_transcript(p_id uuid, p_transcript text)
  returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  v_file public.knowledge_files;
begin
  if not app.has_perm('knowledge.index:entity') then
    raise exception 'knowledge.index is required' using errcode = '42501';
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
  if v_file.source_type <> 'audio' then
    raise exception 'only a vault recording has a transcript' using errcode = '22023';
  end if;
  if v_file.state <> 'waiting' or v_file.transcript is not null then
    return false;
  end if;
  update public.knowledge_files set transcript = p_transcript where id = p_id;
  return true;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_knowledge_transcript(uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_knowledge_transcript(uuid, text) to app_user;
