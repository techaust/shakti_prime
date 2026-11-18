-- The Caller Co-pilot's fix round (the review of A2, 18-11-2026).

-- 1. When a brief was last started for a lead: the newest event since p_since that starts one, a
--    person's request (agents.brief.requested) or an assignment (crm.opportunity.assigned) of a
--    lead with no brief in the p_assigned_skip before it, which the brief worker skips. Asking for
--    a brief, and the panel's button, count these as well as the briefs written, so a brief is
--    asked for at most once an hour whether or not one came of it. The events are readable by no
--    request, so a person reading leads of the request's company reads only this time, for a lead
--    the caller has already read under its own policies.
create or replace function app.copilot_brief_started_at(
  p_entity smallint,
  p_opportunity uuid,
  p_since timestamptz,
  p_assigned_skip interval
) returns timestamptz
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('crm.lead.read:own') or app.has_perm('crm.lead.read:team')
             or app.has_perm('crm.lead.read:entity') or app.has_perm('crm.lead.read:all')) then
    raise exception 'crm.lead.read is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return (
    select max(e.created_at)
      from public.outbox_events e
     where e.aggregate_id = p_opportunity::text
       and e.type in ('agents.brief.requested', 'crm.opportunity.assigned')
       and e.created_at > p_since
       and e.entity_id = p_entity
       and e.aggregate_type = 'opportunity'
       and (e.type = 'agents.brief.requested'
            or not exists (select 1 from public.copilot_notes n
                            where n.opportunity_id = p_opportunity and n.entity_id = p_entity
                              and n.kind = 'brief'
                              and n.created_at <= e.created_at
                              and n.created_at > e.created_at - p_assigned_skip)));
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_brief_started_at(smallint, uuid, timestamptz, interval) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.copilot_brief_started_at(smallint, uuid, timestamptz, interval) to app_user, app_reader;
--> statement-breakpoint

-- 2. calls.transcript.reserve: before a call's masked transcript is stored, its file is recorded
--    `pending` under its own key, so bytes put in the store always have a row: if the run stops
--    before the transcript is attached, the sweep of abandoned uploads (files.upload.sweep) finds
--    the pending row a day later, refuses it and deletes whatever landed under its key. Only for
--    a call of the company with no transcript ('other_file' otherwise), ended, whose recording is
--    still kept and whose lead is not anonymised ('not_recorded'); 'missing' for no such call.
create or replace function app.reserve_call_transcript(
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
   where pc.id = p_call and pc.entity_id = p_entity;
  if not found then
    return query select 'missing'::text, null::uuid;
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
            'text/plain', p_size, p_sha256, 'pending',
            pg_catalog.jsonb_build_object('scanner', 'none', 'source', 'speech_to_text'),
            app.user_id())
    on conflict (id) do nothing;
  return query select 'reserved'::text, p_file;
end
$$;
--> statement-breakpoint
revoke execute on function app.reserve_call_transcript(smallint, uuid, uuid, text, text, integer, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.reserve_call_transcript(smallint, uuid, uuid, text, text, integer, text) to app_user;
--> statement-breakpoint

-- 3. calls.transcript.attach (0191): a transcript reserved first is made `ready` and attached, its
--    bucket, key, size and SHA-256 as reserved; one not reserved is recorded `ready` as before.
--    Every other line of 0191's definition is kept.
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
  if exists (select 1 from public.files f where f.id = p_file) then
    update public.files f
       set status = 'ready', updated_by = app.user_id()
     where f.id = p_file and f.entity_id = p_entity and f.purpose = 'call_transcript'
       and f.status = 'pending' and f.deleted_at is null
       and f.bucket = p_bucket and f.key = p_key and f.size = p_size and f.sha256 = p_sha256;
    if not found then
      raise exception 'the transcript is not the one reserved' using errcode = 'check_violation';
    end if;
  else
    insert into public.files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                              status, scan_result, created_by)
      values (p_file, p_entity, 'call_transcript', p_bucket, p_key, 'call-transcript.txt',
              'text/plain', p_size, p_sha256, 'ready',
              pg_catalog.jsonb_build_object('scanner', 'none', 'source', 'speech_to_text'),
              app.user_id());
  end if;
  update public.provider_calls pc set transcript_file_id = p_file where pc.id = p_call;
  return query select 'attached'::text, p_file;
end
$$;
