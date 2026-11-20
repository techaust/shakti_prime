-- G2's Phase 2 alerts (docs/03-roadmap-appendix/phase2.md §8.1): the hourly jobs check tells the
-- owner of failing webhooks and a waiting backlog, a WhatsApp number at Low quality, the
-- portfolio's messaging budget, and AI and voice spend near a cap. The quality, the budget and the
-- AI spend are kept in the key-value store; the counts below are in the database, which the
-- workers principal reads through one definer and no person's grant (ADR 0020).
--
-- app.alert_counts(): `platform.jobs.check:all` only, the jobs check's own platform-only
-- permission, so no person, agent or voice principal may call it (Integration Health reads its
-- figures through its own definers). It answers counts, ids, codes and times, never a payload, a
-- phone number, a message or a name:
-- - `companies`: each company's id and code, and whether it has an active WhatsApp number;
-- - `webhooks`: per provider, the rows failed in the last hour, the rows waiting and how many
--   seconds the oldest has waited (by the database's clock, as the sweep reads it);
-- - `agentCaps`: the daily spend caps set on Admin › Agents for an agent (`agent_configs` rows
--   with no action type), per company or (null) the group;
-- - `voice`: per person with a session today (the day in India, `app.voice_day_start()`), the
--   minutes and the spend in paise; a session still open counts the minutes it has run, at most
--   its own longest length.
create or replace function app.alert_counts()
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_companies jsonb;
  v_webhooks jsonb;
  v_caps jsonb;
  v_voice jsonb;
begin
  if not app.has_perm('platform.jobs.check:all') then
    raise exception 'platform.jobs.check:all is required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'entityId', e.id, 'code', e.code,
           'whatsapp', exists (select 1 from public.entity_channels ec
                                where ec.entity_id = e.id and ec.channel = 'whatsapp'
                                  and ec.is_active)) order by e.id), '[]'::jsonb)
    into v_companies
    from public.entities e;
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', p.provider,
           'failedLastHour', (select count(*)::integer from public.webhook_inbox w
                               where w.provider = p.provider
                                 and w.failed_at >= v_now - interval '1 hour'),
           'waiting', q.waiting,
           'oldestWaitingSeconds',
             case when q.oldest is null then null
                  else greatest(0, pg_catalog.floor(extract(epoch from v_now - q.oldest)))::bigint
             end) order by p.ord), '[]'::jsonb)
    into v_webhooks
    from unnest(array['meta_whatsapp', 'meta_leadgen', 'google_leadform', 'exotel_status',
                      'exotel_incoming', 'livekit']) with ordinality as p(provider, ord)
    cross join lateral (
      select count(*)::integer as waiting, pg_catalog.min(w.received_at) as oldest
        from public.webhook_inbox w
       where w.provider = p.provider and w.processed_at is null and w.failed_at is null) q;
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent', c.agent, 'entityId', c.entity_id, 'capPaise', c.daily_spend_cap_paise)
           order by c.agent, c.entity_id nulls first), '[]'::jsonb)
    into v_caps
    from public.agent_configs c
   where c.agent is not null and c.action_type is null and c.daily_spend_cap_paise is not null;
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', v.user_id, 'minutes', v.minutes, 'spentPaise', v.spent)
           order by v.user_id), '[]'::jsonb)
    into v_voice
    from (select vs.user_id,
                 sum(coalesce(vs.minutes,
                              least(vs.max_minutes, greatest(0, pg_catalog.ceil(
                                extract(epoch from v_now - vs.started_at) / 60.0)::integer))))::integer
                   as minutes,
                 sum(vs.cost_paise)::bigint as spent
            from public.voice_sessions vs
           where vs.started_at >= app.voice_day_start(v_now)
           group by vs.user_id) v;
  return jsonb_build_object('companies', v_companies, 'webhooks', v_webhooks,
                            'agentCaps', v_caps, 'voice', v_voice);
end
$$;
--> statement-breakpoint
revoke execute on function app.alert_counts() from public, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant execute on function app.alert_counts() to app_user, app_reader;
