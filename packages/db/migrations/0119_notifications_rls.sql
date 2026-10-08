-- Notifications (PRD RPT-04, docs/design/phase1.md §8.1, docs/DATABASE.md §6.9): a person's own
-- notices, notification settings and browsers, the platform-only permission of the notify worker
-- and its scan, the definers through which the worker finds who a notice is for and writes it,
-- and routed work in the Agent Inbox for an enquiry a colleague's customer brought.
--
-- A person reads and marks read only their own notices, in the request's companies; nobody else,
-- the reporting role included, reads them. The notify worker (system:workers, notifications.send)
-- holds no grant on the tables: it reads tasks, quotes, leads, settings and browsers and writes
-- notices only through the definers below, which check the permission and the company in their
-- body and answer ids and codes.

-- 1. The worker's permission is platform-only, like crm.duplicates.scan (0113).
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send']::text[]
$$;
--> statement-breakpoint

-- 2. notifications: the person's own rows in the request's companies; the read time is the one
--    column a request changes.
alter table notifications enable row level security;
--> statement-breakpoint
alter table notifications force row level security;
--> statement-breakpoint
create policy notifications_read on notifications for select to app_user, app_reader using (
  user_id = (select app.user_id())
  and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy notifications_update on notifications for update to app_user
  using (user_id = (select app.user_id())
         and entity_id = any ((select app.entity_ids())::int[]))
  with check (user_id = (select app.user_id())
              and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
revoke all on notifications from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on notifications to app_user, app_reader;
--> statement-breakpoint
grant update (read_at) on notifications to app_user;
--> statement-breakpoint

-- 3. notification_preferences: a person's own rows, whatever company they work in, written only
--    by a person (never an agent or the system principal).
create trigger set_updated_at before update on notification_preferences
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table notification_preferences enable row level security;
--> statement-breakpoint
alter table notification_preferences force row level security;
--> statement-breakpoint
create policy notification_preferences_read on notification_preferences for select
  to app_user, app_reader using (user_id = (select app.user_id()));
--> statement-breakpoint
create policy notification_preferences_insert on notification_preferences for insert to app_user
  with check (user_id = (select app.user_id())
              and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
                          and coalesce(current_setting('app.role', true), '') not like 'system:%'));
--> statement-breakpoint
create policy notification_preferences_update on notification_preferences for update to app_user
  using (user_id = (select app.user_id()))
  with check (user_id = (select app.user_id()));
--> statement-breakpoint
revoke all on notification_preferences from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on notification_preferences to app_user;
--> statement-breakpoint
grant update (in_app, push, quiet_from, quiet_to, updated_at) on notification_preferences to app_user;
--> statement-breakpoint
grant select on notification_preferences to app_reader;
--> statement-breakpoint

-- 4. push_subscriptions: a person's own browsers, read and removed by them; added through
--    app.claim_push_subscription() (below), which also takes a browser over from whoever used it
--    before, and removed by the worker when the push service says it is gone.
alter table push_subscriptions enable row level security;
--> statement-breakpoint
alter table push_subscriptions force row level security;
--> statement-breakpoint
create policy push_subscriptions_read on push_subscriptions for select to app_user, app_reader
  using (user_id = (select app.user_id()));
--> statement-breakpoint
create policy push_subscriptions_delete on push_subscriptions for delete to app_user
  using (user_id = (select app.user_id()));
--> statement-breakpoint
revoke all on push_subscriptions from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, delete on push_subscriptions to app_user;
--> statement-breakpoint
grant select on push_subscriptions to app_reader;
--> statement-breakpoint

-- 5. Shared checks of the definers below, run as their owner: the caller may send notices in the
--    company, and a person may receive one there (an active user with a role in the company).
create or replace function app.require_notice_sender(p_entity smallint) returns void
  language plpgsql stable set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('notifications.send:entity') then
    raise exception 'notifications.send is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.require_notice_sender(smallint) from public, readonly_reporter;
--> statement-breakpoint
create or replace function app.notice_recipient_ok(p_user uuid, p_entity smallint) returns boolean
  language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = p_user
       and u.status = 'active'
       and exists (select 1 from public.user_entity_roles uer
                    where uer.user_id = u.id and uer.entity_id = p_entity))
$$;
--> statement-breakpoint
revoke execute on function app.notice_recipient_ok(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint

-- 6. Who an event's notice is for. The lead an assignment names: its customer and its owner now.
create or replace function app.notice_lead(p_entity smallint, p_opportunity uuid)
  returns table (account_id uuid, owner_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select o.account_id, o.owner_id
      from public.opportunities o
     where o.id = p_opportunity and o.entity_id = p_entity and o.archived_at is null;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_lead(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_lead(smallint, uuid) to app_user;
--> statement-breakpoint

-- The owners of a duplicate card's leads in its company: the two leads of a lead pair, or the
-- open and nurtured leads of either customer of a customer pair; one row per owner, with a lead
-- of theirs and its customer, for the notice's link.
create or replace function app.notice_duplicate_owners(p_entity smallint, p_candidate uuid)
  returns table (user_id uuid, account_id uuid, opportunity_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select distinct on (l.owner_id) l.owner_id, l.account_id, l.id
      from public.duplicate_candidates c
      join public.opportunities l
        on l.entity_id = c.entity_id
       and l.archived_at is null
       and ((c.kind = 'lead' and l.id in (c.opportunity_id, c.other_opportunity_id))
         or (c.kind = 'customer' and l.account_id in (c.account_id, c.other_account_id)
             and l.state in ('open', 'nurture')))
     where c.id = p_candidate
       and c.entity_id = p_entity
       and c.state = 'open'
       and l.owner_id is not null
       and app.notice_recipient_ok(l.owner_id, p_entity)
     order by l.owner_id, l.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_duplicate_owners(smallint, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_duplicate_owners(smallint, uuid) to app_user;
--> statement-breakpoint

-- 7. The scan's finds in one company, each with the reason it would be told for (dedupe_key), and
--    only those nobody was told about yet for that reason, so a repeated scan finds nothing twice
--    and every batch moves on. Each looks back no further than p_since, so a first run does not
--    tell people about everything that ever fell due.
--    Callbacks and nurture calls falling due, for their person.
create or replace function app.notice_due_calls(p_entity smallint, p_since timestamptz, p_limit integer)
  returns table (task_id uuid, user_id uuid, opportunity_id uuid, account_id uuid, dedupe_key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select f.id, f.assignee_id, f.opportunity_id, f.account_id, f.k
      from (select t.id, t.assignee_id, t.opportunity_id, t.account_id, t.due_at,
                   'call_due:' || t.id::text || ':'
                     || floor(extract(epoch from t.due_at))::bigint::text as k
              from public.tasks t
             where t.entity_id = p_entity
               and t.state = 'open'
               and t.kind in ('callback', 'nurture')
               and t.due_at <= now()
               and t.due_at > p_since) f
     where app.notice_recipient_ok(f.assignee_id, p_entity)
       and not exists (select 1 from public.notifications n
                        where n.entity_id = p_entity and n.dedupe_key = f.k)
     order by f.due_at, f.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_due_calls(smallint, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_due_calls(smallint, timestamptz, integer) to app_user;
--> statement-breakpoint

--    Draft and sent quotes that lapse before p_until, for the owner of their lead.
create or replace function app.notice_expiring_quotes(p_entity smallint, p_until timestamptz, p_limit integer)
  returns table (quote_id uuid, user_id uuid, opportunity_id uuid, account_id uuid, dedupe_key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select f.id, f.owner_id, f.opportunity_id, f.account_id, f.k
      from (select q.id, o.owner_id, q.opportunity_id, q.account_id, q.valid_until,
                   'quote_expiring:' || q.id::text || ':'
                     || floor(extract(epoch from q.valid_until))::bigint::text as k
              from public.quotes q
              join public.opportunities o on o.id = q.opportunity_id and o.entity_id = q.entity_id
             where q.entity_id = p_entity
               and q.state in ('draft', 'sent')
               and q.valid_until > now()
               and q.valid_until <= p_until
               and o.owner_id is not null) f
     where app.notice_recipient_ok(f.owner_id, p_entity)
       and not exists (select 1 from public.notifications n
                        where n.entity_id = p_entity and n.dedupe_key = f.k)
     order by f.valid_until, f.id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_expiring_quotes(smallint, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_expiring_quotes(smallint, timestamptz, integer) to app_user;
--> statement-breakpoint

--    New leads past their pipeline's first-contact limit and never called, in the queue's first
--    stages (the test of rankedQueue()'s late first call), for each General Manager of the
--    company, once per lead. A pipeline with no limit has no breach. The limit is at most seven
--    days (pipelines_first_contact_sla_check), which bounds the range of leads read.
create or replace function app.notice_late_first_calls(p_entity smallint, p_since timestamptz, p_limit integer)
  returns table (opportunity_id uuid, user_id uuid, account_id uuid, dedupe_key text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select f.id, g.user_id, f.account_id, f.k
      from (select o.id, o.account_id, o.created_at,
                   'first_call_late:' || o.id::text as k
              from public.opportunities o
              join public.pipelines pl on pl.id = o.pipeline_id
              join public.pipeline_stages ps on ps.id = o.stage_id
              left join public.pipeline_stages q
                on q.pipeline_id = o.pipeline_id and q.key = 'qualified' and q.archived_at is null
             where o.entity_id = p_entity
               and o.state = 'open'
               and o.archived_at is null
               and o.created_at > p_since - interval '7 days'
               and ps.kind = 'open'
               and ps.position < coalesce(q.position, 2147483647)
               and pl.first_contact_sla_minutes is not null
               and o.created_at + make_interval(mins => pl.first_contact_sla_minutes) <= now()
               and o.created_at + make_interval(mins => pl.first_contact_sla_minutes) > p_since
               and not exists (select 1 from public.calls c where c.opportunity_id = o.id)) f
      join (select uer.user_id
              from public.user_entity_roles uer
              join public.roles r on r.id = uer.role_id
             where uer.entity_id = p_entity
               and r.key = 'general_manager'
               and app.notice_recipient_ok(uer.user_id, p_entity)) g on true
     where not exists (select 1 from public.notifications n
                        where n.entity_id = p_entity and n.dedupe_key = f.k)
     order by f.created_at, f.id, g.user_id
     limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_late_first_calls(smallint, timestamptz, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_late_first_calls(smallint, timestamptz, integer) to app_user;
--> statement-breakpoint

-- 8. What the people a notice is for chose: their rows of notification settings (a kind with its
--    switches, or no kind with the quiet hours as HH:MM), and their browsers.
create or replace function app.notice_settings(p_entity smallint, p_users uuid[])
  returns table (user_id uuid, type text, in_app boolean, push boolean, quiet_from text, quiet_to text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select np.user_id, np.type, np.in_app, np.push,
           to_char(np.quiet_from, 'HH24:MI'), to_char(np.quiet_to, 'HH24:MI')
      from public.notification_preferences np
     where np.user_id = any (coalesce(p_users, '{}'::uuid[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_settings(smallint, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_settings(smallint, uuid[]) to app_user;
--> statement-breakpoint
create or replace function app.notice_push_targets(p_entity smallint, p_users uuid[])
  returns table (user_id uuid, endpoint text, p256dh text, auth text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select s.user_id, s.endpoint, s.p256dh, s.auth
      from public.push_subscriptions s
     where s.user_id = any (coalesce(p_users, '{}'::uuid[]))
     order by s.user_id, s.created_at;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_push_targets(smallint, uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.notice_push_targets(smallint, uuid[]) to app_user;
--> statement-breakpoint

-- 9. Writes the notices of one company: each for a person who may receive one there, once per
--    person and reason (a notice they already had is left as it is). A kind the person turned off
--    in the centre is written read, so it never counts on the bell and only stops a repeat.
--    Answers the notices it wrote.
create or replace function app.write_notices(p_entity smallint, p_rows jsonb)
  returns table (id uuid, user_id uuid, dedupe_key text)
  language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    insert into public.notifications as n
      (id, user_id, entity_id, type, subject_type, subject_id, payload_json, dedupe_key,
       read_at, channel_sent_json)
    select r.id, r.user_id, p_entity, r.type, r.subject_type, r.subject_id,
           coalesce(r.payload, '{}'::jsonb), r.dedupe_key,
           case when r.in_app then null else now() end,
           pg_catalog.jsonb_build_object('inApp', r.in_app, 'push', r.push)
      from pg_catalog.jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
             id uuid, user_id uuid, type text, subject_type text, subject_id uuid,
             payload jsonb, dedupe_key text, in_app boolean, push text)
     where app.notice_recipient_ok(r.user_id, p_entity)
    on conflict on constraint notifications_user_dedupe_unique do nothing
    returning n.id, n.user_id, n.dedupe_key;
end
$$;
--> statement-breakpoint
revoke execute on function app.write_notices(smallint, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.write_notices(smallint, jsonb) to app_user;
--> statement-breakpoint

-- 10. What became of the pushes: each notice's outcome, the browsers the push service says are
--     gone (removed) and the ones that took a push (their last good time). Answers how many
--     notices it recorded and browsers it removed.
create or replace function app.record_notice_push(
  p_entity smallint, p_outcomes jsonb, p_gone text[], p_delivered text[]
)
  returns table (recorded integer, removed integer)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_recorded integer;
  v_removed integer;
begin
  perform app.require_notice_sender(p_entity);
  update public.notifications n
     set channel_sent_json = n.channel_sent_json || pg_catalog.jsonb_build_object('push', o.push)
    from pg_catalog.jsonb_to_recordset(coalesce(p_outcomes, '[]'::jsonb)) as o("noticeId" uuid, push text)
   where n.id = o."noticeId" and n.entity_id = p_entity
     and o.push in ('sent', 'held', 'off', 'none', 'failed');
  get diagnostics v_recorded = row_count;
  delete from public.push_subscriptions s where s.endpoint = any (coalesce(p_gone, '{}'::text[]));
  get diagnostics v_removed = row_count;
  update public.push_subscriptions s
     set last_ok_at = now()
   where s.endpoint = any (coalesce(p_delivered, '{}'::text[]));
  return query select v_recorded, v_removed;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_notice_push(smallint, jsonb, text[], text[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_notice_push(smallint, jsonb, text[], text[]) to app_user;
--> statement-breakpoint

-- 11. A person adds this browser: their own from now on, taken over from whoever had it before (a
--     browser shared at a counter), with its keys as the browser gives them now. People only,
--     with profile.write. Answers the subscription's id.
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
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id <> v_user;
  insert into public.push_subscriptions as s (id, user_id, endpoint, p256dh, auth, user_agent)
  values (app.uuid_v7(), v_user, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict on constraint push_subscriptions_endpoint_unique
  do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
  returning s.id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.claim_push_subscription(text, text, text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.claim_push_subscription(text, text, text, text) to app_user;
--> statement-breakpoint

-- 12. Routed work (PRD RPT-04 criterion 2). An enquiry for a customer a colleague looks after in
--     the company goes to that colleague. app.enquiry_holder() answers who: for a known customer,
--     or the live customer with the typed number, related to the company through a relationship
--     the caller may not change; its owner, their team and their name, nothing about the customer.
create or replace function app.enquiry_holder(p_entity smallint, p_account uuid, p_phone text)
  returns table (account_id uuid, owner_id uuid, team_id uuid, owner_name text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = '42501';
  end if;
  if not app.has_perm('crm.lead.write:own') or not app.has_perm('crm.account.write:own') then
    raise exception 'crm.lead.write and crm.account.write are required' using errcode = '42501';
  end if;
  return query
    select ae.account_id, ae.owner_id, ae.team_id, p.display_name
      from public.account_entities ae
      join public.accounts a on a.id = ae.account_id and a.archived_at is null
      join public.principals p on p.id = ae.owner_id
     where ae.entity_id = p_entity
       and ae.owner_id <> app.user_id()
       and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)
       and ((p_account is not null and ae.account_id = p_account)
         or (p_account is null and p_phone is not null and exists (
               select 1
                 from public.contact_phones cp
                 join public.contacts c on c.id = cp.contact_id and c.archived_at is null
                 join public.account_contacts ac on ac.contact_id = cp.contact_id
                where cp.e164 = p_phone and ac.account_id = ae.account_id)))
     order by ae.created_at, ae.account_id
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.enquiry_holder(smallint, uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.enquiry_holder(smallint, uuid, text) to app_user;
--> statement-breakpoint

--     The insert policy's check: the customer is related to the company through the named
--     colleague (and their team), whom the caller may not stand in for. A boolean only.
create or replace function app.customer_held_by(
  p_account uuid, p_entity smallint, p_owner uuid, p_team uuid
)
  returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    return false;
  end if;
  return exists (
    select 1 from public.account_entities ae
      join public.accounts a on a.id = ae.account_id and a.archived_at is null
     where ae.account_id = p_account
       and ae.entity_id = p_entity
       and ae.owner_id = p_owner
       and ae.team_id is not distinct from p_team
       and ae.owner_id <> app.user_id()
       and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id));
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_held_by(uuid, smallint, uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.customer_held_by(uuid, smallint, uuid, uuid) to app_user;
--> statement-breakpoint

--     Only an agent files a suggestion; a person files routed work for the colleague who looks
--     after the customer, holding crm.lead.write and crm.account.write in the company.
drop policy inbox_items_insert on inbox_items;
--> statement-breakpoint
create policy inbox_items_insert on inbox_items for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and state = 'open'
  and ((kind = 'agent_suggestion'
        and (select coalesce(current_setting('app.role', true), '')) like 'agent:%')
    or (kind = 'routed_work'
        and subject_type = 'account'
        and agent_action_id is null
        and (select coalesce(current_setting('app.role', true), '') not like 'agent:%'
                    and coalesce(current_setting('app.role', true), '') not like 'system:%')
        and (select app.has_perm('crm.lead.write:own'))
        and (select app.has_perm('crm.account.write:own'))
        and assignee_id is not null
        and app.customer_held_by(subject_id, entity_id, assignee_id, team_id))));
