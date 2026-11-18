-- The Caller Co-pilot's workers (docs/03-roadmap-appendix/phase2.md §7.3): a recorded call's
-- transcript, made by the platform (system:workers holding calls.process) and read with the call
-- by whoever reads the lead (files_call_transcript_read). A call recording is readable by no
-- request, so the summary worker reads what it needs of the call through a definer, as the
-- recording sweep does; a transcript follows its recording's retention and an anonymised lead's
-- removal.

-- 1. What the summary worker needs of one provider call of the company: its lead, direction,
--    status, caller and end, whether the caller is a Lead Converter of the company (the coverage
--    setting, question 8), the recording as stored (none once removed) and the transcript if one
--    was made. No row for a call outside the request's companies.
create or replace function app.copilot_call_facts(p_entity smallint, p_call uuid)
  returns table (opportunity_id uuid, direction text, status text, caller_id uuid,
                 ended_at timestamptz, caller_converter boolean, lead_anonymised boolean,
                 recording_file_id uuid, recording_bucket text, recording_key text,
                 recording_content_type text, recording_size integer, recording_sha256 text,
                 transcript_file_id uuid, transcript_bucket text, transcript_key text,
                 transcript_sha256 text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_calls_process(p_entity);
  return query
    select pc.opportunity_id, pc.direction, pc.status, pc.caller_id, pc.ended_at,
           coalesce((select cp.is_converter from public.caller_profiles cp
                      where cp.user_id = pc.caller_id and cp.entity_id = pc.entity_id), false),
           coalesce(o.anonymised_at is not null, false),
           r.id, r.bucket, r.key, r.content_type, r.size, r.sha256,
           tr.id, tr.bucket, tr.key, tr.sha256
      from public.provider_calls pc
      left join public.opportunities o on o.id = pc.opportunity_id and o.entity_id = pc.entity_id
      left join public.files r
        on r.id = pc.recording_file_id and r.entity_id = pc.entity_id
       and r.purpose = 'call_recording' and r.status = 'ready' and r.deleted_at is null
      left join public.files tr
        on tr.id = pc.transcript_file_id and tr.entity_id = pc.entity_id
       and tr.purpose = 'call_transcript' and tr.deleted_at is null
     where pc.id = p_call and pc.entity_id = p_entity;
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_call_facts(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.copilot_call_facts(smallint, uuid) to app_user;
--> statement-breakpoint

-- 2. calls.transcript.attach: the masked transcript of a call's recording, stored under its own
--    key as plain text and recorded as the call's `call_transcript` file, once. Only for an ended
--    call whose recording is still kept and whose lead is not anonymised ('not_recorded'
--    otherwise); a call holding a transcript answers 'already' (the same file) or 'other_file'
--    and nothing changes.
create or replace function app.attach_call_transcript(
  p_entity smallint,
  p_call uuid,
  p_file uuid,
  p_bucket text,
  p_key text,
  p_size integer,
  p_sha256 text
) returns table (outcome text, file_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_call public.provider_calls%rowtype;
begin
  perform app.require_calls_process(p_entity);
  if p_key is distinct from (p_entity::text || '/call_transcript/' || p_file::text || '.txt') then
    raise exception 'a call transcript is stored under its own key' using errcode = 'check_violation';
  end if;
  select * into v_call from public.provider_calls pc
   where pc.id = p_call and pc.entity_id = p_entity
     for update;
  if not found then
    return query select 'missing'::text, null::uuid;
    return;
  end if;
  if v_call.transcript_file_id = p_file then
    return query select 'already'::text, p_file;
    return;
  end if;
  if v_call.transcript_file_id is not null then
    return query select 'other_file'::text, v_call.transcript_file_id;
    return;
  end if;
  if app.provider_call_rank(v_call.status) < 3
     or not exists (select 1 from public.files f
                     where f.id = v_call.recording_file_id and f.entity_id = p_entity
                       and f.purpose = 'call_recording' and f.deleted_at is null)
     or exists (select 1 from public.opportunities o
                 where o.id = v_call.opportunity_id and o.anonymised_at is not null) then
    return query select 'not_recorded'::text, null::uuid;
    return;
  end if;
  insert into public.files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                            status, scan_result, created_by)
    values (p_file, p_entity, 'call_transcript', p_bucket, p_key, 'call-transcript.txt',
            'text/plain', p_size, p_sha256, 'ready',
            pg_catalog.jsonb_build_object('scanner', 'none', 'source', 'speech_to_text'),
            app.user_id());
  update public.provider_calls pc set transcript_file_id = p_file where pc.id = p_call;
  return query select 'attached'::text, p_file;
end
$$;
--> statement-breakpoint
revoke execute on function app.attach_call_transcript(smallint, uuid, uuid, text, text, integer, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_call_transcript(smallint, uuid, uuid, text, text, integer, text) to app_user;
--> statement-breakpoint

-- 3. The recordings' sweep (0173) names a call's transcript beside its recording: kept as long as
--    recordings are (WORKSHOP_DEFAULTS.retention.callRecordingMonths), and due at once for an
--    anonymised lead. Every line of 0173's definition is kept; the purpose and the anonymised
--    lead's call now take either file.
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
     where f.purpose in ('call_recording', 'call_transcript')
       and f.deleted_at is null
       and f.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and (f.created_at < p_before
            or exists (select 1 from public.provider_calls pc
                         join public.opportunities o on o.id = pc.opportunity_id
                        where (pc.recording_file_id = f.id or pc.transcript_file_id = f.id)
                          and o.anonymised_at is not null))
     order by f.created_at, f.id
     limit least(greatest(coalesce(p_limit, 0), 0), 500);
end
$$;
--> statement-breakpoint

-- 4. Their removal (0169) marks a transcript deleted as it does a recording; every other line of
--    0169's definition is kept.
create or replace function app.drop_call_recording(p_entity smallint, p_file uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_calls_process(p_entity);
  update public.files f
     set deleted_at = pg_catalog.now()
   where f.id = p_file
     and f.entity_id = p_entity
     and f.purpose in ('call_recording', 'call_transcript')
     and f.deleted_at is null;
  return found;
end
$$;
