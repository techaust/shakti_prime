-- The customers list's search (docs/design/phase1.md §6.5, DATABASE §4.2): under RLS Postgres
-- will not use `ilike` as an index condition (it is not leakproof), so a search tested every
-- customer, contact and site in the caller's scope row by row, each through the customer
-- policies (230 ms at the 50th percentile for a General Manager at 10,000 customers,
-- docs/spikes/lists.md). The candidates therefore come from this definer, as the ⌘K lead search's
-- do from app.lead_search_ids() (0052): it uses the trigram indexes on the customer, contact and
-- village names and the index on the phone written backwards, keeps to the relationships the
-- caller may read by the account_entities_read rule read from the request's settings (the
-- caller's customer scope, or for a person, never an agent, a lead of the customer there that is
-- not archived, 0057), and returns at most 200 customer ids. listCustomers then reads only those
-- customers, under the policies, with its own conditions and order.
create or replace function app.customer_search_ids(
  p_text text,
  p_phone_reversed text,
  p_max integer
) returns setof uuid
language plpgsql stable security definer
set search_path = ''
rows 50
as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := app.entity_ids();
  v_account_entity boolean := app.has_perm('crm.account.read:entity');
  v_account_team boolean := app.has_perm('crm.account.read:team');
  v_account_own boolean := app.has_perm('crm.account.read:own');
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  -- An agent reads a customer by crm.account.read scope only (account_entities_read, 0057).
  v_agent boolean := coalesce(pg_catalog.current_setting('app.role', true), '') like 'agent:%'
    or exists (select 1 from public.principals p where p.id = v_user and p.kind = 'agent');
  v_want integer := least(greatest(coalesce(p_max, 0), 1), 200);
  v_pattern text;
begin
  if v_user is null or not (v_account_own or v_lead_own) then
    raise exception 'permission crm.account.read or crm.lead.read required'
      using errcode = 'insufficient_privilege';
  end if;
  v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hits as (
    select a.id from public.accounts a where p_text is not null and a.name ilike v_pattern
    union
    select ac.account_id from public.contacts c
      join public.account_contacts ac on ac.contact_id = c.id
     where p_text is not null and c.name ilike v_pattern
    union
    select cs.account_id from public.customer_sites cs
     where p_text is not null and cs.village ilike v_pattern and cs.archived_at is null
    union
    select ac.account_id from public.contact_phones ph
      join public.account_contacts ac on ac.contact_id = ph.contact_id
     where ph.e164_reversed ^@ p_phone_reversed
  )
  select h.id
    from hits h
    join public.accounts a on a.id = h.id and a.archived_at is null
   where exists (
     select 1 from public.account_entities ae
      where ae.account_id = h.id
        and ae.entity_id = any (v_entities)
        and (v_account_entity
          or (v_account_team and ae.team_id = v_team)
          or (v_account_own and ae.owner_id = v_user)
          or (not v_agent and exists (
            select 1 from public.opportunities o
             where o.account_id = ae.account_id
               and o.entity_id = ae.entity_id
               and o.archived_at is null
               and (v_lead_entity
                 or (v_lead_team and o.team_id = v_team)
                 or (v_lead_own and o.owner_id = v_user))))))
   order by a.name, a.id
   limit v_want;
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_search_ids(text, text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.customer_search_ids(text, text, integer) to app_user;
