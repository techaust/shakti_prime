-- V2 Live voice Teach and Ask (docs/03-roadmap-appendix/phase2.md §7.5, BLUEPRINT §9.2, ADR 0010,
-- SECURITY §3.4): row security and grants of voice_sessions, the voice principal's marker in the
-- audit trail, and the two definers through which a session is opened by its person
-- (`voice.session.start`, `voice.use`) and recorded by the platform (`voice.session.record`, the
-- platform-only grant of `system:workers`).

-- 1. voice.session.record is platform-only, like the other workers' grants: the sixteen keys of
--    0183 (with W1's messaging.process), kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record']::text[]
$$;
--> statement-breakpoint

-- 2. The voice session a request acts through (`app.voice_session_id`, set by
--    withRequestContext() only for a `voice_session` principal), null for everyone else. The
--    person stays `app.user_id()`, so every policy reads them as themselves.
create or replace function app.voice_session_id() returns uuid
  language sql stable set search_path = '' as $$
  select nullif(pg_catalog.current_setting('app.voice_session_id', true), '')::uuid
$$;
--> statement-breakpoint
revoke execute on function app.voice_session_id() from public;
--> statement-breakpoint
grant execute on function app.voice_session_id() to app_user, app_reader, readonly_reporter;
--> statement-breakpoint

-- 3. The audit trail names a voice session as its actor and the speaking person beside it
--    (SECURITY §3.4): a request acting through a session writes rows of kind voice_session for
--    that session and its person only; every other request writes rows as itself, as before.
drop policy audit_logs_insert on audit_logs;
--> statement-breakpoint
create policy audit_logs_insert on audit_logs for insert to app_user
  with check (
    command not like 'auth.%'
    and (entity_id is null or entity_id = any ((select app.entity_ids())::int[]))
    and case when (select app.voice_session_id()) is null
             then actor_principal_id = (select app.user_id())
             else actor_kind = 'voice_session'
                  and actor_principal_id = (select app.voice_session_id())
                  and on_behalf_of_user_id = (select app.user_id())
        end
  );
--> statement-breakpoint

-- 4. A voice session is not a person signed in as themselves: the merge definers refuse it as
--    they refuse an agent and the system principal (0113), whatever the person holds.
create or replace function app.request_is_person() returns boolean
  language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.current_setting('app.role', true), '') not like 'agent:%'
     and coalesce(pg_catalog.current_setting('app.role', true), '') not like 'system:%'
     and coalesce(pg_catalog.current_setting('app.voice_session_id', true), '') = ''
     and exists (select 1 from public.principals p
                  where p.id = app.user_id() and p.kind = 'user')
$$;
--> statement-breakpoint
revoke execute on function app.request_is_person() from public, readonly_reporter;
--> statement-breakpoint

-- 5. voice_sessions: its person reads their own sessions, and the Executive (audit.read for the
--    group) everyone's, in a request covering every company the session covers. No request role
--    writes the table: the two definers below do.
alter table voice_sessions enable row level security;
--> statement-breakpoint
alter table voice_sessions force row level security;
--> statement-breakpoint
create policy voice_sessions_read on voice_sessions for select to app_user, app_reader using (
  (user_id = (select app.user_id()) or (select app.has_perm('audit.read:all')))
  and entity_ids::int[] <@ (select app.entity_ids())::int[]);
--> statement-breakpoint
revoke all on voice_sessions from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint
grant select on voice_sessions to app_user, app_reader;
--> statement-breakpoint
create trigger voice_sessions_set_updated_at before update on voice_sessions
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- 6. The start of the day in India for an instant, when a person's minutes and spend start again.
create or replace function app.voice_day_start(p_at timestamptz) returns timestamptz
  language sql stable set search_path = '' as $$
  select pg_catalog.date_trunc('day', p_at at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
$$;
--> statement-breakpoint
revoke execute on function app.voice_day_start(timestamptz) from public, readonly_reporter;
--> statement-breakpoint

-- 7. voice.session.start: opens a session for the person themselves (never an agent, a voice
--    session or the system), holding voice.use, over companies of the request. One session of a
--    person is live at a time: their earlier sessions still open end now, at most p_session_minutes
--    after they began, with their minutes rounded up. Then the day's minutes and spend of all
--    their sessions, in every company, are read; at either limit nothing is written and the answer
--    is 'cap_reached'. Otherwise the session's principal (kind voice_session, named as the person)
--    and its row are written: 'started'. Starts of one person wait for each other.
create or replace function app.voice_session_open(
  p_session uuid,
  p_entity_ids smallint[],
  p_mode text,
  p_consent boolean,
  p_day_minutes integer,
  p_day_paise integer,
  p_session_minutes integer
) returns table (outcome text, minutes_used integer, paise_used integer, started_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user uuid := app.user_id();
  v_now timestamptz := pg_catalog.now();
  v_minutes integer;
  v_paise integer;
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

  update public.voice_sessions vs
     set ended_at = least(v_now, vs.started_at + pg_catalog.make_interval(mins => p_session_minutes)),
         minutes = least(p_session_minutes, greatest(0, pg_catalog.ceil(extract(epoch from
                     least(v_now, vs.started_at + pg_catalog.make_interval(mins => p_session_minutes))
                     - vs.started_at) / 60.0)::integer))
   where vs.user_id = v_user and vs.ended_at is null;

  select coalesce(sum(vs.minutes), 0)::integer, coalesce(sum(vs.cost_paise), 0)::integer
    into v_minutes, v_paise
    from public.voice_sessions vs
   where vs.user_id = v_user and vs.started_at >= app.voice_day_start(v_now);

  if v_minutes >= p_day_minutes or v_paise >= p_day_paise then
    return query select 'cap_reached'::text, v_minutes, v_paise, null::timestamptz;
    return;
  end if;

  select p.display_name into v_name from public.principals p where p.id = v_user;
  insert into public.principals (id, kind, display_name, created_by)
  values (p_session, 'voice_session', coalesce(v_name, 'Talk to Shakti'), v_user);
  insert into public.voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording,
                                     started_at)
  values (p_session, v_user,
          case when pg_catalog.cardinality(p_entity_ids) = 1 then p_entity_ids[1] end,
          p_entity_ids, p_mode, p_consent, v_now);
  return query select 'started'::text, v_minutes, v_paise, v_now;
end
$$;
--> statement-breakpoint
revoke execute on function app.voice_session_open(uuid, smallint[], text, boolean, integer, integer, integer) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.voice_session_open(uuid, smallint[], text, boolean, integer, integer, integer) to app_user;
--> statement-breakpoint

-- 8. voice.session.record: what LiveKit's events and the worker's report tell of a session, for
--    the platform (voice.session.record), with no company of its own, since a session may cover
--    several. Each value only moves forward: the end is kept once set (never before the start),
--    minutes and spend never go down, minutes come only with an end (from the times when none is
--    given), and turn stats replace the earlier ones only with more turns. 'missing' for an
--    unknown session, 'unchanged' when nothing moved, else 'recorded'; answers the session as it
--    now stands.
create or replace function app.record_voice_session(
  p_session uuid,
  p_ended_at timestamptz,
  p_minutes integer,
  p_cost_paise integer,
  p_turn_stats jsonb
) returns table (outcome text, entity_id smallint, user_id uuid, ended_at timestamptz,
                 minutes integer, cost_paise integer)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v public.voice_sessions%rowtype;
  v_end timestamptz;
  v_minutes integer;
  v_cost integer;
  v_stats jsonb;
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
                        null::integer, null::integer;
    return;
  end if;
  v_end := coalesce(v.ended_at, greatest(p_ended_at, v.started_at));
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
  if v_end is not distinct from v.ended_at and v_minutes is not distinct from v.minutes
     and v_cost = v.cost_paise and v_stats = v.turn_stats_json then
    return query select 'unchanged'::text, v.entity_id, v.user_id, v.ended_at, v.minutes,
                        v.cost_paise;
    return;
  end if;
  update public.voice_sessions vs
     set ended_at = v_end, minutes = v_minutes, cost_paise = v_cost, turn_stats_json = v_stats
   where vs.id = p_session;
  return query select 'recorded'::text, v.entity_id, v.user_id, v_end, v_minutes, v_cost;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_voice_session(uuid, timestamptz, integer, integer, jsonb) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.record_voice_session(uuid, timestamptz, integer, integer, jsonb) to app_user;
