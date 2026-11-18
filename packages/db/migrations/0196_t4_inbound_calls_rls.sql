-- T4 Inbound calls and screen-pop (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05 and CRM-01):
-- what the platform records when Exotel's Passthru applet passes an inbound call through. Every
-- definer here checks the platform-only calls.process (held by system:workers alone, ADR 0020) and
-- reads or writes only the company the request names; none is reachable through a person's grant.
-- No policy changes: an inbound call through the IVR has no lead, so provider_calls_read (with the
-- lead) shows it to nobody; a missed call is read with the lead it made or joined, as a dial is.

-- 1. Which company's IVR or missed-call line a number is: the active lines with that number, for
--    the platform, which holds no company until it knows the call's. Several rows when companies
--    share a number; the handler then records nothing (one company per call).
create or replace function app.inbound_call_lines(p_number text)
  returns table (entity_id smallint, channel text)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select ec.entity_id, ec.channel
      from public.entity_channels ec
     where ec.number_e164 = p_number
       and ec.channel in ('ivr', 'missed_call')
       and ec.is_active
     order by ec.entity_id, ec.channel;
end
$$;
--> statement-breakpoint
revoke execute on function app.inbound_call_lines(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.inbound_call_lines(text) to app_user;
--> statement-breakpoint

-- 2. A provider call by the provider's id, whatever its company, so a repeated delivery is known
--    before anything is written.
create or replace function app.inbound_call_by_sid(p_sid text)
  returns table (id uuid, entity_id smallint, series text)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if app.user_id() is null or not app.has_perm('calls.process:entity') then
    raise exception 'calls.process is required' using errcode = '42501';
  end if;
  return query
    select pc.id, pc.entity_id, pc.series
      from public.provider_calls pc
     where pc.provider_call_sid = p_sid;
end
$$;
--> statement-breakpoint
revoke execute on function app.inbound_call_by_sid(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.inbound_call_by_sid(text) to app_user;
--> statement-breakpoint

-- 3. The company's customers with this number on a live contact (ADR 0008: a customer is the
--    company's through account_entities), never another company's: ids only, at most 20, the
--    oldest relationship first.
create or replace function app.inbound_call_customers(p_entity smallint, p_phone text)
  returns table (account_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_calls_process(p_entity);
  return query
    select m.acc
      from (select distinct on (ae.account_id) ae.account_id as acc, ae.created_at as since
              from public.contact_phones cp
              join public.contacts c on c.id = cp.contact_id and c.archived_at is null
              join public.account_contacts ac on ac.contact_id = cp.contact_id
              join public.accounts a on a.id = ac.account_id and a.archived_at is null
                                    and a.anonymised_at is null
              join public.account_entities ae on ae.account_id = ac.account_id
                                             and ae.entity_id = p_entity
             where cp.e164 = p_phone
             order by ae.account_id, ae.created_at) m
     order by m.since, m.acc
     limit 20;
end
$$;
--> statement-breakpoint
revoke execute on function app.inbound_call_customers(smallint, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.inbound_call_customers(smallint, text) to app_user;
--> statement-breakpoint

-- 4. Who the IVR is ringing: the one active person with a role in the company whose own dial phone
--    there (caller_profiles.dial_phone_e164, set by the person alone) is the number Exotel dials.
--    Null when nobody's is, or when two people share it, so no call pops for the wrong person.
create or replace function app.inbound_call_answerer(p_entity smallint, p_phone text)
  returns uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_people uuid[];
begin
  perform app.require_calls_process(p_entity);
  if p_phone is null then
    return null;
  end if;
  select coalesce(pg_catalog.array_agg(distinct cp.user_id), '{}') into v_people
    from public.caller_profiles cp
    join public.users u on u.id = cp.user_id and u.status = 'active'
   where cp.entity_id = p_entity
     and cp.dial_phone_e164 = p_phone
     and exists (select 1 from public.user_entity_roles uer
                  where uer.user_id = cp.user_id and uer.entity_id = p_entity);
  return case when pg_catalog.cardinality(v_people) = 1 then v_people[1] end;
end
$$;
--> statement-breakpoint
revoke execute on function app.inbound_call_answerer(smallint, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.inbound_call_answerer(smallint, text) to app_user;
--> statement-breakpoint

-- 5. calls.inbound_call.record on the IVR line: the call as ringing, with the person it rings (one
--    of the company's people) and no lead or phone (the number is never copied here). Keyed on the
--    provider's id: a repeat answers 'repeat' and writes nothing.
create or replace function app.record_inbound_call(p_entity smallint, p_call uuid, p_sid text,
                                                   p_caller uuid, p_started_at timestamptz)
  returns table (outcome text, provider_call_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  perform app.require_calls_process(p_entity);
  if p_sid is null or p_started_at is null then
    raise exception 'an inbound call has the provider''s id and its start' using errcode = 'check_violation';
  end if;
  if p_caller is not null
     and not exists (select 1 from public.user_entity_roles uer
                      where uer.user_id = p_caller and uer.entity_id = p_entity) then
    raise exception 'the person rung works in the company' using errcode = 'check_violation';
  end if;
  insert into public.provider_calls (id, entity_id, opportunity_id, contact_phone_id, caller_id,
                                     direction, series, purpose, provider_call_sid, status,
                                     started_at)
    values (p_call, p_entity, null, null, p_caller, 'inbound', 'ivr', null, p_sid, 'ringing',
            p_started_at)
    on conflict (provider_call_sid) do nothing
    returning id into v_id;
  if v_id is null then
    return query select 'repeat'::text, pc.id from public.provider_calls pc
                  where pc.provider_call_sid = p_sid;
    return;
  end if;
  return query select 'recorded'::text, v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_inbound_call(smallint, uuid, text, uuid, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_inbound_call(smallint, uuid, text, uuid, timestamptz) to app_user;
--> statement-breakpoint

-- 6. calls.inbound_call.record on the missed-call line: the call, unanswered, on the lead
--    crm.lead.ingest made or joined for the number in this transaction (with the phone it holds),
--    and a callback for the lead's owner at p_due, which must fall in calling hours (09:00 to 21:00
--    IST), unless an open callback of theirs on the lead is due by then already. No owner (the lead waits for whoever reads the company's leads), or an owner who no
--    longer works on leads in the company, means no callback. Keyed on the provider's id: a repeat
--    answers 'repeat' and writes nothing.
create or replace function app.record_missed_call(p_entity smallint, p_call uuid, p_sid text,
                                                  p_opportunity uuid, p_contact_phone uuid,
                                                  p_started_at timestamptz, p_due timestamptz)
  returns table (outcome text, provider_call_id uuid, owner_id uuid, task_id uuid,
                 due_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_account uuid;
  v_owner uuid;
  v_id uuid;
  v_team uuid;
  v_task uuid;
  v_actor uuid := app.user_id();
  v_minute integer;
begin
  perform app.require_calls_process(p_entity);
  if p_sid is null or p_started_at is null or p_due is null then
    raise exception 'a missed call has the provider''s id, its start and the callback''s time'
      using errcode = 'check_violation';
  end if;
  v_minute := (extract(hour from p_due at time zone 'Asia/Kolkata') * 60
               + extract(minute from p_due at time zone 'Asia/Kolkata'))::integer;
  if v_minute < 9 * 60 or v_minute >= 21 * 60 then
    raise exception 'a callback falls in calling hours' using errcode = 'check_violation';
  end if;
  select o.account_id, o.owner_id into v_account, v_owner
    from public.opportunities o
   where o.id = p_opportunity and o.entity_id = p_entity;
  if not found then
    raise exception 'the lead is not of the company' using errcode = 'check_violation';
  end if;
  if p_contact_phone is not null
     and not exists (select 1 from public.contact_phones cp
                       join public.account_contacts ac on ac.contact_id = cp.contact_id
                      where cp.id = p_contact_phone and ac.account_id = v_account) then
    raise exception 'the phone is the lead''s customer''s' using errcode = 'check_violation';
  end if;
  insert into public.provider_calls (id, entity_id, opportunity_id, contact_phone_id, caller_id,
                                     direction, series, purpose, provider_call_sid, status,
                                     started_at, ended_at)
    values (p_call, p_entity, p_opportunity, p_contact_phone, null, 'inbound', 'missed_call', null,
            p_sid, 'no_answer', p_started_at, p_started_at)
    on conflict (provider_call_sid) do nothing
    returning id into v_id;
  if v_id is null then
    return query select 'repeat'::text, pc.id, null::uuid, null::uuid, null::timestamptz
                   from public.provider_calls pc where pc.provider_call_sid = p_sid;
    return;
  end if;

  if v_owner is not null then
    -- The owner's team in the company, as a task names it.
    select uer.team_id into v_team
      from public.user_entity_roles uer
      join public.role_permissions rp on rp.role_id = uer.role_id
                                     and rp.permission_key = 'crm.lead.write'
      join public.users u on u.id = uer.user_id and u.status = 'active'
     where uer.user_id = v_owner and uer.entity_id = p_entity
     order by uer.id
     limit 1;
    if found and not exists (select 1 from public.tasks t
                              where t.opportunity_id = p_opportunity and t.entity_id = p_entity
                                and t.assignee_id = v_owner and t.kind = 'callback'
                                and t.state = 'open' and t.due_at <= p_due) then
      v_task := app.new_uuid7();
      insert into public.tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id,
                                kind, title, due_at, created_by)
        values (v_task, p_entity, p_opportunity, v_account, v_owner, v_team, 'callback', null,
                p_due, v_actor);
      insert into public.activities (id, entity_id, opportunity_id, account_id, type,
                                     actor_principal_id, payload_json)
        values (app.new_uuid7(), p_entity, p_opportunity, v_account, 'task_created', v_actor,
                pg_catalog.jsonb_build_object('taskId', v_task, 'kind', 'callback', 'dueAt', p_due,
                                              'assigneeId', v_owner));
    end if;
  end if;
  return query select 'recorded'::text, v_id, v_owner, v_task,
                      case when v_task is null then null::timestamptz else p_due end;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_missed_call(smallint, uuid, text, uuid, uuid, timestamptz, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_missed_call(smallint, uuid, text, uuid, uuid, timestamptz, timestamptz) to app_user;
