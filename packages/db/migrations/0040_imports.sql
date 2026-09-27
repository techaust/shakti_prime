CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"purpose" text NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scan_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "files_bucket_key_unique" UNIQUE("bucket","key"),
	CONSTRAINT "files_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('import')),
	CONSTRAINT "files_status_check" CHECK ("files"."status" in ('pending', 'scanning', 'masked', 'ready', 'rejected')),
	CONSTRAINT "files_size_check" CHECK ("files"."size" > 0),
	CONSTRAINT "files_sha256_check" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_name_length_check" CHECK (char_length("files"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"template_id" uuid,
	"format" text NOT NULL,
	"columns_json" jsonb NOT NULL,
	"mapping_json" jsonb,
	"state" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"committed_rows" integer DEFAULT 0 NOT NULL,
	"failed_batch" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "import_jobs_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('leads', 'accounts', 'items', 'tally_masters')),
	CONSTRAINT "import_jobs_state_check" CHECK ("import_jobs"."state" in ('uploaded', 'mapped', 'previewed', 'committing', 'committed', 'rolled_back', 'failed')),
	CONSTRAINT "import_jobs_format_check" CHECK ("import_jobs"."format" in ('csv', 'xlsx')),
	CONSTRAINT "import_jobs_counts_check" CHECK (least("import_jobs"."total_rows", "import_jobs"."valid_rows", "import_jobs"."invalid_rows", "import_jobs"."skipped_rows", "import_jobs"."committed_rows") >= 0
          and "import_jobs"."valid_rows" + "import_jobs"."invalid_rows" + "import_jobs"."skipped_rows" <= "import_jobs"."total_rows"
          and "import_jobs"."committed_rows" <= "import_jobs"."valid_rows"),
	CONSTRAINT "import_jobs_failed_batch_check" CHECK ("import_jobs"."failed_batch" is null or "import_jobs"."failed_batch" >= 1)
);
--> statement-breakpoint
CREATE TABLE "import_mapping_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mapping_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "import_mapping_templates_name_unique" UNIQUE("entity_id","kind","name"),
	CONSTRAINT "import_mapping_templates_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "import_mapping_templates_kind_check" CHECK ("import_mapping_templates"."kind" in ('leads', 'accounts', 'items', 'tally_masters'))
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"job_id" uuid NOT NULL,
	"entity_id" smallint NOT NULL,
	"row_no" integer NOT NULL,
	"raw_json" jsonb NOT NULL,
	"normalised_json" jsonb,
	"errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedupe_json" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_type" text,
	"created_id" uuid,
	"committed_batch" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "import_rows_pkey" PRIMARY KEY("job_id","row_no"),
	CONSTRAINT "import_rows_state_check" CHECK ("import_rows"."state" in ('pending', 'valid', 'invalid', 'committed', 'skipped', 'rolled_back')),
	CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity')),
	CONSTRAINT "import_rows_row_no_check" CHECK ("import_rows"."row_no" >= 1),
	CONSTRAINT "import_rows_created_check" CHECK (("import_rows"."created_type" is null) = ("import_rows"."created_id" is null))
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_entity_fk" FOREIGN KEY ("file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_template_entity_fk" FOREIGN KEY ("template_id","entity_id") REFERENCES "public"."import_mapping_templates"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_entity_fk" FOREIGN KEY ("job_id","entity_id") REFERENCES "public"."import_jobs"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_entity_idx" ON "files" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "import_jobs_entity_created_idx" ON "import_jobs" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_file_idx" ON "import_jobs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "import_jobs_template_idx" ON "import_jobs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "import_rows_job_state_idx" ON "import_rows" USING btree ("job_id","state","row_no");--> statement-breakpoint
CREATE INDEX "import_rows_created_idx" ON "import_rows" USING btree ("created_id");