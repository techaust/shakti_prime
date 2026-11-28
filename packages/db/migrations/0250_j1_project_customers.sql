-- J1: the customer and the site of the projects a caller reads (docs/03-roadmap-appendix/phase4.md
-- §6.1). A Field Engineer reads a project they are on but not its customer (crm.account.read at
-- `own` scope is the customer's owner's), and needs the name and village to do the job; so the
-- project screens read them through this definer, for the projects the caller reads only:
-- projects.read for the company, or a project the caller owns or is on (app.project_is_mine()).
-- The name, village, district and PIN; never a phone number or an address line.
create or replace function app.project_customers(p_projects uuid[])
  returns table (project_id uuid, account_name text, village text, district text, pin text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('projects.read:own') then
    raise exception 'projects.read is required' using errcode = '42501';
  end if;
  return query
    select p.id, a.name, s.village, s.district, s.pin
      from public.projects p
      join public.accounts a on a.id = p.account_id
      left join public.customer_sites s on s.id = p.site_id
     where p.id = any (p_projects)
       and p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))
       and (app.has_perm('projects.read:entity') or app.project_is_mine(p.id));
end
$$;
--> statement-breakpoint
revoke execute on function app.project_customers(uuid[]) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.project_customers(uuid[]) to app_user, app_reader;
