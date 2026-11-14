-- T3 Click-to-dial and recordings (docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01 and TEL-04):
-- the provider's call, read with its lead, recorded as dialling by the person who pressed Dial and
-- then only by the platform (calls.process) through the definers below, its status only moving
-- forward; the call's recording, stored as a call_recording file by the platform and heard only
-- through calls.recording.play; and the caller's own dial phone on their profile.

-- 1. The provider call's record is platform-only, like the other workers' grants: 0167's thirteen
--    keys, kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process']::text[]
$$;
--> statement-breakpoint

-- 2. How far a status has gone: dialling, then ringing, then on the line, then one of the ends.
--    An end is final: no status follows it, another end included.
create or replace function app.provider_call_rank(p_status text) returns smallint
  language sql immutable parallel safe set search_path = '' as $$
  select case p_status
           when 'dialling' then 0
           when 'ringing' then 1
           when 'in_progress' then 2
           else 3
         end::smallint
$$;
--> statement-breakpoint
revoke execute on function app.provider_call_rank(text) from public, readonly_reporter;
--> statement-breakpoint

-- 3. A provider call keeps whose call it was, to whom, on which line and when it started; its
--    provider id, answer and end times, length, recording, transcript and log are each set once;
--    and its status only moves forward, so a repeated or late report changes nothing back. Held
--    for every role, the platform's definers included; no role deletes a provider call.
create or replace function app.provider_calls_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (new.id, new.entity_id, new.opportunity_id, new.contact_phone_id, new.caller_id,
      new.direction, new.series, new.purpose, new.started_at, new.created_at)
     is distinct from
     (old.id, old.entity_id, old.opportunity_id, old.contact_phone_id, old.caller_id,
      old.direction, old.series, old.purpose, old.started_at, old.created_at) then
    raise exception 'a provider call keeps whose call it was and when it started'
      using errcode = 'check_violation';
  end if;
  if new.status <> old.status
     and app.provider_call_rank(new.status) <= app.provider_call_rank(old.status) then
    raise exception 'a call status only moves forward' using errcode = 'check_violation';
  end if;
  if (old.provider_call_sid is not null and new.provider_call_sid is distinct from old.provider_call_sid)
     or (old.answered_at is not null and new.answered_at is distinct from old.answered_at)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.duration_s is not null and new.duration_s is distinct from old.duration_s)
     or (old.recording_file_id is not null and new.recording_file_id is distinct from old.recording_file_id)
     or (old.transcript_file_id is not null and new.transcript_file_id is distinct from old.transcript_file_id)
     or (old.call_id is not null and new.call_id is distinct from old.call_id) then
    raise exception 'what the provider reported is recorded once' using errcode = 'check_violation';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.provider_calls_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger provider_calls_guard before update on provider_calls
  for each row execute function app.provider_calls_guard();
--> statement-breakpoint
create trigger provider_calls_no_delete before delete on provider_calls
  for each row execute function app.raise_append_only();
--> statement-breakpoint

-- 4. provider_calls: read with the lead (the exists runs under opportunities_read), as a call log
--    is. Inserted as dialling by the person who dials, whose calls.dial scope covers the lead, for
--    a phone of the lead's customer, with nothing the provider reports yet. A person changes only
--    the link to their own log of the call (call_id), once, to a call they logged on that lead.
alter table provider_calls enable row level security;
--> statement-breakpoint
alter table provider_calls force row level security;
--> statement-breakpoint
create policy provider_calls_read on provider_calls for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from opportunities o where o.id = provider_calls.opportunity_id));
--> statement-breakpoint
create policy provider_calls_insert on provider_calls for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and caller_id = (select app.user_id())
  and (select app.request_is_person())
  and direction = 'outbound'
  and status = 'dialling'
  and provider_call_sid is null and answered_at is null and ended_at is null and duration_s is null
  and recording_file_id is null and transcript_file_id is null and call_id is null
  and exists (select 1 from opportunities o
               where o.id = provider_calls.opportunity_id
                 and app.scope_ok('calls.dial', o.owner_id, o.team_id))
  and exists (select 1 from contact_phones cp
                join account_contacts ac on ac.contact_id = cp.contact_id
                join opportunities o on o.account_id = ac.account_id
               where cp.id = provider_calls.contact_phone_id
                 and o.id = provider_calls.opportunity_id));
--> statement-breakpoint
create policy provider_calls_link on provider_calls for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and caller_id = (select app.user_id())
         and call_id is null)
  with check (entity_id = any ((select app.entity_ids())::int[])
              and caller_id = (select app.user_id())
              and exists (select 1 from calls c
                           where c.id = provider_calls.call_id
                             and c.opportunity_id = provider_calls.opportunity_id
                             and c.caller_id = provider_calls.caller_id));
--> statement-breakpoint
revoke all on provider_calls from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on provider_calls to app_user;
--> statement-breakpoint
grant update (call_id) on provider_calls to app_user;
--> statement-breakpoint
grant select on provider_calls to app_reader;
--> statement-breakpoint
grant select on provider_calls to readonly_reporter;
--> statement-breakpoint

-- 5. The caller's own dial phone: set by the person alone, never by a manager who edits the rest of
--    their profile. Everything else of 0125's guard and insert policy stands.
create or replace function app.caller_profiles_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  new.updated_by := coalesce(app.user_id(), new.updated_by);
  -- Only a request is held to this; the table owner (the seeds, a repair) is not.
  if current_user <> 'app_user' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.entity_id is distinct from old.entity_id then
    raise exception 'a profile stays with its person and company' using errcode = 'insufficient_privilege';
  end if;
  if not app.caller_profile_manages(old.user_id, old.entity_id)
     and (new.is_converter is distinct from old.is_converter
          or new.max_open is distinct from old.max_open
          or new.languages is distinct from old.languages
          or new.segments is distinct from old.segments) then
    raise exception 'a person changes only their own presence' using errcode = 'insufficient_privilege';
  end if;
  if new.dial_phone_e164 is distinct from old.dial_phone_e164
     and old.user_id is distinct from app.user_id() then
    raise exception 'a person sets only their own dial phone' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
drop policy caller_profiles_insert on caller_profiles;
--> statement-breakpoint
create policy caller_profiles_insert on caller_profiles for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
              and coalesce(current_setting('app.role', true), '') not like 'system:%')
  and (dial_phone_e164 is null or user_id = (select app.user_id()))
  and (app.caller_profile_manages(user_id, entity_id)
       or (user_id = (select app.user_id())
           and not is_converter and max_open is null
           and languages = '{}'::text[] and segments = '{}'::text[])));
--> statement-breakpoint
grant update (dial_phone_e164) on caller_profiles to app_user;
--> statement-breakpoint

-- 6. The shared check of the platform's definers: calls.process (platform-only, held by
--    system:workers alone) and a company of the request.
create or replace function app.require_calls_process(p_entity smallint) returns void
  language plpgsql stable set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.require_calls_process(smallint) from public, readonly_reporter;
--> statement-breakpoint

-- 7. calls.provider_call.record: what the provider reported for a call of the company. The
--    provider's id is taken when the call has none yet and no other call holds it; a call that
--    holds another id, or an id another call holds, answers 'other_call' and nothing changes. A
--    status further on than the call's moves it there with the times and length that come with
--    it, each kept once set; the same or an earlier status changes nothing ('unchanged'). Answers
--    the call as it now stands.
create or replace function app.record_provider_call(
  p_entity smallint,
  p_call uuid,
  p_sid text,
  p_status text,
  p_answered_at timestamptz,
  p_ended_at timestamptz,
  p_duration_s integer
) returns table (outcome text, status text, opportunity_id uuid, caller_id uuid,
                 provider_call_sid text, ended_at timestamptz, duration_s integer)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_call public.provider_calls%rowtype;
  v_forward boolean;
  v_adopt boolean;
begin
  perform app.require_calls_process(p_entity);
  if p_status is null or p_status not in ('ringing', 'in_progress', 'completed', 'no_answer',
                                          'busy', 'failed', 'canceled') then
    raise exception 'a provider call status is required' using errcode = 'check_violation';
  end if;
  select * into v_call from public.provider_calls pc
   where pc.id = p_call and pc.entity_id = p_entity
     for update;
  if not found then
    return query select 'missing'::text, null::text, null::uuid, null::uuid, null::text,
                        null::timestamptz, null::integer;
    return;
  end if;
  if p_sid is not null
     and v_call.provider_call_sid is distinct from p_sid
     and (v_call.provider_call_sid is not null
          or exists (select 1 from public.provider_calls o where o.provider_call_sid = p_sid)) then
    return query select 'other_call'::text, v_call.status, v_call.opportunity_id, v_call.caller_id,
                        v_call.provider_call_sid, v_call.ended_at, v_call.duration_s;
    return;
  end if;
  v_forward := app.provider_call_rank(p_status) > app.provider_call_rank(v_call.status);
  v_adopt := v_call.provider_call_sid is null and p_sid is not null;
  if v_forward or v_adopt then
    update public.provider_calls pc
       set provider_call_sid = coalesce(pc.provider_call_sid, p_sid),
           status = case when v_forward then p_status else pc.status end,
           answered_at = case when v_forward then coalesce(pc.answered_at, p_answered_at)
                              else pc.answered_at end,
           ended_at = case when v_forward and app.provider_call_rank(p_status) = 3
                           then coalesce(pc.ended_at, p_ended_at) else pc.ended_at end,
           duration_s = case when v_forward and app.provider_call_rank(p_status) = 3
                             then coalesce(pc.duration_s, p_duration_s) else pc.duration_s end
     where pc.id = p_call
    returning pc.* into v_call;
  end if;
  return query select case when v_forward or v_adopt then 'moved' else 'unchanged' end::text,
                      v_call.status, v_call.opportunity_id, v_call.caller_id,
                      v_call.provider_call_sid, v_call.ended_at, v_call.duration_s;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_provider_call(smallint, uuid, text, text, timestamptz, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_provider_call(smallint, uuid, text, text, timestamptz, timestamptz, integer) to app_user;
--> statement-breakpoint

-- 8. calls.recording.attach: the recording the platform copied from the provider into the file
--    store, recorded as the ended call's call_recording file, ready, under the key its company,
--    purpose and id name (the provider's link is never kept). A repeat with the same file answers
--    'already'; a call that has another recording answers 'other_file', one not ended yet
--    'not_ended', and nothing changes.
create or replace function app.attach_call_recording(
  p_entity smallint,
  p_call uuid,
  p_file uuid,
  p_bucket text,
  p_key text,
  p_name text,
  p_content_type text,
  p_size integer,
  p_sha256 text
) returns table (outcome text, file_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_call public.provider_calls%rowtype;
begin
  perform app.require_calls_process(p_entity);
  if p_content_type is null or p_content_type not in ('audio/mpeg', 'audio/wav') then
    raise exception 'a call recording is an MP3 or a WAV file' using errcode = 'check_violation';
  end if;
  -- The extension's case sits in parentheses: an IF condition ends at its first bare THEN.
  if p_key is distinct from (p_entity::text || '/call_recording/' || p_file::text
       || (case p_content_type when 'audio/mpeg' then '.mp3' else '.wav' end)) then
    raise exception 'a call recording is stored under its own key' using errcode = 'check_violation';
  end if;
  select * into v_call from public.provider_calls pc
   where pc.id = p_call and pc.entity_id = p_entity
     for update;
  if not found then
    return query select 'missing'::text, null::uuid;
    return;
  end if;
  if v_call.recording_file_id = p_file then
    return query select 'already'::text, p_file;
    return;
  end if;
  if v_call.recording_file_id is not null then
    return query select 'other_file'::text, v_call.recording_file_id;
    return;
  end if;
  if app.provider_call_rank(v_call.status) < 3 then
    return query select 'not_ended'::text, null::uuid;
    return;
  end if;
  insert into public.files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                            status, scan_result, created_by)
    values (p_file, p_entity, 'call_recording', p_bucket, p_key, p_name, p_content_type, p_size,
            p_sha256, 'ready',
            pg_catalog.jsonb_build_object('scanner', 'none', 'source', 'call_provider'),
            app.user_id());
  update public.provider_calls pc set recording_file_id = p_file where pc.id = p_call;
  return query select 'attached'::text, p_file;
end
$$;
--> statement-breakpoint
revoke execute on function app.attach_call_recording(smallint, uuid, uuid, text, text, text, text, integer, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_call_recording(smallint, uuid, uuid, text, text, text, text, integer, text) to app_user;
--> statement-breakpoint

-- 9. The recordings' sweep: call recordings of the request's companies still stored and made
--    before p_before, oldest first, at most 500 at a time; and their removal, which marks the file
--    deleted once its bytes are gone and keeps the file's row and the call's.
create or replace function app.call_recordings_due(p_before timestamptz, p_limit integer)
  returns table (file_id uuid, entity_id smallint, bucket text, key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select f.id, f.entity_id, f.bucket, f.key
      from public.files f
     where f.purpose = 'call_recording'
       and f.deleted_at is null
       and f.created_at < p_before
       and f.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     order by f.created_at, f.id
     limit least(greatest(coalesce(p_limit, 0), 0), 500);
end
$$;
--> statement-breakpoint
revoke execute on function app.call_recordings_due(timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.call_recordings_due(timestamptz, integer) to app_user;
--> statement-breakpoint
create or replace function app.drop_call_recording(p_entity smallint, p_file uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_calls_process(p_entity);
  update public.files f
     set deleted_at = pg_catalog.now()
   where f.id = p_file
     and f.entity_id = p_entity
     and f.purpose = 'call_recording'
     and f.deleted_at is null;
  return found;
end
$$;
--> statement-breakpoint
revoke execute on function app.drop_call_recording(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.drop_call_recording(smallint, uuid) to app_user;
--> statement-breakpoint

-- 10. calls.recording.play: the stored recording of a provider call, for a person holding
--     calls.recording.listen whose scope covers the call's lead, in a company of the request. No
--     row when the call is not theirs to hear, has no recording, or its recording was removed.
--     The command audits every listen; the file itself is never readable as a file
--     (app.file_purpose_grant() names nothing for call_recording).
create or replace function app.call_recording_to_play(p_call uuid)
  returns table (file_id uuid, entity_id smallint, opportunity_id uuid, bucket text, key text,
                 name text, content_type text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.request_is_person()
     or not app.has_perm('calls.recording.listen:team') then
    raise exception 'a person holding calls.recording.listen is required' using errcode = '42501';
  end if;
  return query
    select f.id, pc.entity_id, pc.opportunity_id, f.bucket, f.key, f.name, f.content_type
      from public.provider_calls pc
      join public.opportunities o on o.id = pc.opportunity_id and o.entity_id = pc.entity_id
      join public.files f on f.id = pc.recording_file_id and f.entity_id = pc.entity_id
     where pc.id = p_call
       and pc.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and app.scope_ok('calls.recording.listen', o.owner_id, o.team_id)
       and f.purpose = 'call_recording'
       and f.status = 'ready'
       and f.deleted_at is null;
end
$$;
--> statement-breakpoint
revoke execute on function app.call_recording_to_play(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.call_recording_to_play(uuid) to app_user;
