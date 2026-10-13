ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "left_out_columns" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "masked_values" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "files_import_kept_idx" ON "files" USING btree ("entity_id","created_at") WHERE "files"."purpose" = 'import' and "files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "import_jobs_purge_idx" ON "import_jobs" USING btree ("entity_id","updated_at") WHERE "import_jobs"."purged_at" is null and "import_jobs"."state" <> 'committing';--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_left_out_columns_check" CHECK (cardinality("import_jobs"."left_out_columns") <= 50 and "import_jobs"."masked_values" >= 0);