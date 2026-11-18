-- The Co-pilot's view of a lead's WhatsApp chat (design §7.3: "its thread's last messages"). A
--    chat is read under the customer's read rule (crm.account.read), which no agent holds, so the
--    Co-pilot reads the customer's newest chat with the company through these two definers only:
--    the chat's state (opted out, the WhatsApp consents in force on its number) and its last
--    messages as stored (masked bodies, a template's name, never a file). Only `agent:copilot`
--    holding crm.lead.read over the company, for a lead of a company of the request.
create or replace function app.copilot_require_lead(p_entity smallint, p_opportunity uuid)
  returns uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_account uuid;
begin
  if app.user_id() is null
     or coalesce(pg_catalog.current_setting('app.role', true), '') <> 'agent:copilot'
     or not app.has_perm('crm.lead.read:entity') then
    raise exception 'the Caller Co-pilot holding crm.lead.read is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  select o.account_id into v_account from public.opportunities o
   where o.id = p_opportunity and o.entity_id = p_entity and o.archived_at is null;
  return v_account;
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_require_lead(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint

create or replace function app.copilot_lead_chat(p_entity smallint, p_opportunity uuid)
  returns table (thread_id uuid, opted_out boolean, consent_service boolean,
                 consent_promotional boolean)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_account uuid := app.copilot_require_lead(p_entity, p_opportunity);
begin
  if v_account is null then
    return;
  end if;
  return query
    select t.id, t.opted_out_at is not null,
           exists (select 1 from public.consents c
                     join public.contact_phones cp on cp.contact_id = c.contact_id
                    where cp.id = t.contact_phone_id and c.channel = 'whatsapp'
                      and c.purpose = 'service' and c.withdrawn_at is null
                      and c.given_at <= pg_catalog.now()),
           exists (select 1 from public.consents c
                     join public.contact_phones cp on cp.contact_id = c.contact_id
                    where cp.id = t.contact_phone_id and c.channel = 'whatsapp'
                      and c.purpose = 'promotional' and c.withdrawn_at is null
                      and c.given_at <= pg_catalog.now())
      from public.whatsapp_threads t
     where t.entity_id = p_entity and t.account_id = v_account and t.wa_id is not null
     order by t.last_inbound_at desc nulls last, t.id desc
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_lead_chat(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.copilot_lead_chat(smallint, uuid) to app_user;
--> statement-breakpoint

create or replace function app.copilot_chat_messages(
  p_entity smallint,
  p_opportunity uuid,
  p_thread uuid,
  p_limit integer
) returns table (direction text, kind text, body_masked text, template_name text,
                 created_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_account uuid := app.copilot_require_lead(p_entity, p_opportunity);
begin
  if v_account is null then
    return;
  end if;
  return query
    select m.direction, m.kind, m.body_masked, m.template_name, m.created_at
      from public.whatsapp_messages m
      join public.whatsapp_threads t on t.id = m.thread_id and t.entity_id = m.entity_id
     where m.thread_id = p_thread and m.entity_id = p_entity and t.account_id = v_account
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_limit, 0), 0), 50);
end
$$;
--> statement-breakpoint
revoke execute on function app.copilot_chat_messages(smallint, uuid, uuid, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.copilot_chat_messages(smallint, uuid, uuid, integer) to app_user;
