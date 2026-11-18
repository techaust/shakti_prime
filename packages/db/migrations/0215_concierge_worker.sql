-- A3 WhatsApp Concierge, its worker (docs/03-roadmap-appendix/phase2.md §7.2): new chats start
-- with the assistant, which drafts replies a person sends, so a chat with the assistant waits for
-- a person as one with people does. Two definers change, each the newest definition on main with
-- one change.

-- 1. The platform hands a thread to people (messaging.thread.record_hand_off), as 0183 defined it,
--    and also for a question only a person answers (`question`: a price, a subsidy, anything outside
--    the Concierge's rules, or the model unsure), which the Concierge's worker passes on.
create or replace function app.whatsapp_hand_off(p_thread uuid, p_reason text)
  returns table (handled_by text, handoff_reason text, changed boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_thread public.whatsapp_threads;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_reason is null
     or p_reason not in ('keyword', 'request', 'filter_refusals', 'complaint', 'question') then
    raise exception 'unknown hand-off reason' using errcode = 'check_violation';
  end if;
  select * into v_thread from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_thread.id is null then
    return;
  end if;
  if v_thread.handled_by = 'people' then
    return query select v_thread.handled_by, v_thread.handoff_reason, false;
    return;
  end if;
  update public.whatsapp_threads t
     set handled_by = 'people', handoff_reason = p_reason, handed_off_at = pg_catalog.now(),
         updated_by = app.user_id()
   where t.id = p_thread;
  return query select 'people'::text, p_reason, true;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_hand_off(uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_hand_off(uuid, text) to app_user;
--> statement-breakpoint

-- 2. The notice of a chat waiting for a reply (whatsapp_reply_waiting), as 0185 defined it, for a
--    chat whoever answers it: the assistant only drafts, and nothing it drafts is sent until a
--    person approves it, so its chats wait for a person too.
create or replace function app.notice_whatsapp_waiting(p_entity smallint, p_waited_before timestamptz, p_limit integer)
  returns table (thread_id uuid, user_id uuid, account_id uuid, opportunity_id uuid, dedupe_key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select t.id, t.assignee_id, t.account_id, t.opportunity_id,
           'whatsapp_reply_waiting:' || t.id::text || ':'
             || pg_catalog.floor(extract(epoch from t.last_inbound_at))::bigint::text
      from public.whatsapp_threads t
     where t.entity_id = p_entity
       and t.needs_reply
       and t.assignee_id is not null
       and t.last_inbound_at <= p_waited_before
       and t.last_inbound_at > p_waited_before - interval '1 day'
       and app.notice_recipient_ok(t.assignee_id, p_entity)
       and not exists (select 1 from public.notifications n
                        where n.user_id = t.assignee_id
                          and n.dedupe_key = 'whatsapp_reply_waiting:' || t.id::text || ':'
                            || pg_catalog.floor(extract(epoch from t.last_inbound_at))::bigint::text)
     order by t.last_inbound_at, t.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_whatsapp_waiting(smallint, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_whatsapp_waiting(smallint, timestamptz, integer) to app_user;
