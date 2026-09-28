-- The owner's rule (2026-09-28): whoever may read one of a customer's leads in a company may read
-- that customer. Before this, a lead handed to someone whose crm.account.read scope is their own
-- stayed readable while its customer did not, whenever the customer's relationship in that
-- company stayed with someone else (0055 moves it on a normal handover, not in every case).
--
-- 1. account_entities_read: a relationship row is also visible to a person when a lead of that
--    customer in that company is visible to them. Never to an agent principal: SECURITY §3.3 has
--    the Triage and Co-pilot agents work on leads without customer names or phones, and no agent
--    holds a crm.account permission, so an agent reads customers through crm.account.read scope
--    only. The request is an agent's when its role key (app.role) is an agent role or its
--    principal row (app.user_id) is of kind agent; neither is something an agent can change
--    (principals are written with admin.users.write:all only), and both are read once per query
--    in an initplan. The exists runs under opportunities_read, so the caller's own, team or
--    company scope on leads decides, and the row must still be in a company of the request: a
--    customer related only to another company stays invisible, and with no request nothing is
--    visible. accounts, account_contacts, customer_sites, contacts,
--    contact_phones and consents read through account_entities (0028), so each follows with no
--    change of its own. opportunities_account_idx (account_id) serves the exists: a customer has
--    a handful of leads, and the company and the lead scope are checked on those rows. The write
--    policies and the write helpers (app.account_in_scope(), app.contact_in_scope()) are
--    unchanged: reading a customer through a lead gives no right to change it.
--
-- 2. app.attach_account_entity() answered already_yours when the caller could write the customer
--    in any company of the request, so in All-companies mode a caller who looked after the
--    customer in one company slipped past the M25 routing in another. It now judges the target
--    company only: the relationship there, and whether the caller may write it.
--
-- 3. app.lead_search_ids() (0052) kept a lead as a candidate only when its customer was readable
--    too. For a person a readable lead now makes its customer readable, through the relationship in
--    the lead's own company (a lead sits only in a company its customer deals with,
--    app.ensure_account_entity), so that condition is always met and is not asked. For an agent
--    the customer is still read by crm.account.read scope alone, so the condition is kept for
--    agents exactly as before. The function still returns only ids of leads the caller may read.
drop policy account_entities_read on account_entities;
--> statement-breakpoint
create policy account_entities_read on account_entities for select using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('crm.account.read:entity'))
    or ((select app.has_perm('crm.account.read:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('crm.account.read:own')) and owner_id = (select app.user_id()))
    or ((select coalesce(current_setting('app.role', true), '') not like 'agent:%'
               and not exists (select 1 from principals p
                                where p.id = app.user_id() and p.kind = 'agent'))
        and exists (select 1 from opportunities o
                     where o.account_id = account_entities.account_id
                       and o.entity_id = account_entities.entity_id))));
--> statement-breakpoint
create or replace function app.attach_account_entity(p_account uuid, p_entity smallint) returns text
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
declare
  v_inserted int;
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_perm('crm.account.write:own') then
    raise exception 'permission crm.account.write:own required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.accounts a where a.id = p_account and a.archived_at is null) then
    return 'missing';
  end if;
  insert into public.account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
  values (app.uuid_v7(), p_account, p_entity, app.user_id(), app.team_id(), app.user_id())
  on conflict (account_id, entity_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return 'attached';
  end if;
  if exists (select 1 from public.account_entities ae
              where ae.account_id = p_account and ae.entity_id = p_entity
                and app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)) then
    return 'already_yours';
  end if;
  return 'held_by_other';
end
$$;
--> statement-breakpoint
revoke all on function app.attach_account_entity(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_account_entity(uuid, smallint) to app_user;
--> statement-breakpoint
create or replace function app.lead_search_ids(
  p_text text,
  p_by_spelling boolean,
  p_phone_reversed text,
  p_max integer
) returns setof uuid
language plpgsql volatile security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
rows 20
as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := app.entity_ids();
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  v_account_entity boolean := app.has_perm('crm.account.read:entity');
  v_account_team boolean := app.has_perm('crm.account.read:team');
  v_account_own boolean := app.has_perm('crm.account.read:own');
  -- An agent reads a lead's customer by crm.account.read scope only (account_entities_read).
  v_agent boolean := coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
    or exists (select 1 from public.principals p where p.id = v_user and p.kind = 'agent');
  v_want integer := least(greatest(coalesce(p_max, 0), 1), 200);
  -- The search's threshold (useNameSimilarity), or pg_trgm's default when none is set.
  v_threshold text := coalesce(nullif(
    pg_catalog.current_setting('pg_trgm.word_similarity_threshold', true), ''), '0.6');
  v_starts text;
  v_contains text;
  v_pattern text;
  v_phone text;
  v_level real;
  v_levels real[] := '{}';
  v_narrow integer := 1;
  v_ids uuid[];
begin
  if v_user is null or not v_lead_own then
    raise exception 'permission crm.lead.read required' using errcode = 'insufficient_privilege';
  end if;
  v_starts := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_contains := '%' || v_starts;
  if p_by_spelling then
    select coalesce(pg_catalog.array_agg(l), '{}') into v_levels
      from pg_catalog.unnest('{0.9,0.7,0.55}'::real[]) l
     where l > v_threshold::real;
    v_narrow := pg_catalog.cardinality(v_levels);
  end if;

  -- Each pass finds the leads in scope with a matching name, village or phone. The narrow passes
  -- match a name or village that starts with the text, or resembles it at their level, and no
  -- phone; the last matches as the search does.
  for i in 1 .. v_narrow + 1 loop
    if i <= v_narrow then
      v_pattern := v_starts;
      v_phone := null;
      if p_by_spelling then
        v_level := v_levels[i];
        perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_level::text, true);
      end if;
    else
      v_pattern := v_contains;
      v_phone := p_phone_reversed;
      if p_by_spelling then
        perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
      end if;
    end if;

    with hit_accounts as (
      select a.id from public.accounts a where a.name ilike v_pattern
      union
      select a.id from public.accounts a
       where p_by_spelling and p_text operator(public.<%) a.name
      union
      select ac.account_id from public.contacts c
        join public.account_contacts ac on ac.contact_id = c.id
       where c.name ilike v_pattern
      union
      select ac.account_id from public.contacts c
        join public.account_contacts ac on ac.contact_id = c.id
       where p_by_spelling and p_text operator(public.<%) c.name
      union
      select ac.account_id from public.contact_phones ph
        join public.account_contacts ac on ac.contact_id = ph.contact_id
       where ph.e164_reversed ^@ v_phone
    ),
    hit_sites as (
      select cs.id from public.customer_sites cs where cs.village ilike v_pattern
      union
      select cs.id from public.customer_sites cs
       where p_by_spelling and p_text operator(public.<%) cs.village
    ),
    hits as (
      select o.id from public.opportunities o where o.account_id in (select id from hit_accounts)
      union
      select o.id from public.opportunities o where o.site_id in (select id from hit_sites)
    )
    select coalesce(pg_catalog.array_agg(o.id), '{}') into v_ids
      from hits h
      join public.opportunities o on o.id = h.id
     where o.archived_at is null
       and o.entity_id = any (v_entities)
       and (v_lead_entity
         or (v_lead_team and o.team_id = v_team)
         or (v_lead_own and o.owner_id = v_user))
       and (not v_agent or exists (
         select 1 from public.account_entities ae
          where ae.account_id = o.account_id
            and ae.entity_id = any (v_entities)
            and (v_account_entity
              or (v_account_team and ae.team_id = v_team)
              or (v_account_own and ae.owner_id = v_user))));

    exit when v_pattern = v_contains or pg_catalog.cardinality(v_ids) >= v_want;
  end loop;
  if p_by_spelling then
    perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
  end if;

  -- The order of the search, each name and village scored once however many leads carry it,
  -- with the tier and closeness of matchTier() and similarityTo() (packages/domain/src/queries).
  return query
  with leads as (
    select o.id, o.account_id, o.updated_at, a.name as account_name, cs.village
      from pg_catalog.unnest(v_ids) as x(id)
      join public.opportunities o on o.id = x.id
      join public.accounts a on a.id = o.account_id
      left join public.customer_sites cs on cs.id = o.site_id
  ),
  lead_contacts as (
    select ac.account_id, c.name
      from (select distinct account_id from leads) l
      join public.account_contacts ac on ac.account_id = l.account_id
      join public.contacts c on c.id = ac.contact_id
  ),
  scores as (
    select t.text,
           case when lower(t.text) = lower(p_text) then 2
                when t.text ilike v_starts then 1 else 0 end as tier,
           coalesce(public.word_similarity(p_text, t.text), 0) as closeness
      from (select account_name as text from leads
            union select village from leads
            union select name from lead_contacts) t
  ),
  contact_scores as materialized (
    select lc.account_id, max(sc.tier) as tier, max(sc.closeness) as closeness
      from lead_contacts lc join scores sc on sc.text = lc.name
     group by lc.account_id
  )
  select l.id
    from leads l
    join scores sa on sa.text = l.account_name
    left join scores sv on sv.text = l.village
    left join contact_scores sc on sc.account_id = l.account_id
   order by greatest(sa.tier, sv.tier, sc.tier) desc,
            greatest(sa.closeness, sv.closeness, sc.closeness) desc,
            l.updated_at desc,
            l.id desc
   limit v_want;
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_search_ids(text, boolean, text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.lead_search_ids(text, boolean, text, integer) to app_user;
