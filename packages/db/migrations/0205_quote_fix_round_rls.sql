-- S3 fix round (docs/03-roadmap-appendix/phase2.md §7.1, the review of 18-11-2026). Each definer
-- keeps search_path = '' and checks its grant in its body.

-- 1. An Executive records what a template's header takes when they register it (0193).
grant update (header) on whatsapp_templates to app_user;
--> statement-breakpoint

-- 2. The platform's answer on a chat (messaging.answer.queue, messaging.process), as 0192 made it,
--    except that it leaves the chat's `needs_reply` alone: the platform answers only the message
--    it answers (STATUS, an acceptance, a code), and a question the customer wrote before it still
--    waits for a person, whose reply clears it as before.
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

-- 3. The quote the platform's acceptance starts from (sales.quote.accept.remote), as 0190 made it,
--    with the quote a withdrawn one was withdrawn for when that quote is accepted, and its order:
--    a press on a quote withdrawn because the customer accepted another quote of the lead answers
--    that acceptance. The columns change, so the function is made again.
drop function app.remote_quote_facts(smallint, uuid, uuid);
--> statement-breakpoint
create function app.remote_quote_facts(p_entity smallint, p_quote uuid, p_thread uuid)
  returns table (
    quote_id uuid,
    opportunity_id uuid,
    account_id uuid,
    quote_no text,
    state text,
    valid_until timestamptz,
    pdf_file_id uuid,
    grand_total numeric,
    tier_id uuid,
    price_list_id uuid,
    account_type text,
    entity_code text,
    thread_matches boolean,
    order_id uuid,
    so_no text,
    other_quotes jsonb,
    owner_id uuid,
    accepted_quote_id uuid,
    accepted_quote_no text,
    accepted_order_id uuid,
    accepted_so_no text
  )
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_opportunity uuid;
begin
  if app.user_id() is null or not app.has_perm('sales.quote.accept.remote:entity') then
    raise exception 'sales.quote.accept.remote is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  select q.opportunity_id into v_opportunity
    from public.quotes q where q.id = p_quote and q.entity_id = p_entity;
  if v_opportunity is null then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lead-sale:' || v_opportunity::text, 0));
  perform 1 from public.quotes q where q.id = p_quote for update;
  return query
    select q.id, q.opportunity_id, q.account_id, q.quote_no, q.state, q.valid_until, q.pdf_file_id,
           q.grand_total, q.tier_id, q.price_list_id, a.type, e.code,
           exists (select 1 from public.whatsapp_threads t
                    where t.id = p_thread and t.entity_id = q.entity_id
                      and t.account_id = q.account_id and t.wa_id is not null),
           so.id, so.so_no,
           coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'state', o.state)
                                                 order by o.id)
                       from public.quotes o
                      where o.opportunity_id = q.opportunity_id and o.id <> q.id
                        and o.state in ('draft', 'sent')), '[]'::jsonb),
           op.owner_id,
           acc.id, acc.quote_no, acc_so.id, acc_so.so_no
      from public.quotes q
      join public.accounts a on a.id = q.account_id
      join public.entities e on e.id = q.entity_id
      join public.opportunities op on op.id = q.opportunity_id
      left join public.sales_orders so on so.quote_id = q.id
      left join public.quotes acc
        on q.state = 'withdrawn' and acc.id = q.withdrawn_for_id and acc.entity_id = q.entity_id
       and acc.opportunity_id = q.opportunity_id and acc.state = 'accepted'
      left join public.sales_orders acc_so on acc_so.quote_id = acc.id
     where q.id = p_quote;
end
$$;
--> statement-breakpoint
revoke execute on function app.remote_quote_facts(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.remote_quote_facts(smallint, uuid, uuid) to app_user;
