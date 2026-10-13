-- ⌘K and /orders find an order by any part of its number (RPT-03). `ilike` is not leakproof, so
-- under the policies the planner cannot use the trigram index of `so_no` and reads every order of
-- the request's companies. As for quotes (app.quote_search_ids()), this definer finds the
-- candidates on the index, at most p_limit (200 at most) of them, of one state when p_state names
-- one (the /orders status filter, applied before the limit), and the query then reads them under
-- `sales_orders_read`. The rows a caller reads are narrowed before the limit as the policy narrows
-- them, from the same settings: a company of the request, then an order of a lead the caller
-- reads (crm.lead.read at company scope, the caller's team, or their own) or a dealer's order of
-- a customer whose relationship the caller reads, as `account_entities_read` reads it
-- (crm.account.read at company scope, the relationship's team, or their own; or, for a person and
-- never an agent or `system:` principal, a live lead of that customer in the company that the
-- caller reads). Otherwise a caller who reads few orders would get the 200 newest matches of the
-- company and miss their own. The text is escaped for LIKE as containsPattern() escapes it.
-- Ids only.
create or replace function app.order_search_ids(p_text text, p_state text, p_limit integer)
  returns setof uuid
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_team uuid := app.team_id();
  v_entities int[] := coalesce(app.entity_ids(), '{}'::int[]);
  v_lead_entity boolean := app.has_perm('crm.lead.read:entity');
  v_lead_team boolean := app.has_perm('crm.lead.read:team');
  v_lead_own boolean := app.has_perm('crm.lead.read:own');
  v_account_entity boolean := app.has_perm('crm.account.read:entity');
  v_account_team boolean := app.has_perm('crm.account.read:team');
  v_account_own boolean := app.has_perm('crm.account.read:own');
  v_person boolean := coalesce(current_setting('app.role', true), '') not like 'agent:%'
    and coalesce(current_setting('app.role', true), '') not like 'system:%'
    and not exists (select 1 from public.principals p
                     where p.id = app.user_id() and p.kind in ('agent', 'system'));
  v_pattern text := '%' || replace(replace(replace(coalesce(p_text, ''),
                      '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if v_user is null or not (v_lead_own or v_account_own) then
    raise exception 'crm.lead.read or crm.account.read is required' using errcode = '42501';
  end if;
  return query
    select so.id
      from public.sales_orders so
      left join public.opportunities o on o.id = so.opportunity_id
      left join public.account_entities ae
        on so.opportunity_id is null
       and ae.account_id = so.account_id
       and ae.entity_id = so.entity_id
     where so.entity_id = any (v_entities)
       and so.so_no ilike v_pattern
       and (p_state is null or so.state = p_state)
       and ((so.opportunity_id is not null
             and (v_lead_entity
                  or (v_lead_team and v_team is not null and o.team_id = v_team)
                  or (v_lead_own and o.owner_id = v_user)))
         or (so.opportunity_id is null
             and ae.account_id is not null
             and (v_account_entity
                  or (v_account_team and v_team is not null and ae.team_id = v_team)
                  or (v_account_own and ae.owner_id = v_user)
                  or (v_person
                      and exists (
                        select 1 from public.opportunities lo
                         where lo.account_id = ae.account_id
                           and lo.entity_id = ae.entity_id
                           and lo.archived_at is null
                           and (v_lead_entity
                                or (v_lead_team and v_team is not null and lo.team_id = v_team)
                                or (v_lead_own and lo.owner_id = v_user)))))))
     order by lower(so.so_no) = lower(p_text) desc, so.created_at desc, so.id desc
     limit least(greatest(coalesce(p_limit, 0), 0), 200);
end
$$;
--> statement-breakpoint
revoke execute on function app.order_search_ids(text, text, integer) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.order_search_ids(text, text, integer) to app_user, app_reader;
