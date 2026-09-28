-- app.account_in_scope() and app.contact_in_scope() serve write policies only: every read policy
-- on the customer tables uses a plain exists (DATABASE §4.2), and readonly_reporter only selects,
-- so no policy it meets calls them. 0016 still granted them to the reporting role, which made two
-- security-definer functions answer scope questions for a role that writes nothing. Closed to
-- everyone but app_user, like every other definer function.
revoke execute on function app.account_in_scope(uuid, text), app.contact_in_scope(uuid, text)
  from public, readonly_reporter;
--> statement-breakpoint
grant execute on function app.account_in_scope(uuid, text), app.contact_in_scope(uuid, text)
  to app_user;
