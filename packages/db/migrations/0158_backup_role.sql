-- The 6-hourly backup's login, `app_backup` (created by src/migrate.ts with `bypassrls` and every
-- transaction read-only; docs/05-database.md §3 and §10): `select` on every table and sequence of
-- the BOS's schemas, so `pg_dump` copies them whole, and on every table or sequence the migrator
-- makes there later (its default privileges; the monthly partitions are made by the migrator's own
-- jobs). It writes nothing and holds nothing else.
grant usage on schema public, app, audit_archive, audit_partitions, crm_partitions, drizzle
  to app_backup;
--> statement-breakpoint
grant select on all tables in schema public, app, audit_archive, audit_partitions, crm_partitions, drizzle
  to app_backup;
--> statement-breakpoint
grant select on all sequences in schema public, app, audit_archive, audit_partitions, crm_partitions, drizzle
  to app_backup;
--> statement-breakpoint
alter default privileges in schema public, app, audit_archive, audit_partitions, crm_partitions, drizzle
  grant select on tables to app_backup;
--> statement-breakpoint
alter default privileges in schema public, app, audit_archive, audit_partitions, crm_partitions, drizzle
  grant select on sequences to app_backup;
