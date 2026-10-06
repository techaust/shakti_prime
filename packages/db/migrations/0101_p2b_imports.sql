CREATE TABLE "pin_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pin" text NOT NULL,
	"office_name" text NOT NULL,
	"taluk" text,
	"district" text NOT NULL,
	"state_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "pin_codes_pin_office_unique" UNIQUE("pin","office_name"),
	CONSTRAINT "pin_codes_pin_check" CHECK ("pin_codes"."pin" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "pin_codes_office_name_check" CHECK (char_length("pin_codes"."office_name") between 1 and 120),
	CONSTRAINT "pin_codes_taluk_check" CHECK ("pin_codes"."taluk" is null or char_length("pin_codes"."taluk") between 1 and 120),
	CONSTRAINT "pin_codes_district_check" CHECK (char_length("pin_codes"."district") between 2 and 120),
	CONSTRAINT "pin_codes_state_code_check" CHECK ("pin_codes"."state_code" is null or "pin_codes"."state_code" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "import_mapping_templates" DROP CONSTRAINT "import_mapping_templates_kind_check";--> statement-breakpoint
ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_created_type_check";--> statement-breakpoint
DROP INDEX "import_jobs_file_idx";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "name_key" text GENERATED ALWAYS AS (regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')) STORED;--> statement-breakpoint
ALTER TABLE "customer_sites" ADD COLUMN "village_key" text GENERATED ALWAYS AS (regexp_replace(lower(village), '[^a-z0-9]+', '', 'g')) STORED;--> statement-breakpoint
ALTER TABLE "customer_sites" ADD COLUMN "pin_needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pin_codes" ADD CONSTRAINT "pin_codes_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_codes" ADD CONSTRAINT "pin_codes_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_name_key_idx" ON "contacts" USING btree ("name_key") WHERE "contacts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "customer_sites_village_key_idx" ON "customer_sites" USING btree ("village_key") WHERE "customer_sites"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_unique" UNIQUE("file_id");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters'));--> statement-breakpoint
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_kind_check" CHECK ("import_mapping_templates"."kind" in ('leads', 'accounts', 'pin_codes', 'items', 'tally_masters'));--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity', 'account', 'pin_code'));