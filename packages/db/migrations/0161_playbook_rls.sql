-- Playbook directives (docs/03-roadmap-appendix/phase2.md §5.4, docs/05-database.md §6.9, SECURITY
-- §3.2 and §7): who reads a directive and its conflict checks, who drafts, edits, approves and
-- retires one, and the guard that keeps every change on the `playbook_directive` machine.
--
-- A directive belongs to a company or, with `entity_id` null, to the whole group. It is read in a
-- request for its company, or for any company when it is the group's, by its audience:
-- `customer` and `staff` with knowledge.vault.read.staff (every staff role), `management` with
-- knowledge.vault.read.management. Only an approved directive is read that way; a draft or a
-- retired one is read only by a holder of knowledge.playbook.draft or knowledge.playbook.approve,
-- which no agent principal holds, so a draft never reaches an agent's prompt.

-- 1. playbook_directives.
create trigger set_updated_at before update on playbook_directives
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- What a request may change, beyond what the policies and the column grants already refuse:
-- - a directive's wording, type and audience only while it is a draft; changing them clears the
--   conflict check (`embedding`, `checked_at`, `conflicts_with`) until it runs again;
-- - `embedding` and `checked_at` only to null: the conflict check records them as the owner;
-- - `conflicts_with` only by dropping ids (a resolution), never by adding one;
-- - approval only by a holder of knowledge.playbook.approve, as themselves, of a draft whose check
--   has run with nothing left open;
-- - retiring an approved directive only by a holder of knowledge.playbook.approve, with a reason;
-- - nothing once retired.
create or replace function app.playbook_directives_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(app.user_id(), new.updated_by);
  if current_user <> 'app_user' then
    return new;
  end if;
  if old.state = 'retired' then
    raise exception 'a retired directive does not change' using errcode = 'insufficient_privilege';
  end if;
  if (new.text, new.title, new.type, new.audience) is distinct from
     (old.text, old.title, old.type, old.audience) then
    if old.state <> 'draft' then
      raise exception 'only a draft directive is reworded' using errcode = 'insufficient_privilege';
    end if;
    new.embedding := null;
    new.checked_at := null;
    new.conflicts_with := '{}'::uuid[];
  end if;
  if new.embedding is not null and new.embedding::text is distinct from old.embedding::text then
    raise exception 'only the conflict check records an embedding'
      using errcode = 'insufficient_privilege';
  end if;
  if new.checked_at is not null and new.checked_at is distinct from old.checked_at then
    raise exception 'only the conflict check records that it ran'
      using errcode = 'insufficient_privilege';
  end if;
  if not (new.conflicts_with <@ old.conflicts_with) then
    raise exception 'only the conflict check names a conflict' using errcode = 'insufficient_privilege';
  end if;
  if new.state = 'approved' and old.state <> 'approved' then
    if old.state <> 'draft'
       or not app.has_perm('knowledge.playbook.approve:all')
       or new.approved_by is distinct from app.user_id()
       or new.checked_at is null
       or pg_catalog.cardinality(new.conflicts_with) > 0 then
      raise exception 'a directive is approved by an approver, once its check is clear'
        using errcode = 'insufficient_privilege';
    end if;
  elsif (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'an approval is recorded only when approving' using errcode = 'insufficient_privilege';
  end if;
  if new.state = 'retired' and old.state = 'approved'
     and not app.has_perm('knowledge.playbook.approve:all') then
    raise exception 'an approved directive is retired by an approver'
      using errcode = 'insufficient_privilege';
  end if;
  if new.state = 'draft' and old.state <> 'draft' then
    raise exception 'a directive never goes back to draft' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.playbook_directives_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger playbook_directives_guard before update on playbook_directives
  for each row execute function app.playbook_directives_guard();
--> statement-breakpoint

alter table playbook_directives enable row level security;
--> statement-breakpoint
alter table playbook_directives force row level security;
--> statement-breakpoint
create policy playbook_directives_read on playbook_directives for select to app_user, app_reader using (
  (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0))
  and ((audience in ('customer', 'staff') and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (audience = 'management' and (select app.has_perm('knowledge.vault.read.management:all'))))
  and (state = 'approved'
    or (select app.has_perm('knowledge.playbook.draft:all'))
    or (select app.has_perm('knowledge.playbook.approve:all'))));
--> statement-breakpoint
-- A draft is written by a holder of knowledge.playbook.draft as themselves, for an audience they
-- read, for a company of the request or, in a request for every company, for the whole group; it
-- starts unchecked and unapproved. Its source, when it names one, is a vault file the caller
-- reads (the subselect runs under knowledge_files_read).
create policy playbook_directives_insert on playbook_directives for insert to app_user with check (
  (select app.has_perm('knowledge.playbook.draft:all'))
  and created_by = (select app.user_id())
  and state = 'draft'
  and approved_by is null and approved_at is null and retired_at is null and retired_reason is null
  and embedding is null and checked_at is null and conflicts_with = '{}'::uuid[]
  and ((audience in ('customer', 'staff') and (select app.has_perm('knowledge.vault.read.staff:all')))
    or (audience = 'management' and (select app.has_perm('knowledge.vault.read.management:all'))))
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and (select app.request_covers_group())))
  and (source_file_id is null
    or exists (select 1 from knowledge_files kf where kf.id = playbook_directives.source_file_id)));
--> statement-breakpoint
-- Changed by a holder of either playbook grant who reads the directive's audience; a directive of
-- the whole group only in a request for every company. The guard above says which change needs
-- the approver.
create policy playbook_directives_update on playbook_directives for update to app_user
  using (((select app.has_perm('knowledge.playbook.draft:all'))
          or (select app.has_perm('knowledge.playbook.approve:all')))
         and (entity_id = any ((select app.entity_ids())::int[])
           or (entity_id is null and (select app.request_covers_group())))
         and ((audience in ('customer', 'staff') and (select app.has_perm('knowledge.vault.read.staff:all')))
           or (audience = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))))
  with check (((select app.has_perm('knowledge.playbook.draft:all'))
               or (select app.has_perm('knowledge.playbook.approve:all')))
              and ((audience in ('customer', 'staff') and (select app.has_perm('knowledge.vault.read.staff:all')))
                or (audience = 'management' and (select app.has_perm('knowledge.vault.read.management:all')))));
--> statement-breakpoint
grant select on playbook_directives to app_user, app_reader;
--> statement-breakpoint
grant insert on playbook_directives to app_user;
--> statement-breakpoint
grant update (type, audience, title, text, state, approved_by, approved_at, retired_reason,
              retired_at, conflicts_with, embedding, checked_at, updated_at, updated_by)
  on playbook_directives to app_user;
--> statement-breakpoint

-- 2. playbook_conflict_checks: read by a holder of either playbook grant with the draft it
--    belongs to (the subselect runs under playbook_directives_read); written by the conflict
--    check's definer; a person changes only the resolution of an open conflict or overlap.
create or replace function app.playbook_conflict_checks_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if current_user <> 'app_user' then
    return new;
  end if;
  if old.resolved_at is not null then
    raise exception 'a resolved conflict stays resolved' using errcode = 'insufficient_privilege';
  end if;
  if new.resolved_by is distinct from app.user_id()
     or not app.has_perm('knowledge.playbook.approve:all') then
    raise exception 'a conflict is resolved by an approver, as themselves'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.playbook_conflict_checks_guard() from public, readonly_reporter;
--> statement-breakpoint
create trigger playbook_conflict_checks_guard before update on playbook_conflict_checks
  for each row execute function app.playbook_conflict_checks_guard();
--> statement-breakpoint

alter table playbook_conflict_checks enable row level security;
--> statement-breakpoint
alter table playbook_conflict_checks force row level security;
--> statement-breakpoint
create policy playbook_conflict_checks_read on playbook_conflict_checks for select to app_user, app_reader using (
  ((select app.has_perm('knowledge.playbook.draft:all'))
    or (select app.has_perm('knowledge.playbook.approve:all')))
  and (entity_id = any ((select app.entity_ids())::int[])
    or (entity_id is null and cardinality((select app.entity_ids())) > 0))
  and exists (select 1 from playbook_directives d where d.id = playbook_conflict_checks.directive_id));
--> statement-breakpoint
create policy playbook_conflict_checks_update on playbook_conflict_checks for update to app_user
  using ((select app.has_perm('knowledge.playbook.approve:all'))
         and (entity_id = any ((select app.entity_ids())::int[])
           or (entity_id is null and (select app.request_covers_group())))
         and exists (select 1 from playbook_directives d where d.id = playbook_conflict_checks.directive_id))
  with check ((select app.has_perm('knowledge.playbook.approve:all')));
--> statement-breakpoint
grant select on playbook_conflict_checks to app_user, app_reader;
--> statement-breakpoint
grant update (resolution, resolution_note, resolved_by, resolved_at) on playbook_conflict_checks to app_user;
