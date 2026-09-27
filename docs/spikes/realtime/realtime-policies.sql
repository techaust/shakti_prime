-- Realtime authorization for BOS-signed tokens (ADR 0003, docs/ARCHITECTURE.md §8).
--
-- NOT a migration of this repository. Apply it by hand to the hosted Supabase dev project for the
-- Realtime spike (docs/spikes/realtime.md), after the BOS is registered as a third-party auth
-- provider. It becomes a migration only once the spike passes and the Realtime schema is part of
-- the migrated database.
--
-- Channels are private broadcast channels:
--   user:{uuid}              one person's notifications       only that person may listen
--   entity:{id}:queue        an entity's call and work queue  anyone whose token names the entity
--   entity:{id}:board        an entity's boards               anyone whose token names the entity
--
-- Clients only listen. Nothing here lets a token send, and presence is not used: broadcasts are
-- sent after commit by the notify worker (ADR 0005), never by a browser.

begin;

-- The helpers live in their own schema, outside `public`, so the Data API never exposes them.
create schema if not exists bos_realtime;
revoke all on schema bos_realtime from public, anon;
grant usage on schema bos_realtime to authenticated;

-- A token counts only when it is a BOS Realtime token: the audience is checked here as well as by
-- the signature check, so a mobile or voice token (their own audiences) opens no channel.
create or replace function bos_realtime.claims_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'aud') @> '"shakti-realtime"'::jsonb
      and (auth.jwt() ->> 'role') = 'authenticated'
      and jsonb_typeof(auth.jwt() -> 'entity_ids') = 'array',
    false
  )
$$;

-- The entity named by an `entity:{id}:queue` or `entity:{id}:board` topic, or null for any other
-- topic. The pattern is anchored, so `entity:1:queue:x` or `entity:01:queue` name nothing.
create or replace function bos_realtime.topic_entity(topic text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^entity:[1-9][0-9]{0,4}:(queue|board)$'
      then split_part(topic, ':', 2)::int
  end
$$;

revoke all on function bos_realtime.claims_ok() from public, anon, service_role;
revoke all on function bos_realtime.topic_entity(text) from public, anon, service_role;
grant execute on function bos_realtime.claims_ok() to authenticated;
grant execute on function bos_realtime.topic_entity(text) to authenticated;

drop policy if exists bos_user_channel_listen on realtime.messages;
create policy bos_user_channel_listen
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select bos_realtime.claims_ok())
  and (select realtime.topic()) = 'user:' || (select auth.jwt() ->> 'sub')
);

drop policy if exists bos_entity_channel_listen on realtime.messages;
create policy bos_entity_channel_listen
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select bos_realtime.claims_ok())
  and (select bos_realtime.topic_entity((select realtime.topic()))) in (
    select value::int
    from jsonb_array_elements_text((select auth.jwt() -> 'entity_ids'))
  )
);

commit;

-- Checks after applying (run in the SQL editor):
--   select policyname, cmd, roles from pg_policies where schemaname = 'realtime';
--     expect bos_user_channel_listen and bos_entity_channel_listen, select, {authenticated},
--     and no insert policy from this file.
--   select bos_realtime.topic_entity('entity:2:queue');   -- 2
--   select bos_realtime.topic_entity('entity:2:queue:x'); -- null
