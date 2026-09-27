-- AUDIT H2: a shared (group-wide) price list prices every company, so only a request acting for
-- every active company may write it or its items. An admin role held in one company carries
-- grants at scope `all`, so the permission alone cannot tell the two cases apart.
--
-- RLS hides entities outside the request from app_user, so the check is a definer function. It
-- answers yes or no about the caller's own scope, and pins an empty search_path with qualified
-- names (see AUDIT M2).
create or replace function app.request_covers_group() returns boolean
  language sql stable security definer set search_path = '' as $$
  select (select app.user_id()) is not null
     and not exists (
       select 1 from public.entities e
       where e.archived_at is null
         and not (e.id = any (coalesce((select app.entity_ids()), '{}'::int[])))
     )
$$;
--> statement-breakpoint
revoke execute on function app.request_covers_group() from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.request_covers_group() to app_user;
--> statement-breakpoint

drop policy price_lists_insert on price_lists;
--> statement-breakpoint
create policy price_lists_insert on price_lists for insert
  with check ((select app.has_perm('pricing.write:entity'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint
drop policy price_lists_update on price_lists;
--> statement-breakpoint
create policy price_lists_update on price_lists for update
  using ((select app.has_perm('pricing.write:entity'))
         and ((entity_id is null and (select app.request_covers_group()))
              or entity_id = any ((select app.entity_ids())::int[])))
  with check ((select app.has_perm('pricing.write:entity'))
              and ((entity_id is null and (select app.request_covers_group()))
                   or entity_id = any ((select app.entity_ids())::int[])));
--> statement-breakpoint

-- Items follow their list; the list is read under its read policy, so the shared-list rule is
-- repeated here.
drop policy price_list_items_insert on price_list_items;
--> statement-breakpoint
create policy price_list_items_insert on price_list_items for insert
  with check ((select app.has_perm('pricing.write:entity'))
              and exists (select 1 from price_lists l
                          where l.id = price_list_items.price_list_id
                            and (l.entity_id is not null or (select app.request_covers_group()))));
--> statement-breakpoint
drop policy price_list_items_update on price_list_items;
--> statement-breakpoint
create policy price_list_items_update on price_list_items for update
  using ((select app.has_perm('pricing.write:entity'))
         and exists (select 1 from price_lists l
                     where l.id = price_list_items.price_list_id
                       and (l.entity_id is not null or (select app.request_covers_group()))))
  with check ((select app.has_perm('pricing.write:entity'))
              and exists (select 1 from price_lists l
                          where l.id = price_list_items.price_list_id
                            and (l.entity_id is not null or (select app.request_covers_group()))));
