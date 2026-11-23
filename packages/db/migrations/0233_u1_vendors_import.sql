ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "import_mapping_templates" DROP CONSTRAINT "import_mapping_templates_kind_check";--> statement-breakpoint
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_created_type_check";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters', 'vendors')) NOT VALID;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_kind_check" CHECK ("import_mapping_templates"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters', 'vendors')) NOT VALID;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity', 'account', 'account_link', 'pin_code', 'vendor', 'vendor_update')) NOT VALID;