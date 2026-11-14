-- W1 WhatsApp threads and messaging (docs/03-roadmap-appendix/phase2.md §6.1, BLUEPRINT §7.8 and
-- §10, PRD WA-04 and CRM-10): row security, grants, the guards, the monthly partitions of the
-- messages, and the definers through which the platform (`system:workers`, the platform-only
-- `messaging.process`) records what Meta tells it and sends what it may.

-- 1. messaging.process is platform-only, like the other workers' grants: 0167's thirteen keys,
--    kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'messaging.process']::text[]
$$;
--> statement-breakpoint

-- 2. The monthly partitions of whatsapp_messages live in a schema no request role can use, so a
--    partition can never be read or written around the policies on the parent (as activities).
create schema if not exists messaging_partitions;
--> statement-breakpoint
revoke all on schema messaging_partitions from public;
--> statement-breakpoint
create table messaging_partitions.whatsapp_messages_default partition of public.whatsapp_messages default;
--> statement-breakpoint

-- Makes the partitions of the current UTC month and the next p_months_ahead months; a month that
-- fails is recorded and the later ones are still made. Each run is one row of retention_runs (job
-- whatsapp-messages-partitions). Run by the migrator and by pg_cron, never by a request role.
create or replace function app.ensure_whatsapp_message_partitions(p_months_ahead int default 3)
  returns int
  language plpgsql set search_path = '' as $$
declare
  first_month timestamp := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC');
  lo timestamptz;
  hi timestamptz;
  part text;
  created int := 0;
  failed text[] := '{}';
  run uuid := app.uuid_v7();
begin
  if p_months_ahead is null or p_months_ahead < 0 or p_months_ahead > 24 then
    raise exception 'months ahead must be between 0 and 24' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.retention_runs (id, job, started_at)
  values (run, 'whatsapp-messages-partitions', pg_catalog.clock_timestamp());
  for i in 0..p_months_ahead loop
    lo := (first_month + pg_catalog.make_interval(months => i)) at time zone 'UTC';
    hi := (first_month + pg_catalog.make_interval(months => i + 1)) at time zone 'UTC';
    part := 'whatsapp_messages_' || pg_catalog.to_char(lo at time zone 'UTC', 'YYYY_MM');
    begin
      if pg_catalog.to_regclass(pg_catalog.format('messaging_partitions.%I', part)) is null then
        execute pg_catalog.format(
          'create table messaging_partitions.%I partition of public.whatsapp_messages for values from (%L) to (%L)',
          part, lo, hi);
        created := created + 1;
      end if;
    exception when others then
      failed := failed || (part || ': ' || sqlerrm);
    end;
  end loop;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(),
         rows_affected = created,
         error = case when pg_catalog.cardinality(failed) = 0 then null
                      else pg_catalog.left(pg_catalog.array_to_string(failed, '; '), 500) end
   where id = run;
  if pg_catalog.cardinality(failed) > 0 then
    raise warning 'whatsapp-messages-partitions: %', pg_catalog.array_to_string(failed, '; ');
  end if;
  return created;
end
$$;
--> statement-breakpoint
revoke execute on function app.ensure_whatsapp_message_partitions(int) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
select app.ensure_whatsapp_message_partitions(3);
--> statement-breakpoint
-- Next months' partitions are made on the 25th, as the timeline's, with 0140's limits.
select cron.schedule('whatsapp-messages-partitions', '15 3 25 * *',
  'set lock_timeout = ''5s''; set statement_timeout = ''2min''; select app.ensure_whatsapp_message_partitions(3)');
--> statement-breakpoint

-- 3. Helpers the guard, the policies and the definers share.

-- Whether a status may follow another: queued, then sent, delivered and read, each only forward
-- (a later status may arrive first and an earlier one is then no move); failed from queued or
-- sent; refused from queued. The same status again is no move.
create or replace function app.whatsapp_status_moves(p_from text, p_to text) returns boolean
  language sql immutable set search_path = '' as $$
  select case p_from
           when 'queued' then p_to in ('sent', 'delivered', 'read', 'failed', 'refused')
           when 'sent' then p_to in ('delivered', 'read', 'failed')
           when 'delivered' then p_to = 'read'
           else false
         end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_status_moves(text, text) from public, readonly_reporter;
--> statement-breakpoint

-- Whether a number has opted out of WhatsApp (CRM-10: an opt-out holds on every path): its thread
-- recorded STOP and no holder of the number gave WhatsApp consent since; or a holder of the number,
-- on any customer, withdrew WhatsApp consent and gave none since (E1's rule for calls, decision 3).
-- Called by the guard and the definers below as their owner; no request role calls it.
create or replace function app.whatsapp_number_opted_out(p_e164 text, p_stopped_at timestamptz)
  returns boolean
  language sql stable set search_path = '' as $$
  select (p_stopped_at is not null
          and not exists (select 1 from public.contact_phones cp
                            join public.consents g on g.contact_id = cp.contact_id
                           where cp.e164 = p_e164 and g.channel = 'whatsapp'
                             and g.withdrawn_at is null and g.given_at > p_stopped_at))
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

-- Whether the caller may message a thread's customer (messaging.send, design phase2 §4): over the
-- customer in the thread's company (its owner and team), over the thread's lead (its owner and
-- team), and a thread matched to no customer yet for the whole company only. Runs as the caller,
-- so the customer and the lead are also read under their own policies.
create or replace function app.whatsapp_send_scope_ok(p_entity smallint, p_account uuid, p_opportunity uuid)
  returns boolean
  language sql stable set search_path = '' as $$
  select app.has_perm('messaging.send:entity')
      or (p_account is not null
          and exists (select 1 from public.account_entities ae
                       where ae.account_id = p_account and ae.entity_id = p_entity
                         and app.scope_ok('messaging.send', ae.owner_id, ae.team_id)))
      or (p_opportunity is not null
          and exists (select 1 from public.opportunities o
                       where o.id = p_opportunity and o.entity_id = p_entity
                         and app.scope_ok('messaging.send', o.owner_id, o.team_id)))
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_send_scope_ok(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_send_scope_ok(smallint, uuid, uuid) to app_user, app_reader;
--> statement-breakpoint

-- 4. whatsapp_threads: opened and refreshed only by the platform's definers. Read under the
--    customer's read rule (account_entities_read, as Account 360); a thread matched to no
--    customer yet by holders of messaging.send for the whole company. A person who may message
--    the customer changes only who answers it and whether it waits for a reply (column grants).
create trigger set_updated_at before update on whatsapp_threads
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table whatsapp_threads enable row level security;
--> statement-breakpoint
alter table whatsapp_threads force row level security;
--> statement-breakpoint
-- The exists also tests the row's own account_id, so the planner keeps it an index probe of
-- account_entities (account_id, entity_id) rather than a hashed subplan over every customer.
create policy whatsapp_threads_read on whatsapp_threads for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((account_id is not null
        and exists (select 1 from account_entities ae
                     where ae.account_id = whatsapp_threads.account_id
                       and ae.entity_id = whatsapp_threads.entity_id
                       and whatsapp_threads.account_id is not null))
    or (account_id is null and (select app.has_perm('messaging.send:entity')))));
--> statement-breakpoint
create policy whatsapp_threads_update on whatsapp_threads for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and app.whatsapp_send_scope_ok(entity_id, account_id, opportunity_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and app.whatsapp_send_scope_ok(entity_id, account_id, opportunity_id));
--> statement-breakpoint
revoke all on whatsapp_threads from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on whatsapp_threads to app_user, app_reader;
--> statement-breakpoint
grant update (handled_by, handoff_reason, handed_off_at, needs_reply, updated_at, updated_by) on whatsapp_threads to app_user;
--> statement-breakpoint

-- 5. whatsapp_messages: read with their thread. A person queues a session or template message on a
--    thread they may message (messaging.message.send); everything else is written by the
--    platform's definers. The guard keeps a message as it was written but for its delivery
--    columns, moves its status only forward, and refuses any outbound message but the one STOP
--    confirmation to an opted-out number, whoever writes it. A definer, since the opt-out reads
--    every holder's consents, which the person writing may not read. Append-only for every role:
--    retention drops whole partitions.
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
      if new.kind <> 'system' and app.whatsapp_number_opted_out('+' || v_wa_id, v_stopped_at) then
        raise exception 'the customer has opted out of WhatsApp' using errcode = 'check_violation';
      end if;
    end if;
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
create trigger whatsapp_messages_guard before insert or update or delete on whatsapp_messages
  for each row execute function app.whatsapp_messages_guard();
--> statement-breakpoint
alter table whatsapp_messages enable row level security;
--> statement-breakpoint
alter table whatsapp_messages force row level security;
--> statement-breakpoint
-- A message is read when its thread is read (whatsapp_threads_read): an index probe of the
-- thread's key. The exists also tests the row's own thread_id, as activities_read does, so the
-- planner does not hash every readable thread once for each monthly partition.
create policy whatsapp_messages_read on whatsapp_messages for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from whatsapp_threads t
               where t.id = whatsapp_messages.thread_id
                 and t.entity_id = whatsapp_messages.entity_id
                 and whatsapp_messages.thread_id is not null));
--> statement-breakpoint
create policy whatsapp_messages_insert on whatsapp_messages for insert to app_user with check (
  direction = 'outbound'
  and kind in ('text', 'template')
  and status = 'queued'
  and sent_by = (select app.user_id())
  and provider_message_id is null and file_id is null and button_payload is null
  and status_at is null and refusal is null and error_code is null and send_attempted_at is null
  and entity_id = any ((select app.entity_ids())::int[])
  and exists (select 1 from whatsapp_threads t
               where t.id = whatsapp_messages.thread_id
                 and t.entity_id = whatsapp_messages.entity_id
                 and app.whatsapp_send_scope_ok(t.entity_id, t.account_id, t.opportunity_id)));
--> statement-breakpoint
revoke all on whatsapp_messages from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on whatsapp_messages to app_user;
--> statement-breakpoint
grant select on whatsapp_messages to app_reader;
--> statement-breakpoint

-- 6. whatsapp_message_keys: written and read only by the definers below; no request role has any
--    privilege, and there is no policy, so row security refuses every request even if one were
--    granted.
alter table whatsapp_message_keys enable row level security;
--> statement-breakpoint
alter table whatsapp_message_keys force row level security;
--> statement-breakpoint
revoke all on whatsapp_message_keys from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint

-- 7. whatsapp_templates: read by every principal acting in the company; registered by an
--    Executive (messaging.templates.write:all), who changes what a template says and carries,
--    never its status, which only the platform records from Meta's template events.
create trigger set_updated_at before update on whatsapp_templates
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table whatsapp_templates enable row level security;
--> statement-breakpoint
alter table whatsapp_templates force row level security;
--> statement-breakpoint
create policy whatsapp_templates_read on whatsapp_templates for select to app_user, app_reader
  using ((select app.user_id()) is not null
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy whatsapp_templates_insert on whatsapp_templates for insert to app_user
  with check ((select app.has_perm('messaging.templates.write:all'))
              and status = 'pending' and status_at is null
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy whatsapp_templates_update on whatsapp_templates for update to app_user
  using ((select app.has_perm('messaging.templates.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('messaging.templates.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on whatsapp_templates from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on whatsapp_templates to app_user;
--> statement-breakpoint
grant update (category, params, buttons, purpose, updated_at, updated_by) on whatsapp_templates to app_user;
--> statement-breakpoint
grant select on whatsapp_templates to app_reader;
--> statement-breakpoint

-- 8. Whether a thread's number has opted out, for a person about to message it and the screens:
--    one boolean, as E1's app.call_opt_out() answers for calls, for a thread of a company of the
--    request, to a principal who reads customers or leads or sends messages; anyone else, or a
--    thread of no company of the request, is refused (42501), never answered "not opted out".
create or replace function app.whatsapp_thread_opted_out(p_thread uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_wa_id text;
  v_stopped_at timestamptz;
begin
  if app.user_id() is null
     or not (app.has_perm('crm.lead.read:own') or app.has_perm('crm.account.read:own')
             or app.has_perm('messaging.send:own') or app.has_perm('messaging.process:entity')) then
    raise exception 'crm.lead.read, crm.account.read or messaging.send is required'
      using errcode = '42501';
  end if;
  select t.wa_id, t.opted_out_at into v_wa_id, v_stopped_at
    from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_wa_id is null then
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

-- 9. The platform's definers. Each runs for a principal holding messaging.process (only
--    system:workers holds it), in a company of the request, and does one narrow thing.

-- 9a. An inbound message (messaging.inbound.record): the company by its WhatsApp number's
--     provider reference; the thread of that number and the customer number, opened on the first
--     message; the customer when exactly one of the company's live customers holds the number
--     (none or several leave it unmatched, and `holders` says how many); the customer's newest
--     open lead in the company and its owner; the window opened for 24 hours from the message; the
--     message stored once by Meta's id (a repeat answers `duplicate` and changes nothing). The
--     body is masked by the caller before it reaches here. No row when no active WhatsApp number
--     of a company of the request has that reference.
create or replace function app.whatsapp_record_inbound(
  p_phone_number_id text,
  p_wa_id text,
  p_provider_message_id text,
  p_kind text,
  p_body_masked text,
  p_button_payload text,
  p_sent_at timestamptz
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
  handled_by text
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
begin
  if v_actor is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('text', 'media', 'button')
     or p_wa_id is null or p_wa_id !~ '^[1-9][0-9]{6,14}$' then
    raise exception 'an inbound message needs its kind and the sender''s number'
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
    return query select v_thread.entity_id, v_thread.id, v_key.message_id, true, false,
                        v_thread.account_id, v_thread.opportunity_id, 0,
                        app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at),
                        v_thread.handled_by;
    return;
  end if;

  insert into public.whatsapp_threads (id, entity_id, channel_id, wa_id, created_by)
  values (app.uuid_v7(), v_entity, v_channel_id, p_wa_id, v_actor)
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
                      v_thread.handled_by;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_inbound(text, text, text, text, text, text, timestamptz) to app_user;
--> statement-breakpoint

-- 9b. A thread matched to no customer is matched to one (messaging.thread.match), once the lead
--     intake recorded the number's customer: one of the company's live customers holding the
--     thread's number. A thread already matched keeps its customer (`matched` false). No row when
--     the thread is not of the request's companies.
create or replace function app.whatsapp_match_thread(p_thread uuid, p_account uuid)
  returns table (account_id uuid, opportunity_id uuid, matched boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_thread public.whatsapp_threads;
  v_phone uuid;
  v_lead uuid;
  v_lead_owner uuid;
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
  if v_thread.account_id is not null then
    return query select v_thread.account_id, v_thread.opportunity_id, false;
    return;
  end if;
  select cp.id into v_phone
    from public.contact_phones cp
    join public.account_contacts ac on ac.contact_id = cp.contact_id
    join public.accounts a on a.id = ac.account_id and a.archived_at is null
    join public.account_entities ae on ae.account_id = a.id and ae.entity_id = v_thread.entity_id
   where ac.account_id = p_account and cp.e164 = '+' || v_thread.wa_id
   order by cp.is_primary desc, cp.id
   limit 1;
  if v_phone is null then
    raise exception 'the customer does not hold the thread''s number' using errcode = 'check_violation';
  end if;
  select o.id, o.owner_id into v_lead, v_lead_owner
    from public.opportunities o
   where o.account_id = p_account and o.entity_id = v_thread.entity_id
     and o.state = 'open' and o.archived_at is null
   order by o.created_at desc, o.id desc
   limit 1;
  update public.whatsapp_threads t
     set account_id = p_account, contact_phone_id = v_phone, opportunity_id = v_lead,
         assignee_id = coalesce(v_lead_owner,
                                (select ae.owner_id from public.account_entities ae
                                  where ae.account_id = p_account and ae.entity_id = t.entity_id)),
         updated_by = v_actor
   where t.id = p_thread
  returning * into v_thread;
  return query select v_thread.account_id, v_thread.opportunity_id, true;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_match_thread(uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_match_thread(uuid, uuid) to app_user;
--> statement-breakpoint

-- 9c. A delivery status from Meta (messaging.status.record), for a message the BOS sent: the
--     status only moves forward, so a repeated or late status changes nothing (`changed` false).
--     No row when Meta's id names no message of the request's companies.
create or replace function app.whatsapp_record_status(
  p_provider_message_id text,
  p_status text,
  p_at timestamptz,
  p_error_code int
) returns table (message_id uuid, thread_id uuid, entity_id smallint, status text, changed boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key public.whatsapp_message_keys;
  v_status text;
  v_direction text;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'a delivery status is sent, delivered, read or failed' using errcode = 'check_violation';
  end if;
  select * into v_key from public.whatsapp_message_keys k
   where k.provider_message_id = p_provider_message_id
     and k.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_key.provider_message_id is null then
    return;
  end if;
  select m.status, m.direction into v_status, v_direction
    from public.whatsapp_messages m
   where m.id = v_key.message_id and m.created_at = v_key.message_created_at
   for update;
  if v_direction <> 'outbound' or not app.whatsapp_status_moves(v_status, p_status) then
    return query select v_key.message_id, v_key.thread_id, v_key.entity_id, v_status, false;
    return;
  end if;
  update public.whatsapp_messages m
     set status = p_status,
         status_at = least(coalesce(p_at, pg_catalog.now()), pg_catalog.now()),
         error_code = case when p_status = 'failed' then p_error_code else m.error_code end
   where m.id = v_key.message_id and m.created_at = v_key.message_created_at;
  return query select v_key.message_id, v_key.thread_id, v_key.entity_id, p_status, true;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_status(text, text, timestamptz, int) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_status(text, text, timestamptz, int) to app_user;
--> statement-breakpoint

-- 9d. A template's status from Meta's template events (messaging.template.record_status), in every
--     company of the request that registered it under that name and language (one business
--     portfolio holds every company's templates). Answers how many changed.
create or replace function app.whatsapp_record_template_status(p_name text, p_language text, p_status text)
  returns int
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_changed int;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'approved', 'rejected', 'paused', 'disabled') then
    raise exception 'unknown template status' using errcode = 'check_violation';
  end if;
  update public.whatsapp_templates wt
     set status = p_status, status_at = pg_catalog.now(), updated_by = app.user_id()
   where wt.name = p_name and wt.language = p_language and wt.status <> p_status
     and wt.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  get diagnostics v_changed = row_count;
  return v_changed;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_template_status(text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_template_status(text, text, text) to app_user;
--> statement-breakpoint

-- 9e. STOP (messaging.opt_out.record): the thread's number opts out at p_at, and every WhatsApp
--     consent of every holder of the number is withdrawn (the number is what is messaged), each
--     withdrawal of the thread's own customer written on its timeline. A number already opted out
--     changes nothing (`newly` false). No row when the thread is not of the request's companies.
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
  if app.whatsapp_number_opted_out('+' || v_thread.wa_id, v_thread.opted_out_at) then
    return query select v_thread.opted_out_at, false, 0;
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
   where t.id = p_thread;
  return query select v_at, true, v_withdrawn;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_opt_out(uuid, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_opt_out(uuid, timestamptz) to app_user;
--> statement-breakpoint

-- 9f. The platform hands a thread to people (messaging.thread.record_hand_off): HUMAN, the output
--     filter's refusals, complaint words. A thread already with people keeps its first reason
--     (`changed` false). No row when the thread is not of the request's companies.
create or replace function app.whatsapp_hand_off(p_thread uuid, p_reason text)
  returns table (handled_by text, handoff_reason text, changed boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_thread public.whatsapp_threads;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('keyword', 'request', 'filter_refusals', 'complaint') then
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

-- 9g. The platform queues a template of its own (messaging.message.queue): the welcome (kind
--     template), or the confirmation of a STOP (kind system), which goes only to a number that
--     opted out, once after each opt-out. The guard refuses any other message to an opted-out
--     number. No row when the thread is not of the request's companies.
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
  if p_kind = 'system'
     and (v_thread.opted_out_at is null
          or exists (select 1 from public.whatsapp_messages m
                      where m.thread_id = v_thread.id and m.kind = 'system'
                        and m.direction = 'outbound' and m.created_at >= v_thread.opted_out_at)) then
    raise exception 'one confirmation follows each opt-out' using errcode = 'check_violation';
  end if;
  insert into public.whatsapp_messages (id, entity_id, thread_id, direction, kind, template_name,
                                        template_params, status, sent_by, created_at)
  values (v_id, v_thread.entity_id, v_thread.id, 'outbound', p_kind, p_template_name, p_params,
          'queued', v_actor, v_at);
  return query select v_id, v_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_queue_message(uuid, text, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_queue_message(uuid, text, text, jsonb) to app_user;
--> statement-breakpoint

-- 9h. What the messaging worker checks before it sends one queued message: the message, its
--     thread's number and window, whether the number has opted out and whether this is the STOP
--     confirmation, the template's category and status, how many messages the thread was handed
--     to Meta in the last hour, and the company number's provider reference. No row when the
--     message is not an outbound one of the request's companies.
create or replace function app.whatsapp_send_facts(p_message uuid)
  returns table (
    message_id uuid,
    created_at timestamptz,
    entity_id smallint,
    thread_id uuid,
    kind text,
    status text,
    send_attempted boolean,
    template_name text,
    template_params jsonb,
    body_masked text,
    file_id uuid,
    wa_id text,
    phone_number_id text,
    window_open_until timestamptz,
    opted_out boolean,
    confirmation boolean,
    template_category text,
    template_status text,
    sent_last_hour int
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  return query
    select m.id, m.created_at, m.entity_id, m.thread_id, m.kind, m.status,
           m.send_attempted_at is not null, m.template_name, m.template_params, m.body_masked,
           m.file_id, t.wa_id,
           (select ec.provider_ref from public.entity_channels ec
             where ec.id = t.channel_id and ec.is_active),
           t.window_open_until,
           app.whatsapp_number_opted_out('+' || t.wa_id, t.opted_out_at),
           (m.kind = 'system' and t.opted_out_at is not null and m.created_at >= t.opted_out_at),
           wt.category, wt.status,
           (select pg_catalog.count(*)::int from public.whatsapp_messages s
             where s.thread_id = t.id and s.direction = 'outbound'
               and s.created_at > pg_catalog.now() - interval '2 hours'
               and s.send_attempted_at > pg_catalog.now() - interval '1 hour')
      from public.whatsapp_messages m
      join public.whatsapp_threads t on t.id = m.thread_id
      left join public.whatsapp_templates wt
        on wt.entity_id = m.entity_id and wt.name = m.template_name and wt.language = 'en'
     where m.id = p_message and m.direction = 'outbound'
       and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_send_facts(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_send_facts(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 9i. The worker takes a queued message to send it (messaging.message.claim): once only, so a
--     message is handed to Meta at most once, even after a timeout. Answers whether this call
--     took it; false for a message already taken, no longer queued or of no company of the
--     request.
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
     and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  get diagnostics v_taken = row_count;
  return v_taken = 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_claim_send(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_claim_send(uuid) to app_user;
--> statement-breakpoint

-- 9j. The worker's answer for a queued message (messaging.message.record_send): `sent` with Meta's
--     id, for a message it took, whose statuses then name it; `failed` with Meta's error code, for
--     a message it took; `refused` with the check that refused it, for one it did not take. A
--     message already past queued changes nothing (`changed` false). No row when the message is
--     not an outbound one of the request's companies.
create or replace function app.whatsapp_record_send(
  p_message uuid,
  p_status text,
  p_provider_message_id text,
  p_refusal text,
  p_error_code int
) returns table (thread_id uuid, status text, changed boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_created_at timestamptz;
  v_entity smallint;
  v_thread uuid;
  v_status text;
  v_attempted_at timestamptz;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  if not ((p_status = 'sent' and p_provider_message_id is not null and p_refusal is null)
          or (p_status = 'failed' and p_provider_message_id is null and p_refusal is null)
          or (p_status = 'refused' and p_provider_message_id is null and p_refusal is not null)) then
    raise exception 'a send is sent with Meta''s id, failed, or refused with its reason'
      using errcode = 'check_violation';
  end if;
  select m.created_at, m.entity_id, m.thread_id, m.status, m.send_attempted_at
    into v_created_at, v_entity, v_thread, v_status, v_attempted_at
    from public.whatsapp_messages m
   where m.id = p_message and m.direction = 'outbound'
     and m.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
   for update;
  if v_thread is null then
    return;
  end if;
  if v_status <> 'queued'
     or (p_status in ('sent', 'failed') and v_attempted_at is null)
     or (p_status = 'refused' and v_attempted_at is not null) then
    return query select v_thread, v_status, false;
    return;
  end if;
  update public.whatsapp_messages m
     set status = p_status, status_at = pg_catalog.now(), refusal = p_refusal,
         error_code = p_error_code, provider_message_id = p_provider_message_id
   where m.id = p_message and m.created_at = v_created_at;
  if p_status = 'sent' then
    insert into public.whatsapp_message_keys (provider_message_id, entity_id, message_id,
                                              message_created_at, thread_id)
    values (p_provider_message_id, v_entity, p_message, v_created_at, v_thread);
  end if;
  return query select v_thread, p_status, true;
end
$$;
--> statement-breakpoint
revoke execute on function app.whatsapp_record_send(uuid, text, text, text, int) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.whatsapp_record_send(uuid, text, text, text, int) to app_user;
