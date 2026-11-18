-- V2 Live voice (docs/03-roadmap-appendix/phase2.md §7.5): a Teach session the person let be
-- recorded keeps its audio and its transcript, which the voice worker files in the Knowledge Vault
-- as the person (K3, `exec_only`), and the platform links them to the session from LiveKit's
-- events (`voice.session.record`). app.record_voice_session() takes the two files as well: each is
-- linked once, never replaced, only to a session whose person answered yes to the recording
-- question (voice_sessions_recording_check holds it too), and only a vault file that person
-- uploaded (`files_linked` false otherwise, and the files are left as they were). The rest is
-- 0190's rule.

drop function app.record_voice_session(uuid, timestamptz, integer, integer, jsonb);
--> statement-breakpoint
create or replace function app.record_voice_session(
  p_session uuid,
  p_ended_at timestamptz,
  p_minutes integer,
  p_cost_paise integer,
  p_turn_stats jsonb,
  p_audio_file uuid,
  p_transcript_file uuid
) returns table (outcome text, entity_id smallint, user_id uuid, ended_at timestamptz,
                 minutes integer, cost_paise integer, files_linked boolean)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.voice_sessions%rowtype;
  v_end timestamptz;
  v_minutes integer;
  v_cost integer;
  v_stats jsonb;
  v_audio uuid;
  v_transcript uuid;
  v_linked boolean := true;
begin
  if app.user_id() is null or not app.has_perm('voice.session.record:all') then
    raise exception 'voice.session.record is required' using errcode = '42501';
  end if;
  if (p_minutes is not null and p_minutes < 0) or (p_cost_paise is not null and p_cost_paise < 0)
     or (p_turn_stats is not null and pg_catalog.jsonb_typeof(p_turn_stats) <> 'object') then
    raise exception 'minutes, spend and turn stats must be positive and well formed'
      using errcode = 'check_violation';
  end if;
  select * into v from public.voice_sessions vs where vs.id = p_session for update;
  if not found then
    return query select 'missing'::text, null::smallint, null::uuid, null::timestamptz,
                        null::integer, null::integer, false;
    return;
  end if;
  -- greatest() passes over a null, so an event without an end keeps the session open.
  v_end := coalesce(v.ended_at,
                    case when p_ended_at is not null then greatest(p_ended_at, v.started_at) end);
  v_minutes := case
    when v_end is null then null
    when p_minutes is not null then greatest(coalesce(v.minutes, 0), least(p_minutes, 1440))
    when v.minutes is not null then v.minutes
    else least(1440, greatest(0, pg_catalog.ceil(extract(epoch from v_end - v.started_at) / 60.0)::integer))
  end;
  v_cost := greatest(v.cost_paise, coalesce(p_cost_paise, 0));
  v_stats := case
    when p_turn_stats is not null
         and coalesce((p_turn_stats ->> 'turns')::integer, -1)
             > coalesce((v.turn_stats_json ->> 'turns')::integer, -1)
    then p_turn_stats else v.turn_stats_json end;
  -- A file is linked only with the recording answer, to a vault file of the session's person.
  v_audio := v.audio_file_id;
  v_transcript := v.transcript_file_id;
  if p_audio_file is not null and v_audio is null then
    if v.consent_recording and exists (select 1 from public.files f
                                        where f.id = p_audio_file and f.purpose = 'knowledge'
                                          and f.created_by = v.user_id) then
      v_audio := p_audio_file;
    else
      v_linked := false;
    end if;
  end if;
  if p_transcript_file is not null and v_transcript is null then
    if v.consent_recording and exists (select 1 from public.files f
                                        where f.id = p_transcript_file and f.purpose = 'knowledge'
                                          and f.created_by = v.user_id) then
      v_transcript := p_transcript_file;
    else
      v_linked := false;
    end if;
  end if;
  if v_end is not distinct from v.ended_at and v_minutes is not distinct from v.minutes
     and v_cost = v.cost_paise and v_stats = v.turn_stats_json
     and v_audio is not distinct from v.audio_file_id
     and v_transcript is not distinct from v.transcript_file_id then
    return query select 'unchanged'::text, v.entity_id, v.user_id, v.ended_at, v.minutes,
                        v.cost_paise, v_linked;
    return;
  end if;
  update public.voice_sessions vs
     set ended_at = v_end, minutes = v_minutes, cost_paise = v_cost, turn_stats_json = v_stats,
         audio_file_id = v_audio, transcript_file_id = v_transcript
   where vs.id = p_session;
  return query select 'recorded'::text, v.entity_id, v.user_id, v_end, v_minutes, v_cost, v_linked;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_voice_session(uuid, timestamptz, integer, integer, jsonb, uuid, uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.record_voice_session(uuid, timestamptz, integer, integer, jsonb, uuid, uuid) to app_user;
