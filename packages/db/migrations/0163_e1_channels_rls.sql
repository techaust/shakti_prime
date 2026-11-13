-- E1 Channels and dial rules (docs/03-roadmap-appendix/phase2.md §5.2, BLUEPRINT §7.7, PRD TEL-04
-- and CRM-10): each company's own numbers per channel, the facts a dial is checked against, and
-- the DND state of a phone, which only the platform records.

-- 1. The DND record is platform-only, like the other workers' grants: 0161's eleven keys, kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record']::text[]
$$;
--> statement-breakpoint

-- 2. entity_channels: read by any principal acting in the company, since every caller's screen
--    shows the number a call would go out on; written by an Executive (admin.entities.write:all)
--    in a company of the request. After the insert only the provider's reference, the DLT header,
--    the verification and the active mark change (column grants), and a number taken out of use
--    is never put back: a new row is written instead, so what named the old row keeps it.
create trigger set_updated_at before update on entity_channels
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create or replace function app.entity_channels_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.is_active = false and new.is_active then
    raise exception 'a number taken out of use is not put back' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.entity_channels_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger entity_channels_guard before update on entity_channels
  for each row execute function app.entity_channels_guard();
--> statement-breakpoint
alter table entity_channels enable row level security;
--> statement-breakpoint
alter table entity_channels force row level security;
--> statement-breakpoint
create policy entity_channels_read on entity_channels for select to app_user, app_reader
  using ((select app.user_id()) is not null
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy entity_channels_insert on entity_channels for insert to app_user
  with check ((select app.has_perm('admin.entities.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy entity_channels_update on entity_channels for update to app_user
  using ((select app.has_perm('admin.entities.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('admin.entities.write:all'))
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on entity_channels from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on entity_channels to app_user;
--> statement-breakpoint
grant update (provider_ref, dlt_header, is_active, verified_at, updated_at, updated_by) on entity_channels to app_user;
--> statement-breakpoint
grant select on entity_channels to app_reader;
--> statement-breakpoint

-- 3. A phone's DND state is the platform's record of the register, never a person's edit: a
--    request may not add a phone already marked, nor change the mark or when it was checked.
--    `app.record_phone_dnd()` below, a definer, is the one way to write them.
create or replace function app.contact_phones_dnd_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if current_user not in ('app_user', 'app_reader') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_dnd or new.dnd_checked_at is not null then
      raise exception 'a DND check is recorded by the platform' using errcode = 'insufficient_privilege';
    end if;
  elsif new.is_dnd is distinct from old.is_dnd
        or new.dnd_checked_at is distinct from old.dnd_checked_at then
    raise exception 'a DND check is recorded by the platform' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.contact_phones_dnd_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger contact_phones_dnd_guard before insert or update on contact_phones
  for each row execute function app.contact_phones_dnd_guard();
--> statement-breakpoint

-- 4. crm.phone.dnd_record: the platform (crm.dnd.record) records what the DND register answered
--    for one phone of a customer of the request's company, checked at p_checked_at, for the number
--    it asked about (a number changed meanwhile takes nothing). An answer older than the one
--    recorded changes nothing, so a slow lookup never undoes a newer one. Answers the phone's state
--    as it now stands; no row when the phone is not a customer's of the company with that number.
create or replace function app.record_phone_dnd(
  p_phone uuid,
  p_e164 text,
  p_is_dnd boolean,
  p_checked_at timestamptz
) returns table (is_dnd boolean, dnd_checked_at timestamptz)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
begin
  if app.user_id() is null or not app.has_perm('crm.dnd.record:entity') then
    raise exception 'crm.dnd.record is required' using errcode = '42501';
  end if;
  if p_is_dnd is null or p_checked_at is null or p_checked_at > pg_catalog.now() + interval '1 minute' then
    raise exception 'a DND answer needs its state and a time not in the future'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1
      from public.contact_phones cp
      join public.account_contacts ac on ac.contact_id = cp.contact_id
      join public.account_entities ae on ae.account_id = ac.account_id
     where cp.id = p_phone and cp.e164 = p_e164 and ae.entity_id = any (v_entities)) then
    return;
  end if;
  update public.contact_phones cp
     set is_dnd = p_is_dnd, dnd_checked_at = p_checked_at, updated_at = pg_catalog.now()
   where cp.id = p_phone
     and cp.e164 = p_e164
     and (cp.dnd_checked_at is null or cp.dnd_checked_at < p_checked_at);
  return query select cp.is_dnd, cp.dnd_checked_at from public.contact_phones cp where cp.id = p_phone;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_phone_dnd(uuid, text, boolean, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_phone_dnd(uuid, text, boolean, timestamptz) to app_user;
--> statement-breakpoint

-- 5. What checkDial needs for a call to one phone of a lead's customer, and nothing more: the
--    lead's company; how the lead came (its source's channel), whether the customer asked to be
--    called back (an open callback task on the lead) and whether it has an order, from which
--    call-purpose.ts decides service or promotional; the number and its DND state; whether that
--    contact holds an unwithdrawn service consent for calls (one consent for the group, LAW-2's
--    default); whether any contact of the customer, or anyone else holding the same number,
--    withdrew consent to calls and gave none since (CRM-10: an opt-out holds on every path); and
--    the company's active 140-series and 160-series numbers. For a person holding calls.dial who
--    reads the lead (crm.lead.read in their scope, in a company of the request); no row when the
--    lead is not theirs to read or the phone is not a contact's of its customer.
create or replace function app.dial_facts(p_opportunity uuid, p_contact_phone uuid)
  returns table (
    entity_id smallint,
    source_channel text,
    has_open_callback boolean,
    has_order boolean,
    phone_e164 text,
    phone_is_dnd boolean,
    phone_dnd_checked_at timestamptz,
    has_service_consent boolean,
    call_consent_withdrawn boolean,
    promo_number text,
    service_number text
  )
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
begin
  if app.user_id() is null or not app.request_is_person() or not app.has_perm('calls.dial:own') then
    raise exception 'a person holding calls.dial is required' using errcode = '42501';
  end if;
  return query
    with lead as (
      select o.id, o.entity_id, o.account_id, o.source_id
        from public.opportunities o
       where o.id = p_opportunity
         and o.archived_at is null
         and o.entity_id = any (v_entities)
         and app.scope_ok('crm.lead.read', o.owner_id, o.team_id)),
    phone as (
      select cp.id, cp.contact_id, cp.e164, cp.is_dnd, cp.dnd_checked_at
        from public.contact_phones cp
        join public.account_contacts ac on ac.contact_id = cp.contact_id
        join lead l on l.account_id = ac.account_id
       where cp.id = p_contact_phone),
    withdrawn_contacts as (
      select ac.contact_id from public.account_contacts ac join lead l on l.account_id = ac.account_id
      union
      select cp.contact_id from public.contact_phones cp join phone p on p.e164 = cp.e164)
    select l.entity_id,
           ls.channel,
           exists (select 1 from public.tasks t
                    where t.opportunity_id = l.id and t.entity_id = l.entity_id
                      and t.kind = 'callback' and t.state = 'open'),
           exists (select 1 from public.sales_orders so
                    where so.opportunity_id = l.id and so.state <> 'cancelled'),
           p.e164,
           p.is_dnd,
           p.dnd_checked_at,
           exists (select 1 from public.consents c
                    where c.contact_id = p.contact_id and c.channel = 'call'
                      and c.purpose = 'service' and c.withdrawn_at is null),
           exists (select 1 from withdrawn_contacts wc
                     join public.consents w on w.contact_id = wc.contact_id
                    where w.channel = 'call' and w.withdrawn_at is not null
                      and not exists (select 1 from public.consents g
                                       where g.contact_id = w.contact_id and g.channel = 'call'
                                         and g.withdrawn_at is null
                                         and g.given_at > w.withdrawn_at)),
           (select ec.number_e164 from public.entity_channels ec
             where ec.entity_id = l.entity_id and ec.channel = 'call_promo_140' and ec.is_active),
           (select ec.number_e164 from public.entity_channels ec
             where ec.entity_id = l.entity_id and ec.channel = 'call_service_160' and ec.is_active)
      from lead l
      join phone p on true
      left join public.lead_sources ls on ls.id = l.source_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.dial_facts(uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.dial_facts(uuid, uuid) to app_user, app_reader;
