-- Helpers for the catalogue, pricing, tax and numbering tables (docs/DATABASE.md §4.2, §5; ADR 0006).
create extension if not exists btree_gist;
--> statement-breakpoint
-- Defence in depth for append-only ledgers: the grant already forbids it for app_user.
create or replace function app.raise_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
--> statement-breakpoint
-- Issues the next gapless number of a series. Runs as the table owner so app_user never writes
-- document_sequences directly; the caller's entity scope still applies. The row lock taken by
-- the update serialises concurrent callers within the same series.
create or replace function app.next_document_no(
  p_entity smallint, p_doc_type text, p_fy text, p_prefix text
) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  v_no int;
begin
  if not (p_entity = any (coalesce(app.entity_ids(), '{}'::int[]))) then
    raise exception 'entity % outside the request scope', p_entity
      using errcode = 'insufficient_privilege';
  end if;
  insert into document_sequences (id, entity_id, doc_type, fy, prefix)
  values (gen_random_uuid(), p_entity, p_doc_type, p_fy, p_prefix)
  on conflict (entity_id, doc_type, fy) do nothing;
  update document_sequences
     set next_no = next_no + 1
   where entity_id = p_entity and doc_type = p_doc_type and fy = p_fy
  returning next_no - 1 into v_no;
  return v_no;
end
$$;
--> statement-breakpoint
revoke all on function app.next_document_no(smallint, text, text, text) from public;
--> statement-breakpoint
grant execute on function app.next_document_no(smallint, text, text, text) to app_user;
--> statement-breakpoint
grant execute on function app.raise_append_only() to app_user, readonly_reporter;
