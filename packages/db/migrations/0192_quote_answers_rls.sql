-- S3 steps 5 to 9 (docs/03-roadmap-appendix/phase2.md §7.1): what the platform reads and writes
-- to answer a customer on WhatsApp (the press of a quote's button, a one-time code, STATUS), the
-- extras the messaging worker adds to a quote's message as it sends it, and the lead a quote's
-- notices go to. Each definer has search_path = '' and checks its grant in its body.

-- 1. A customer's message the platform answers (messaging.process): its chat, the chat's number
--    and customer, its kind and a button's own id. Only an inbound message of the request's
--    companies; nothing else of the chat.
create or replace function app.whatsapp_inbound_facts(p_message uuid)
  returns table (
    message_id uuid,
    entity_id smallint,
    thread_id uuid,
    kind text,
    button_payload text,
    wa_id text,
    account_id uuid,
    created_at timestamptz
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  return query
    select m.id, m.entity_id, m.thread_id, m.kind, m.button_payload, t.wa_id, t.account_id,
           m.created_at
      from public.whatsapp_messages m
      join public.whatsapp_threads t on t.id = m.thread_id
     where m.id = p_message and m.direction = 'inbound'
       and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_inbound_facts(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_inbound_facts(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 2. The platform's answer on a chat (messaging.answer.queue, messaging.process): a text in the
--    customer's window (STATUS, an acceptance, a code that does not match), or the company's
--    template of an answering purpose: the one-time code (`acceptance_code`, stored with no value:
--    the code is never kept, the messaging worker makes it as it sends) or the answer on a lapsed
--    quote (`quote_expired`, with the quote's number). The message's id is the caller's, so the
--    code can be made from it. Nothing is queued for a chat whose number was removed or opted out.
--    No row when the chat is not of the request's companies.
create or replace function app.whatsapp_queue_answer(
  p_thread uuid,
  p_message uuid,
  p_kind text,
  p_template_name text,
  p_params jsonb,
  p_body text
) returns table (outcome text, message_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_thread public.whatsapp_threads;
  v_template public.whatsapp_templates;
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_message is null or p_kind is null or p_kind not in ('text', 'template') then
    raise exception 'an answer is a text or a template' using errcode = 'check_violation';
  end if;
  if p_kind = 'text'
     and (p_body is null or pg_catalog.char_length(p_body) not between 1 and 4096
          or p_template_name is not null or p_params is not null) then
    raise exception 'a text answer has its words and nothing else' using errcode = 'check_violation';
  end if;
  if p_kind = 'template'
     and (p_template_name is null or p_body is not null or p_params is null
          or pg_catalog.jsonb_typeof(p_params) <> 'array') then
    raise exception 'a template answer has its name and values' using errcode = 'check_violation';
  end if;
  select * into v_thread from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_thread.id is null then
    return;
  end if;
  if p_kind = 'template' then
    select * into v_template from public.whatsapp_templates wt
     where wt.entity_id = v_thread.entity_id and wt.name = p_template_name and wt.language = 'en'
       and wt.purpose in ('acceptance_code', 'quote_expired');
    if v_template.id is null then
      raise exception 'the template is not one the platform answers with' using errcode = 'check_violation';
    end if;
    -- The code is never stored: its message keeps no value.
    if (v_template.purpose = 'acceptance_code' and pg_catalog.jsonb_array_length(p_params) <> 0)
       or (v_template.purpose = 'quote_expired'
           and pg_catalog.jsonb_array_length(p_params)
               <> pg_catalog.jsonb_array_length(v_template.params)) then
      raise exception 'the answer takes the values of its purpose' using errcode = 'check_violation';
    end if;
  end if;
  if v_thread.wa_id is null then
    return query select 'no_number'::text, null::uuid;
    return;
  end if;
  if app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at) then
    return query select 'opted_out'::text, null::uuid;
    return;
  end if;
  insert into public.whatsapp_messages (id, entity_id, thread_id, direction, kind, template_name,
                                        template_params, body_masked, status, sent_by, created_at)
  values (p_message, v_thread.entity_id, v_thread.id, 'outbound', p_kind,
          case when p_kind = 'template' then p_template_name end,
          case when p_kind = 'template' then p_params end,
          case when p_kind = 'text' then p_body end,
          'queued', v_actor, pg_catalog.now());
  return query select 'queued'::text, p_message;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_queue_answer(uuid, uuid, text, text, jsonb, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_queue_answer(uuid, uuid, text, text, jsonb, text) to app_user;
--> statement-breakpoint

-- 3. What the messaging worker adds to a queued message as it sends it (messaging.process): the
--    milestone and subject it was queued for (a quote's Accept and Talk to us buttons are made
--    from them), its template's purpose (the one-time code is made for `acceptance_code`), and the
--    file it carries (a quote's PDF as the template's document), with the file's state.
create or replace function app.whatsapp_send_extras(p_message uuid)
  returns table (
    milestone text,
    subject_kind text,
    subject_id uuid,
    template_purpose text,
    file_bucket text,
    file_key text,
    file_name text,
    file_status text
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  return query
    select s.milestone, s.subject_kind, s.subject_id, wt.purpose, f.bucket, f.key, f.name, f.status
      from public.whatsapp_messages m
      left join public.whatsapp_milestone_sends s
        on s.message_id = m.id and s.entity_id = m.entity_id
      left join public.whatsapp_templates wt
        on wt.entity_id = m.entity_id and wt.name = m.template_name and wt.language = 'en'
      left join public.files f on f.id = m.file_id and f.entity_id = m.entity_id
     where m.id = p_message and m.direction = 'outbound'
       and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_send_extras(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_send_extras(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. The lead of a quote, for its notices (notifications.send): the quote's customer, its lead and
--    the lead's owner, and whether the quote is still open (sent, within its validity).
create or replace function app.notice_quote_lead(p_entity smallint, p_quote uuid)
  returns table (account_id uuid, opportunity_id uuid, owner_id uuid, quote_open boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select q.account_id, q.opportunity_id, o.owner_id,
           q.state = 'sent' and q.valid_until >= pg_catalog.now()
      from public.quotes q
      join public.opportunities o on o.id = q.opportunity_id and o.entity_id = q.entity_id
     where q.id = p_quote and q.entity_id = p_entity;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_quote_lead(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_quote_lead(smallint, uuid) to app_user;
