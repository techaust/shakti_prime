-- An agent-only permission (`AGENT_ONLY_PERMISSIONS` in @shakti/contracts, SECURITY §3.1): the
-- Caller Co-pilot's `agents.note.write` may be held only by an agent role, so the role editor no
-- longer offers it to a staff role and the holder guard refuses it to one. Every other clause is
-- the latest definition's, unchanged; a security test compares the function with roleMayHold() for
-- every role and permission.
create or replace function app.role_may_hold(p_role_key text, p_permission_key text) returns boolean
  language sql immutable set search_path = '' as $$
  select case
    when p_permission_key = any (app.platform_only_permissions()) then p_role_key like 'system:%'
    when p_permission_key = 'agents.note.write' then p_role_key like 'agent:%'
    when p_permission_key like 'admin.%' or p_permission_key = 'integrations.dlq.replay'
      then p_role_key = 'executive'
    when p_permission_key = 'finance.cost.read' then p_role_key in ('executive', 'accounts')
    when p_permission_key = 'procurement.rate.read'
      then p_role_key in ('executive', 'inventory_manager', 'accounts')
    else true
  end
$$;
--> statement-breakpoint
revoke execute on function app.role_may_hold(text, text) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.role_may_hold(text, text) to app_user;
--> statement-breakpoint
-- A grant the editor could give before this one wrote nothing (the notes' insert policy admits only
-- the Co-pilot); it is removed so no staff role is left holding what it may no longer hold.
delete from role_permissions rp
 using roles r
 where r.id = rp.role_id
   and rp.permission_key = 'agents.note.write'
   and r.key not like 'agent:%';
