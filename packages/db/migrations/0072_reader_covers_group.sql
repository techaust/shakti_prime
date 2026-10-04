-- The catalogue and GST rates screens ask whether the request acts for every active company before
-- they offer a change, and those reads run on the `app_reader` pool (docs/DATABASE.md §3). The
-- function answers only that, reads no row a policy hides, and writes nothing.
grant execute on function app.request_covers_group() to app_reader;
