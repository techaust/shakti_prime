-- CRM-10: the evidence file a consent rests on is fixed once written, like the rest of its evidence
-- (0024, AUDIT M17); the column-level update grant of app_user (withdrawn_at, updated_at,
-- updated_by) leaves it out already, and the trigger holds it for every role.
create or replace function app.consent_evidence_fixed() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if (new.id, new.contact_id, new.channel, new.purpose, new.source, new.text_version,
      new.given_at, new.evidence_file_id, new.created_at, new.created_by)
     is distinct from
     (old.id, old.contact_id, old.channel, old.purpose, old.source, old.text_version,
      old.given_at, old.evidence_file_id, old.created_at, old.created_by) then
    raise exception 'consent evidence cannot be changed; record a new consent instead'
      using errcode = 'check_violation', constraint = 'consents_evidence_fixed';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a withdrawn consent stays withdrawn; record a new consent instead'
      using errcode = 'check_violation', constraint = 'consents_withdrawal_fixed';
  end if;
  return new;
end
$$;
