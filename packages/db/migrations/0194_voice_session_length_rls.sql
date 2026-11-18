-- V2 fix round (docs/03-roadmap-appendix/phase2.md §7.5, SECURITY §3.4): each session's own
-- longest length, and the person's earlier sessions ended with their rooms.
--
-- 1. app.voice_session_open() is 0190's, with two changes. The new session keeps its own longest
--    length (`max_minutes`): the smaller of a session's longest and the person's minutes left
--    that day. And it answers the ids of the person's earlier sessions it ended, so the start
--    route deletes their LiveKit rooms after the transaction. An earlier session ends now (never
--    past its own longest length), with the minutes it has run so far.
drop function app.voice_session_open(uuid, smallint[], text, boolean, integer, integer, integer);
--> statement-breakpoint
create or replace function app.voice_session_open(
  p_session uuid,
  p_entity_ids smallint[],
  p_mode text,
  p_consent boolean,
  p_day_minutes integer,
  p_day_paise integer,
  p_session_minutes integer
) returns table (outcome text, minutes_used integer, paise_used integer, started_at timestamptz,
                 max_minutes integer, ended_sessions uuid[])
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user uuid := app.user_id();
  v_now timestamptz := pg_catalog.now();
  v_minutes integer;
  v_paise integer;
  v_max integer;
  v_ended uuid[];
  v_name text;
begin
  if v_user is null or not app.has_perm('voice.use:all') then
    raise exception 'voice.use is required' using errcode = '42501';
  end if;
  if not app.request_is_person() then
    raise exception 'only a person may start a voice session' using errcode = '42501';
  end if;
  if p_entity_ids is null or pg_catalog.cardinality(p_entity_ids) = 0
     or not (p_entity_ids::int[] <@ coalesce(app.entity_ids(), '{}'::int[])) then
    raise exception 'the companies are outside the request' using errcode = '42501';
  end if;
  if p_session is null or p_consent is null or p_mode is null
     or p_day_minutes is null or p_day_minutes < 0 or p_day_paise is null or p_day_paise < 0
     or p_session_minutes is null or p_session_minutes < 1 then
    raise exception 'a session, its mode, the recording answer and the limits are required'
      using errcode = 'check_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voice:' || v_user::text, 0));

  with ended as (
    update public.voice_sessions vs
       set ended_at = least(v_now, vs.started_at + pg_catalog.make_interval(mins => vs.max_minutes)),
           minutes = least(vs.max_minutes, greatest(0, pg_catalog.ceil(extract(epoch from
                       least(v_now, vs.started_at + pg_catalog.make_interval(mins => vs.max_minutes))
                       - vs.started_at) / 60.0)::integer))
     where vs.user_id = v_user and vs.ended_at is null
    returning vs.id
  )
  select coalesce(pg_catalog.array_agg(ended.id), '{}'::uuid[]) into v_ended from ended;

  select coalesce(sum(vs.minutes), 0)::integer, coalesce(sum(vs.cost_paise), 0)::integer
    into v_minutes, v_paise
    from public.voice_sessions vs
   where vs.user_id = v_user and vs.started_at >= app.voice_day_start(v_now);

  if v_minutes >= p_day_minutes or v_paise >= p_day_paise then
    return query select 'cap_reached'::text, v_minutes, v_paise, null::timestamptz,
                        null::integer, v_ended;
    return;
  end if;
  v_max := least(p_session_minutes, p_day_minutes - v_minutes);

  select p.display_name into v_name from public.principals p where p.id = v_user;
  insert into public.principals (id, kind, display_name, created_by)
  values (p_session, 'voice_session', coalesce(v_name, 'Talk to Shakti'), v_user);
  insert into public.voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording,
                                     started_at, max_minutes)
  values (p_session, v_user,
          case when pg_catalog.cardinality(p_entity_ids) = 1 then p_entity_ids[1] end,
          p_entity_ids, p_mode, p_consent, v_now, v_max);
  return query select 'started'::text, v_minutes, v_paise, v_now, v_max, v_ended;
end
$$;
--> statement-breakpoint
revoke execute on function app.voice_session_open(uuid, smallint[], text, boolean, integer, integer, integer) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.voice_session_open(uuid, smallint[], text, boolean, integer, integer, integer) to app_user;
--> statement-breakpoint

-- 2. app.record_voice_session() is 0192's, with one change to the minutes. A later event's end
--    may still raise them, up to the session's own longest length, though the end itself is kept
--    once set: a session another start ended keeps its earlier end, and its room's later
--    `room_finished` counts the minutes it really ran. Minutes still never go down.
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
  -- The most of: the minutes kept, the minutes given, and the minutes from the start to this
  -- event's end (or to the session's own end while it has no minutes), at most its own longest.
  v_minutes := case
    when v_end is null then null
    else greatest(
      coalesce(v.minutes, 0),
      -- least() passes over a null too, so a report without minutes adds none.
      case when p_minutes is not null then least(p_minutes, 1440) else 0 end,
      least(v.max_minutes, greatest(0, pg_catalog.ceil(extract(epoch from
        greatest(p_ended_at, case when v.minutes is null then v_end end, v.started_at)
        - v.started_at) / 60.0)::integer)))
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
