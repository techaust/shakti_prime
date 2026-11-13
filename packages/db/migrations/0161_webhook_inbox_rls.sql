-- Phase 2, slice P5: the webhook backbone (docs/03-roadmap-appendix/phase2.md §5.1).
--
-- Every provider delivery that passes its check is stored in `webhook_inbox` before the route
-- answers, and processed later by a QStash worker. The table belongs to no company and no request
-- role selects or writes it:
-- - the routes insert through `app.webhook_receive()` as the login role `webhook_receiver`
--   (created by src/migrate.ts), which may execute that one function and reads nothing;
-- - the worker and its sweep, as `system:workers` with the platform-only `webhooks.process`, claim,
--   mark, list and purge rows through `app.webhook_claim()`, `app.webhook_mark()`,
--   `app.webhook_waiting()` and `app.webhook_purge()`;
-- - Integration Health reads counts through `app.webhook_health()` and Process again clears a
--   failure through `app.webhook_replay()`, both with `admin.integrations.write:all` and the
--   latter with `integrations.dlq.replay:all`.

-- 1. The platform-only permissions: the eleven of 0142 kept, webhooks.process added.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process']::text[]
$$;
--> statement-breakpoint

-- 2. A row stays as it arrived. Only the delivery columns change (the lease, the attempts, the
--    outcome and its code, the company a handler names), the payload only to nothing when it is
--    purged, a processed row is never processed again, and a failure is cleared only with its
--    code and only by Process again (`app.webhook_replay()`). A row is removed only by the purge,
--    which says so for its own transaction. Every role, the owner included.
create or replace function app.webhook_inbox_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('app.webhook_retention', true) = 'purge' then
      return old;
    end if;
    raise exception 'webhook_inbox rows are removed only by the purge'
      using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.provider, new.provider_event_id, new.received_at, new.signature_ok,
      new.payload_sha256)
     is distinct from
     (old.id, old.provider, old.provider_event_id, old.received_at, old.signature_ok,
      old.payload_sha256) then
    raise exception 'only the delivery and purge columns of webhook_inbox may change'
      using errcode = 'insufficient_privilege';
  end if;
  if new.payload_json is distinct from old.payload_json
     and not (new.payload_json is null and new.payload_purged_at is not null) then
    raise exception 'a stored payload is only ever removed' using errcode = 'insufficient_privilege';
  end if;
  if old.payload_purged_at is not null and new.payload_purged_at is distinct from old.payload_purged_at then
    raise exception 'a purge is never undone' using errcode = 'insufficient_privilege';
  end if;
  if old.processed_at is not null
     and (new.processed_at, new.failed_at, new.error_code)
         is distinct from (old.processed_at, old.failed_at, old.error_code) then
    raise exception 'a processed delivery stays processed' using errcode = 'insufficient_privilege';
  end if;
  if old.entity_id is not null and new.entity_id is distinct from old.entity_id then
    raise exception 'a delivery keeps the company its handler named'
      using errcode = 'insufficient_privilege';
  end if;
  if new.attempts < old.attempts then
    raise exception 'attempts are only ever counted up' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_inbox_guard() from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
create trigger webhook_inbox_guard before update or delete on public.webhook_inbox
  for each row execute function app.webhook_inbox_guard();
--> statement-breakpoint

-- 3. Row-level security on and forced, with no policy: every request role reads and writes
--    nothing, and only the definers below (the table owner's) reach the rows.
alter table public.webhook_inbox enable row level security;
--> statement-breakpoint
alter table public.webhook_inbox force row level security;
--> statement-breakpoint
revoke all on public.webhook_inbox from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher, webhook_receiver;
--> statement-breakpoint

-- 4. A delivery that passed its check, stored once: a repeat of the same provider event changes
--    nothing and answers the stored row's id with `repeated`. The route's only database call, as
--    `webhook_receiver`, which no other function is granted to; there is no person and no company
--    to check (DATABASE §4.1 lists it among the definers that check no permission). The payload is
--    the delivery as JSON, the checksum that of its raw bytes.
create or replace function app.webhook_receive(p_provider text, p_event_id text, p_payload jsonb,
                                               p_sha256 text)
  returns table (inbox_id uuid, repeated boolean)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_payload is null then
    raise exception 'a delivery has a payload' using errcode = '22023';
  end if;
  insert into public.webhook_inbox (id, provider, provider_event_id, payload_json, payload_sha256)
  values (app.uuid_v7(), p_provider, p_event_id, p_payload, p_sha256)
  on conflict on constraint webhook_inbox_provider_event_unique do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;
  return query
    select w.id, true from public.webhook_inbox w
     where w.provider = p_provider and w.provider_event_id = p_event_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_receive(text, text, jsonb, text) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant usage on schema app to webhook_receiver;
--> statement-breakpoint
grant execute on function app.webhook_receive(text, text, jsonb, text) to webhook_receiver;
--> statement-breakpoint

-- 5. The worker's lease on one waiting row (`webhooks.process:all`): the row is claimed for the
--    lease's seconds (10 to 300) and its attempt counted, and its provider, payload and attempts
--    come back with the lease's exact text, which names this call to `app.webhook_mark()`. A row
--    already processed or failed, purged, or leased to a live call answers nothing. A row tried
--    ten times already is failed with `too_many_attempts` instead, so no row is tried for ever.
create or replace function app.webhook_claim(p_id uuid, p_lease_seconds integer)
  returns table (provider text, payload jsonb, attempts integer, lease text)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_seconds integer := least(greatest(coalesce(p_lease_seconds, 60), 10), 300);
begin
  if not app.has_perm('webhooks.process:all') then
    raise exception 'webhooks.process:all is required' using errcode = '42501';
  end if;
  update public.webhook_inbox w
     set failed_at = pg_catalog.now(), error_code = 'too_many_attempts', claimed_until = null
   where w.id = p_id and w.processed_at is null and w.failed_at is null
     and (w.claimed_until is null or w.claimed_until <= pg_catalog.now())
     and w.attempts >= 10;
  return query
    update public.webhook_inbox w
       set claimed_until = pg_catalog.now() + v_seconds * interval '1 second',
           attempts = w.attempts + 1
     where w.id = p_id and w.processed_at is null and w.failed_at is null
       and w.payload_json is not null
       and (w.claimed_until is null or w.claimed_until <= pg_catalog.now())
    returning w.provider, w.payload_json, w.attempts, w.claimed_until::text;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_claim(uuid, integer) from public, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_claim(uuid, integer) to app_user;
--> statement-breakpoint

-- 6. The outcome of one row (`webhooks.process:all`):
--    - `processed`, under the caller's lease, with an optional code (`no_handler`) and the company
--      the handler named;
--    - `failed`, with its code: under the caller's lease (`payload_unreadable`), or with no lease
--      from QStash's failure callback after the last retry (`handler_failed`), which then changes
--      only a row no live call holds;
--    - `released`, under the caller's lease: a handler error QStash retries, so the retry may
--      claim the row at once.
--    Answers whether the row changed.
create or replace function app.webhook_mark(p_id uuid, p_lease text, p_outcome text,
                                            p_error_code text, p_entity smallint)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_changed integer;
begin
  if not app.has_perm('webhooks.process:all') then
    raise exception 'webhooks.process:all is required' using errcode = '42501';
  end if;
  if p_outcome not in ('processed', 'failed', 'released') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if p_outcome = 'failed' and p_error_code is null then
    raise exception 'a failure has a code' using errcode = '22023';
  end if;
  if p_lease is null and p_outcome <> 'failed' then
    raise exception 'only a failure is recorded without a lease' using errcode = '22023';
  end if;
  if p_entity is not null
     and not exists (select 1 from public.entities e where e.id = p_entity) then
    raise exception 'no such company' using errcode = '23503';
  end if;
  update public.webhook_inbox w
     set processed_at = case when p_outcome = 'processed' then pg_catalog.now() end,
         failed_at = case when p_outcome = 'failed' then pg_catalog.now() end,
         error_code = case when p_outcome = 'released' then w.error_code else p_error_code end,
         entity_id = coalesce(w.entity_id, p_entity),
         claimed_until = case when p_outcome = 'released' then pg_catalog.now() end
   where w.id = p_id and w.processed_at is null and w.failed_at is null
     and case when p_lease is null
              then w.claimed_until is null or w.claimed_until <= pg_catalog.now()
              else w.claimed_until = p_lease::timestamptz end;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_mark(uuid, text, text, text, smallint) from public, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_mark(uuid, text, text, text, smallint) to app_user;
--> statement-breakpoint

-- 7. The sweep's rows (`webhooks.process:all`): waiting rows no call holds whose arrival, or whose
--    last lease, is more than the given seconds (at least 30) ago, oldest first, at most
--    `p_limit` (1 to 500), each with its attempts, which name its next delivery.
create or replace function app.webhook_waiting(p_idle_seconds integer, p_limit integer)
  returns table (inbox_id uuid, attempts integer)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_cutoff timestamptz := pg_catalog.now()
                          - greatest(coalesce(p_idle_seconds, 60), 30) * interval '1 second';
begin
  if not app.has_perm('webhooks.process:all') then
    raise exception 'webhooks.process:all is required' using errcode = '42501';
  end if;
  return query
    select w.id, w.attempts
      from public.webhook_inbox w
     where w.processed_at is null and w.failed_at is null
       and w.received_at < v_cutoff
       and w.payload_json is not null
       and (w.claimed_until is null or w.claimed_until < v_cutoff)
     order by w.received_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_waiting(integer, integer) from public, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_waiting(integer, integer) to app_user;
--> statement-breakpoint

-- 8. The retention of the inbox (`webhooks.process:all`; docs/03-roadmap-appendix/phase2.md §2,
--    question 10): the payloads of rows processed more than `p_payload_days` ago are removed, then
--    the rows that arrived more than `p_row_days` ago, each at most `p_limit` (1 to 5,000) a call,
--    oldest first. The periods are workshop defaults the command passes in, at least a day each.
--    Each call is one `retention_runs` row (`webhook-inbox-purge`) with the count of payloads and
--    rows removed; a call that fails records its error there and changes nothing else.
create or replace function app.webhook_purge(p_payload_days integer, p_row_days integer,
                                             p_limit integer)
  returns table (payloads integer, rows_removed integer)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_run uuid := app.uuid_v7();
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_payloads integer := 0;
  v_rows integer := 0;
begin
  if not app.has_perm('webhooks.process:all') then
    raise exception 'webhooks.process:all is required' using errcode = '42501';
  end if;
  if p_payload_days is null or p_payload_days < 1 or p_row_days is null or p_row_days < 1 then
    raise exception 'the retention periods are whole days, at least one' using errcode = '22023';
  end if;
  insert into public.retention_runs (id, job, started_at)
  values (v_run, 'webhook-inbox-purge', pg_catalog.clock_timestamp());
  begin
    with due as (
      select w.id from public.webhook_inbox w
       where w.processed_at is not null
         and w.processed_at < pg_catalog.now() - p_payload_days * interval '1 day'
         and w.payload_json is not null
       order by w.processed_at
       limit v_limit
         for update skip locked)
    update public.webhook_inbox w
       set payload_json = null, payload_purged_at = pg_catalog.now()
      from due where w.id = due.id;
    get diagnostics v_payloads = row_count;
    perform pg_catalog.set_config('app.webhook_retention', 'purge', true);
    with due as (
      select w.id from public.webhook_inbox w
       where w.received_at < pg_catalog.now() - p_row_days * interval '1 day'
       order by w.received_at
       limit v_limit
         for update skip locked)
    delete from public.webhook_inbox w using due where w.id = due.id;
    get diagnostics v_rows = row_count;
    perform pg_catalog.set_config('app.webhook_retention', '', true);
  exception when others then
    update public.retention_runs
       set finished_at = pg_catalog.clock_timestamp(), error = pg_catalog.left(sqlerrm, 500)
     where id = v_run;
    return query select 0, 0;
    return;
  end;
  update public.retention_runs
     set finished_at = pg_catalog.clock_timestamp(), rows_affected = v_payloads + v_rows
   where id = v_run;
  return query select v_payloads, v_rows;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_purge(integer, integer, integer) from public, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_purge(integer, integer, integer) to app_user;
--> statement-breakpoint

-- 9. Integration Health › Webhooks (`admin.integrations.write:all`, a person): per provider the
--    deliveries received, processed and failed in the last 24 hours, those still waiting and the
--    oldest of them; then the failed rows, newest first, at most `p_limit` (1 to 50), with ids,
--    times, attempts and codes only, never a payload. Every provider is answered, with zeros.
create or replace function app.webhook_health(p_limit integer)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz := pg_catalog.now() - interval '24 hours';
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_providers jsonb;
  v_total integer;
  v_items jsonb;
begin
  if app.user_id() is null or not app.has_perm('admin.integrations.write:all') then
    raise exception 'admin.integrations.write:all is required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', p.provider,
           'received24h', (select count(*)::integer from public.webhook_inbox w
                            where w.provider = p.provider and w.received_at >= v_since),
           'processed24h', (select count(*)::integer from public.webhook_inbox w
                             where w.provider = p.provider and w.processed_at >= v_since),
           'failed24h', (select count(*)::integer from public.webhook_inbox w
                          where w.provider = p.provider and w.failed_at >= v_since),
           'waiting', q.waiting,
           'oldestWaitingAt', q.oldest) order by p.ord), '[]'::jsonb)
    into v_providers
    from unnest(array['meta_whatsapp', 'meta_leadgen', 'google_leadform', 'exotel_status',
                      'exotel_incoming', 'livekit']) with ordinality as p(provider, ord)
    cross join lateral (
      select count(*)::integer as waiting, pg_catalog.min(w.received_at) as oldest
        from public.webhook_inbox w
       where w.provider = p.provider and w.processed_at is null and w.failed_at is null) q;
  select count(*)::integer into v_total from public.webhook_inbox w where w.failed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object(
           'inboxId', f.id, 'provider', f.provider, 'errorCode', f.error_code,
           'attempts', f.attempts, 'receivedAt', f.received_at, 'failedAt', f.failed_at)
           order by f.failed_at desc, f.id desc), '[]'::jsonb)
    into v_items
    from (select w.id, w.provider, w.error_code, w.attempts, w.received_at, w.failed_at
            from public.webhook_inbox w
           where w.failed_at is not null
           order by w.failed_at desc, w.id desc
           limit v_limit) f;
  return jsonb_build_object('providers', v_providers,
                            'failed', jsonb_build_object('total', v_total, 'items', v_items));
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_health(integer) from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_health(integer) to app_user, app_reader;
--> statement-breakpoint

-- 10. Process again (`webhooks.event.replay`; `integrations.dlq.replay:all`, a person): a failed
--     row whose payload is still held loses its failure and its code and waits again; answers its
--     provider, its attempts, which name its next delivery, and the code it had, or nothing when
--     the row is not failed or its payload is gone.
create or replace function app.webhook_replay(p_id uuid)
  returns table (provider text, attempts integer, error_code text)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  if app.user_id() is null or not app.has_perm('integrations.dlq.replay:all') then
    raise exception 'integrations.dlq.replay:all is required' using errcode = '42501';
  end if;
  select w.error_code into v_code
    from public.webhook_inbox w
   where w.id = p_id and w.failed_at is not null and w.payload_json is not null
     for update;
  if not found then
    return;
  end if;
  return query
    update public.webhook_inbox w
       set failed_at = null, error_code = null, claimed_until = null
     where w.id = p_id
    returning w.provider, w.attempts, v_code;
end
$$;
--> statement-breakpoint
revoke execute on function app.webhook_replay(uuid) from public, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.webhook_replay(uuid) to app_user;
