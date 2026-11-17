-- T4 screen-pop over Realtime (docs/03-roadmap-appendix/phase2.md §2 question 4, §7.4): once the
-- incoming-call handler holds a ringing call for its person in the key-value store, and only when
-- the screen-pop's transport is Realtime, the platform wakes that person's screens on their own
-- private channel, user:{id}. The message carries nothing: the screen then takes the call from
-- GET /api/v1/calls/ringing as the poll does. Supabase's realtime.send() writes the message; a
-- database without it (the local stack and CI) sends nothing and answers false.
create or replace function app.signal_ringing(p_entity smallint, p_user uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_calls_process(p_entity);
  if p_user is null
     or not exists (select 1 from public.user_entity_roles uer
                     where uer.user_id = p_user and uer.entity_id = p_entity) then
    raise exception 'the person rung works in the company' using errcode = 'check_violation';
  end if;
  if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return false;
  end if;
  execute 'select realtime.send($1, $2, $3, true)'
    using '{}'::jsonb, 'ringing', 'user:' || p_user::text;
  return true;
end
$$;
--> statement-breakpoint
revoke execute on function app.signal_ringing(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.signal_ringing(smallint, uuid) to app_user;
