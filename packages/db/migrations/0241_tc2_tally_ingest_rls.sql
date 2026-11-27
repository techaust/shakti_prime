-- TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §5 and §6.3, ADR 0013): the row security of
-- the Tally mirror and the definers through which a connector's principal (role
-- system:tally_connector, the platform-only tally.connector.sync) writes it and an Executive
-- registers, maps, rotates and revokes a connector. No request role inserts, updates or deletes a
-- tally_* table directly. People read a company's rows with finance.read, purchase vouchers only
-- with procurement.rate.read as well; a connector reads no table at all. The BOS never writes to
-- Tally: nothing here leaves the database.

-- 1. tally.connector.sync is platform-only, like the workers' grants: the nineteen keys of the W2
--    media retention migration, kept, and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'calls.process', 'crm.ingest.run', 'messaging.process',
               'voice.session.record', 'sales.quote.accept.remote',
               'messaging.media.expire', 'tally.connector.sync']::text[]
$$;
--> statement-breakpoint

-- 2. Row security. Every table forces it; request roles read only.
create trigger set_updated_at before update on tally_connectors
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table tally_connectors enable row level security;
--> statement-breakpoint
alter table tally_connectors force row level security;
--> statement-breakpoint
create policy tally_connectors_read on tally_connectors for select to app_user, app_reader
  using ((select app.has_perm('admin.integrations.write:all'))
         and cardinality((select app.entity_ids())) > 0);
--> statement-breakpoint
revoke all on tally_connectors from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
-- The key hashes are never selected by a request role: the routes read them through
-- app.tally_connector_auth().
grant select (id, name, key_hint, next_key_hint, key_rotated_at, connector_version, tally_version,
              queue_depth, last_heartbeat_at, silence_alerted_at, revoked_at, revoked_by,
              created_at, updated_at, created_by, updated_by)
  on tally_connectors to app_user, app_reader;
--> statement-breakpoint

alter table tally_connector_companies enable row level security;
--> statement-breakpoint
alter table tally_connector_companies force row level security;
--> statement-breakpoint
create policy tally_connector_companies_read on tally_connector_companies for select
  to app_user, app_reader
  using (((select app.has_perm('admin.integrations.write:all'))
          or (select app.has_perm('finance.read:entity')))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_connector_companies from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_connector_companies to app_user, app_reader;
--> statement-breakpoint

alter table tally_cursors enable row level security;
--> statement-breakpoint
alter table tally_cursors force row level security;
--> statement-breakpoint
create policy tally_cursors_read on tally_cursors for select to app_user, app_reader
  using (((select app.has_perm('admin.integrations.write:all'))
          or (select app.has_perm('finance.read:entity')))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_cursors from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_cursors to app_user, app_reader;
--> statement-breakpoint

alter table tally_vouchers enable row level security;
--> statement-breakpoint
alter table tally_vouchers force row level security;
--> statement-breakpoint
create policy tally_vouchers_read on tally_vouchers for select to app_user, app_reader
  using ((select app.has_perm('finance.read:entity'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_vouchers from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_vouchers to app_user, app_reader;
--> statement-breakpoint

-- Supplier rates: restricted to procurement.rate.read on top of finance.read (docs/05-database.md
-- §4.3). The reporting role gets no grant at all.
alter table tally_purchase_vouchers enable row level security;
--> statement-breakpoint
alter table tally_purchase_vouchers force row level security;
--> statement-breakpoint
create policy tally_purchase_vouchers_read on tally_purchase_vouchers for select
  to app_user, app_reader
  using ((select app.has_perm('finance.read:entity'))
         and (select app.has_perm('procurement.rate.read:entity'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_purchase_vouchers from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_purchase_vouchers to app_user, app_reader;
--> statement-breakpoint

alter table tally_ledgers enable row level security;
--> statement-breakpoint
alter table tally_ledgers force row level security;
--> statement-breakpoint
create policy tally_ledgers_read on tally_ledgers for select to app_user, app_reader
  using ((select app.has_perm('finance.read:entity'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_ledgers from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_ledgers to app_user, app_reader;
--> statement-breakpoint

alter table tally_snapshots enable row level security;
--> statement-breakpoint
alter table tally_snapshots force row level security;
--> statement-breakpoint
create policy tally_snapshots_read on tally_snapshots for select to app_user, app_reader
  using ((select app.has_perm('finance.read:entity'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_snapshots from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_snapshots to app_user, app_reader;
--> statement-breakpoint

-- Append-only: a tombstone is never removed, and only its reversal time is ever set, once (TC3).
create or replace function app.tally_voucher_tombstones_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tally_voucher_tombstones is append-only' using errcode = 'insufficient_privilege';
  end if;
  if old.reversal_applied_at is not null or new.reversal_applied_at is null
     or (new.id, new.entity_id, new.voucher_guid, new.voucher_type, new.snapshot_id, new.detected_at)
        is distinct from
        (old.id, old.entity_id, old.voucher_guid, old.voucher_type, old.snapshot_id, old.detected_at) then
    raise exception 'tally_voucher_tombstones is append-only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_voucher_tombstones_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger tally_voucher_tombstones_append_only before update or delete on tally_voucher_tombstones
  for each row execute function app.tally_voucher_tombstones_guard();
--> statement-breakpoint
alter table tally_voucher_tombstones enable row level security;
--> statement-breakpoint
alter table tally_voucher_tombstones force row level security;
--> statement-breakpoint
create policy tally_voucher_tombstones_read on tally_voucher_tombstones for select
  to app_user, app_reader
  using ((select app.has_perm('finance.read:entity'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on tally_voucher_tombstones from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on tally_voucher_tombstones to app_user, app_reader;
--> statement-breakpoint

-- 3. The connector's check, shared by its definers: the caller is a live connector acting in its
--    own role with tally.connector.sync, and, when a company is named, that company is in the
--    request and mapped to this connector under that Tally company name.
create or replace function app.tally_require_connector(p_entity smallint, p_company text)
  returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not app.has_perm('tally.connector.sync:entity')
     or coalesce(pg_catalog.current_setting('app.role', true), '') <> 'system:tally_connector'
     or not exists (select 1 from public.tally_connectors c
                     where c.id = app.user_id() and c.revoked_at is null) then
    raise exception 'a live Tally connector is required' using errcode = '42501';
  end if;
  if p_entity is not null and (
       not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[])))
       or not exists (select 1 from public.tally_connector_companies m
                       where m.connector_id = app.user_id()
                         and m.entity_id = p_entity
                         and m.tally_company = p_company)) then
    raise exception 'the company is not mapped to this connector' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_require_connector(smallint, text) from public, readonly_reporter;
--> statement-breakpoint

-- 4. A connector's keys and mapped companies, for the routes to verify its signature and build its
--    request. The route asks as the connector named by the request's header, before the signature
--    is checked, so it answers only the caller's own row and nothing of any other connector; a
--    revoked or unknown connector has none.
create or replace function app.tally_connector_auth(p_connector uuid)
  returns table (key_hash text, next_key_hash text, entity_id smallint, entity_code text,
                 tally_company text)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_connector is distinct from app.user_id()
     or not app.has_perm('tally.connector.sync:entity')
     or coalesce(pg_catalog.current_setting('app.role', true), '') <> 'system:tally_connector' then
    raise exception 'only the connector itself is looked up' using errcode = '42501';
  end if;
  return query
    select c.key_hash, c.next_key_hash, m.entity_id, e.code, m.tally_company
      from public.tally_connectors c
      left join public.tally_connector_companies m on m.connector_id = c.id
      left join public.entities e on e.id = m.entity_id
     where c.id = p_connector and c.revoked_at is null;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_auth(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_auth(uuid) to app_user, app_reader;
--> statement-breakpoint

-- 5. The cursor of a company: read by its connector (GET cursor), and locked, then moved forward
--    only, by a batch.
create or replace function app.tally_cursor(p_entity smallint, p_company text)
  returns table (last_alter_id bigint, updated_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.tally_require_connector(p_entity, p_company);
  return query
    select c.last_alter_id, c.updated_at from public.tally_cursors c
     where c.entity_id = p_entity and c.tally_company = p_company;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_cursor(smallint, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_cursor(smallint, text) to app_user, app_reader;
--> statement-breakpoint
create or replace function app.tally_cursor_lock(p_entity smallint, p_company text, p_new_id uuid)
  returns table (id uuid, last_alter_id bigint)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.tally_require_connector(p_entity, p_company);
  insert into public.tally_cursors (id, entity_id, tally_company, last_alter_id, connector_id)
    values (p_new_id, p_entity, p_company, 0, app.user_id())
    on conflict (entity_id, tally_company) do nothing;
  return query
    select c.id, c.last_alter_id from public.tally_cursors c
     where c.entity_id = p_entity and c.tally_company = p_company
       for update;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_cursor_lock(smallint, text, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_cursor_lock(smallint, text, uuid) to app_user;
--> statement-breakpoint
create or replace function app.tally_cursor_move(p_entity smallint, p_company text, p_to bigint)
  returns timestamptz
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  perform app.tally_require_connector(p_entity, p_company);
  update public.tally_cursors c
     set last_alter_id = p_to, connector_id = app.user_id(), updated_at = pg_catalog.now()
   where c.entity_id = p_entity and c.tally_company = p_company and c.last_alter_id <= p_to
  returning c.updated_at into v_at;
  if v_at is null then
    raise exception 'a cursor only moves forward'
      using errcode = '23514', constraint = 'tally_cursors_alter_id_check';
  end if;
  return v_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_cursor_move(smallint, text, bigint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_cursor_move(smallint, text, bigint) to app_user;
--> statement-breakpoint

-- 6. The stored vouchers of a company with the given GUIDs (a batch's, a held snapshot's), or all
--    of them (p_guids null, for the daily snapshot's diff): their type, AlterID, state, date and
--    when they were first stored, never their amounts. Asked by the company's connector, or by a person
--    confirming a held snapshot (finance.recon.write in the company).
create or replace function app.tally_vouchers_known(p_entity smallint, p_company text, p_guids text[])
  returns table (guid text, type text, alter_id bigint, state text, voucher_date date,
                 received_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if app.has_perm('tally.connector.sync:entity') then
    perform app.tally_require_connector(p_entity, p_company);
  elsif not (app.request_is_person()
             and app.has_perm('finance.recon.write:entity')
             and p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'finance.recon.write is required' using errcode = '42501';
  end if;
  return query
    select v.guid, v.type, v.alter_id, v.state, v.voucher_date, v.received_at
      from public.tally_vouchers v
     where v.entity_id = p_entity and v.tally_company = p_company
       and (p_guids is null or v.guid = any (p_guids))
    union all
    select v.guid, v.type, v.alter_id, v.state, v.voucher_date, v.received_at
      from public.tally_purchase_vouchers v
     where v.entity_id = p_entity and v.tally_company = p_company
       and (p_guids is null or v.guid = any (p_guids));
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_vouchers_known(smallint, text, text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_vouchers_known(smallint, text, text[]) to app_user, app_reader;
--> statement-breakpoint

-- 7. A batch's vouchers, each with the state the command's machine gave it: a new GUID is stored,
--    a known one is replaced only by a higher AlterID (newest wins), and a GUID another company or
--    Tally company holds is refused. Purchases and debit notes go to the restricted table.
create or replace function app.tally_vouchers_write(p_entity smallint, p_company text, p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_count integer := 0;
  v_n integer;
begin
  perform app.tally_require_connector(p_entity, p_company);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'the rows are not a batch' using errcode = '23514';
  end if;
  if exists (
       select 1 from jsonb_to_recordset(p_rows) as r(guid text)
        where exists (select 1 from public.tally_vouchers v
                       where v.guid = r.guid
                         and (v.entity_id <> p_entity or v.tally_company <> p_company))
           or exists (select 1 from public.tally_purchase_vouchers v
                       where v.guid = r.guid
                         and (v.entity_id <> p_entity or v.tally_company <> p_company))) then
    raise exception 'a voucher belongs to another company'
      using errcode = '23505', constraint = 'tally_vouchers_guid_unique';
  end if;
  insert into public.tally_vouchers as v
    (id, entity_id, tally_company, connector_id, guid, alter_id, type, type_name, voucher_no,
     voucher_date, party_name, party_gstin, buyer_order_no, amount, is_cancelled, is_optional,
     payload_json, state, state_changed_at, received_at, updated_at, deleted_at)
  select r.id, p_entity, p_company, app.user_id(), r.guid, r.alter_id, r.type, r.type_name,
         r.voucher_no, r.voucher_date, r.party_name, r.party_gstin, r.buyer_order_no, r.amount,
         r.is_cancelled, r.is_optional, r.payload, r.state, v_now, v_now, v_now,
         case when r.state in ('tombstoned', 'reversed') then v_now end
    from jsonb_to_recordset(p_rows) as r(id uuid, guid text, alter_id bigint, type text,
           type_name text, voucher_no text, voucher_date date, party_name text, party_gstin text,
           buyer_order_no text, amount numeric, is_cancelled boolean, is_optional boolean,
           payload jsonb, state text)
   where r.type in ('sales', 'receipt', 'credit_note')
  on conflict (guid) do update
     set alter_id = excluded.alter_id, connector_id = excluded.connector_id,
         type = excluded.type, type_name = excluded.type_name, voucher_no = excluded.voucher_no,
         voucher_date = excluded.voucher_date, party_name = excluded.party_name,
         party_gstin = excluded.party_gstin, buyer_order_no = excluded.buyer_order_no,
         amount = excluded.amount, is_cancelled = excluded.is_cancelled,
         is_optional = excluded.is_optional, payload_json = excluded.payload_json,
         state = excluded.state,
         state_changed_at = case when v.state = excluded.state then v.state_changed_at
                                 else excluded.state_changed_at end,
         updated_at = excluded.updated_at,
         deleted_at = case when excluded.state in ('tombstoned', 'reversed')
                           then coalesce(v.deleted_at, excluded.updated_at) end
   where v.alter_id < excluded.alter_id;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;
  insert into public.tally_purchase_vouchers as v
    (id, entity_id, tally_company, connector_id, guid, alter_id, type, type_name, voucher_no,
     voucher_date, party_name, party_gstin, buyer_order_no, amount, is_cancelled, is_optional,
     payload_json, state, state_changed_at, received_at, updated_at, deleted_at)
  select r.id, p_entity, p_company, app.user_id(), r.guid, r.alter_id, r.type, r.type_name,
         r.voucher_no, r.voucher_date, r.party_name, r.party_gstin, r.buyer_order_no, r.amount,
         r.is_cancelled, r.is_optional, r.payload, r.state, v_now, v_now, v_now,
         case when r.state in ('tombstoned', 'reversed') then v_now end
    from jsonb_to_recordset(p_rows) as r(id uuid, guid text, alter_id bigint, type text,
           type_name text, voucher_no text, voucher_date date, party_name text, party_gstin text,
           buyer_order_no text, amount numeric, is_cancelled boolean, is_optional boolean,
           payload jsonb, state text)
   where r.type in ('purchase', 'debit_note')
  on conflict (guid) do update
     set alter_id = excluded.alter_id, connector_id = excluded.connector_id,
         type = excluded.type, type_name = excluded.type_name, voucher_no = excluded.voucher_no,
         voucher_date = excluded.voucher_date, party_name = excluded.party_name,
         party_gstin = excluded.party_gstin, buyer_order_no = excluded.buyer_order_no,
         amount = excluded.amount, is_cancelled = excluded.is_cancelled,
         is_optional = excluded.is_optional, payload_json = excluded.payload_json,
         state = excluded.state,
         state_changed_at = case when v.state = excluded.state then v.state_changed_at
                                 else excluded.state_changed_at end,
         updated_at = excluded.updated_at,
         deleted_at = case when excluded.state in ('tombstoned', 'reversed')
                           then coalesce(v.deleted_at, excluded.updated_at) end
   where v.alter_id < excluded.alter_id;
  get diagnostics v_n = row_count;
  return v_count + v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_vouchers_write(smallint, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_vouchers_write(smallint, text, jsonb) to app_user;
--> statement-breakpoint

-- 8. A batch's ledgers: the newest AlterID of a GUID wins; a GUID of another company is refused.
create or replace function app.tally_ledgers_write(p_entity smallint, p_company text, p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_n integer;
begin
  perform app.tally_require_connector(p_entity, p_company);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'the rows are not a batch' using errcode = '23514';
  end if;
  if exists (
       select 1 from jsonb_to_recordset(p_rows) as r(guid text)
        where exists (select 1 from public.tally_ledgers l
                       where l.guid = r.guid
                         and (l.entity_id <> p_entity or l.tally_company <> p_company))) then
    raise exception 'a ledger belongs to another company'
      using errcode = '23505', constraint = 'tally_ledgers_guid_unique';
  end if;
  insert into public.tally_ledgers as l
    (id, entity_id, tally_company, connector_id, guid, alter_id, name, parent, gstin,
     opening_balance, closing_balance, as_of, received_at, updated_at)
  select r.id, p_entity, p_company, app.user_id(), r.guid, r.alter_id, r.name, r.parent, r.gstin,
         r.opening_balance, r.closing_balance, r.as_of, v_now, v_now
    from jsonb_to_recordset(p_rows) as r(id uuid, guid text, alter_id bigint, name text,
           parent text, gstin text, opening_balance numeric, closing_balance numeric, as_of date)
  on conflict (guid) do update
     set alter_id = excluded.alter_id, connector_id = excluded.connector_id,
         name = excluded.name, parent = excluded.parent, gstin = excluded.gstin,
         opening_balance = excluded.opening_balance, closing_balance = excluded.closing_balance,
         as_of = excluded.as_of, updated_at = excluded.updated_at
   where l.alter_id < excluded.alter_id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_ledgers_write(smallint, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_ledgers_write(smallint, text, jsonb) to app_user;
--> statement-breakpoint

-- 8a. Party ledger balances sent with the daily snapshot: a ledger's closing balance changes when a
--     voucher posts, with no new AlterID, so the batches never carry it. Each known ledger of the
--     company takes the balance with its date, unless it already holds a later one; an unknown
--     GUID waits for its batch. Answers how many changed.
create or replace function app.tally_ledger_balances_write(p_entity smallint, p_company text,
                                                           p_rows jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform app.tally_require_connector(p_entity, p_company);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'the balances are not a list' using errcode = '23514';
  end if;
  update public.tally_ledgers l
     set closing_balance = r.closing_balance, as_of = r.as_of, updated_at = pg_catalog.now()
    from jsonb_to_recordset(p_rows) as r(guid text, closing_balance numeric, as_of date)
   where l.guid = r.guid and l.entity_id = p_entity and l.tally_company = p_company
     and l.as_of <= r.as_of;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_ledger_balances_write(smallint, text, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_ledger_balances_write(smallint, text, jsonb) to app_user;
--> statement-breakpoint

-- 9. A daily snapshot's summary, written by the company's connector, with the GUIDs Tally holds
--    and the BOS lacks (the review queue's "missing in the BOS"); a newer snapshot supersedes the
--    company's held ones, so a person confirms only the latest picture.
create or replace function app.tally_snapshot_write(
  p_id uuid, p_entity smallint, p_company text, p_as_of timestamptz, p_from_date date,
  p_guid_count integer, p_live integer, p_tombstoned integer, p_missing integer,
  p_reappeared integer, p_state text, p_held_guids text[], p_missing_guids text[])
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_connector(p_entity, p_company);
  if p_state not in ('applied', 'held') then
    raise exception 'a snapshot starts applied or held' using errcode = '23514';
  end if;
  update public.tally_snapshots s set state = 'superseded', held_guids = '{}'
   where s.entity_id = p_entity and s.tally_company = p_company and s.state = 'held';
  insert into public.tally_snapshots
    (id, entity_id, tally_company, connector_id, as_of, from_date, guid_count, live, tombstoned,
     missing, reappeared, state, held_guids, missing_guids)
  values (p_id, p_entity, p_company, app.user_id(), p_as_of, p_from_date, p_guid_count, p_live,
          p_tombstoned, p_missing, p_reappeared, p_state, coalesce(p_held_guids, '{}'),
          coalesce(p_missing_guids, '{}'));
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_snapshot_write(uuid, smallint, text, timestamptz, date, integer, integer, integer, integer, integer, text, text[], text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_snapshot_write(uuid, smallint, text, timestamptz, date, integer, integer, integer, integer, integer, text, text[], text[]) to app_user;
--> statement-breakpoint

-- 10. A held snapshot, for the person confirming it: its company and the GUIDs it would remove.
create or replace function app.tally_snapshot_held(p_snapshot uuid)
  returns table (entity_id smallint, tally_company text, as_of timestamptz, state text,
                 held_guids text[])
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (app.request_is_person() and app.has_perm('finance.recon.write:entity')) then
    raise exception 'finance.recon.write is required' using errcode = '42501';
  end if;
  return query
    select s.entity_id, s.tally_company, s.as_of, s.state, s.held_guids
      from public.tally_snapshots s
     where s.id = p_snapshot
       and s.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_snapshot_held(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_snapshot_held(uuid) to app_user;
--> statement-breakpoint

-- 11. Tombstones: each named voucher of the snapshot's company still live and stored no later
--     than the snapshot was taken becomes a tombstone, and one row is appended per voucher. Run
--     by the connector for the snapshot it has just written (applied), or by a person with
--     finance.recon.write confirming a held one, which is then confirmed.
create or replace function app.tally_tombstone(p_snapshot uuid, p_guids text[], p_new_ids uuid[])
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_snap public.tally_snapshots;
  v_now timestamptz := pg_catalog.now();
  v_n integer;
begin
  select * into v_snap from public.tally_snapshots s where s.id = p_snapshot for update;
  if not found then
    raise exception 'no such snapshot' using errcode = '42501';
  end if;
  if app.has_perm('tally.connector.sync:entity') then
    perform app.tally_require_connector(v_snap.entity_id, v_snap.tally_company);
    if v_snap.state <> 'applied' or v_snap.connector_id <> app.user_id() then
      raise exception 'only the snapshot just recorded is applied' using errcode = '42501';
    end if;
  elsif app.request_is_person() and app.has_perm('finance.recon.write:entity')
        and v_snap.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])) then
    if v_snap.state <> 'held' then
      raise exception 'the snapshot is no longer waiting'
        using errcode = '40001', constraint = 'tally_snapshot_not_held';
    end if;
  else
    raise exception 'finance.recon.write is required' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_guids, '{}')) > cardinality(coalesce(p_new_ids, '{}'::uuid[])) then
    raise exception 'an id is missing for a tombstone' using errcode = '23514';
  end if;
  with gone as (
    update public.tally_vouchers v
       set state = 'tombstoned', state_changed_at = v_now, deleted_at = v_now, updated_at = v_now
     where v.entity_id = v_snap.entity_id and v.tally_company = v_snap.tally_company
       and v.guid = any (p_guids) and v.state not in ('tombstoned', 'reversed')
       and v.received_at <= v_snap.as_of
    returning v.guid, v.type
  ), gone_purchases as (
    update public.tally_purchase_vouchers v
       set state = 'tombstoned', state_changed_at = v_now, deleted_at = v_now, updated_at = v_now
     where v.entity_id = v_snap.entity_id and v.tally_company = v_snap.tally_company
       and v.guid = any (p_guids) and v.state not in ('tombstoned', 'reversed')
       and v.received_at <= v_snap.as_of
    returning v.guid, v.type
  ), every_gone as (
    select g.guid, g.type, (row_number() over (order by g.guid))::int as n
      from (select * from gone union all select * from gone_purchases) g
  )
  insert into public.tally_voucher_tombstones
    (id, entity_id, voucher_guid, voucher_type, snapshot_id, detected_at)
  select p_new_ids[g.n], v_snap.entity_id, g.guid, g.type, v_snap.id, v_now from every_gone g;
  get diagnostics v_n = row_count;
  if v_snap.state = 'held' then
    update public.tally_snapshots s
       set state = 'confirmed', held_guids = '{}', tombstoned = v_n, confirmed_at = v_now,
           confirmed_by = app.user_id()
     where s.id = v_snap.id;
  end if;
  return v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_tombstone(uuid, text[], uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_tombstone(uuid, text[], uuid[]) to app_user;
--> statement-breakpoint

-- 12. The heartbeat: the connector's version, Tally's, its outbox depth and, for each company it
--     names that is mapped to it, whether Tally answered and its last AlterID. A name not mapped
--     is left out. Answers how many mapped companies it named.
create or replace function app.tally_heartbeat_write(p_version text, p_tally_version text,
                                                     p_queue_depth integer, p_companies jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_n integer;
begin
  perform app.tally_require_connector(null, null);
  if jsonb_typeof(p_companies) <> 'array' or jsonb_array_length(p_companies) > 50 then
    raise exception 'the companies are not a list' using errcode = '23514';
  end if;
  update public.tally_connectors c
     set connector_version = p_version, tally_version = p_tally_version,
         queue_depth = p_queue_depth, last_heartbeat_at = v_now, updated_by = app.user_id()
   where c.id = app.user_id();
  update public.tally_connector_companies m
     set reachable = r.reachable, reported_alter_id = r.last_alter_id, reported_at = v_now
    from jsonb_to_recordset(p_companies) as r(name text, last_alter_id bigint, reachable boolean)
   where m.connector_id = app.user_id() and m.tally_company = r.name;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_heartbeat_write(text, text, integer, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_heartbeat_write(text, text, integer, jsonb) to app_user;
--> statement-breakpoint

-- 13. Admin › Integrations › Tally (admin.integrations.write, an Executive in person): register a
--     connector as a principal of its own, map and unmap companies of the request, rotate a key
--     (both valid until the old one is retired) and revoke the connector, which frees its
--     companies. Only a key's SHA-256 is ever written.
create or replace function app.tally_require_admin() returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.request_is_person() and app.has_perm('admin.integrations.write:all')) then
    raise exception 'admin.integrations.write is required' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_require_admin() from public, readonly_reporter;
--> statement-breakpoint
create or replace function app.tally_connector_register(p_id uuid, p_name text, p_key_hash text,
                                                        p_key_hint text)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_admin();
  insert into public.principals (id, kind, display_name, created_by, updated_by)
    values (p_id, 'system', p_name, app.user_id(), app.user_id());
  insert into public.tally_connectors (id, name, key_hash, key_hint, created_by, updated_by)
    values (p_id, p_name, p_key_hash, p_key_hint, app.user_id(), app.user_id());
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_register(uuid, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_register(uuid, text, text, text) to app_user;
--> statement-breakpoint
create or replace function app.tally_connector_map(p_connector uuid, p_company text, p_entity smallint)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_admin();
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tally_connectors c
                  where c.id = p_connector and c.revoked_at is null) then
    raise exception 'the connector is revoked'
      using errcode = '40001', constraint = 'tally_connector_revoked';
  end if;
  insert into public.tally_connector_companies (connector_id, tally_company, entity_id, created_by)
    values (p_connector, p_company, p_entity, app.user_id());
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_map(uuid, text, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_map(uuid, text, smallint) to app_user;
--> statement-breakpoint
create or replace function app.tally_connector_unmap(p_connector uuid, p_entity smallint)
  returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform app.tally_require_admin();
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  delete from public.tally_connector_companies m
   where m.connector_id = p_connector and m.entity_id = p_entity;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_unmap(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_unmap(uuid, smallint) to app_user;
--> statement-breakpoint
create or replace function app.tally_connector_rotate(p_connector uuid, p_next_hash text,
                                                      p_next_hint text)
  returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_admin();
  update public.tally_connectors c
     set next_key_hash = p_next_hash, next_key_hint = p_next_hint, updated_by = app.user_id()
   where c.id = p_connector and c.revoked_at is null;
  if not found then
    raise exception 'the connector is revoked'
      using errcode = '40001', constraint = 'tally_connector_revoked';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_rotate(uuid, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_rotate(uuid, text, text) to app_user;
--> statement-breakpoint
create or replace function app.tally_connector_retire_key(p_connector uuid) returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_admin();
  update public.tally_connectors c
     set key_hash = c.next_key_hash, key_hint = c.next_key_hint, next_key_hash = null,
         next_key_hint = null, key_rotated_at = pg_catalog.now(), updated_by = app.user_id()
   where c.id = p_connector and c.revoked_at is null and c.next_key_hash is not null;
  if not found then
    raise exception 'no new key waits'
      using errcode = '40001', constraint = 'tally_connector_no_next_key';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_retire_key(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_retire_key(uuid) to app_user;
--> statement-breakpoint
create or replace function app.tally_connector_revoke(p_connector uuid) returns void
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.tally_require_admin();
  update public.tally_connectors c
     set revoked_at = pg_catalog.now(), revoked_by = app.user_id(), next_key_hash = null,
         next_key_hint = null, updated_by = app.user_id()
   where c.id = p_connector and c.revoked_at is null;
  if not found then
    raise exception 'the connector is revoked'
      using errcode = '40001', constraint = 'tally_connector_revoked';
  end if;
  delete from public.tally_connector_companies m where m.connector_id = p_connector;
  update public.principals p set archived_at = pg_catalog.now(), updated_by = app.user_id()
   where p.id = p_connector;
end
$$;
--> statement-breakpoint
revoke execute on function app.tally_connector_revoke(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.tally_connector_revoke(uuid) to app_user;
