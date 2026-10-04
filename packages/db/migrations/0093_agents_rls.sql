-- The agent runtime and the Agent Inbox (docs/design/phase1.md §7.1, docs/DATABASE.md §4.4 and
-- §6.9). An agent writes its runs, actions and inbox items as its own principal (`app.role` is
-- `agent:%`); people decide on suggestions with `agents.inbox.act`; the agent controls are
-- `agents.autonomy.write` and `agents.killswitch`, both held for every company.

-- 1. agent_configs: one row per agent (or every agent), action type (or every one) and company
--    (or the group).
create unique index agent_configs_scope_unique on agent_configs (agent, action_type, entity_id) nulls not distinct;
--> statement-breakpoint
create index agent_configs_entity_idx on agent_configs (entity_id);
--> statement-breakpoint
create trigger set_updated_at before update on agent_configs for each row execute function app.set_updated_at();
--> statement-breakpoint

-- Autonomy and the spend cap are changed only with agents.autonomy.write, a switch only with
-- agents.killswitch, whichever policy let the row in: the two permissions are held by different
-- roles (SECURITY §3.2). Only the application role is checked; the seed and the migrations write
-- as the owner.
create or replace function app.agent_configs_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if current_user <> 'app_user' then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.autonomy is not null or new.daily_spend_cap_paise is not null))
     or (tg_op = 'UPDATE' and (new.autonomy is distinct from old.autonomy
                               or new.daily_spend_cap_paise is distinct from old.daily_spend_cap_paise)) then
    if not app.has_perm('agents.autonomy.write:all') then
      raise exception 'agent autonomy needs agents.autonomy.write' using errcode = '42501';
    end if;
  end if;
  if (tg_op = 'INSERT' and not new.enabled)
     or (tg_op = 'UPDATE' and new.enabled is distinct from old.enabled) then
    if not app.has_perm('agents.killswitch:all') then
      raise exception 'a kill switch needs agents.killswitch' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.agent is distinct from old.agent
                           or new.action_type is distinct from old.action_type
                           or new.entity_id is distinct from old.entity_id) then
    raise exception 'an agent setting keeps its agent, action type and company' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.agent_configs_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger agent_configs_guard before insert or update on agent_configs
  for each row execute function app.agent_configs_guard();
--> statement-breakpoint
alter table agent_configs enable row level security;
--> statement-breakpoint
alter table agent_configs force row level security;
--> statement-breakpoint

-- Every principal of a company reads its settings and the group's: the agent runtime reads them
-- as the agent, and the screens show them. An empty company scope reads nothing.
create policy agent_configs_read on agent_configs for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  or (entity_id is null and cardinality((select app.entity_ids())) > 0));
--> statement-breakpoint
create policy agent_configs_insert on agent_configs for insert to app_user with check (
  ((select app.has_perm('agents.autonomy.write:all')) or (select app.has_perm('agents.killswitch:all')))
  and created_by = (select app.user_id())
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
create policy agent_configs_update on agent_configs for update to app_user
  using (((select app.has_perm('agents.autonomy.write:all')) or (select app.has_perm('agents.killswitch:all')))
         and (entity_id = any ((select app.entity_ids())::int[])
           or (entity_id is null and (select app.request_covers_group()))))
  with check (((select app.has_perm('agents.autonomy.write:all')) or (select app.has_perm('agents.killswitch:all')))
              and (entity_id = any ((select app.entity_ids())::int[])
                or (entity_id is null and (select app.request_covers_group()))));
--> statement-breakpoint
grant select on agent_configs to app_user, app_reader;
--> statement-breakpoint
grant insert on agent_configs to app_user;
--> statement-breakpoint
grant update (autonomy, daily_spend_cap_paise, enabled, updated_at, updated_by) on agent_configs to app_user;
--> statement-breakpoint

-- 2. agent_runs: written once by the agent's own principal, read with the agent controls. No
--    prompt or answer text is stored.
create index agent_runs_principal_idx on agent_runs (principal_id);
--> statement-breakpoint
create trigger agent_runs_append_only before update or delete on agent_runs
  for each row execute function app.raise_append_only();
--> statement-breakpoint
alter table agent_runs enable row level security;
--> statement-breakpoint
alter table agent_runs force row level security;
--> statement-breakpoint
create policy agent_runs_read on agent_runs for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('agents.autonomy.write:entity'))
    or (select app.has_perm('agents.killswitch:entity'))));
--> statement-breakpoint
create policy agent_runs_insert on agent_runs for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and principal_id = (select app.user_id())
  and agent like 'agent:%'
  and agent = (select coalesce(current_setting('app.role', true), '')));
--> statement-breakpoint
grant select on agent_runs to app_user, app_reader;
--> statement-breakpoint
grant insert on agent_runs to app_user;
--> statement-breakpoint

-- 3. agent_actions: append-only except the decision columns, which change once, from proposed,
--    through the inbox commands.
create or replace function app.agent_actions_append_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'agent_actions is append-only' using errcode = '42501';
  end if;
  if old.state <> 'proposed'
     or new.id <> old.id or new.entity_id <> old.entity_id or new.run_id <> old.run_id
     or new.agent <> old.agent or new.action_type <> old.action_type
     or new.input_json <> old.input_json or new.autonomy <> old.autonomy
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'agent_actions changes only its decision, once' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.agent_actions_append_only() from public, readonly_reporter;
--> statement-breakpoint
create trigger agent_actions_append_only before update or delete on agent_actions
  for each row execute function app.agent_actions_append_only();
--> statement-breakpoint
create index agent_actions_decided_by_idx on agent_actions (decided_by);
--> statement-breakpoint
alter table agent_actions enable row level security;
--> statement-breakpoint
alter table agent_actions force row level security;
--> statement-breakpoint

-- Read with the agent controls, or through an inbox item the caller reads (the exists runs under
-- inbox_items_read).
create policy agent_actions_read on agent_actions for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('agents.autonomy.write:entity'))
    or (select app.has_perm('agents.killswitch:entity'))
    or exists (select 1 from inbox_items i where i.agent_action_id = agent_actions.id)));
--> statement-breakpoint
create policy agent_actions_insert on agent_actions for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and agent like 'agent:%'
  and agent = (select coalesce(current_setting('app.role', true), ''))
  and state in ('proposed', 'executed')
  and decided_by is null and decided_at is null and decided_input_json is null and not edited);
--> statement-breakpoint
-- A decision is the caller's own, on an action whose inbox item the caller may act on.
create policy agent_actions_update on agent_actions for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and state = 'proposed'
         and exists (select 1 from inbox_items i
                      where i.agent_action_id = agent_actions.id
                        and app.scope_ok('agents.inbox.act', i.assignee_id, i.team_id)))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and state in ('approved', 'rejected')
              and decided_by = (select app.user_id()));
--> statement-breakpoint
grant select on agent_actions to app_user, app_reader;
--> statement-breakpoint
grant insert on agent_actions to app_user;
--> statement-breakpoint
grant update (state, edited, decided_input_json, decided_by, decided_at) on agent_actions to app_user;
--> statement-breakpoint

-- 4. inbox_items: a scope root on agents.inbox.act with the assignee as its owner.
create trigger set_updated_at before update on inbox_items for each row execute function app.set_updated_at();
--> statement-breakpoint
create index inbox_items_done_by_idx on inbox_items (done_by);
--> statement-breakpoint
alter table inbox_items enable row level security;
--> statement-breakpoint
alter table inbox_items force row level security;
--> statement-breakpoint
create policy inbox_items_read on inbox_items for select to app_user, app_reader using (
  entity_id = any ((select app.entity_ids())::int[])
  and ((select app.has_perm('agents.inbox.act:entity'))
    or ((select app.has_perm('agents.inbox.act:team')) and team_id = (select app.team_id()))
    or ((select app.has_perm('agents.inbox.act:own')) and assignee_id = (select app.user_id()))));
--> statement-breakpoint
-- Only an agent files a suggestion; routed work arrives with the slice that routes it.
create policy inbox_items_insert on inbox_items for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and kind = 'agent_suggestion'
  and state = 'open'
  and (select coalesce(current_setting('app.role', true), '')) like 'agent:%');
--> statement-breakpoint
create policy inbox_items_update on inbox_items for update to app_user
  using (entity_id = any ((select app.entity_ids())::int[])
         and app.scope_ok('agents.inbox.act', assignee_id, team_id))
  with check (entity_id = any ((select app.entity_ids())::int[])
              and app.scope_ok('agents.inbox.act', assignee_id, team_id)
              and done_by = (select app.user_id()));
--> statement-breakpoint
grant select on inbox_items to app_user, app_reader;
--> statement-breakpoint
grant insert on inbox_items to app_user;
--> statement-breakpoint
grant update (state, done_by, done_at, updated_at, updated_by) on inbox_items to app_user;
--> statement-breakpoint

-- 5. agent_evals: of no company, written only by the eval runner as the table owner, read with
--    agents.autonomy.write for every company; an empty company scope reads nothing.
create trigger set_updated_at before update on agent_evals for each row execute function app.set_updated_at();
--> statement-breakpoint
alter table agent_evals enable row level security;
--> statement-breakpoint
alter table agent_evals force row level security;
--> statement-breakpoint
create policy agent_evals_read on agent_evals for select to app_user, app_reader
  using ((select app.has_perm('agents.autonomy.write:all')) and cardinality((select app.entity_ids())) > 0);
--> statement-breakpoint
revoke all on agent_evals from public, app_user, app_reader, readonly_reporter, auth_service, outbox_publisher;
--> statement-breakpoint
grant select on agent_evals to app_user, app_reader;
