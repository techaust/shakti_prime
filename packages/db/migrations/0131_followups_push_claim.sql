-- A person adds this browser (N1 review L4): it becomes theirs only when no one else has it. A
-- browser address another person already holds is refused, whatever keys come with it, so
-- knowing someone's address never moves their alerts to the caller or replaces their keys. The
-- refusal names the address's unique constraint, which the command maps to a plain reason; the
-- person at a shared browser turns the alerts off there and on again, which gives the browser a
-- new address. The caller's own browser is renewed with the keys the browser gives now. People
-- only, with profile.write, as before. Answers the subscription's id.
create or replace function app.claim_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
  returns uuid
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_id uuid;
begin
  if v_user is null or not app.has_perm('profile.write:own')
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
     or coalesce(pg_catalog.current_setting('app.role', true), '') like 'system:%'
     or not exists (select 1 from public.principals p where p.id = v_user and p.kind = 'user') then
    raise exception 'a person with profile.write is required' using errcode = '42501';
  end if;
  -- The conflicting row is locked and changed only when it is the caller's; another person's
  -- row is left as it is and nothing is answered.
  insert into public.push_subscriptions as s (id, user_id, endpoint, p256dh, auth, user_agent)
  values (app.uuid_v7(), v_user, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict on constraint push_subscriptions_endpoint_unique
  do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
     where s.user_id = v_user
  returning s.id into v_id;
  if v_id is null then
    raise exception 'another person receives alerts on this browser'
      using errcode = '23505', constraint = 'push_subscriptions_endpoint_unique';
  end if;
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.claim_push_subscription(text, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.claim_push_subscription(text, text, text, text) to app_user;
