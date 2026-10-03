-- The list of people a lead may be assigned to (`listLeadAssignees`) is a query, so it reads on
-- `app_reader`, and it asks `app.user_is_active()` (0059) whether each person is active in a
-- company of the request. The definer only reads and still checks `crm.lead.assign:own` in its
-- body, so the reader may call it as the application does.
grant execute on function app.user_is_active(uuid) to app_reader;
