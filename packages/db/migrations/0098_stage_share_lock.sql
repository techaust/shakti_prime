-- A lead moving into a stage holds that stage for the rest of its transaction, so an Executive
-- archiving the stage at the same moment either waits for the move and then finds the lead
-- (app.stage_has_open_leads()), or archives first and the move finds no live stage. A plain
-- `select ... for share` would need the stage's update policy (crm.config.write:all), which the
-- caller moving a lead does not hold, so the lock is taken by this definer. It answers only
-- whether a live stage of a pipeline the request reads was locked, and only to a caller who may
-- write leads.
create or replace function app.share_lock_stage(p_stage uuid) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.user_id() is null or not app.has_perm('crm.lead.write:own') then
    raise exception 'crm.lead.write is required' using errcode = '42501';
  end if;
  perform 1
     from public.pipeline_stages s
     join public.pipelines p on p.id = s.pipeline_id
    where s.id = p_stage
      and s.archived_at is null
      and (p.entity_id is null or p.entity_id = any (coalesce(app.entity_ids(), '{}'::int[])))
      for share of s;
  return found;
end
$$;
--> statement-breakpoint
revoke execute on function app.share_lock_stage(uuid) from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.share_lock_stage(uuid) to app_user;
