-- W1 fix round (docs/03-roadmap-appendix/phase2.md §6.1; review of 15-11-2026). Every function
-- below is redefined whole; anonymise_stale_leads() from 0173 (T3's, on 0142) keeps every line and
-- adds the customer's WhatsApp chats.

-- 1. Whether a number has opted out of WhatsApp (CRM-10, LAW-2: one consent for the group): by the
--    number, in every company. Its latest STOP on any company's thread (or the caller's own,
--    `p_stopped_at`) with no WhatsApp consent of a holder of the number given since; or a holder
--    of the number, on any customer, withdrew WhatsApp consent and gave none since (E1's rule for
--    calls). A thread whose number was removed (null) has nothing to send to and counts as opted
--    out. Called by the guard and the definers as their owner; no request role calls it.
create or replace function app.whatsapp_number_opted_out(p_e164 text, p_stopped_at timestamptz)
  returns boolean
  language sql stable set search_path = '' as $$
  with stop as (
    select greatest(p_stopped_at,
                    (select pg_catalog.max(t.opted_out_at) from public.whatsapp_threads t
                      where t.wa_id = pg_catalog.ltrim(p_e164, '+'))) as at
  )
  select p_e164 is null
      or ((select s.at from stop s) is not null
          and not exists (select 1 from public.contact_phones cp
                            join public.consents g on g.contact_id = cp.contact_id
                           where cp.e164 = p_e164 and g.channel = 'whatsapp'
                             and g.withdrawn_at is null and g.given_at > (select s.at from stop s)))
      or exists (select 1 from public.contact_phones cp
                   join public.consents w on w.contact_id = cp.contact_id
                  where cp.e164 = p_e164 and w.channel = 'whatsapp' and w.withdrawn_at is not null
                    and not exists (select 1 from public.consents g
                                     where g.contact_id = w.contact_id and g.channel = 'whatsapp'
                                       and g.withdrawn_at is null and g.given_at > w.withdrawn_at))
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_number_opted_out(text, timestamptz) from public, app_user, app_reader, readonly_reporter;
--> statement-breakpoint

-- 2. The guard of whatsapp_messages, as 0169 wrote it, with two changes: no outbound message,
--    the STOP confirmation included, to a thread whose number was removed; and the stale-lead
--    anonymisation may clear an inbound message's text and button reply (to null, nothing else)
--    on a chat it is anonymising in this transaction (`app.lead_anonymise_scope`).
create or replace function app.whatsapp_messages_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_wa_id text;
  v_stopped_at timestamptz;
begin
  if tg_op = 'DELETE' then
    raise exception 'whatsapp_messages is append-only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.direction = 'outbound' then
      if new.status <> 'queued' or new.provider_message_id is not null
         or new.send_attempted_at is not null then
        raise exception 'an outbound message starts queued' using errcode = 'check_violation';
      end if;
      select t.wa_id, t.opted_out_at into v_wa_id, v_stopped_at
        from public.whatsapp_threads t where t.id = new.thread_id;
      if v_wa_id is null then
        raise exception 'the chat has no number to send to' using errcode = 'check_violation';
      end if;
      if new.kind <> 'system' and app.whatsapp_number_opted_out('+' || v_wa_id, v_stopped_at) then
        raise exception 'the customer has opted out of WhatsApp' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;
  if old.direction = 'inbound'
     and new.body_masked is null and new.button_payload is null
     and (old.body_masked is not null or old.button_payload is not null)
     and app.in_lead_anonymise_scope(old.thread_id::text)
     and (new.id, new.entity_id, new.thread_id, new.direction, new.kind, new.created_at,
          new.template_name, new.template_params, new.sent_by, new.drafted_by_agent_action_id,
          new.file_id, new.provider_message_id, new.send_attempted_at, new.status)
         is not distinct from
         (old.id, old.entity_id, old.thread_id, old.direction, old.kind, old.created_at,
          old.template_name, old.template_params, old.sent_by, old.drafted_by_agent_action_id,
          old.file_id, old.provider_message_id, old.send_attempted_at, old.status) then
    return new;
  end if;
  if (new.id, new.entity_id, new.thread_id, new.direction, new.kind, new.created_at)
       is distinct from (old.id, old.entity_id, old.thread_id, old.direction, old.kind, old.created_at)
     or (new.template_name, new.template_params, new.body_masked, new.button_payload, new.sent_by,
         new.drafted_by_agent_action_id)
       is distinct from (old.template_name, old.template_params, old.body_masked, old.button_payload,
                         old.sent_by, old.drafted_by_agent_action_id)
     or (old.file_id is not null and new.file_id is distinct from old.file_id)
     or (old.provider_message_id is not null
         and new.provider_message_id is distinct from old.provider_message_id)
     or (old.send_attempted_at is not null
         and new.send_attempted_at is distinct from old.send_attempted_at) then
    raise exception 'a message keeps what it was written with' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status
     and not app.whatsapp_status_moves(old.status, new.status) then
    raise exception 'a message status only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_messages_guard() from public, readonly_reporter;
--> statement-breakpoint

-- 3. Whether a thread's number has opted out, as 0169 answered it, now finding the thread by its
--    id (a thread whose number was removed is still found, and answers opted out).
create or replace function app.whatsapp_thread_opted_out(p_thread uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v_wa_id text;
  v_stopped_at timestamptz;
begin
  if app.user_id() is null
     or not (app.has_perm('crm.lead.read:own') or app.has_perm('crm.account.read:own')
             or app.has_perm('messaging.send:own') or app.has_perm('messaging.process:entity')) then
    raise exception 'crm.lead.read, crm.account.read or messaging.send is required'
      using errcode = '42501';
  end if;
  select t.id, t.wa_id, t.opted_out_at into v_id, v_wa_id, v_stopped_at
    from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_id is null then
    raise exception 'thread % is of no company of the request', p_thread using errcode = '42501';
  end if;
  return app.whatsapp_number_opted_out('+' || v_wa_id, v_stopped_at);
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_thread_opted_out(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_thread_opted_out(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. An inbound message (messaging.inbound.record), as 0169 recorded it, with four changes: a new
--    thread starts with whoever `p_handled_by` names (people, with the reason `no_assistant`,
--    while no assistant answers chats), and with the number's latest STOP of any company; a
--    repeated delivery answers what the first did (`first_message` when it was the thread's
--    first, the holders of the number when the thread is unmatched), so the handler can finish
--    every step an earlier try did not; and the message's file, so a file already kept is not
--    downloaded again.
drop function if exists app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz);
--> statement-breakpoint
create or replace function app.whatsapp_record_inbound(
  p_phone_number_id text,
  p_wa_id text,
  p_provider_message_id text,
  p_kind text,
  p_body_masked text,
  p_button_payload text,
  p_sent_at timestamptz,
  p_handled_by text
) returns table (
  entity_id smallint,
  thread_id uuid,
  message_id uuid,
  duplicate boolean,
  first_message boolean,
  account_id uuid,
  opportunity_id uuid,
  holders int,
  opted_out boolean,
  handled_by text,
  file_id uuid
)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_channel_id uuid;
  v_entity smallint;
  v_thread public.whatsapp_threads;
  v_created boolean;
  v_key public.whatsapp_message_keys;
  v_message uuid;
  v_at timestamptz := least(coalesce(p_sent_at, pg_catalog.now()), pg_catalog.now());
  v_holders int;
  v_account uuid;
  v_phone uuid;
  v_lead uuid;
  v_lead_owner uuid;
  v_first boolean;
  v_file uuid;
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('text', 'media', 'button')
     or p_wa_id is null or p_wa_id !~ '^[1-9][0-9]{6,14}$'
     or p_handled_by is null or p_handled_by not in ('assistant', 'people') then
    raise exception 'an inbound message needs its kind, the sender''s number and who answers'
      using errcode = 'check_violation';
  end if;
  select ec.id, ec.entity_id into v_channel_id, v_entity
    from public.entity_channels ec
   where ec.provider_ref = p_phone_number_id and ec.channel = 'whatsapp' and ec.is_active
     and ec.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_channel_id is null then
    return;
  end if;

  -- One delivery of a message at a time: the second waits, then finds the key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('whatsapp:' || p_provider_message_id, 0));
  select * into v_key from public.whatsapp_message_keys k
   where k.provider_message_id = p_provider_message_id;
  if v_key.provider_message_id is not null then
    select * into v_thread from public.whatsapp_threads t where t.id = v_key.thread_id;
    select m.file_id into v_file from public.whatsapp_messages m
     where m.id = v_key.message_id and m.created_at = v_key.message_created_at;
    v_first := not exists (select 1 from public.whatsapp_messages m
                            where m.thread_id = v_thread.id and m.direction = 'inbound'
                              and (m.created_at, m.id) < (v_key.message_created_at, v_key.message_id));
    select pg_catalog.count(distinct a.id)::int into v_holders
      from public.contact_phones cp
      join public.account_contacts ac on ac.contact_id = cp.contact_id
      join public.accounts a on a.id = ac.account_id and a.archived_at is null
      join public.account_entities ae on ae.account_id = a.id and ae.entity_id = v_thread.entity_id
     where cp.e164 = '+' || v_thread.wa_id;
    return query select v_thread.entity_id, v_thread.id, v_key.message_id, true, v_first,
                        v_thread.account_id, v_thread.opportunity_id, coalesce(v_holders, 0),
                        app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at),
                        v_thread.handled_by, v_file;
    return;
  end if;

  insert into public.whatsapp_threads (id, entity_id, channel_id, wa_id, handled_by, handoff_reason,
                                       handed_off_at, opted_out_at, created_by)
  values (app.uuid_v7(), v_entity, v_channel_id, p_wa_id, p_handled_by,
          case when p_handled_by = 'people' then 'no_assistant' end,
          case when p_handled_by = 'people' then pg_catalog.now() end,
          (select pg_catalog.max(o.opted_out_at) from public.whatsapp_threads o where o.wa_id = p_wa_id),
          v_actor)
  on conflict on constraint whatsapp_threads_channel_wa_unique do nothing;
  v_created := found;
  select * into v_thread from public.whatsapp_threads t
   where t.channel_id = v_channel_id and t.wa_id = p_wa_id for update;

  -- The company's live customers holding the number.
  select pg_catalog.count(distinct a.id)::int, (pg_catalog.array_agg(distinct a.id))[1]
    into v_holders, v_account
    from public.contact_phones cp
    join public.account_contacts ac on ac.contact_id = cp.contact_id
    join public.accounts a on a.id = ac.account_id and a.archived_at is null
    join public.account_entities ae on ae.account_id = a.id and ae.entity_id = v_entity
   where cp.e164 = '+' || p_wa_id;
  if v_thread.account_id is not null then
    v_account := v_thread.account_id;
  elsif v_holders <> 1 then
    v_account := null;
  end if;
  if v_account is not null then
    select cp.id into v_phone
      from public.contact_phones cp
      join public.account_contacts ac on ac.contact_id = cp.contact_id
     where ac.account_id = v_account and cp.e164 = '+' || p_wa_id
     order by cp.is_primary desc, cp.id
     limit 1;
    select o.id, o.owner_id into v_lead, v_lead_owner
      from public.opportunities o
     where o.account_id = v_account and o.entity_id = v_entity
       and o.state = 'open' and o.archived_at is null
     order by o.created_at desc, o.id desc
     limit 1;
  end if;

  v_message := app.uuid_v7();
  insert into public.whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id,
                                        body_masked, button_payload, created_at)
  values (v_message, v_entity, v_thread.id, 'inbound', p_kind, p_provider_message_id,
          p_body_masked, p_button_payload, v_at);
  insert into public.whatsapp_message_keys (provider_message_id, entity_id, message_id,
                                            message_created_at, thread_id)
  values (p_provider_message_id, v_entity, v_message, v_at, v_thread.id);

  update public.whatsapp_threads t
     set account_id = v_account,
         contact_phone_id = v_phone,
         opportunity_id = v_lead,
         assignee_id = coalesce(v_lead_owner,
                                (select ae.owner_id from public.account_entities ae
                                  where ae.account_id = v_account and ae.entity_id = v_entity)),
         window_open_until = greatest(t.window_open_until, v_at + interval '24 hours'),
         last_inbound_at = greatest(t.last_inbound_at, v_at),
         needs_reply = true,
         updated_by = v_actor
   where t.id = v_thread.id
  returning * into v_thread;

  return query select v_thread.entity_id, v_thread.id, v_message, false, v_created,
                      v_thread.account_id, v_thread.opportunity_id, v_holders,
                      app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at),
                      v_thread.handled_by, null::uuid;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz, text) to app_user;
--> statement-breakpoint

-- 5. STOP (messaging.opt_out.record): the number opts out in every company (the owner's decision
--    of 15-11-2026, LAW-2's one consent): every company's thread to the number carries the STOP,
--    and every WhatsApp consent of every holder of the number is withdrawn, each withdrawal of
--    the thread's own customer written on its timeline; whether or not a consent existed. A
--    number already opted out withdraws nothing (`newly` false), and a thread of it with no STOP
--    yet takes this one, so the STOP is confirmed on it; a STOP older than a consent given since
--    changes nothing. No row when the thread is not of the request's companies.
create or replace function app.whatsapp_record_opt_out(p_thread uuid, p_at timestamptz)
  returns table (opted_out_at timestamptz, newly boolean, consents_withdrawn int)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_thread public.whatsapp_threads;
  v_at timestamptz := least(coalesce(p_at, pg_catalog.now()), pg_catalog.now());
  v_withdrawn int := 0;
  v_consent record;
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select * into v_thread from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_thread.id is null then
    return;
  end if;
  if v_thread.wa_id is null then
    return query select v_thread.opted_out_at, false, 0;
    return;
  end if;
  -- A STOP older than a WhatsApp consent a holder gave since (a delivery of it handled again
  -- later) changes nothing: the consent given after it stands.
  if exists (select 1 from public.contact_phones cp
               join public.consents g on g.contact_id = cp.contact_id
              where cp.e164 = '+' || v_thread.wa_id and g.channel = 'whatsapp'
                and g.withdrawn_at is null and g.given_at > v_at) then
    return query select v_thread.opted_out_at, false, 0;
    return;
  end if;
  if app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at) then
    update public.whatsapp_threads t
       set opted_out_at = v_at, updated_by = v_actor
     where t.wa_id = v_thread.wa_id and t.opted_out_at is null;
    return query select coalesce(v_thread.opted_out_at, v_at), false, 0;
    return;
  end if;
  for v_consent in
    update public.consents c
       set withdrawn_at = v_at, updated_at = pg_catalog.now(), updated_by = v_actor
     where c.channel = 'whatsapp' and c.withdrawn_at is null
       and c.contact_id in (select cp.contact_id from public.contact_phones cp
                             where cp.e164 = '+' || v_thread.wa_id)
    returning c.id, c.contact_id, c.channel, c.purpose
  loop
    v_withdrawn := v_withdrawn + 1;
    if v_thread.account_id is not null
       and exists (select 1 from public.account_contacts ac
                    where ac.account_id = v_thread.account_id and ac.contact_id = v_consent.contact_id) then
      insert into public.activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, payload_json)
      values (app.uuid_v7(), v_thread.entity_id, null, v_thread.account_id, 'consent_withdrawn', v_actor,
              pg_catalog.jsonb_build_object('consentId', v_consent.id, 'channel', v_consent.channel,
                                            'purpose', v_consent.purpose));
    end if;
  end loop;
  update public.whatsapp_threads t
     set opted_out_at = v_at, updated_by = v_actor
   where t.wa_id = v_thread.wa_id;
  return query select v_at, true, v_withdrawn;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_opt_out(uuid, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_opt_out(uuid, timestamptz) to app_user;
--> statement-breakpoint

-- 6. The platform queues a template of its own (messaging.message.queue), as 0169 did, now safe
--    to ask for twice: the welcome (kind template) once per thread (`welcomed_at`), and the STOP
--    confirmation (kind system) once after each STOP and only while the number is still opted
--    out (a consent given since the STOP means no confirmation); a second ask, or one for a thread
--    whose number was removed, queues nothing and answers a row with no message. No row when the
--    thread is not of the request's companies.
create or replace function app.whatsapp_queue_message(
  p_thread uuid,
  p_kind text,
  p_template_name text,
  p_params jsonb
) returns table (message_id uuid, created_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_thread public.whatsapp_threads;
  v_id uuid := app.uuid_v7();
  v_at timestamptz := pg_catalog.now();
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('template', 'system') or p_template_name is null then
    raise exception 'the platform queues a template or a confirmation' using errcode = 'check_violation';
  end if;
  select * into v_thread from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_thread.id is null then
    return;
  end if;
  if v_thread.wa_id is null
     or (p_kind = 'template' and v_thread.welcomed_at is not null)
     or (p_kind = 'system'
         and (v_thread.opted_out_at is null
              or not app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at)
              or exists (select 1 from public.whatsapp_messages m
                          where m.thread_id = v_thread.id and m.kind = 'system'
                            and m.direction = 'outbound' and m.created_at >= v_thread.opted_out_at))) then
    return query select null::uuid, null::timestamptz;
    return;
  end if;
  insert into public.whatsapp_messages (id, entity_id, thread_id, direction, kind, template_name,
                                        template_params, status, sent_by, created_at)
  values (v_id, v_thread.entity_id, v_thread.id, 'outbound', p_kind, p_template_name, p_params,
          'queued', v_actor, v_at);
  if p_kind = 'template' then
    update public.whatsapp_threads t set welcomed_at = v_at, updated_by = v_actor
     where t.id = v_thread.id;
  end if;
  return query select v_id, v_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_queue_message(uuid, text, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_queue_message(uuid, text, text, jsonb) to app_user;
--> statement-breakpoint

-- 7. The worker takes a queued message to send it (messaging.message.claim), as 0169 did, and
--    checks the opt-out again as it takes it, so a STOP recorded after the worker read its facts
--    still stops the send; the STOP confirmation alone goes to an opted-out number.
create or replace function app.whatsapp_claim_send(p_message uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_taken int;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  update public.whatsapp_messages m
     set send_attempted_at = pg_catalog.now()
   where m.id = p_message and m.direction = 'outbound' and m.status = 'queued'
     and m.send_attempted_at is null
     and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and (m.kind = 'system'
          or not exists (select 1 from public.whatsapp_threads t
                          where t.id = m.thread_id
                            and app.whatsapp_number_opted_out('+' || t.wa_id, t.opted_out_at)));
  get diagnostics v_taken = row_count;
  return v_taken = 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_claim_send(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_claim_send(uuid) to app_user;
--> statement-breakpoint

-- 8. An Executive names a template for staff (`label`).
grant update (category, label, params, buttons, purpose, updated_at, updated_by) on whatsapp_templates to app_user;
--> statement-breakpoint

-- 9. The stale-lead anonymisation, as 0173 wrote it (0142 with T3's provider calls), also removing the customer's WhatsApp
--    chats' number and the customer's own words (the owner's rule of 13-10-2026 that the numbers
--    go): the chats stay, as facts without the person. A customer who wrote on WhatsApp within the
--    period is passed by, as one with any other recent activity.
create or replace function app.anonymise_stale_leads(p_entity smallint, p_months integer,
                                                     p_leads uuid[], p_kept uuid[])
  returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cutoff timestamptz;
  v_run uuid := app.uuid_v7();
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_actor uuid := app.user_id();
  v_tx xid8 := pg_catalog.pg_current_xact_id();
  v_account uuid;
  v_leads uuid[];
  v_contacts uuid[];
  v_threads uuid[];
  v_subjects uuid[];
  v_held bigint;
  v_done uuid[] := '{}';
  v_kept integer := 0;
  v_failed integer := 0;
  v_state text;
  v_constraint text;
  v_error text;
begin
  if v_actor is null or not app.has_perm('crm.retention.run:entity') then
    raise exception 'crm.retention.run is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_months is null or p_months < 12 or p_months > 120 then
    raise exception 'the retention period must be between 12 and 120 months'
      using errcode = '22023';
  end if;
  v_cutoff := pg_catalog.now() - pg_catalog.make_interval(months => p_months);

  -- The leads found kept, each with its reason: the window passes them by until a reason that
  -- can lapse does (step 12).
  update public.opportunities o
     set retention_kept_at = pg_catalog.now(), retention_kept_reason = k.reason
    from (select x.id, app.lead_kept_reason(x.id) as reason
            from public.opportunities x
           where x.entity_id = p_entity
             and x.id = any (coalesce(p_kept, '{}'::uuid[]))
             and x.retention_kept_at is null
             and x.anonymised_at is null
             and x.state <> 'won') k
   where o.id = k.id and k.reason is not null;
  get diagnostics v_kept = row_count;

  for v_account in
    select distinct o.account_id
      from public.opportunities o
     where o.entity_id = p_entity and o.id = any (coalesce(p_leads, '{}'::uuid[]))
     order by 1
  loop
    begin
      -- Hold the customer and every lead of it, in every company; a quote, an order, a lead or any
      -- other write being made for one of them holds a lock on it, and the customer waits for the
      -- next night.
      select coalesce(pg_catalog.array_agg(l.id), '{}'), pg_catalog.count(*)
        into v_leads, v_held
        from (select o.id
                from public.opportunities o
                join public.accounts a on a.id = o.account_id
               where o.account_id = v_account
               order by o.id
                 for update of o, a skip locked) l;
      continue when v_held = 0
        or v_held <> (select pg_catalog.count(*) from public.opportunities o
                       where o.account_id = v_account);
      -- Hold the customer's people.
      select coalesce(pg_catalog.array_agg(c.id), '{}'), pg_catalog.count(*)
        into v_contacts, v_held
        from (select c.id
                from public.contacts c
               where c.id in (select ac.contact_id from public.account_contacts ac
                               where ac.account_id = v_account)
               order by c.id
                 for update skip locked) c;
      continue when v_held <> (select pg_catalog.count(*) from public.account_contacts ac
                                where ac.account_id = v_account);
      -- Every lead of the customer is checked again, now that all are held.
      continue when exists (select 1 from pg_catalog.unnest(v_leads) l(id)
                             where not app.lead_is_stale(l.id, v_cutoff));

      -- A customer who wrote on WhatsApp within the period is not idle: passed by tonight.
      continue when exists (select 1 from public.whatsapp_threads x
                             where x.account_id = v_account and x.last_inbound_at >= v_cutoff);
      -- The customer's WhatsApp chats, in every company.
      v_threads := array(select x.id from public.whatsapp_threads x where x.account_id = v_account);

      -- Name every subject for the append-only triggers' one exception (step 10).
      v_subjects := v_leads || v_account || v_contacts || v_threads
        || array(select x.id from public.customer_sites x where x.account_id = v_account)
        || array(select x.id from public.account_entities x where x.account_id = v_account)
        || array(select x.id from public.tasks x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.calls x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.provider_calls x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.sizings x where x.opportunity_id = any (v_leads))
        || array(select x.id from public.consents x where x.contact_id = any (v_contacts))
        || array(select x.id from public.inbox_items x
                  where x.subject_id = any (v_leads) or x.subject_id = v_account);
      insert into app.lead_anonymise_scope (tx, subject_id)
      select v_tx, s from pg_catalog.unnest(v_subjects) s;

      -- The customer's notes.
      delete from public.activities x where x.account_id = v_account and x.type = 'note';

      -- The agent's note and a follow-up's title on its proposals about the leads.
      update public.agent_actions x
         set input_json = x.input_json - array['note', 'title'],
             decided_input_json = x.decided_input_json - array['note', 'title']
       where x.input_json ->> 'opportunityId' = any (array(select l::text from pg_catalog.unnest(v_leads) l))
         and (x.input_json ?| array['note', 'title']
              or coalesce(x.decided_input_json ?| array['note', 'title'], false));

      -- The notes of Agent Inbox items about the leads or the customer.
      update public.inbox_items x
         set note = null, updated_by = v_actor
       where (x.subject_id = any (v_leads) or x.subject_id = v_account)
         and x.note is not null;

      update public.tasks x
         set title = null, updated_by = v_actor
       where x.opportunity_id = any (v_leads) and x.title is not null;

      delete from public.contact_phones x where x.contact_id = any (v_contacts);

      -- T3: the leads' provider calls keep no phone (the delete above cleared it) and no provider
      -- id, by which the provider could find the numbers; their recordings are due for removal at
      -- once (app.call_recordings_due() names the recordings of an anonymised lead).
      update public.provider_calls x
         set provider_call_sid = null
       where x.opportunity_id = any (v_leads) and x.provider_call_sid is not null;

      -- The customer's WhatsApp chats lose the number and wait for no one; the customer's own
      -- words and button replies are cleared (the guard's one exception), so nothing in a chat
      -- names the person. A message from the number later opens a new chat.
      update public.whatsapp_threads x
         set wa_id = null, needs_reply = false, updated_by = v_actor
       where x.id = any (v_threads);
      update public.whatsapp_messages x
         set body_masked = null, button_payload = null
       where x.thread_id = any (v_threads) and x.direction = 'inbound'
         and (x.body_masked is not null or x.button_payload is not null);

      update public.contacts x
         set name = '', email = null,
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = any (v_contacts);

      update public.customer_sites x
         set address = null, village = null, pin = null, lat = null, lng = null,
             technical_json = '{}'::jsonb,
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.account_id = v_account;

      update public.accounts x
         set name = '', gstin = null, anonymised_at = pg_catalog.now(),
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = v_account;

      update public.opportunities x
         set campaign_json = '{}'::jsonb, anonymised_at = pg_catalog.now(),
             archived_at = coalesce(x.archived_at, pg_catalog.now()), updated_by = v_actor
       where x.id = any (v_leads);

      -- The import rows that made the leads or the customer (on `import_rows_created_idx`), then
      -- the later rows of the same files skipped as repeats of them (on
      -- `import_rows_skipped_repeat_idx`): what the file said is removed; the row's state, what it
      -- made and why it was refused stay, so the job's reconciliation still adds up.
      with made as (
        update public.import_rows r
           set raw_json = '{}'::jsonb, normalised_json = null, dedupe_json = null,
               updated_by = v_actor
         where (r.created_type = 'opportunity' and r.created_id = any (v_leads))
            or (r.created_type in ('account', 'account_link') and r.created_id = v_account)
        returning r.job_id, r.row_no
      )
      update public.import_rows s
         set raw_json = '{}'::jsonb, normalised_json = null, dedupe_json = null,
             updated_by = v_actor
        from made
       where s.job_id = made.job_id
         and s.state = 'skipped'
         and s.dedupe_json ->> 'inFileRowNo' = made.row_no::text;

      -- The audit rows about any of the subjects: by their record, or by the customer or lead
      -- their input names (a note, a task, a lead made or refused for the known customer, an
      -- agent's run about a lead), each found on its own index.
      update public.audit_logs l
         set input_json = app.audit_blank(l.input_json),
             before_json = app.audit_blank(l.before_json),
             after_json = app.audit_blank(l.after_json)
       where (l.id, l.created_at) in (
               select x.id, x.created_at from public.audit_logs x
                where x.aggregate_type = any (array['opportunity', 'account', 'customer',
                                                    'contact', 'site', 'account_entity', 'task',
                                                    'call', 'sizing', 'consent', 'inbox_item'])
                  and x.aggregate_id = any (array(select s::text from pg_catalog.unnest(v_subjects) s))
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'accountId' and x.input_json ->> 'accountId' = v_account::text
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'opportunityId'
                  and x.input_json ->> 'opportunityId'
                      = any (array(select l::text from pg_catalog.unnest(v_leads) l))
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'existingAccountId'
                  and x.input_json ->> 'existingAccountId' = v_account::text
               union
               select x.id, x.created_at from public.audit_logs x
                where x.input_json ? 'proposal'
                  and x.input_json #>> '{proposal,input,opportunityId}'
                      = any (array(select l::text from pg_catalog.unnest(v_leads) l)));

      delete from app.lead_anonymise_scope s where s.tx = v_tx;
      v_done := v_done || v_leads;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
      v_failed := v_failed + 1;
      v_error := 'failed with code ' || v_state
                   || case when coalesce(v_constraint, '') = '' then ''
                           else ' on ' || v_constraint end;
    end;
  end loop;

  insert into public.retention_runs (id, job, started_at, finished_at, rows_affected, error)
  values (v_run, 'leads-anonymise', v_started, pg_catalog.clock_timestamp(),
          pg_catalog.cardinality(v_done),
          case when v_failed = 0 then null
               else v_error || ' for ' || v_failed::text
                    || case when v_failed = 1 then ' customer' else ' customers' end end);
  return pg_catalog.jsonb_build_object(
    'leads', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', o.id, 'entityId', o.entity_id) order by o.id)
                         from public.opportunities o where o.id = any (v_done)), '[]'::jsonb),
    'kept', v_kept,
    'failed', v_failed,
    'error', case when v_failed = 0 then null else v_error end);
end
$$;
--> statement-breakpoint
revoke execute on function app.anonymise_stale_leads(smallint, integer, uuid[], uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.anonymise_stale_leads(smallint, integer, uuid[], uuid[]) to app_user;
