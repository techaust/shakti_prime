-- Shadow, the rollout level below Suggest (docs/03-roadmap-appendix/phase1.md §9, A1; docs/05-database.md
-- §6.9): an agent records what it would propose as a shadowed action that never acts and never
-- reaches the Agent Inbox. The columns and checks are in the migration before this one.

-- 1. An agent writes its action as proposed, executed or, under Shadow, shadowed; never decided.
drop policy agent_actions_insert on agent_actions;
--> statement-breakpoint
create policy agent_actions_insert on agent_actions for insert to app_user with check (
  entity_id = any ((select app.entity_ids())::int[])
  and created_by = (select app.user_id())
  and agent like 'agent:%'
  and agent = (select coalesce(current_setting('app.role', true), ''))
  and state in ('proposed', 'shadowed', 'executed')
  and decided_by is null and decided_at is null and decided_input_json is null and not edited);
--> statement-breakpoint

-- 2. A shadowed action never reaches anyone's inbox. The agent that files an item cannot read its
--    own actions back (agent_actions_read), so the check reads the action as the owner; it reads
--    one row by its key and decides nothing else.
create or replace function app.inbox_item_not_shadowed() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.agent_action_id is not null and exists (
       select 1 from public.agent_actions a
        where a.id = new.agent_action_id and a.state = 'shadowed') then
    raise exception 'a shadowed action is never filed in the inbox' using errcode = '42501';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.inbox_item_not_shadowed() from public, readonly_reporter;
--> statement-breakpoint
create trigger inbox_item_not_shadowed before insert or update of agent_action_id on inbox_items
  for each row execute function app.inbox_item_not_shadowed();
