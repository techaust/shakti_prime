-- U1 review M2: a supplier's quote given to the whole group is read by a holder of
-- procurement.rate.read acting in any company (vendor_quotes_read, 0230), but its document is a
-- `vendor_quote` file stored in one company, which files_read (0066) shows only in that company.
-- This policy reads the document with the group quote that names it, as files_signed_quote_read
-- (0117) reads a signed copy with its quote: a `vendor_quote` file named by a group quote not
-- withdrawn, to a caller acting in some company with procurement.rate.read. The EXISTS runs under
-- vendor_quotes' own policies, so only a caller who may read that quote reaches its file.
-- files_read is left as it is: permissive policies add up, so every clause of it still holds.
create policy files_vendor_quote_group_read on files for select to app_user, app_reader using (
  purpose = 'vendor_quote'
  and cardinality((select app.entity_ids())) > 0
  and (select app.has_perm('procurement.rate.read:entity'))
  and exists (select 1 from vendor_quotes q
               where q.file_id = files.id
                 and q.entity_id is null
                 and q.withdrawn_at is null));
