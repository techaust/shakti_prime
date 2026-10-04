-- Customer edits (docs/design/phase1.md §6.5): a number comes off a customer's contact through
-- crm.contact.update, which keeps at least one number on the contact. The delete follows the
-- write rule of the other contact rows (ADR 0008): the caller may write a customer the contact
-- belongs to.
create policy contact_phones_delete on contact_phones for delete to app_user
  using (app.contact_in_scope(contact_id, 'crm.account.write'));
--> statement-breakpoint
grant delete on contact_phones to app_user;
