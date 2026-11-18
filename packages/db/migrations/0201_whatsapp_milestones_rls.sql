-- S3 WhatsApp quotes, milestones and STATUS (docs/03-roadmap-appendix/phase2.md §7.1, PRD SAL-05,
-- WA-01 and WA-03): the milestone registry and its once-per-subject record, the platform-only
-- sales.quote.accept.remote and the definers through which the platform accepts a quote from a
-- verified WhatsApp reply, answers STATUS and sends a milestone. The order of an accepted quote is
-- made by one function, app.order_from_quote(), which a person's acceptance runs under its own row
-- security and the platform's runs inside its definer.

-- 1. sales.quote.accept.remote is platform-only, like the other workers' grants: the sixteen keys
--    of 0183 (with W1's messaging.process) and V2's voice.session.record (0190), kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote']::text[]
$$;
--> statement-breakpoint

-- 2. The next number of a series, as 0012 drew it, now also for the order of a quote the platform
--    accepts from WhatsApp (sales.quote.accept.remote numbers a sales order, nothing else).
create or replace function app.next_document_no(
  p_entity smallint, p_doc_type text, p_fy text, p_prefix text
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_no int;
  v_perm text;
begin
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity
      using errcode = 'insufficient_privilege';
  end if;
  v_perm := case p_doc_type
    when 'quote' then 'sales.quote.create:own'
    when 'sales_order' then 'sales.order.create:own'
    when 'proforma' then 'finance.proforma.write:own'
    when 'challan' then 'inventory.dispatch.write:own'
    when 'purchase_order' then 'procurement.po.write:own'
    else null end;
  if v_perm is null
     or not (app.has_perm(v_perm)
             or (p_doc_type = 'sales_order' and app.has_perm('sales.quote.accept.remote:entity'))) then
    raise exception 'permission % required to number a %', v_perm, p_doc_type
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.document_sequences (id, entity_id, doc_type, fy, prefix)
  values (pg_catalog.gen_random_uuid(), p_entity, p_doc_type, p_fy, p_prefix)
  on conflict (entity_id, doc_type, fy) do nothing;
  update public.document_sequences
     set next_no = next_no + 1
   where entity_id = p_entity and doc_type = p_doc_type and fy = p_fy
  returning next_no - 1 into v_no;
  return v_no;
end
$$;
--> statement-breakpoint
revoke all on function app.next_document_no(smallint, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.next_document_no(smallint, text, text, text) to app_user;
--> statement-breakpoint

-- 3. whatsapp_milestones: read by every principal acting in the company (the platform finds a
--    milestone's template here); set by an Executive (messaging.templates.write:all), who maps a
--    milestone to a template and switches it on or off, never removes it.
create trigger set_updated_at before update on whatsapp_milestones
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table whatsapp_milestones enable row level security;
--> statement-breakpoint
alter table whatsapp_milestones force row level security;
--> statement-breakpoint
create policy whatsapp_milestones_read on whatsapp_milestones for select to app_user, app_reader
  using ((select app.user_id()) is not null
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy whatsapp_milestones_insert on whatsapp_milestones for insert to app_user
  with check ((select app.has_perm('messaging.templates.write:all'))
              and created_by = (select app.user_id())
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy whatsapp_milestones_update on whatsapp_milestones for update to app_user
  using ((select app.has_perm('messaging.templates.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('messaging.templates.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on whatsapp_milestones from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on whatsapp_milestones to app_user;
--> statement-breakpoint
grant update (template_id, is_active, updated_at, updated_by) on whatsapp_milestones to app_user;
--> statement-breakpoint
grant select on whatsapp_milestones to app_reader;
--> statement-breakpoint

-- 4. whatsapp_milestone_sends: written and read only by the definers below; no request role has
--    any privilege, and there is no policy, so row security refuses every request even if one were
--    granted.
alter table whatsapp_milestone_sends enable row level security;
--> statement-breakpoint
alter table whatsapp_milestone_sends force row level security;
--> statement-breakpoint
revoke all on whatsapp_milestone_sends from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 5. The draft order of an accepted quote (docs/03-roadmap-appendix/phase1.md §8.3): the quote's
--    customer, site, tier, list, place of supply and totals, and its lines with their prices and
--    tax snapshot, copied as they stand, under the number the caller drew; the customer's type as
--    it is now (DOM-1). Runs as its caller: a person's acceptance under the order policies of 0151
--    (sales.order.create over the lead), the platform's inside app.accept_quote_remote(). Answers
--    how many lines it copied; refuses a quote the caller cannot read or that is not accepted.
create or replace function app.order_from_quote(
  p_quote uuid, p_order uuid, p_so_no text, p_fy text
) returns integer
  language plpgsql volatile set search_path = '' as $$
declare
  v_entity smallint;
  v_lines integer;
begin
  insert into public.sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                                   account_type, site_id, tier_id, price_list_id,
                                   place_of_supply_state, supply_kind, state, subtotal, cgst, sgst,
                                   igst, tax_total, round_off, grand_total, created_by)
  select p_order, q.entity_id, p_so_no, p_fy, q.id, q.opportunity_id, q.account_id, a.type,
         q.site_id, q.tier_id, q.price_list_id, q.place_of_supply_state, q.supply_kind, 'draft',
         q.subtotal, q.cgst, q.sgst, q.igst, q.tax_total, q.round_off, q.grand_total, app.user_id()
    from public.quotes q
    join public.accounts a on a.id = q.account_id
   where q.id = p_quote and q.state = 'accepted'
  returning entity_id into v_entity;
  if v_entity is null then
    raise exception 'quote % is not an accepted quote the caller reads', p_quote
      using errcode = 'insufficient_privilege';
  end if;
  insert into public.sales_order_lines (id, entity_id, sales_order_id, position, item_id, kit_id,
                                        sku, description, unit, qty, unit_price, hsn,
                                        works_contract, tax_rate_id, tax_rate_pct,
                                        composite_rule_id, goods_rate_pct, services_rate_pct,
                                        taxable_value, goods_taxable, services_taxable, cgst, sgst,
                                        igst, line_total)
  select app.uuid_v7(), v_entity, p_order, l.position, l.item_id, l.kit_id, l.sku, l.description,
         l.unit, l.qty, l.unit_price, l.hsn, l.works_contract, l.tax_rate_id, l.tax_rate_pct,
         l.composite_rule_id, l.goods_rate_pct, l.services_rate_pct, l.taxable_value,
         l.goods_taxable, l.services_taxable, l.cgst, l.sgst, l.igst, l.line_total
    from public.quote_lines l
   where l.quote_id = p_quote
   order by l.position;
  get diagnostics v_lines = row_count;
  return v_lines;
end
$$;
--> statement-breakpoint
revoke execute on function app.order_from_quote(uuid, uuid, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_from_quote(uuid, uuid, text, text) to app_user;
--> statement-breakpoint

-- 6. What the platform checks before it accepts a quote from WhatsApp (sales.quote.accept.remote):
--    the acceptances of the quote's lead queue on the lead's lock, as a person's do (the lead-sale
--    lock of sales.quote.accept), and the quote's row is locked for the rest of the transaction;
--    then the quote as the quote machine reads it, whether the chat is the quote's customer's in
--    its company with a number, the order already made of it, the lead's other draft and sent
--    quotes, and the lead's owner. No row when the quote is not of the company.
create or replace function app.remote_quote_facts(p_entity smallint, p_quote uuid, p_thread uuid)
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
    owner_id uuid
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
           op.owner_id
      from public.quotes q
      join public.accounts a on a.id = q.account_id
      join public.entities e on e.id = q.entity_id
      join public.opportunities op on op.id = q.opportunity_id
      left join public.sales_orders so on so.quote_id = q.id
     where q.id = p_quote;
end
$$;
--> statement-breakpoint
revoke execute on function app.remote_quote_facts(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.remote_quote_facts(smallint, uuid, uuid) to app_user;
--> statement-breakpoint

-- 7. The platform accepts a quote from a verified WhatsApp reply or code
--    (sales.quote.accept.remote), after app.remote_quote_facts() and the quote machine: only a
--    sent quote whose validity has not passed, whose customer is the chat's, of a lead with no
--    other accepted quote. The quote is accepted with how (whatsapp_reply or whatsapp_otp), the
--    lead's other draft and sent quotes are withdrawn naming it (DOM-4), and its draft order is
--    made by app.order_from_quote() under the number the caller drew. Answers how many lines the
--    order has and the quotes it withdrew with the state each had.
create or replace function app.accept_quote_remote(
  p_entity smallint,
  p_quote uuid,
  p_thread uuid,
  p_via text,
  p_order uuid,
  p_so_no text,
  p_fy text
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_quote public.quotes;
  v_withdrawn jsonb;
  v_lines integer;
begin
  if v_actor is null or not app.has_perm('sales.quote.accept.remote:entity') then
    raise exception 'sales.quote.accept.remote is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_via is null or p_via not in ('whatsapp_reply', 'whatsapp_otp') then
    raise exception 'a WhatsApp acceptance is by reply or by code' using errcode = 'check_violation';
  end if;
  select * into v_quote from public.quotes q
   where q.id = p_quote and q.entity_id = p_entity for update;
  if v_quote.id is null then
    raise exception 'quote % is not of the company', p_quote using errcode = '42501';
  end if;
  if v_quote.state <> 'sent' or v_quote.valid_until < pg_catalog.now() then
    raise exception 'only a sent quote within its validity is accepted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.whatsapp_threads t
                  where t.id = p_thread and t.entity_id = v_quote.entity_id
                    and t.account_id = v_quote.account_id and t.wa_id is not null) then
    raise exception 'the chat is not the quote''s customer''s' using errcode = '42501';
  end if;
  if exists (select 1 from public.quotes o
              where o.opportunity_id = v_quote.opportunity_id and o.id <> v_quote.id
                and o.state = 'accepted') then
    raise exception 'another quote of the lead is accepted' using errcode = 'unique_violation';
  end if;
  update public.quotes q
     set state = 'accepted', state_changed_at = pg_catalog.now(), accepted_via = p_via,
         updated_by = v_actor
   where q.id = v_quote.id;
  with others as (
    select o.id, o.state from public.quotes o
     where o.opportunity_id = v_quote.opportunity_id and o.id <> v_quote.id
       and o.state in ('draft', 'sent')
     order by o.id
       for update
  ), done as (
    update public.quotes q
       set state = 'withdrawn', state_changed_at = pg_catalog.now(), withdrawn_for_id = v_quote.id,
           updated_by = v_actor
      from others
     where q.id = others.id
    returning q.id, others.state
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', d.id, 'state', d.state)
                                       order by d.id), '[]'::jsonb)
    into v_withdrawn
    from done d;
  v_lines := app.order_from_quote(v_quote.id, p_order, p_so_no, p_fy);
  return pg_catalog.jsonb_build_object('lineCount', v_lines, 'withdrawn', v_withdrawn);
end
$$;
--> statement-breakpoint
revoke execute on function app.accept_quote_remote(smallint, uuid, uuid, text, uuid, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.accept_quote_remote(smallint, uuid, uuid, text, uuid, text, text) to app_user;
--> statement-breakpoint

-- 8. STATUS (WA-03): the chat's customer's own quotes (sent, accepted or expired) and orders in
--    the chat's company, newest first, five of each, for the platform's deterministic answer
--    (messaging.process). Nothing of any other customer or company: a chat matched to no customer
--    answers no rows. Projects join in Phase 4.
create or replace function app.status_summary(p_thread uuid)
  returns table (kind text, ref text, state text, grand_total numeric, valid_until timestamptz,
                 created_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_account uuid;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select t.entity_id, t.account_id into v_entity, v_account
    from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_account is null then
    return;
  end if;
  return query
    (select 'quote'::text, q.quote_no, q.state, q.grand_total, q.valid_until, q.created_at
       from public.quotes q
      where q.account_id = v_account and q.entity_id = v_entity
        and q.state in ('sent', 'accepted', 'expired')
      order by q.created_at desc, q.id desc
      limit 5)
    union all
    (select 'order'::text, so.so_no, so.state, so.grand_total, null::timestamptz, so.created_at
       from public.sales_orders so
      where so.account_id = v_account and so.entity_id = v_entity
      order by so.created_at desc, so.id desc
      limit 5);
end
$$;
--> statement-breakpoint
revoke execute on function app.status_summary(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.status_summary(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 9. What a milestone of a subject would carry (messaging.milestone.send, messaging.process): the
--    subject's customer, its number, total and the date a quote is valid until, its state, the
--    chat it goes to (the one named when it is the customer's in the company with a number, else
--    the customer's chat there with the latest message from the customer), and whether it was
--    already sent or held. No row when the subject is not of the company.
create or replace function app.whatsapp_milestone_subject(
  p_entity smallint, p_milestone text, p_subject_kind text, p_subject_id uuid, p_thread uuid
) returns table (
    account_id uuid,
    ref text,
    grand_total numeric,
    valid_until timestamptz,
    subject_state text,
    thread_id uuid,
    already_sent boolean
  )
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_account uuid;
  v_ref text;
  v_total numeric;
  v_valid timestamptz;
  v_state text;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if p_subject_kind = 'quote' then
    select q.account_id, q.quote_no, q.grand_total, q.valid_until, q.state
      into v_account, v_ref, v_total, v_valid, v_state
      from public.quotes q where q.id = p_subject_id and q.entity_id = p_entity;
  elsif p_subject_kind = 'sales_order' then
    select so.account_id, so.so_no, so.grand_total, null::timestamptz, so.state
      into v_account, v_ref, v_total, v_valid, v_state
      from public.sales_orders so where so.id = p_subject_id and so.entity_id = p_entity;
  else
    raise exception 'a milestone is of a quote or an order' using errcode = 'check_violation';
  end if;
  if v_account is null then
    return;
  end if;
  return query
    select v_account, v_ref, v_total, v_valid, v_state,
           (select t.id from public.whatsapp_threads t
             where t.entity_id = p_entity and t.account_id = v_account and t.wa_id is not null
             order by (t.id = p_thread) desc, t.last_inbound_at desc nulls last, t.id desc
             limit 1),
           exists (select 1 from public.whatsapp_milestone_sends s
                    where s.milestone = p_milestone and s.subject_kind = p_subject_kind
                      and s.subject_id = p_subject_id);
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_milestone_subject(smallint, text, text, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_milestone_subject(smallint, text, text, uuid, uuid) to app_user, app_reader;
--> statement-breakpoint

-- 10. The platform sends a milestone of a subject once (messaging.milestone.send,
--     messaging.process), with the values the caller made from app.whatsapp_milestone_subject():
--     nothing when the company maps no active template to the milestone (`not_mapped`), the
--     subject is not at the milestone (`not_due`: a quote not sent, an order not confirmed) or it
--     was already sent or held (`already`); held, recorded once, when its template is not
--     approved (WA-01); otherwise its template queued once on the chat, a quote's with its PDF,
--     unless the customer has no chat with a number in the company (`no_chat`), the number opted
--     out (`opted_out`) or no holder of the number among the customer's contacts gave WhatsApp
--     consent (`no_consent`). The values must be as many as the template takes.
create or replace function app.whatsapp_queue_milestone(
  p_entity smallint,
  p_milestone text,
  p_subject_kind text,
  p_subject_id uuid,
  p_thread uuid,
  p_params jsonb
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
                                                 outcome, created_by)
    values (v_send, p_entity, p_milestone, p_subject_kind, p_subject_id, 'held', v_actor)
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
                                               thread_id, message_id, outcome, created_by)
  values (v_send, p_entity, p_milestone, p_subject_kind, p_subject_id, v_thread.id, v_message,
          'queued', v_actor)
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
revoke execute on function app.whatsapp_queue_milestone(smallint, text, text, uuid, uuid, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_queue_milestone(smallint, text, text, uuid, uuid, jsonb) to app_user;
