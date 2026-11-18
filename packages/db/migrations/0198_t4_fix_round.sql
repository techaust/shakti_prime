-- T4 fix round (docs/03-roadmap-appendix/phase2.md §7.4).
--
-- 1. A company's dial phone belongs to one person at most, since the IVR's incoming call rings, and
--    pops on the screen of, whoever holds it: the unique index follows in the next migration. A
--    phone two or more people of one company hold today rang nobody (app.inbound_call_answerer()
--    found two), and nobody can say whose it is, so it is cleared for all of them; each sets their
--    own again on their profile.
update public.caller_profiles cp
   set dial_phone_e164 = null
 where cp.dial_phone_e164 is not null
   and exists (select 1 from public.caller_profiles other
                where other.entity_id = cp.entity_id
                  and other.dial_phone_e164 = cp.dial_phone_e164
                  and other.id <> cp.id);
--> statement-breakpoint

-- 2. The person the IVR rings, with how many people of the company hold the phone, so the platform
--    can say when it found two (none rung). Replaces 0190's one-column answer.
drop function app.inbound_call_answerer(smallint, text);
--> statement-breakpoint
create function app.inbound_call_answerer(p_entity smallint, p_phone text)
  returns table (user_id uuid, holders integer)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_people uuid[];
begin
  perform app.require_calls_process(p_entity);
  if p_phone is null then
    return query select null::uuid, 0;
    return;
  end if;
  select coalesce(pg_catalog.array_agg(distinct cp.user_id), '{}') into v_people
    from public.caller_profiles cp
    join public.users u on u.id = cp.user_id and u.status = 'active'
   where cp.entity_id = p_entity
     and cp.dial_phone_e164 = p_phone
     and exists (select 1 from public.user_entity_roles uer
                  where uer.user_id = cp.user_id and uer.entity_id = p_entity);
  return query select case when pg_catalog.cardinality(v_people) = 1 then v_people[1] end,
                      pg_catalog.cardinality(v_people);
end
$$;
--> statement-breakpoint
revoke execute on function app.inbound_call_answerer(smallint, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.inbound_call_answerer(smallint, text) to app_user;
--> statement-breakpoint

-- 3. The Realtime wake-up, honestly reported. Supabase's realtime.send() swallows its own failure
--    (it raises a warning and returns), so the message row it writes is the proof it was sent.
--    app.ringing_wake() sends the person's message (topic user:{id}, event ringing, the call's ids
--    only) through the given function and counts such messages before and after: 'sent' when one
--    more is there, else 'failed' (a failure to read them back is 'failed' too, with a warning).
--    It is the owner's alone (no role executes it): app.signal_ringing() calls it with Supabase's
--    realtime.send() and realtime.messages after its checks, and the suites call it as the owner
--    with a stand-in of both, since the local image's realtime schema is not the migrator's to
--    create in.
create function app.ringing_wake(p_send regprocedure, p_messages regclass, p_entity smallint,
                                 p_user uuid, p_call uuid)
  returns text
  language plpgsql volatile set search_path = '' as $$
declare
  v_topic text := 'user:' || p_user::text;
  v_event text := 'ringing';
  v_payload jsonb := pg_catalog.jsonb_build_object('providerCallId', p_call, 'entityId', p_entity);
  v_send text;
  v_count text;
  v_before bigint;
  v_after bigint;
begin
  select pg_catalog.format('select %I.%I($1, $2, $3, true)', n.nspname, p.proname)
    into strict v_send
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where p.oid = p_send;
  -- Supabase's index on the messages (inserted_at desc, topic) for private broadcasts, and the
  -- partition of the day; the default now() of a timestamp column is the session's local time.
  v_count := pg_catalog.format(
    'select pg_catalog.count(*) from %s m where m.topic = $1 and m.event = $2 and m.payload @> $3'
    ' and m.extension = ''broadcast'' and m.private'
    ' and m.inserted_at >= localtimestamp - interval ''1 minute''', p_messages);
  begin
    execute v_count into v_before using v_topic, v_event, v_payload;
    execute v_send using v_payload, v_event, v_topic;
    execute v_count into v_after using v_topic, v_event, v_payload;
  exception when others then
    raise warning 'the wake-up on % was not confirmed: %', v_topic, sqlerrm;
    return 'failed';
  end;
  return case when v_after > v_before then 'sent' else 'failed' end;
end
$$;
--> statement-breakpoint
revoke execute on function app.ringing_wake(regprocedure, regclass, smallint, uuid, uuid) from public, readonly_reporter, app_user;
--> statement-breakpoint

-- 4. app.signal_ringing() (0191) is a write: it runs only inside a command's read-write
--    transaction (calls.ringing.signal), never a read's, where the message could not be written.
--    It wakes the person the call rings, on their own private channel user:{id}, with the call's
--    ids only: 'sent', 'failed' (Realtime did not take the message) or 'unavailable' (a database
--    with no Realtime: the local stack and CI).
drop function app.signal_ringing(smallint, uuid);
--> statement-breakpoint
create function app.signal_ringing(p_entity smallint, p_user uuid, p_call uuid)
  returns text
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_send regprocedure;
  v_messages regclass;
begin
  perform app.require_calls_process(p_entity);
  if pg_catalog.current_setting('transaction_read_only') = 'on' then
    raise exception 'the wake-up is written by a command, never a read'
      using errcode = 'read_only_sql_transaction';
  end if;
  if p_user is null
     or not exists (select 1 from public.user_entity_roles uer
                     where uer.user_id = p_user and uer.entity_id = p_entity) then
    raise exception 'the person rung works in the company' using errcode = 'check_violation';
  end if;
  if p_call is null
     or not exists (select 1 from public.provider_calls pc
                     where pc.id = p_call and pc.entity_id = p_entity and pc.caller_id = p_user
                       and pc.direction = 'inbound' and pc.series = 'ivr') then
    raise exception 'the call rings the person' using errcode = 'check_violation';
  end if;
  v_send := pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)');
  v_messages := pg_catalog.to_regclass('realtime.messages');
  if v_send is null or v_messages is null then
    return 'unavailable';
  end if;
  return app.ringing_wake(v_send, v_messages, p_entity, p_user, p_call);
end
$$;
--> statement-breakpoint
revoke execute on function app.signal_ringing(smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.signal_ringing(smallint, uuid, uuid) to app_user;
