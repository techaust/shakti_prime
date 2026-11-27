-- J1: STATUS on WhatsApp (WA-03) adds the customer's own projects with their current step
-- (docs/03-roadmap-appendix/phase4.md §6.1). Every line of 0201's app.status_summary() is kept: the
-- chat's customer's quotes (sent, accepted or expired) and orders in the chat's company, newest
-- first, five of each, for messaging.process only, nothing for a chat matched to no customer. Its
-- result gains the current step of a project (the first open one, its key and title), so the
-- function is made again with its grants.
drop function app.status_summary(uuid);
--> statement-breakpoint
create function app.status_summary(p_thread uuid)
  returns table (kind text, ref text, state text, grand_total numeric, valid_until timestamptz,
                 created_at timestamptz, step_key text, step_title text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_entity smallint;
  v_account uuid;
begin
  if app.user_id() is null or not app.has_perm('messaging.process:entity') then
    raise exception 'messaging.process is required' using errcode = '42501';
  end if;
  select t.entity_id, t.account_id into v_entity, v_account
    from public.whatsapp_threads t
   where t.id = p_thread and t.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_account is null then
    return;
  end if;
  return query
    (select 'quote'::text, q.quote_no, q.state, q.grand_total, q.valid_until, q.created_at,
            null::text, null::text
       from public.quotes q
      where q.account_id = v_account and q.entity_id = v_entity
        and q.state in ('sent', 'accepted', 'expired')
      order by q.created_at desc, q.id desc
      limit 5)
    union all
    (select 'order'::text, so.so_no, so.state, so.grand_total, null::timestamptz, so.created_at,
            null::text, null::text
       from public.sales_orders so
      where so.account_id = v_account and so.entity_id = v_entity
      order by so.created_at desc, so.id desc
      limit 5)
    union all
    -- A cancelled project is left out: the customer's order shows how it stands.
    (select 'project'::text, p.project_no, p.state, null::numeric, null::timestamptz, p.created_at,
            m.key, m.title
       from public.projects p
       left join lateral (select pm.key, pm.title from public.project_milestones pm
                           where pm.project_id = p.id and pm.state = 'open'
                           order by pm.position limit 1) m on true
      where p.account_id = v_account and p.entity_id = v_entity and p.state <> 'cancelled'
      order by p.created_at desc, p.id desc
      limit 5);
end
$$;
--> statement-breakpoint
revoke execute on function app.status_summary(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.status_summary(uuid) to app_user, app_reader;
