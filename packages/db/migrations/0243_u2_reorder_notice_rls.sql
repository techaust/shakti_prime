-- U2 reorder drafts (docs/03-roadmap-appendix/phase3.md §7.2): who a reorder draft tells. The notify
-- worker (system:workers, notifications.send) finds them here, never by a person's grant: the
-- people of the order's company whose role there writes purchase orders (procurement.po.write), for
-- an order the reorder check drafted that is still a draft no person has written.
create or replace function app.notice_reorder_people(p_entity smallint, p_order uuid)
  returns table (user_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_notice_sender(p_entity);
  return query
    select distinct uer.user_id
      from public.purchase_orders o
      join public.user_entity_roles uer on uer.entity_id = o.entity_id
      join public.role_permissions rp on rp.role_id = uer.role_id
     where o.id = p_order
       and o.entity_id = p_entity
       and o.source = 'reorder'
       and o.state = 'draft'
       and o.drafted_by = o.created_by
       and rp.permission_key = 'procurement.po.write'
       and app.notice_recipient_ok(uer.user_id, p_entity)
     order by uer.user_id;
end
$$;
--> statement-breakpoint
revoke execute on function app.notice_reorder_people(smallint, uuid) from public, readonly_reporter, app_reader;
--> statement-breakpoint
grant execute on function app.notice_reorder_people(smallint, uuid) to app_user;
