-- T3 Click-to-dial and recordings, the provider's reports and the sweep (docs/03-roadmap-appendix/
-- phase2.md §6.3): which company a reported call belongs to, the dials the provider never took,
-- and which recordings on a timeline its reader may play.

-- 1. The status handler's lookup: a provider call by the id the signed callback address carried,
--    for the platform (calls.process), which holds no company until it knows the call's. No row
--    when the call holds another provider id than the one reported.
create or replace function app.provider_call_for_report(p_call uuid, p_sid text)
  returns table (entity_id smallint, status text, provider_call_sid text, has_recording boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select pc.entity_id, pc.status, pc.provider_call_sid, pc.recording_file_id is not null
      from public.provider_calls pc
     where pc.id = p_call
       and (p_sid is null or pc.provider_call_sid is null or pc.provider_call_sid = p_sid);
end
$$;
--> statement-breakpoint
revoke execute on function app.provider_call_for_report(uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.provider_call_for_report(uuid, text) to app_user;
--> statement-breakpoint

-- 2. The dials of the request's companies the provider never took nor reported (dialling, no
--    provider id) that started before p_before, oldest first, at most 500: the sweep records each
--    as failed through app.record_provider_call(), so no call stays open on a timeline for good.
create or replace function app.unplaced_provider_calls(p_before timestamptz, p_limit integer)
  returns table (id uuid, entity_id smallint)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select pc.id, pc.entity_id
      from public.provider_calls pc
     where pc.status = 'dialling'
       and pc.provider_call_sid is null
       and pc.started_at < p_before
       and pc.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     order by pc.started_at, pc.id
     limit least(greatest(coalesce(p_limit, 0), 0), 500);
end
$$;
--> statement-breakpoint
revoke execute on function app.unplaced_provider_calls(timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.unplaced_provider_calls(timestamptz, integer) to app_user;
--> statement-breakpoint

-- 3. Which of the provider calls named (a timeline page's, at most 200) have a kept recording
--    their reader may play: a person holding calls.recording.listen whose scope covers the call's
--    lead, in a company of the request, as app.call_recording_to_play() decides. Anyone else is
--    answered nothing rather than refused, since everyone who reads a timeline asks.
create or replace function app.playable_recordings(p_calls uuid[])
  returns table (provider_call_id uuid, entity_id smallint)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.request_is_person()
     or not app.has_perm('calls.recording.listen:team')
     or coalesce(pg_catalog.cardinality(p_calls), 0) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(p_calls) > 200 then
    raise exception 'at most 200 calls at a time' using errcode = 'check_violation';
  end if;
  return query
    select pc.id, pc.entity_id
      from public.provider_calls pc
      join public.opportunities o on o.id = pc.opportunity_id and o.entity_id = pc.entity_id
      join public.files f on f.id = pc.recording_file_id and f.entity_id = pc.entity_id
     where pc.id = any (p_calls)
       and pc.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and app.scope_ok('calls.recording.listen', o.owner_id, o.team_id)
       and f.purpose = 'call_recording'
       and f.status = 'ready'
       and f.deleted_at is null;
end
$$;
--> statement-breakpoint
revoke execute on function app.playable_recordings(uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.playable_recordings(uuid[]) to app_user, app_reader;
