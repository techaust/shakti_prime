-- S3's follow-up: a quote's `quote_sent` message the messaging worker refuses after the quote was
-- marked sent (the window, the template, the number's STOP, the messaging limit
-- `tier_budget_reached`, the filter) is told to the person who sent the quote. The milestone's
-- record keeps who asked for it (`requested_by`, the quote's sender from `sales.quote.sent`), and
-- the send's extras return it to the worker. Both functions are their latest definitions (0201,
-- 0203) with only those lines added; the new argument defaults to null.

-- 1. The milestone queued once (0201), recording who asked for it.
drop function if exists app.whatsapp_queue_milestone(smallint, text, text, uuid, uuid, jsonb);
--> statement-breakpoint
create or replace function app.whatsapp_queue_milestone(
  p_entity smallint,
  p_milestone text,
  p_subject_kind text,
  p_subject_id uuid,
  p_thread uuid,
  p_params jsonb,
  p_requested_by uuid default null
) returns table (outcome text, message_id uuid, thread_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_template_id uuid;
  v_active boolean;
  v_template public.whatsapp_templates;
  v_account uuid;
  v_state text;
  v_file uuid;
  v_thread public.whatsapp_threads;
  v_send uuid := app.uuid_v7();
  v_message uuid := app.uuid_v7();
  v_recorded uuid;
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  select m.template_id, m.is_active into v_template_id, v_active
    from public.whatsapp_milestones m
   where m.entity_id = p_entity and m.milestone = p_milestone;
  if v_template_id is null or not v_active then
    return query select 'not_mapped'::text, null::uuid, null::uuid;
    return;
  end if;
  select * into v_template from public.whatsapp_templates wt
   where wt.id = v_template_id and wt.entity_id = p_entity;
  if p_subject_kind = 'quote' then
    select q.account_id, q.state, q.pdf_file_id into v_account, v_state, v_file
      from public.quotes q where q.id = p_subject_id and q.entity_id = p_entity;
  elsif p_subject_kind = 'sales_order' then
    select so.account_id, case when so.confirmed_at is null then 'draft' else 'confirmed' end
      into v_account, v_state
      from public.sales_orders so where so.id = p_subject_id and so.entity_id = p_entity;
  else
    raise exception 'a milestone is of a quote or an order' using errcode = 'check_violation';
  end if;
  if v_account is null then
    raise exception 'the subject is not of the company' using errcode = '42501';
  end if;
  if (p_milestone = 'quote_sent' and (p_subject_kind <> 'quote' or v_state <> 'sent'))
     or (p_milestone = 'order_confirmed'
         and (p_subject_kind <> 'sales_order' or v_state <> 'confirmed'))
     or p_milestone not in ('quote_sent', 'order_confirmed') then
    return query select 'not_due'::text, null::uuid, null::uuid;
    return;
  end if;
  if exists (select 1 from public.whatsapp_milestone_sends s
              where s.milestone = p_milestone and s.subject_kind = p_subject_kind
                and s.subject_id = p_subject_id) then
    return query select 'already'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_template.status <> 'approved' then
    insert into public.whatsapp_milestone_sends (id, entity_id, milestone, subject_kind, subject_id,
                                                 outcome, requested_by, created_by)
    values (v_send, p_entity, p_milestone, p_subject_kind, p_subject_id, 'held', p_requested_by,
            v_actor)
    on conflict on constraint whatsapp_milestone_sends_subject_unique do nothing
    returning id into v_recorded;
    return query select case when v_recorded is null then 'already' else 'held' end,
                        null::uuid, null::uuid;
    return;
  end if;
  if p_params is null or pg_catalog.jsonb_typeof(p_params) <> 'array'
     or pg_catalog.jsonb_array_length(p_params) <> pg_catalog.jsonb_array_length(v_template.params) then
    raise exception 'the milestone takes as many values as its template' using errcode = 'check_violation';
  end if;
  select * into v_thread from public.whatsapp_threads t
   where t.entity_id = p_entity and t.account_id = v_account and t.wa_id is not null
   order by (t.id = p_thread) desc, t.last_inbound_at desc nulls last, t.id desc
   limit 1
     for update;
  if v_thread.id is null then
    return query select 'no_chat'::text, null::uuid, null::uuid;
    return;
  end if;
  if app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at) then
    return query select 'opted_out'::text, null::uuid, v_thread.id;
    return;
  end if;
  if not exists (select 1 from public.contact_phones cp
                   join public.account_contacts ac on ac.contact_id = cp.contact_id
                   join public.consents g on g.contact_id = cp.contact_id
                  where cp.e164 = '+' || v_thread.wa_id and ac.account_id = v_account
                    and g.channel = 'whatsapp' and g.withdrawn_at is null) then
    return query select 'no_consent'::text, null::uuid, v_thread.id;
    return;
  end if;
  insert into public.whatsapp_milestone_sends (id, entity_id, milestone, subject_kind, subject_id,
                                               thread_id, message_id, outcome, requested_by,
                                               created_by)
  values (v_send, p_entity, p_milestone, p_subject_kind, p_subject_id, v_thread.id, v_message,
          'queued', p_requested_by, v_actor)
  on conflict on constraint whatsapp_milestone_sends_subject_unique do nothing
  returning id into v_recorded;
  if v_recorded is null then
    return query select 'already'::text, null::uuid, null::uuid;
    return;
  end if;
  insert into public.whatsapp_messages (id, entity_id, thread_id, direction, kind, template_name,
                                        template_params, file_id, status, sent_by, created_at)
  values (v_message, p_entity, v_thread.id, 'outbound', 'template', v_template.name, p_params,
          case when p_subject_kind = 'quote' then v_file end, 'queued', v_actor, pg_catalog.now());
  return query select 'queued'::text, v_message, v_thread.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_queue_milestone(smallint, text, text, uuid, uuid, jsonb, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_queue_milestone(smallint, text, text, uuid, uuid, jsonb, uuid) to app_user;
--> statement-breakpoint

-- 2. A queued message's extras for the send worker (0203), with who asked for its milestone.
drop function if exists app.whatsapp_send_extras(uuid);
--> statement-breakpoint
create or replace function app.whatsapp_send_extras(p_message uuid)
  returns table (
    milestone text,
    subject_kind text,
    subject_id uuid,
    template_purpose text,
    file_bucket text,
    file_key text,
    file_name text,
    file_status text,
    requested_by uuid
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  return query
    select s.milestone, s.subject_kind, s.subject_id, wt.purpose, f.bucket, f.key, f.name, f.status,
           s.requested_by
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
