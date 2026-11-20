-- S3's follow-up: a message the platform answers itself (STATUS, a one-time code; `platform` on
-- messaging.inbound.record) no longer marks its chat as waiting for a reply, so a STATUS or a code
-- alone on a chat handled by people brings no reply-waiting notice. A question the customer wrote
-- before it keeps the chat waiting, since the mark is only ever left as it was. Every other line is
-- 0188's definition, unchanged; the new argument defaults to false, so every earlier caller reads
-- as before.
drop function if exists app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz, text);
--> statement-breakpoint
create or replace function app.whatsapp_record_inbound(
  p_phone_number_id text,
  p_wa_id text,
  p_provider_message_id text,
  p_kind text,
  p_body_masked text,
  p_button_payload text,
  p_sent_at timestamptz,
  p_handled_by text,
  p_platform boolean default false
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
         -- A message the platform answers itself waits for no person; a question before it
         -- still does.
         needs_reply = t.needs_reply or not coalesce(p_platform, false),
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
revoke execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz, text, boolean) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz, text, boolean) to app_user;
