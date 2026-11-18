-- A3 WhatsApp Concierge, the fix round (the review of A3, 18-11-2026, M2): a chat the assistant
-- answers goes to people at once when the Concierge cannot run (switched off, without a spending
-- limit, out of the day's spend or past the chat's runs for the day), with the reason
-- `no_assistant`. The platform's hand-off (messaging.thread.record_hand_off) as 0215 defined it,
-- with `no_assistant` among its reasons; every other line is kept.
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
     or p_reason not in ('keyword', 'request', 'filter_refusals', 'complaint', 'question',
                         'no_assistant') then
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
