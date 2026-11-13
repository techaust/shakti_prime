-- E1 review, finding 1 (docs/runs/phase2/e1-channels.md): the Cold Caller queue, the leads list and
-- the Show number key read a customer's opt-out by the rule `app.dial_facts()` uses (decision 3):
-- a contact of the customer, or anyone holding a number of the customer's contacts, withdrew
-- consent to calls and gave none since. A caller reads no other customer's consents, so the rule
-- is a definer answering one boolean, for a customer related to a company of the request, to a
-- principal who reads leads or logs calls. Account 360 and `calls.log` keep the customer's own
-- contacts (decision 3).
create or replace function app.call_opt_out(p_account uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select app.user_id() is not null
     and (app.has_perm('crm.lead.read:own') or app.has_perm('calls.log:own'))
     and exists (select 1 from public.account_entities ae
                  where ae.account_id = p_account
                    and ae.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
     and exists (
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
                             and g.given_at > w.withdrawn_at))
$$;
--> statement-breakpoint
revoke execute on function app.call_opt_out(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.call_opt_out(uuid) to app_user, app_reader;
