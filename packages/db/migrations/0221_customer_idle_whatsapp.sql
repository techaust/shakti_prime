-- W1 re-check N3: a customer who wrote on WhatsApp within the period is not idle. The
-- anonymisation already passed such a customer by; the test now sits in app.customer_idle() too,
-- so the stale-lead window (app.stale_leads()) and the dry run that counts it read the same answer
-- the anonymisation acts on. Every other clause is the latest definition's, unchanged; the probe
-- uses whatsapp_threads_account_idx.
create or replace function app.customer_idle(p_account uuid, p_cutoff timestamptz)
  returns boolean
  language plpgsql stable set search_path = '' as $$
begin
  return (
    select exists (
      select 1
        from public.accounts a
       where a.id = p_account
         and a.anonymised_at is null
         and a.updated_at < p_cutoff
         and not exists (select 1 from public.duplicate_candidates x
                          where x.account_id = a.id and x.state = 'open')
         and not exists (select 1 from public.duplicate_candidates x
                          where x.other_account_id = a.id and x.state = 'open')
         and not exists (select 1
                           from public.account_contacts ac
                           join public.account_contacts x
                             on x.contact_id = ac.contact_id and x.account_id <> ac.account_id
                          where ac.account_id = a.id)
         and not exists (select 1 from public.activities x
                          where x.account_id = a.id and x.created_at >= p_cutoff)
         and not exists (select 1 from public.account_entities x
                          where x.account_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.customer_sites x
                          where x.account_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.inbox_items x
                          where x.subject_id = a.id and x.updated_at >= p_cutoff)
         and not exists (select 1 from public.whatsapp_threads x
                          where x.account_id = a.id and x.last_inbound_at >= p_cutoff)
         and not exists (select 1
                           from public.account_contacts ac
                           join public.contacts c on c.id = ac.contact_id
                          where ac.account_id = a.id
                            and (ac.updated_at >= p_cutoff or c.updated_at >= p_cutoff
                                 or exists (select 1 from public.contact_phones p
                                             where p.contact_id = c.id and p.updated_at >= p_cutoff)
                                 or exists (select 1 from public.consents k
                                             where k.contact_id = c.id and k.updated_at >= p_cutoff))))
  );
end
$$;
--> statement-breakpoint
revoke execute on function app.customer_idle(uuid, timestamptz) from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
