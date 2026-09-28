-- Two gaps in the M25 routing (a customer a colleague looks after in a company goes to that
-- colleague, 0026) and in the rule that whoever reads a lead reads its customer.
--
-- 1. app.lead_phone_status(): a new lead typed in as a new customer never looked at its phone,
--    so re-entering the mobile number of a customer a colleague looks after made a second customer
--    and a lead of the caller's own, round the ownership lock and the routing, and split the
--    customer's consent and DND history. crm.lead.create and the import commit ask this helper
--    first and refuse with customer_held_by_colleague, as the known-customer path does.
--    It answers a status only, never an id, a name or any column of the customer it found:
--      held_by_other  the number belongs to a customer this company deals with through a
--                     relationship the caller may not write (someone else holds it, and the
--                     caller's crm.account.write scope does not reach them)
--      clear          anything else: no such number here, only the caller's own customers or
--                     ones they may act for, or a customer known only in other companies
--    Archived customers and contacts are left out, as the known-customer path leaves them out.
--
-- 2. app.hand_over_customer(): crm.opportunity.assign gave the lead a new owner but left the
--    customer's relationship in that company with the previous one, so a new owner with own scope
--    read the lead but not its customer, and the lead dropped out of search and every joined read.
--    Called by the command after the lead has moved, it moves the relationship to the lead's
--    owner and team, only when the previous lead owner held it (the normal handover) and the
--    caller's crm.lead.write scope reaches its holder, as it reached the lead. A relationship
--    held by anyone else is left as it is. It answers what it did, the relationship's id and the
--    team it had, and the command writes the audit row from that.
--
-- Both are security definers because the caller may not see the rows they look at (a
-- colleague's customer; a relationship the assigner has no crm.account scope over, as the triage
-- agent has none). Each checks a request, the company and the permission in its body, pins an
-- empty search path with qualified names (AUDIT M2), and is executable by app_user only.

create function app.lead_phone_status(p_phone text, p_entity smallint) returns text
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity using errcode = '42501';
  end if;
  if not app.has_perm('crm.lead.write:own') then
    raise exception 'permission crm.lead.write:own required' using errcode = '42501';
  end if;
  if exists (
    select 1
      from public.contact_phones cp
      join public.contacts c on c.id = cp.contact_id and c.archived_at is null
      join public.account_contacts ac on ac.contact_id = cp.contact_id
      join public.accounts a on a.id = ac.account_id and a.archived_at is null
      join public.account_entities ae on ae.account_id = ac.account_id and ae.entity_id = p_entity
     where cp.e164 = p_phone
       and not app.scope_ok('crm.account.write', ae.owner_id, ae.team_id)) then
    return 'held_by_other';
  end if;
  return 'clear';
end
$$;
--> statement-breakpoint
revoke execute on function app.lead_phone_status(text, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.lead_phone_status(text, smallint) to app_user;
--> statement-breakpoint
create function app.hand_over_customer(p_opportunity uuid, p_previous_owner uuid)
  returns table (status text, relationship_id uuid, previous_team_id uuid)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.user_id();
  v_account uuid;
  v_entity smallint;
  v_owner uuid;
  v_team uuid;
  v_relationship uuid;
  v_held_by uuid;
  v_held_team uuid;
begin
  if v_actor is null or not app.has_perm('crm.lead.assign:own') then
    raise exception 'permission crm.lead.assign:own required' using errcode = '42501';
  end if;
  -- The lead as it now stands, only when the caller may write it (opportunities_update).
  select o.account_id, o.entity_id, o.owner_id, o.team_id
    into v_account, v_entity, v_owner, v_team
    from public.opportunities o
   where o.id = p_opportunity
     and o.archived_at is null
     and o.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
     and app.scope_ok('crm.lead.write', o.owner_id, o.team_id);
  if not found then
    raise exception 'opportunity % is outside the caller''s write scope', p_opportunity
      using errcode = '42501';
  end if;
  select ae.id, ae.owner_id, ae.team_id
    into v_relationship, v_held_by, v_held_team
    from public.account_entities ae
   where ae.account_id = v_account and ae.entity_id = v_entity
     for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_held_by is not distinct from v_owner then
    return query select 'unchanged'::text, v_relationship, null::uuid;
    return;
  end if;
  if v_held_by is distinct from p_previous_owner
     or not app.scope_ok('crm.lead.write', v_held_by, v_held_team) then
    return query select 'held_by_other'::text, v_relationship, null::uuid;
    return;
  end if;
  update public.account_entities
     set owner_id = v_owner, team_id = v_team, updated_at = now(), updated_by = v_actor
   where id = v_relationship;
  return query select 'moved'::text, v_relationship, v_held_team;
end
$$;
--> statement-breakpoint
revoke execute on function app.hand_over_customer(uuid, uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.hand_over_customer(uuid, uuid) to app_user;
