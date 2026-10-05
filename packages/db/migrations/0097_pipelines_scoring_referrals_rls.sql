-- Pipelines, call outcomes, lead scoring and referral partners (docs/design/phase1.md §6.6).
--
-- Pipelines and stages are written with crm.config.write:all, which only the Executive holds. A
-- group-wide row (entity_id null) shapes the work of every company, so it is written only by a
-- request acting for every active company, the rule shared price lists and tax rows follow (0019,
-- 0048); a company's own row by a request acting for that company. Call outcomes and score rules
-- follow the same rule. Referral partners are customers (ADR 0008): read with the customer. A
-- referral code decides who earns commission, so it is set by an Executive (crm.config.write:all)
-- for a customer the request's companies know, and it credits a lead only in a company where the
-- partner is a live customer. Commission rules carry no company and are read by those who set
-- them and by Accounts, who pay them.

create trigger set_updated_at before update on call_dispositions for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on lead_score_rules for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on referral_partners for each row execute function app.set_updated_at();
--> statement-breakpoint
create trigger set_updated_at before update on commission_rules for each row execute function app.set_updated_at();
--> statement-breakpoint

-- pipelines and pipeline_stages: crm.config.write:all in place of admin.entities.write:all
drop policy pipelines_insert on pipelines;
--> statement-breakpoint
create policy pipelines_insert on pipelines for insert
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
drop policy pipelines_update on pipelines;
--> statement-breakpoint
create policy pipelines_update on pipelines for update
  using ((select app.has_perm('crm.config.write:all'))
         and ((entity_id is null and (select app.request_covers_group()))
              or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
-- A stage follows its pipeline: a stage of a group-wide pipeline is written only for every company.
drop policy pipeline_stages_insert on pipeline_stages;
--> statement-breakpoint
create policy pipeline_stages_insert on pipeline_stages for insert
  with check ((select app.has_perm('crm.config.write:all'))
              and exists (select 1 from pipelines p
                           where p.id = pipeline_stages.pipeline_id
                             and ((p.entity_id is null and (select app.request_covers_group()))
                                  or p.entity_id = any ((select app.entity_ids())::int[]))));
--> statement-breakpoint
drop policy pipeline_stages_update on pipeline_stages;
--> statement-breakpoint
create policy pipeline_stages_update on pipeline_stages for update
  using ((select app.has_perm('crm.config.write:all'))
         and exists (select 1 from pipelines p
                      where p.id = pipeline_stages.pipeline_id
                        and ((p.entity_id is null and (select app.request_covers_group()))
                             or p.entity_id = any ((select app.entity_ids())::int[]))))
  with check ((select app.has_perm('crm.config.write:all'))
              and exists (select 1 from pipelines p
                           where p.id = pipeline_stages.pipeline_id
                             and ((p.entity_id is null and (select app.request_covers_group()))
                                  or p.entity_id = any ((select app.entity_ids())::int[]))));
--> statement-breakpoint

-- call_dispositions
alter table call_dispositions enable row level security;
--> statement-breakpoint
alter table call_dispositions force row level security;
--> statement-breakpoint
create policy call_dispositions_read on call_dispositions for select
  using ((select app.user_id()) is not null
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy call_dispositions_insert on call_dispositions for insert
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy call_dispositions_update on call_dispositions for update
  using ((select app.has_perm('crm.config.write:all'))
         and ((entity_id is null and (select app.request_covers_group()))
              or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint

-- lead_score_rules
alter table lead_score_rules enable row level security;
--> statement-breakpoint
alter table lead_score_rules force row level security;
--> statement-breakpoint
create policy lead_score_rules_read on lead_score_rules for select
  using ((select app.user_id()) is not null
         and (entity_id is null or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy lead_score_rules_insert on lead_score_rules for insert
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy lead_score_rules_update on lead_score_rules for update
  using ((select app.has_perm('crm.config.write:all'))
         and ((entity_id is null and (select app.request_covers_group()))
              or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('crm.config.write:all'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint

-- referral_partners: a child of the customer (ADR 0008). The read runs under the accounts policy,
-- so whoever reads the customer, through the relationship or one of its leads, reads its code.
alter table referral_partners enable row level security;
--> statement-breakpoint
alter table referral_partners force row level security;
--> statement-breakpoint
create policy referral_partners_read on referral_partners for select
  using (exists (select 1 from accounts a where a.id = referral_partners.account_id));
--> statement-breakpoint
create policy referral_partners_insert on referral_partners for insert
  with check ((select app.has_perm('crm.config.write:all'))
              and exists (select 1 from account_entities ae
                           where ae.account_id = referral_partners.account_id
                             and ae.entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
create policy referral_partners_update on referral_partners for update
  using ((select app.has_perm('crm.config.write:all'))
         and exists (select 1 from account_entities ae
                      where ae.account_id = referral_partners.account_id
                        and ae.entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('crm.config.write:all'))
              and exists (select 1 from account_entities ae
                           where ae.account_id = referral_partners.account_id
                             and ae.entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint

-- commission_rules: one rule at a time per partner, and one group default at a time.
alter table commission_rules enable row level security;
--> statement-breakpoint
alter table commission_rules force row level security;
--> statement-breakpoint
alter table commission_rules add constraint commission_rules_period_excl
  exclude using gist ((coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
                      daterange(effective_from, effective_to, '[)') with &&)
  where (archived_at is null);
--> statement-breakpoint
create policy commission_rules_read on commission_rules for select
  using ((select app.has_perm('crm.config.write:all'))
         or (select app.has_perm('finance.payment.write:own')));
--> statement-breakpoint
create policy commission_rules_insert on commission_rules for insert
  with check ((select app.has_perm('crm.config.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint
create policy commission_rules_update on commission_rules for update
  using ((select app.has_perm('crm.config.write:all')) and (select app.request_covers_group()))
  with check ((select app.has_perm('crm.config.write:all')) and (select app.request_covers_group()));
--> statement-breakpoint

-- Whether a stage still holds leads that are open or in nurture. The Executive archiving a stage
-- must learn this for every lead, including leads their own read scope does not reach, so it is a
-- definer; it answers yes or no, only to a caller holding crm.config.write:all.
create or replace function app.stage_has_open_leads(p_stage uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.config.write:all') then
    raise exception 'crm.config.write:all is required' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.opportunities o
     where o.stage_id = p_stage
       and o.archived_at is null
       and o.state in ('open', 'nurture'));
end
$$;
--> statement-breakpoint
revoke execute on function app.stage_has_open_leads(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.stage_has_open_leads(uuid) to app_user;
--> statement-breakpoint

-- The partner a referral code names for a lead of one company: an active partner whose customer
-- is live and related to that company, which must be in the request. A definer, because the
-- caller entering the lead rarely reads the partner's own customer record; it answers only the
-- partner's account id, and only to a caller who may write leads.
create or replace function app.referral_partner_for_code(p_code text, p_entity smallint)
  returns uuid
  language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.lead.write:own') then
    raise exception 'crm.lead.write is required' using errcode = '42501';
  end if;
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'the company is outside the request' using errcode = '42501';
  end if;
  return (
    select rp.account_id
      from public.referral_partners rp
      join public.accounts a on a.id = rp.account_id
     where upper(rp.code) = upper(btrim(p_code))
       and rp.is_active
       and a.archived_at is null
       and exists (select 1 from public.account_entities ae
                    where ae.account_id = rp.account_id and ae.entity_id = p_entity));
end
$$;
--> statement-breakpoint
revoke execute on function app.referral_partner_for_code(text, smallint) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.referral_partner_for_code(text, smallint) to app_user;
--> statement-breakpoint

-- Leads made before scoring carry the old default of 0; the base is 50 (CRM-3). The touch-time
-- trigger stays off for the backfill, so the lists keep their order.
alter table opportunities disable trigger set_updated_at;
--> statement-breakpoint
update opportunities set score = 50 where score = 0 and score_changed_at is null;
--> statement-breakpoint
alter table opportunities enable trigger set_updated_at;
--> statement-breakpoint

grant select, insert, update on call_dispositions, lead_score_rules, referral_partners, commission_rules to app_user;
--> statement-breakpoint
revoke delete on call_dispositions, lead_score_rules, referral_partners, commission_rules from app_user;
--> statement-breakpoint
grant select on call_dispositions, lead_score_rules, referral_partners, commission_rules to readonly_reporter;
--> statement-breakpoint
-- The queries' own pool reads what app_user reads, under the same policies (0062).
grant select on call_dispositions, lead_score_rules, referral_partners, commission_rules to app_reader;
