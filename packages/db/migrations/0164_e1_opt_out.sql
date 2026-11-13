-- E1 review, findings 1, 8 and 9 (docs/runs/phase2/e1-channels.md): the Cold Caller queue, the
-- leads list and Account 360's call links read a customer's opt-out by the rule `app.dial_facts()`
-- uses (decision 3): a contact of the customer, or anyone holding a number of the customer's
-- contacts, withdrew consent to calls and gave none since. A caller reads no other customer's
-- consents, so the rule is a definer answering one boolean, for a customer related to a company of
-- the request, to a principal who reads leads or customers or logs calls; anyone else, or a
-- customer of no company of the request, is refused (42501), never answered "not opted out".
-- Account 360's consent panel and `calls.log` keep the customer's own contacts (decision 3).
create or replace function app.call_opt_out(p_account uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null
     or not (app.has_perm('crm.lead.read:own') or app.has_perm('crm.account.read:own')
             or app.has_perm('calls.log:own')) then
    raise exception 'crm.lead.read, crm.account.read or calls.log is required'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.account_entities ae
                  where ae.account_id = p_account
                    and ae.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'customer % is of no company of the request', p_account
      using errcode = '42501';
  end if;
  return exists (
    select 1
      from (select ac.contact_id
              from public.account_contacts ac
             where ac.account_id = p_account
            union
            select other.contact_id
              from public.account_contacts ac
              join public.contact_phones mine on mine.contact_id = ac.contact_id
              join public.contact_phones other on other.e164 = mine.e164
             where ac.account_id = p_account) holders
      join public.consents w on w.contact_id = holders.contact_id
     where w.channel = 'call' and w.withdrawn_at is not null
       and not exists (select 1 from public.consents g
                        where g.contact_id = w.contact_id and g.channel = 'call'
                          and g.withdrawn_at is null
                          and g.given_at > w.withdrawn_at));
end
$$;
--> statement-breakpoint
revoke execute on function app.call_opt_out(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.call_opt_out(uuid) to app_user, app_reader;
