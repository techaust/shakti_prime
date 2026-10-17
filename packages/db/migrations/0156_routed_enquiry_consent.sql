-- A consent captured on the lead or walk-in form travels with an enquiry passed on to a colleague
-- (N1 review L2). When `crm.enquiry.take` routes an enquiry for a customer a colleague looks after
-- (`crm.enquiry.route`), the caller may not write that customer's contacts (`consents_insert` asks
-- `crm.account.write` over the contact), so the consent the form captured was dropped. It is now
-- recorded through this definer, as the form records it on its own customer: on the contact with
-- the typed number, else the customer's owner contact, given now, with the form's source and no
-- proof file, with a `consent_recorded` row on the customer's timeline.
--
-- The definer takes nothing but the routed work the caller filed in this same transaction: an
-- open `routed_work` item on a customer, made by the caller now (`created_at = now()`, the
-- transaction's start), in a company of the request, for a caller holding what routing needs
-- (`crm.lead.write:own` and `crm.account.write:own`). It cannot add a consent to any other
-- customer, or to this one later.
create or replace function app.record_routed_consent(
  p_item uuid,
  p_phone text,
  p_channel text,
  p_purpose text,
  p_source text,
  p_text_version text
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_entity smallint;
  v_account uuid;
  v_contact uuid;
  v_id uuid := app.new_uuid7();
begin
  if v_user is null or not app.has_perm('crm.lead.write:own')
     or not app.has_perm('crm.account.write:own') then
    raise exception 'crm.lead.write and crm.account.write are required'
      using errcode = 'insufficient_privilege';
  end if;
  select i.entity_id, i.subject_id into v_entity, v_account
    from public.inbox_items i
   where i.id = p_item
     and i.kind = 'routed_work'
     and i.subject_type = 'account'
     and i.state = 'open'
     and i.created_by = v_user
     and i.created_at = pg_catalog.now()
     and i.entity_id = any (coalesce(app.entity_ids(), '{}'::int[]));
  if v_account is null then
    raise exception 'routed work % was not filed by this request', p_item
      using errcode = 'insufficient_privilege';
  end if;

  if p_phone is not null then
    select ac.contact_id into v_contact
      from public.account_contacts ac
      join public.contacts c on c.id = ac.contact_id and c.archived_at is null
      join public.contact_phones cp on cp.contact_id = ac.contact_id
     where ac.account_id = v_account and cp.e164 = p_phone
     order by ac.contact_id
     limit 1;
  end if;
  if v_contact is null then
    select ac.contact_id into v_contact
      from public.account_contacts ac
      join public.contacts c on c.id = ac.contact_id and c.archived_at is null
     where ac.account_id = v_account and ac.role = 'owner'
     order by ac.contact_id
     limit 1;
  end if;
  if v_contact is null then
    raise exception 'the customer of routed work % has no live contact', p_item
      using errcode = 'no_data_found';
  end if;

  insert into public.consents (id, contact_id, channel, purpose, source, text_version, given_at,
                               created_by)
    values (v_id, v_contact, p_channel, p_purpose, p_source, p_text_version, pg_catalog.now(),
            v_user);
  insert into public.activities (id, entity_id, opportunity_id, account_id, type,
                                 actor_principal_id, payload_json)
    values (app.new_uuid7(), v_entity, null, v_account, 'consent_recorded', v_user,
            pg_catalog.jsonb_build_object('consentId', v_id, 'channel', p_channel,
                                          'purpose', p_purpose, 'source', p_source));
  return v_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.record_routed_consent(uuid, text, text, text, text, text)
  from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.record_routed_consent(uuid, text, text, text, text, text) to app_user;
