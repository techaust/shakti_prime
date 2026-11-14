-- I1 Lead Ads, lead forms and website ingest (docs/03-roadmap-appendix/phase2.md §6.2, PRD CRM-01
-- and CRM-02): each company's connected forms and sites, the website's ingest keys, the
-- qualification facts a lead carries, and the definers through which the platform (`system:workers`,
-- the platform-only `crm.ingest.run`) makes or attaches a lead from an integration. The platform
-- holds no `crm.*` permission a person may hold (ADR 0020), so every read and write of a lead, a
-- customer and their timeline goes through these definers, each checking `crm.ingest.run` and the
-- request's company.

-- 1. crm.ingest.run is platform-only, like the other workers' grants: 0167's thirteen keys, kept,
--    and this one.
create or replace function app.platform_only_permissions() returns text[]
  language sql immutable set search_path = '' as $$
  select array['files.process', 'imports.process', 'crm.score.refresh', 'crm.duplicates.scan',
               'sales.quote.expire', 'notifications.send', 'knowledge.index',
               'crm.handover.run', 'platform.jobs.check', 'crm.retention.run',
               'webhooks.process', 'crm.dnd.record', 'knowledge.playbook.check',
               'crm.ingest.run']::text[]
$$;
--> statement-breakpoint

-- 2. ingest_sources: read and written by an Executive (crm.sources.write:all) in a company of the
--    request. The sealed Page token is written but never read back by a request role (no select
--    grant on the column); the Lead Ads handler opens it through app.ingest_source_token(). The
--    form's last questions are the platform's to write. An archived connection stays archived, so a
--    form connected again is a new row and what named the old one keeps it. A new row starts live,
--    with no lead seen yet.
create trigger set_updated_at before update on ingest_sources
  for each row execute function app.set_updated_at();
--> statement-breakpoint
create or replace function app.ingest_sources_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'an archived lead source is not changed' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_sources_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger ingest_sources_guard before update on ingest_sources
  for each row execute function app.ingest_sources_guard();
--> statement-breakpoint
alter table ingest_sources enable row level security;
--> statement-breakpoint
alter table ingest_sources force row level security;
--> statement-breakpoint
create policy ingest_sources_read on ingest_sources for select to app_user, app_reader
  using ((select app.has_perm('crm.sources.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy ingest_sources_insert on ingest_sources for insert to app_user
  with check ((select app.has_perm('crm.sources.write:all'))
              and entity_id = any ((select app.entity_ids())::int[])
              and created_by = (select app.user_id())
              and archived_at is null and last_lead_at is null
              and last_questions_json = '[]'::jsonb);
--> statement-breakpoint
create policy ingest_sources_update on ingest_sources for update to app_user
  using ((select app.has_perm('crm.sources.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('crm.sources.write:all'))
              and entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id()));
--> statement-breakpoint
revoke all on ingest_sources from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select (id, entity_id, provider, external_id, name, pipeline_id, field_map_json,
              consent_question_key, consent_text_version, consent_channels, consent_purpose,
              page_token_set, last_questions_json, last_lead_at, archived_at, created_at,
              updated_at, created_by, updated_by)
  on ingest_sources to app_user, app_reader;
--> statement-breakpoint
grant insert on ingest_sources to app_user;
--> statement-breakpoint
grant update (name, pipeline_id, field_map_json, consent_question_key, consent_text_version,
              consent_channels, consent_purpose, page_token_sealed, archived_at, updated_at,
              updated_by)
  on ingest_sources to app_user;
--> statement-breakpoint

-- 3. ingest_keys: made and revoked by an Executive (crm.sources.write:all) in a company of the
--    request. Only the key's SHA-256 is stored, and no request role selects it; the website route
--    finds a key by its hash through app.ingest_key_use(). A revoked key stays revoked.
create or replace function app.ingest_keys_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then
    raise exception 'a revoked key stays revoked' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_keys_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger ingest_keys_guard before update on ingest_keys
  for each row execute function app.ingest_keys_guard();
--> statement-breakpoint
alter table ingest_keys enable row level security;
--> statement-breakpoint
alter table ingest_keys force row level security;
--> statement-breakpoint
create policy ingest_keys_read on ingest_keys for select to app_user, app_reader
  using ((select app.has_perm('crm.sources.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]));
--> statement-breakpoint
create policy ingest_keys_insert on ingest_keys for insert to app_user
  with check ((select app.has_perm('crm.sources.write:all'))
              and entity_id = any ((select app.entity_ids())::int[])
              and created_by = (select app.user_id())
              and revoked_at is null and revoked_by is null and last_used_at is null);
--> statement-breakpoint
create policy ingest_keys_update on ingest_keys for update to app_user
  using ((select app.has_perm('crm.sources.write:all'))
         and entity_id = any ((select app.entity_ids())::int[]))
  with check ((select app.has_perm('crm.sources.write:all'))
              and entity_id = any ((select app.entity_ids())::int[])
              and revoked_by = (select app.user_id()));
--> statement-breakpoint
revoke all on ingest_keys from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select (id, entity_id, label, key_hint, last_used_at, revoked_at, revoked_by, created_at,
              created_by)
  on ingest_keys to app_user, app_reader;
--> statement-breakpoint
grant insert on ingest_keys to app_user;
--> statement-breakpoint
grant update (revoked_at, revoked_by) on ingest_keys to app_user;
--> statement-breakpoint

-- 4. lead_qualifications: a child of opportunities, read with its lead (the EXISTS runs under
--    opportunities_read) and written by whoever may write the lead (app.scope_ok on the lead's
--    owner and team), as the caller. The platform writes a new lead's facts through
--    app.ingest_lead_write().
create trigger set_updated_at before update on lead_qualifications
  for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table lead_qualifications enable row level security;
--> statement-breakpoint
alter table lead_qualifications force row level security;
--> statement-breakpoint
create policy lead_qualifications_read on lead_qualifications for select to app_user, app_reader
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from opportunities o
                      where o.id = lead_qualifications.opportunity_id));
--> statement-breakpoint
create policy lead_qualifications_insert on lead_qualifications for insert to app_user
  with check (entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id())
              and exists (select 1 from opportunities o
                           where o.id = lead_qualifications.opportunity_id
                             and o.entity_id = lead_qualifications.entity_id
                             and o.archived_at is null
                             and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)));
--> statement-breakpoint
create policy lead_qualifications_update on lead_qualifications for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and exists (select 1 from opportunities o
                      where o.id = lead_qualifications.opportunity_id
                        and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and updated_by = (select app.user_id())
              and exists (select 1 from opportunities o
                           where o.id = lead_qualifications.opportunity_id
                             and o.entity_id = lead_qualifications.entity_id
                             and o.archived_at is null
                             and app.scope_ok('crm.lead.write', o.owner_id, o.team_id)));
--> statement-breakpoint
revoke all on lead_qualifications from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select, insert on lead_qualifications to app_user;
--> statement-breakpoint
grant update (pump_depth_ft, required_hp, monthly_bill_rupees, roof_area_sq_ft, sanctioned_load_kw,
              discom_consumer_no, updated_at, updated_by)
  on lead_qualifications to app_user;
--> statement-breakpoint
grant select on lead_qualifications to app_reader;
--> statement-breakpoint

-- 5. The platform's check, shared by the definers below: crm.ingest.run, and a company of the
--    request when one is named.
create or replace function app.require_ingest(p_entity smallint) returns void
  language plpgsql stable set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.ingest.run:entity') then
    raise exception 'crm.ingest.run is required' using errcode = '42501';
  end if;
  if p_entity is not null and not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
end
$$;
--> statement-breakpoint
revoke execute on function app.require_ingest(smallint) from public, readonly_reporter;
--> statement-breakpoint

-- 6. A connected form, Page or site by its provider and id, in a company of the request: what a
--    handler needs to land a lead (its company, pipeline, segment, field map and consent question),
--    and whether a Page token is recorded. Never the token itself.
create or replace function app.ingest_source(p_provider text, p_external_id text)
  returns table (source_id uuid, entity_id smallint, pipeline_id uuid, pipeline_key text,
                 segment text, field_map_json jsonb, consent_question_key text,
                 consent_text_version text, consent_channels text[], consent_purpose text,
                 has_page_token boolean)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_ingest(null);
  return query
    select s.id, s.entity_id, s.pipeline_id, p.key, p.segment, s.field_map_json,
           s.consent_question_key, s.consent_text_version, s.consent_channels, s.consent_purpose,
           s.page_token_sealed is not null
      from public.ingest_sources s
      join public.pipelines p on p.id = s.pipeline_id
     where s.provider = p_provider
       and s.external_id = p_external_id
       and s.archived_at is null
       and s.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_source(text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_source(text, text) to app_user;
--> statement-breakpoint

-- 7. The sealed Page token of a live Meta connection in a company of the request, for the Lead Ads
--    handler to open with the field cipher; nobody else reads it.
create or replace function app.ingest_source_token(p_source uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_token jsonb;
begin
  perform app.require_ingest(null);
  select s.page_token_sealed into v_token
    from public.ingest_sources s
   where s.id = p_source
     and s.provider = 'meta_leadgen'
     and s.archived_at is null
     and s.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  return v_token;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_source_token(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_source_token(uuid) to app_user;
--> statement-breakpoint

-- 8. The website route's key: the live key with this SHA-256 in a company of the request, stamped
--    as used now. No row for an unknown or revoked key.
create or replace function app.ingest_key_use(p_hash text)
  returns table (key_id uuid, entity_id smallint)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_ingest(null);
  return query
    update public.ingest_keys k
       set last_used_at = pg_catalog.now()
     where k.key_hash = p_hash
       and k.revoked_at is null
       and k.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
    returning k.id, k.entity_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_key_use(text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_key_use(text) to app_user;
--> statement-breakpoint

-- 9. Who an integration's lead might be for in a company: the customer of the company with this
--    number on a live contact (ADR 0008), the colleague who looks after them there and whether they
--    still work on leads in it, and the customer's lead of the segment an enquiry joins (an open
--    lead with activity since p_since, else a lead in nurture), as `crm.lead.create` finds them for
--    a person (`openEnquiryLead`). A customer with such a lead comes first, then the oldest
--    relationship. Ids and a language only; no name or number.
create or replace function app.ingest_customer(p_entity smallint, p_phone text, p_segment text,
                                               p_since timestamptz)
  returns table (account_id uuid, contact_id uuid, contact_phone_id uuid, holder_id uuid,
                 holder_team_id uuid, holder_works boolean, lead_id uuid, lead_owner_id uuid,
                 lead_state text, language text)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_ingest(p_entity);
  return query
    with customer as (
      select distinct on (ae.account_id)
             ae.account_id as acc, ac.contact_id as con, cp.id as phone, ae.owner_id as holder,
             ae.team_id as holder_team, ae.created_at as since, c.preferred_language as lang
        from public.contact_phones cp
        join public.contacts c on c.id = cp.contact_id and c.archived_at is null
        join public.account_contacts ac on ac.contact_id = cp.contact_id
        join public.accounts a on a.id = ac.account_id and a.archived_at is null
                              and a.anonymised_at is null
        join public.account_entities ae on ae.account_id = ac.account_id
                                       and ae.entity_id = p_entity
       where cp.e164 = p_phone
       order by ae.account_id, (ac.role = 'owner') desc, ac.contact_id
    )
    select cu.acc, cu.con, cu.phone, cu.holder, cu.holder_team,
           exists (select 1
                     from public.users u
                     join public.user_entity_roles uer on uer.user_id = u.id
                                                      and uer.entity_id = p_entity
                     join public.role_permissions rp on rp.role_id = uer.role_id
                                                    and rp.permission_key = 'crm.lead.write'
                    where u.id = cu.holder and u.status = 'active'),
           l.id, l.owner_id, l.state, cu.lang
      from customer cu
      left join lateral (
        select o.id, o.owner_id, o.state
          from public.opportunities o
          join public.pipelines pl on pl.id = o.pipeline_id and pl.segment = p_segment
         where o.entity_id = p_entity
           and o.account_id = cu.acc
           and o.archived_at is null
           and (o.state = 'nurture'
                or (o.state = 'open'
                    and exists (select 1 from public.activities x
                                 where x.opportunity_id = o.id and x.created_at >= p_since)))
         order by (o.state = 'open') desc,
                  (select pg_catalog.max(x.created_at) from public.activities x
                    where x.opportunity_id = o.id) desc nulls last,
                  o.id desc
         limit 1) l on true
     order by (l.id is not null) desc, cu.since, cu.acc
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_customer(smallint, text, text, timestamptz) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_customer(smallint, text, text, timestamptz) to app_user;
--> statement-breakpoint

-- 10. The company's Cold Calling Tele-Callers who might take a new lead (the owner's decision on
--     question 3 of the design: T2's weighted round-robin), with their profiles, open leads and
--     when the platform last gave each of them one, so the pick goes round in turn.
create or replace function app.ingest_candidates(p_entity smallint)
  returns table (user_id uuid, team_id uuid, presence text, max_open integer, languages text[],
                 segments text[], open_leads integer, last_given_at timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_ingest(p_entity);
  return query
    select u.id, uer.team_id, coalesce(cp.presence, 'away'), cp.max_open,
           coalesce(cp.languages, '{}'::text[]), coalesce(cp.segments, '{}'::text[]),
           (select pg_catalog.count(*)::integer from public.opportunities o
             where o.entity_id = p_entity and o.owner_id = u.id and o.state = 'open'
               and o.archived_at is null),
           (select pg_catalog.max(o.created_at) from public.opportunities o
             where o.entity_id = p_entity and o.owner_id = u.id
               and o.created_by = app.user_id())
      from public.user_entity_roles uer
      join public.roles r on r.id = uer.role_id and r.key = 'tele_caller_cc'
      join public.role_permissions rp on rp.role_id = uer.role_id
                                     and rp.permission_key = 'crm.lead.write'
      join public.users u on u.id = uer.user_id and u.status = 'active'
      left join public.caller_profiles cp on cp.user_id = u.id and cp.entity_id = p_entity
     where uer.entity_id = p_entity
     order by u.id;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_candidates(smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_candidates(smallint) to app_user;
--> statement-breakpoint

-- 11. The company's Sales Team Lead, who gets a new lead as routed work when no caller is present.
create or replace function app.ingest_team_lead(p_entity smallint)
  returns table (user_id uuid, team_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.require_ingest(p_entity);
  return query
    select uer.user_id, uer.team_id
      from public.user_entity_roles uer
      join public.roles r on r.id = uer.role_id and r.key = 'sales_team_lead'
      join public.role_permissions rp on rp.role_id = uer.role_id
                                     and rp.permission_key = 'crm.lead.write'
      join public.users u on u.id = uer.user_id and u.status = 'active'
     where uer.entity_id = p_entity
     order by uer.user_id
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_team_lead(smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_team_lead(smallint) to app_user;
--> statement-breakpoint

-- 12. The pipeline a lead from an integration lands on in a company of the request: the connected
--     source's when one is named (live, of that company), else the pipeline with that key, the
--     company's own before the group's. No row when neither is offered.
create or replace function app.ingest_pipeline(p_entity smallint, p_source uuid, p_key text)
  returns table (pipeline_id uuid, pipeline_key text, segment text)
  language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_pipeline uuid;
begin
  perform app.require_ingest(p_entity);
  if p_source is not null then
    select s.pipeline_id into v_pipeline
      from public.ingest_sources s
     where s.id = p_source and s.entity_id = p_entity and s.archived_at is null;
    if v_pipeline is null then
      return;
    end if;
  end if;
  return query
    select pl.id, pl.key, pl.segment
      from public.pipelines pl
     where pl.is_active
       and (pl.entity_id is null or pl.entity_id = p_entity)
       and ((v_pipeline is not null and pl.id = v_pipeline)
            or (v_pipeline is null and pl.key = p_key))
     order by pl.entity_id nulls last
     limit 1;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_pipeline(smallint, uuid, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_pipeline(smallint, uuid, text) to app_user;
--> statement-breakpoint

-- 13. crm.lead.ingest's one write, as the platform, in a company of the request. `p` is the
--     command's checked input with the decisions the command took (`IngestWriteArgs` in
--     packages/domain/src/commands/crm/ingest-lead.ts):
--     - `attach` (the lead an enquiry joins, found by app.ingest_customer() in this transaction):
--       the timeline's `enquiry_repeated` row, the consents, the form's message as a note, and the
--       qualification facts the lead has none of yet; the lead keeps its owner, stage and first
--       source;
--     - `create`: for a customer found (`accountId`, `contactId`, `contactPhoneId`) or a new one
--       (the customer, its relationship owned by the lead's owner, its owner contact and main
--       phone), an optional site, the consents, the lead at the first open stage of its pipeline
--       with its channel's source and attribution, its qualification facts, the timeline
--       (`lead_created`, `consent_recorded`, a note), and routed work for the owner when asked (the
--       Sales Team Lead, or the colleague who looks after the customer).
--     The owner, when there is one, must work on leads in the company. Answers the ids, the owner, the site's district
--     (filled from the PIN master by customer_sites_pin_fill, for the score) and the codes the
--     event names.
create or replace function app.ingest_lead_write(p_entity smallint, p jsonb)
  returns table (outcome text, opportunity_id uuid, account_id uuid, contact_id uuid,
                 contact_phone_id uuid, owner_id uuid, team_id uuid, inbox_item_id uuid,
                 consent_ids uuid[], site_district text, pipeline_key text, source_code text)
  language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_actor uuid := app.user_id();
  v_mode text := p ->> 'mode';
  v_channel text := p ->> 'channel';
  v_lead uuid;
  v_account uuid := (p ->> 'accountId')::uuid;
  v_contact uuid := (p ->> 'contactId')::uuid;
  v_phone_id uuid := (p ->> 'contactPhoneId')::uuid;
  v_owner uuid := (p ->> 'ownerId')::uuid;
  v_team uuid;
  v_pipeline uuid;
  v_pipeline_key text;
  v_segment text;
  v_stage uuid;
  v_source uuid;
  v_source_code text;
  v_ingest_source uuid := (p ->> 'sourceId')::uuid;
  v_site uuid;
  v_district text;
  v_item uuid;
  v_consents uuid[] := '{}'::uuid[];
  v_consent uuid;
  v_consent_channel text;
  v_q jsonb := coalesce(p -> 'qualification', '{}'::jsonb);
  v_existing boolean := (p ->> 'accountId') is not null;
  v_given timestamptz;
begin
  perform app.require_ingest(p_entity);
  if v_mode is null or v_mode not in ('attach', 'create') then
    raise exception 'an ingest write is an attach or a create' using errcode = 'check_violation';
  end if;
  select ls.id, ls.code into v_source, v_source_code
    from public.lead_sources ls
   where ls.code = v_channel and ls.is_active and ls.archived_at is null;
  if v_source is null then
    raise exception 'channel % has no lead source', v_channel using errcode = 'check_violation';
  end if;

  if v_mode = 'attach' then
    select o.id, o.account_id, o.owner_id, o.team_id, pl.key
      into v_lead, v_account, v_owner, v_team, v_pipeline_key
      from public.opportunities o
      join public.pipelines pl on pl.id = o.pipeline_id
     where o.id = (p ->> 'leadId')::uuid
       and o.entity_id = p_entity
       and o.archived_at is null
       and o.state in ('open', 'nurture')
       for update of o;
    if v_lead is null then
      raise exception 'the lead to attach to is not open in the company'
        using errcode = 'no_data_found';
    end if;
    if not exists (select 1
                     from public.account_contacts ac
                     join public.contact_phones cp on cp.contact_id = ac.contact_id
                    where ac.account_id = v_account and ac.contact_id = v_contact
                      and cp.id = v_phone_id) then
      raise exception 'the contact is not the lead''s customer''s' using errcode = 'check_violation';
    end if;
  else
    -- The lead's pipeline (app.ingest_pipeline()) and its first live open stage, held until the
    -- lead is written.
    select ip.pipeline_id, ip.pipeline_key, ip.segment into v_pipeline, v_pipeline_key, v_segment
      from app.ingest_pipeline(p_entity, v_ingest_source, p ->> 'pipelineKey') ip;
    if v_pipeline is null then
      raise exception 'the pipeline is not offered in the company'
        using errcode = 'check_violation', hint = 'lead_pipeline_missing';
    end if;
    select st.id into v_stage
      from public.pipeline_stages st
     where st.pipeline_id = v_pipeline and st.kind = 'open' and st.archived_at is null
     order by st.position
     limit 1
       for share;
    if v_stage is null then
      raise exception 'the pipeline has no open stage'
        using errcode = 'check_violation', hint = 'lead_pipeline_missing';
    end if;
    -- The owner works on leads in the company, and their team there is the lead's; with nobody
    -- to take it, the lead waits unassigned for whoever reads the company's leads.
    if v_owner is not null then
      select uer.team_id into v_team
        from public.user_entity_roles uer
        join public.role_permissions rp on rp.role_id = uer.role_id
                                       and rp.permission_key = 'crm.lead.write'
        join public.users u on u.id = uer.user_id and u.status = 'active'
       where uer.user_id = v_owner and uer.entity_id = p_entity;
      if not found then
        raise exception 'the owner does not work on leads in the company'
          using errcode = 'check_violation', hint = 'assignee_not_eligible';
      end if;
    end if;

    if v_existing then
      if not exists (select 1
                       from public.account_entities ae
                       join public.accounts a on a.id = ae.account_id and a.archived_at is null
                       join public.account_contacts ac on ac.account_id = ae.account_id
                       join public.contact_phones cp on cp.contact_id = ac.contact_id
                      where ae.account_id = v_account and ae.entity_id = p_entity
                        and ac.contact_id = v_contact and cp.id = v_phone_id) then
        raise exception 'the customer is not the company''s' using errcode = 'check_violation';
      end if;
    else
      v_account := app.new_uuid7();
      v_contact := app.new_uuid7();
      v_phone_id := app.new_uuid7();
      insert into public.accounts (id, type, name, created_by)
        values (v_account, p ->> 'accountType', p #>> '{contact,name}', v_actor);
      insert into public.account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (app.new_uuid7(), v_account, p_entity, v_owner, v_team, v_actor);
      insert into public.contacts (id, name, preferred_language, created_by)
        values (v_contact, p #>> '{contact,name}',
                coalesce(p #>> '{contact,preferredLanguage}', 'hinglish'), v_actor);
      insert into public.account_contacts (account_id, contact_id, role, created_by)
        values (v_account, v_contact, 'owner', v_actor);
      insert into public.contact_phones (id, contact_id, e164, is_primary, is_whatsapp, created_by)
        values (v_phone_id, v_contact, p #>> '{contact,phone}', true, true, v_actor);
    end if;

    if jsonb_typeof(p -> 'site') = 'object' then
      v_site := app.new_uuid7();
      insert into public.customer_sites (id, account_id, type, village, pin, created_by)
        values (v_site, v_account, p #>> '{site,type}', p #>> '{site,village}',
                p #>> '{site,pin}', v_actor)
        returning district into v_district;
    end if;

    v_lead := app.new_uuid7();
    insert into public.opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id,
                                      owner_id, team_id, source_id, campaign_json, created_by)
      values (v_lead, p_entity, v_account, v_site, v_pipeline, v_stage, v_owner, v_team, v_source,
              coalesce(p -> 'attribution', '{}'::jsonb), v_actor);
  end if;

  -- The consent the form recorded, one row per channel, given when the person ticked it.
  if jsonb_typeof(p -> 'consent') = 'object' then
    v_given := least((p #>> '{consent,givenAt}')::timestamptz, pg_catalog.now());
    for v_consent_channel in select jsonb_array_elements_text(p #> '{consent,channels}') loop
      v_consent := app.new_uuid7();
      insert into public.consents (id, contact_id, channel, purpose, source, text_version, given_at,
                                   created_by)
        values (v_consent, v_contact, v_consent_channel, p #>> '{consent,purpose}', 'web_form',
                p #>> '{consent,textVersion}', v_given, v_actor);
      v_consents := v_consents || v_consent;
    end loop;
  end if;

  -- The facts the form answered; on a lead that already has some, only those it lacks.
  if v_q <> '{}'::jsonb then
    insert into public.lead_qualifications as lq (opportunity_id, entity_id, pump_depth_ft,
        required_hp, monthly_bill_rupees, roof_area_sq_ft, sanctioned_load_kw, discom_consumer_no,
        updated_by)
      values (v_lead, p_entity, (v_q ->> 'pumpDepthFt')::integer, (v_q ->> 'requiredHp')::numeric,
              (v_q ->> 'monthlyBillRupees')::numeric, (v_q ->> 'roofAreaSqFt')::integer,
              (v_q ->> 'sanctionedLoadKw')::numeric, v_q ->> 'discomConsumerNo', v_actor)
      on conflict on constraint lead_qualifications_pkey do update
        set pump_depth_ft = coalesce(lq.pump_depth_ft, excluded.pump_depth_ft),
            required_hp = coalesce(lq.required_hp, excluded.required_hp),
            monthly_bill_rupees = coalesce(lq.monthly_bill_rupees, excluded.monthly_bill_rupees),
            roof_area_sq_ft = coalesce(lq.roof_area_sq_ft, excluded.roof_area_sq_ft),
            sanctioned_load_kw = coalesce(lq.sanctioned_load_kw, excluded.sanctioned_load_kw),
            discom_consumer_no = coalesce(lq.discom_consumer_no, excluded.discom_consumer_no),
            updated_by = excluded.updated_by;
  end if;

  -- The timeline: the lead made or the enquiry repeated, each consent, and the form's message.
  insert into public.activities (id, entity_id, opportunity_id, account_id, type,
                                 actor_principal_id, payload_json)
    values (app.new_uuid7(), p_entity, v_lead, v_account,
            case v_mode when 'attach' then 'enquiry_repeated' else 'lead_created' end, v_actor,
            case v_mode
              when 'attach' then pg_catalog.jsonb_build_object(
                'pipelineKey', v_pipeline_key, 'sourceCode', v_source_code,
                'consent', pg_catalog.cardinality(v_consents) > 0)
              else pg_catalog.jsonb_build_object(
                'pipelineKey', v_pipeline_key, 'sourceCode', v_source_code,
                'existingAccount', v_existing)
            end);
  insert into public.activities (id, entity_id, opportunity_id, account_id, type,
                                 actor_principal_id, payload_json)
    select app.new_uuid7(), p_entity, null, v_account, 'consent_recorded', v_actor,
           pg_catalog.jsonb_build_object('consentId', c.id, 'channel', c.channel,
                                         'purpose', c.purpose, 'source', c.source)
      from public.consents c
     where c.id = any (v_consents);
  if p ->> 'message' is not null then
    insert into public.activities (id, entity_id, opportunity_id, account_id, type,
                                   actor_principal_id, body)
      values (app.new_uuid7(), p_entity, v_lead, v_account, 'note', v_actor, p ->> 'message');
  end if;

  if v_mode = 'create' and v_owner is not null
     and coalesce((p ->> 'routeWork')::boolean, false) then
    v_item := app.new_uuid7();
    insert into public.inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type,
                                    subject_id, state, segment, created_by)
      values (v_item, p_entity, 'routed_work', v_owner, v_team, 'opportunity', v_lead, 'open',
              v_segment, v_actor);
  end if;

  return query
    select case v_mode when 'attach' then 'attached' else 'created' end, v_lead, v_account,
           v_contact, v_phone_id, v_owner, v_team, v_item, v_consents, v_district,
           v_pipeline_key, v_source_code;
end
$$;
--> statement-breakpoint
revoke execute on function app.ingest_lead_write(smallint, jsonb) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.ingest_lead_write(smallint, jsonb) to app_user;
