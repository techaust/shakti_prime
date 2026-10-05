ALTER TABLE "pin_codes" DROP CONSTRAINT "pin_codes_pin_office_unique";--> statement-breakpoint
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_created_type_check";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "entity_ids" smallint[];--> statement-breakpoint
CREATE INDEX "customer_sites_pin_idx" ON "customer_sites" USING btree ("pin") WHERE "customer_sites"."pin" is not null and "customer_sites"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pin_codes_pin_office_unique" ON "pin_codes" USING btree ("pin",lower("office_name"));--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_entity_ids_check" CHECK ("import_jobs"."entity_ids" is null or cardinality("import_jobs"."entity_ids") between 1 and 20);--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity', 'account', 'account_link', 'pin_code'));