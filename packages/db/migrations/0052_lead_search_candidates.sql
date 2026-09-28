-- ⌘K lead search at scale (docs/spikes/lists.md). Under row-level security Postgres will not use
-- an operator that is not leakproof (ilike, pg_trgm's <%, word_similarity) as an index condition
-- ahead of the policies, so the search tested the caller's whole scope row by row: 1.3 to 1.4 s
-- for an Executive at 50,000 leads. This function finds the leads the search would show with the
-- trigram indexes on accounts.name, contacts.name and customer_sites.village and the index on
-- contact_phones.e164_reversed (0051), and returns their ids only. The search then reads those
-- leads under the policies with its own conditions and order, so what the caller sees is still
-- exactly what RLS allows.
--
-- Why it cannot show more than the caller may read:
-- * It checks crm.lead.read in its body (every grant carries its narrower scopes, so any scope
--   holds :own) inside a signed-in request, and raises otherwise.
-- * It returns ids of leads only, never a name, phone or any other column.
-- * A lead is a candidate only when the caller can read it and its customer: the lead passes the
--   opportunities_read predicate (a company of the request, then crm.lead.read at entity, the
--   caller's team or their own), and its account passes accounts_read through account_entities
--   (a company of the request, then crm.account.read at entity, team or own), read from the same
--   settings the policies read. A readable customer makes its sites, contacts and phones readable
--   (their policies follow account_entities), so the match and the order use nothing else.
-- * Archived leads are left out, as the search leaves them out.
--
-- What it returns: the search's matches (the customer's name, a contact's name or the site's
-- village holds the text or, when p_by_spelling, resembles it at the transaction's
-- pg_trgm.word_similarity_threshold, which the search sets; or a contact's phone ends with the
-- digits) in the search's own order (an exact name or village first, then one that starts with the
-- text, then the closest in spelling, then the newest change), at most p_max of them and never more
-- than 200. Since it keeps to the same leads as the policies, its first p_max are the search's
-- first p_max. The text is escaped for LIKE exactly as containsPattern() does
-- (packages/domain/src/queries/search-text.ts); p_by_spelling and the digits written backwards
-- come from the search, which uses the same values in its own conditions.
--
-- The few best are found without scoring every match: a common surname can resemble thousands of
-- names, and two letters are held by most of them. Narrow passes come first. Matching by
-- spelling, they ask the trigram indexes for the leads with a name or village that starts with the
-- text or resembles it at 0.9, then 0.7, then 0.55 (each only above the search's own threshold);
-- otherwise one pass asks for a name or village that starts with the text. The function stops at
-- the first pass that yields p_max leads the caller may read. Every other match has no name or
-- village that starts with the text, and, matching by spelling, every one of its names and
-- villages resembles the text less than that pass's level; so it ranks below each of those leads
-- (the order puts a name that starts with the text first, then the closest) and cannot be among
-- the first p_max. Only when no narrow pass yields enough does it score every match. The search's
-- threshold is restored before it returns.
--
-- plan_cache_mode = force_custom_plan plans each statement with the call's values, so a branch
-- that is off (no spelling match, no phone digits) is dropped at planning and the phone prefix
-- becomes an index range. The search path is empty and every name is qualified (AUDIT M2);
-- pg_trgm lives in public (0003).
create function app.lead_search_ids(
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
       and exists (
         select 1 from public.account_entities ae
          where ae.account_id = o.account_id
            and ae.entity_id = any (v_entities)
            and (v_account_entity
              or (v_account_team and ae.team_id = v_team)
              or (v_account_own and ae.owner_id = v_user)));

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
revoke all on function app.lead_search_ids(text, boolean, text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.lead_search_ids(text, boolean, text, integer) to app_user;
