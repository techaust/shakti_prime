-- AUDIT M25: a repeat enquiry from a customer a colleague already looks after is routed to that
-- colleague, not opened to the caller. The helper answers what it found, so the command can say
-- so instead of reporting the customer as missing:
--   attached       the caller's entity now deals with the customer, owned by the caller
--   already_yours  the relationship exists and the caller may write it
--   held_by_other  the relationship exists but belongs to someone outside the caller's scope
--   missing        no such customer
drop function app.attach_account_entity(uuid, smallint);
--> statement-breakpoint
create function app.attach_account_entity(p_account uuid, p_entity smallint) returns text
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
  if app.account_in_scope(p_account, 'crm.account.write') then
    return 'already_yours';
  end if;
  return 'held_by_other';
end
$$;
--> statement-breakpoint
revoke all on function app.attach_account_entity(uuid, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.attach_account_entity(uuid, smallint) to app_user;
